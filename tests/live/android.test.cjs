// Smoke tests in Chrome on Android, a real phone or an emulator, driven by Playwright's Android support over adb,
// against a build of this checkout served by serve.cjs and reached from the device through `adb reverse`:
//   node --test tests/live/android.test.cjs
// Needs adb on the PATH with one device, Chrome on it and, unless the device is debuggable (an emulator's google_apis
// image is), chrome://flags › "Enable command line on non-rooted devices" turned on. GitHub Actions runs it on an
// emulator (the `android` job). Taps are touch events sent through Chrome's DevTools protocol, so they go through the
// page's real touch handling, not mouse events. Screenshots go to tests/out/live/.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const pw = (() => { try { return require('playwright'); } catch (e) { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } })();
const { serve } = require('./serve.cjs');
const { loadedOn, boardBox, square } = require('./board.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tests', 'out', 'live');
const PORT = 8767; // the same port on the device, through adb reverse
const VERDICT = /your move · .*(stockfish’s choice|cp vs|as good as|can’t run here|stopped)/i;

test('android · chrome · local build', async (t) => {
  // undone last first: t.after hooks run in the order they were added, which closed the device before Chrome
  const undo = [];
  t.after(async () => { for (const f of undo.reverse()) await f(); });
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  const local = await serve(path.join(ROOT, 'out', 'site'), PORT);
  undo.push(() => local.close());

  const [device] = await pw._android.devices();
  assert.ok(device, 'no adb device');
  undo.push(() => device.close());
  const sh = async (cmd) => (await device.shell(cmd)).toString().trim();
  assert.match(await sh('pm list packages com.android.chrome'), /com\.android\.chrome/, 'Chrome is not installed on the device');
  t.diagnostic(`${device.model()} · Android ${await sh('getprop ro.build.version.release')} · ${(await sh('dumpsys package com.android.chrome | grep versionName')).split('\n')[0]}`);
  // an emulator has no camera cut-out, so the full-screen test would pass whatever the page does with one: give it
  // Android's emulated punch hole (a developer option) for the run. A real phone is left as it is
  const emulator = (await sh('getprop ro.kernel.qemu')) === '1' || (await sh('getprop ro.boot.qemu')) === '1';
  const CUTOUT = 'com.android.internal.display.cutout.emulation.hole';
  if (emulator) {
    await sh(`cmd overlay enable ${CUTOUT}`);
    undo.push(() => sh(`cmd overlay disable ${CUTOUT}`));
  }
  execFileSync('adb', ['-s', device.serial(), 'reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
  undo.push(() => execFileSync('adb', ['-s', device.serial(), 'reverse', '--remove', `tcp:${PORT}`]));

  const ctx = await device.launchBrowser({ hasTouch: true }); // Playwright's taps need it set, though the phone has touch anyway
  undo.push(() => ctx.close());
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  // Chrome downloads a manifest icon in the background (to check the page can be installed), and a reload that cuts
  // it off logs this as an error though the icon is fine; the first test downloads and decodes every icon instead
  const ICON_CUT = /^Error while trying to use the following icon from the Manifest: /;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (ICON_CUT.test(m.text())) t.diagnostic(m.text()); else errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  // a phone kept from an earlier run starts from the defaults. The reload that follows waits for Chrome's download of
  // the manifest: a reload cutting it off once had Chrome report "Manifest: Line: 1, column: 1, Syntax error." Chrome
  // doesn't always fetch it on load, though (3 of 7 CI runs timed out waiting), and then there is nothing to cut off
  const manifest = page.waitForEvent('requestfinished', { predicate: (r) => r.url().endsWith('/manifest.webmanifest'), timeout: 15000 })
    .catch(() => t.diagnostic('Chrome fetched no manifest on load'));
  await page.goto(local.url, { waitUntil: 'load' });
  await manifest;
  await page.evaluate(() => localStorage.clear());

  await t.test('the page loads in the phone layout, fits the width, with no console errors', async () => {
    await page.reload({ waitUntil: 'load' });
    await loadedOn(page);
    await page.getByRole('button', { name: 'Menu' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
    const b = await boardBox(page), w = await page.evaluate(() => window.innerWidth);
    assert.equal(b.n, 32, 'pieces on the board');
    assert.ok(b.x0 >= 0 && b.x0 + 8 * b.sq <= w + 1, `the board (${Math.round(8 * b.sq)} px) fits the ${w} px width`);
    await page.screenshot({ path: path.join(OUT, 'android-phone.png') });
    assert.deepEqual(errors, []);
    // each manifest icon downloads and decodes at its stated size
    const bad = await page.evaluate(async () => {
      const m = await (await fetch('manifest.webmanifest', { cache: 'no-store' })).json(), out = [];
      for (const ic of m.icons) {
        try { const im = await createImageBitmap(await (await fetch(ic.src, { cache: 'no-store' })).blob()); if (`${im.width}x${im.height}` !== ic.sizes) out.push(`${ic.src}: ${im.width}x${im.height}`); }
        catch (e) { out.push(`${ic.src}: ${e.message}`); }
      }
      return out;
    });
    assert.deepEqual(bad, [], 'manifest icons');
  });

  await t.test('a tap-tap move gets a Stockfish verdict', async () => {
    const b = await boardBox(page);
    for (const sq of ['e2', 'e4']) { const p = square(b, sq); await page.touchscreen.tap(p.x, p.y); }
    await page.getByText(/your move ·/i).waitFor({ timeout: 5000 });
    // the emulator runs the engine slowly
    await page.waitForFunction((re) => new RegExp(re, 'i').test(document.body.innerText), VERDICT.source, { timeout: 120000 });
    assert.doesNotMatch(await page.getByText(/your move ·/i).innerText(), /can’t run here|stopped/i);
    await page.screenshot({ path: path.join(OUT, 'android-own-move.png') });
    assert.deepEqual(errors, []);
  });

  await t.test('the menu opens, and its Full screen goes full screen and back', async () => {
    const menu = page.getByRole('button', { name: 'Menu' });
    await menu.tap();
    await page.getByRole('button', { name: 'Ask Queen' }).waitFor({ state: 'visible', timeout: 3000 });
    await page.getByRole('button', { name: 'Full screen', exact: true }).tap();
    await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 });
    // the browser's safe-area insets (the cut-out's strip, on a phone) beside the root's and the stage's padding
    const insets = () => page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement('div'));
      probe.style.cssText = 'position:fixed;top:0;left:0;width:calc(env(safe-area-inset-left,0px) + env(safe-area-inset-right,0px));height:env(safe-area-inset-top,0px)';
      const r = probe.getBoundingClientRect();
      probe.remove();
      const stage = document.querySelector('.stage'), cs = getComputedStyle(stage);
      return { top: r.height, sides: r.width, padding: getComputedStyle(document.documentElement).paddingTop, stageTop: stage.getBoundingClientRect().top, left: cs.paddingLeft, right: cs.paddingRight };
    });
    // upright in full screen the page runs under the camera's cut-out, with no gap kept for it, though the browser
    // reports one (the whole status-bar strip, on a phone)
    const up = await insets();
    t.diagnostic(`full screen: top inset ${up.top} px`);
    if (emulator) assert.ok(up.top > 0, 'the emulated cut-out reports no top inset');
    assert.equal(up.padding, '0px');
    assert.equal(up.stageTop, 0);
    await page.screenshot({ path: path.join(OUT, 'android-full-screen.png') });
    // held sideways the cut-out is a side's inset, and the stage keeps no wider margin on that side. Only an emulator
    // is turned (a real phone's rotation is its owner's setting)
    if (emulator) {
      const auto = await sh('settings get system accelerometer_rotation');
      await sh('settings put system accelerometer_rotation 0');
      await sh('settings put system user_rotation 1');
      try {
        await page.waitForFunction(() => innerWidth > innerHeight, null, { timeout: 10000 });
        await page.waitForTimeout(500); // the layout's resize
        const side = await insets();
        t.diagnostic(`full screen, sideways: side insets ${side.sides} px, stage padding ${side.left} / ${side.right}`);
        assert.ok(side.sides > 0, 'the emulated cut-out reports no side inset');
        assert.equal(side.left, side.right);
        await page.screenshot({ path: path.join(OUT, 'android-full-screen-sideways.png') });
      } finally {
        await sh('settings put system user_rotation 0');
        await sh(`settings put system accelerometer_rotation ${auto === '1' ? 1 : 0}`);
        await page.waitForFunction(() => innerWidth < innerHeight, null, { timeout: 10000 });
      }
    }
    await menu.tap();
    await page.getByRole('button', { name: 'Exit full screen' }).tap();
    await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 });
  });

  await t.test('the service worker takes over the page', async () => {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30000 });
    assert.deepEqual(errors, []);
  });
});
