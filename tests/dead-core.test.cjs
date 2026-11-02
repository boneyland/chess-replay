// DeadCore (app/dead-core.js): its cache keys, the client's queue, timeout and restarts against a fake worker, the
// first-dead scan, and the real worker (app/dead-worker.js) running vendor/chasolver.wasm in a worker thread
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Worker: ThreadWorker } = require('worker_threads');
const { loadUnit } = require('./load.cjs');
loadUnit('dead-core.js');
const D = window.DeadCore;

const KK = '8/8/8/8/8/8/8/K1k5 w - - 0 1';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// a fake Worker: answers { fen side → verdict } from the table after `delay` ms (never, for a missing entry), memory mb
function fakeWorkers(table, { delay = 0, mb = 16 } = {}) {
  const made = [];
  const make = () => {
    const w = { sent: [], terminated: false, onmessage: null };
    w.postMessage = (m) => {
      w.sent.push(m);
      const v = table[m.fen + ' ' + m.side];
      if (v) setTimeout(() => !w.terminated && w.onmessage({ data: { id: m.id, verdict: v, mb } }), delay);
    };
    w.terminate = () => { w.terminated = true; };
    made.push(w);
    return w;
  };
  return { make, made, sent: () => made.flatMap((w) => w.sent) };
}

test('the key is the first four FEN fields', () => {
  assert.equal(D.key(KK), '8/8/8/8/8/8/8/K1k5 w - -');
  assert.equal(D.key('8/8/8/8/8/8/8/K1k5 w - - 40 90'), D.key(KK));
});

test('an answer is cached, by position and side, whatever the move counters', async () => {
  const f = fakeWorkers({ [KK + ' w']: 'unwinnable' });
  const c = D.create({ makeWorker: f.make });
  assert.equal(c.cached(KK, 'w'), undefined);
  assert.equal(await c.ask(KK, 'w'), 'unwinnable');
  assert.equal(c.cached('8/8/8/8/8/8/8/K1k5 w - - 3 7', 'w'), 'unwinnable');
  assert.equal(await c.ask(KK, 'w'), 'unwinnable');
  assert.equal(f.sent().length, 1);
});

test('one search at a time, in order', async () => {
  const f = fakeWorkers({ [KK + ' w']: 'unwinnable', [KK + ' b']: 'unwinnable', [START + ' w']: 'winnable' }, { delay: 5 });
  const c = D.create({ makeWorker: f.make });
  const order = [];
  const ps = [c.ask(KK, 'w'), c.ask(KK, 'b'), c.ask(START, 'w')].map((p, i) => p.then((v) => order.push(i)));
  assert.equal(f.sent().length, 1);
  await Promise.all(ps);
  assert.deepEqual(order, [0, 1, 2]);
  assert.equal(f.made.length, 1);
});

test('both() asks both sides', async () => {
  const f = fakeWorkers({ [START + ' w']: 'winnable', [START + ' b']: 'winnable' });
  assert.deepEqual(await D.create({ makeWorker: f.make }).both(START), { w: 'winnable', b: 'winnable' });
});

test('a search past the timeout is undecided, and its worker is terminated and replaced', async () => {
  const f = fakeWorkers({ [START + ' w']: 'winnable' });
  const c = D.create({ makeWorker: f.make, timeoutMs: 30 });
  assert.equal(await c.ask(KK, 'w'), 'undecided');
  assert.equal(f.made[0].terminated, true);
  assert.equal(c.cached(KK, 'w'), 'undecided'); // not searched again
  assert.equal(await c.ask(START, 'w'), 'winnable');
  assert.equal(f.made.length, 2);
});

test('an answer that grew the memory past the limit restarts the worker', async () => {
  const f = fakeWorkers({ [KK + ' w']: 'unwinnable', [KK + ' b']: 'unwinnable' }, { mb: 65 });
  const c = D.create({ makeWorker: f.make });
  assert.equal(await c.ask(KK, 'w'), 'unwinnable');
  assert.equal(f.made[0].terminated, true);
  await c.ask(KK, 'b');
  assert.equal(f.made.length, 2);
});

test('a queued ask aborted before its turn is never sent', async () => {
  const f = fakeWorkers({ [KK + ' w']: 'unwinnable', [START + ' w']: 'winnable' }, { delay: 5 });
  const c = D.create({ makeWorker: f.make });
  const ctl = new AbortController();
  const a = c.ask(KK, 'w'), b = c.ask(START, 'w', { signal: ctl.signal });
  ctl.abort();
  assert.equal(await a, 'unwinnable');
  assert.equal(await b, 'undecided');
  assert.equal(f.sent().length, 1);
  assert.equal(c.cached(START, 'w'), undefined);
});

test('a worker that can\'t start, or fails, answers undecided without caching it', async () => {
  const c = D.create({ makeWorker: () => { throw new Error('no Worker'); } });
  assert.equal(await c.ask(KK, 'w'), 'undecided');
  assert.equal(c.cached(KK, 'w'), undefined);
  const f = fakeWorkers({});
  const c2 = D.create({ makeWorker: f.make });
  const p = c2.ask(KK, 'w');
  f.made[0].onerror(new Error('wasm fetch failed'));
  assert.equal(await p, 'undecided');
  assert.equal(c2.cached(KK, 'w'), undefined);
  // the worker's own report of a failed load isn't cached either
  const w = { postMessage: (m) => setTimeout(() => w.onmessage({ data: { id: m.id, verdict: 'undecided', error: true } })), terminate() {} };
  const c3 = D.create({ makeWorker: () => w });
  assert.equal(await c3.ask(KK, 'w'), 'undecided');
  assert.equal(c3.cached(KK, 'w'), undefined);
});

test('after a worker fails to load, asks answer undecided without a new worker until retryMs has passed', async () => {
  let t = 0, made = 0;
  const w = () => ({ postMessage: (m) => setTimeout(() => w.cur.onmessage({ data: { id: m.id, verdict: 'undecided', error: true } })), terminate() {} });
  const c = D.create({ makeWorker: () => { made++; return (w.cur = w()); }, retryMs: 1000, now: () => t });
  assert.equal(await c.ask(KK, 'w'), 'undecided');
  assert.equal(await c.ask(KK, 'b'), 'undecided');
  assert.equal(await D.firstDead([START, KK], c), null);
  assert.equal(made, 1, 'one worker for all of them');
  t = 1000;
  assert.equal(await c.ask(KK, 'w'), 'undecided');
  assert.equal(made, 2, 'tried again after retryMs');
  // the same for a Worker that throws, and one whose load fails with an error event
  let thrown = 0;
  const c2 = D.create({ makeWorker: () => { thrown++; throw new Error('no Worker'); }, retryMs: 1000, now: () => t });
  await c2.ask(KK, 'w'); await c2.ask(KK, 'b');
  assert.equal(thrown, 1);
  const f = fakeWorkers({});
  const c3 = D.create({ makeWorker: f.make, retryMs: 1000, now: () => t });
  const p = c3.ask(KK, 'w');
  f.made[0].onerror({ preventDefault() {} });
  await p; await c3.ask(KK, 'b');
  assert.equal(f.made.length, 1);
  // a search past its time isn't a load failure: the next ask starts a worker at once
  const slow = fakeWorkers({ [START + ' w']: 'winnable' }, { delay: 50 });
  const c4 = D.create({ makeWorker: slow.make, timeoutMs: 10, retryMs: 1000, now: () => t });
  assert.equal(await c4.ask(START, 'w'), 'undecided');
  c4.ask(START, 'b');
  assert.equal(slow.made.length, 2);
  c4.close();
});

test('firstDead finds the first position dead for both sides and stops there', async () => {
  const KR = '8/8/8/4k3/8/8/r7/4K3 w - - 0 1', LATER = '8/8/8/8/8/8/8/1K1k4 b - - 0 2';
  const f = fakeWorkers({ [START + ' w']: 'winnable', [START + ' b']: 'winnable', [KR + ' w']: 'unwinnable', [KR + ' b']: 'winnable', [KK + ' w']: 'unwinnable', [KK + ' b']: 'unwinnable' });
  const c = D.create({ makeWorker: f.make });
  assert.equal(await D.firstDead([START, KR, KK, LATER], c), 2);
  assert.ok(!f.sent().some((m) => m.fen === LATER));
  assert.equal(await D.firstDead([START, KR], c), null);
});

test('the real worker answers from vendor/chasolver.wasm', async () => {
  const shim = `
    const { parentPort } = require('worker_threads'), fs = require('fs');
    globalThis.self = globalThis;
    globalThis.postMessage = (m) => parentPort.postMessage(m);
    globalThis.fetch = async (u) => new Response(fs.readFileSync(${JSON.stringify(path.join(__dirname, '..', 'vendor'))} + '/' + u));
    parentPort.on('message', (data) => self.onmessage({ data }));
    require(${JSON.stringify(path.join(__dirname, '..', 'app', 'dead-worker.js'))});`;
  const make = () => {
    const t = new ThreadWorker(shim, { eval: true }), w = { onmessage: null };
    t.on('message', (data) => w.onmessage && w.onmessage({ data }));
    w.postMessage = (m) => t.postMessage(m);
    w.terminate = () => t.terminate();
    return w;
  };
  const c = D.create({ makeWorker: make });
  try {
    assert.deepEqual(await c.both(KK), { w: 'unwinnable', b: 'unwinnable' });
    assert.deepEqual(await c.both(START), { w: 'winnable', b: 'winnable' });
    assert.equal(await c.ask('not a fen', 'w'), 'undecided');
  } finally { c.close(); }
});
