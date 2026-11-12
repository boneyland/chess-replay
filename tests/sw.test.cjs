const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

// Loads the built sw.js in a vm with a fake self, caches and fetch, and dispatches fetch events at it
// status: what the network answers (200 unless given); fetched gets each URL, fetchOpts the options a URL was fetched with
function load({ status = 200 } = {}) {
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  const src = fs.readFileSync(path.join(ROOT, 'out', 'site', 'sw.js'), 'utf8');
  const stores = {}, puts = [], fetched = [], fetchOpts = [], handlers = {};
  const store = (name) => stores[name] || (stores[name] = new Map());
  const caches = {
    open: async (name) => ({
      match: async (u) => store(name).get(typeof u === 'string' ? u : u.url),
      put: async (u, r) => { puts.push([name, u]); store(name).set(u, r); },
      addAll: async () => {},
    }),
    keys: async () => Object.keys(stores),
    delete: async (name) => delete stores[name],
  };
  const self = { location: { origin: 'https://site.test', href: 'https://site.test/sw.js' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  // a same-origin answer, as the browser's fetch gives one (Node's Response says 'default')
  const fakeFetch = async (req, opts) => {
    fetched.push(typeof req === 'string' ? req : req.url); fetchOpts.push(opts);
    return Object.defineProperty(new Response('from network', { status }), 'type', { value: typeof req === 'string' ? 'cors' : 'basic' });
  };
  vm.runInNewContext(src, { self, caches, fetch: fakeFetch, Response, Headers, URL, Promise, setTimeout, console });
  // the event's waitUntil promises are kept in held (the cache writes the worker must stay alive for)
  const held = [];
  const fetchEvent = async (url, method = 'GET', mode = 'cors') => {
    let answer;
    const req = { url, method, mode };
    handlers.fetch({ request: req, respondWith: (p) => { answer = p; }, waitUntil: (p) => { held.push(p); } });
    return answer === undefined ? undefined : await answer;
  };
  const activate = async () => { let done; handlers.activate({ waitUntil: (p) => { done = p; } }); await done; };
  const VERSION = src.match(/^const VERSION = '([0-9a-f]+)';/m)[1];
  return { stores, store, puts, fetched, fetchOpts, held, fetchEvent, activate, VERSION };
}

const WASM = 'https://site.test/vision/ort.wasm.min.mjs';

test('a vision/ file kept in chess-vision-1 is answered from it, with the isolation headers', async () => {
  const sw = load();
  sw.store('chess-vision-1').set(WASM, new Response('kept', { status: 200 }));
  const r = await sw.fetchEvent(WASM);
  assert.equal(await r.text(), 'kept');
  assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(r.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.deepEqual(sw.fetched, []);
});

test('a vision/ file that is not kept comes from the network and is put in no cache', async () => {
  const sw = load();
  const r = await sw.fetchEvent(WASM);
  assert.equal(await r.text(), 'from network');
  assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.deepEqual(sw.fetched, [WASM]);
  assert.deepEqual(sw.puts, []);
});

test('another file next to the page still goes through cacheFirst, into the per-deploy cache', async () => {
  const sw = load();
  const u = 'https://site.test/dead-worker.js';
  const r = await sw.fetchEvent(u);
  assert.equal(await r.text(), 'from network');
  assert.equal(sw.held.length, 1, 'the cache write is held open with waitUntil');
  await Promise.all(sw.held);
  assert.equal(sw.puts.length, 1);
  assert.match(sw.puts[0][0], /^chess-replay-/);
  assert.equal(sw.puts[0][1], u);
});

test('a HEAD for a kept vision/ file gets no body, the kept headers and the isolation headers', async () => {
  const sw = load();
  sw.store('chess-vision-1').set(WASM, new Response('kept', { status: 200, headers: { 'Content-Length': '4' } }));
  const r = await sw.fetchEvent(WASM, 'HEAD');
  assert.equal(r.body, null);
  assert.equal(r.headers.get('Content-Length'), '4');
  assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(r.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.deepEqual(sw.fetched, []);
});

test('activate deletes a board reader kept under an older name, and keeps the current one and Full Stockfish', async () => {
  const sw = load();
  for (const n of ['chess-vision-0', 'chess-vision-1', 'stockfish-full-19', 'chess-replay-old']) sw.store(n);
  await sw.activate();
  assert.deepEqual(Object.keys(sw.stores).sort(), ['chess-vision-1', 'stockfish-full-19']);
});

const PAGE = 'chess-game-video.html';

for (const u of ['https://site.test/', 'https://site.test/?code=abc&state=xyz', 'https://site.test/chess-game-video.html']) {
  test(`a navigation to the page (${u.slice(17) || '/'}) is kept as the page, the write held open with waitUntil`, async () => {
    const sw = load();
    const r = await sw.fetchEvent(u, 'GET', 'navigate');
    assert.equal(await r.text(), 'from network');
    assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
    assert.equal(sw.held.length, 1);
    await Promise.all(sw.held);
    assert.equal(sw.puts.length, 1);
    assert.match(sw.puts[0][0], /^chess-replay-/);
    assert.equal(sw.puts[0][1], PAGE);
  });
}

test('a navigation to another file next to the page is not kept as the page, nor answered with it', async () => {
  const sw = load();
  const r0 = await sw.fetchEvent('https://site.test/', 'GET', 'navigate');
  await r0.text();
  await Promise.all(sw.held);
  const u = 'https://site.test/og-image.png';
  const r = await sw.fetchEvent(u, 'GET', 'navigate');
  assert.equal(await r.text(), 'from network');
  await Promise.all(sw.held);
  assert.deepEqual(sw.puts.map((p) => p[1]), [PAGE, u]);
});

// The page asks for its Workers and libraries with its deploy's version (window.siteFile)
test('this deploy\'s file asked for with ?v= is answered from the copy kept under its plain URL', async () => {
  const sw = load();
  sw.store('chess-replay-' + sw.VERSION).set('https://site.test/dead-worker.js', new Response('kept', { status: 200 }));
  const r = await sw.fetchEvent('https://site.test/dead-worker.js?v=' + sw.VERSION);
  assert.equal(await r.text(), 'kept');
  assert.deepEqual(sw.fetched, []);
});

test('this deploy\'s file not kept yet is fetched and kept under its plain URL', async () => {
  const sw = load();
  const u = 'https://site.test/dead-worker.js?v=' + sw.VERSION;
  assert.equal(await (await sw.fetchEvent(u)).text(), 'from network');
  await Promise.all(sw.held);
  assert.deepEqual(sw.fetched, [u]);
  assert.deepEqual(sw.puts.map((p) => p[1]), ['https://site.test/dead-worker.js']);
});

test('another deploy\'s file comes from the network, never from the copy, and is not kept', async () => {
  const sw = load();
  sw.store('chess-replay-' + sw.VERSION).set('https://site.test/dead-worker.js', new Response('kept', { status: 200 }));
  const u = 'https://site.test/dead-worker.js?v=0123456789abcdef';
  const r = await sw.fetchEvent(u);
  assert.equal(await r.text(), 'from network');
  assert.equal(r.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  await Promise.all(sw.held);
  assert.deepEqual(sw.fetched, [u]);
  assert.deepEqual(sw.puts, []);
});

test('a failed answer is not kept, here or from a CDN', async () => {
  const sw = load({ status: 503 });
  for (const u of ['https://site.test/pieces/alpha/wK.svg', 'https://cdn.jsdelivr.net/npm/x@1/x.js']) assert.equal((await sw.fetchEvent(u)).status, 503, u);
  await Promise.all(sw.held);
  assert.deepEqual(sw.puts, []);
});

test('a CDN file is fetched with CORS, so its status can be read, and kept', async () => {
  const sw = load();
  const u = 'https://fonts.gstatic.com/s/x.woff2';
  assert.equal(await (await sw.fetchEvent(u)).text(), 'from network');
  await Promise.all(sw.held);
  assert.equal(sw.fetchOpts[0].mode, 'cors');
  assert.deepEqual(sw.puts.map((p) => p[1]), [u]);
});
