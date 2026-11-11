// Smoke tests in desktop Safari on macOS (Apple's own Safari, which Playwright can't drive: its WebKit is a build of its
// own), over WebDriver by safaridriver, against a build of this checkout served by serve.cjs, at the desktop layout
// (a 1440×900 page) with mouse and keyboard input: Play/Pause, stepping, the keyboard on the playhead and Moves panel,
// Settings (tabs, a setting kept over a reload, Flip board), Import game, a promotion, dialogs and Esc, full screen:
//   node --test tests/live/safari.test.cjs
// Needs macOS, WebdriverIO (`npm install --no-save webdriverio`) and `sudo safaridriver --enable` once. GitHub Actions
// runs it on a macOS runner (the `safari` job), with whichever Safari that runner's image has. The page is served as
// safari.html, the page with a logger in front of its scripts, as WebDriver can't read Safari's console. Screenshots go
// to tests/out/live/. ios.test.cjs is its iPhone counterpart.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http');
const { serve } = require('./serve.cjs');
const { boardBox, square } = require('./board.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SITE = path.join(ROOT, 'out', 'site');
const OUT = path.join(ROOT, 'tests', 'out', 'live');
const PORT = 8769, WD_PORT = 4445;
const VIEW = { w: 1440, h: 900 };
const VERDICT = /your move · .*(stockfish’s choice|cp vs|as good as|can’t run here|stopped)/i;

const wdUp = () => new Promise((ok) => http.get(`http://127.0.0.1:${WD_PORT}/status`, (r) => { r.resume(); ok(r.statusCode === 200); }).on('error', () => ok(false)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('macos · safari · local build', async (t) => {
  // undone last first, as t.after hooks run in the order they were added
  const undo = [];
  t.after(async () => { for (const f of undo.reverse()) { try { await f(); } catch (e) { t.diagnostic(`cleanup: ${e.message}`); } } });
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  // the page with the logger first in <head>: a file of the site, which the page's CSP allows ('self')
  fs.writeFileSync(path.join(SITE, 'safari-log.js'), `window.__errs = [];
addEventListener('error', (e) => __errs.push('error: ' + e.message + ' ' + (e.filename || '') + ':' + (e.lineno || '')));
addEventListener('unhandledrejection', (e) => __errs.push('unhandled rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
addEventListener('securitypolicyviolation', (e) => __errs.push('CSP: ' + e.violatedDirective + ' ' + e.blockedURI));
const ce = console.error; console.error = (...a) => { __errs.push(a.map(String).join(' ')); ce.apply(console, a); };
`);
  const html = fs.readFileSync(path.join(SITE, 'chess-game-video.html'), 'utf8');
  fs.writeFileSync(path.join(SITE, 'safari.html'), html.replace('<head>', '<head><script src="safari-log.js"></script>'));
  undo.push(() => { for (const f of ['safari.html', 'safari-log.js']) fs.rmSync(path.join(SITE, f), { force: true }); });
  const local = await serve(SITE, PORT);
  undo.push(() => local.close());
  const URL_ = local.url + 'safari.html';

  const wd = spawn('safaridriver', ['-p', String(WD_PORT)], { stdio: 'inherit' });
  undo.push(() => wd.kill());
  for (let i = 0; i < 50 && !(await wdUp()); i++) await wait(200);
  const { remote, Key } = await import('webdriverio');
  let browser;
  for (let i = 1; !browser; i++) {
    try {
      browser = await remote({ hostname: '127.0.0.1', port: WD_PORT, path: '/', logLevel: 'error', connectionRetryTimeout: 120000, connectionRetryCount: 0, capabilities: { browserName: 'safari' } });
    } catch (e) {
      t.diagnostic(`session, try ${i}: ${e.message.slice(0, 160)}`);
      if (i === 3) throw e;
      await wait(5000);
    }
  }
  undo.push(() => browser.deleteSession());
  t.diagnostic(`Safari ${browser.capabilities.browserVersion} · ${browser.capabilities.platformName || ''}`);
  await browser.setTimeout({ script: 15000 });

  // Playwright's page.evaluate, for board.cjs
  const page = { evaluate: (fn, ...a) => browser.execute(fn, ...a) };
  const js = (fn, ...a) => browser.execute(fn, ...a);
  const until = (fn, timeout, msg, ...a) => browser.waitUntil(() => js(fn, ...a), { timeout, interval: 250, timeoutMsg: msg });
  const errors = () => js(() => window.__errs || ['the logger did not load']);
  const shot = (name) => browser.saveScreenshot(path.join(OUT, `safari-${name}.png`));
  const mouse = () => browser.action('pointer', { parameters: { pointerType: 'mouse' } });
  const click = (x, y) => mouse().move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' }).down().pause(50).up().perform();
  // a drag in small steps, as a hand moves a piece
  const drag = async (a, b) => {
    let act = mouse().move({ x: Math.round(a.x), y: Math.round(a.y), origin: 'viewport' }).down().pause(100);
    for (let i = 1; i <= 10; i++) act = act.move({ x: Math.round(a.x + (b.x - a.x) * i / 10), y: Math.round(a.y + (b.y - a.y) * i / 10), origin: 'viewport', duration: 20 });
    await act.pause(100).up().perform();
  };
  // a shown button by its accessible name (aria-label, else its text), as getByRole finds it
  const button = (name) => js((n) => {
    const b = [...document.querySelectorAll('button, [role="button"], [role="tab"]')].find((e) => (e.getAttribute('aria-label') || e.innerText || '').trim() === n && e.getClientRects().length);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, name);
  const clickButton = async (name) => { const b = await button(name); assert.ok(b, `no ${name} button`); await click(b.x, b.y); };
  // clicks name (when it's shown) until done() holds, 8 s after each click, three clicks at most (as ios.test.cjs taps:
  // a CI Mac is slow at times)
  const clickUntil = async (name, done, msg) => {
    for (let i = 0; i < 3; i++) {
      if (await done()) return;
      if (await button(name)) await clickButton(name);
      if (await browser.waitUntil(done, { timeout: 8000, interval: 250 }).then(() => true, () => false)) return;
    }
    throw new Error(msg);
  };
  const loaded = () => until(() => !!document.querySelector('.dock-primary') && document.querySelectorAll('img').length >= 32, 60000, 'the page did not load');
  const fresh = async () => { await browser.url(URL_); await loaded(); await wait(1000); };

  await browser.url(URL_);
  await js(() => { localStorage.clear(); localStorage.setItem('chess-video.tweaks.v1', '{"sfOn":true}'); }); // the Stockfish switch on
  // the window sized so the page is VIEW: the window's frame and toolbar come on top of the page's size
  {
    await browser.setWindowRect(0, 0, VIEW.w, VIEW.h);
    const v = await js(() => ({ w: innerWidth, h: innerHeight }));
    await browser.setWindowRect(0, 0, VIEW.w + (VIEW.w - v.w), VIEW.h + (VIEW.h - v.h));
  }

  await t.test('the page loads in the desktop layout, fits the window, with no console errors', { timeout: 120000 }, async () => {
    await fresh();
    const v = await js(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, sw: document.documentElement.scrollWidth, ua: navigator.userAgent, screen: `${screen.width}×${screen.height}` }));
    t.diagnostic(`page ${v.w}×${v.h} at ${v.dpr}× on a ${v.screen} screen · ${v.ua}`);
    assert.ok(v.sw <= v.w, `no sideways scroll (${v.sw} > ${v.w})`);
    const b = await boardBox(page);
    assert.equal(b.n, 32, 'pieces on the board');
    assert.ok(b.x0 >= 0 && b.x0 + 8 * b.sq <= v.w + 1, `the board (${Math.round(8 * b.sq)} px) fits the ${v.w} px width`);
    assert.ok(await button('Import game'), 'no Import game button in the dock: not the desktop layout');
    await shot('desktop');
    assert.deepEqual(await errors(), []);
  });

  await t.test('the page is cross-origin isolated, so Stockfish can run threads', async () => {
    assert.deepEqual(await js(() => ({ iso: self.crossOriginIsolated, sab: typeof SharedArrayBuffer })), { iso: true, sab: 'function' });
  });

  // not asserted: the first run (Safari 27.2, 2026-11-08) never had a controller 60 s after a reload. A WebDriver session
  // runs in an ephemeral data store, where WebKit may not run service workers at all: what it reaches is said instead
  await t.test('the service worker takes over the page', { timeout: 120000 }, async (st) => {
    await until(() => !!navigator.serviceWorker, 5000, 'no navigator.serviceWorker');
    const reg = () => browser.executeAsync((done) => navigator.serviceWorker.getRegistration().then((r) => done(r ? ['installing', 'waiting', 'active'].map((k) => `${k} ${r[k] ? r[k].state : '-'}`).join(', ') : 'none'), (e) => done('error ' + e.message)));
    t.diagnostic(`before the reload: ${await reg()}`);
    t.diagnostic(`register: ${await browser.executeAsync((done) => { setTimeout(() => done('still pending after 10 s'), 10000); navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => done('ok, scope ' + r.scope), (e) => done(e.name + ': ' + e.message)); })}`);
    await fresh();
    const ok = await browser.waitUntil(() => js(() => !!navigator.serviceWorker.controller), { timeout: 30000, interval: 500 }).then(() => true, () => false);
    if (!ok) {
      t.diagnostic(`30 s after the reload: ${await reg()}`);
      st.todo('the service worker never took over (a WebDriver session\'s ephemeral data store, it seems)');
    }
    assert.deepEqual(await errors(), []);
  });

  await t.test('Play plays the game and Pause stops it', { timeout: 60000 }, async () => {
    await fresh();
    const time = () => js(() => document.querySelector('.ptime').textContent);
    const t0 = await time();
    await clickUntil('Play (space)', async () => !!(await button('Pause (space)')), 'Play did not start playback');
    await wait(2500);
    const t1 = await time();
    assert.notEqual(t1, t0, `the time stayed at ${t0}`);
    await shot('playing');
    await clickUntil('Pause (space)', async () => !!(await button('Play (space)')), 'Pause did not stop playback');
    const t2 = await time();
    await wait(1500);
    assert.equal(await time(), t2, 'the time moved on while paused');
    assert.deepEqual(await errors(), []);
  });

  await t.test('a dragged move gets a Stockfish verdict', { timeout: 180000 }, async () => {
    await fresh();
    const b = await boardBox(page);
    await drag(square(b, 'e2'), square(b, 'e4'));
    const played = await browser.waitUntil(() => js(() => /your move ·/i.test(document.body.innerText)), { timeout: 5000, interval: 250 }).then(() => true, () => false);
    await shot('drag');
    assert.ok(played, 'the drag played no move');
    await until((re) => new RegExp(re, 'i').test(document.body.innerText), 120000, 'no verdict', VERDICT.source);
    assert.doesNotMatch(await js(() => document.body.innerText.match(/your move ·[^\n]*/i)[0]), /can’t run here|stopped/i);
    await shot('own-move');
    assert.deepEqual(await errors(), []);
  });

  await t.test('Settings opens, switches tabs and closes', { timeout: 60000 }, async () => {
    await fresh();
    const open = () => js(() => !!document.querySelector('[role="tablist"]'));
    await clickUntil('Settings', open, 'Settings did not open');
    const selected = () => js(() => document.querySelector('[role="tab"][aria-selected="true"]')?.innerText.trim());
    await clickUntil('View', async () => (await selected()) === 'View', 'the View tab was not selected');
    assert.ok(await js(() => /Theme/.test(document.querySelector('[role="tabpanel"]').innerText)), 'no Theme on the View tab');
    await shot('settings');
    await clickUntil('Close settings', async () => !(await open()), 'Settings did not close');
    assert.deepEqual(await errors(), []);
  });

  await t.test('Full screen goes full screen and back', { timeout: 120000 }, async () => {
    await fresh();
    const isFull = () => js(() => !!(document.fullscreenElement || document.webkitFullscreenElement));
    const shown = (n) => async () => !!(await button(n));
    assert.ok(await js(() => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled)), 'Safari reports no element full screen');
    if (!(await button('Full screen'))) await clickUntil('Menu', shown('Full screen'), 'no Full screen item');
    await clickUntil('Full screen', isFull, 'Full screen did not go full screen');
    const v = await js(() => ({ w: innerWidth, h: innerHeight }));
    t.diagnostic(`full screen: ${v.w}×${v.h}`);
    await wait(1000);
    await shot('full-screen');
    if (!(await button('Exit full screen'))) await clickUntil('Menu', shown('Exit full screen'), 'no Exit full screen item');
    await clickUntil('Exit full screen', async () => !(await isFull()), 'Exit full screen did not leave it');
  });

  await t.test('Next, Previous and Back to start step through the moves', { timeout: 60000 }, async () => {
    await fresh();
    const label = () => js(() => document.querySelector('.plabel').textContent.trim());
    const homeOff = () => js(() => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Back to start (Home)').disabled);
    assert.match(await label(), /Start/);
    assert.equal(await homeOff(), true, 'Back to start is disabled at the start');
    await clickUntil('Next move (→)', async () => /^1\.\s*\S/.test(await label()), 'Next did not play the first move');
    assert.equal(await homeOff(), false, 'Back to start is enabled after a move');
    await clickUntil('Next move (→)', async () => /^1…/.test(await label()), 'Next did not play the second move');
    await clickUntil('Previous move (←)', async () => /^1\.\s*\S/.test(await label()), 'Previous did not go back a move');
    await clickUntil('Back to start (Home)', async () => /Start/.test(await label()), 'Back to start did not go to the start');
    assert.deepEqual(await errors(), []);
  });

  await t.test('the keyboard moves the playhead and steps the Moves panel', { timeout: 60000 }, async () => {
    await fresh();
    const head = () => js(() => { const s = document.querySelector('[role="slider"][aria-label="Playhead"]'); return { now: s.getAttribute('aria-valuenow'), max: s.getAttribute('aria-valuemax'), text: s.getAttribute('aria-valuetext') }; });
    await js(() => document.querySelector('[role="slider"][aria-label="Playhead"]').focus());
    await browser.keys(Key.End);
    await until(() => { const s = document.querySelector('[role="slider"][aria-label="Playhead"]'); return s.getAttribute('aria-valuenow') === s.getAttribute('aria-valuemax'); }, 5000, 'End did not move the playhead to the end');
    await browser.keys(Key.Home);
    await browser.keys(Key.ArrowRight);
    await until(() => document.querySelector('[role="slider"][aria-label="Playhead"]').getAttribute('aria-valuenow') === '1', 5000, `ArrowRight did not move the playhead to 1 s`);
    assert.match((await head()).text, /^1 second of \d+ minutes? /);
    assert.equal(await js(() => document.querySelectorAll('[data-ply][tabindex="0"]').length), 1, 'Tab stops in the Moves panel');
    await js(() => document.querySelector('[data-ply="0"]').focus());
    await browser.keys(Key.ArrowRight);
    await until(() => document.activeElement && document.activeElement.dataset.ply === '1', 5000, 'ArrowRight did not move to the next move');
    await until(() => /^1…/.test(document.querySelector('.plabel').textContent.trim()), 5000, 'the board did not follow the focused move');
    assert.deepEqual(await errors(), []);
  });

  await t.test('a changed setting survives a reload', { timeout: 60000 }, async () => {
    await fresh();
    try {
      await clickUntil('Settings', () => js(() => !!document.querySelector('[role="tablist"]')), 'Settings did not open');
      assert.deepEqual(await js(() => [...document.querySelectorAll('[role="tab"]')].map((e) => e.innerText.trim())), ['Game', 'View', 'Online', 'Sound']);
      // the arrow keys move between the tabs
      await js(() => document.querySelector('[role="tab"]').focus());
      await browser.keys(Key.ArrowRight);
      await until(() => document.querySelector('[role="tab"][aria-selected="true"]').innerText.trim() === 'View', 5000, 'ArrowRight did not select the View tab');
      await clickUntil('Dark', () => js(() => document.documentElement.getAttribute('data-scheme') === 'dark'), 'Theme Dark did not apply');
      await fresh();
      assert.equal(await js(() => document.documentElement.getAttribute('data-scheme')), 'dark', 'the theme was lost on reload');
      await shot('dark');
      assert.deepEqual(await errors(), []);
    } finally {
      await js(() => { localStorage.clear(); localStorage.setItem('chess-video.tweaks.v1', '{"sfOn":true}'); }); // the Stockfish switch on
    }
  });

  await t.test('Menu › Keyboard shortcuts opens a dialog that Esc closes, focus back on Menu', { timeout: 60000 }, async () => {
    await fresh();
    const dlg = () => js(() => !!document.querySelector('[role="dialog"]') && /Play or pause/.test(document.querySelector('[role="dialog"]').innerText));
    await clickUntil('Menu', async () => !!(await button('Keyboard shortcuts')), 'Menu did not open');
    await clickUntil('Keyboard shortcuts', dlg, 'no Keyboard shortcuts dialog');
    await shot('keyboard-shortcuts');
    await browser.keys(Key.Escape);
    await until(() => !document.querySelector('[role="dialog"]'), 5000, 'Esc did not close the dialog');
    assert.equal(await js(() => document.activeElement.textContent), 'Menu', 'focus back on Menu');
    assert.deepEqual(await errors(), []);
  });

  // types into the Import game box and opens it with the Open button
  const importText = async (text) => {
    const field = () => js(() => !!document.querySelector('textarea[aria-label="PGN, FEN or Lichess link"]'));
    await clickUntil('Import game', field, 'no Import game dialog');
    await until(() => document.activeElement === document.querySelector('textarea[aria-label="PGN, FEN or Lichess link"]'), 5000, 'the box is not focused on open');
    await browser.keys(text);
    await until((s) => document.querySelector('textarea[aria-label="PGN, FEN or Lichess link"]').value === s, 5000, 'the box did not take the typed text', text);
    await clickButton('Open');
  };

  await t.test('Import game opens a typed PGN, and says what\'s wrong with a bad one', { timeout: 60000 }, async () => {
    await fresh();
    await importText('1. e4 e5 2. Qh9');
    await until(() => !!document.querySelector('[role="dialog"] [role="alert"]') && /\S/.test(document.querySelector('[role="dialog"] [role="alert"]').innerText), 5000, 'a bad PGN said nothing');
    await shot('import-bad');
    // Safari focuses no button on a click, so after Open the focus is on the page, outside the dialog: the dialog still
    // takes Tab and Esc (DialogBox, app/free-board.jsx), which it heard only from inside until this test found it (2026-11-08)
    t.diagnostic(`focus after clicking Open: ${await js(() => document.activeElement ? document.activeElement.tagName : 'none')}`);
    await browser.keys(Key.Tab);
    await until(() => !!document.activeElement.closest('[role="dialog"]'), 5000, 'Tab did not bring the focus back into the dialog');
    await js(() => document.activeElement.blur());
    await browser.keys(Key.Escape);
    await until(() => !document.querySelector('[role="dialog"]'), 5000, 'Esc did not close the dialog');
    await importText('[White "Alpha Tester"] [Black "Beta Tester"] 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
    await until(() => !document.querySelector('[role="dialog"]') && /Alpha Tester/.test(document.body.innerText) && /Beta Tester/.test(document.body.innerText), 10000, 'the PGN did not open');
    await browser.keys(Key.End);
    await until(() => /a6/.test(document.querySelector('.plabel').textContent), 5000, 'End did not go to the last move');
    await shot('import-pgn');
    assert.deepEqual(await errors(), []);
  });

  await t.test('an own promotion offers the four pieces', { timeout: 60000 }, async () => {
    await fresh();
    await importText('1. e4 d5 2. exd5 c6 3. dxc6 Qd6 4. cxb7 Qd5 *');
    await until(() => !document.querySelector('[role="dialog"]'), 10000, 'the PGN did not open');
    await browser.keys(Key.End);
    await until(() => /Qd5/.test(document.querySelector('.plabel').textContent), 5000, 'End did not go to the last move');
    const b = await boardBox(page);
    const picker = () => js(() => [...document.querySelectorAll('[role="button"]')].map((e) => e.getAttribute('aria-label')).filter((l) => /^Promote to /.test(l || '')));
    await drag(square(b, 'b7'), square(b, 'a8'));
    await until(() => document.querySelectorAll('[aria-label^="Promote to "]').length > 0, 5000, 'no promotion picker');
    assert.deepEqual(await picker(), ['Promote to queen', 'Promote to knight', 'Promote to rook', 'Promote to bishop']);
    await shot('promotion');
    await browser.keys(Key.Escape);
    await until(() => !document.querySelector('[aria-label^="Promote to "]'), 5000, 'Esc did not close the picker');
    assert.match(await js(() => document.querySelector('.plabel').textContent), /Qd5/, 'and plays nothing');
    await drag(square(b, 'b7'), square(b, 'a8'));
    await until(() => document.querySelectorAll('[aria-label^="Promote to "]').length > 0, 5000, 'no promotion picker the second time');
    const knight = square(b, 'a7'); // the column runs down from a8: queen, knight, rook, bishop
    await click(knight.x, knight.y);
    await until(() => /bxa8=N/.test(document.querySelector('.plabel').textContent), 5000, 'the knight promotion was not played');
    assert.deepEqual(await errors(), []);
  });

  await t.test('Flip board turns the board, and a drag still plays the move under the pointer', { timeout: 120000 }, async () => {
    await fresh();
    // the kings are the only pieces on e1/e8 at the start
    const kings = () => js(() => {
      const top = (src) => { const i = [...document.querySelectorAll('img')].find((e) => e.src === src); return i && i.getBoundingClientRect().top; };
      return { w: top(window.PIECE_IMG.wK), b: top(window.PIECE_IMG.bK) };
    });
    const before = await kings();
    assert.ok(before.w > before.b, 'the white king at the bottom by default');
    try {
      await clickUntil('Settings', () => js(() => !!document.querySelector('[role="tablist"]')), 'Settings did not open');
      await clickUntil('View', () => js(() => !!document.getElementById('tw-flip')), 'no View tab');
      const sw = await js(() => { const r = document.getElementById('tw-flip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await click(sw.x, sw.y);
      await until(() => document.getElementById('tw-flip').getAttribute('aria-checked') === 'true', 5000, 'Flip board did not switch on');
      await clickUntil('Close settings', async () => !(await js(() => !!document.querySelector('[role="tablist"]'))), 'Settings did not close');
      const after = await kings();
      assert.ok(after.w < after.b, 'the white king above the black king when flipped');
      const b = await boardBox(page);
      await drag(square(b, 'e2', true), square(b, 'e4', true));
      await until(() => /You 1\. e4/.test(document.querySelector('.plabel').textContent), 5000, 'the drag on the flipped board did not play e4');
      await shot('flipped');
      // the move started Stockfish: its verdict comes before the reload, which would cut off its loading files
      await until((re) => new RegExp(re, 'i').test(document.body.innerText), 120000, 'no verdict', VERDICT.source);
      await fresh();
      const again = await kings();
      assert.ok(again.w < again.b, 'still flipped after a reload');
      assert.deepEqual(await errors(), []);
    } finally {
      await js(() => { localStorage.clear(); localStorage.setItem('chess-video.tweaks.v1', '{"sfOn":true}'); }); // the Stockfish switch on
    }
  });

  // the browser's codecs, which the MP4 export uses
  await t.test('WebCodecs can encode H.264, so the export writes an MP4', async () => {
    const got = await browser.executeAsync((done) => {
      const v = window.VideoEncoder ? VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: 1280, height: 720 }).then((r) => r.supported, () => false) : Promise.resolve('no VideoEncoder');
      const a = window.AudioEncoder ? AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1 }).then((r) => r.supported, () => false) : Promise.resolve('no AudioEncoder');
      Promise.all([v, a]).then(([avc, aac]) => done({ avc, aac }));
    });
    t.diagnostic(`H.264 ${got.avc} · AAC ${got.aac}`);
    assert.equal(got.avc, true);
  });
});
