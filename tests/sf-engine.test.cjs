const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
const { nodeWorker } = require('./node-worker.cjs');
loadUnit('chess-core.js');
loadUnit('analysis-core.js');
loadUnit('sf-engine.js');
const SF = window.SFEngine;

// A scripted engine: answers uci/isready (unless silent); each `go` waits for finish(best, infoLine)
function fakeWorker({ silent = false, noReady = false } = {}) {
  const w = { posted: [], onmessage: null, onerror: null };
  const say = (line) => setTimeout(() => w.onmessage && w.onmessage({ data: line }), 0);
  w.postMessage = (s) => {
    w.posted.push(s);
    if (silent) return;
    if (s === 'uci') say('uciok');
    if (s === 'isready' && !noReady) say('readyok');
  };
  w.finish = (best, info = 'info depth 5 score cp 10 pv ' + best) => { say(info); say('bestmove ' + best); };
  w.terminate = () => {};
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const positions = (w) => w.posted.filter((s) => s.startsWith('position'));

test('positionCommand', () => {
  assert.equal(SF.positionCommand([]), 'position startpos');
  assert.equal(SF.positionCommand(['e2e4', 'e7e5']), 'position startpos moves e2e4 e7e5');
});

test('positionCommand with a start FEN', () => {
  assert.equal(SF.positionCommand([], '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1'), 'position fen 4k3/8/8/8/8/8/4P3/4K3 b - - 0 1');
  assert.equal(SF.positionCommand(['e8d7'], '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1'), 'position fen 4k3/8/8/8/8/8/4P3/4K3 b - - 0 1 moves e8d7');
  assert.equal(SF.positionCommand(['e2e4'], window.ChessCore.START_FEN), 'position startpos moves e2e4');
});
test('ready rejects after readyTimeoutMs when the worker is silent', async () => {
  const e = SF.create(() => fakeWorker({ silent: true }), { readyTimeoutMs: 50 });
  await assert.rejects(e.ready());
});

test('ready rejects at once when the engine died before it was asked', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker({ silent: true })), { readyTimeoutMs: 60000 });
  w.onerror(new Error('wasm crashed'));
  const t0 = Date.now();
  await assert.rejects(e.ready(), /wasm crashed/);
  assert.ok(Date.now() - t0 < 1000);
});

test('ready sets the hash size', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  assert.ok(w.posted.includes('setoption name Hash value 64'));
});

test('an own search runs before queued game searches but never interrupts one', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const a = e.search({ moves: ['e2e4'], depth: 22, movetimeMs: 3000, priority: 'game' });
  const b = e.search({ moves: ['e2e4', 'e7e5'], depth: 22, movetimeMs: 3000, priority: 'game' });
  await tick();
  const c = e.search({ moves: ['d2d4'], depth: 24, movetimeMs: 3000, priority: 'own' });
  await tick();
  assert.equal(w.posted.filter((s) => s === 'stop').length, 0);
  w.finish('e7e5'); await a.promise; await tick();
  w.finish('d7d5'); await c.promise; await tick();
  w.finish('g1f3'); await b.promise;
  assert.deepEqual(positions(w), ['position startpos moves e2e4', 'position startpos moves d2d4', 'position startpos moves e2e4 e7e5']);
  assert.ok(w.posted.includes('go depth 24 movetime 3000'));
});

test('a play search runs before own and game searches, in queue order within each, never interrupting one', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const a = e.search({ moves: [], depth: 20, movetimeMs: 3000, priority: 'game' });
  await tick();
  const g = e.search({ moves: ['a2a3'], depth: 20, movetimeMs: 3000, priority: 'game' });
  const o = e.search({ moves: ['b2b3'], depth: 20, movetimeMs: 3000, priority: 'own' });
  const p1 = e.search({ moves: ['c2c3'], depth: null, movetimeMs: 2000, priority: 'play' });
  const p2 = e.search({ moves: ['d2d3'], depth: null, movetimeMs: 2000, priority: 'play' });
  await tick();
  assert.equal(w.posted.filter((s) => s === 'stop').length, 0);
  for (const [q, best] of [[a, 'e2e4'], [p1, 'e7e5'], [p2, 'e7e5'], [o, 'e7e5'], [g, 'e7e5']]) { w.finish(best); await q.promise; await tick(); }
  assert.deepEqual(positions(w), ['position startpos', 'position startpos moves c2c3', 'position startpos moves d2d3', 'position startpos moves b2b3', 'position startpos moves a2a3']);
  assert.ok(w.posted.includes('go movetime 2000'), 'no depth limit: the time alone ends the search');
});

test('a cancelled queued search never posts go and resolves null', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const a = e.search({ moves: [], depth: 20, movetimeMs: 3000, priority: 'game' });
  const b = e.search({ moves: ['e2e4'], depth: 20, movetimeMs: 3000, priority: 'game' });
  b.cancel();
  w.finish('e2e4'); await a.promise; await tick();
  assert.equal(await b.promise, null);
  assert.deepEqual(positions(w), ['position startpos']);
});

test('cancelling the running search sends stop and resolves with its last score', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const a = e.search({ moves: [], depth: 20, movetimeMs: 3000, priority: 'own' });
  await tick();
  a.cancel();
  assert.ok(w.posted.includes('stop'));
  w.finish('d2d4', 'info depth 7 score cp 25 pv d2d4 d7d5');
  assert.deepEqual(await a.promise, { cp: 25, depth: 7, lines: [{ k: 1, cp: 25, depth: 7, pv: ['d2d4', 'd7d5'] }], maxDepth: 7, pv: ['d2d4', 'd7d5'], nodes: null, timeMs: null, best: 'd2d4' });
});

test('onInfo streams scores from White\'s point of view', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const seen = [];
  const a = e.search({ moves: ['e2e4'], depth: 20, movetimeMs: 3000, priority: 'own', onInfo: (s) => seen.push(s.cp) });
  await tick();
  w.finish('e7e5', 'info depth 9 score cp 30 pv e7e5');
  await a.promise;
  assert.deepEqual(seen, [-30]);
});

test('onInfo is from White\'s point of view when the FEN has Black to move', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const seen = [];
  const a = e.search({ moves: [], fen: '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1', depth: 20, movetimeMs: 3000, priority: 'own', onInfo: (s) => seen.push(s.cp) });
  await tick();
  assert.deepEqual(positions(w), ['position fen 4k3/8/8/8/8/8/4P3/4K3 b - - 0 1']);
  w.finish('e8d7', 'info depth 5 score cp 50 pv e8d7');
  const r = await a.promise;
  assert.deepEqual(seen, [-50]);
  assert.equal(r.cp, -50);
});

test('real engine: a FEN start with Black to move finds the mate', { timeout: 60000 }, async () => {
  const e = SF.create(nodeWorker, {});
  try {
    await e.ready();
    const r = await e.search({ moves: [], fen: 'r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', depth: 10, movetimeMs: 3000, priority: 'own' }).promise;
    assert.ok(r.cp <= -9990, r.cp);
    assert.equal(r.pv[0], 'a8a1');
  } finally { e.quit(); }
});

test('real engine: castling rights survive a move list', { timeout: 60000 }, async () => {
  const e = SF.create(nodeWorker, {});
  try {
    await e.ready();
    const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'];
    const r = await e.search({ moves, depth: 12, movetimeMs: 10000, priority: 'own' }).promise;
    assert.equal(r.depth, 12);
    let pos = window.ChessCore.posFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w');
    for (const u of moves) pos = window.ChessCore.applyUci(pos, u).pos;
    assert.ok(window.ChessCore.applyUci(pos, r.best), r.best);
  } finally { e.quit(); }
});

test('real engine: a mated position gives no move and a mate score', { timeout: 60000 }, async () => {
  const e = SF.create(nodeWorker, {});
  try {
    await e.ready();
    const r = await e.search({ moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'], depth: 12, movetimeMs: 3000, priority: 'own' }).promise;
    assert.equal(r.best, null);
    assert.equal(r.cp, -10000);
  } finally { e.quit(); }
});

test('a search started before ready() finishes waits for readyok', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  const r = e.ready();
  const a = e.search({ moves: [], depth: 20, movetimeMs: 3000, priority: 'own' });
  await r; await tick();
  const order = w.posted.filter((s) => s === 'isready' || s.startsWith('position'));
  assert.deepEqual(order, ['isready', 'position startpos']);
  w.finish('e2e4'); await a.promise;
});

test('a worker error resolves the running and queued searches with null', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const a = e.search({ moves: [], depth: 20, movetimeMs: 3000, priority: 'game' });
  const b = e.search({ moves: ['e2e4'], depth: 20, movetimeMs: 3000, priority: 'game' });
  await tick();
  w.onerror(new Error('wasm crashed'));
  assert.equal(await a.promise, null);
  assert.equal(await b.promise, null);
  assert.ok(e.failed());
  assert.equal(await e.search({ moves: [], depth: 1, movetimeMs: 10, priority: 'own' }).promise, null);
});

test('a worker that misses the ready timeout is terminated', async () => {
  let w;
  const e = SF.create(() => { w = fakeWorker({ silent: true }); w.terminated = false; w.terminate = () => { w.terminated = true; }; return w; }, { readyTimeoutMs: 50 });
  await assert.rejects(e.ready());
  assert.equal(w.terminated, true);
});

test('the default ready timeout allows a slow download (30 s)', () => {
  assert.equal(SF.READY_TIMEOUT_MS, 30000);
});

test('onFail reports an engine that dies after it started', async () => {
  let w, reported = null;
  const e = SF.create(() => (w = fakeWorker()), { onFail: (err) => { reported = err; } });
  await e.ready();
  const a = e.search({ moves: [], depth: 20, movetimeMs: 3000, priority: 'own' });
  await tick();
  w.onerror(new Error('wasm crashed'));
  assert.equal(await a.promise, null);
  assert.equal(reported && reported.message, 'wasm crashed');
});

test('a search cut off mid-depth reports the whole search: its time, nodes and the unfinished depth', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const a = e.search({ moves: [], depth: 24, movetimeMs: 3000, priority: 'own' });
  await new Promise((r) => setTimeout(r, 5));
  w.onmessage({ data: 'info depth 22 seldepth 30 multipv 1 score cp 30 nodes 1000000 nps 1 time 2400 pv e2e4 e7e5' });
  w.onmessage({ data: 'info depth 23 seldepth 33 multipv 1 score cp 41 lowerbound nodes 1500000 nps 1 time 3000 pv e2e4' });
  w.onmessage({ data: 'bestmove e2e4' });
  const r = await a.promise;
  assert.equal(r.cp, 30, 'eval from the last complete depth');
  assert.equal(r.depth, 22);
  assert.equal(r.maxDepth, 23);
  assert.equal(r.nodes, 1500000);
  assert.equal(r.timeMs, 3000);
});

test('setHash waits for the running search, then applies before the next one', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), { hashMB: 32 });
  await e.ready();
  assert.ok(w.posted.includes('setoption name Hash value 32'));
  const a = e.search({ moves: [], depth: 5, movetimeMs: 100 });
  await tick();
  e.setHash(128);
  assert.ok(!w.posted.includes('setoption name Hash value 128'), 'not mid-search');
  const b = e.search({ moves: ['e2e4'], depth: 5, movetimeMs: 100 });
  w.finish('e2e4'); await a.promise; await tick();
  const i = w.posted.indexOf('setoption name Hash value 128');
  assert.ok(i > 0 && i < w.posted.indexOf('position startpos moves e2e4'), 'set before the next position');
  w.finish('e7e5'); await b.promise;
  e.setHash(128); e.search({ moves: [], depth: 5, movetimeMs: 100 }); await tick();
  assert.equal(w.posted.filter((s) => s === 'setoption name Hash value 128').length, 1, 'only when it changes');
});

test('quit resolves the running and queued searches with null, and later ones at once (switching engines mid-search)', async () => {
  const w = fakeWorker();
  const e = SF.create(() => w);
  await e.ready();
  const a = e.search({ moves: [], depth: 10, movetimeMs: 1000, priority: 'game' });
  const b = e.search({ moves: ['e2e4'], depth: 10, movetimeMs: 1000, priority: 'game' });
  await tick();
  e.quit();
  assert.equal(await a.promise, null);
  assert.equal(await b.promise, null);
  assert.equal(await e.search({ moves: [], depth: 10, movetimeMs: 1000 }).promise, null);
  assert.ok(w.posted.includes('quit'));
});

test('MultiPV is set before a search that asks for other lines than the last, and only then', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const mpv = () => w.posted.filter((s) => s.startsWith('setoption name MultiPV'));
  const run = async (lines, best) => { const h = e.search({ moves: [], depth: 5, movetimeMs: 100, lines }); await tick(); w.finish(best); return h.promise; };
  await run(undefined, 'e2e4');
  assert.deepEqual(mpv(), [], 'one line is the default: nothing sent');
  await run(3, 'e2e4'); await run(3, 'e2e4');
  assert.deepEqual(mpv(), ['setoption name MultiPV value 3']);
  const i = w.posted.indexOf('setoption name MultiPV value 3');
  assert.ok(w.posted[i + 1].startsWith('position'), 'between searches, before the position');
  await run(1, 'e2e4'); // the opponent and a game's analysis search one line
  assert.deepEqual(mpv(), ['setoption name MultiPV value 3', 'setoption name MultiPV value 1']);
});

test('a MultiPV search keeps each line by rank; cp, pv and best stay line 1’s; a line left behind is dropped', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const seen = [];
  const h = e.search({ moves: [], depth: 12, movetimeMs: 1000, lines: 3, onInfo: (s) => seen.push(s) });
  await tick();
  const say = (l) => w.onmessage({ data: l });
  say('info depth 10 multipv 1 score cp 30 nodes 100 pv e2e4 e7e5');
  say('info depth 10 multipv 2 score cp 25 nodes 200 pv d2d4 d7d5');
  say('info depth 10 multipv 3 score cp 20 nodes 300 pv g1f3 g8f6');
  say('info depth 11 multipv 1 score cp 28 nodes 400 pv e2e4 c7c5');
  say('info depth 11 multipv 2 score cp 26 upperbound nodes 450 pv d2d4');
  say('info depth 11 multipv 2 score cp 24 nodes 500 pv d2d4 g8f6');
  // line 3 never reached depth 11, and line 1 went on to 12: line 3 is two depths behind
  say('info depth 12 multipv 1 score cp 27 nodes 600 pv e2e4 e7e6');
  say('bestmove e2e4');
  const r = await h.promise;
  assert.deepEqual([r.cp, r.pv, r.best, r.depth], [27, ['e2e4', 'e7e6'], 'e2e4', 12]);
  assert.deepEqual(r.lines, [{ k: 1, cp: 27, depth: 12, pv: ['e2e4', 'e7e6'] }, { k: 2, cp: 24, depth: 11, pv: ['d2d4', 'g8f6'] }]);
  const at3 = seen.find((s) => s.lines.length === 3);
  assert.deepEqual(at3.lines.map((l) => l.pv[0]), ['e2e4', 'd2d4', 'g1f3']);
  assert.equal(at3.cp, 30, 'onInfo carries line 1’s score');
});

test('lines are from White’s point of view with Black to move, and a one-line search lists its one line', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const a = e.search({ moves: ['e2e4'], depth: 5, movetimeMs: 100, lines: 2 });
  await tick();
  w.onmessage({ data: 'info depth 5 multipv 1 score cp 10 pv e7e5' });
  w.onmessage({ data: 'info depth 5 multipv 2 score cp -5 pv c7c5' });
  w.onmessage({ data: 'bestmove e7e5' });
  assert.deepEqual((await a.promise).lines.map((l) => l.cp), [-10, 5]);
  const b = e.search({ moves: [], depth: 5, movetimeMs: 100 });
  await tick(); w.finish('e2e4');
  assert.deepEqual((await b.promise).lines, [{ k: 1, cp: 10, depth: 5, pv: ['e2e4'] }]);
});

test('real engine: three lines at the start begin with three different moves', { timeout: 60000 }, async () => {
  const e = SF.create(nodeWorker, {});
  try {
    await e.ready();
    const r = await e.search({ moves: [], depth: 12, movetimeMs: 10000, priority: 'own', lines: 3 }).promise;
    assert.equal(r.lines.length, 3);
    assert.equal(new Set(r.lines.map((l) => l.pv[0])).size, 3, JSON.stringify(r.lines));
    assert.equal(r.lines[0].pv[0], r.best);
    assert.ok(r.lines.every((l) => l.depth >= 11), JSON.stringify(r.lines.map((l) => l.depth)));
  } finally { e.quit(); }
});

test('ready sets Threads after Hash when more than one, and not at all for one', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), { threaded: true, threads: 4 });
  await e.ready();
  const t = w.posted.indexOf('setoption name Threads value 4');
  assert.ok(t > w.posted.indexOf('setoption name Hash value 64'), w.posted.join(' | '));
  let w1;
  await SF.create(() => (w1 = fakeWorker()), {}).ready();
  assert.ok(!w1.posted.some((s) => s.startsWith('setoption name Threads')));
});

test('setThreads waits for the running search, then applies before the next one, only on change', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), { threaded: true });
  await e.ready();
  const a = e.search({ moves: [], depth: 5, movetimeMs: 100 });
  await tick();
  e.setThreads(4);
  assert.ok(!w.posted.includes('setoption name Threads value 4'), 'not mid-search');
  const b = e.search({ moves: ['e2e4'], depth: 5, movetimeMs: 100 });
  w.finish('e2e4'); await a.promise; await tick();
  const i = w.posted.indexOf('setoption name Threads value 4');
  assert.ok(i > 0 && i < w.posted.indexOf('position startpos moves e2e4'), 'set before the next position');
  w.finish('e7e5'); await b.promise;
  e.setThreads(4); e.search({ moves: [], depth: 5, movetimeMs: 100 }); await tick();
  assert.equal(w.posted.filter((s) => s === 'setoption name Threads value 4').length, 1, 'only when it changes');
});

test('threadSupport: isolation, shared memory, Safari 26.2, and the cores', () => {
  const env = (o = {}) => ({ crossOriginIsolated: true, Atomics, SharedArrayBuffer, WebAssembly, navigator: { hardwareConcurrency: 8, userAgent: 'Mozilla/5.0 Firefox/150.0' }, ...o });
  assert.deepEqual(SF.threadSupport(env()), { ok: true, cores: 8, reason: '' });
  assert.deepEqual(SF.threadSupport(env({ crossOriginIsolated: false })), { ok: false, cores: 8, reason: 'This page isn’t cross-origin isolated' });
  assert.equal(SF.threadSupport(env({ SharedArrayBuffer: undefined })).reason, 'This browser has no shared memory');
  assert.equal(SF.threadSupport(env({ WebAssembly: { Memory: function () { throw new Error('no'); } } })).reason, 'This browser has no shared memory');
  const safari = { hardwareConcurrency: 8, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1' };
  assert.equal(SF.threadSupport(env({ navigator: safari })).reason, 'Safari 26.2 crashes with threads');
  assert.equal(SF.threadSupport(env({ navigator: { userAgent: 'x' } })).cores, 1);
});

test('real engine: threaded lite searches more nodes with 4 threads than 1', { timeout: 60000 }, async () => {
  const e = SF.create(() => nodeWorker('stockfish-19-lite.js'), { threaded: true });
  const fen = 'r1bq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/R3KB1R w KQ - 3 9';
  try {
    await e.ready();
    const one = await e.search({ moves: [], fen, depth: null, movetimeMs: 1500 }).promise;
    e.setThreads(4);
    const four = await e.search({ moves: [], fen, depth: null, movetimeMs: 1500 }).promise;
    assert.ok(four.nodes > 2 * one.nodes, `${one.nodes} → ${four.nodes}`);
  } finally { e.quit(); }
});

// Firefox: the first threaded engine in a page can answer readyok and then never search (no info, no bestmove, even
// after stop); a fresh worker then works. probeMs: ready() waits for a depth-1 search, else the engine fails
test('probeMs: ready waits for a depth-1 search after readyok', async () => {
  let w, ok = false;
  const e = SF.create(() => (w = fakeWorker()), { threaded: true, threads: 4, probeMs: 1000 });
  const r = e.ready().then(() => { ok = true; });
  await tick();
  assert.equal(ok, false, 'not ready before the probe answers');
  assert.ok(w.posted.includes('go depth 1'), w.posted.join(' | '));
  assert.ok(w.posted.indexOf('setoption name Threads value 4') < w.posted.indexOf('go depth 1'));
  w.finish('e2e4');
  await r;
  // the probe is not a search of the page's: the first real one goes as usual
  const s = e.search({ moves: [], depth: 5, movetimeMs: 100 });
  await tick();
  assert.match(w.posted.at(-1), /^go depth 5 movetime 100$/);
  w.finish('d2d4');
  assert.equal((await s.promise).best, 'd2d4');
});

test('probeMs: a probe that never answers fails the engine and terminates it', async () => {
  let w, terminated = false;
  const e = SF.create(() => { w = fakeWorker(); w.terminate = () => { terminated = true; }; return w; }, { threaded: true, threads: 4, probeMs: 30 });
  await assert.rejects(e.ready(), /threads didn’t start/);
  assert.equal(terminated, true);
});

// a game's analysis keeps the threads it started with (search({ threads })), whatever the setting does meanwhile;
// a single-thread build never gets Threads
test('a search that asks for threads gets them before it; other searches get the engine\'s', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), { threaded: true, threads: 2 });
  await e.ready();
  assert.equal(e.threaded, true);
  const a = e.search({ moves: [], depth: 5, movetimeMs: 100, threads: 4 });
  await tick();
  assert.ok(w.posted.indexOf('setoption name Threads value 4') < w.posted.indexOf('position startpos'));
  w.finish('e2e4'); await a.promise;
  const b = e.search({ moves: ['e2e4'], depth: 5, movetimeMs: 100 });
  await tick();
  const i = w.posted.lastIndexOf('setoption name Threads value 2');
  assert.ok(i > w.posted.indexOf('setoption name Threads value 4') && i < w.posted.indexOf('position startpos moves e2e4'), w.posted.join(' | '));
  w.finish('e7e5'); await b.promise;
  let w1;
  const one = SF.create(() => (w1 = fakeWorker()), { threads: 4 });
  await one.ready();
  assert.equal(one.threaded, false);
  one.setThreads(3);
  const c = one.search({ moves: [], depth: 5, movetimeMs: 100, threads: 4 });
  await tick(); w1.finish('e2e4'); await c.promise;
  assert.ok(!w1.posted.some((m) => m.startsWith('setoption name Threads')), w1.posted.join(' | '));
});

// Firefox can also hang while it starts the threads (readyok never comes after Threads): that is the probe's too
test('probeMs: from uciok on, a missing readyok fails as the probe does', async () => {
  const e = SF.create(() => fakeWorker({ noReady: true }), { threaded: true, threads: 4, probeMs: 30 });
  await assert.rejects(e.ready(), /threads didn’t start/);
});
