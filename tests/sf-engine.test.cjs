const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
const { nodeWorker } = require('./node-worker.cjs');
loadUnit('chess-core.js');
loadUnit('analysis-core.js');
loadUnit('sf-engine.js');
const SF = window.SFEngine;

// A scripted engine: answers uci/isready (unless silent); each `go` waits for finish(best, infoLine)
// maxHashMB: a larger Hash gets Stockfish's allocation failure, after which the worker answers nothing
function fakeWorker({ silent = false, noReady = false, maxHashMB = Infinity } = {}) {
  const w = { posted: [], onmessage: null, onerror: null };
  const say = (line) => setTimeout(() => w.onmessage && w.onmessage({ data: line }), 0);
  let dead = false;
  w.postMessage = (s) => {
    w.posted.push(s);
    if (silent || dead) return;
    const h = /^setoption name Hash value (\d+)$/.exec(s);
    if (h && +h[1] > maxHashMB) { dead = true; say(`Failed to allocate ${h[1]}MB for transposition table.`); return; }
    if (s === 'uci') say('uciok');
    if (s === 'isready' && !noReady) say('readyok');
  };
  w.finish = (best, info = 'info depth 5 score cp 10 pv ' + best) => { say(info); say('bestmove ' + best); };
  w.terminate = () => {};
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 5));
// ticks until cond holds (a loaded build machine can take more than one tick over a chain of worker answers)
const until = async (cond, ms = 2000) => { for (const t0 = Date.now(); !cond() && Date.now() - t0 < ms;) await tick(); };
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

test('a worker\'s error event is handled, so the browser doesn\'t also report it as uncaught', async () => {
  const ws = [];
  const e = SF.create(() => { const w = fakeWorker({ silent: true }); ws.push(w); return w; }, { readyTimeoutMs: 60000 });
  const ev = () => ({ type: 'error', prevented: false, preventDefault() { this.prevented = true; } });
  const first = ev();
  ws[0].onerror(first);
  assert.ok(first.prevented);
  await assert.rejects(e.ready());
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

test('a MultiPV search keeps each line by rank; cp, pv and best stay line 1’s; a line left behind is kept', async () => {
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
  // line 3 never reached depth 11, and line 1 went on to 12: line 3 is two depths behind, and still listed
  say('info depth 12 multipv 1 score cp 27 nodes 600 pv e2e4 e7e6');
  say('bestmove e2e4');
  const r = await h.promise;
  assert.deepEqual([r.cp, r.pv, r.best, r.depth], [27, ['e2e4', 'e7e6'], 'e2e4', 12]);
  assert.deepEqual(r.lines, [{ k: 1, cp: 27, depth: 12, pv: ['e2e4', 'e7e6'] }, { k: 2, cp: 24, depth: 11, pv: ['d2d4', 'g8f6'] }, { k: 3, cp: 20, depth: 10, pv: ['g1f3', 'g8f6'] }]);
  const at3 = seen.find((s) => s.lines.length === 3);
  assert.deepEqual(at3.lines.map((l) => l.pv[0]), ['e2e4', 'd2d4', 'g1f3']);
  assert.equal(at3.cp, 30, 'onInfo carries line 1’s score');
});

test('several threads: line 1 ends two depths past line 2, whose last report is a bound; line 2 is kept', async () => {
  // as the real lite engine with 4 threads ended its 3 s search of the sample game's position after 24...Rb8 (2026-11-08)
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const h = e.search({ moves: [], depth: null, movetimeMs: 3000, lines: 2 });
  await tick();
  const say = (l) => w.onmessage({ data: l });
  say('info depth 19 multipv 1 score cp 151 time 1870 pv b7b8 f8b8');
  say('info depth 19 multipv 2 score cp -77 time 1871 pv a6b6 c6b7');
  say('info depth 21 multipv 1 score cp 170 time 3001 pv b7b8 f8b8');
  say('info depth 21 multipv 2 score cp -58 upperbound time 3001 pv a6b6 c6b7');
  say('bestmove b7b8');
  const r = await h.promise;
  assert.deepEqual(r.lines.map((l) => [l.k, l.depth, l.pv[0]]), [[1, 21, 'b7b8'], [2, 19, 'a6b6']]);
});

test('line 1 turns to line 2’s move and line 2’s last report is a bound: line 2 is the move that bound names', async () => {
  // as the page's 2-line, 4-thread, 2 s analysis ended its search after 19. Rd6 of the sample game (2026-11-08): before the
  // fix the line kept at rank 2 was c5 again, at depth 20
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const h = e.search({ moves: [], depth: null, movetimeMs: 2000, lines: 2 });
  await tick();
  const say = (l) => w.onmessage({ data: l });
  say('info depth 20 multipv 1 score cp 2 time 1436 pv f8d8 c3c5');
  say('info depth 20 multipv 2 score cp 0 time 1436 pv c6c5 d6a6');
  say('info depth 21 multipv 1 score cp 0 time 2002 pv c6c5 d6a6');
  say('info depth 21 multipv 2 score cp 0 upperbound time 2002 pv f8d8 c3c5');
  say('bestmove c6c5');
  const r = await h.promise;
  assert.deepEqual(r.lines.map((l) => [l.k, l.depth, l.cp, l.pv[0]]), [[1, 21, 0, 'c6c5'], [2, 20, 2, 'f8d8']]);
});

test('line 1’s last report is a bound on a new move, and line 2’s names line 1’s old move: line 2 is the new move', async () => {
  // as the page's 2-line, 4-thread, 2 s analysis in Firefox ended its search after 3. Bg2 of the sample game (2026-11-09)
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const h = e.search({ moves: ['e2e4'], depth: null, movetimeMs: 2000, lines: 2 });
  await tick();
  const say = (l) => w.onmessage({ data: l });
  say('info depth 22 multipv 1 score cp -17 time 1548 pv g7g6 e1g1');
  say('info depth 22 multipv 2 score cp -20 time 1548 pv c7c5 e1g1');
  say('info depth 23 multipv 1 score cp -18 lowerbound time 2001 pv c7c5 e1g1');
  say('info depth 23 multipv 2 score cp -20 time 2001 pv g7g6 e1g1');
  say('bestmove c7c5');
  const r = await h.promise;
  // Black to move: the scores are White's
  assert.deepEqual(r.lines.map((l) => [l.k, l.depth, l.cp, l.pv[0]]), [[1, 22, 17, 'g7g6'], [2, 22, 20, 'c7c5']]);
});

test('line 2’s last report is a bound on a move never scored complete: line 2 is the deepest other move scored', async () => {
  // as the page's analysis in Firefox ended its search after 11...c6 of the sample game (2026-11-09)
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const h = e.search({ moves: [], depth: null, movetimeMs: 2000, lines: 2 });
  await tick();
  const say = (l) => w.onmessage({ data: l });
  say('info depth 17 multipv 1 score cp 22 time 1013 pv a2a4 b8d7');
  say('info depth 17 multipv 2 score cp 8 time 1013 pv f1d1 b8d7');
  say('info depth 18 multipv 1 score cp 9 time 1422 pv d2g5 e4f3');
  say('info depth 18 multipv 2 score cp 6 time 1422 pv f1d1 b8d7');
  say('info depth 19 multipv 1 score cp 9 time 2000 pv f1d1 b8d7');
  say('info depth 19 multipv 2 score cp 7 lowerbound time 2000 pv d2e3');
  say('bestmove f1d1');
  const r = await h.promise;
  assert.deepEqual(r.lines.map((l) => [l.k, l.depth, l.cp, l.pv[0]]), [[1, 19, 9, 'f1d1'], [2, 18, 9, 'd2g5']]);
});

test('a line whose move is already listed is left out, and an empty rank filled with the deepest other move scored', async () => {
  let w;
  const e = SF.create(() => (w = fakeWorker()), {});
  await e.ready();
  const h = e.search({ moves: [], depth: null, movetimeMs: 3000, lines: 3 });
  await tick();
  const say = (l) => w.onmessage({ data: l });
  say('info depth 18 multipv 1 score cp 40 pv g1h1 f2e1');
  say('info depth 18 multipv 2 score cp 30 pv g1f1 f2e1');
  say('info depth 18 multipv 3 score cp 20 pv g1f2 b8b2');
  // line 1 turns to g1f1; rank 2 is last reported with no pv, so all it has is g1f1's score from depth 18; g1h1, line 1
  // at depth 18, is the other move scored
  say('info depth 19 multipv 1 score cp 45 pv g1f1 b8b2');
  say('info depth 19 multipv 2 score cp 35 upperbound');
  say('info depth 19 multipv 3 score cp 15 pv g1f2 b8b2');
  say('bestmove g1f1');
  const r = await h.promise;
  assert.deepEqual(r.lines.map((l) => [l.k, l.depth, l.pv[0]]), [[1, 19, 'g1f1'], [2, 19, 'g1f2'], [3, 18, 'g1h1']]);
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

// skipped in Render's deploy build (RENDER is set there): its few cores gave 1.9x once, and a flaky test must not stop a deploy; GitHub Actions still runs it
test('real engine: threaded lite searches more nodes with 4 threads than 1', { timeout: 60000, skip: process.env.RENDER ? 'Render has too few cores to time it' : false }, async () => {
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
  await until(() => w && w.posted.includes('go depth 1'));
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

// A search can hang after the probe too (WebKit on GitHub, 2026-10-28: a threaded engine passed its probe, then never
// answered go movetime 1000): hangMs past its movetime, a fresh worker takes the search over, the same engine to the page
test('a search that runs hangMs past its movetime moves to a fresh worker, which gets the probe and the options again', async () => {
  const ws = [], ended = [];
  const e = SF.create(() => { const w = fakeWorker(); w.terminate = () => ended.push(w); ws.push(w); return w; }, { threaded: true, threads: 4, probeMs: 1000, hangMs: 40 });
  const r = e.ready(); await tick(); ws[0].finish('e2e4'); await r;
  const s = e.search({ moves: ['e2e4'], depth: null, movetimeMs: 20, lines: 2 });
  await tick();
  assert.equal(ws.length, 1);
  await new Promise((res) => setTimeout(res, 80));
  assert.equal(ws.length, 2, 'a fresh worker');
  assert.deepEqual(ended, [ws[0]], 'the hung one is terminated');
  const w = ws[1];
  assert.ok(w.posted.includes('go depth 1'), 'the fresh worker is probed: ' + w.posted.join(' | '));
  w.finish('e2e4'); await tick();
  assert.ok(w.posted.includes('setoption name Threads value 4') && w.posted.includes('setoption name MultiPV value 2'), w.posted.join(' | '));
  assert.equal(w.posted.at(-1), 'go movetime 20');
  w.finish('e7e5');
  assert.equal((await s.promise).best, 'e7e5');
  assert.equal(e.failed(), null);
});

test('a search that hangs on three workers in a row fails the engine; a bestmove in between starts the count again', async () => {
  const ws = [];
  let reported = null;
  const e = SF.create(() => { const w = fakeWorker(); ws.push(w); return w; }, { hangMs: 100, onFail: (err) => { reported = err; } });
  await e.ready();
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const a = e.search({ moves: [], depth: null, movetimeMs: 10 });
  await wait(150);
  assert.equal(ws.length, 2);
  ws[1].finish('e2e4');
  assert.equal((await a.promise).best, 'e2e4');
  const b = e.search({ moves: ['e2e4'], depth: null, movetimeMs: 10 });
  const c = e.search({ moves: ['d2d4'], depth: null, movetimeMs: 10 });
  await wait(450);
  assert.equal(ws.length, 4, 'three workers in a row for b, then none');
  assert.equal(await b.promise, null);
  assert.equal(await c.promise, null);
  assert.match(reported && reported.message, /stopped answering/);
});

test('a cancelled search that hangs answers with its last score, and the next search runs on a fresh worker', async () => {
  const ws = [];
  const e = SF.create(() => { const w = fakeWorker(); ws.push(w); return w; }, { hangMs: 20 });
  await e.ready();
  const a = e.search({ moves: [], depth: null, movetimeMs: 10 });
  const b = e.search({ moves: ['e2e4'], depth: null, movetimeMs: 10 });
  await tick();
  ws[0].onmessage({ data: 'info depth 7 score cp 31 pv e2e4' });
  a.cancel();
  const r = await a.promise;
  assert.equal(r.cp, 31);
  assert.equal(ws.length, 2);
  await tick();
  assert.equal(positions(ws[1]).at(-1), 'position startpos moves e2e4');
  ws[1].finish('e7e5');
  assert.equal((await b.promise).best, 'e7e5');
});

test('simdSupport: WebAssembly SIMD validates here, and not without it or without WebAssembly', () => {
  assert.equal(SF.simdSupport(), true);
  assert.equal(SF.simdSupport({ WebAssembly: { validate: () => false } }), false);
  assert.equal(SF.simdSupport({}), false);
  assert.equal(SF.simdSupport({ WebAssembly: { validate: () => { throw new Error('no'); } } }), false);
});

// the asm.js build, for browsers without WebAssembly SIMD: it speaks UCI as the others do, if slowly
test('the asm.js engine answers a search', async () => {
  const e = SF.create(() => nodeWorker('stockfish-19-asm.js'));
  try {
    await e.ready();
    const r = await e.search({ moves: ['e2e4'], depth: 8, movetimeMs: 10000 }).promise;
    assert.ok(r && r.depth >= 8 && r.cp != null && /^[a-h][1-8][a-h][1-8]/.test(r.best), JSON.stringify(r));
  } finally { e.quit(); }
});

// a hash table the device can't give memory for: the engine says so and answers nothing more; a fresh worker with 64 MB
// takes over, the search that was running starts again there, and onHashFail says what happened
test('a Hash the engine can\'t allocate moves to a fresh worker with 64 MB, and the search runs there', async () => {
  const ws = [], told = [];
  const e = SF.create(() => { const w = fakeWorker({ maxHashMB: 256 }); ws.push(w); return w; }, { onHashFail: (mb, to) => told.push([mb, to]) });
  await e.ready();
  e.setHash(512);
  const s = e.search({ moves: ['e2e4'], depth: 5, movetimeMs: 100 });
  await until(() => ws.length === 2 && ws[1].posted.some((m) => m.startsWith('go depth 5')));
  assert.deepEqual(told, [[512, 64]]);
  assert.ok(ws[1].posted.includes('setoption name Hash value 64'), ws[1].posted.join(' | '));
  assert.ok(!ws[1].posted.includes('setoption name Hash value 512'));
  ws[1].finish('e7e5');
  assert.equal((await s.promise).best, 'e7e5');
  assert.equal(e.failed(), null);
  // later searches stay on the new worker at 64 MB
  const s2 = e.search({ moves: [], depth: 5, movetimeMs: 100 });
  await tick();
  assert.equal(ws.length, 2);
  ws[1].finish('d2d4');
  assert.equal((await s2.promise).best, 'd2d4');
});

test('a Hash too big from the start: ready() comes on the fresh worker, threads probe included', async () => {
  const ws = [], told = [];
  const e = SF.create(() => { const w = fakeWorker({ maxHashMB: 256 }); ws.push(w); return w; }, { hashMB: 512, threaded: true, threads: 4, probeMs: 1000, onHashFail: (mb, to) => told.push([mb, to]) });
  const r = e.ready();
  await until(() => ws.length === 2 && ws[1].posted.includes('go depth 1'));
  ws[1].finish('e2e4');
  await r;
  assert.deepEqual(told, [[512, 64]]);
  assert.ok(ws[1].posted.indexOf('setoption name Hash value 64') < ws[1].posted.indexOf('go depth 1'));
  assert.ok(ws[1].posted.includes('setoption name Threads value 4'));
});

test('a smaller Hash asked for while a bigger one fails is kept, and hashMB() says what runs', async () => {
  const ws = [], told = [];
  const e = SF.create(() => { const w = fakeWorker({ maxHashMB: 256 }); ws.push(w); return w; }, { onHashFail: (mb, to) => told.push([mb, to]) });
  await e.ready();
  assert.equal(e.hashMB(), 64);
  e.setHash(512);
  const s = e.search({ moves: [], depth: 5, movetimeMs: 100 });
  e.setHash(32); // before Stockfish's failure for 512 arrives
  await until(() => ws.length === 2 && ws[1].posted.some((m) => m.startsWith('go depth 5')));
  assert.deepEqual(told, [[512, 32]]);
  assert.equal(e.failed(), null);
  assert.equal(e.hashMB(), 32);
  assert.ok(ws[1].posted.includes('setoption name Hash value 32'), ws[1].posted.join(' | '));
  ws[1].finish('e2e4');
  assert.equal((await s.promise).best, 'e2e4');
});

test('no memory even for the fallback hash fails the engine and says why', async () => {
  let failedWith = null;
  const e = SF.create(() => fakeWorker({ maxHashMB: 32 }), { onFail: (err) => { failedWith = err; } });
  await assert.rejects(e.ready(), /Not enough memory for Stockfish’s 64 MB hash table/);
  assert.match(String(failedWith && failedWith.message), /Not enough memory/);
  assert.equal(await e.search({ moves: [], depth: 5, movetimeMs: 100 }).promise, null);
});

test('the real engine: a Hash past its 2 GB cap falls back to 64 MB and searches', async () => {
  const told = [];
  const e = SF.create(() => nodeWorker(), { hashMB: 2048, onHashFail: (mb, to) => told.push([mb, to]) });
  try {
    await e.ready();
    const r = await e.search({ moves: ['e2e4'], depth: 8, movetimeMs: 2000 }).promise;
    assert.deepEqual(told, [[2048, 64]]);
    assert.ok(r && r.best, JSON.stringify(r));
  } finally { e.quit(); }
});
