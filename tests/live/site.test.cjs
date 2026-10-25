// Smoke tests for the deployed site, in Chromium and Firefox. Not part of tests/*.test.cjs, so deploy builds never
// hit the network:
//   node --test tests/live/site.test.cjs
// LIVE_URLS: comma-separated sites to test (default: the Render site); `local` builds this checkout and serves
// out/site the way render.yaml has Render serve it (serve.cjs), which is what GitHub Actions tests.
// LIVE_BROWSERS: any of chromium, firefox (the two are the default) and webkit, run one after the other. WebKit is
// Playwright's own build (`npx playwright install --with-deps webkit`), the engine of iPhone Safari: its phone tests
// get the iPhone 13's user agent, pixel ratio and touch.
// CHROMIUM_PATH / CHROMIUM_CHANNEL pick the Chromium (default: the ungoogled-chromium flatpak where it is installed,
// else Playwright's own); FIREFOX_PATH the Firefox (default: Firefox Developer Edition, else /usr/bin/firefox),
// driven over WebDriver BiDi, so any stock Firefox works without a Playwright build of it; FIREFOX_PATH=playwright
// runs Playwright's own Firefox build instead (machines with no stock Firefox).
// LIVE_CDN_DIR: for sandboxes that block cdnjs, a folder holding the react and react-dom 18.3.1 npm packages
// (<dir>/react/package/umd/…); the page's React requests are answered from it.
// On a Claude Code cloud machine (CCR_AGENT_PROXY_ENABLED) HTTPS goes through a proxy whose CA Playwright's Firefox
// doesn't trust (its own store), so cdnjs, Google Fonts and the service worker's fetches failed: its contexts there skip
// certificate checks (Chromium's still check, so a run against the live site still catches a bad certificate).
// Needs Playwright (global install is fine). Screenshots go to tests/out/live/.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, execSync } = require('child_process');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const pw = (() => { try { return require('playwright'); } catch (e) { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } })();
const { serve } = require('./serve.cjs');
const { loadedOn, boardBox, square } = require('./board.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tests', 'out', 'live');
const SITES = (process.env.LIVE_URLS || 'https://chess-replay.onrender.com/').split(',').map((u) => u.trim()).map((u) => (u === 'local' ? u : u.replace(/\/?$/, '/')));
const BROWSERS = (process.env.LIVE_BROWSERS || 'chromium,firefox').split(',').map((b) => b.trim());
// LIVE_ONLY: a regular expression; only the subtests whose names match it run (node's name patterns can't reach them)
const ONLY = process.env.LIVE_ONLY ? new RegExp(process.env.LIVE_ONLY) : null;
const PAGE = 'chess-game-video.html';
const SF = 'stockfish-19-lite-single';
const PROXY_CA = !!process.env.CCR_AGENT_PROXY_ENABLED;
const firstFile = (...files) => files.find((f) => f && fs.existsSync(f));
const LAUNCH = {
  chromium: () => pw.chromium.launch({ channel: process.env.CHROMIUM_CHANNEL, executablePath: process.env.CHROMIUM_PATH || firstFile('/var/lib/flatpak/exports/bin/io.github.ungoogled_software.ungoogled_chromium') }),
  firefox: () => process.env.FIREFOX_PATH === 'playwright' ? pw.firefox.launch() : pw.firefox.launch({ channel: 'moz-firefox', executablePath: process.env.FIREFOX_PATH || firstFile('/usr/bin/firefox-devedition', '/usr/bin/firefox') }),
  webkit: () => pw.webkit.launch(),
};
const IPHONE = { userAgent: pw.devices['iPhone 13'].userAgent, deviceScaleFactor: pw.devices['iPhone 13'].deviceScaleFactor };

let built, local = null;
test.before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  built = fs.readFileSync(path.join(ROOT, 'out', 'site', PAGE), 'utf8');
  if (SITES.includes('local')) local = await serve(path.join(ROOT, 'out', 'site'));
});
test.after(() => local && local.close());

async function open(browser, viewport, opts) {
  const ctx = await browser.newContext({ viewport, ...(PROXY_CA && browser.browserType().name() === 'firefox' ? { ignoreHTTPSErrors: true } : {}), ...opts });
  const cdn = process.env.LIVE_CDN_DIR;
  if (cdn) await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/**', (r) => {
    const m = r.request().url().match(/\/(react|react-dom)\/18\.3\.1\/umd\/([\w.-]+)$/);
    return m ? r.fulfill({ path: path.join(cdn, m[1], 'package', 'umd', m[2]), contentType: 'text/javascript' }) : r.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  // where an error came from, so a failure in CI says which file. WebKit reports a reload that cuts off an engine worker
  // still loading as errors: the wasm fetch "due to access control checks", and unhandled rejections raised in
  // stockfish.js's glue, whose wording varies ("Load failed", "Maximum call stack size exceeded"). Those are left out
  // there: the page did nothing wrong, and an engine that really can't load fails the tests of its verdicts
  const cutOff = (m) => browser.browserType().name() === 'webkit' && (/^Fetch API cannot load \S+\/stockfish-[\w-]+\.wasm due to access control checks\.$/.test(m.text()) || (/^Unhandled Promise Rejection: /.test(m.text()) && /\/stockfish-[\w-]+\.js$/.test(m.location().url)));
  page.on('console', (m) => { if (m.type() === 'error' && !cutOff(m)) errors.push(m.text() + (m.location().url ? ` (${m.location().url}:${m.location().lineNumber})` : '')); });
  page.on('pageerror', (e) => errors.push(e.message + (e.stack ? ' ' + e.stack.split('\n').slice(0, 3).join(' | ') : '')));
  return { ctx, page, errors };
}
// the elements reaching past the window's right edge, when the page scrolls sideways (none when it doesn't)
const wider = (page) => page.evaluate(() => {
  if (document.documentElement.scrollWidth <= window.innerWidth) return [];
  const w = window.innerWidth, out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.right > w + 0.5 && r.width > 0 && !(el.parentElement && el.parentElement.getBoundingClientRect().right > w + 0.5)) out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} ${Math.round(r.left)}–${Math.round(r.right)}`);
  }
  return [`scrollWidth ${document.documentElement.scrollWidth} > ${w}`, ...out.slice(0, 8)];
});
// A FEN typed into Edit position's FEN field with the keyboard, as a person would: with locator.fill(), the Paste FEN
// dialog this replaced stayed open in GitHub Actions' stock Firefox (WebDriver BiDi), as if the page never saw the text
async function typeFen(field, fen) {
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.press('Backspace');
  await field.pressSequentially(fen);
  assert.equal(await field.inputValue(), fen, 'the FEN is in the field');
}
// Play/Explore › Edit position…, a FEN typed in, Done: the free board at that position
async function setUpFen(page, fen) {
  await page.getByRole('button', { name: 'Play/Explore' }).click();
  await page.getByRole('button', { name: 'Edit position…' }).click();
  const field = page.getByRole('textbox', { name: 'FEN' });
  await typeFen(field, fen);
  await page.getByRole('button', { name: 'Done' }).click();
  await field.waitFor({ state: 'detached', timeout: 5000 });
}

for (const name of BROWSERS) for (const site of SITES) {
  test(`${name} · ${site === 'local' ? 'local build' : new URL(site).host}`, async (t) => {
    const base = site === 'local' ? local.url : site, host = name + '-' + (site === 'local' ? 'local' : new URL(site).host);
    // a phone's context options: Firefox has no mobile emulation in Playwright, so there it gets `other`
    const phone = (other) => (name === 'firefox' ? other : { isMobile: true, hasTouch: true, ...(name === 'webkit' ? IPHONE : {}) });
    // one browser at a time, closed before the next starts
    if (ONLY) { const sub = t.test.bind(t); t.test = (n, fn) => (ONLY.test(n) ? sub(n, fn) : sub(n, { skip: 'LIVE_ONLY' }, fn)); }
    const browser = await LAUNCH[name]();
    t.after(() => browser.close());
    const { ctx, page, errors } = await open(browser, { width: 1440, height: 900 });
    // requests go through the page (same origin), so they take the browser's network path and proxy
    const get = (p) => page.evaluate(async (u) => {
      const r = await fetch(u, { cache: 'no-store' });
      const buf = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, type: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '', text: new TextDecoder().decode(buf), sha: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map((x) => x.toString(16).padStart(2, '0')).join('') };
    }, base + p);
    // the page has rendered and the board has its pieces
    const loaded = async () => { await page.locator('.dock-primary').waitFor({ state: 'attached' }); await page.waitForFunction(() => document.querySelectorAll('img').length >= 32); };

    await t.test('desktop: the sample game loads with no console errors', async () => {
      await page.goto(base, { waitUntil: 'load' });
      await loaded();
      const b = await boardBox(page);
      assert.equal(b.n, 32, 'pieces on the board');
      assert.ok(Math.abs(b.h - 8 * b.sq) < 4, 'the board is square');
      await page.screenshot({ path: path.join(OUT, host + '-desktop.png') });
      assert.deepEqual(errors, []);
    });

    await t.test('the bare domain and the page file both serve the page, revalidated on every visit', async () => {
      for (const p of ['', PAGE]) {
        const r = await get(p);
        assert.equal(r.status, 200, p || '/');
        assert.match(r.type, /text\/html/);
        assert.match(r.cache, /max-age=0.*must-revalidate/, (p || '/') + ' Cache-Control');
        assert.match(r.text, /window\.TWEAK_DEFAULTS/);
      }
    });

    await t.test('the Stockfish files are served next to the page', async () => {
      const js = await get(SF + '.js'), wasm = await get(SF + '.wasm');
      assert.equal(js.status, 200);
      assert.equal(wasm.status, 200);
      assert.match(wasm.type, /application\/wasm/);
      assert.equal(wasm.sha, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'vendor', SF + '.wasm'))).digest('hex'));
    });

    await t.test('the live page against a local build of this checkout', async () => {
      const live = (await get(PAGE)).text;
      t.diagnostic(base + (live === built ? ': same as this checkout' : ': differs from this checkout (deploy not published yet, or the checkout is ahead)'));
    });

    await t.test('desktop: Next and Previous step through the moves', async () => {
      const label = page.locator('.plabel'), home = page.getByRole('button', { name: 'Back to start (Home)' });
      // Home is disabled at the start position, so it is clicked only if a step left the board elsewhere
      if (await home.isEnabled()) await home.click();
      await assert.doesNotReject(label.filter({ hasText: 'Start' }).waitFor({ timeout: 5000 }));
      assert.ok(await home.isDisabled(), 'Home is disabled at the start');
      await page.getByRole('button', { name: 'Next move (→)' }).click();
      await assert.doesNotReject(label.filter({ hasText: /^1\.\s*\S/ }).waitFor({ timeout: 5000 }));
      assert.ok(await home.isEnabled(), 'Home is enabled after a move');
      await page.getByRole('button', { name: 'Previous move (←)' }).click();
      await assert.doesNotReject(label.filter({ hasText: 'Start' }).waitFor({ timeout: 5000 }));
      assert.ok(await home.isDisabled(), 'Home is disabled back at the start');
    });

    await t.test('desktop: an own move gets a Stockfish verdict', async () => {
      const b = await boardBox(page);
      const from = square(b, 'e2'), to = square(b, 'e4');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      // the panel's text is upper-cased by CSS, so innerText reads it that way
      const panel = page.getByText(/your move ·/i);
      await panel.waitFor({ timeout: 5000 });
      await page.waitForFunction(() => /your move · .*(stockfish’s choice|cp vs|as good as|can’t run here|stopped)/i.test(document.body.innerText), null, { timeout: 45000 });
      const text = await panel.innerText();
      assert.doesNotMatch(text, /can’t run here|stopped/i, text);
      await page.screenshot({ path: path.join(OUT, host + '-own-move.png') });
      assert.deepEqual(errors, []);
    });

    await t.test('desktop: a changed setting survives a reload', async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      // the tabs, and the arrow keys moving between them
      const tabs = page.getByRole('tablist', { name: 'Settings' }).getByRole('tab');
      assert.deepEqual(await tabs.allInnerTexts(), ['Game', 'View', 'Engine', 'Commentary', 'Export', 'Sound']);
      await tabs.first().focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByRole('tab', { name: 'View' }).getAttribute('aria-selected'), 'true');
      await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click();
      await page.reload({ waitUntil: 'load' });
      await loaded();
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-scheme')), 'dark');
    });

    await t.test('desktop: Space presses a focused button rather than playing, and Esc closes the panel', async () => {
      await page.getByRole('button', { name: 'Settings' }).focus();
      await page.keyboard.press('Space');
      const settings = page.getByRole('complementary', { name: 'Settings' });
      await assert.doesNotReject(settings.waitFor({ timeout: 3000 }));
      assert.equal(await page.getByRole('button', { name: 'Pause (space)' }).count(), 0, 'Space started playback');
      await page.keyboard.press('Escape');
      await assert.doesNotReject(settings.waitFor({ state: 'detached', timeout: 3000 }));
    });

    await t.test('desktop: Esc closes the Queen panel', async () => {
      await page.getByRole('button', { name: 'Ask Queen' }).click();
      const queen = page.locator('.q-panel');
      await queen.waitFor({ timeout: 3000 });
      await page.keyboard.press('Escape');
      await assert.doesNotReject(queen.waitFor({ state: 'detached', timeout: 3000 }));
    });

    await t.test('desktop: the playhead takes the arrow keys, and the Moves panel is one Tab stop', async () => {
      const head = page.getByRole('slider', { name: 'Playhead' });
      await head.focus();
      await page.keyboard.press('End');
      assert.equal(await head.getAttribute('aria-valuenow'), await head.getAttribute('aria-valuemax'));
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      assert.equal(await head.getAttribute('aria-valuenow'), '1');
      assert.match(await head.getAttribute('aria-valuetext'), /^1 second of \d+ minutes? /);
      assert.equal(await page.locator('[data-ply][tabindex="0"]').count(), 1, 'Tab stops in the Moves panel');
      await page.locator('[data-ply="0"]').focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.ply === '1', null, { timeout: 3000 });
      await assert.doesNotReject(page.locator('.plabel').filter({ hasText: /^1…/ }).waitFor({ timeout: 3000 }));
    });

    // the Moves panel scrolls like the opening explorer: a mouse drag scrolls it, selects nothing and picks no move
    await t.test('desktop: the Moves panel scrolls with the wheel and a mouse drag', async () => {
      const list = page.locator('.moves-list'), top = () => list.evaluate((el) => el.scrollTop);
      // a move short of the end, where the result card covers the stage
      await page.locator('[data-ply][tabindex="0"]').focus();
      await page.keyboard.press('End');
      // focus follows on the next frame: an arrow pressed before it would step from the move before
      await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.ply === String(document.querySelectorAll('[data-ply]').length - 1), null, { timeout: 3000 });
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() => document.querySelector('.moves-list').scrollTop > 100, null, { timeout: 3000 });
      const at = await page.locator('.plabel').innerText(), end = await top();
      const r = await list.boundingBox();
      await page.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.9, { steps: 8 });
      await page.mouse.up();
      assert.ok(await top() < end - 100, 'the drag scrolled the list up');
      assert.equal(await page.evaluate(() => String(window.getSelection())), '', 'no text selected');
      assert.equal(await page.locator('.plabel').innerText(), at, 'the drag picked no move');
      // let go while moving, the list glides on: wait until it stops
      let dragged = await top();
      for (let i = 0; i < 40; i++) { await page.waitForTimeout(100); const now = await top(); if (now === dragged) break; dragged = now; }
      assert.ok(dragged < end - 100, 'the glide left the list scrolled up');
      await page.mouse.wheel(0, 120);
      await page.waitForFunction((d) => document.querySelector('.moves-list').scrollTop > d, dragged, { timeout: 3000 });
      await page.locator('[data-ply="0"]').click();
      await assert.doesNotReject(page.locator('.plabel').filter({ hasText: /^1\. / }).waitFor({ timeout: 3000 }));
      assert.equal(await top(), 0, 'the first move scrolled the list to its top');
    });

    // Playwright can't drag a file in with the mouse, so this one dispatches the drag event
    await t.test('desktop: a file dragged over the page gets the drop overlay over the whole page', async () => {
      const files = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['1. e4 *'], 'game.pgn')); return d; });
      await page.dispatchEvent('body', 'dragover', { dataTransfer: files });
      const box = await page.locator('.drop').boundingBox();
      assert.deepEqual(box, { x: 0, y: 0, width: 1440, height: 900 });
      assert.equal(await page.locator('.drop').evaluate((e) => getComputedStyle(e).position), 'fixed');
    });
    await t.test('desktop: the dock toggles full screen, and hides the item where the browser can’t', async () => {
      await page.getByRole('button', { name: 'Full screen', exact: true }).click();
      await page.waitForFunction(() => document.documentElement === document.fullscreenElement, null, { timeout: 3000 });
      await page.getByRole('button', { name: 'Exit full screen' }).click();
      await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 3000 });
      // as on iPhone Safari, or in a frame without allow="fullscreen"
      const off = await open(browser, { width: 1440, height: 900 });
      await off.ctx.addInitScript(() => { for (const k of ['fullscreenEnabled', 'webkitFullscreenEnabled']) Object.defineProperty(Document.prototype, k, { get: () => false }); });
      await off.page.goto(base, { waitUntil: 'load' });
      await off.page.locator('.dock-primary').waitFor();
      assert.equal(await off.page.getByRole('button', { name: /full screen/i }).count(), 0);
      await off.ctx.close();
    });

    await t.test('the web app manifest and its icons are served', async () => {
      const m = await get('manifest.webmanifest');
      assert.equal(m.status, 200);
      for (const ic of JSON.parse(m.text).icons.concat({ src: 'apple-touch-icon.png' })) {
        const r = await get(ic.src);
        assert.equal(r.status, 200, ic.src);
        assert.match(r.type, /image\/png/, ic.src);
      }
    });
    // a pawn reaching the last rank asks for its piece: Esc takes the move back, a click on the column picks one
    await t.test('desktop: an own promotion offers the four pieces', async () => {
      const pr = await open(browser, { width: 1440, height: 900 });
      await pr.page.goto(base, { waitUntil: 'load' });
      await pr.page.locator('.dock-primary').waitFor();
      await pr.page.setInputFiles('#game-files', { name: 'promo.pgn', mimeType: 'text/plain', buffer: Buffer.from('1. e4 d5 2. exd5 c6 3. dxc6 Qd6 4. cxb7 Qd5 *') });
      await pr.page.waitForFunction(() => /Qd5/.test(document.body.innerText), null, { timeout: 10000 });
      await pr.page.keyboard.press('End');
      await assert.doesNotReject(pr.page.locator('.plabel').filter({ hasText: /Qd5/ }).waitFor({ timeout: 5000 }));
      const b = await boardBox(pr.page), drag = async () => {
        const from = square(b, 'b7'), to = square(b, 'a8');
        await pr.page.mouse.move(from.x, from.y);
        await pr.page.mouse.down();
        await pr.page.mouse.move(to.x, to.y, { steps: 8 });
        await pr.page.mouse.up();
      };
      const picker = pr.page.getByRole('button', { name: /^Promote to / });
      await drag();
      assert.deepEqual(await picker.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['Promote to queen', 'Promote to knight', 'Promote to rook', 'Promote to bishop']);
      await pr.page.screenshot({ path: path.join(OUT, host + '-promotion.png') });
      await pr.page.keyboard.press('Escape');
      assert.equal(await picker.count(), 0, 'Esc closes the picker');
      // the label follows a render later, so it is waited for rather than read at once
      await assert.doesNotReject(pr.page.locator('.plabel').filter({ hasText: /Qd5/ }).waitFor({ timeout: 5000 }), 'and plays nothing');
      await drag();
      const knight = square(b, 'a7'); // the column runs down from a8: queen, knight, rook, bishop
      await pr.page.mouse.click(knight.x, knight.y);
      await assert.doesNotReject(pr.page.locator('.plabel').filter({ hasText: /bxa8=N/ }).waitFor({ timeout: 5000 }));
      assert.equal(await picker.count(), 0);
      assert.deepEqual(pr.errors, []);
      await pr.ctx.close();
    });
    // Flip board turns every square→pixel conversion: pieces, the eval bar, the player bars, and the pointer input
    await t.test('desktop: Flip board turns the board and keeps moves under the pointer', async () => {
      const fl = await open(browser, { width: 1440, height: 900 });
      const top = (sel) => fl.page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, sel);
      // the white king's image above the black king's: the kings are the only pieces on e1/e8 at the start
      const kings = () => fl.page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.src === window.PIECE_IMG.wK || i.src === window.PIECE_IMG.bK).map((i) => ({ white: i.src === window.PIECE_IMG.wK, top: i.getBoundingClientRect().top })).filter((o, i, all) => all.findIndex((q) => q.white === o.white) === i));
      await fl.page.goto(base, { waitUntil: 'load' });
      await fl.page.locator('.dock-primary').waitFor();
      await fl.page.waitForFunction(() => document.querySelectorAll('img').length >= 32);
      const before = await kings();
      assert.equal(before.length, 2, 'two kings found: ' + JSON.stringify(before));
      await fl.page.getByRole('button', { name: 'Settings' }).click();
      await fl.page.getByRole('tab', { name: 'View' }).click();
      const sw = fl.page.getByRole('switch', { name: 'Flip board' });
      await sw.click();
      assert.equal(await sw.getAttribute('aria-checked'), 'true');
      await fl.page.getByRole('button', { name: 'Close settings' }).click();
      const wk = (ks) => ks.find((k) => k.white).top, bk = (ks) => ks.find((k) => !k.white).top;
      const after = await kings();
      assert.ok(wk(before) > bk(before), 'white king at the bottom by default');
      assert.ok(wk(after) < bk(after), 'white king above the black king when flipped');
      // the sample game's players; the player bars' names are the 20 px ones (the header's are 40 px)
      const bars = await fl.page.evaluate(() => {
        const t = (re) => [...document.querySelectorAll('span')].filter((e) => re.test(e.textContent) && e.children.length === 0 && getComputedStyle(e).fontSize === '20px').map((e) => e.getBoundingClientRect().top);
        return { white: t(/^Carlsen/), black: t(/^Nepomniachtchi/) };
      });
      assert.ok(bars.white.length && bars.black.length, 'player bars found: ' + JSON.stringify(bars));
      const bt = await boardBox(fl.page);
      assert.ok(Math.min(...bars.white) < bt.y0, 'the White bar is above the board');
      assert.ok(Math.min(...bars.black) > bt.y0 + bt.h - 1, 'the Black bar is below the board');
      // the eval bar's white part is at its top
      const white = await fl.page.evaluate((b) => {
        const bar = [...document.querySelectorAll('div')].find((d) => { const r = d.getBoundingClientRect(); return Math.abs(r.width - 36 * b.sq / 100) < 1.5 && Math.abs(r.height - b.h) < 2 && getComputedStyle(d).overflow === 'hidden'; });
        if (!bar) return null;
        const w = [...bar.children].find((c) => getComputedStyle(c).backgroundColor === 'rgb(255, 255, 255)'), br = bar.getBoundingClientRect(), wr = w.getBoundingClientRect();
        return { top: wr.top - br.top, bottom: br.bottom - wr.bottom };
      }, bt);
      assert.ok(white && white.top < 2 && white.bottom > 2, 'eval bar fills White from the top: ' + JSON.stringify(white));
      const b = await boardBox(fl.page);
      const from = square(b, 'e2', true), to = square(b, 'e4', true);
      await fl.page.mouse.move(from.x, from.y);
      await fl.page.mouse.down();
      await fl.page.mouse.move(to.x, to.y, { steps: 8 });
      await fl.page.mouse.up();
      await assert.doesNotReject(fl.page.locator('.plabel').filter({ hasText: /You 1\. e4/ }).waitFor({ timeout: 5000 }));
      await fl.page.screenshot({ path: path.join(OUT, host + '-flipped.png') });
      // the flip is remembered
      await fl.page.reload({ waitUntil: 'load' });
      await fl.page.locator('.dock-primary').waitFor();
      await fl.page.waitForFunction(() => document.querySelectorAll('img').length >= 32);
      const again = await kings();
      assert.ok(wk(again) < bk(again), 'still flipped after a reload');
      // F flips back
      await fl.page.mouse.click(5, 5);
      await fl.page.keyboard.press('f');
      const back = await kings();
      assert.ok(wk(back) > bk(back), 'F unflips');
      await fl.page.keyboard.press('f');
      // the promotion picker runs from a8 towards the middle as seen: up the screen
      await fl.page.setInputFiles('#game-files', { name: 'promo.pgn', mimeType: 'text/plain', buffer: Buffer.from('1. e4 d5 2. exd5 c6 3. dxc6 Qd6 4. cxb7 Qd5 *') });
      await fl.page.waitForFunction(() => /Qd5/.test(document.body.innerText), null, { timeout: 10000 });
      await fl.page.keyboard.press('End');
      await assert.doesNotReject(fl.page.locator('.plabel').filter({ hasText: /Qd5/ }).waitFor({ timeout: 5000 }));
      const pb = await boardBox(fl.page), pf = square(pb, 'b7', true), pt = square(pb, 'a8', true);
      await fl.page.mouse.move(pf.x, pf.y);
      await fl.page.mouse.down();
      await fl.page.mouse.move(pt.x, pt.y, { steps: 8 });
      await fl.page.mouse.up();
      const tops = await fl.page.getByRole('button', { name: /^Promote to / }).evaluateAll((els) => els.map((e) => [e.getAttribute('aria-label'), e.getBoundingClientRect().top]));
      assert.deepEqual(tops.map((x) => x[0]), ['Promote to queen', 'Promote to knight', 'Promote to rook', 'Promote to bishop']);
      assert.ok(tops[0][1] > tops[1][1] && tops[1][1] > tops[2][1] && tops[2][1] > tops[3][1], 'queen lowest, bishop highest: ' + JSON.stringify(tops));
      await fl.page.keyboard.press('Escape');
      await fl.page.keyboard.press('f'); // leave nothing flipped behind
      assert.deepEqual(fl.errors, []);
      await fl.ctx.close();
    });
    await t.test('phone: a flipped board fits the width', async () => {
      const ph = await open(browser, { width: 390, height: 844 }, phone({ hasTouch: true }));
      await ph.page.addInitScript(() => { try { localStorage.setItem('chess-video.tweaks.v1', JSON.stringify({ flip: true })); } catch (e) {} });
      await ph.page.goto(base, { waitUntil: 'load' });
      await ph.page.getByRole('button', { name: 'Menu' }).waitFor();
      assert.equal((await boardBox(ph.page)).n, 32);
      await ph.page.screenshot({ path: path.join(OUT, host + '-flipped-phone.png') });
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
    // a game from a FEN with Black to move: pieces from that position, numbering from move 3, own moves continue the count
    await t.test('desktop: a game from a FEN with Black to move replays and takes own moves', async () => {
      const fp = await open(browser, { width: 1440, height: 900 });
      await fp.page.goto(base, { waitUntil: 'load' });
      await fp.page.locator('.dock-primary').waitFor();
      const pgn = '[SetUp "1"]\n[FEN "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 3"]\n\n3... Nf6 4. Nc3 Bc5 *';
      await fp.page.setInputFiles('#game-files', { name: 'fen.pgn', mimeType: 'text/plain', buffer: Buffer.from(pgn) });
      await fp.page.waitForFunction(() => /Bc5/.test(document.body.innerText), null, { timeout: 10000 });
      await fp.page.keyboard.press('End');
      await assert.doesNotReject(fp.page.locator('.plabel').filter({ hasText: /4… Bc5/ }).waitFor({ timeout: 5000 }));
      const b = await boardBox(fp.page);
      assert.equal(b.n, 32);
      const moves = await fp.page.locator('[data-ply="0"]').evaluate((el) => el.parentElement.parentElement.parentElement.innerText);
      assert.match(moves, /3\.\s*…\s*Nf6\s*4\.\s*Nc3\s*Bc5/);
      const from = square(b, 'd2'), to = square(b, 'd3');
      await fp.page.mouse.move(from.x, from.y);
      await fp.page.mouse.down();
      await fp.page.mouse.move(to.x, to.y, { steps: 8 });
      await fp.page.mouse.up();
      await assert.doesNotReject(fp.page.locator('.plabel').filter({ hasText: /5\. d3/ }).waitFor({ timeout: 5000 }));
      await fp.page.screenshot({ path: path.join(OUT, host + '-fen-start.png') });
      assert.deepEqual(fp.errors, []);
      await fp.ctx.close();
    });
    // a landscape window under 1300 px wide gets the compact frame (1800×1040, slimmer stage padding); 1300 and up the 1920×1080 one
    await t.test('desktop: under 1300 px wide the landscape frame is the compact one', async () => {
      const cp = await open(browser, { width: 1280, height: 800 });
      await cp.page.goto(base, { waitUntil: 'load' });
      await cp.page.locator('.dock-primary').waitFor({ state: 'attached' });
      await cp.page.waitForFunction(() => document.querySelectorAll('img').length >= 32);
      const frame = () => cp.page.evaluate(() => {
        const st = document.querySelector('.stage'), f = document.querySelector('.stage-frame'), r = f.getBoundingClientRect();
        return { compact: st.classList.contains('stage-compact'), size: f.firstElementChild.style.width + ' ' + f.firstElementChild.style.height, fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
      });
      assert.deepEqual(await frame(), { compact: true, size: '1800px 1040px', fits: true });
      assert.deepEqual(await wider(cp.page), []);
      const b = await boardBox(cp.page);
      assert.equal(b.n, 32);
      assert.ok(Math.abs(b.h - 8 * b.sq) < 4, 'the board is square');
      await cp.page.screenshot({ path: path.join(OUT, host + '-compact.png') });
      await cp.page.setViewportSize({ width: 1300, height: 800 });
      await assert.doesNotReject(cp.page.waitForFunction(() => !document.querySelector('.stage').classList.contains('stage-compact'), null, { timeout: 5000 }));
      assert.deepEqual(await frame(), { compact: false, size: '1920px 1080px', fits: true });
      assert.deepEqual(cp.errors, []);
      await cp.ctx.close();
    });
    // Play/Explore → Starting position: no game, every move (either side's) rated by Stockfish; it survives a reload
    // Settings › Engine › Lines 3: the free board's Analysis lists three lines, each with its arrow
    await t.test('desktop: Lines 3 shows three engine lines and three arrows on the free board', async () => {
      const nb = await open(browser, { width: 1440, height: 900 });
      const p = nb.page;
      await p.addInitScript(() => { try { localStorage.setItem('chess-video.tweaks.v1', JSON.stringify({ sfLines: 3, sfOwnTime: 1.5 })); } catch (e) {} });
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Starting position' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      const b = await boardBox(p);
      const f = square(b, 'e2'), tt = square(b, 'e4');
      await p.mouse.move(f.x, f.y); await p.mouse.down(); await p.mouse.move(tt.x, tt.y, { steps: 8 }); await p.mouse.up();
      // three rows, each an eval then Black's first move; and the arrows of the three first moves
      const rows = () => p.evaluate(() => (document.body.innerText.match(/^[+−]?\d+\.\d\d( d\d+)?\s+1…/gm) || []).length);
      await p.waitForFunction(() => (document.body.innerText.match(/^[+−]?\d+\.\d\d( d\d+)?\s+1…/gm) || []).length === 3 && document.querySelectorAll('svg polygon').length === 3, null, { timeout: 45000 });
      assert.equal(await rows(), 3);
      await p.screenshot({ path: path.join(OUT, host + '-board-lines.png') });
      await p.getByRole('button', { name: 'Settings' }).click();
      await p.getByRole('tab', { name: 'Engine' }).click();
      assert.equal(await p.locator('#tw-sf-lines').inputValue(), '3');
      assert.deepEqual(nb.errors, []);
      await nb.ctx.close();
    });

    await t.test('desktop: the free board sets up the starting position and rates both sides\' moves', async () => {
      const nb = await open(browser, { width: 1440, height: 900 });
      const p = nb.page, label = p.locator('.plabel');
      // a panel's text, found by its title (the title span's own text, before CSS upper-cases it; the upper-casing keeps the header's event row out)
      const panel = (title) => p.evaluate((tt) => { const d = [...document.querySelectorAll('div')].find((e) => e.firstElementChild && e.firstElementChild.firstElementChild && e.firstElementChild.firstElementChild.textContent === tt && getComputedStyle(e.firstElementChild).textTransform === 'uppercase'); return d ? d.innerText : ''; }, title);
      // the Analysis headline: the move it rates
      const headline = () => p.evaluate(() => { const s = [...document.querySelectorAll('span')].find((e) => getComputedStyle(e).fontSize === '38px' && /^\d+(\.|…) /.test(e.textContent)); return s ? s.textContent : null; });
      const verdict = /your move · .*(stockfish’s choice|cp vs|as good as|can’t run here|stopped)/i;
      const drag = async (b, from, to) => {
        const f = square(b, from), tt = square(b, to);
        await p.mouse.move(f.x, f.y);
        await p.mouse.down();
        await p.mouse.move(tt.x, tt.y, { steps: 8 });
        await p.mouse.up();
      };
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Starting position' }).click();
      // the sample's start reads "Start" too: the board is in once Play has gone
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      await assert.doesNotReject(label.filter({ hasText: /^Start$/ }).waitFor({ timeout: 5000 }));
      const b = await boardBox(p);
      assert.equal(b.n, 32, 'pieces on the board');
      assert.equal(await p.getByRole('button', { name: 'Ask Queen' }).count(), 0, 'no Ask Queen on the free board');
      assert.equal(await p.getByRole('button', { name: 'Starting position' }).count(), 0, 'the menu closes on a pick');
      await drag(b, 'e2', 'e4');
      await assert.doesNotReject(label.filter({ hasText: /1\. e4/ }).waitFor({ timeout: 5000 }));
      await p.waitForFunction((re) => new RegExp(re, 'i').test(document.body.innerText), verdict.source, { timeout: 45000 });
      assert.doesNotMatch(await panel('Analysis'), /can’t run here|stopped/i);
      // Black's move, by the same viewer
      await drag(b, 'e7', 'e5');
      await assert.doesNotReject(label.filter({ hasText: /1… e5/ }).waitFor({ timeout: 5000 }));
      // a move taken back while Stockfish still searches it: the panel rates the move shown, never the late answer
      await drag(b, 'g1', 'f3');
      await assert.doesNotReject(label.filter({ hasText: /2\. Nf3/ }).waitFor({ timeout: 5000 }));
      await p.keyboard.press('ArrowLeft');
      await assert.doesNotReject(label.filter({ hasText: /1… e5/ }).waitFor({ timeout: 5000 }));
      await p.waitForFunction((re) => new RegExp(re, 'i').test(document.body.innerText), verdict.source, { timeout: 45000 });
      await p.waitForTimeout(1500);
      assert.equal(await headline(), '1… e5');
      assert.match(await label.innerText(), /1… e5/);
      assert.match(await panel('Moves'), /1\.\s*e4\s*e5\s*2\.\s*Nf3/);
      await p.screenshot({ path: path.join(OUT, host + '-board.png') });
      // the board comes back after a reload, on the move shown
      await p.reload({ waitUntil: 'load' });
      await loadedOn(p);
      await assert.doesNotReject(label.filter({ hasText: /1… e5/ }).waitFor({ timeout: 5000 }));
      assert.match(await panel('Moves'), /1\.\s*e4\s*e5\s*2\.\s*Nf3/);
      assert.equal(await p.getByRole('button', { name: 'Ask Queen' }).count(), 0);
      // Back to sample game leaves the free board
      await p.getByRole('button', { name: 'Settings' }).click();
      await p.getByRole('button', { name: 'Back to sample game' }).click();
      await assert.doesNotReject(label.filter({ hasText: /^Start$/ }).waitFor({ timeout: 5000 }));
      await assert.doesNotReject(p.getByRole('button', { name: 'Ask Queen' }).waitFor({ timeout: 5000 }));
      assert.equal((await boardBox(p)).n, 32);
      assert.deepEqual(nb.errors, []);
      await nb.ctx.close();
      // the phone: Play/Explore's items sit in the folded menu under a label (Playwright's Firefox, given touch, drops
      // the mouse's drags, the replay's too; there it is a narrow window)
      const ph = await open(browser, { width: 390, height: 844 }, phone({}));
      await ph.page.goto(base, { waitUntil: 'load' });
      await ph.page.getByRole('button', { name: 'Menu' }).click();
      const start = ph.page.getByRole('button', { name: 'Starting position' });
      await start.waitFor({ state: 'visible', timeout: 3000 });
      await ph.page.screenshot({ path: path.join(OUT, host + '-board-phone-menu.png') });
      await start.click();
      await assert.doesNotReject(ph.page.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      await assert.doesNotReject(ph.page.locator('.plabel').filter({ hasText: /^Start$/ }).waitFor({ timeout: 5000 }));
      assert.deepEqual(await wider(ph.page), [], 'no sideways scroll');
      const pb = await boardBox(ph.page), pf = square(pb, 'e2'), pt = square(pb, 'e4');
      assert.equal(pb.n, 32);
      await ph.page.mouse.move(pf.x, pf.y);
      await ph.page.mouse.down();
      await ph.page.mouse.move(pt.x, pt.y, { steps: 8 });
      await ph.page.mouse.up();
      await assert.doesNotReject(ph.page.locator('.plabel').filter({ hasText: /1\. e4/ }).waitFor({ timeout: 5000 }));
      await ph.page.waitForFunction((re) => new RegExp(re, 'i').test(document.body.innerText), verdict.source, { timeout: 45000 });
      await ph.page.screenshot({ path: path.join(OUT, host + '-board-phone.png') });
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
    // Edit position: a typed FEN sets up the board, even an illegal one, whose problems the status line names; a
    // malformed one changes nothing; Done opens the free board at that position
    await t.test('desktop: Edit position sets up a pasted FEN, says what\'s wrong, and Done opens the free board', async () => {
      const ep = await open(browser, { width: 1440, height: 900 });
      const p = ep.page, status = p.getByRole('status').filter({ hasText: /king|turn|tray|check|pawn/ }), done = p.getByRole('button', { name: 'Done' });
      // the pieces on the board: the tray's are buttons
      const onBoard = () => p.evaluate(() => [...document.querySelectorAll('img')].filter((i) => !i.closest('button') && i.getBoundingClientRect().width > 10).length);
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Edit position…' }).click();
      const field = p.getByRole('textbox', { name: 'FEN' });
      await assert.doesNotReject(field.waitFor({ timeout: 5000 }));
      assert.equal(await field.inputValue(), '8/8/8/8/8/8/8/8 w - - 0 1', 'an empty board');
      assert.match(await status.innerText(), /Drag pieces from the tray, or tap one and then tap squares\./);
      assert.equal(await done.isDisabled(), true);
      await p.screenshot({ path: path.join(OUT, host + '-edit-empty.png') });
      await typeFen(field, '4k3/4R3/8/8/8/8/8/4K3 w - - 0 1');
      await assert.doesNotReject(status.filter({ hasText: "Black is in check, but it's White's turn." }).waitFor({ timeout: 5000 }));
      assert.equal(await done.isDisabled(), true);
      assert.equal(await onBoard(), 3, 'the illegal position is on the board');
      await p.screenshot({ path: path.join(OUT, host + '-edit-illegal.png') });
      await p.getByRole('combobox', { name: 'Side to move' }).selectOption('b');
      await p.waitForFunction(() => !/turn\./.test(document.body.innerText), null, { timeout: 5000 });
      assert.equal(await done.isDisabled(), false);
      assert.equal(await field.inputValue(), '4k3/4R3/8/8/8/8/8/4K3 b - - 0 1');
      // malformed text: a message, the board as it was
      await field.click();
      await field.press('ControlOrMeta+a');
      await field.pressSequentially('nonsense');
      await assert.doesNotReject(p.getByRole('alert').filter({ hasText: /isn't a FEN/ }).waitFor({ timeout: 5000 }));
      assert.equal(await onBoard(), 3);
      await typeFen(field, '4k3/4R3/8/8/8/8/8/4K3 b - - 0 1');
      await done.click();
      await assert.doesNotReject(field.waitFor({ state: 'detached', timeout: 5000 }));
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Copy FEN' }).click();
      await assert.doesNotReject(p.locator('.fen-note-fen').filter({ hasText: '4k3/4R3/8/8/8/8/8/4K3 b - - 0 1' }).waitFor({ timeout: 5000 }));
      assert.deepEqual(ep.errors, []);
      await ep.ctx.close();
    });
    await t.test('desktop: Edit position Start, Empty and castling boxes', async () => {
      const ep = await open(browser, { width: 1440, height: 900 });
      const p = ep.page;
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Edit position…' }).click();
      const field = p.getByRole('textbox', { name: 'FEN' }), box = (n) => p.getByRole('checkbox', { name: n, exact: true });
      await p.getByRole('button', { name: 'Start', exact: true }).click();
      assert.equal(await field.inputValue(), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      for (const n of ['White O-O', 'White O-O-O', 'Black O-O', 'Black O-O-O']) assert.equal(await box(n).isChecked(), true, n);
      await box('White O-O-O').uncheck();
      assert.equal(await field.inputValue(), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Kkq - 0 1');
      await typeFen(field, 'rnbqkbn1/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Kkq - 0 1');
      assert.equal(await box('Black O-O').isChecked(), false);
      assert.equal(await box('Black O-O').isDisabled(), true);
      assert.equal(await field.inputValue(), 'rnbqkbn1/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Kkq - 0 1', 'the field keeps what was typed');
      await p.getByRole('button', { name: 'Empty', exact: true }).click();
      assert.equal(await field.inputValue(), '8/8/8/8/8/8/8/8 w - - 0 1');
      assert.deepEqual(ep.errors, []);
      await ep.ctx.close();
    });
    // Cancel after leaving a game in progress: the game comes back with the time it had, the time away not charged
    await t.test('desktop: Cancel in Edit position returns to a timed game with its time left', async () => {
      const ep = await open(browser, { width: 1440, height: 900 });
      const p = ep.page;
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Play vs human…' }).click();
      const dialog = p.getByRole('dialog', { name: 'Play vs human' });
      await dialog.getByRole('radiogroup', { name: 'Time control' }).getByRole('radio', { name: '5+3' }).click();
      await dialog.getByRole('button', { name: 'Start game' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      const b = await boardBox(p), f = square(b, 'e2'), tt = square(b, 'e4');
      await p.mouse.move(f.x, f.y); await p.mouse.down(); await p.mouse.move(tt.x, tt.y, { steps: 8 }); await p.mouse.up();
      await p.waitForTimeout(1500);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Edit position…' }).click();
      await p.getByRole('button', { name: 'Leave' }).click();
      const clocks = async () => (await p.locator('.game-clock').allInnerTexts()).join(' ');
      const field = p.getByRole('textbox', { name: 'FEN' });
      await assert.doesNotReject(field.waitFor({ timeout: 5000 }));
      await p.waitForTimeout(2500);
      await p.keyboard.press('Escape');
      await assert.doesNotReject(field.waitFor({ state: 'detached', timeout: 5000 }));
      const back = await clocks();
      // Black had thought about 1.5 s before Edit position; 2.5 s more in the editor would read 4:5x or less
      assert.match(back, /5:0[0-3] 4:5[7-9]|4:5[7-9] 5:0[0-3]/, back);
      assert.deepEqual(ep.errors, []);
      await ep.ctx.close();
    });
    // the phone: Edit position in the folded menu, the tray right under the board and above the FEN field
    await t.test('phone: Edit position\'s tray sits under the board, and Done sets up the board', async () => {
      const ph = await open(browser, { width: 390, height: 844 }, phone({}));
      const p = ph.page;
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      const b = await boardBox(p);
      await p.getByRole('button', { name: 'Menu' }).click();
      await p.getByRole('button', { name: 'Edit position…' }).click();
      const field = p.getByRole('textbox', { name: 'FEN' });
      await assert.doesNotReject(field.waitFor({ timeout: 5000 }));
      const tray = await p.getByRole('group', { name: 'Pieces' }).boundingBox(), fb = await field.boundingBox();
      assert.ok(tray.y >= b.y0 + b.h - 2 && tray.y + tray.height <= fb.y, `tray ${tray.y}–${tray.y + tray.height}, board bottom ${b.y0 + b.h}, field ${fb.y}`);
      assert.deepEqual(await wider(p), [], 'no sideways scroll');
      await typeFen(field, '4k3/8/8/8/8/8/8/4K3 w - - 0 1');
      await p.screenshot({ path: path.join(OUT, host + '-edit-phone.png') });
      await p.getByRole('button', { name: 'Done' }).click();
      await assert.doesNotReject(field.waitFor({ state: 'detached', timeout: 5000 }));
      assert.equal((await boardBox(p)).n, 2);
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
    // editing by pointer, with real mouse input: tray pieces tapped then squares tapped, a tray piece dragged on, a piece
    // dragged off the board; Esc lets a held piece go before it cancels; a flipped board drops on the square under the pointer
    await t.test('desktop: Edit position places pieces by drag and by tap, removes them by dragging off', async () => {
      for (const flip of [false, true]) {
        const ep = await open(browser, { width: 1440, height: 900 });
        const p = ep.page;
        if (flip) await p.addInitScript(() => { try { localStorage.setItem('chess-video.tweaks.v1', JSON.stringify({ flip: true })); } catch (e) {} });
        await p.goto(base, { waitUntil: 'load' });
        await loadedOn(p);
        // the sample's board gives the squares (flipped too): the editor's board stands in the same place
        const b = await boardBox(p), sqAt = (s) => square(b, s, flip);
        await p.getByRole('button', { name: 'Play/Explore' }).click();
        await p.getByRole('button', { name: 'Edit position…' }).click();
        const field = p.getByRole('textbox', { name: 'FEN' }), tray = (n) => p.getByRole('button', { name: n, exact: true });
        await assert.doesNotReject(field.waitFor({ timeout: 5000 }));
        const tap = async (s) => { const c = sqAt(s); await p.mouse.click(c.x, c.y); };
        const dragTo = async (from, to) => { await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(to.x, to.y, { steps: 10 }); await p.mouse.up(); };
        const centre = async (loc) => { const r = await loc.boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
        await tray('White king').click(); await tap('e1');
        await tray('Black king').click(); await tap('e8');
        assert.equal(await tray('Black king').getAttribute('aria-pressed'), 'true');
        await p.keyboard.press('Escape');
        assert.equal(await tray('Black king').getAttribute('aria-pressed'), 'false', 'Esc lets the held piece go');
        assert.equal(await field.isVisible(), true, 'and the editor stays');
        await dragTo(await centre(tray('White rook')), sqAt('a1'));
        assert.equal(await field.inputValue(), '4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
        // off the board, past its left edge
        const a1 = sqAt('a1');
        await dragTo(a1, { x: b.x0 - 30, y: a1.y });
        assert.equal(await field.inputValue(), '4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'dragged off, the rook is gone');
        // a piece on the board dragged to another square moves
        await dragTo(sqAt('e1'), sqAt('d2'));
        assert.equal(await field.inputValue(), '4k3/8/8/8/8/8/3K4/8 w - - 0 1');
        // a held piece tapped on its own kind takes it away
        await tray('White king').click(); await tap('d2');
        assert.equal(await field.inputValue(), '4k3/8/8/8/8/8/8/8 w - - 0 1');
        await p.keyboard.press('Escape');
        await p.keyboard.press('Escape');
        await assert.doesNotReject(field.waitFor({ state: 'detached', timeout: 5000 }));
        assert.deepEqual(ep.errors, []);
        await ep.ctx.close();
      }
    });
    // the keyboard: a tray piece picked with Enter sends the focus to the board, whose square the arrows move (in the
    // board's turn, flipped too); Enter places, picks up and puts down, letters place pieces, Delete takes one away
    await t.test('desktop: Edit position by keyboard', async () => {
      for (const flip of [false, true]) {
        const ep = await open(browser, { width: 1440, height: 900 });
        const p = ep.page;
        if (flip) await p.addInitScript(() => { try { localStorage.setItem('chess-video.tweaks.v1', JSON.stringify({ flip: true })); } catch (e) {} });
        await p.goto(base, { waitUntil: 'load' });
        await loadedOn(p);
        await p.getByRole('button', { name: 'Play/Explore' }).click();
        await p.getByRole('button', { name: 'Edit position…' }).click();
        const field = p.getByRole('textbox', { name: 'FEN' }), tray = (n) => p.getByRole('button', { name: n, exact: true });
        await assert.doesNotReject(field.waitFor({ timeout: 5000 }));
        const key = async (k, n = 1) => { for (let i = 0; i < n; i++) await p.keyboard.press(k); };
        // the arrows as the viewer sees the board: Down is towards White's side unless flipped
        const down = flip ? 'ArrowUp' : 'ArrowDown', up = flip ? 'ArrowDown' : 'ArrowUp', left = flip ? 'ArrowRight' : 'ArrowLeft', right = flip ? 'ArrowLeft' : 'ArrowRight';
        await tray('White king').focus();
        await key('Enter');
        assert.equal(await tray('White king').getAttribute('aria-pressed'), 'true');
        assert.equal(await p.evaluate(() => document.activeElement.getAttribute('role')), 'application', 'the board has the focus');
        await key(down, 3); await key('Enter'); // e4 → e1
        assert.equal(await field.inputValue(), '8/8/8/8/8/8/8/4K3 w - - 0 1');
        await key('Escape');
        assert.equal(await tray('White king').getAttribute('aria-pressed'), 'false', 'Esc lets the held piece go');
        await key(up, 7); await key('k'); // e8
        await key(down, 7); await key('Enter'); await key(left); await key('Enter'); // the king e1 → d1
        assert.equal(await field.inputValue(), '4k3/8/8/8/8/8/8/3K4 w - - 0 1');
        await key('Enter'); await key('Escape'); // picked up, then put back down where it was
        assert.equal(await field.isVisible(), true, 'Esc with a piece picked up keeps the editor');
        await key(right); await key('Enter');
        assert.equal(await field.inputValue(), '4k3/8/8/8/8/8/8/3K4 w - - 0 1', 'nothing picked up any more: Enter on an empty square does nothing');
        await key('Q'); assert.equal(await field.inputValue(), '4k3/8/8/8/8/8/8/3KQ3 w - - 0 1');
        await key('Delete'); assert.equal(await field.inputValue(), '4k3/8/8/8/8/8/8/3K4 w - - 0 1');
        if (!flip) await p.screenshot({ path: path.join(OUT, host + '-edit-keyboard.png') });
        assert.deepEqual(ep.errors, []);
        await ep.ctx.close();
      }
    });
    await t.test('phone: Edit position places pieces by tap', async () => {
      const ph = await open(browser, { width: 390, height: 844 }, phone({}));
      const p = ph.page;
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Menu' }).click();
      await p.getByRole('button', { name: 'Edit position…' }).click();
      const field = p.getByRole('textbox', { name: 'FEN' });
      await assert.doesNotReject(field.waitFor({ timeout: 5000 }));
      // the editor's board is centred (no eval bar): its squares from its own box, the board's touch layer
      const eb = await p.locator('[title="Drag a piece to move it, or off the board to take it away"]').boundingBox();
      await p.getByRole('button', { name: 'White king', exact: true }).click();
      await p.mouse.click(eb.x + 4.5 * eb.width / 8, eb.y + 7.5 * eb.height / 8);
      assert.equal(await field.inputValue(), '8/8/8/8/8/8/8/4K3 w - - 0 1');
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
    // review fixes: Esc that closes Settings or the Play/Explore menu leaves the editor alone; an analysis finishing
    // meanwhile doesn't close it; a Stockfish reply made while the Leave dialog was up survives Leave and Cancel
    await t.test('desktop: Edit position survives Esc on an open menu and an analysis finishing', async () => {
      const ep = await open(browser, { width: 1440, height: 900 });
      const p = ep.page;
      await p.addInitScript(() => { try { localStorage.setItem('chess-video.tweaks.v1', JSON.stringify({ sfTime: 1 })); } catch (e) {} });
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      // a two-move game, analysed in a few seconds
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Paste PGN…' }).click();
      // typed, not filled: Firefox over WebDriver BiDi can miss fill()'s text (see typeFen)
      await p.getByRole('textbox', { name: 'PGN' }).click();
      await p.keyboard.type('1. e4 e5 *');
      await p.getByRole('button', { name: 'Load', exact: true }).click();
      await p.getByRole('button', { name: /^Analyse with Stockfish/ }).first().click();
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Edit position…' }).click();
      const field = p.getByRole('textbox', { name: 'FEN' });
      await assert.doesNotReject(field.waitFor({ timeout: 5000 }));
      await typeFen(field, '4k3/8/8/8/8/8/8/4K3 w - - 0 1');
      await p.getByRole('button', { name: 'Settings' }).click();
      await p.keyboard.press('Escape');
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.keyboard.press('Escape');
      assert.equal(await field.isVisible(), true, 'Esc closed the menus, not the editor');
      await p.waitForTimeout(8000);
      assert.equal(await field.inputValue(), '4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'the editor outlived the analysis');
      assert.deepEqual(ep.errors, []);
      await ep.ctx.close();
    });
    await t.test('desktop: Leaving a Stockfish game for Edit position keeps the reply made meanwhile', async () => {
      const ep = await open(browser, { width: 1440, height: 900 });
      const p = ep.page, label = p.locator('.plabel');
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Play vs Stockfish…' }).click();
      const dialog = p.getByRole('dialog', { name: 'Play vs Stockfish' });
      await dialog.getByRole('radio', { name: 'White' }).click();
      await dialog.getByRole('radio', { name: 'Off' }).click();
      await dialog.getByRole('button', { name: 'Start game' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      const b = await boardBox(p), f = square(b, 'e2'), tt = square(b, 'e4');
      await p.mouse.move(f.x, f.y); await p.mouse.down(); await p.mouse.move(tt.x, tt.y, { steps: 8 }); await p.mouse.up();
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Edit position…' }).click();
      // Stockfish replies under the Leave dialog
      await p.getByRole('dialog', { name: 'Leave this game?' }).waitFor({ timeout: 3000 });
      assert.equal(await label.filter({ hasText: /^1… / }).count(), 0, 'no reply yet when the dialog opens');
      await assert.doesNotReject(label.filter({ hasText: /^1… / }).waitFor({ timeout: 15000 }));
      await p.getByRole('button', { name: 'Leave the game' }).click();
      const field = p.getByRole('textbox', { name: 'FEN' });
      await assert.doesNotReject(field.waitFor({ timeout: 5000 }));
      // the stored board, which Cancel goes back to, has both moves
      const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('chess-video.files.v1')).board.moves);
      assert.equal(stored.length, 2, JSON.stringify(stored));
      await p.keyboard.press('Escape');
      await assert.doesNotReject(field.waitFor({ state: 'detached', timeout: 5000 }));
      await assert.doesNotReject(label.filter({ hasText: /^1… / }).waitFor({ timeout: 5000 }), 'the reply is still there');
      assert.deepEqual(ep.errors, []);
      await ep.ctx.close();
    });
    // Play's Start from shows with no position set up; Set-up position then opens the editor with the dialog's settings,
    // whose Done (Start game) starts the game there, and whose Cancel brings the dialog back as it was
    await t.test('desktop: Play vs human from a position set up in the editor', async () => {
      const ep = await open(browser, { width: 1440, height: 900 });
      const p = ep.page, dialog = p.getByRole('dialog', { name: 'Play vs human' });
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Play vs human…' }).click();
      await assert.doesNotReject(dialog.waitFor({ timeout: 3000 }));
      const from = dialog.getByRole('radiogroup', { name: 'Start from' });
      assert.equal(await from.getByRole('radio', { name: 'Starting position' }).getAttribute('aria-checked'), 'true');
      await from.getByRole('radio', { name: 'Set-up position' }).click();
      await dialog.getByRole('radiogroup', { name: 'Time control' }).getByRole('radio', { name: '5+3' }).click();
      assert.equal(await dialog.getByRole('button', { name: 'Start game' }).count(), 0);
      await dialog.getByRole('button', { name: 'Set up position…' }).click();
      const field = p.getByRole('textbox', { name: 'FEN' });
      await assert.doesNotReject(field.waitFor({ timeout: 5000 }));
      // Cancel: the dialog again, as it was
      await p.getByRole('button', { name: 'Cancel' }).click();
      await assert.doesNotReject(dialog.waitFor({ timeout: 3000 }));
      assert.equal(await from.getByRole('radio', { name: 'Set-up position' }).getAttribute('aria-checked'), 'true');
      assert.equal(await dialog.getByRole('radiogroup', { name: 'Time control' }).getByRole('radio', { name: '5+3' }).getAttribute('aria-checked'), 'true');
      await dialog.getByRole('button', { name: 'Set up position…' }).click();
      await typeFen(field, '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
      await p.getByRole('button', { name: 'Start game' }).click();
      await assert.doesNotReject(field.waitFor({ state: 'detached', timeout: 5000 }));
      await assert.doesNotReject(p.locator('.game-clock').first().waitFor({ timeout: 5000 }));
      assert.deepEqual(await p.locator('.game-clock').allInnerTexts(), ['5:00', '5:00']);
      assert.equal((await boardBox(p)).n, 3, 'the game starts from the set-up position');
      assert.match(await p.locator('body').innerText(), /Play vs human/);
      assert.deepEqual(ep.errors, []);
      await ep.ctx.close();
    });
    // Paste PGN: an empty box or a PGN that doesn't build gets a plain message and changes nothing; a good one, loaded
    // with Ctrl+Enter, is the loaded game, from the free board too
    await t.test('desktop: Paste PGN loads a game, and says what\'s wrong with a bad one', async () => {
      const pp = await open(browser, { width: 1440, height: 900 });
      const p = pp.page, dialog = p.getByRole('dialog', { name: 'Paste PGN' }), field = dialog.getByRole('textbox', { name: 'PGN' });
      const openIt = async () => {
        await p.getByRole('button', { name: 'Play/Explore' }).click();
        await p.getByRole('button', { name: 'Paste PGN…' }).click();
        await dialog.waitFor({ timeout: 5000 });
      };
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      // from the free board, so the loaded game is seen to replace it
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Starting position' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      await openIt();
      assert.equal(await field.evaluate((el) => el === document.activeElement), true, 'the box is focused on open');
      await dialog.getByRole('button', { name: 'Load' }).click();
      await assert.doesNotReject(dialog.getByRole('alert').filter({ hasText: /paste a pgn/i }).waitFor({ timeout: 5000 }));
      // keys typed in the box stay there, Enter included (a new line, not Load)
      await field.pressSequentially('1. e4 e5 2. Qh9\n');
      await p.keyboard.press('ControlOrMeta+Enter');
      await assert.doesNotReject(dialog.getByRole('alert').filter({ hasText: /\S/ }).waitFor({ timeout: 5000 }));
      assert.equal(await dialog.isVisible(), true, 'a bad PGN keeps the dialog open');
      assert.equal(await field.inputValue(), '1. e4 e5 2. Qh9\n', 'and its text, the new line in it');
      assert.equal(await p.getByRole('button', { name: 'Play (space)' }).count(), 0, 'still the free board');
      await p.screenshot({ path: path.join(OUT, host + '-pgn-dialog.png') });
      // Tab goes round the box, Cancel and Load
      for (let i = 0; i < 3; i++) {
        await p.keyboard.press('Tab');
        assert.equal(await p.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true, `focus stays in the dialog after ${i + 1} Tab${i ? 's' : ''}`);
      }
      await p.keyboard.press('Escape');
      await assert.doesNotReject(dialog.waitFor({ state: 'detached', timeout: 5000 }));
      assert.equal(await p.evaluate(() => document.activeElement.textContent), 'Play/Explore', 'focus back on Play/Explore');
      await openIt();
      await field.click();
      await field.pressSequentially('[White "Alpha Tester"]\n[Black "Beta Tester"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
      await p.keyboard.press('ControlOrMeta+Enter');
      await assert.doesNotReject(dialog.waitFor({ state: 'detached', timeout: 5000 }));
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ timeout: 5000 }));
      await p.waitForFunction(() => /Alpha Tester/.test(document.body.innerText) && /Beta Tester/.test(document.body.innerText), null, { timeout: 5000 });
      assert.deepEqual(pp.errors, []);
      await pp.ctx.close();
      // the phone: the item is in the folded menu, the dialog fits the width
      const ph = await open(browser, { width: 390, height: 844 }, phone({}));
      await ph.page.goto(base, { waitUntil: 'load' });
      await loadedOn(ph.page);
      await ph.page.getByRole('button', { name: 'Menu' }).click();
      await ph.page.getByRole('button', { name: 'Paste PGN…' }).click();
      const pd = ph.page.getByRole('dialog', { name: 'Paste PGN' });
      await assert.doesNotReject(pd.waitFor({ timeout: 5000 }));
      await pd.getByRole('textbox', { name: 'PGN' }).pressSequentially('[White "Alpha Tester"]\n\n1. d4 d5 *');
      assert.deepEqual(await wider(ph.page), [], 'no sideways scroll');
      const box = await pd.boundingBox();
      assert.ok(box.x >= 8 && box.x + box.width <= 390 - 8 && box.y >= 0 && box.y + box.height <= 844, 'the dialog fits the screen');
      await ph.page.screenshot({ path: path.join(OUT, host + '-pgn-dialog-phone.png') });
      await pd.getByRole('button', { name: 'Load' }).click();
      await assert.doesNotReject(pd.waitFor({ state: 'detached', timeout: 5000 }));
      await ph.page.waitForFunction(() => /Alpha Tester/.test(document.body.innerText), null, { timeout: 5000 });
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
    // the endgame tablebase (Lichess, the real service): at 7 pieces or fewer the Analysis panel and the eval bar show its
    // result, a move from it plays on the board; more pieces, or the setting off, and nothing is sent
    await t.test('desktop: the tablebase rates an endgame on the free board, and sends nothing above 7 pieces or when off', async () => {
      const tb = await open(browser, { width: 1440, height: 900 });
      const p = tb.page, sent = [];
      tb.ctx.on('request', (r) => { if (r.url().startsWith('https://tablebase.lichess.ovh/')) sent.push(decodeURIComponent(r.url().split('fen=')[1])); });
      const text = () => p.evaluate(() => document.body.innerText);
      const setUp = (fen) => setUpFen(p, fen);
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      // the sample's opening has 32 pieces: nothing asked
      await p.waitForTimeout(1000);
      assert.deepEqual(sent, []);
      await setUp('8/8/8/4k3/8/8/3KB3/7N w - - 0 1');
      await p.waitForFunction(() => /Tablebase\s+White wins · DTZ 55 · DTM 55/i.test(document.body.innerText), null, { timeout: 20000 });
      assert.match(await text(), /TB M28/, 'the eval bar shows the mate');
      assert.deepEqual(sent, ['8/8/8/4k3/8/8/3KB3/7N w - - 0 1']);
      await p.screenshot({ path: path.join(OUT, host + '-tablebase.png') });
      // a move from the tablebase plays on the board, and Black's answer is a loss
      await p.locator('.tb-move', { hasText: /^Ke3$/ }).click();
      await assert.doesNotReject(p.locator('.plabel').filter({ hasText: /1\. Ke3/ }).waitFor({ timeout: 5000 }));
      await p.waitForFunction(() => /Tablebase\s+White wins · DTZ 54/i.test(document.body.innerText), null, { timeout: 20000 });
      // back to the start: from the cache, nothing sent again
      await p.keyboard.press('ArrowLeft');
      await p.waitForFunction(() => /DTZ 55/.test(document.body.innerText), null, { timeout: 5000 });
      assert.equal(sent.length, 2);
      // the fifty-move count goes with the FEN: with 60 plies gone the same win is a cursed one
      await setUp('8/8/8/4k3/8/8/3KB3/7N w - - 60 80');
      await p.waitForFunction(() => /Tablebase\s+Cursed win for White/i.test(document.body.innerText), null, { timeout: 20000 });
      assert.match(await text(), /TB 0\.00/);
      assert.equal(sent.length, 3);
      assert.equal(sent[2], '8/8/8/4k3/8/8/3KB3/7N w - - 60 80');
      // 8 pieces: no Tablebase block, nothing sent
      await setUp('8/8/8/3k4/pppp4/8/8/1N1NK3 w - - 0 1');
      await p.waitForTimeout(1500);
      assert.doesNotMatch(await text(), /Tablebase/);
      assert.equal(sent.length, 3);
      // the setting off: a 5-piece position sends nothing
      await p.getByRole('button', { name: 'Settings' }).click();
      await p.getByRole('tab', { name: 'Engine' }).click();
      await p.getByRole('switch', { name: /Endgame tablebase/ }).click();
      await p.keyboard.press('Escape');
      await setUp('4k3/8/8/8/8/8/3RK3/7r w - - 0 1');
      await p.waitForTimeout(1500);
      assert.doesNotMatch(await text(), /Tablebase|TB /);
      assert.equal(sent.length, 3);
      assert.deepEqual(tb.errors, []);
      await tb.ctx.close();
    });
    // the tablebase in a game's analysis (the real service): every position of this KBN v K game has 7 pieces or fewer,
    // so the run asks Lichess (4 requests 4 s apart, the start's answer already shown) and searches none of them (with
    // 20 s a position, a search would show), and 2. Bc4+, which
    // gives the bishop away, throws the win away: a blunder
    await t.test('desktop: analysing a KBN v K game takes the tablebase and rates the drawing move a blunder', async () => {
      const ta = await open(browser, { width: 1440, height: 900 });
      const p = ta.page, sent = [];
      ta.ctx.on('request', (r) => { if (r.url().startsWith('https://tablebase.lichess.ovh/')) sent.push(r.url()); });
      await p.addInitScript(() => { try { localStorage.setItem('chess-video.tweaks.v1', JSON.stringify({ sfTime: 20 })); } catch (e) {} });
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      const pgn = '[White "Kay"]\n[Black "Bee"]\n[SetUp "1"]\n[FEN "8/8/8/4k3/8/8/3KB3/7N w - - 0 1"]\n\n1. Ke3 Kd5 2. Bc4+ Kxc4 *';
      await p.setInputFiles('#game-files', { name: 'kbnk.pgn', mimeType: 'text/plain', buffer: Buffer.from(pgn) });
      await p.waitForFunction(() => /Kxc4/.test(document.body.innerText), null, { timeout: 10000 });
      const t0 = Date.now();
      await p.getByRole('button', { name: /^Analyse with Stockfish/ }).first().click();
      await p.waitForFunction(() => /Lichess tablebase/i.test(document.body.innerText), null, { timeout: 19000 });
      assert.ok(Date.now() - t0 < 19000, 'no 20 s search');
      assert.equal(sent.filter((u) => u.includes('/standard?')).length, 5, 'each position asked once');
      assert.equal(sent.length, 5, 'nothing else asked');
      await p.locator('[data-ply="2"]').click();
      await assert.doesNotReject(p.locator('.plabel').filter({ hasText: /2\. Bc4\+/ }).waitFor({ timeout: 5000 }));
      await p.waitForFunction(() => /Blunder/i.test(document.body.innerText), null, { timeout: 5000 });
      await p.screenshot({ path: path.join(OUT, host + '-tablebase-analysis.png') });
      await p.locator('[data-ply="0"]').click();
      await p.waitForFunction(() => /The tablebase agrees/.test(document.body.innerText) || /Best line/.test(document.body.innerText), null, { timeout: 5000 });
      assert.equal(await p.getByRole('button', { name: /^Go deeper/ }).count(), 0, 'nothing to go deeper on');
      assert.deepEqual(ta.errors, []);
      await ta.ctx.close();
    });
    // the opening explorer: book moves from the position shown, played like a drag (and rated); a take-back branches
    await t.test('desktop: the explorer names the opening and plays a book move', async () => {
      const ex = await open(browser, { width: 1440, height: 900 });
      const p = ex.page, label = p.locator('.plabel');
      const panel = (title) => p.evaluate((tt) => { const d = [...document.querySelectorAll('div')].find((e) => e.firstElementChild && e.firstElementChild.firstElementChild && e.firstElementChild.firstElementChild.textContent === tt && getComputedStyle(e.firstElementChild).textTransform === 'uppercase'); return d ? d.innerText : ''; }, title);
      // a book move's row: its SAN first, then the opening it reaches
      const row = (pg, san) => pg.locator('.book-moves [role="button"]').filter({ hasText: new RegExp('^' + san + '(?![a-z0-9=+#])') });
      const head = p.locator('.book-head');
      const drag = async (b, from, to) => {
        const f = square(b, from), tt = square(b, to);
        await p.mouse.move(f.x, f.y);
        await p.mouse.down();
        await p.mouse.move(tt.x, tt.y, { steps: 8 });
        await p.mouse.up();
      };
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Starting position' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      await assert.doesNotReject(head.filter({ hasText: /^Starting position$/ }).waitFor({ timeout: 5000 }));
      const b = await boardBox(p);
      // a mouse drag on the list scrolls it: no move played, no text selected
      const listTop = () => p.evaluate(() => document.querySelector('.book-head').parentElement.parentElement.scrollTop);
      // once the list has the room to scroll that far (in CI's Firefox its rows and fonts can still be settling)
      const room = () => p.evaluate(() => { const e = document.querySelector('.book-head').parentElement.parentElement; return e.scrollHeight - e.clientHeight; });
      await p.waitForFunction(() => { const e = document.querySelector('.book-head').parentElement.parentElement; return e.scrollHeight - e.clientHeight >= 120; }, null, { timeout: 10000 }).catch(() => {});
      await p.evaluate(() => document.fonts.ready);
      const from = await row(p, 'Nc3').boundingBox();
      await p.mouse.move(from.x + 40, from.y + from.height / 2);
      await p.mouse.down();
      await p.mouse.move(from.x + 40, from.y + from.height / 2 - 120, { steps: 8 });
      await p.mouse.up();
      assert.ok(await listTop() >= 100, `the list scrolled (${await listTop()} px of ${await room()} px it can)`);
      assert.match(await label.innerText(), /^Start$/, 'the drag played no move');
      assert.equal(await p.evaluate(() => String(window.getSelection())), '', 'and selected no text');
      await row(p, 'e4').click();
      await assert.doesNotReject(label.filter({ hasText: /1\. e4/ }).waitFor({ timeout: 5000 }));
      await assert.doesNotReject(row(p, 'c5').filter({ hasText: /Sicilian/ }).waitFor({ timeout: 5000 }));
      // a book move is rated like any other
      await p.waitForFunction(() => /your move · .*(stockfish’s choice|cp vs|as good as|can’t run here|stopped)/i.test(document.body.innerText), null, { timeout: 45000 });
      await row(p, 'c5').click();
      await assert.doesNotReject(label.filter({ hasText: /1… c5/ }).waitFor({ timeout: 5000 }));
      await assert.doesNotReject(head.filter({ hasText: /Sicilian Defense/ }).waitFor({ timeout: 5000 }));
      assert.match(await panel('Opening explorer'), /B20/);
      await p.screenshot({ path: path.join(OUT, host + '-explorer.png') });
      // back to the start: a book move there replaces the moves after it. The list scrolled down for c5 starts at its top
      await p.evaluate(() => { document.querySelector('.book-head').parentElement.parentElement.scrollTop = 400; });
      await p.keyboard.press('ArrowLeft');
      await p.keyboard.press('ArrowLeft');
      await assert.doesNotReject(label.filter({ hasText: /^Start$/ }).waitFor({ timeout: 5000 }));
      assert.equal(await p.evaluate(() => document.querySelector('.book-head').parentElement.parentElement.scrollTop), 0, 'the start\'s list is scrolled to its top');
      await row(p, 'd4').click();
      await assert.doesNotReject(label.filter({ hasText: /1\. d4/ }).waitFor({ timeout: 5000 }));
      assert.doesNotMatch(await panel('Moves'), /c5|e4/);
      await assert.doesNotReject(head.filter({ hasText: /Queen.s Pawn/ }).waitFor({ timeout: 5000 }));
      // out of the book: it says so, naming the last book position
      // each move lands before the next drag starts: a drag begun before the board re-renders picks up the wrong side's piece
      // the rows clicked (each scrolled into view first) left the board where it was: the frame clips rather than scrolls
      // (stock Firefox once slid it 447 px left, and the drags below missed the board)
      const b2 = await boardBox(p);
      assert.ok(Math.abs(b2.x0 - b.x0) < 1 && Math.abs(b2.y0 - b.y0) < 1, `the board stayed put: (${b.x0}, ${b.y0}) → (${b2.x0}, ${b2.y0})`);
      for (const [f, tt, l] of [['h7', 'h6', /1… h6/], ['a2', 'a3', /2\. a3/], ['h6', 'h5', /2… h5/], ['a3', 'a4', /3\. a4/]]) {
        await drag(b, f, tt);
        await assert.doesNotReject(label.filter({ hasText: l }).waitFor({ timeout: 5000 }));
      }
      await p.waitForFunction(() => /Out of book/.test(document.body.innerText), null, { timeout: 5000 });
      assert.match(await panel('Opening explorer'), /last book position: /);
      // a pasted FEN that is a book position is named itself; its rows take Enter
      await setUpFen(p, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
      await assert.doesNotReject(head.filter({ hasText: /King.s Pawn Game/ }).waitFor({ timeout: 5000 }));
      assert.match(await panel('Opening explorer'), /B00/);
      await row(p, 'e5').focus();
      await p.keyboard.press('Enter');
      await assert.doesNotReject(label.filter({ hasText: /1… e5/ }).waitFor({ timeout: 5000 }));
      assert.deepEqual(ex.errors, []);
      await ex.ctx.close();
      // the phone: the explorer under the board, its rows tapped (no drags: Playwright's Firefox drops them with touch)
      const ph = await open(browser, { width: 390, height: 844 }, phone({}));
      await ph.page.goto(base, { waitUntil: 'load' });
      await loadedOn(ph.page);
      await ph.page.getByRole('button', { name: 'Menu' }).click();
      await ph.page.getByRole('button', { name: 'Starting position' }).click();
      await assert.doesNotReject(row(ph.page, 'e4').waitFor({ timeout: 5000 }));
      await row(ph.page, 'e4').click();
      await assert.doesNotReject(ph.page.locator('.plabel').filter({ hasText: /1\. e4/ }).waitFor({ timeout: 5000 }));
      await row(ph.page, 'c5').click();
      await assert.doesNotReject(ph.page.locator('.book-head').filter({ hasText: /Sicilian Defense/ }).waitFor({ timeout: 5000 }));
      assert.deepEqual(await wider(ph.page), [], 'no sideways scroll');
      await ph.page.screenshot({ path: path.join(OUT, host + '-explorer-phone.png') });
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
    await t.test('desktop: the start shows Stockfish\'s eval and best line, and the board\'s moves replay as a game', async () => {
      const g = await open(browser, { width: 1440, height: 900 });
      const p = g.page, label = p.locator('.plabel');
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Starting position' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      // before any move: the eval and Stockfish's best line, whose first move plays when picked
      const chip = p.locator('.mv[role="button"][title^="Show stockfish’s best line"]').first();
      await assert.doesNotReject(chip.waitFor({ timeout: 45000 }));
      assert.match(await p.locator('body').innerText(), /white to move/i);
      await p.screenshot({ path: path.join(OUT, host + '-board-start.png') });
      const san = (await chip.innerText()).trim();
      await chip.click();
      await assert.doesNotReject(label.filter({ hasText: new RegExp('^1\\. ' + san.replace(/[+#]/g, '\\$&') + '$') }).waitFor({ timeout: 5000 }));
      // Settings: the moves open as a game with the video export, and the board comes back
      await p.getByRole('button', { name: 'Settings' }).click();
      await p.getByRole('button', { name: 'Replay these moves as a game' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ timeout: 5000 }));
      await p.getByRole('tab', { name: 'Export' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: /^Export (video|animated WebP)/ }).waitFor({ timeout: 5000 }));
      await p.getByRole('tab', { name: 'Game' }).click();
      await p.getByRole('button', { name: 'Back to the free board' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      await assert.doesNotReject(label.filter({ hasText: new RegExp('^1\\. ' + san.replace(/[+#]/g, '\\$&') + '$') }).waitFor({ timeout: 5000 }));
      assert.deepEqual(g.errors, []);
      await g.ctx.close();
    });
    // Play vs human: the board turns to the side to move, Take back takes a move back, the game ends in mate, nothing hints
    await t.test('desktop: Play vs human turns the board, takes back, ends in mate, and asks before leaving a game', async () => {
      const g = await open(browser, { width: 1440, height: 900 });
      const p = g.page, label = p.locator('.plabel');
      const panel = (title) => p.evaluate((tt) => { const d = [...document.querySelectorAll('div')].find((e) => e.firstElementChild && e.firstElementChild.firstElementChild && e.firstElementChild.firstElementChild.textContent === tt && getComputedStyle(e.firstElementChild).textTransform === 'uppercase'); return d ? d.innerText : ''; }, title);
      const drag = async (b, from, to, flipped) => {
        const f = square(b, from, flipped), tt = square(b, to, flipped);
        await p.mouse.move(f.x, f.y);
        await p.mouse.down();
        await p.mouse.move(tt.x, tt.y, { steps: 8 });
        await p.mouse.up();
      };
      // nothing Stockfish or the book would say: no eval figures, no depth, no verdicts, no explorer
      const noHints = async () => {
        const text = await p.locator('body').innerText();
        assert.doesNotMatch(text, /[+−]\d+\.\d\d|depth|cp vs|best line|stockfish replies|stockfish’s choice|opening explorer|book/i);
      };
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Play vs human…' }).click();
      const dialog = p.getByRole('dialog', { name: 'Play vs human' });
      await assert.doesNotReject(dialog.waitFor({ timeout: 3000 }));
      await p.screenshot({ path: path.join(OUT, host + '-play-dialog.png') });
      await dialog.getByRole('radiogroup', { name: 'Time control' }).getByRole('radio', { name: '5+3' }).click();
      await dialog.getByRole('button', { name: 'Start game' }).click();
      await assert.doesNotReject(dialog.waitFor({ state: 'detached', timeout: 3000 }));
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      const b = await boardBox(p);
      assert.equal(b.n, 32);
      assert.match(await panel('Game'), /White to move/);
      assert.match(await panel('Play vs human'), /From the starting position/);
      assert.deepEqual(await p.locator('.game-clock').allInnerTexts(), ['5:00', '5:00']);
      // White at the bottom, then Black: each move turns the board
      await drag(b, 'f2', 'f3', false);
      await assert.doesNotReject(label.filter({ hasText: /1\. f3/ }).waitFor({ timeout: 5000 }));
      await drag(b, 'e7', 'e5', true);
      await assert.doesNotReject(label.filter({ hasText: /1… e5/ }).waitFor({ timeout: 5000 }));
      await p.waitForTimeout(2500);
      // Black's clock ran while Black thought, and each move added 3 s; White's runs now
      const clocks = await p.locator('.game-clock').allInnerTexts();
      assert.ok(clocks.every((c) => /^4:5\d$|^5:0[0-3]$/.test(c)) && clocks.some((c) => c !== '5:00'), clocks.join(' '));
      await noHints();
      await p.screenshot({ path: path.join(OUT, host + '-play.png') });
      // ← and the transport bar don't take moves back in a game; Take back does: Black to move again, still at the bottom
      await p.keyboard.press('ArrowLeft');
      await p.waitForTimeout(300);
      assert.match(await label.innerText(), /1… e5/);
      assert.equal(await p.getByRole('button', { name: 'Previous move (←)' }).isDisabled(), true);
      await p.getByRole('button', { name: 'Take back' }).click();
      await assert.doesNotReject(label.filter({ hasText: /^1\. f3$/ }).waitFor({ timeout: 5000 }));
      assert.doesNotMatch(await panel('Moves'), /e5/);
      await drag(b, 'e7', 'e5', true);
      await assert.doesNotReject(label.filter({ hasText: /1… e5/ }).waitFor({ timeout: 5000 }));
      await drag(b, 'g2', 'g4', false);
      await assert.doesNotReject(label.filter({ hasText: /2\. g4/ }).waitFor({ timeout: 5000 }));
      await drag(b, 'd8', 'h4', true);
      await assert.doesNotReject(label.filter({ hasText: /2… Qh4#/ }).waitFor({ timeout: 5000 }));
      assert.match(await panel('Game'), /0–1[\s\S]*checkmate/i);
      await noHints();
      await p.screenshot({ path: path.join(OUT, host + '-play-mate.png') });
      // the finished game comes back after a reload, and takes no more moves
      await p.reload({ waitUntil: 'load' });
      await loadedOn(p);
      await assert.doesNotReject(label.filter({ hasText: /2… Qh4#/ }).waitFor({ timeout: 5000 }));
      assert.match(await panel('Game'), /0–1[\s\S]*checkmate/i);
      // leaving a finished game doesn't ask
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Starting position' }).click();
      await assert.doesNotReject(label.filter({ hasText: /^Start$/ }).waitFor({ timeout: 5000 }));
      assert.notEqual(await panel('Opening explorer'), '', 'the free board again');
      assert.equal(await p.getByRole('dialog').count(), 0);
      // a game in progress asks first: Keep playing keeps it, Leave the game leaves
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Play vs human…' }).click();
      await p.getByRole('button', { name: 'Start game' }).click();
      await drag(b, 'e2', 'e4', false);
      await assert.doesNotReject(label.filter({ hasText: /1\. e4/ }).waitFor({ timeout: 5000 }));
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Starting position' }).click();
      const leave = p.getByRole('dialog', { name: 'Leave this game?' });
      await assert.doesNotReject(leave.waitFor({ timeout: 3000 }));
      await p.screenshot({ path: path.join(OUT, host + '-play-leave.png') });
      await leave.getByRole('button', { name: 'Keep playing' }).click();
      await assert.doesNotReject(leave.waitFor({ state: 'detached', timeout: 3000 }));
      assert.match(await label.innerText(), /1\. e4/);
      assert.match(await panel('Game'), /Black to move/);
      // Resign and Offer a draw ask first; Keep playing takes the question back
      await p.getByRole('button', { name: 'Resign as Black' }).click();
      assert.match(await panel('Game'), /Resign as Black\?/);
      await p.screenshot({ path: path.join(OUT, host + '-play-resign.png') });
      await p.getByRole('button', { name: 'Keep playing' }).click();
      assert.match(await panel('Game'), /Black to move/);
      assert.doesNotMatch(await panel('Game'), /resigned/i);
      // the buttons' text can't be selected (a double click would otherwise highlight it)
      assert.equal(await p.getByRole('button', { name: 'Offer a draw' }).evaluate((e) => getComputedStyle(e).userSelect), 'none');
      await p.getByRole('button', { name: 'Offer a draw' }).click();
      assert.match(await panel('Game'), /Black offers a draw\. White, accept\?/);
      await p.getByRole('button', { name: 'Decline' }).click();
      assert.match(await panel('Game'), /Black to move/);
      await p.getByRole('button', { name: 'Offer a draw' }).click();
      await p.screenshot({ path: path.join(OUT, host + '-play-draw.png') });
      await p.getByRole('button', { name: 'Accept', exact: true }).click();
      await assert.doesNotReject(p.getByText('Draw by agreement').waitFor({ timeout: 3000 }));
      assert.match(await panel('Game'), /½–½/);
      // Play again starts a new game with the same clock; this one gets a move and is resigned
      await p.getByRole('button', { name: 'Play again' }).click();
      await assert.doesNotReject(label.filter({ hasText: /^Start$/ }).waitFor({ timeout: 5000 }));
      await drag(b, 'e2', 'e4', false);
      await assert.doesNotReject(label.filter({ hasText: /1\. e4/ }).waitFor({ timeout: 5000 }));
      await p.getByRole('button', { name: 'Resign as Black' }).click();
      await p.getByRole('button', { name: 'Resign', exact: true }).click();
      await assert.doesNotReject(p.getByText('Black resigned').waitFor({ timeout: 3000 }));
      await p.screenshot({ path: path.join(OUT, host + '-play-resigned.png') });
      // a finished game is left without asking; then a new one with a move asks
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Play vs human…' }).click();
      await p.getByRole('button', { name: 'Start game' }).click();
      await drag(b, 'e2', 'e4', false);
      await assert.doesNotReject(label.filter({ hasText: /1\. e4/ }).waitFor({ timeout: 5000 }));
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Starting position' }).click();
      await leave.getByRole('button', { name: 'Leave the game' }).click();
      await assert.doesNotReject(label.filter({ hasText: /^Start$/ }).waitFor({ timeout: 5000 }));
      assert.equal(await panel('Game'), '');
      assert.deepEqual(g.errors, []);
      await g.ctx.close();
      // the phone: Play vs human from the folded menu, the clocks in the bars (Playwright's Firefox, given touch, drops
      // the mouse's drags; there it is a narrow window)
      const ph = await open(browser, { width: 390, height: 844 }, phone({}));
      const pp = ph.page;
      await pp.goto(base, { waitUntil: 'load' });
      await loadedOn(pp);
      await pp.getByRole('button', { name: 'Menu' }).click();
      await pp.getByRole('button', { name: 'Play vs human…' }).click();
      await pp.getByRole('radio', { name: '10+0' }).click();
      await pp.screenshot({ path: path.join(OUT, host + '-play-dialog-phone.png') });
      await pp.getByRole('button', { name: 'Start game' }).click();
      await assert.doesNotReject(pp.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      const pb = await boardBox(pp), pf = square(pb, 'e2'), pt = square(pb, 'e4');
      await pp.mouse.move(pf.x, pf.y);
      await pp.mouse.down();
      await pp.mouse.move(pt.x, pt.y, { steps: 8 });
      await pp.mouse.up();
      await assert.doesNotReject(pp.locator('.plabel').filter({ hasText: /1\. e4/ }).waitFor({ timeout: 5000 }));
      await pp.waitForTimeout(1500);
      assert.deepEqual(await wider(pp), [], 'no sideways scroll');
      assert.equal(await pp.locator('.game-clock').count(), 2);
      await pp.screenshot({ path: path.join(OUT, host + '-play-phone.png') });
      // the result box fits on the phone: the score with Play again beside it, Analyse below
      await pp.getByRole('button', { name: 'Resign as Black' }).click();
      await pp.getByRole('button', { name: 'Resign', exact: true }).click();
      await assert.doesNotReject(pp.getByText('Black resigned').waitFor({ timeout: 3000 }));
      const fits = await pp.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Analyse on the free board'); const box = b.closest('[style*="overflow"]') || b.parentElement.parentElement; const r = b.getBoundingClientRect(), q = box.getBoundingClientRect(); return r.bottom <= q.bottom + 1; });
      assert.equal(fits, true, 'Analyse on the free board is inside its box');
      await pp.screenshot({ path: path.join(OUT, host + '-play-resigned-phone.png') });
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
    // Play vs Stockfish: it answers each move, the board stays on the player's side, Take back goes to the player's turn
    await t.test('desktop: Play vs Stockfish replies, keeps the board on the player\'s side, takes back to the player\'s turn', async () => {
      const g = await open(browser, { width: 1440, height: 900 });
      const p = g.page, label = p.locator('.plabel');
      const panel = (title) => p.evaluate((tt) => { const d = [...document.querySelectorAll('div')].find((e) => e.firstElementChild && e.firstElementChild.firstElementChild && e.firstElementChild.firstElementChild.textContent === tt && getComputedStyle(e.firstElementChild).textTransform === 'uppercase'); return d ? d.innerText : ''; }, title);
      const drag = async (b, from, to, flipped) => {
        const f = square(b, from, flipped), tt = square(b, to, flipped);
        await p.mouse.move(f.x, f.y);
        await p.mouse.down();
        await p.mouse.move(tt.x, tt.y, { steps: 8 });
        await p.mouse.up();
      };
      // nothing Stockfish or the book would say: no eval figures, no depth, no verdicts, no explorer
      const noHints = async () => {
        const text = await p.locator('body').innerText();
        assert.doesNotMatch(text, /[+−]\d+\.\d\d|depth|cp vs|best line|stockfish replies|stockfish’s choice|opening explorer|book|better was/i);
      };
      // the bars' names from the top of the board down (the header's are larger)
      const bars = () => p.evaluate(() => [...document.querySelectorAll('span')].filter((e) => /^(You|Stockfish 19)$/.test(e.textContent) && getComputedStyle(e).fontSize === '20px').sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((e) => e.textContent));
      const start = async (you) => {
        await p.getByRole('button', { name: 'Play/Explore' }).click();
        await p.getByRole('button', { name: 'Play vs Stockfish…' }).click();
        const dialog = p.getByRole('dialog', { name: 'Play vs Stockfish' });
        await assert.doesNotReject(dialog.waitFor({ timeout: 3000 }));
        await dialog.getByRole('radio', { name: you }).click();
        await dialog.getByRole('radio', { name: 'Off' }).click();
        return dialog;
      };
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      const dialog = await start('White');
      assert.match(await dialog.innerText(), /You play[\s\S]*White[\s\S]*Black[\s\S]*Random/);
      await p.screenshot({ path: path.join(OUT, host + '-sf-dialog.png') });
      await dialog.getByRole('button', { name: 'Start game' }).click();
      await assert.doesNotReject(dialog.waitFor({ state: 'detached', timeout: 3000 }));
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      const b = await boardBox(p);
      assert.equal(b.n, 32);
      assert.match(await panel('Game'), /Your move/);
      assert.match(await panel('Play vs Stockfish'), /You play White/);
      assert.deepEqual(await bars(), ['Stockfish 19', 'You']);
      assert.equal(await p.getByRole('button', { name: 'Take back' }).count(), 0, 'nothing to take back yet');
      assert.equal(await p.getByRole('button', { name: 'Offer a draw' }).count(), 0, 'no draw offers against Stockfish');
      await drag(b, 'e2', 'e4', false);
      await assert.doesNotReject(label.filter({ hasText: /^1… / }).waitFor({ timeout: 20000 }), 'Stockfish replies');
      assert.match(await panel('Moves'), /e4[\s\S]+\S/);
      assert.match(await panel('Game'), /Your move/);
      assert.deepEqual(await bars(), ['Stockfish 19', 'You'], 'the board didn\'t turn');
      await noHints();
      // Take back removes Stockfish's reply and the player's move
      await p.getByRole('button', { name: 'Take back' }).click();
      await assert.doesNotReject(label.filter({ hasText: /^Start$/ }).waitFor({ timeout: 5000 }));
      assert.doesNotMatch(await panel('Moves'), /e4/);
      assert.equal(await p.getByRole('button', { name: 'Take back' }).count(), 0);
      // Resign asks first
      await p.getByRole('button', { name: 'Resign', exact: true }).click();
      assert.match(await panel('Game'), /Resign this game\?/);
      await p.getByRole('button', { name: 'Keep playing' }).click();
      assert.match(await panel('Game'), /Your move/);
      // as Black: Stockfish moves first, and the board is drawn from Black
      await (await start('Black')).getByRole('button', { name: 'Start game' }).click();
      await assert.doesNotReject(label.filter({ hasText: /^1\. / }).waitFor({ timeout: 20000 }), 'Stockfish opens');
      assert.deepEqual(await bars(), ['Stockfish 19', 'You']);
      assert.match(await panel('Play vs Stockfish'), /You play Black/);
      assert.equal(await p.getByRole('button', { name: 'Take back' }).count(), 0, 'Stockfish\'s first move alone can\'t be taken back');
      await drag(b, 'e7', 'e5', true);
      await assert.doesNotReject(label.filter({ hasText: /^1… e5$/ }).waitFor({ timeout: 5000 }));
      await assert.doesNotReject(label.filter({ hasText: /^2\. / }).waitFor({ timeout: 20000 }));
      await noHints();
      await p.screenshot({ path: path.join(OUT, host + '-sf-black.png') });
      await p.getByRole('button', { name: 'Take back' }).click();
      await assert.doesNotReject(label.filter({ hasText: /^1\. / }).waitFor({ timeout: 5000 }));
      assert.match(await panel('Game'), /Your move/);
      // My games names the mode and the side
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'My games…' }).click();
      assert.match(await p.locator('.games-row').first().innerText(), /vs Stockfish · you played Black/);
      await p.keyboard.press('Escape');
      assert.deepEqual(g.errors, []);
      await g.ctx.close();
    });
    // a queen left hanging is called a blunder in the Commentary box, without the better move until the game ends
    await t.test('desktop: Play vs Stockfish flags a blunder', async () => {
      const g = await open(browser, { width: 1440, height: 900 });
      const p = g.page, label = p.locator('.plabel');
      const panel = (title) => p.evaluate((tt) => { const d = [...document.querySelectorAll('div')].find((e) => e.firstElementChild && e.firstElementChild.firstElementChild && e.firstElementChild.firstElementChild.textContent === tt && getComputedStyle(e.firstElementChild).textTransform === 'uppercase'); return d ? d.innerText : ''; }, title);
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await setUpFen(p, '6k1/5ppp/8/3p4/8/8/4QPPP/6K1 w - - 0 1');
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Play vs Stockfish…' }).click();
      const dialog = p.getByRole('dialog', { name: 'Play vs Stockfish' });
      await dialog.getByRole('radio', { name: 'Set-up position' }).click();
      await dialog.getByRole('radio', { name: 'White' }).click();
      await dialog.getByRole('button', { name: 'Start game' }).click();
      await assert.doesNotReject(dialog.waitFor({ state: 'detached', timeout: 3000 }));
      assert.match(await panel('Play vs Stockfish'), /You play White[\s\S]*Stockfish 19 plays at full strength/);
      // measured in the game, whose board is larger than the replay's on the wide frame: by its touch layer, as a few
      // pieces don't span the board
      const b = await p.evaluate(() => { const r = [...document.querySelectorAll('div')].find((d) => d.style.touchAction === 'none').getBoundingClientRect(); return { x0: r.left, y0: r.top, sq: r.width / 8 }; });
      // Stockfish searches the position while the player thinks: the move is rated against that search
      await p.waitForTimeout(5000);
      const f = square(b, 'e2'), tt = square(b, 'c4');
      await p.mouse.move(f.x, f.y);
      await p.mouse.down();
      await p.mouse.move(tt.x, tt.y, { steps: 8 });
      await p.mouse.up();
      await assert.doesNotReject(label.filter({ hasText: /^1… dxc4$/ }).waitFor({ timeout: 20000 }), 'Stockfish takes the queen');
      const info = await panel('Play vs Stockfish');
      assert.match(info, /Blunder: 1\. Qc4[\s\S]*drops the queen/);
      assert.doesNotMatch(info, /better was/i, 'not the better move yet');
      await p.screenshot({ path: path.join(OUT, host + '-sf-blunder.png') });
      const stored = await p.evaluate(() => localStorage.getItem('chess-video.files.v1'));
      // after the end, every flagged move with the better one
      await p.getByRole('button', { name: 'Resign', exact: true }).click();
      await p.getByRole('button', { name: 'Resign', exact: true }).click();
      await assert.doesNotReject(p.getByText('White resigned').waitFor({ timeout: 3000 }));
      assert.match(await panel('Play vs Stockfish'), /1 flagged move[\s\S]*Blunder: 1\. Qc4[\s\S]*That drops the queen\. Better was Q/);
      await p.screenshot({ path: path.join(OUT, host + '-sf-critique-end.png') });
      assert.deepEqual(g.errors, []);
      await g.ctx.close();
      // the phone: the dialog from the folded menu, and the game with its critique, back after a reload
      const ph = await open(browser, { width: 390, height: 844 }, phone({}));
      const pp = ph.page;
      await pp.goto(base, { waitUntil: 'load' });
      await loadedOn(pp);
      await pp.getByRole('button', { name: 'Menu' }).click();
      await pp.getByRole('button', { name: 'Play vs Stockfish…' }).click();
      await assert.doesNotReject(pp.getByRole('dialog', { name: 'Play vs Stockfish' }).waitFor({ timeout: 3000 }));
      assert.deepEqual(await wider(pp), [], 'no sideways scroll');
      await pp.screenshot({ path: path.join(OUT, host + '-sf-dialog-phone.png') });
      await pp.getByRole('button', { name: 'Cancel' }).click();
      await pp.evaluate((s) => localStorage.setItem('chess-video.files.v1', s), stored);
      await pp.reload({ waitUntil: 'load' });
      await assert.doesNotReject(pp.locator('.plabel').filter({ hasText: /^1… dxc4$/ }).waitFor({ timeout: 5000 }));
      await assert.doesNotReject(pp.getByText(/drops the queen/).waitFor({ timeout: 5000 }));
      assert.deepEqual(await wider(pp), [], 'no sideways scroll');
      await pp.screenshot({ path: path.join(OUT, host + '-sf-blunder-phone.png') });
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
    // My games: games are kept from their first move; a finished one replays as a loaded game, one in progress resumes
    await t.test('desktop: My games keeps played games, replays a finished one and resumes one in progress', async () => {
      const g = await open(browser, { width: 1440, height: 900 });
      const p = g.page, label = p.locator('.plabel');
      const panel = (title) => p.evaluate((tt) => { const d = [...document.querySelectorAll('div')].find((e) => e.firstElementChild && e.firstElementChild.firstElementChild && e.firstElementChild.firstElementChild.textContent === tt && getComputedStyle(e.firstElementChild).textTransform === 'uppercase'); return d ? d.innerText : ''; }, title);
      const drag = async (b, from, to, flipped) => {
        const f = square(b, from, flipped), tt = square(b, to, flipped);
        await p.mouse.move(f.x, f.y);
        await p.mouse.down();
        await p.mouse.move(tt.x, tt.y, { steps: 8 });
        await p.mouse.up();
      };
      const menuItem = async (name) => { await p.getByRole('button', { name: 'Play/Explore' }).click(); await p.getByRole('button', { name }).click(); };
      const dialog = p.getByRole('dialog', { name: 'My games' }), rows = dialog.locator('.games-row');
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await menuItem('My games…');
      await assert.doesNotReject(dialog.waitFor({ timeout: 3000 }));
      assert.match(await dialog.innerText(), /No games yet/);
      await dialog.getByRole('button', { name: 'Close' }).click();
      // a game that ends in mate
      await menuItem('Play vs human…');
      await p.getByRole('radio', { name: 'Off' }).click();
      await p.getByRole('button', { name: 'Start game' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 }));
      const b = await boardBox(p);
      for (const [from, to, flipped, san] of [['f2', 'f3', false, /1\. f3/], ['e7', 'e5', true, /1… e5/], ['g2', 'g4', false, /2\. g4/], ['d8', 'h4', true, /2… Qh4#/]]) {
        await drag(b, from, to, flipped);
        await assert.doesNotReject(label.filter({ hasText: san }).waitFor({ timeout: 5000 }));
      }
      // stepping through the finished game doesn't keep it again (so deleting it while it's on the board sticks)
      const before = await p.evaluate(() => localStorage.getItem('chess-video.games.v1'));
      await p.keyboard.press('ArrowLeft');
      await assert.doesNotReject(label.filter({ hasText: /2\. g4/ }).waitFor({ timeout: 5000 }));
      assert.equal(await p.evaluate(() => localStorage.getItem('chess-video.games.v1')), before);
      await p.keyboard.press('ArrowRight');
      // and one in progress, left for the free board (it asks, and says the game is kept)
      await menuItem('Play vs human…');
      await p.getByRole('radio', { name: '10+0' }).click();
      await p.getByRole('button', { name: 'Start game' }).click();
      await drag(b, 'e2', 'e4', false);
      await assert.doesNotReject(label.filter({ hasText: /1\. e4/ }).waitFor({ timeout: 5000 }));
      await menuItem('My games…');
      assert.equal(await rows.count(), 2);
      assert.match(await rows.nth(0).innerText(), /In progress · Black to move[\s\S]*10\+0 · 1 move[\s\S]*Playing now/);
      assert.equal(await rows.nth(0).getByRole('button').count(), 0, 'the game on the board has no buttons');
      assert.match(await rows.nth(1).innerText(), /0–1 · Checkmate[\s\S]*no clock · 4 moves · from the starting position/);
      await dialog.getByRole('button', { name: 'Close' }).click();
      await menuItem('Starting position');
      const leave = p.getByRole('dialog', { name: 'Leave this game?' });
      assert.match(await leave.innerText(), /stays in My games/);
      await p.waitForTimeout(1200);
      await leave.getByRole('button', { name: 'Leave the game' }).click();
      await assert.doesNotReject(label.filter({ hasText: /^Start$/ }).waitFor({ timeout: 5000 }));
      // it's kept as it was left: Black's time thinking so far used, the clock stopped
      const leftClock = await p.evaluate(() => JSON.parse(localStorage.getItem('chess-video.games.v1'))[0].board.game.clock);
      assert.ok(leftClock.since === null && leftClock.left.b <= 600000 - 1200 && leftClock.left.w === 600000, JSON.stringify(leftClock));
      // kept through a reload: Resume brings the game back on the board, Black to move, Black's clock running from then
      await p.reload({ waitUntil: 'load' });
      await loadedOn(p);
      await menuItem('My games…');
      await p.screenshot({ path: path.join(OUT, host + '-my-games.png') });
      const kept = await p.evaluate(() => localStorage.getItem('chess-video.games.v1'));
      await rows.nth(0).getByRole('button', { name: 'Resume' }).click();
      await assert.doesNotReject(dialog.waitFor({ state: 'detached', timeout: 3000 }));
      await assert.doesNotReject(label.filter({ hasText: /1\. e4/ }).waitFor({ timeout: 5000 }));
      assert.match(await panel('Game'), /Black to move/);
      await p.waitForTimeout(1500);
      const clocks = await p.locator('.game-clock').allInnerTexts();
      assert.ok(clocks.includes('10:00') && clocks.some((c) => /^9:5\d$/.test(c)), `White's clock still, Black's running: ${clocks}`);
      // Replay from a game in progress asks first; the finished game opens in the replay, with Save PGN and export
      await menuItem('My games…');
      await rows.nth(1).getByRole('button', { name: 'Replay' }).click();
      await leave.getByRole('button', { name: 'Leave the game' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: 'Play (space)' }).waitFor({ timeout: 5000 }));
      await p.locator('.pdock').getByRole('button', { name: 'Settings' }).click();
      assert.match(await p.locator('.twk-note').first().innerText(), /White – Black · 4 plies/);
      await p.getByRole('tab', { name: 'Commentary' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: 'Save as annotated PGN' }).waitFor({ timeout: 5000 }));
      await p.getByRole('tab', { name: 'Export' }).click();
      await assert.doesNotReject(p.getByRole('button', { name: /^Export (video|animated WebP)/ }).waitFor({ timeout: 5000 }));
      await p.getByRole('button', { name: 'Close settings' }).click();
      // Delete asks in the row; Keep keeps, Delete deletes
      await menuItem('My games…');
      await rows.nth(1).getByRole('button', { name: 'Delete' }).click();
      assert.match(await rows.nth(1).innerText(), /Delete this game\?/);
      await p.screenshot({ path: path.join(OUT, host + '-my-games-delete.png') });
      await rows.nth(1).getByRole('button', { name: 'Keep' }).click();
      assert.equal(await rows.count(), 2);
      assert.equal(await rows.nth(1).getByRole('button', { name: 'Delete' }).evaluate((el) => el === document.activeElement), true, 'focus on the row\'s Delete after Keep');
      await rows.nth(1).getByRole('button', { name: 'Delete' }).click();
      await rows.nth(1).getByRole('button', { name: 'Delete', exact: true }).click();
      assert.equal(await rows.count(), 1);
      assert.equal(await dialog.getByRole('button', { name: 'Close' }).evaluate((el) => el === document.activeElement), true, 'focus on Close after Delete');
      assert.match(await rows.nth(0).innerText(), /In progress/);
      await p.keyboard.press('Escape');
      await assert.doesNotReject(dialog.waitFor({ state: 'detached', timeout: 3000 }));
      assert.deepEqual(g.errors, []);
      await g.ctx.close();
      // the phone: My games from the folded menu
      const ph = await open(browser, { width: 390, height: 844 }, phone({}));
      const pp = ph.page;
      await pp.goto(base, { waitUntil: 'load' });
      await loadedOn(pp);
      await pp.evaluate((games) => localStorage.setItem('chess-video.games.v1', games), kept);
      await pp.getByRole('button', { name: 'Menu' }).click();
      await pp.getByRole('button', { name: 'My games…' }).click();
      await assert.doesNotReject(pp.getByRole('dialog', { name: 'My games' }).waitFor({ timeout: 3000 }));
      assert.deepEqual(await wider(pp), [], 'no sideways scroll');
      assert.equal(await pp.locator('.games-row').count(), 2);
      await pp.screenshot({ path: path.join(OUT, host + '-my-games-phone.png') });
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
    await ctx.close();

    // sw.js keeps the page and its files: with the connection gone, a reload still opens the player, Stockfish still
    // rates a move, and the page says it's offline until the connection is back
    await t.test('desktop: offline, the page reloads from its kept copy, says so, and Stockfish still runs (Chromium)', async () => {
      const off = await open(browser, { width: 1440, height: 900 });
      const p = off.page;
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 20000 });
      // the install has kept the engine (it activates, and so controls the page, only once everything is kept)
      assert.ok(await p.evaluate(async (sf) => !!(await caches.match(sf + '.wasm')), SF), 'the engine is kept');
      // and every font file the fonts' stylesheet names (one missed shows as a font that can't load offline)
      assert.deepEqual(await p.evaluate(async () => {
        const css = await (await caches.match('https://fonts.googleapis.com/css2', { ignoreSearch: true })).text();
        const out = [];
        for (const m of css.matchAll(/url\((https:[^)]+)\)/g)) if (!(await caches.match(m[1]))) out.push(m[1]);
        return out;
      }), [], 'font files not kept');
      // a reload cuts off a font still downloading, which Firefox reports as an error; going offline shows the offline
      // note, whose text is the first in a face not used yet (IBM Plex Sans 500), so its font starts loading only then
      await p.evaluate(() => document.fonts.ready);
      await off.ctx.setOffline(true);
      await assert.doesNotReject(p.locator('.net-note').filter({ hasText: /offline/ }).waitFor({ timeout: 5000 }));
      await p.evaluate(() => document.fonts.ready);
      // Playwright's WebKit fails an offline reload itself ("WebKit encountered an internal error"), before the service
      // worker can answer it, so the rest is left to Chromium and Firefox
      if (name === 'webkit') { assert.deepEqual(off.errors, []); await off.ctx.close(); return; }
      await p.reload({ waitUntil: 'load' });
      await loadedOn(p);
      await assert.doesNotReject(p.locator('.net-chip').waitFor({ timeout: 5000 }));
      await assert.doesNotReject(p.locator('.net-note').filter({ hasText: /offline/ }).waitFor({ timeout: 5000 }));
      // Firefox's offline emulation (WebDriver BiDi) fails the page's no-store requests even when the service worker
      // answers them, and Stockfish checks its file with one; with the server really gone, Firefox runs it as Chromium does
      if (name !== 'firefox') {
        const b = await boardBox(p);
        const from = square(b, 'd2'), to = square(b, 'd4');
        await p.mouse.move(from.x, from.y);
        await p.mouse.down();
        await p.mouse.move(to.x, to.y, { steps: 8 });
        await p.mouse.up();
        await p.waitForFunction(() => /your move · .*(stockfish’s choice|cp vs|as good as|can’t run here|stopped)/i.test(document.body.innerText), null, { timeout: 45000 });
        assert.doesNotMatch(await p.getByText(/your move ·/i).innerText(), /can’t run here|stopped/i);
      }
      await p.screenshot({ path: path.join(OUT, host + '-offline.png') });
      await off.ctx.setOffline(false);
      await assert.doesNotReject(p.locator('.net-note').filter({ hasText: 'Back online.' }).waitFor({ timeout: 5000 }));
      assert.equal(await p.locator('.net-chip').count(), 0, 'no Offline chip once back online');
      assert.deepEqual(off.errors, []);
      await off.ctx.close();
    });

    // Settings › Engine › Full: stockfish.js's full engine (99 MB) from unpkg, kept in its own cache, run from there, removed.
    // The real download (a route can't answer with a body this big: Chromium drops Playwright's connection)
    await t.test('desktop: the full engine downloads once, runs from its kept copy, and can be removed', { timeout: 420000 }, async (tt) => {
      const fe = await open(browser, { width: 1440, height: 900 });
      const p = fe.page;
      let hits = 0;
      fe.ctx.on('request', (r) => { if (r.url().startsWith('https://unpkg.com/stockfish@19.0.1/bin/')) hits++; });
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      const openEngine = async () => {
        await p.getByRole('button', { name: 'Settings' }).click();
        await p.getByRole('tab', { name: 'Engine' }).click();
      };
      // an own move, rated by Lite first
      const b = await boardBox(p);
      const from = square(b, 'd2'), to = square(b, 'd4');
      await p.mouse.move(from.x, from.y);
      await p.mouse.down();
      await p.mouse.move(to.x, to.y, { steps: 8 });
      await p.mouse.up();
      const rated = /your move · .*(stockfish’s choice|cp vs|as good as|can’t run here|stopped)/i;
      await p.waitForFunction((re) => new RegExp(re, 'i').test(document.body.innerText), rated.source, { timeout: 60000 });
      assert.match(await p.evaluate(() => document.body.innerText), /Stockfish 19 lite · depth \d+/i);
      await openEngine();
      await p.getByRole('radiogroup', { name: 'Engine' }).getByRole('radio', { name: /^Full · 99 MB/ }).click();
      const remove = p.getByRole('button', { name: /^Remove the full engine download/ }), failed = p.getByText(/^Download failed: /);
      // unpkg is a third party: a download that fails (a stalled connection is given up after 30 s) is tried once more,
      // and a failure says how far it got
      let tries = 0;
      for (;;) {
        tries++;
        await p.getByRole('button', { name: /^Download full Stockfish · 99 MB/ }).click();
        try { await remove.or(failed).waitFor({ timeout: 180000 }); } catch (e) {
          throw new Error('the download neither finished nor failed in 180 s: ' + await p.getByText(/^Downloading full Stockfish/).innerText({ timeout: 1000 }).catch(() => '(no progress shown)'));
        }
        if (await remove.isVisible()) break;
        const why = await failed.innerText();
        if (tries === 2) throw new Error('the download failed twice: ' + why);
        tt.diagnostic('retrying the download after: ' + why);
      }
      // a failed try may have fetched one file or both
      if (tries === 1) assert.equal(hits, 2, 'both files fetched once');
      const fetched = hits;
      await assert.doesNotReject(p.getByText(/^Stockfish 19 runs in your browser/).waitFor({ timeout: 3000 }));
      await p.screenshot({ path: path.join(OUT, host + '-engine-full.png') });
      // the same move is searched again by the full engine once it is kept, with no move played and Settings still open
      // (Escape would leave the line too): the panels' search once got the lite engine being quit, and stayed on
      // "thinking". The Analysis header names the engine
      await p.waitForFunction(() => /Stockfish 19 · depth \d+/i.test(document.body.innerText), null, { timeout: 60000 });
      await p.waitForFunction((re) => new RegExp(re, 'i').test(document.body.innerText), rated.source, { timeout: 60000 });
      assert.doesNotMatch(await p.getByText(/your move ·/i).innerText(), /can’t run here|stopped/i);
      // a reload finds the kept copy: nothing fetched again
      await p.reload({ waitUntil: 'load' });
      await loadedOn(p);
      await openEngine();
      await remove.waitFor({ timeout: 10000 });
      assert.equal(hits, fetched, 'nothing fetched after a reload');
      // Remove asks first: Keep leaves the copy, Remove deletes it
      await remove.click();
      await p.getByRole('button', { name: 'Keep', exact: true }).click();
      assert.equal(await p.evaluate(async () => (await caches.keys()).includes('stockfish-full-19')), true, 'Keep keeps the copy');
      await remove.click();
      await assert.doesNotReject(p.getByText(/^Remove the full engine\? You’d need to download 99 MB again/).waitFor({ timeout: 3000 }));
      await p.getByRole('button', { name: 'Remove', exact: true }).click();
      await assert.doesNotReject(p.getByRole('button', { name: /^Download full Stockfish/ }).waitFor({ timeout: 5000 }));
      await assert.doesNotReject(p.getByText(/^Stockfish 19 lite runs in your browser/).waitFor({ timeout: 3000 }));
      assert.equal(await p.evaluate(async () => (await caches.keys()).includes('stockfish-full-19')), false, 'the copy is gone');
      assert.deepEqual(fe.errors, []);
      await fe.ctx.close();
    });

    // a pinch doesn't zoom the page (Chromium only: the pinch is a DevTools gesture, and Firefox has no phone emulation)
    if (name === 'chromium') await t.test('phone: a pinch doesn\'t zoom the page', async () => {
      const ph = await open(browser, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
      await ph.page.goto(base, { waitUntil: 'load' });
      await loadedOn(ph.page);
      const cdp = await ph.ctx.newCDPSession(ph.page);
      await cdp.send('Input.synthesizePinchGesture', { x: 200, y: 400, scaleFactor: 2.5 });
      assert.equal(await ph.page.evaluate(() => visualViewport.scale), 1);
      await ph.ctx.close();
    });

    await t.test('phone: the layout fits the width and folds the buttons into a menu', async () => {
      // Firefox has no mobile emulation in Playwright: there it is a narrow window with touch
      const ph = await open(browser, { width: 390, height: 844 }, phone({ hasTouch: true }));
      // every frame from the first is checked for sideways overflow: the dock's buttons once showed unfolded for a frame
      // or two before the phone layout folded them, wider than the screen
      await ph.page.addInitScript(() => {
        window.__wide = [];
        const t0 = performance.now();
        const tick = () => {
          const d = document.documentElement;
          if (d && d.scrollWidth > window.innerWidth) window.__wide.push(`${Math.round(performance.now() - t0)} ms: ${d.scrollWidth} px`);
          if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await ph.page.goto(base, { waitUntil: 'load' });
      const menu = ph.page.getByRole('button', { name: 'Menu' });
      await menu.waitFor();
      await ph.page.waitForTimeout(3000);
      assert.deepEqual(await ph.page.evaluate(() => window.__wide), [], 'frames wider than the window');
      assert.deepEqual(await wider(ph.page), [], 'no sideways scroll');
      assert.equal((await boardBox(ph.page)).n, 32);
      await ph.page.screenshot({ path: path.join(OUT, host + '-phone.png') });
      await menu.click();
      await assert.doesNotReject(ph.page.getByRole('button', { name: 'Ask Queen' }).waitFor({ state: 'visible', timeout: 3000 }));
      // WebKit with the iPhone profile has no element full screen, as iPhone Safari: the menu leaves the item out
      if (!(await ph.page.evaluate(() => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled)))) {
        assert.equal(await ph.page.getByRole('button', { name: 'Full screen', exact: true }).count(), 0, 'Full screen offered without full screen');
        assert.deepEqual(ph.errors, []);
        await ph.ctx.close();
        return;
      }
      // Chromium and Firefox support element full screen, so the menu offers it; the label follows fullscreenchange
      const fsOn = () => ph.page.evaluate(() => !!document.fullscreenElement);
      await ph.page.getByRole('button', { name: 'Full screen', exact: true }).click();
      await ph.page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 3000 });
      // upright in full screen, a fixed gap clears the camera's punch hole (a coarse pointer only: not Firefox's window)
      if (name === 'chromium') assert.equal(await ph.page.evaluate(() => getComputedStyle(document.documentElement).paddingTop), '24px');
      // headless Firefox's full screen is its 1366×768 screen, where the page lays out for a desktop: no menu
      if (await menu.isVisible()) await menu.click();
      await ph.page.getByRole('button', { name: 'Exit full screen' }).click();
      await ph.page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 3000 });
      assert.equal(await fsOn(), false);
      await menu.click();
      await assert.doesNotReject(ph.page.getByRole('button', { name: 'Full screen', exact: true }).waitFor({ state: 'visible', timeout: 3000 }));
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });

    // a phone held sideways used to get the 16:9 video shrunk to a board about 230 px high
    await t.test('phone held sideways: the board fills the height and the buttons fold into a menu', async () => {
      const ph = await open(browser, { width: 844, height: 390 });
      await ph.page.goto(base, { waitUntil: 'load' });
      await ph.page.getByRole('button', { name: 'Menu' }).waitFor();
      assert.deepEqual(await wider(ph.page), [], 'no sideways scroll');
      const b = await boardBox(ph.page);
      assert.equal(b.n, 32);
      assert.ok(b.h > 260, `board ${Math.round(b.h)} px high`);
      await ph.page.screenshot({ path: path.join(OUT, host + '-phone-sideways.png') });
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
  });
}
