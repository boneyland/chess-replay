// The full engine's download (app/sf-full.js) against a fake unpkg, Cache Storage and Worker: small stand-in files
// replace the pinned 99 MB ones (the module reads FILES as it goes, so they are swapped in place).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { loadUnit } = require('./load.cjs');

// Cache Storage: name → Map(url → bytes)
const store = new Map();
globalThis.caches = {
  async open(name) {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      async match(url) { return m.has(url) ? new Response(m.get(url)) : undefined; },
      async put(url, r) { if (globalThis.putFails) throw globalThis.putFails; m.set(url, new Uint8Array(await r.arrayBuffer())); },
      async delete(url) { return m.delete(url); },
    };
  },
  async delete(name) { return store.delete(name); },
};
const workers = [];
globalThis.Worker = class { constructor(url) { this.url = url; workers.push(this); } };
const storage = { quota: 1e9, usage: 0, persisted: 0 };
Object.defineProperty(navigator, 'storage', { configurable: true, value: {
  estimate: async () => ({ quota: storage.quota, usage: storage.usage }),
  persist: async () => { storage.persisted++; return true; },
} });

loadUnit('sf-full.js');
const F = window.SFFull;
const REAL = F.FILES.map((f) => ({ ...f })), REAL_THREADS = F.BUILDS.threads.map((f) => ({ ...f }));

const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);
const GLUE = bytes(300, 1), WASM = bytes(5000, 2), GLUE2 = bytes(320, 3), WASM2 = bytes(4800, 4);
const hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
// what unpkg serves, by file name; a body arrives in 1 KB chunks
let served = {};
const fetched = [];
globalThis.fetch = async (url, opts = {}) => {
  fetched.push(url);
  const name = url.slice(F.BASE.length), b = served[name];
  if (!b) return new Response('not found', { status: 404 });
  let at = 0;
  return new Response(new ReadableStream({
    pull(c) {
      if (opts.signal && opts.signal.aborted) { c.error(new DOMException('aborted', 'AbortError')); return; }
      // a connection that stops sending: nothing more until the download gives up
      if (globalThis.stallAt != null && at >= globalThis.stallAt) return new Promise((res) => opts.signal.addEventListener('abort', () => { c.error(new DOMException('aborted', 'AbortError')); res(); }));
      if (at >= b.length) { c.close(); return; }
      c.enqueue(b.slice(at, at + 1024)); at += 1024;
    },
  }));
};

function reset() {
  store.clear(); workers.length = 0; fetched.length = 0; storage.quota = 1e9; storage.persisted = 0; globalThis.putFails = null; globalThis.stallAt = null;
  F.limits.stallMs = 30000;
  F.remove();
  Object.assign(F.FILES[0], { size: GLUE.length, sha256: hex(GLUE) });
  Object.assign(F.FILES[1], { size: WASM.length, sha256: hex(WASM) });
  Object.assign(F.BUILDS.threads[0], { size: GLUE2.length, sha256: hex(GLUE2) });
  Object.assign(F.BUILDS.threads[1], { size: WASM2.length, sha256: hex(WASM2) });
  served = { 'stockfish-19-single.js': GLUE, 'stockfish-19-single.wasm': WASM, 'stockfish-19.js': GLUE2, 'stockfish-19.wasm': WASM2 };
}

test('the pinned files are stockfish.js v19.0.1 full single-threaded from unpkg', () => {
  assert.equal(F.BASE, 'https://unpkg.com/stockfish@19.0.1/bin/');
  assert.deepEqual(REAL.map((f) => [f.name, f.size]), [['stockfish-19-single.js', 28130], ['stockfish-19-single.wasm', 99169054]]);
  for (const f of REAL) assert.match(f.sha256, /^[0-9a-f]{64}$/);
  assert.equal(F.TOTAL, 28130 + 99169054);
  assert.notEqual(F.CACHE.indexOf('chess-replay-'), 0); // sw.js deletes caches named so on every deploy
});

test('download: both files kept once they match, progress to the total, persistence asked for; start makes workers from the copy', async () => {
  reset();
  assert.equal(await F.present(), false);
  const seen = [];
  await F.download({ onProgress: (got, total) => seen.push([got, total]) });
  assert.deepEqual(seen[0], [0, 5300]);
  assert.deepEqual(seen.at(-1), [5300, 5300]);
  assert.ok(seen.every(([g], i) => i === 0 || g >= seen[i - 1][0]));
  assert.equal(storage.persisted, 1);
  assert.equal(await F.present(), true);
  const make = await F.start();
  const w = make();
  const [glue, wasm] = w.url.split('#');
  assert.match(glue, /^blob:/);
  assert.match(decodeURIComponent(wasm), /^blob:/);
  assert.equal(await F.start(), make); // read once per page: a restart reuses the Blob URLs
  fetched.length = 0;
  make();
  assert.equal(fetched.length, 0); // offline from here on
});

test('download: a file that does not match its checksum keeps nothing', async () => {
  reset();
  served['stockfish-19-single.wasm'] = bytes(5000, 9);
  await assert.rejects(F.download(), /checksum/);
  assert.equal(await F.present(), false);
});

test('download: a file bigger or smaller than pinned, or missing, is refused', async () => {
  reset();
  served['stockfish-19-single.js'] = bytes(400, 1);
  await assert.rejects(F.download(), /bigger than expected/);
  reset();
  served['stockfish-19-single.js'] = bytes(200, 1);
  await assert.rejects(F.download(), /incomplete/);
  reset();
  delete served['stockfish-19-single.wasm'];
  await assert.rejects(F.download(), /answered 404/);
  assert.equal(await F.present(), false);
});

test('download: too little storage stops it before fetching; a refused put keeps nothing', async () => {
  reset();
  storage.quota = 5000;
  await assert.rejects(F.download(), /Not enough storage space/);
  assert.equal(fetched.length, 0);
  reset();
  globalThis.putFails = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  await assert.rejects(F.download(), /Not enough storage space/);
  assert.equal(await F.present(), false);
});

test('download: a connection that stops sending is given up, and nothing is kept', async () => {
  reset();
  F.limits.stallMs = 50;
  globalThis.stallAt = 2048;
  await assert.rejects(F.download(), /unpkg\.com stopped sending stockfish-19-single\.wasm/);
  assert.equal(await F.present(), false);
  globalThis.stallAt = null;
  await F.download(); // a retry goes through
  assert.equal(await F.present(), true);
});

test('download: cancelling rejects it and keeps nothing', async () => {
  reset();
  const c = new AbortController();
  const p = F.download({ signal: c.signal, onProgress: (got) => { if (got > 2000) c.abort(); } });
  await assert.rejects(p);
  assert.equal(await F.present(), false);
});

test('start: the kept copy is trusted, not hashed again; a partial or missing one is dropped and refused', async () => {
  reset();
  await F.download();
  await (await caches.open(F.CACHE)).put(F.BASE + 'stockfish-19-single.wasm', new Response(bytes(5000, 7))); // same size, other bytes
  assert.equal(typeof (await F.start()), 'function');
  await F.remove();
  await F.download();
  await (await caches.open(F.CACHE)).put(F.BASE + 'stockfish-19-single.wasm', new Response(bytes(4000, 2)));
  await assert.rejects(F.start(), /missing/);
  assert.equal(await F.present(), false);
  await assert.rejects(F.start(), /missing/); // a failed start isn't remembered
});

test('remove: the copy goes', async () => {
  reset();
  await F.download();
  await F.remove();
  assert.equal(await F.present(), false);
});

test('the pinned threaded files are stockfish.js v19.0.1 full multi-threaded from unpkg, as LAYOUT.md pins them', () => {
  assert.equal(F.FILES, F.BUILDS.single);
  assert.deepEqual(REAL_THREADS.map((f) => [f.name, f.size]), [['stockfish-19.js', 33326], ['stockfish-19.wasm', 99076105]]);
  const layout = require('fs').readFileSync(require('path').join(__dirname, '..', 'LAYOUT.md'), 'utf8');
  for (const f of [...REAL, ...REAL_THREADS]) assert.ok(layout.split('\n').some((l) => l.includes('`' + f.name + '`') && l.includes(f.sha256)), f.name);
  assert.equal(F.total('threads'), F.BUILDS.threads.reduce((s, f) => s + f.size, 0));
});

test('present, download and start are per build: the single copy doesn\'t make the threaded one present', async () => {
  reset();
  await F.download();
  assert.equal(await F.present('single'), true);
  assert.equal(await F.present('threads'), false);
  const single = await F.start('single');
  const seen = [];
  await F.download({ build: 'threads', onProgress: (got, total) => seen.push([got, total]) });
  assert.deepEqual(seen.at(-1), [5120, 5120]);
  assert.ok(fetched.some((u) => u.endsWith('/stockfish-19.wasm')));
  assert.equal(await F.present('threads'), true);
  const threads = await F.start('threads');
  assert.notEqual(single().url, threads().url);
  assert.equal(await F.start('threads'), threads);
  // a broken copy is dropped and refused
  await F.remove();
  await F.download({ build: 'threads' });
  await (await caches.open(F.CACHE)).put(F.BASE + 'stockfish-19.wasm', new Response(bytes(10, 2)));
  await assert.rejects(F.start('threads'), /missing/);
  assert.equal(await F.present('threads'), false);
  await F.remove();
  assert.equal(await F.present('single'), false);
});

// the build that can't run here only takes space (and the storage check counts it): a download replaces it
test('download: a build replaces the other, before the storage check', async () => {
  reset();
  await F.download();
  storage.usage = 0;
  await F.download({ build: 'threads' });
  assert.equal(await F.present('threads'), true);
  assert.equal(await F.present('single'), false);
  await F.download({ build: 'single' });
  assert.equal(await F.present('threads'), false);
});
