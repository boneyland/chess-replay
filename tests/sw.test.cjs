const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

// Loads the built sw.js in a vm with a fake self, caches and fetch, and dispatches fetch events at it
function load() {
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  const src = fs.readFileSync(path.join(ROOT, 'out', 'site', 'sw.js'), 'utf8');
  const stores = {}, puts = [], fetched = [], handlers = {};
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
  const fakeFetch = async (req) => { fetched.push(req.url); return new Response('from network', { status: 200 }); };
  vm.runInNewContext(src, { self, caches, fetch: fakeFetch, Response, Headers, URL, Promise, setTimeout, console });
  const fetchEvent = async (url, method = 'GET') => {
    let answer;
    const req = { url, method, mode: 'cors' };
    handlers.fetch({ request: req, respondWith: (p) => { answer = p; } });
    return answer === undefined ? undefined : await answer;
  };
  const activate = async () => { let done; handlers.activate({ waitUntil: (p) => { done = p; } }); await done; };
  return { stores, store, puts, fetched, fetchEvent, activate };
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
