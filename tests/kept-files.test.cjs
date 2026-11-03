// The shared "download, check, keep" module (app/kept-files.js) against a fake host, Cache Storage and storage estimate,
// with a two-file set of small stand-ins.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { loadUnit } = require('./load.cjs');

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
const storage = { quota: 1e9, usage: 0, persisted: 0 };
Object.defineProperty(navigator, 'storage', { configurable: true, value: {
  estimate: async () => ({ quota: storage.quota, usage: storage.usage }),
  persist: async () => { storage.persisted++; return true; },
} });

loadUnit('kept-files.js');

const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);
const hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const A = bytes(300, 1), B = bytes(5000, 2);
const BASE = 'https://site.test/vision/';
let served = {};
const fetched = [];
globalThis.fetch = async (url, opts = {}) => {
  fetched.push(url);
  const b = served[url.slice(BASE.length)];
  if (!b) return new Response('not found', { status: 404 });
  let at = 0;
  return new Response(new ReadableStream({
    pull(c) {
      if (opts.signal && opts.signal.aborted) { c.error(new DOMException('aborted', 'AbortError')); return; }
      if (globalThis.stallAt != null && at >= globalThis.stallAt) return new Promise((res) => opts.signal.addEventListener('abort', () => { c.error(new DOMException('aborted', 'AbortError')); res(); }));
      if (at >= b.length) { c.close(); return; }
      c.enqueue(b.slice(at, at + 1024)); at += 1024;
    },
  }));
};

const files = [
  { name: 'a.bin', size: A.length, type: 'application/octet-stream', sha256: hex(A) },
  { name: 'b.bin', size: B.length, type: 'application/octet-stream', sha256: hex(B) },
];
const K = window.KeptFiles.make({ cache: 'kept-test', base: BASE, files, host: 'the site', what: 'board reader' });

function reset() {
  store.clear(); fetched.length = 0; storage.quota = 1e9; storage.usage = 0; storage.persisted = 0; globalThis.putFails = null; globalThis.stallAt = null;
  K.limits.stallMs = 30000;
  served = { 'a.bin': A, 'b.bin': B };
}

test('both files are kept when they match; progress to the total, persistence asked for', async () => {
  reset();
  assert.equal(K.total(), 5300);
  assert.equal(K.urlOf(files[0]), BASE + 'a.bin');
  assert.equal(await K.present(), false);
  const seen = [];
  await K.download({ onProgress: (got, total) => seen.push([got, total]) });
  assert.deepEqual(seen[0], [0, 5300]);
  assert.deepEqual(seen.at(-1), [5300, 5300]);
  assert.equal(storage.persisted, 1);
  assert.equal(await K.present(), true);
});

test('nothing is kept when the second file does not match its checksum', async () => {
  reset();
  served['b.bin'] = bytes(5000, 9);
  await assert.rejects(K.download(), /b\.bin does not match its pinned checksum/);
  assert.equal(await K.present(), false);
  assert.equal(store.get('kept-test').size, 0);
});

test('a connection that stops sending is given up, naming the host', async () => {
  reset();
  K.limits.stallMs = 50;
  globalThis.stallAt = 2048;
  await assert.rejects(K.download(), /the site stopped sending b\.bin/);
  assert.equal(await K.present(), false);
});

test('a missing file, or one bigger or smaller than pinned, is refused', async () => {
  reset();
  delete served['a.bin'];
  await assert.rejects(K.download(), /the site answered 404 for a\.bin/);
  reset();
  served['a.bin'] = bytes(400, 1);
  await assert.rejects(K.download(), /bigger than expected/);
  reset();
  served['a.bin'] = bytes(200, 1);
  await assert.rejects(K.download(), /arrived incomplete/);
});

test('too little storage (under total x 1.1) stops it before fetching; a refused put keeps nothing', async () => {
  reset();
  storage.quota = 5300 * 1.1 - 1;
  await assert.rejects(K.download(), /Not enough storage space/);
  assert.equal(fetched.length, 0);
  reset();
  globalThis.putFails = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  await assert.rejects(K.download(), /Not enough storage space/);
  globalThis.putFails = new Error('nope');
  await assert.rejects(K.download(), /The browser would not keep the board reader/);
  assert.equal(await K.present(), false);
});

test('present is true only with both files; remove empties the cache', async () => {
  reset();
  await K.download();
  await (await caches.open('kept-test')).delete(BASE + 'b.bin');
  assert.equal(await K.present(), false);
  await K.download();
  assert.equal(await K.present(), true);
  assert.equal(await K.remove(), true);
  assert.equal(await K.present(), false);
});
