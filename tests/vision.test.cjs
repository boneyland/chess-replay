// The board reader's page side (app/vision.js) against a fake Cache Storage and Worker: the Worker is handed the kept
// copy as Blob URLs and the model's input side, the Blob URLs are let go once it has loaded, and a copy that isn't
// kept is refused without starting a Worker (the dialog then offers the download again).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');

const store = new Map();
globalThis.caches = {
  async open(name) {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      async match(url) { return m.has(url) ? new Response(m.get(url)) : undefined; },
      async put(url, r) { m.set(url, new Uint8Array(await r.arrayBuffer())); },
      async delete(url) { return m.delete(url); },
    };
  },
  async delete(name) { return store.delete(name); },
};
const workers = [];
globalThis.Worker = class {
  constructor(url, opts) { this.url = url; this.opts = opts; this.sent = []; this.ended = false; workers.push(this); }
  postMessage(m) { this.sent.push(m); }
  terminate() { this.ended = true; }
  answer(data) { this.onmessage({ data }); }
};
globalThis.location = { href: 'https://site.test/app/chess-game-video.html' };
const made = [], revoked = [];
URL.createObjectURL = (b) => { made.push(b); return 'blob:' + made.length; };
URL.revokeObjectURL = (u) => revoked.push(u);
window.SFEngine = { simdSupport: () => true };
window.siteFile = (f) => f + '?v=deploy1'; // build.cjs's, in the page

loadUnit('chess-core.js'); loadUnit('board-core.js'); loadUnit('edit-core.js'); loadUnit('vision-core.js');
loadUnit('kept-files.js'); loadUnit('vision.js');
const VC = window.VisionCore, V = window.Vision, BASE = 'https://site.test/app/vision/';
// stand-in files of the pinned sizes would be 56 MB: the sizes are swapped for small ones in place
for (const f of VC.FILES) f.size = 3;
async function keep() { const c = await caches.open(VC.CACHE); for (const f of VC.FILES) await c.put(BASE + f.name, new Response(new Uint8Array(3))); }
const settle = () => new Promise((ok) => setTimeout(ok, 0));
const bitmap = () => ({ closed: false, close() { this.closed = true; } });

test('a read hands the Worker the kept copy as Blob URLs and SIZE, and lets them go once it is loaded', async () => {
  await keep();
  const pic = bitmap(), p = V.read(pic);
  await settle(); await settle();
  assert.equal(workers.length, 1);
  const w = workers[0], load = w.sent[0];
  assert.equal(w.url, 'vision-worker.js?v=deploy1', 'this deploy\'s Worker');
  assert.equal(load.type, 'load');
  assert.equal(load.size, VC.SIZE);
  assert.deepEqual(Object.keys(load.urls).sort(), VC.FILES.map((f) => f.name).sort());
  for (const f of VC.FILES) assert.equal(made[+load.urls[f.name].slice(5) - 1].type, f.type, f.name);
  assert.equal(revoked.length, 0, 'kept until loaded');
  w.answer({ type: 'ready' });
  await settle();
  assert.deepEqual(revoked.sort(), Object.values(load.urls).sort());
  assert.equal(w.sent[1].type, 'image');
  w.answer({ type: 'logits', logits: new Float32Array(832) });
  assert.equal((await p).length, 832);
  V.stop();
  assert.ok(w.ended);
});

test('a copy that is not kept is refused without a Worker; removing the copy stops the Worker', async () => {
  workers.length = 0;
  store.clear();
  const pic = bitmap();
  await assert.rejects(V.read(pic), /missing or incomplete/);
  assert.equal(workers.length, 0);
  assert.ok(pic.closed);
  await keep();
  const p = V.read(bitmap());
  await settle(); await settle();
  workers[0].answer({ type: 'ready' });
  await settle();
  assert.deepEqual(await V.kept.removeKept(), { kept: false, err: '' });
  assert.ok(workers[0].ended);
  await assert.rejects(p, /stopped/);
});

// last: the page then keeps to one thread
test('a threaded load that never finishes is stopped after 30 s and started again on one thread', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tick = () => new Promise((ok) => setImmediate(ok));
  workers.length = 0;
  await keep();
  const p = V.read(bitmap());
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(workers.length, 1);
  assert.ok(workers[0].sent[0].threads > 1, 'threads first (this machine has more than one core)');
  t.mock.timers.tick(29999);
  await tick();
  assert.equal(workers.length, 1, 'still waiting');
  t.mock.timers.tick(1);
  for (let i = 0; i < 6; i++) await tick();
  assert.ok(workers[0].ended, 'the hung Worker is ended');
  assert.equal(workers.length, 2);
  assert.equal(workers[1].sent[0].threads, 1);
  t.mock.timers.tick(60000);
  await tick();
  workers[1].answer({ type: 'ready' });
  await tick();
  workers[1].answer({ type: 'logits', logits: new Float32Array(832) });
  assert.equal((await p).length, 832, 'the one-thread load is not timed out');
  V.stop();
});
