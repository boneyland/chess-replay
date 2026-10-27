const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit, fixture } = require('./load.cjs');
loadUnit('chess-core.js');
loadUnit('analysis-core.js');
const A = window.AnalysisCore;
const expected = fixture('rating-expected.json');

for (const [name, g] of Object.entries(expected)) {
  test(`rateMove reproduces Python on every move of ${name}`, () => {
    g.moves.forEach((m, k) => {
      const got = A.rateMove({ bestEval: m.best_eval, currentEval: m.current_eval, isWhite: m.is_white, playedIsBest: m.played_is_best, isCheckmate: m.is_checkmate });
      assert.deepEqual(got, { evalLoss: m.eval_loss, classification: m.classification, mateAdvice: m.mate_advice }, `ply ${k + 1} ${m.move_san}`);
    });
  });

  test(`playerStats reproduces accuracy for ${name}`, () => {
    const side = (white) => g.moves.filter((m) => m.is_white === white).map((m) => ({ eval_loss: m.eval_loss, classification: m.classification }));
    assert.ok(Math.abs(A.playerStats(side(true)).accuracy - g.white_accuracy) < 1e-9);
    assert.ok(Math.abs(A.playerStats(side(false)).accuracy - g.black_accuracy) < 1e-9);
  });

  test(`mateLine reproduces Python for ${name}`, () => {
    g.moves.filter((m) => m.mate_line).forEach((m) => {
      assert.equal(A.mateLine(m.best_eval, m.best_line), m.mate_line, m.move_san);
    });
  });
}

test('infoToScore converts to White POV and encodes mates', () => {
  assert.deepEqual(A.infoToScore('info depth 20 seldepth 30 multipv 1 score cp 35 nodes 1 nps 1 pv e2e4 e7e5', 'b'), { cp: -35, depth: 20, pv: ['e2e4', 'e7e5'], nodes: 1, timeMs: null, multipv: 1 });
  assert.equal(A.infoToScore('info depth 20 multipv 3 score cp 5 pv d2d4', 'w').multipv, 3);
  const timed = A.infoToScore('info depth 22 seldepth 31 multipv 1 score cp 12 nodes 1520334 nps 512000 hashfull 210 time 2969 pv d2d4', 'w');
  assert.equal(timed.nodes, 1520334);
  assert.equal(timed.timeMs, 2969);
  assert.equal(A.infoToScore('info depth 9 score mate 3 nodes 5 pv d1h5 g7g6 h5f7', 'w').cp, 9970);
  assert.equal(A.infoToScore('info depth 9 score mate -2 nodes 5 pv a2a3', 'w').cp, -9980);
  assert.equal(A.infoToScore('info depth 0 score mate 0', 'b').cp, 10000);
  assert.equal(A.infoToScore('info depth 0 score mate 0', 'w').cp, -10000);
  assert.deepEqual(A.infoToScore('info depth 0 score mate 0', 'w').pv, []);
  assert.equal(A.infoToScore('info depth 18 seldepth 20 score cp 12 lowerbound nodes 1 pv e2e4', 'w'), null);
  assert.equal(A.infoToScore('info string NNUE evaluation using nn.nnue', 'w'), null);
});

test('buildAnalysisJson has every key the --analyze JSON has', () => {
  const ref = fixture('byrne-fischer_analysis.json');
  const out = A.buildAnalysisJson({
    headers: { White: 'W', Black: 'B' }, opening: null,
    engine: { name: 'Stockfish 19 lite (browser)', depth: 22, time_limit: 3, lines: 1, threads: 1, hash_mb: 64 },
    moves: [{ ply: 1, move_san: 'e4', move_uci: 'e2e4', is_white_move: true, eval_before: 20, eval_after: 30, best_move_san: 'e4', best_move_uci: 'e2e4', best_eval: 20, eval_loss: 0, classification: 'best', is_capture: false, is_check: false, fen_after: '', pv_line: [], mate_advice: '', mate_line: '', search_depth: 22, search_depth_after: 22, best_line: ['e4'] }],
  });
  assert.deepEqual(Object.keys(out).sort(), Object.keys(ref).sort());
  assert.deepEqual(Object.keys(out.moves[0]).sort(), Object.keys(ref.moves[0]).sort());
});

// ---------- runAnalysis ----------
const fs = require('fs');
const path = require('path');
const { nodeWorker } = require('./node-worker.cjs');
const { openingsTsv } = require('../openings-data.cjs');
loadUnit('sf-engine.js');
window.OPENINGS_TSV = openingsTsv();
loadUnit('openings-core.js');

const SCHOLAR = { ucis: ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'], sans: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'] };
const fakeEngine = (onSearch) => ({
  calls: 0,
  search(req) { this.calls++; if (onSearch) onSearch(req, this.calls); return { promise: Promise.resolve({ cp: 0, depth: 22, pv: [], best: null }), cancel() {} }; },
});

test('runAnalysis reports progress from (0, N) to (N, N)', async () => {
  const seen = [];
  await A.runAnalysis({ engine: fakeEngine(), ...SCHOLAR, headers: {}, signal: { aborted: false }, onProgress: (d, n) => seen.push([d, n]) });
  assert.deepEqual(seen[0], [0, 7]);
  assert.deepEqual(seen[seen.length - 1], [7, 7]);
});

test('runAnalysis from a start FEN rates Black\'s first move as Black\'s', async () => {
  const startFen = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1', reqs = [];
  const json = await A.runAnalysis({ engine: fakeEngine((r) => reqs.push(r)), ucis: ['e8d7'], sans: ['Kd7'], startFen, headers: {}, signal: { aborted: false }, onProgress: () => {} });
  assert.equal(json.moves[0].is_white_move, false);
  assert.equal(json.moves[0].move_san, 'Kd7');
  assert.equal(json.start_fen, startFen);
  assert.ok(reqs.every((r) => r.fen === startFen));
});

test('runAnalysis from a start FEN writes absolute plies, as Python does', async () => {
  const startFen = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 40';
  const json = await A.runAnalysis({ engine: fakeEngine(), ucis: ['e8d7'], sans: ['Kd7'], startFen, headers: {}, signal: { aborted: false }, onProgress: () => {} });
  assert.equal(json.moves[0].ply, 80);
});

test('a standard game\'s plies count from 1', async () => {
  const json = await A.runAnalysis({ engine: fakeEngine(), ...SCHOLAR, headers: {}, signal: { aborted: false }, onProgress: () => {} });
  assert.deepEqual(json.moves.map((m) => m.ply), [1, 2, 3, 4, 5, 6, 7]);
});

test('a standard game\'s analysis JSON has no start_fen', async () => {
  const json = await A.runAnalysis({ engine: fakeEngine(), ...SCHOLAR, startFen: window.ChessCore.START_FEN, headers: {}, signal: { aborted: false }, onProgress: () => {} });
  assert.equal('start_fen' in json, false);
});

test('runAnalysis stops when aborted and returns null', async () => {
  const signal = { aborted: false };
  const eng = fakeEngine((req, n) => { if (n === 2) signal.aborted = true; });
  const out = await A.runAnalysis({ engine: eng, ...SCHOLAR, headers: {}, signal, onProgress: () => {} });
  assert.equal(out, null);
  assert.equal(eng.calls, 2);
});

test('runAnalysis searches each position for 3 s, no depth limit, as game priority', async () => {
  const reqs = [];
  await A.runAnalysis({ engine: fakeEngine((r) => reqs.push(r)), ...SCHOLAR, headers: {}, signal: { aborted: false }, onProgress: () => {} });
  assert.equal(reqs.length, 8);
  assert.deepEqual(reqs.map((r) => [r.depth, r.movetimeMs, r.priority]), Array(8).fill([null, 3000, 'game']));
  assert.deepEqual(reqs[3].moves, SCHOLAR.ucis.slice(0, 3));
});

test('runAnalysis searches with the threads it started with', async () => {
  const reqs = [];
  await A.runAnalysis({ engine: fakeEngine((r) => reqs.push(r)), ...SCHOLAR, headers: {}, signal: { aborted: false }, onProgress: () => {}, settings: { ...A.ENGINE, threads: 4 } });
  assert.deepEqual([...new Set(reqs.map((r) => r.threads))], [4]);
});

test('runAnalysis with the real engine rates a mating game like Python', { timeout: 120000 }, async () => {
  const engine = window.SFEngine.create(nodeWorker, {});
  try {
    await engine.ready();
    const headers = { White: 'Scholar', Black: 'Victim', Result: '1-0' };
    const out = await A.runAnalysis({ engine, ...SCHOLAR, headers, signal: { aborted: false }, onProgress: () => {} });
    assert.equal(out.moves.length, 7);
    const last = out.moves[6];
    assert.equal(last.eval_after, 10000);
    assert.notEqual(last.classification, 'blunder');
    assert.equal(last.move_san, 'Qxf7#');
    assert.equal(out.opening_name, "King's Pawn Game: Wayward Queen Attack"); // chess_openings.py's identify() for this line
    assert.equal(out.opening_eco, 'C20');
    assert.deepEqual(out.engine, { name: 'Stockfish 19 lite (browser)', depth: null, time_limit: 3, lines: 1, threads: 1, hash_mb: 64 });
    assert.ok(out.moves.every((m) => m.search_depth > 0));
    // the position after Qxf7# is mate: Stockfish reports no search for it
    assert.ok(out.moves.slice(0, -1).every((m) => m.search_time_after_ms > 0 && m.search_nodes_after > 0), 'actual search stats kept for each position after a move');
    assert.ok(out.moves.every((m) => m.search_maxdepth_after >= m.search_depth_after), 'deepest depth reached is kept too');
    const dir = path.join(__dirname, 'out');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'scholar_analysis.json'), JSON.stringify(out));
  } finally { engine.quit(); }
});

test('runAnalysis takes the best move from the line it reports, like Python (pv[0])', async () => {
  // a search cut short can end on a bestmove that differs from its last complete line
  const eng = { search: () => ({ promise: Promise.resolve({ cp: 20, depth: 22, pv: ['d2d4', 'd7d5'], best: 'e2e4', nodes: 1, timeMs: 1 }), cancel() {} }) };
  const out = await A.runAnalysis({ engine: eng, ucis: ['e2e4'], sans: ['e4'], headers: {}, signal: { aborted: false }, onProgress: () => {} });
  assert.equal(out.moves[0].best_move_uci, 'd2d4');
  assert.equal(out.moves[0].best_move_san, 'd4');
  assert.equal(out.moves[0].best_line[0], 'd4');
  assert.equal(A.bestOf({ pv: [], best: 'e2e4' }), 'e2e4');
  assert.equal(A.bestOf({ pv: [], best: null }), null);
});

test('infoStats reads depth, nodes and time from any info line, bound lines included', () => {
  assert.deepEqual(A.infoStats('info depth 23 seldepth 30 multipv 1 score cp 20 lowerbound nodes 1600000 nps 533000 hashfull 300 time 3001 pv e2e4'), { depth: 23, nodes: 1600000, timeMs: 3001 });
  assert.deepEqual(A.infoStats('info depth 5 currmove e2e4 currmovenumber 1'), { depth: 5, nodes: null, timeMs: null });
  assert.equal(A.infoStats('info string NNUE evaluation'), null);
});

test('runAnalysis resumes from earlier searches and reports each search so far', async () => {
  const reqs = [], saved = [], seen = [];
  const earlier = [0, 1, 2].map((i) => ({ cp: 10 * i, depth: 22, pv: [], best: null }));
  const out = await A.runAnalysis({ engine: fakeEngine((r) => reqs.push(r)), ...SCHOLAR, headers: {}, signal: { aborted: false }, earlier,
    onSearched: (R) => saved.push(R.length), onProgress: (d, n) => seen.push([d, n]) });
  assert.equal(reqs.length, 5); // positions 3..7
  assert.deepEqual(reqs[0].moves, SCHOLAR.ucis.slice(0, 3));
  assert.deepEqual(saved, [4, 5, 6, 7, 8]);
  assert.deepEqual(seen[0], [2, 7]);
  assert.equal(out.moves[0].eval_before, 0);
  assert.equal(out.moves[1].eval_after, 20); // from the earlier searches
});

test('engineSettings: the defaults, the viewer’s values in range, and the defaults again for anything else', () => {
  const d = A.engineSettings({});
  assert.deepEqual(d.game, A.ENGINE);
  assert.deepEqual(d.own, { name: A.ENGINE.name, depth: null, time_limit: 5, lines: 1, threads: 1 });
  assert.equal(d.game.depth, null, 'no depth limit by default');
  const s = A.engineSettings({ sfDepth: 16, sfTime: 1, sfOwnDepth: 30, sfOwnTime: 20, sfHash: 256, sfLines: 5 });
  assert.deepEqual([s.game.depth, s.game.time_limit, s.game.hash_mb, s.game.name], [16, 1, 256, A.ENGINE.name]);
  assert.deepEqual(s.own, { name: A.ENGINE.name, depth: 30, time_limit: 20, lines: 5, threads: 1 });
  assert.equal(s.game.lines, 1, 'a game\'s analysis always searches one line');
  for (const bad of [0, 6, 2.5, 'x', null]) assert.equal(A.engineSettings({ sfLines: bad }).own.lines, 1, String(bad));
  assert.equal(A.engineSettings({ sfLines: '3' }).own.lines, 3);
  const bad = A.engineSettings({ sfDepth: 15, sfTime: 21, sfOwnDepth: 'x', sfOwnTime: null, sfHash: 100 });
  assert.deepEqual([bad.game.depth, bad.game.time_limit, bad.game.hash_mb, bad.own.depth, bad.own.time_limit], [null, 3, 64, null, 5]);
  // a viewer who picked a depth keeps it; one who moved back to No limit stores null
  assert.deepEqual([A.engineSettings({ sfOwnDepth: 24 }).own.depth, A.engineSettings({ sfOwnDepth: null }).own.depth], [24, null]);
  assert.deepEqual([A.DEPTHS[0], A.DEPTHS[A.DEPTHS.length - 2], A.DEPTHS[A.DEPTHS.length - 1], A.DEPTHS.length], [16, 30, null, 16]);
  assert.equal(A.engineSettings({ sfTime: 0.5 }).game.time_limit, 3); // below the 1 s minimum
  assert.equal(A.engineSettings({ sfTime: 1.3 }).game.time_limit, 1); // snapped to the slider's whole seconds
  assert.equal(A.engineSettings({ sfTime: 12.8 }).game.time_limit, 12); // above 10, every 2 s
  assert.equal(A.engineSettings({ sfTime: 13.2 }).game.time_limit, 14);
});

test('engineSettings: the engine that runs names the game and own searches, so their results never mix', () => {
  const full = A.engineSettings({ sfDepth: 20 }, 'full');
  assert.equal(full.game.name, 'Stockfish 19 (browser)');
  assert.equal(full.own.name, 'Stockfish 19 (browser)');
  assert.equal(full.game.depth, 20);
  assert.equal(A.engineSettings({}, 'lite').game.name, 'Stockfish 19 lite (browser)');
  assert.equal(A.engineSettings({}, 'nonsense').game.name, A.ENGINE.name);
});

const MEASURED = { depth: 22, time_limit: 3 }; // what secondsPerPosition's 1.3 s was measured at

test('secondsPerPosition: 1.3 s at depth 22 / 3 s, faster when shallower, near the limit at depth 24, never past it, all of it with no depth limit', () => {
  assert.equal(A.secondsPerPosition(MEASURED), 1.3);
  assert.ok(A.secondsPerPosition({ depth: 24, time_limit: 3 }) > 2.5 && A.secondsPerPosition({ depth: 24, time_limit: 3 }) < 3);
  assert.equal(A.secondsPerPosition(A.ENGINE), 3);
  assert.equal(A.secondsPerPosition(A.ENGINE, 0.5), 3);
  assert.ok(A.secondsPerPosition({ depth: 16, time_limit: 3 }) < 0.5);
  assert.equal(A.secondsPerPosition({ depth: 30, time_limit: 4 }), 4);
});

test('secondsPerPosition scales by a device factor; paceFactor measures it, within 0.25–4', () => {
  assert.equal(A.secondsPerPosition(MEASURED, 2), 2.6);
  assert.equal(A.secondsPerPosition(MEASURED, 4), 3); // still capped by the time limit
  assert.equal(A.paceFactor(MEASURED, 0.65), 0.5);
  assert.equal(A.paceFactor(MEASURED, 100), 4);
  assert.equal(A.paceFactor(MEASURED, 0.01), 0.25);
});

test('blendPace starts at the estimate and moves to the measured pace', () => {
  assert.equal(A.blendPace(1.3, 0, 0), 1.3);
  assert.equal(A.blendPace(1, 3 * 3, 3), 2); // half way after as many positions as the estimate's weight
  assert.ok(Math.abs(A.blendPace(1, 300 * 3, 300) - 3) < 0.03);
});

test('deeperSearch: +4 depth and twice the time per press, up to the sliders\' caps', () => {
  const own = { depth: 24, time_limit: 3 };
  assert.deepEqual(A.deeperSearch(own, 0), own);
  assert.deepEqual(A.deeperSearch(own, 1), { depth: 28, time_limit: 6 });
  assert.deepEqual(A.deeperSearch(own, 2), { depth: 30, time_limit: 12 });
  assert.deepEqual(A.deeperSearch(own, 3), { depth: 30, time_limit: 20 });
  assert.equal(A.canGoDeeper(own, 1), true);
  assert.equal(A.canGoDeeper(own, 2), true);
  assert.equal(A.canGoDeeper(own, 3), false);
  assert.equal(A.canGoDeeper({ depth: 30, time_limit: 3 }, 0), true); // the time can still grow
  assert.equal(A.canGoDeeper({ depth: 30, time_limit: 20 }, 0), false);
  // no depth limit: only the time doubles
  assert.deepEqual(A.deeperSearch({ depth: null, time_limit: 5 }, 1), { depth: null, time_limit: 10 });
  assert.equal(A.canGoDeeper({ depth: null, time_limit: 5 }, 2), false);
});

test('runAnalysis searches and records the settings it is given', async () => {
  const reqs = [], settings = A.engineSettings({ sfDepth: 16, sfTime: 1, sfHash: 32 }).game;
  const out = await A.runAnalysis({ engine: fakeEngine((r) => reqs.push(r)), ...SCHOLAR, headers: {}, signal: { aborted: false }, onProgress: () => {}, settings });
  assert.deepEqual(reqs.map((r) => [r.depth, r.movetimeMs]), Array(8).fill([16, 1000]));
  assert.deepEqual(out.engine, settings);
  const M = window.ChessCore.buildGame({ pgn: '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0', analysis: out });
  assert.match(M.engine, /depth 16, max 1s per position/);
});

test('threadChoices: 1 to one less than the cores, at most 8, at least 1', () => {
  const A = window.AnalysisCore;
  assert.deepEqual(A.threadChoices(8), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(A.threadChoices(16), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(A.threadChoices(2), [1]);
  assert.deepEqual(A.threadChoices(1), [1]);
  assert.deepEqual(A.threadChoices(undefined), [1]);
});

test('defaultThreads: half the cores, at most 4, at least 1', () => {
  const A = window.AnalysisCore;
  assert.deepEqual([8, 12, 4, 2, 1].map(A.defaultThreads), [4, 4, 2, 1, 1]);
});

test('engineSettings carries threads into game and own searches, 1 where threads can\'t run', () => {
  const A = window.AnalysisCore, on = { on: true, cores: 8 };
  assert.equal(A.engineSettings({}, 'lite', on).game.threads, 4);
  assert.equal(A.engineSettings({}, 'lite', on).own.threads, 4);
  assert.equal(A.engineSettings({ sfThreads: 6 }, 'lite', on).game.threads, 6);
  assert.equal(A.engineSettings({ sfThreads: 9 }, 'lite', on).game.threads, 4);
  assert.equal(A.engineSettings({ sfThreads: 6 }, 'lite', { on: false, cores: 8 }).own.threads, 1);
  assert.equal(A.engineSettings({ sfThreads: 6 }).game.threads, 1);
  assert.equal(A.engineSettings({}).own.threads, 1);
});
