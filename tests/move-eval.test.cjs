const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js');
loadUnit('analysis-core.js');
loadUnit('move-eval.js');
const ME = window.MoveEval;

// lets the module's promise chains run (setImmediate stays real when a test mocks setTimeout)
const tick = () => new Promise((r) => setImmediate(r));

// A scripted engine: each search waits for finish(result); info(score) streams a depth. starts: how many get()s work
function fakeEngine({ starts = Infinity } = {}) {
  const calls = [];
  let gets = 0;
  const eng = {
    search(q) {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      const c = { q, cancelled: false, info: (sc) => q.onInfo(sc), finish: (r) => resolve(r) };
      calls.push(c);
      return { promise, cancel() { c.cancelled = true; resolve(null); } };
    },
    failed: () => null,
  };
  return { calls, handle: { get: () => (gets++ < starts ? Promise.resolve(eng) : Promise.reject(new Error('no worker'))) } };
}
const found = (cp, depth, pv = ['e7e5']) => ({ cp, depth, maxDepth: depth, pv, lines: [{ k: 1, cp, depth, pv }], nodes: 1000, timeMs: 500 });

// A scripted cloud: cloudEval waits for answer(result or null), which it then has cached
function fakeCloud() {
  const cache = new Map(), asked = [];
  return {
    asked,
    cloudCached: (fen, n) => cache.get(fen + '/' + n),
    cloudEval: (fen, n, { signal }) => new Promise((res) => { asked.push({ fen, n, signal, answer: (r) => { cache.set(fen + '/' + n, r); res(r); } }); }),
  };
}
const fromCloud = (cp, depth, pv = ['e7e5']) => ({ cp, depth, maxDepth: depth, pv, best: pv[0], lines: [{ k: 1, cp, depth, pv }], nodes: null, timeMs: null, source: 'cloud' });

const OWN = { depth: 12, time_limit: 2, lines: 1, name: 'lite' };
const request = (e, more = {}) => ({ engine: e ? e.handle : null, before: [], after: ['e2e4'], settings: OWN, fen: undefined, stored: null, cloud: { on: false, prefer: false }, off: false, auto: false, ...more });
// both searches of a level, answered in the order they are asked (after, then before)
async function finishBoth(e, from, after, before) {
  await tick();
  e.calls[from].finish(after);
  await tick();
  e.calls[from + 1].finish(before);
  await tick();
}

test('the position after the move is searched, then the one before, and both are kept', async () => {
  const evals = ME.create(), e = fakeEngine();
  let changes = 0;
  const w = evals.watch(request(e), () => changes++);
  assert.equal(changes, 0, 'watch() itself reports nothing');
  assert.deepEqual([w.get().before, w.get().after, w.get().pending, w.get().deeper], [null, null, true, null]);
  await tick();
  assert.equal(e.calls.length, 1);
  const q = e.calls[0].q;
  assert.deepEqual([q.moves, q.depth, q.movetimeMs, q.lines, q.priority], [['e2e4'], 12, 2000, 1, 'own']);
  e.calls[0].info({ cp: 20, depth: 5, pv: ['e7e5'], timeMs: 200 });
  assert.deepEqual([w.get().after.cp, w.get().after.partial, w.get().after.best], [20, true, 'e7e5']);
  assert.equal(w.get().progress, 0.1 / 2, 'a tenth of its time, in the first of two searches');
  e.calls[0].finish(found(30, 12));
  await tick();
  assert.deepEqual([w.get().after.cp, w.get().after.partial, w.get().pending], [30, undefined, true]);
  assert.deepEqual(e.calls[1].q.moves, []);
  e.calls[1].finish(found(25, 12, ['e2e4']));
  await tick();
  const s = w.get();
  assert.deepEqual([s.pending, s.before.cp, s.before.best, s.failed], [false, 25, 'e2e4', null]);
  assert.deepEqual(s.deeperTo, { depth: 16, time_limit: 4 });
  assert.ok(changes >= 4);
  // the same request again: nothing is searched
  const w2 = evals.watch(request(e), () => {});
  assert.deepEqual([w2.get().after.cp, w2.get().before.cp, w2.get().pending], [30, 25, false]);
  await tick();
  assert.equal(e.calls.length, 2);
});

test('the start position is both before and after: one search', async () => {
  const evals = ME.create(), e = fakeEngine();
  const w = evals.watch(request(e, { after: [] }), () => {});
  await tick();
  e.calls[0].finish(found(15, 12, ['e2e4']));
  await tick();
  assert.equal(e.calls.length, 1);
  assert.deepEqual([w.get().after.cp, w.get().before.cp, w.get().pending], [15, 15, false]);
});

test('only the position after the move searches the Lines setting\'s lines, and its search answers a one-line ask', async () => {
  const evals = ME.create(), e = fakeEngine(), own = { ...OWN, lines: 3 };
  evals.watch(request(e, { settings: own }), () => {});
  await finishBoth(e, 0, found(30, 12), found(25, 12));
  assert.deepEqual([e.calls[0].q.lines, e.calls[1].q.lines], [3, 1]);
  // stepping on: the next move's before is this move's after, searched as three lines
  evals.watch(request(e, { settings: own, before: ['e2e4'], after: ['e2e4', 'e7e5'] }), () => {});
  await tick();
  e.calls[2].finish(found(28, 12));
  await tick();
  assert.equal(e.calls.length, 3, 'before was not searched again');
});

test('Go deeper searches both positions deeper, holding the last result until the search passes it', async () => {
  const evals = ME.create(), e = fakeEngine();
  let changes = 0;
  const w = evals.watch(request(e), () => changes++);
  await finishBoth(e, 0, found(30, 12), found(25, 12));
  const before = changes;
  w.get().deeper();
  assert.equal(changes, before + 1, 'the press reports at once');
  assert.deepEqual([w.get().after.cp, w.get().after.partial, w.get().after.held, w.get().pending, w.get().deeper], [30, true, true, true, null]);
  await tick();
  assert.deepEqual([e.calls[2].q.depth, e.calls[2].q.movetimeMs], [16, 4000]);
  e.calls[2].info({ cp: 99, depth: 10, pv: ['c7c5'], timeMs: 100 });
  assert.equal(w.get().after.cp, 30, 'a depth the last result already had changes nothing');
  e.calls[2].info({ cp: 35, depth: 14, pv: ['c7c5'], timeMs: 900 });
  assert.deepEqual([w.get().after.cp, w.get().after.held], [35, undefined]);
  e.calls[2].finish(found(36, 16, ['c7c5']));
  await tick();
  e.calls[3].finish(found(27, 16, ['e2e4']));
  await tick();
  assert.deepEqual([w.get().after.cp, w.get().before.cp, w.get().pending], [36, 27, false]);
  assert.deepEqual(w.get().deeperTo, { depth: 20, time_limit: 8 });
  // the press counts for the position: another watch of it starts at that level
  const w2 = evals.watch(request(e), () => {});
  assert.deepEqual([w2.get().after.cp, w2.get().pending], [36, false]);
  // and for that position only
  const w3 = evals.watch(request(e, { before: ['e2e4'], after: ['e2e4', 'e7e5'] }), () => {});
  await tick();
  assert.equal(e.calls[4].q.depth, 12);
  w3.stop();
});

test('Go deeper is not offered once the depth and the time are at their caps', async () => {
  const L = window.AnalysisCore.SEARCH_LIMITS, own = { ...OWN, depth: L.depth[1], time_limit: L.seconds[1] };
  const evals = ME.create(), e = fakeEngine();
  const w = evals.watch(request(e, { settings: own }), () => {});
  await finishBoth(e, 0, found(30, own.depth), found(25, own.depth));
  assert.deepEqual([w.get().pending, w.get().deeper, w.get().deeperTo], [false, null, null]);
});

test('a Go deeper search that stops is undone: the last results show, with why, and it is offered again', async () => {
  const evals = ME.create(), e = fakeEngine();
  const w = evals.watch(request(e), () => {});
  await finishBoth(e, 0, found(30, 12), found(25, 12));
  w.get().deeper();
  await tick();
  e.calls[2].finish(null);
  await tick();
  const s = w.get();
  assert.match(s.failed, /^Stockfish stopped before it finished/);
  assert.deepEqual([s.after.cp, s.after.partial, s.pending], [30, undefined, false]);
  assert.deepEqual(s.deeperTo, { depth: 16, time_limit: 4 });
  assert.equal(e.calls.length, 3, 'the level before it is not searched again');
  // the next press clears the message
  s.deeper();
  assert.equal(w.get().failed, null);
  w.stop();
});

test('a Go deeper press when Stockfish doesn\'t start is undone too; a first search that fails just stops waiting', async () => {
  const evals = ME.create(), e = fakeEngine({ starts: 1 });
  const w = evals.watch(request(e), () => {});
  await finishBoth(e, 0, found(30, 12), found(25, 12));
  w.get().deeper();
  await tick();
  assert.equal(w.get().failed, 'Stockfish didn’t start: no worker');
  assert.equal(typeof w.get().deeper, 'function');
  const none = fakeEngine({ starts: 0 });
  const w2 = evals.watch(request(none, { after: ['d2d4'] }), () => {});
  await tick();
  assert.deepEqual([w2.get().pending, w2.get().after, w2.get().failed, w2.get().deeper], [false, null, null, null]);
});

test('the cloud is asked after the wait; its answer shows until a finished local search is deeper', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cloud = fakeCloud(), evals = ME.create({ cloud }), e = fakeEngine();
  const w = evals.watch(request(e, { cloud: { on: true } }), () => {});
  t.mock.timers.tick(299);
  assert.equal(cloud.asked.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(cloud.asked.map((a) => a.n), [1, 1]);
  assert.match(cloud.asked[0].fen, / b KQkq /, 'after the move first');
  await tick();
  cloud.asked[0].answer(fromCloud(40, 30));
  cloud.asked[1].answer(fromCloud(22, 10, ['e2e4']));
  await tick();
  assert.deepEqual([w.get().after.source, w.get().after.cp, w.get().before.cp], ['cloud', 40, 22]);
  await finishBoth(e, 0, found(30, 12), found(25, 12, ['e2e4']));
  const s = w.get();
  assert.deepEqual([s.after.source, s.after.cp], ['cloud', 40], 'depth 30 from the cloud stands over a local 12');
  assert.deepEqual([s.before.source, s.before.cp], [undefined, 25], 'a local 12 replaces the cloud\'s 10');
  // cached: another watch shows it at once, without asking
  const w2 = evals.watch(request(e, { cloud: { on: true } }), () => {});
  assert.equal(w2.get().after.cp, 40);
  t.mock.timers.tick(300);
  assert.equal(cloud.asked.length, 2);
});

test('a cloud miss falls back to the local search, and the cloud setting off asks nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cloud = fakeCloud(), evals = ME.create({ cloud }), e = fakeEngine();
  const w = evals.watch(request(e, { cloud: { on: true } }), () => {});
  t.mock.timers.tick(300);
  cloud.asked.forEach((a) => a.answer(null));
  await finishBoth(e, 0, found(30, 12), found(25, 12));
  assert.deepEqual([w.get().after.cp, w.get().after.source, w.get().pending], [30, undefined, false]);
  evals.watch(request(e, { after: ['d2d4'] }), () => {});
  t.mock.timers.tick(300);
  assert.equal(cloud.asked.length, 2);
});

test('Prefer cloud: a position the cloud has as deep as the depth limit is not searched locally', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cloud = fakeCloud(), evals = ME.create({ cloud }), e = fakeEngine();
  const w = evals.watch(request(e, { cloud: { on: true, prefer: true } }), () => {});
  t.mock.timers.tick(300);
  await tick();
  assert.equal(e.calls.length, 0, 'the search waits for the cloud');
  cloud.asked[0].answer(fromCloud(40, 12));
  cloud.asked[1].answer(fromCloud(22, 11, ['e2e4']));
  await tick();
  assert.equal(e.calls.length, 1);
  assert.deepEqual(e.calls[0].q.moves, [], 'only before, which the cloud has one depth short');
  e.calls[0].finish(found(25, 12, ['e2e4']));
  await tick();
  const s = w.get();
  assert.deepEqual([s.after.source, s.before.cp, s.pending], ['cloud', 25, false]);
  assert.equal(typeof s.deeper, 'function');
});

test('Go deeper is not offered over cloud answers as deep as the next search would reach', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cloud = fakeCloud(), evals = ME.create({ cloud }), e = fakeEngine();
  const w = evals.watch(request(e, { cloud: { on: true, prefer: true } }), () => {});
  t.mock.timers.tick(300);
  cloud.asked[0].answer(fromCloud(40, 16));
  cloud.asked[1].answer(fromCloud(22, 16, ['e2e4']));
  await tick();
  await tick();
  assert.deepEqual([e.calls.length, w.get().pending, w.get().deeper], [0, false, null]);
});

test('off: nothing is searched and Go deeper is not offered, the cloud is still asked, finished searches still show', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cloud = fakeCloud(), evals = ME.create({ cloud }), e = fakeEngine();
  const off = evals.watch(request(null, { off: true, cloud: { on: true } }), () => {});
  assert.deepEqual([off.get().pending, off.get().after], [false, null]);
  t.mock.timers.tick(300);
  assert.equal(cloud.asked.length, 2);
  cloud.asked[0].answer(fromCloud(40, 30));
  await tick();
  assert.equal(off.get().after.cp, 40);
  off.stop();
  // level 1 finished, level 2 pressed and stopped part-way: off shows level 1's
  const on = evals.watch(request(e), () => {});
  await finishBoth(e, 0, found(30, 12), found(25, 12));
  on.get().deeper();
  await finishBoth(e, 2, found(36, 16), found(27, 16));
  on.get().deeper();
  await tick();
  on.stop();
  const w = evals.watch(request(null, { off: true }), () => {});
  assert.deepEqual([w.get().after.cp, w.get().before.cp, w.get().pending, w.get().deeper], [36, 27, false, null]);
  await tick();
  assert.equal(e.calls.length, 5, 'the level-2 search that was stopped, and no other');
});

test('a stored result stands in for the first search; only a press searches, and a shallower answer leaves it showing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cloud = fakeCloud(), evals = ME.create({ cloud }), e = fakeEngine();
  const stored = { cp: 50, depth: 18, pv: [], stored: true, src: 'analysis A' };
  const req = request(e, { before: ['e2e4'], stored, cloud: { on: true } });
  const w = evals.watch(req, () => {});
  t.mock.timers.tick(300);
  await tick();
  assert.deepEqual([e.calls.length, cloud.asked.length], [0, 0], 'no search and no cloud ask before a press');
  assert.deepEqual([w.get().after, w.get().before, w.get().pending], [stored, stored, false]);
  w.get().deeper();
  assert.deepEqual([w.get().after.cp, w.get().after.held], [50, true]);
  t.mock.timers.tick(300);
  assert.equal(cloud.asked.length, 2, 'the cloud is asked once pressed');
  cloud.asked.forEach((q) => q.answer(null));
  await tick();
  assert.equal(e.calls[0].q.depth, 16);
  e.calls[0].finish(found(44, 16));
  await tick();
  assert.equal(e.calls.length, 1, 'one position, one search');
  assert.deepEqual([w.get().after.cp, w.get().after.stored, w.get().pending], [50, true, false], 'depth 16 does not pass the stored 18');
  w.get().deeper();
  await tick();
  e.calls[1].finish(found(47, 20));
  await tick();
  assert.deepEqual([w.get().after.cp, w.get().after.depth, w.get().after.stored], [47, 20, undefined]);
  // another analysis of the same moves starts afresh
  const other = evals.watch({ ...req, stored: { ...stored, src: 'analysis B' } }, () => {});
  assert.equal(other.get().after.stored, true);
  assert.notEqual(evals.positionKey(req), evals.positionKey({ ...req, stored: { ...stored, src: 'analysis B' } }));
});

test('auto: a stored result\'s first Go deeper level runs without a press, and stays once off', async () => {
  const evals = ME.create(), e = fakeEngine();
  const stored = { cp: 50, depth: 10, pv: [], stored: true, src: 'analysis A' };
  const req = request(e, { before: ['e2e4'], stored, auto: true });
  const w = evals.watch(req, () => {});
  assert.deepEqual([w.get().after, w.get().pending], [null, true]);
  await tick();
  assert.equal(e.calls[0].q.depth, 16);
  e.calls[0].finish(found(44, 16));
  await tick();
  assert.deepEqual([w.get().after.cp, w.get().after.stored], [44, undefined]);
  const off = evals.watch({ ...req, engine: null, auto: false, off: true }, () => {});
  assert.equal(off.get().after.cp, 44);
});

test('auto: the live search shows from its first depth with its own lines, even where it ends shallower than the stored result', async () => {
  const evals = ME.create(), e = fakeEngine();
  const stored = { cp: 50, depth: 30, pv: [], stored: true, src: 'analysis A' };
  const req = request(e, { before: ['e2e4'], stored, auto: true, settings: { ...OWN, lines: 3 } });
  const w = evals.watch(req, () => {});
  assert.deepEqual([w.get().after, w.get().pending], [null, true], 'nothing held from the stored result');
  await tick();
  assert.equal(e.calls[0].q.lines, 3);
  e.calls[0].info({ cp: 20, depth: 1, pv: ['e7e5'] });
  assert.deepEqual([w.get().after.cp, w.get().after.partial], [20, true]);
  e.calls[0].finish({ ...found(44, 16), lines: [1, 2, 3].map((k) => ({ k, cp: 44 - k, depth: 16, pv: ['e7e5'] })) });
  await tick();
  assert.deepEqual([w.get().after.cp, w.get().after.lines.length], [44, 3], 'depth 16 shows, though the stored result was 30');
  const off = evals.watch({ ...req, engine: null, auto: false, off: true }, () => {});
  assert.equal(off.get().after.cp, 50, 'switched off, a shallower live search gives way to the stored result');
});

test('stop() cancels the searches, the cloud\'s wait and its requests, and nothing changes after it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cloud = fakeCloud(), evals = ME.create({ cloud }), e = fakeEngine();
  let changes = 0;
  const w = evals.watch(request(e, { cloud: { on: true } }), () => changes++);
  await tick();
  w.stop();
  assert.equal(e.calls[0].cancelled, true);
  t.mock.timers.tick(300);
  assert.equal(cloud.asked.length, 0);
  e.calls[0].finish(found(30, 12));
  await tick();
  assert.deepEqual([changes, e.calls.length], [0, 1]);
  // a request already sent is aborted
  const w2 = evals.watch(request(e, { after: ['d2d4'], cloud: { on: true } }), () => changes++);
  t.mock.timers.tick(300);
  w2.stop();
  assert.equal(cloud.asked[0].signal.aborted, true);
  cloud.asked[0].answer(fromCloud(40, 30));
  await tick();
  assert.equal(changes, 0);
});

test('results are kept apart by engine name, start FEN and settings', async () => {
  const evals = ME.create(), e = fakeEngine();
  evals.watch(request(e), () => {});
  await finishBoth(e, 0, found(30, 12), found(25, 12));
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2';
  for (const more of [{ settings: { ...OWN, name: 'full' } }, { fen }, { settings: { ...OWN, depth: 14 } }, { settings: { ...OWN, time_limit: 3 } }]) {
    const n = e.calls.length, w = evals.watch(request(e, more), () => {});
    assert.equal(w.get().pending, true);
    await tick();
    assert.equal(e.calls.length, n + 1);
    w.stop();
  }
});

test('keyOf: empty for a request that asks nothing, and changed by what needs a new watch', () => {
  const evals = ME.create(), e = fakeEngine(), r = request(e);
  assert.equal(evals.keyOf(request(e, { after: null })), '');
  assert.equal(evals.positionKey(request(e, { after: null })), '');
  assert.equal(evals.keyOf(r), evals.keyOf(request(fakeEngine())));
  const stored = { cp: 1, depth: 10, pv: [], stored: true, src: 'a' };
  const others = [{ after: ['d2d4'] }, { off: true }, { auto: true }, { cloud: { on: true } }, { cloud: { on: true, prefer: true } }, { stored }, { settings: { ...OWN, lines: 2 } }];
  const keys = new Set([evals.keyOf(r), ...others.map((m) => evals.keyOf(request(e, m)))]);
  assert.equal(keys.size, others.length + 1);
  const w = evals.watch(request(e, { after: null }), () => {});
  assert.deepEqual(w.get(), { ...ME.EMPTY, deeper: null, deeperTo: null, failed: null });
  w.stop();
});
