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
  const browser = await remote({
    hostname: '127.0.0.1', port: WD_PORT, path: '/', logLevel: 'warn', connectionRetryTimeout: 300000, connectionRetryCount: 1,
    capabilities: { browserName: 'safari', platformName: 'iOS', 'safari:useSimulator': true, 'safari:deviceUDID': dev.udid },
  });
  undo.push(() => browser.deleteSession());
  t.diagnostic(`Safari ${browser.capabilities.browserVersion}`);

  // Playwright's page.evaluate, for board.cjs
  const page = { evaluate: (fn, ...a) => browser.execute(fn, ...a) };
  const js = (fn, ...a) => browser.execute(fn, ...a);
  const until = (fn, timeout, msg, ...a) => browser.waitUntil(() => js(fn, ...a), { timeout, interval: 250, timeoutMsg: msg });
  const errors = () => js(() => window.__errs || ['the logger did not load']);
  const shot = (name) => browser.saveScreenshot(path.join(OUT, `ios-${name}.png`));
  const tap = async (x, y) => browser.action('pointer', { parameters: { pointerType: 'touch' } })
    .move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' }).down().pause(60).up().perform();
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
    assert.deepEqual(await errors(), []);
  });

  await t.test('the page is cross-origin isolated, so Stockfish can run threads', async () => {
    assert.deepEqual(await js(() => ({ iso: self.crossOriginIsolated, sab: typeof SharedArrayBuffer })), { iso: true, sab: 'function' });
  });

  await t.test('a tap-tap move gets a Stockfish verdict', { timeout: 180000 }, async () => {
    const b = await boardBox(page);
    for (const sq of ['e2', 'e4']) { const p = square(b, sq); await tap(p.x, p.y); }
    await until(() => /your move ·/i.test(document.body.innerText), 5000, 'the move was not played');
    await until((re) => new RegExp(re, 'i').test(document.body.innerText), 120000, 'no verdict', VERDICT.source);
    assert.doesNotMatch(await js(() => document.body.innerText.match(/your move ·[^\n]*/i)[0]), /can’t run here|stopped/i);
    await shot('own-move');
    assert.deepEqual(await errors(), []);
  });

  // iPhone Safari has no element full screen (its way out of the bars is Add to Home Screen), so the menu has no
  // Full screen item: Playwright's WebKit for Linux reports full screen as there
  await t.test('the menu opens, with no Full screen item', { timeout: 30000 }, async () => {
    assert.equal(await js(() => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled)), false, 'Safari reports full screen');
    await tapButton('Menu');
    await until(() => [...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || b.innerText).trim() === 'Ask Queen' && b.getClientRects().length), 3000, 'the menu did not open');
    assert.equal(await button('Full screen'), null, 'a Full screen item');
    await shot('menu');
    await tapButton('Menu');
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

  await t.test('the service worker takes over the page', { timeout: 60000 }, async () => {
    await browser.url(URL_);
    await loaded();
    await until(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller), 30000, 'no service worker controls the page');
    assert.deepEqual(await errors(), []);
  });
});
