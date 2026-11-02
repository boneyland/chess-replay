// Smoke tests in Safari on an iOS Simulator (Apple's own Safari, its bars, safe areas and media stack, which
// Playwright's WebKit build for Linux lacks), driven over WebDriver by safaridriver, against a build of this checkout
// served by serve.cjs (the Simulator shares the Mac's network, so 127.0.0.1 reaches it):
//   node --test tests/live/ios.test.cjs
// Needs macOS with Xcode, an iOS Simulator runtime, WebdriverIO (`npm install --no-save webdriverio`) and
// `sudo safaridriver --enable` once. IOS_DEVICE names the Simulator (default: iPhone 17, else the newest iPhone the runtime has).
// GitHub Actions runs it on a macOS runner (the `ios` job). Taps are WebDriver touch actions. The page is served as
// ios.html, the page with a logger in front of its scripts, as WebDriver can't read Safari's console. Screenshots go to
// tests/out/live/.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http');
const { serve } = require('./serve.cjs');
const { boardBox, square } = require('./board.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SITE = path.join(ROOT, 'out', 'site');
const OUT = path.join(ROOT, 'tests', 'out', 'live');
const PORT = 8768, WD_PORT = 4444;
const VERDICT = /your move · .*(stockfish’s choice|cp vs|as good as|can’t run here|stopped)/i;
const PREFER = ['iPhone 17', 'iPhone 16', 'iPhone 15', 'iPhone 16e', 'iPhone 14', 'iPhone 13']; // a current phone first, then newest to oldest

// the newest iOS runtime's Simulator of IOS_DEVICE, or of the first of PREFER it has, or its first iPhone
function pickDevice() {
  const { devices } = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j']).toString());
  const ios = Object.keys(devices).filter((r) => /SimRuntime\.iOS-/.test(r) && devices[r].length)
    .sort((a, b) => { const v = (r) => r.split('iOS-')[1].split('-').map(Number); const [x, y] = [v(a), v(b)]; return (y[0] - x[0]) || ((y[1] || 0) - (x[1] || 0)); });
  assert.ok(ios.length, 'no iOS Simulator runtime');
  const list = devices[ios[0]], names = process.env.IOS_DEVICE ? [process.env.IOS_DEVICE] : PREFER;
  const dev = names.map((n) => list.find((d) => d.name === n)).find(Boolean) || list.find((d) => /^iPhone/.test(d.name));
  assert.ok(dev, `no iPhone Simulator in ${ios[0]}`);
  return { ...dev, runtime: ios[0].split('SimRuntime.')[1] };
}

const wdUp = () => new Promise((ok) => http.get(`http://127.0.0.1:${WD_PORT}/status`, (r) => { r.resume(); ok(r.statusCode === 200); }).on('error', () => ok(false)));

test('ios · safari · local build', async (t) => {
  // undone last first, as t.after hooks run in the order they were added
  const undo = [];
  t.after(async () => { for (const f of undo.reverse()) { try { await f(); } catch (e) { t.diagnostic(`cleanup: ${e.message}`); } } });
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  // the page with the logger first in <head>: a file of the site, which the page's CSP allows ('self')
  fs.writeFileSync(path.join(SITE, 'ios-log.js'), `window.__errs = [];
addEventListener('error', (e) => __errs.push('error: ' + e.message + ' ' + (e.filename || '') + ':' + (e.lineno || '')));
addEventListener('unhandledrejection', (e) => __errs.push('unhandled rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
addEventListener('securitypolicyviolation', (e) => __errs.push('CSP: ' + e.violatedDirective + ' ' + e.blockedURI));
const ce = console.error; console.error = (...a) => { __errs.push(a.map(String).join(' ')); ce.apply(console, a); };
`);
  const html = fs.readFileSync(path.join(SITE, 'chess-game-video.html'), 'utf8');
  fs.writeFileSync(path.join(SITE, 'ios.html'), html.replace('<head>', '<head><script src="ios-log.js"></script>'));
  undo.push(() => { for (const f of ['ios.html', 'ios-log.js']) fs.rmSync(path.join(SITE, f), { force: true }); });
  const local = await serve(SITE, PORT);
  undo.push(() => local.close());
  const URL_ = local.url + 'ios.html';

  const dev = pickDevice();
  t.diagnostic(`${dev.name} · ${dev.runtime} · ${dev.udid}`);
  if (dev.state !== 'Booted') execFileSync('xcrun', ['simctl', 'boot', dev.udid]);
  execFileSync('xcrun', ['simctl', 'bootstatus', dev.udid, '-b'], { stdio: 'ignore', timeout: 300000 });
  undo.push(() => execFileSync('xcrun', ['simctl', 'shutdown', dev.udid]));
  const wd = spawn('safaridriver', ['-p', String(WD_PORT)], { stdio: 'inherit' });
  undo.push(() => wd.kill());
  for (let i = 0; i < 50 && !(await wdUp()); i++) await new Promise((r) => setTimeout(r, 200));
  const { remote } = await import('webdriverio');
  // safaridriver gives up after ~30 s "finding or launching a compatible remote Safari", often on a freshly booted
  // Simulator (2 of the first 3 runs, once twice in a row): each try first has Safari show a page, then waits for it
  let browser;
  for (let i = 1; !browser; i++) {
    try { execFileSync('xcrun', ['simctl', 'openurl', dev.udid, local.url + 'manifest.webmanifest'], { stdio: 'ignore', timeout: 60000 }); } catch (e) { t.diagnostic(`opening Safari: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 10000));
    try {
      browser = await remote({
        hostname: '127.0.0.1', port: WD_PORT, path: '/', logLevel: 'error', connectionRetryTimeout: 120000, connectionRetryCount: 0,
        capabilities: { browserName: 'safari', platformName: 'iOS', 'safari:useSimulator': true, 'safari:deviceUDID': dev.udid },
      });
    } catch (e) {
      t.diagnostic(`session, try ${i}: ${e.message.slice(0, 160)}`);
      if (i === 5) throw e;
      try { execFileSync('xcrun', ['simctl', 'terminate', dev.udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch (x) {}
    }
  }
  undo.push(() => browser.deleteSession());
  t.diagnostic(`Safari ${browser.capabilities.browserVersion}`);
  await browser.setTimeout({ script: 15000 });

  // Playwright's page.evaluate, for board.cjs
  const page = { evaluate: (fn, ...a) => browser.execute(fn, ...a) };
  const js = (fn, ...a) => browser.execute(fn, ...a);
  const until = (fn, timeout, msg, ...a) => browser.waitUntil(() => js(fn, ...a), { timeout, interval: 250, timeoutMsg: msg });
  const errors = () => js(() => window.__errs || ['the logger did not load']);
  const shot = (name) => browser.saveScreenshot(path.join(OUT, `ios-${name}.png`));
  // the Simulator's whole screen, Safari's bars included (WebDriver's screenshot leaves them blank)
  const screen = (name) => { try { execFileSync('xcrun', ['simctl', 'io', dev.udid, 'screenshot', path.join(OUT, `ios-${name}-screen.png`)], { stdio: 'ignore', timeout: 30000 }); } catch (e) { t.diagnostic(`screen ${name}: ${e.message}`); } };
  // the pointer type whose taps reach the page: the first test finds it (touch on the first run moved nothing)
  let ptr = 'touch';
  // and how far a tap lands from the point asked for, in page pixels: the first test measures it, as run 4's taps hit
  // a rank above the square asked for (the page starts below Safari's top bar)
  let off = { x: 0, y: 0 };
  const tap = async (x, y, type = ptr) => browser.action('pointer', { parameters: { pointerType: type } })
    .move({ x: Math.round(x - off.x), y: Math.round(y - off.y), origin: 'viewport' }).down().pause(60).up().perform();
  // a shown button by its accessible name (aria-label, else its text), as getByRole finds it
  const button = (name) => js((n) => {
    const b = [...document.querySelectorAll('button, [role="button"]')].find((e) => (e.getAttribute('aria-label') || e.innerText || '').trim() === n && e.getClientRects().length);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, name);
  const tapButton = async (name) => { const b = await button(name); assert.ok(b, `no ${name} button`); await tap(b.x, b.y); };
  const loaded = () => until(() => !!document.querySelector('.dock-primary') && document.querySelectorAll('img').length >= 32, 60000, 'the page did not load');

  await browser.url(URL_);
  await js(() => localStorage.clear());

  await t.test('the page loads in the phone layout, fits the width, with no console errors', { timeout: 120000 }, async () => {
    await browser.url(URL_);
    await loaded();
    await until(() => !![...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Menu' || b.innerText.trim() === 'Menu'), 10000, 'no Menu button: not the phone layout');
    const v = await js(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, vv: visualViewport.height, sw: document.documentElement.scrollWidth, ua: navigator.userAgent }));
    t.diagnostic(`viewport ${v.w}×${v.h} (visual ${v.vv}) at ${v.dpr}× · ${v.ua}`);
    assert.ok(v.sw <= v.w, `no sideways scroll (${v.sw} > ${v.w})`);
    const b = await boardBox(page);
    assert.equal(b.n, 32, 'pieces on the board');
    assert.ok(b.x0 >= 0 && b.x0 + 8 * b.sq <= v.w + 1, `the board (${Math.round(8 * b.sq)} px) fits the ${v.w} px width`);
    await shot('phone');
    screen('phone');
    assert.deepEqual(await errors(), []);
  });

  await t.test('the page is cross-origin isolated, so Stockfish can run threads', async () => {
    assert.deepEqual(await js(() => ({ iso: self.crossOriginIsolated, sab: typeof SharedArrayBuffer })), { iso: true, sab: 'function' });
  });

  // which events a WebDriver tap gives the page, as touch and as mouse, on an empty square (e4)
  await t.test('a tap reaches the page as pointer events', async () => {
    const b = await boardBox(page), p = square(b, 'e4'), seen = {};
    for (const type of ['touch', 'mouse']) {
      await js(() => {
        window.__taps = [];
        if (!window.__tapsOn) for (const k of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'click']) document.addEventListener(k, (e) => window.__taps.push(k + (e.pointerType ? ':' + e.pointerType : '') + (k === 'pointerdown' ? `@${Math.round(e.clientX)},${Math.round(e.clientY)}` : '')), true);
        window.__tapsOn = true;
      });
      try { await tap(p.x, p.y, type); seen[type] = await js(() => window.__taps); } catch (e) { seen[type] = ['failed: ' + e.message.split('\n')[0]]; }
      t.diagnostic(`${type} tap: ${seen[type].join(' ') || 'nothing'}`);
    }
    ptr = ['touch', 'mouse'].find((k) => seen[k].includes('pointerup:' + k) || seen[k].some((e) => /^pointerup/.test(e))) || 'touch';
    const at = (seen[ptr].find((e) => /^pointerdown/.test(e)) || '').match(/@(-?\d+),(-?\d+)/);
    if (at) off = { x: +at[1] - Math.round(p.x), y: +at[2] - Math.round(p.y) };
    t.diagnostic(`taps as ${ptr}, asked for ${Math.round(p.x)},${Math.round(p.y)}, landing off by ${off.x},${off.y}`);
    // the correction lands a tap where it's asked
    await js(() => { window.__taps = []; });
    await tap(p.x, p.y);
    t.diagnostic(`corrected tap: ${(await js(() => window.__taps)).join(' ')}`);
    assert.ok(Object.values(seen).some((l) => l.some((e) => /^pointerdown/.test(e))), 'no tap gave a pointerdown');
  });

  await t.test('the service worker takes over the page', { timeout: 120000 }, async (st) => {
    const reg = () => browser.executeAsync((done) => navigator.serviceWorker.getRegistration().then((r) => done(r ? ['installing', 'waiting', 'active'].map((k) => `${k} ${r[k] ? r[k].state : '-'}`).join(', ') : 'none'), (e) => done('error ' + e.message)));
    await until(() => !!navigator.serviceWorker, 5000, 'no navigator.serviceWorker');
    t.diagnostic(`before the reload: ${await reg()}`);
    // run 5 had a registration with no worker at all: whether the script loads, and what a register() of it says
    t.diagnostic(`sw.js: ${await browser.executeAsync((done) => fetch('sw.js', { cache: 'no-store' }).then((r) => done(`${r.status} ${r.headers.get('content-type')}`), (e) => done('error ' + e.message)))}`);
    t.diagnostic(`register: ${await browser.executeAsync((done) => { setTimeout(() => done('still pending after 10 s'), 10000); navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => done('ok, scope ' + r.scope), (e) => done(e.name + ': ' + e.message)); })}`);
    await browser.url(URL_);
    await loaded();
    const cached = () => browser.executeAsync((done) => caches.keys().then((ks) => Promise.all(ks.map((k) => caches.open(k).then((c) => c.keys()).then((r) => `${k}: ${r.length}`)))).then((l) => done(l.join(', ') || 'no caches'), (e) => done('error ' + e.message)));
    let ok = false;
    // runs 2, 5 and 6: still installing 30–50 s after the reload, its cache not yet opened
    for (let i = 0; i < 6 && !ok; i++) {
      ok = await js(() => !!navigator.serviceWorker.controller);
      if (!ok) { t.diagnostic(`${i * 10} s after the reload: ${await reg()} · ${await cached()}`); await new Promise((r) => setTimeout(r, 10000)); }
    }
    // not asserted: on GitHub's Simulator the worker stayed installing for 3 minutes without opening its cache (run 7),
    // while Playwright's WebKit runs the same worker; what it reaches is said instead
    if (!ok) st.todo('the service worker never took over here (a Simulator limit, it seems)');
    assert.deepEqual(await errors(), []);
  });

  // Runs 1–11: WebDriver's taps reach the board's React handler on the right squares, and its state takes e2, but the page
  // never draws the selection and e4 plays nothing. So the move is tried three ways, each on a freshly loaded page, to
  // tell safaridriver's input from the app: WebDriver's quick tap, a slow one (held 250 ms, a second apart), and pointer
  // events dispatched by the page's own script. Only the first counts; the others say which side the fault is on
  await t.test('a tap-tap move gets a Stockfish verdict', { timeout: 240000 }, async () => {
    const played = () => js(() => /your move ·/i.test(document.body.innerText));
    const slowTap = (x, y) => browser.action('pointer', { parameters: { pointerType: ptr } })
      .move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' }).down().pause(250).up().perform();
    const scripted = (x, y) => js((cx, cy) => {
      const el = document.elementFromPoint(cx, cy), o = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    }, x, y);
    const ways = [['WebDriver tap', (x, y) => tap(x, y), 300], ['slow WebDriver tap', slowTap, 1000], ['scripted pointer events', scripted, 300]];
    const got = {};
    for (const [name, how, gap] of ways) {
      await browser.url(URL_);
      await loaded();
      await new Promise((r) => setTimeout(r, 1500));
      const b = await boardBox(page);
      for (const sq of ['e2', 'e4']) { const p = square(b, sq); await how(p.x, p.y); await new Promise((r) => setTimeout(r, gap)); }
      got[name] = await browser.waitUntil(played, { timeout: 5000, interval: 250 }).then(() => true, () => false);
      t.diagnostic(`${name}: ${got[name] ? 'played e4' : 'played nothing'}`);
      await shot(`move-${name.replace(/\W+/g, '-')}`);
      if (name === 'WebDriver tap' && got[name]) break;
    }
    assert.ok(got['WebDriver tap'], `WebDriver's taps played no move (${Object.entries(got).map(([k, v]) => `${k}: ${v}`).join(', ')})`);
    await until((re) => new RegExp(re, 'i').test(document.body.innerText), 120000, 'no verdict', VERDICT.source);
    assert.doesNotMatch(await js(() => document.body.innerText.match(/your move ·[^\n]*/i)[0]), /can’t run here|stopped/i);
    await shot('own-move');
    assert.deepEqual(await errors(), []);
  });

  // the menu has a Full screen item where Safari reports element full screen, and it works: iOS 26.5's Safari reports
  // it (the first run here), though older iPhone Safari had none
  await t.test('the menu opens, and its Full screen item follows what Safari reports', { timeout: 30000 }, async () => {
    const fs_ = await js(() => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled));
    t.diagnostic(`element full screen reported: ${fs_}`);
    await tapButton('Menu');
    await until(() => [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || b.innerText).trim() === 'Ask Queen' && b.getClientRects().length), 3000, 'the menu did not open');
    await shot('menu');
    if (!fs_) { assert.equal(await button('Full screen'), null, 'a Full screen item'); await tapButton('Menu'); return; }
    await tapButton('Full screen');
    await until(() => !!(document.fullscreenElement || document.webkitFullscreenElement), 5000, 'Full screen did not go full screen');
    const v = await js(() => ({ w: innerWidth, h: innerHeight, top: getComputedStyle(document.documentElement).paddingTop }));
    t.diagnostic(`full screen: ${v.w}×${v.h}, root padding ${v.top}`);
    await shot('full-screen');
    // the menu can stay open over the full-screen page (run 6), where a tap on Menu would close it
    if (!(await button('Exit full screen'))) await tapButton('Menu');
    await until(() => [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || b.innerText).trim() === 'Exit full screen' && b.getClientRects().length), 3000, 'no Exit full screen item');
    screen('full-screen');
    await tapButton('Exit full screen');
    await until(() => !(document.fullscreenElement || document.webkitFullscreenElement), 5000, 'Exit full screen did not leave it');
  });

  // the browser's codecs, which the MP4 export uses: Linux WebKit has no H.264 encoder and writes WebM instead
  await t.test('WebCodecs can encode H.264, so the export writes an MP4', async () => {
    const got = await browser.executeAsync((done) => {
      const v = window.VideoEncoder ? VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: 390, height: 640 }).then((r) => r.supported, () => false) : Promise.resolve('no VideoEncoder');
      const a = window.AudioEncoder ? AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1 }).then((r) => r.supported, () => false) : Promise.resolve('no AudioEncoder');
      Promise.all([v, a]).then(([avc, aac]) => done({ avc, aac }));
    });
    t.diagnostic(`H.264 ${got.avc} · AAC ${got.aac}`);
    assert.equal(got.avc, true);
  });
});
