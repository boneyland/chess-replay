const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
require('./load.cjs'); // sets window
const ROOT = path.join(__dirname, '..');

// The sample game the page opens with: its PGN, analysis and commentary all come from separate units
test('the built page defines the sample game, its analysis and its commentary', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  const page = fs.readFileSync(path.join(ROOT, 'out', 'site', 'chess-game-video.html'), 'utf8');
  for (const name of ['SAMPLE_PGN', 'SAMPLE_ANALYSIS', 'SAMPLE_NOTES']) assert.match(page, new RegExp('window\\.' + name + ' = '), name);
});

test('the sample commentary has an intro and comments on moves', () => {
  require(path.join(ROOT, 'src', 'game-data.js'));
  assert.match(window.SAMPLE_NOTES, /^\[INTRO\]\n/);
  assert.ok((window.SAMPLE_NOTES.match(/^\[\d+\] /gm) || []).length >= 5);
});

// String.replace would expand $' or $& in a script; the page must carry each plain unit's code as written
test('the built page inlines the plain units verbatim', () => {
  const page = fs.readFileSync(path.join(ROOT, 'out', 'site', 'chess-game-video.html'), 'utf8');
  const units = ['src/pieces.js', 'app/chess-core.js', 'app/analysis-core.js', 'app/openings-core.js', 'app/board-core.js', 'app/edit-core.js', 'app/play-core.js', 'app/games-core.js', 'app/sf-engine.js', 'app/queen-core.js', 'app/sfx-core.js', 'app/webp-core.js', 'app/export-draw.js', 'src/sample-game.js', 'src/game-data.js', 'app/sample-analysis.js'];
  for (const u of units) {
    const code = fs.readFileSync(path.join(ROOT, u), 'utf8');
    assert.ok(page.includes(code), u);
  }
});

// The page keeps a Hugging Face token in localStorage, so no CDN script may run unchecked
test('every script from a CDN is pinned by an integrity hash', () => {
  const page = fs.readFileSync(path.join(ROOT, 'out', 'site', 'chess-game-video.html'), 'utf8');
  const tags = page.match(/<script\b[^>]*\ssrc="https:[^"]*"[^>]*>/g) || [];
  assert.ok(tags.length >= 2);
  for (const tag of tags) assert.match(tag, /\sintegrity="sha384-[\w+/=]+"\s+crossorigin="anonymous"/, tag);
  // an import() can't be pinned, so ES modules come from the site
  assert.doesNotMatch(page, /https:\/\/[^'"\s]+\.mjs/);
  assert.match(page, /\.integrity = EXPORT_LIBS\.html2canvasHash/);
});

// an injected inline script doesn't run: the policy allows each of the page's own by its hash, and none other
test('the page has a Content-Security-Policy listing a hash for each inline script', () => {
  const page = fs.readFileSync(path.join(ROOT, 'out', 'site', 'chess-game-video.html'), 'utf8');
  const csp = page.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
  assert.ok(page.indexOf(csp) < page.indexOf('<script'), 'the policy comes before any script');
  const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '));
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'|'unsafe-eval'/);
  const inline = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(inline.length > 10);
  for (const m of inline) assert.ok(scriptSrc.includes(`'sha256-${require('crypto').createHash('sha256').update(m[1]).digest('base64')}'`));
  assert.doesNotMatch(page, /<script\b(?![^>]*\ssrc=)[^>]+>/, 'every inline script is a plain <script>, so its hash is listed');
});

// a script on a CDN runs only if it is one the page names: a whole host would let any package there run
test('the policy allows CDN scripts by their exact URLs, not their hosts', () => {
  const page = fs.readFileSync(path.join(ROOT, 'out', 'site', 'chess-game-video.html'), 'utf8');
  const scriptSrc = page.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1].split('; ').find((d) => d.startsWith('script-src '));
  const hosts = scriptSrc.split(' ').filter((s) => /^https:/.test(s));
  for (const h of hosts) assert.match(h, /^https:\/\/[^/]+\/.+\.js$/, h);
  for (const u of [...page.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])) assert.ok(hosts.includes(u), u);
  assert.ok(hosts.some((h) => h.includes('html2canvas-pro')), 'the export\'s library too');
});

test('render.yaml lets no other site frame the page', () => {
  const yaml = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
  const h = Object.fromEntries([...yaml.matchAll(/- path: \/\*\n\s+name: (.+)\n\s+value: (.+)/g)].map((m) => [m[1].trim(), m[2].trim()]));
  assert.equal(h['Content-Security-Policy'], "frame-ancestors 'self'");
  assert.equal(h['X-Frame-Options'], 'SAMEORIGIN');
});

// The Lichess sound sets travel inside the page
test('the built page carries the four Lichess sound sets as MP3s, and the Wood set needs no data', () => {
  const page = fs.readFileSync(path.join(ROOT, 'out', 'site', 'chess-game-video.html'), 'utf8');
  const data = JSON.parse(page.match(/window\.SFX_DATA = (\{.*?\});\n/)[1]);
  assert.deepEqual(Object.keys(data), ['futuristic', 'nes', 'piano', 'sfx']);
  for (const [set, sounds] of Object.entries(data)) {
    assert.deepEqual(Object.keys(sounds), ['move', 'capture', 'check', 'victory', 'draw'], set);
    for (const [kind, b64] of Object.entries(sounds)) assert.equal(Buffer.from(b64, 'base64').subarray(0, 3).toString(), 'ID3', `${set}/${kind}`);
  }
});

// an unmatched } in the page's stylesheet makes the browser drop the rule after it (it once hid the drop overlay)
test('the page stylesheet opens and closes its braces in pairs', () => {
  const css = fs.readFileSync(path.join(ROOT, 'app', 'shell.html'), 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  css.split('\n').forEach((line, n) => {
    for (const ch of line) {
      depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
      assert.ok(depth >= 0, `unmatched } on line ${n + 1} of the <style>: ${line.trim()}`);
    }
  });
  assert.equal(depth, 0, 'unclosed {');
});

// the page carries its own tab title and link preview
test('the page has a description, a preview title and an icon', () => {
  const head = fs.readFileSync(path.join(ROOT, 'out', 'site', 'chess-game-video.html'), 'utf8').split('</head>')[0];
  assert.match(head, /<meta name="description" content="[^"]{40,}">/);
  assert.match(head, /<meta property="og:title" content="Chess Replay">/);
  assert.match(head, /<link rel="icon" href="data:image\/svg\+xml,/);
});

// link previews: an absolute og:image URL ending in the 1653×944 PNG written next to the page
test('the page has a large link-preview image', () => {
  const site = path.join(ROOT, 'out', 'site');
  const head = fs.readFileSync(path.join(site, 'chess-game-video.html'), 'utf8').split('</head>')[0];
  assert.match(head, /<meta property="og:image" content="https:\/\/[^"\/]+\/og-image\.png">/);
  assert.match(head, /<meta name="twitter:card" content="summary_large_image">/);
  const b = fs.readFileSync(path.join(site, 'og-image.png'));
  assert.equal(b.subarray(1, 4).toString(), 'PNG');
  assert.equal(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`, '1653x944');
  assert.ok(b.length < 1e6, 'under 1 MB');
});

// Add to Home Screen: the page links a manifest whose icons are PNGs written next to it
test('the page links a web app manifest, and its icons are written next to it', () => {
  const site = path.join(ROOT, 'out', 'site');
  const head = fs.readFileSync(path.join(site, 'chess-game-video.html'), 'utf8').split('</head>')[0];
  assert.match(head, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(head, /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/);
  assert.match(head, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  const m = JSON.parse(fs.readFileSync(path.join(site, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.start_url, './');
  assert.match(m.display, /^(fullscreen|standalone)$/);
  const bg = fs.readFileSync(path.join(ROOT, 'app', 'shell.html'), 'utf8').match(/--bg: (#\w+)/)[1];
  assert.equal(m.background_color, bg, '--bg in app/shell.html');
  const png = (f) => { const b = fs.readFileSync(path.join(site, f)); assert.equal(b.subarray(1, 4).toString(), 'PNG', f); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };
  for (const ic of m.icons) assert.equal(png(ic.src), ic.sizes, ic.src);
  assert.deepEqual(m.icons.map((ic) => ic.sizes).sort(), ['192x192', '512x512', '512x512']);
  assert.ok(m.icons.some((ic) => ic.purpose === 'maskable'));
  assert.equal(png('apple-touch-icon.png'), '180x180');
});

// the site serves the engine and the WebP encoder next to the page, unchanged
test('the site carries the vendored files as they are', () => {
  for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm', 'webp_enc_simd.js', 'webp_enc_simd.wasm', 'mediabunny.min.js']) {
    assert.ok(fs.readFileSync(path.join(ROOT, 'out', 'site', f)).equals(fs.readFileSync(path.join(ROOT, 'vendor', f))), f);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'app', 'export.jsx'), 'utf8'), /WEBP_LIB = \{ js: 'webp_enc_simd\.js', wasm: 'webp_enc_simd\.wasm' \}/);
});

// sw.js keeps every file the page needs, so it works offline
test('the service worker keeps the page, its files and every CDN file the page loads', () => {
  const site = path.join(ROOT, 'out', 'site'), page = fs.readFileSync(path.join(site, 'chess-game-video.html'), 'utf8');
  const sw = fs.readFileSync(path.join(site, 'sw.js'), 'utf8');
  const LOCAL = JSON.parse(sw.match(/^const LOCAL = (\[.*?\]);/m)[1]), REMOTE = JSON.parse(sw.match(/^const REMOTE = (\[[\s\S]*?\]);/m)[1]);
  assert.match(sw, /^const VERSION = '[0-9a-f]{16}';/m);
  assert.equal(LOCAL[0], 'chess-game-video.html');
  for (const f of LOCAL) assert.ok(fs.existsSync(path.join(site, f)), f);
  for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm', 'webp_enc_simd.js', 'webp_enc_simd.wasm', 'mediabunny.min.js', 'manifest.webmanifest']) assert.ok(LOCAL.includes(f), f);
  const cdn = page.match(/https:\/\/(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\/[^'"\s]+\.m?js/g);
  for (const u of cdn) assert.ok(REMOTE.includes(u), u);
  assert.ok(REMOTE.some((u) => u.startsWith('https://fonts.googleapis.com/css2?')), 'the fonts');
  assert.match(page, /navigator\.serviceWorker\.register\('sw\.js'/);
});

// the page doesn't zoom; a browser set to ignore that still can
test('the page asks the browser not to zoom', () => {
  const page = fs.readFileSync(path.join(ROOT, 'out', 'site', 'chess-game-video.html'), 'utf8');
  const vp = page.match(/<meta name="viewport" content="([^"]*)">/)[1].split(/,\s*/);
  for (const v of ['width=device-width', 'initial-scale=1', 'maximum-scale=1', 'user-scalable=no']) assert.ok(vp.includes(v), v);
});

// threads need the multi-threaded build where the page is cross-origin isolated; the single-thread pair stays as the fallback
test('the threaded lite engine is vendored, pinned in LAYOUT.md and copied next to the page', () => {
  const layout = fs.readFileSync(path.join(ROOT, 'LAYOUT.md'), 'utf8');
  for (const f of ['stockfish-19-lite.js', 'stockfish-19-lite.wasm']) {
    const sha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'vendor', f))).digest('hex');
    assert.ok(layout.split('\n').some((l) => l.includes('`' + f + '`') && l.includes(sha)), f + ' pinned');
    assert.ok(fs.existsSync(path.join(ROOT, 'out', 'site', f)), f + ' next to the page');
  }
});

// threads need SharedArrayBuffer, which a browser gives only a cross-origin isolated page
test('render.yaml isolates the page: COOP same-origin and COEP require-corp on every path', () => {
  const yaml = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
  const h = Object.fromEntries([...yaml.matchAll(/- path: \/\*\n\s+name: (.+)\n\s+value: (.+)/g)].map((m) => [m[1].trim(), m[2].trim()]));
  assert.equal(h['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(h['Cross-Origin-Embedder-Policy'], 'require-corp');
});

// a copy kept before the headers existed, or a HEAD made from a kept GET, still answers isolated
test('the service worker gives its own files the isolation headers', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'app', 'sw.js'), 'utf8');
  const run = new Function('self', 'caches', 'fetch', sw.replace(/__VERSION__/, 'x').replace('__LOCAL__', '[]').replace('__REMOTE__', '[]') + '\nreturn isolated;');
  const isolated = run({ addEventListener() {} }, {}, () => {});
  const r = isolated(new Response('x', { status: 200, headers: { 'content-type': 'text/html' } }));
  assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(r.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal(r.headers.get('content-type'), 'text/html');
});

// a server error answering the page gives way to the kept copy; a 404 doesn't, and with no copy the error comes through
test('the service worker answers a navigation with the kept page when the server errs', async () => {
  const sw = fs.readFileSync(path.join(ROOT, 'app', 'sw.js'), 'utf8');
  const kept = new Response('kept', { status: 200 });
  const run = (status, copy) => new Function('self', 'caches', 'fetch', sw.replace(/__VERSION__/, 'x').replace('__LOCAL__', '[]').replace('__REMOTE__', '[]') + '\nreturn page;')(
    { addEventListener() {} }, { open: async () => ({ put: async () => {}, match: async () => copy }) }, async () => new Response(String(status), { status }));
  assert.equal(await (await run(503, kept.clone())('x')).text(), 'kept');
  assert.equal((await run(404, kept.clone())('x')).status, 404);
  assert.equal((await run(500, undefined)('x')).status, 500);
  assert.equal((await run(200, kept.clone())('x')).status, 200);
});

// a navigation fetched with redirect: 'manual' answers an opaqueredirect (status 0), which can't be rebuilt
test('the service worker passes a navigation redirect through untouched', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'app', 'sw.js'), 'utf8');
  const isolated = new Function('self', 'caches', 'fetch', sw.replace(/__VERSION__/, 'x').replace('__LOCAL__', '[]').replace('__REMOTE__', '[]') + '\nreturn isolated;')({ addEventListener() {} }, {}, () => {});
  const redirect = { type: 'opaqueredirect', status: 0, headers: new Headers() };
  assert.equal(isolated(redirect), redirect);
});
