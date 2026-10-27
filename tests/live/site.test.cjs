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
  // whatever the page's Content-Security-Policy blocks is an error, whether or not the browser logs it
  await ctx.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP blocked ${e.blockedURI || 'inline'} (${e.effectiveDirective})`)));
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
// elements inside the stage that clip their content (overflow hidden/clip) while it is bigger than the box; boxes that
// scroll (overflow-y auto) and the SideScroll strips (overflow-x auto) are meant to hold more than they show, but a box
// that scrolls up and down mustn't scroll sideways. Also the placed boxes (panels, bars, the board) reaching past the
// stage frame, which clips them
const overflowing = (page) => page.evaluate(() => {
  const out = [], frame = document.querySelector('.stage-frame'), fr = frame.getBoundingClientRect();
  const name = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.value || el.textContent || '').trim().slice(0, 30)}"`;
  const scrolls = (cs) => cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowX === 'auto' || cs.overflowX === 'scroll';
  for (const el of document.querySelectorAll('.stage-frame, .stage-frame *')) {
    const cs = getComputedStyle(el);
    // a box that scrolls up and down (a panel) scrolling sideways too: something in it is wider than the panel
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.tagName !== 'TEXTAREA' && el.scrollWidth > el.clientWidth + 1) out.push(`${name(el)} scrolls sideways ${el.scrollWidth} in ${el.clientWidth}`);
    if (scrolls(cs)) continue;
    if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip' && cs.overflowY !== 'hidden' && cs.overflowY !== 'clip') continue;
    // text cut with an ellipsis (names, by design) says it is cut; a 1 px box is text for screen readers only; a text
    // field scrolls its own text
    if (cs.textOverflow === 'ellipsis' || (el.clientWidth <= 1 && el.clientHeight <= 1) || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') continue;
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) out.push(`${name(el)} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
  }
  // absolutely placed boxes not inside a box that scrolls (whose contents may be scrolled out of it on purpose)
  for (const el of frame.querySelectorAll('*')) {
    if (getComputedStyle(el).position !== 'absolute') continue;
    let a = el.parentElement, inScroll = false;
    for (; a && a !== frame; a = a.parentElement) if (scrolls(getComputedStyle(a))) { inScroll = true; break; }
    if (inScroll) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.left < fr.left - 1 || r.top < fr.top - 1 || r.right > fr.right + 1 || r.bottom > fr.bottom + 1) out.push(`${name(el)} ${Math.round(r.left - fr.left)},${Math.round(r.top - fr.top)} ${Math.round(r.width)}x${Math.round(r.height)} past the frame ${Math.round(fr.width)}x${Math.round(fr.height)}`);
  }
  return out.slice(0, 8);
});
// the player bars' names matching re, top first: the leaf text over the board's own column (the header's names sit in
// the sidebar beside it, or under it in one column, so they are kept out by being past the bars)
const barNames = async (page, re) => {
  const b = await boardBox(page);
  return page.evaluate(({ src, b }) => {
    const re = new RegExp(src), right = b.x0 + 8 * b.sq;
    return [...document.querySelectorAll('span')].filter((e) => e.children.length === 0 && re.test(e.textContent)).map((e) => ({ text: e.textContent, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.left < right && r.right > b.x0 && r.bottom > b.y0 - 2 * b.sq && r.top < b.y0 + b.h + 2 * b.sq && (r.bottom <= b.y0 + 1 || r.top >= b.y0 + b.h - 1))
      .sort((x, y) => x.r.top - y.r.top).map(({ text, r }) => ({ text, top: r.top }));
  }, { src: re.source, b });
};
// Edit position's board: its touch layer's box (centred, no eval bar, so not where the replay's board stands)
const editBox = async (page) => {
  const r = await page.locator('[title="Drag a piece to move it, or off the board to take it away"], [title="Tap squares to place the piece"]').boundingBox();
  return { n: 0, x0: r.x, y0: r.y, sq: r.width / 8, h: r.height };
};
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
    if (ONLY) { const sub = t.test.bind(t); t.test = (n, ...rest) => (ONLY.test(n) ? sub(n, ...rest) : sub(n, { skip: 'LIVE_ONLY' }, rest[rest.length - 1])); }
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
      assert.deepEqual(await tabs.allInnerTexts(), ['Game', 'View', 'Online', 'Commentary', 'Export', 'Sound']);
      await tabs.first().focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByRole('tab', { name: 'View' }).getAttribute('aria-selected'), 'true');
      await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click();
      await page.reload({ waitUntil: 'load' });
      await loaded();
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-scheme')), 'dark');
    });

    await t.test('desktop: Text size Larger grows the text and keeps it in its boxes', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base, { waitUntil: 'load' });
      await loaded();
      const size = (sel) => page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('tab', { name: 'View' }).click();
      const mv = await size('.mv'), hd = await size('.twk-hd b');
      try {
        await page.locator('#tw-text-size').selectOption('Larger');
        await page.waitForFunction((was) => parseFloat(getComputedStyle(document.querySelector('.mv')).fontSize) > was * 1.1, mv);
        assert.ok(Math.abs((await size('.mv')) - mv * 1.3) <= 0.2, `.mv grew 1.3x from ${mv} to ${await size('.mv')}`);
        assert.ok(Math.abs((await size('.twk-hd b')) - hd * 1.3) <= 0.2, 'the Settings heading grew');
        assert.deepEqual(await overflowing(page), []);
        await page.screenshot({ path: path.join(OUT, host + '-text-larger.png') });
      } finally {
        await page.locator('#tw-text-size').selectOption('Default');
        await page.getByRole('button', { name: 'Close settings' }).click();
      }
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

    // any box that scrolls takes a mouse drag, as the Moves panel does, and nothing outside a text field selects
    // (640 px tall: at 900 no tab overflows since the engine settings moved to the Analysis panel)
    await t.test('desktop: Settings scrolls with a mouse drag, and a drag selects no text', async () => {
      await page.setViewportSize({ width: 1440, height: 640 });
      await page.getByRole('button', { name: 'Settings' }).click();
      const body = page.locator('.twk-body'), tabs = page.getByRole('tablist', { name: 'Settings' }).getByRole('tab');
      let tall = false;
      for (const tab of await tabs.all()) {
        await tab.click();
        if (await body.evaluate((el) => el.scrollHeight > el.clientHeight + 40)) { tall = true; break; }
      }
      assert.ok(tall, 'a Settings tab overflows');
      // pressed on text, not a control (a drag from a field or a slider is its own)
      const at = await body.evaluate((el) => {
        const r = el.getBoundingClientRect();
        for (let y = r.bottom - 20; y > r.top + r.height * 0.5; y -= 6) {
          for (const x of [r.left + 24, r.left + r.width * 0.5]) {
            const hit = document.elementFromPoint(x, y);
            if (hit && el.contains(hit) && !hit.closest('input, select, textarea, button, [role="slider"], [role="radio"]')) return { x, y };
          }
        }
        return null;
      });
      assert.ok(at, 'text to press on in Settings');
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x, at.y - 200, { steps: 8 });
      await page.mouse.up();
      assert.ok(await body.evaluate((el) => el.scrollTop) > 40, 'the drag scrolled Settings');
      assert.equal(await page.evaluate(() => String(window.getSelection())), '', 'no text selected');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).userSelect), 'none');
      await page.keyboard.press('Escape');
      await assert.doesNotReject(body.waitFor({ state: 'detached', timeout: 3000 }));
      await page.setViewportSize({ width: 1440, height: 900 });
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
      await page.waitForFunction(() => document.querySelector('.moves-list').scrollTop > 0, null, { timeout: 3000 });
      const at = await page.locator('.plabel').innerText(), end = await top();
      const r = await list.boundingBox();
      await page.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.9, { steps: 8 });
      await page.mouse.up();
      assert.ok(await top() < end, 'the drag scrolled the list up');
      assert.equal(await page.evaluate(() => String(window.getSelection())), '', 'no text selected');
      assert.equal(await page.locator('.plabel').innerText(), at, 'the drag picked no move');
      // let go while moving, the list glides on: wait until it stops
      let dragged = await top();
      for (let i = 0; i < 40; i++) { await page.waitForTimeout(100); const now = await top(); if (now === dragged) break; dragged = now; }
      assert.ok(dragged < end, 'the glide left the list scrolled up');
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
      // the sample game's players, in the bars over and under the board
      const barTops = async (re) => (await barNames(fl.page, re)).map((x) => x.top);
      const bars = { white: await barTops(/^Carlsen/), black: await barTops(/^Nepomniachtchi/) };
      assert.ok(bars.white.length && bars.black.length, 'player bars found: ' + JSON.stringify(bars));
      const bt = await boardBox(fl.page);
      assert.ok(Math.min(...bars.white) < bt.y0, 'the White bar is above the board');
      assert.ok(Math.min(...bars.black) > bt.y0 + bt.h - 1, 'the Black bar is below the board');
      // the eval bar's white part is at its top
      const white = await fl.page.evaluate((b) => {
        // the eval bar: a thin clipped box as tall as the board, left of it (its width depends on the device tier)
        const bar = [...document.querySelectorAll('div')].find((d) => { const r = d.getBoundingClientRect(); return r.width >= 6 && r.width <= 40 && r.right <= b.x0 + 1 && Math.abs(r.height - b.h) < 2 && getComputedStyle(d).overflow === 'hidden'; });
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
      const moves = await fp.page.locator('[data-ply="0"]').evaluate((el) => el.closest('.moves-list').innerText);
      assert.match(moves, /3…\s*Nf6\s*4\.\s*Nc3\s*Bc5/);
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
    // every view at every size, Default and Larger text: nothing clipped, no panel past the stage, the transport bar on
    // screen. 390×400 is a phone with its keyboard up: too short for the one-column page to fit, too narrow for two
    await t.test('layout: nothing cut off at any size', { timeout: 600000 }, async () => {
      const SIZES = [[1920, 1080], [1440, 900], [1280, 600], [1024, 768], [768, 1024], [844, 390], [390, 844], [320, 568], [2560, 1080], [390, 400]];
      const fails = [];
      for (const [w, h] of SIZES) for (const text of ['Default', 'Larger']) {
        const lc = await open(browser, { width: w, height: h });
        const p = lc.page;
        if (text !== 'Default') await p.addInitScript((v) => { try { localStorage.setItem('chess-video.tweaks.v1', JSON.stringify({ textSize: v })); } catch (e) {} }, text);
        await p.goto(base, { waitUntil: 'load' });
        await loadedOn(p);
        // the folded menu on a phone layout, Play/Explore otherwise
        const pick = async (item) => {
          const menu = p.getByRole('button', { name: 'Menu' });
          await ((await menu.isVisible()) ? menu : p.getByRole('button', { name: 'Play/Explore' })).click();
          await p.getByRole('button', { name: item }).click();
        };
        const check = async (view) => {
          await p.waitForTimeout(300);
          const at = `${w}x${h} ${view} ${text}`;
          for (const o of await overflowing(p)) fails.push(`${at}: ${o}`);
          const vp = { w, h };
          const inside = async (loc, what) => {
            const r = await loc.boundingBox();
            if (!r || r.x < -0.5 || r.y < -0.5 || r.x + r.width > vp.w + 0.5 || r.y + r.height > vp.h + 0.5) fails.push(`${at}: ${what} not inside the window ${JSON.stringify(r)}`);
          };
          await inside(p.locator('.pbar'), 'transport bar');
          const play = p.getByRole('button', { name: 'Play (space)' });
          if (await play.count()) await inside(play, 'play button');
          // the one-column page from its top (picking the move scrolled it)
          await p.locator('.stage-area').evaluate((a) => { a.scrollTop = 0; });
          await p.screenshot({ path: path.join(OUT, `${host}-layout-${w}x${h}-${view}-${text}.png`) });
        };
        // the sample game paused at move 20
        await p.locator('[data-ply="38"]').click();
        await p.locator('.plabel').filter({ hasText: /^20\. / }).waitFor({ state: 'attached', timeout: 5000 });
        await check('replay');
        await pick('Starting position');
        await p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 });
        await check('free');
        await pick('Edit position…');
        await p.getByRole('textbox', { name: 'FEN' }).waitFor({ timeout: 5000 });
        await check('edit');
        for (const e of lc.errors) fails.push(`${w}x${h} ${text}: ${e}`);
        await lc.ctx.close();
      }
      assert.deepEqual(fails, []);
    });
    // a piece selected on the free board stays selected while the window crosses from two columns to one and back
    await t.test('layout: a selection survives a resize across the column switch', async () => {
      const rs = await open(browser, { width: 1100, height: 800 });
      const p = rs.page;
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      await p.getByRole('button', { name: 'Play/Explore' }).click();
      await p.getByRole('button', { name: 'Starting position' }).click();
      await p.getByRole('button', { name: 'Play (space)' }).waitFor({ state: 'detached', timeout: 5000 });
      const e2 = square(await boardBox(p), 'e2');
      await p.mouse.click(e2.x, e2.y);
      // the selection: the touch layer's square with the thick border
      const selected = () => p.evaluate(() => [...document.querySelectorAll('[data-no-drag-scroll] > div')].some((d) => getComputedStyle(d).borderTopWidth === '5px'));
      const cols = () => p.evaluate(() => (document.querySelector('.stage').classList.contains('stage-one') ? 1 : 2));
      assert.equal(await selected(), true, 'e2 selected');
      assert.equal(await cols(), 2);
      for (const [width, want] of [[700, 1], [1100, 2]]) {
        await p.setViewportSize({ width, height: 800 });
        await p.waitForFunction((c) => document.querySelector('.stage').classList.contains('stage-one') === (c === 1), want, { timeout: 5000 });
        assert.equal(await selected(), true, `still selected at ${width} px`);
      }
      assert.deepEqual(rs.errors, []);
      await rs.ctx.close();
    });
    // Play/Explore → Starting position: no game, every move (either side's) rated by Stockfish; it survives a reload
    // Analysis › ☰ › Lines 3: the free board's Analysis lists three lines, each with its arrow
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
      await p.getByRole('button', { name: 'Engine options' }).click();
      assert.equal(await p.locator('#tw-sf-lines').inputValue(), '3');
      assert.deepEqual(nb.errors, []);
      await nb.ctx.close();
    });

    await t.test('desktop: the free board sets up the starting position and rates both sides\' moves', async () => {
      const nb = await open(browser, { width: 1440, height: 900 });
      const p = nb.page, label = p.locator('.plabel');
      // a panel's text, found by its title (the title span's own text, before CSS upper-cases it; the upper-casing keeps the header's event row out)
      const panel = (title) => p.evaluate((tt) => { const d = [...document.querySelectorAll('div')].find((e) => e.firstElementChild && e.firstElementChild.firstElementChild && e.firstElementChild.firstElementChild.textContent === tt && getComputedStyle(e.firstElementChild).textTransform === 'uppercase'); return d ? d.innerText : ''; }, title);
      // the Analysis headline: the move it rates, the largest move text on the page
      const headline = () => p.evaluate(() => { const s = [...document.querySelectorAll('span')].filter((e) => /^\d+(\.|…) /.test(e.textContent)).sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0]; return s ? s.textContent : null; });
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
      await assert.doesNotReject(p.waitForFunction(() => { const f = document.querySelector('.fen-note-fen'); return f && f.value === '4k3/4R3/8/8/8/8/8/4K3 b - - 0 1'; }, null, { timeout: 5000 }));
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
        await p.getByRole('button', { name: 'Play/Explore' }).click();
        await p.getByRole('button', { name: 'Edit position…' }).click();
        const field = p.getByRole('textbox', { name: 'FEN' }), tray = (n) => p.getByRole('button', { name: n, exact: true });
        await assert.doesNotReject(field.waitFor({ timeout: 5000 }));
        // the editor's own board gives the squares (flipped too)
        const b = await editBox(p), sqAt = (s) => square(b, s, flip);
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
      // the editor's board is centred (no eval bar): its squares from its own box, measured after the tray's click,
      // which can scroll the page (Playwright's Firefox scrolled it ~29 px)
      await p.getByRole('button', { name: 'White king', exact: true }).click();
      const e1 = square(await editBox(p), 'e1');
      await p.mouse.click(e1.x, e1.y);
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
    // the endgame tablebase (Lichess, the real service): at 7 pieces or fewer it takes the opening explorer's place and the
    // eval bar shows its result, a move from it plays on the board; more pieces, or the setting off, and nothing is sent
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
      await p.waitForFunction(() => /Endgame tablebase\s+DTZ 55 · DTM 55\s+White wins/i.test(document.body.innerText), null, { timeout: 20000 });
      assert.match(await text(), /TB M28/, 'the eval bar shows the mate');
      assert.doesNotMatch(await text(), /Opening explorer/, 'in place of the explorer');
      // every move a button, side by side in rows, with no distances written beside them
      assert.equal(await p.locator('.tb-move').count() > 10, true, 'every move listed');
      const [m0, m1] = await Promise.all([0, 1].map((i) => p.locator('.tb-move').nth(i).boundingBox()));
      assert.ok(Math.abs(m0.y - m1.y) < 2 && m1.x > m0.x, 'the moves wrap in rows');
      assert.doesNotMatch(await p.locator('.tb-group').first().innerText(), /DTZ|DTM/);
      assert.deepEqual(sent, ['8/8/8/4k3/8/8/3KB3/7N w - - 0 1']);
      await p.screenshot({ path: path.join(OUT, host + '-tablebase.png') });
      // a move from the tablebase plays on the board, and Black's answer is a loss
      await p.locator('.tb-move', { hasText: /^Ke3(?![a-z0-9=+#])/ }).click();
      await assert.doesNotReject(p.locator('.plabel').filter({ hasText: /1\. Ke3/ }).waitFor({ timeout: 5000 }));
      await p.waitForFunction(() => /Endgame tablebase\s+DTZ 54/i.test(document.body.innerText), null, { timeout: 20000 });
      // back to the start: from the cache, nothing sent again
      await p.keyboard.press('ArrowLeft');
      await p.waitForFunction(() => /DTZ 55/.test(document.body.innerText), null, { timeout: 5000 });
      assert.equal(sent.length, 2);
      // the fifty-move count goes with the FEN: with 60 plies gone the same win is a cursed one
      await setUp('8/8/8/4k3/8/8/3KB3/7N w - - 60 80');
      await p.waitForFunction(() => /Endgame tablebase[\s\S]*Cursed win for White\s+drawn by the 50-move rule/i.test(document.body.innerText), null, { timeout: 20000 });
      assert.match(await text(), /TB 0\.00/);
      assert.equal(sent.length, 3);
      assert.equal(sent[2], '8/8/8/4k3/8/8/3KB3/7N w - - 60 80');
      // 8 pieces: the opening explorer again, nothing sent
      await setUp('8/8/8/3k4/pppp4/8/8/1N1NK3 w - - 0 1');
      await p.waitForTimeout(1500);
      assert.doesNotMatch(await text(), /Tablebase/);
      assert.match(await text(), /Opening explorer/i);
      assert.equal(sent.length, 3);
      // the setting off: a 5-piece position sends nothing
      await p.getByRole('button', { name: 'Settings' }).click();
      await p.getByRole('tab', { name: 'Online' }).click();
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
      // the run ends (its progress and the Analyse button gone) before a move is picked: the panel's own tablebase
      // lookup of a picked position would otherwise race the run's for the same position
      await p.waitForFunction(() => !/Analysing \d|Starting Stockfish|Analyse with Stockfish/i.test(document.body.innerText), null, { timeout: 19000 });
      assert.ok(Date.now() - t0 < 19000, 'no 20 s search');
      assert.equal(sent.filter((u) => u.includes('/standard?')).length, 5, 'each position asked once');
      assert.equal(sent.length, 5, 'nothing else asked');
      // on 2. Bc4+ the title row says "Tablebase" in place of a depth
      await p.locator('[data-ply="2"]').click();
      await assert.doesNotReject(p.locator('.plabel').filter({ hasText: /2\. Bc4\+/ }).waitFor({ timeout: 5000 }));
      await p.waitForFunction(() => /Blunder/i.test(document.body.innerText), null, { timeout: 5000 });
      assert.match(await p.evaluate(() => document.body.innerText), /Tablebase/i);
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
      // from the lowest row wholly in view (the panel's height follows the layout, so no named row is sure to be)
      const from = await p.evaluate(() => {
        const r = document.querySelector('.book-head').parentElement.parentElement.getBoundingClientRect();
        const rows = [...document.querySelectorAll('.book-moves [role="button"]')].map((e) => e.getBoundingClientRect()).filter((b) => b.top >= r.top && b.bottom <= r.bottom);
        const b = rows[rows.length - 1];
        return { x: b.x, y: b.y, height: b.height };
      });
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
      // the bars' names from the top of the board down
      const bars = async () => (await barNames(p, /^(You|Stockfish 19)$/)).map((x) => x.text);
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

    // Analysis › engine drop-down › Full: stockfish.js's full engine (99 MB) from unpkg, kept in its own cache, run from there, removed.
    // The real download (a route can't answer with a body this big: Chromium drops Playwright's connection)
    await t.test('desktop: the full engine downloads once, runs from its kept copy, and can be removed', { timeout: 420000 }, async (tt) => {
      const fe = await open(browser, { width: 1440, height: 900 });
      const p = fe.page;
      let hits = 0;
      fe.ctx.on('request', (r) => { if (r.url().startsWith('https://unpkg.com/stockfish@19.0.1/bin/')) hits++; });
      await p.goto(base, { waitUntil: 'load' });
      await loadedOn(p);
      // the Analysis panel's engine menu (☰), opened if it isn't
      const openEngine = async () => {
        const menu = p.getByRole('button', { name: 'Engine options' });
        if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
      };
      const engineSelect = p.getByRole('combobox', { name: 'Engine', exact: true });
      // the explanation behind the Analyse button's ⓘ (its tooltip on hover) names the engine running
      // (scrolled into view first: a hover that scrolls the panel closes the tip it opens, as any scroll does)
      const runs = async (name) => {
        const about = p.getByRole('button', { name: /^About (Analyse|Resume)/ });
        await about.scrollIntoViewIfNeeded();
        await p.waitForTimeout(200);
        await about.hover();
        await p.getByRole('tooltip').filter({ hasText: new RegExp('^' + name + ' runs in your browser') }).waitFor({ timeout: 3000 });
        await p.mouse.move(0, 0);
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
      assert.match(await p.evaluate(() => document.body.innerText), /depth \d+/i);
      assert.equal(await engineSelect.inputValue(), 'Lite');
      // picking Full before it is downloaded opens the engine menu, at its Download button
      await engineSelect.selectOption('Full');
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
      await assert.doesNotReject(runs('Stockfish 19'));
      await p.screenshot({ path: path.join(OUT, host + '-engine-full.png') });
      // the same move is searched again by the full engine once it is kept, with no move played and Settings still open
      // (Escape would leave the line too): the panels' search once got the lite engine being quit, and stayed on
      // "thinking"
      await p.getByRole('button', { name: 'Engine options' }).click();
      await p.waitForFunction(() => /depth \d+/i.test(document.body.innerText), null, { timeout: 60000 });
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
      await assert.doesNotReject(runs('Stockfish 19 lite'));
      assert.equal(await p.evaluate(async () => (await caches.keys()).includes('stockfish-full-19')), false, 'the copy is gone');
      assert.deepEqual(fe.errors, []);
      await fe.ctx.close();
    });

    // Export at screen size: the saved WebP is the stage area's size at the screen's density (held to 1920 px on its
    // longer side), whatever the page was scrolled to. Two moves, at the full width, to keep the canvas small
    const exportSize = async (p, tag) => {
      const area = await p.locator('.stage-area').evaluate((el) => ({ w: el.clientWidth, h: el.clientHeight })); // client: a classic scrollbar's gutter (Firefox) is in neither the page's width nor the video's
      const dpr = await p.evaluate(() => window.devicePixelRatio), s = Math.min(dpr, 1920 / Math.max(area.w, area.h));
      const even = (v) => 2 * Math.floor(v / 2);
      const settings = p.getByRole('button', { name: 'Settings' });
      if (!(await settings.isVisible())) await p.getByRole('button', { name: 'Menu' }).click();
      await settings.click();
      await p.getByRole('tab', { name: 'Export' }).click();
      await p.getByRole('radio', { name: 'WebP' }).click();
      await p.locator('#tw-webp-width').selectOption({ index: 0 });
      await p.locator('#tw-clip-from').selectOption({ index: 1 });
      await p.locator('#tw-clip-to').selectOption({ index: 1 });
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.getByRole('button', { name: /^Export animated WebP/ }).click()]);
      const file = path.join(OUT, `${tag}-export.webp`);
      await dl.saveAs(file);
      const buf = fs.readFileSync(file), vp8x = buf.indexOf('VP8X', 12);
      assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
      const got = { w: buf.readUIntLE(vp8x + 12, 3) + 1, h: buf.readUIntLE(vp8x + 15, 3) + 1 };
      assert.deepEqual(got, { w: even(area.w * s), h: even(area.h * s) }, `canvas for a ${area.w}×${area.h} area at ${dpr}×`);
      // a frame holds the rectangle that changed; the first is the whole canvas and none reaches outside it
      const anmf = [];
      for (let at = 12; at < buf.length;) {
        const id = buf.toString('ascii', at, at + 4), len = buf.readUInt32LE(at + 4);
        if (id === 'ANMF') anmf.push({ x: buf.readUIntLE(at + 8, 3) * 2, y: buf.readUIntLE(at + 11, 3) * 2, w: buf.readUIntLE(at + 14, 3) + 1, h: buf.readUIntLE(at + 17, 3) + 1 });
        at += 8 + len + (len & 1);
      }
      assert.ok(anmf.length >= 2, 'the clip has several frames');
      assert.deepEqual(anmf[0], { x: 0, y: 0, ...got }, 'the first frame is the whole canvas');
      for (const f of anmf) assert.ok(f.x + f.w <= got.w && f.y + f.h <= got.h, 'a frame inside the canvas');
      return { area, got };
    };
    await t.test('desktop: an export is the screen-sized page', { timeout: 180000 }, async () => {
      const dk = await open(browser, { width: 1440, height: 900 });
      await dk.page.goto(base, { waitUntil: 'load' });
      await loadedOn(dk.page);
      await exportSize(dk.page, host + '-desktop');
      await dk.page.getByRole('dialog', { name: 'Exporting' }).waitFor({ state: 'detached', timeout: 5000 });
      assert.deepEqual(dk.errors, []);
      await dk.ctx.close();
    });
    await t.test('phone: an export is the screen-sized page', { timeout: 180000 }, async () => {
      const ph = await open(browser, { width: 390, height: 844 }, { ...phone({ hasTouch: true }), deviceScaleFactor: 3 });
      await ph.page.goto(base, { waitUntil: 'load' });
      await loadedOn(ph.page);
      // scrolled down: the export still starts from the page's top, at the area's size
      await ph.page.locator('.stage-area').evaluate((el) => { el.scrollTop = 300; });
      const { area } = await exportSize(ph.page, host + '-phone');
      assert.ok(area.w <= 390 && area.h < 844, 'the area is inside the screen');
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
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
      // upright in full screen the page runs under the camera's cut-out: no gap kept for one this screen doesn't have
      if (name === 'chromium') assert.equal(await ph.page.evaluate(() => getComputedStyle(document.documentElement).paddingTop), '0px');
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
      // the slim transport bar, and the board as tall as the area leaves it: its margins (12 px) and the two player bars
      // (32 px and a 4 px gap each, at Default text) above and below it
      const area = await ph.page.evaluate(() => ({ h: document.querySelector('.stage-area').clientHeight, short: document.querySelector('.stage').classList.contains('stage-short') }));
      assert.ok(area.short, 'the slim bar');
      assert.ok(b.h >= area.h - 2 * 12 - 2 * 36 - 2 && b.h > 245, `board ${Math.round(b.h)} px high in an area ${area.h} px high`);
      await ph.page.screenshot({ path: path.join(OUT, host + '-phone-sideways.png') });
      assert.deepEqual(ph.errors, []);
      await ph.ctx.close();
    });
  });
}
