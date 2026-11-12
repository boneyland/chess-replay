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
  const ref = fixture('lines_analysis.json'); // chess_game_analyzer.py --lines 3: has engine_lines
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

test('runAnalysis cancels the running search when its signal aborts', async () => {
  const ctl = new AbortController();
  let cancelled = 0, calls = 0;
  const eng = { search() {
    calls++;
    if (calls < 3) return { promise: Promise.resolve({ cp: 0, depth: 22, pv: [], best: null }), cancel() {} };
    // the third search hangs until it is cancelled, as SFEngine's does
    let done; const promise = new Promise((r) => { done = r; });
    setTimeout(() => ctl.abort(), 0);
    return { promise, cancel() { cancelled++; done(null); } };
  } };
  const out = await A.runAnalysis({ engine: eng, ...SCHOLAR, headers: {}, signal: ctl.signal, onProgress: () => {} });
  assert.equal(out, null);
  assert.equal(cancelled, 1);
  assert.equal(calls, 3);
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

test('runAnalysis with the real engine and three lines writes engine_lines like Python', { timeout: 120000 }, async () => {
  const engine = window.SFEngine.create(nodeWorker, {});
  try {
    await engine.ready();
    const settings = { ...A.ENGINE, depth: 10, time_limit: 2, lines: 3 };
    const out = await A.runAnalysis({ engine, ...SCHOLAR, headers: { White: 'Scholar', Black: 'Victim' }, signal: { aborted: false }, onProgress: () => {}, settings });
    const m = out.moves[0];
    assert.equal(m.search_lines, 3);
    assert.equal(m.engine_lines.length, 3);
    assert.deepEqual(m.engine_lines[0].line, m.best_line);
    assert.ok(m.engine_lines.every((l, i) => l.move === l.line[0] && l.depth > 0 && l.line.length <= 12 && (!i || l.eval <= m.engine_lines[0].eval)));
    assert.equal(out.engine.lines, 3);
    const dir = path.join(__dirname, 'out');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'lines_analysis.json'), JSON.stringify(out));
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
  assert.deepEqual(d.own, { name: A.ENGINE.name, depth: null, time_limit: 5, lines: 1, threads: 1, hash_mb: 64 });
  assert.equal(d.game.depth, null, 'no depth limit by default');
  const s = A.engineSettings({ sfDepth: 16, sfTime: 1, sfOwnDepth: 30, sfOwnTime: 20, sfGameHash: 512, sfHash: 256, sfLines: 5 });
  assert.deepEqual([s.game.depth, s.game.time_limit, s.game.hash_mb, s.game.name], [16, 1, 512, A.ENGINE.name]);
  assert.deepEqual(s.own, { name: A.ENGINE.name, depth: 30, time_limit: 20, lines: 5, threads: 1, hash_mb: 256 });
  assert.equal(s.game.lines, 1, 'a game\'s analysis always searches one line');
  for (const bad of [0, 6, 2.5, 'x', null]) assert.equal(A.engineSettings({ sfLines: bad }).own.lines, 1, String(bad));
  assert.equal(A.engineSettings({ sfLines: '3' }).own.lines, 3);
  const bad = A.engineSettings({ sfDepth: 15, sfTime: 61, sfOwnDepth: 'x', sfOwnTime: null, sfGameHash: 100, sfHash: 100 });
  assert.deepEqual([bad.game.depth, bad.game.time_limit, bad.game.hash_mb, bad.own.depth, bad.own.time_limit, bad.own.hash_mb], [null, 3, 64, null, 5, 64]);
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

test('asm.js and Full start from their own pace (paceStart), and paceFactor keeps within 0.25–4 times it', () => {
  const N = A.ENGINE_NAMES;
  assert.equal(A.paceStart(N.lite), 1); assert.equal(A.paceStart(N.asm), 8); assert.equal(A.paceStart(N.full), 1.3);
  const g = { depth: 22, time_limit: 30, lines: 1, name: N.asm };
  assert.equal(A.paceFactor(g, 1000), 32);
  assert.equal(A.paceFactor(g, 0.01), 2);
  assert.ok(Math.abs(A.paceFactor(g, 1.3 * 10) - 10) < 1e-9, 'a measured 10 kept');
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
  assert.deepEqual(A.deeperSearch(own, 3), { depth: 30, time_limit: 24 });
  assert.deepEqual(A.deeperSearch(own, 4), { depth: 30, time_limit: 48 });
  assert.deepEqual(A.deeperSearch(own, 5), { depth: 30, time_limit: 60 });
  assert.equal(A.canGoDeeper(own, 1), true);
  assert.equal(A.canGoDeeper(own, 4), true);
  assert.equal(A.canGoDeeper(own, 5), false);
  assert.equal(A.canGoDeeper({ depth: 30, time_limit: 3 }, 0), true); // the time can still grow
  assert.equal(A.canGoDeeper({ depth: 30, time_limit: 60 }, 0), false);
  // no depth limit: only the time doubles
  assert.deepEqual(A.deeperSearch({ depth: null, time_limit: 5 }, 1), { depth: null, time_limit: 10 });
  assert.equal(A.canGoDeeper({ depth: null, time_limit: 5 }, 3), true);
  assert.equal(A.canGoDeeper({ depth: null, time_limit: 5 }, 4), false); // 5, 10, 20, 40, 60 s
});

test('runAnalysis searches and records the settings it is given', async () => {
  const reqs = [], settings = A.engineSettings({ sfDepth: 16, sfTime: 1, sfGameHash: 32 }).game;
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

test('engineSettings: threads for the game analysis and the live searches apart, 1 where threads can\'t run', () => {
  const A = window.AnalysisCore, on = { on: true, cores: 8 };
  assert.equal(A.engineSettings({}, 'lite', on).game.threads, 4);
  assert.equal(A.engineSettings({}, 'lite', on).own.threads, 4);
  const both = A.engineSettings({ sfGameThreads: 6, sfThreads: 2 }, 'lite', on);
  assert.deepEqual([both.game.threads, both.own.threads], [6, 2]);
  assert.equal(A.engineSettings({ sfGameThreads: 9 }, 'lite', on).game.threads, 4);
  assert.equal(A.engineSettings({ sfThreads: 6 }, 'lite', { on: false, cores: 8 }).own.threads, 1);
  assert.equal(A.engineSettings({ sfGameThreads: 6 }).game.threads, 1);
  assert.equal(A.engineSettings({}).own.threads, 1);
});

test('hashChoices: above 128 MB only where not touch only and, where known, with 4 GB or more', () => {
  const all = [16, 32, 64, 128, 256, 512], small = [16, 32, 64, 128];
  assert.deepEqual(A.hashChoices(), all);
  assert.deepEqual(A.hashChoices({ touchOnly: false }), all); // Firefox and Safari don't say how much memory
  assert.deepEqual(A.hashChoices({ touchOnly: false, memoryGB: 8 }), all);
  assert.deepEqual(A.hashChoices({ touchOnly: false, memoryGB: 4 }), all);
  assert.deepEqual(A.hashChoices({ touchOnly: false, memoryGB: 2 }), small);
  assert.deepEqual(A.hashChoices({ touchOnly: true, memoryGB: 8 }), small); // a phone or tablet
  // a stored size this device isn't offered gets the default
  assert.equal(A.engineSettings({ sfGameHash: 512, sfHash: 512 }, 'lite', undefined, small).game.hash_mb, 64);
  assert.equal(A.engineSettings({ sfHash: 512 }, 'lite', undefined, small).own.hash_mb, 64);
  assert.equal(A.engineSettings({ sfGameHash: 128 }, 'lite', undefined, small).game.hash_mb, 128);
});

test('cloudEnough: 35 with no depth limit, the limit otherwise; asm.js at most 22', () => {
  const N = A.ENGINE_NAMES;
  assert.equal(A.cloudEnough(null, N.lite), 35);
  assert.equal(A.cloudEnough(null, N.full), 35);
  assert.equal(A.cloudEnough(24, N.lite), 24);
  assert.equal(A.cloudEnough(null, N.asm), 22);
  assert.equal(A.cloudEnough(18, N.asm), 18);
  assert.equal(A.cloudEnough(30, N.asm), 22);
  assert.equal(A.cloudEnough(null, undefined), 35); // no engine name: as lite
});

test('the mate-score encoding and win chances are ChessCore\'s, and AnalysisCore names the same ones', () => {
  const CC = window.ChessCore, C = window.AnalysisCore.C;
  assert.equal(CC.mateCp(3), 9970); assert.equal(CC.mateCp(-1), -9990); assert.equal(CC.mateCp(0), -10000);
  assert.equal(CC.mateIn(9970), 3); assert.equal(CC.mateIn(-9990), 1); assert.equal(CC.mateIn(10000), 0);
  assert.ok(CC.isMateCp(9000) && CC.isMateCp(-9990) && !CC.isMateCp(8999));
  assert.equal(C.MATE_SCORE_CP - C.MATE_BAND_CP, CC.MATE_MIN);
  assert.equal(C.WIN_CHANCES_K, CC.WIN_K);
  assert.deepEqual([C.WIN_DROP_INACCURACY, C.WIN_DROP_MISTAKE, C.WIN_DROP_BLUNDER], [CC.WIN_DROP.inaccuracy, CC.WIN_DROP.mistake, CC.WIN_DROP.blunder]);
  assert.equal(window.AnalysisCore.infoToScore('info depth 20 score mate 2 pv e2e4', 'w').cp, CC.mateCp(2));
});

// ---------- engine lines (chess-animator's engine_lines) ----------
test('runAnalysis with several lines writes engine_lines, search_lines and alternative_moves as chess_game_analyzer.py does', async () => {
  const reqs = [];
  const eng = { search(req) { reqs.push(req); const lines = [
    { k: 1, cp: 30, depth: 20, pv: ['e2e4', 'e7e5', 'g1f3'] }, { k: 2, cp: 10, depth: 19, pv: ['d2d4', 'd7d5'] }, { k: 3, cp: -60, depth: 18, pv: ['a2a3'] }];
    return { promise: Promise.resolve({ cp: 30, depth: 20, pv: lines[0].pv, lines }), cancel() {} }; } };
  const settings = { ...A.ENGINE, lines: 3 };
  const json = await A.runAnalysis({ engine: eng, ucis: ['d2d4'], sans: ['d4'], headers: {}, signal: { aborted: false }, onProgress: () => {}, settings });
  assert.ok(reqs.every((r) => r.lines === 3));
  const m = json.moves[0];
  assert.equal(m.search_lines, 3);
  assert.deepEqual(m.engine_lines, [
    { move: 'e4', eval: 30, depth: 20, line: ['e4', 'e5', 'Nf3'] }, { move: 'd4', eval: 10, depth: 19, line: ['d4', 'd5'] }, { move: 'a3', eval: -60, depth: 18, line: ['a3'] }]);
  // the move played (d4) is no alternative to itself; a3 is 90 cp off, past the 50 cp threshold
  assert.deepEqual(m.alternative_moves, []);
  assert.deepEqual(m.best_line, ['e4', 'e5', 'Nf3']);
});

test('runAnalysis with one line writes the one engine line', async () => {
  const json = await A.runAnalysis({ engine: { search: () => ({ promise: Promise.resolve({ cp: 5, depth: 12, pv: ['e2e4', 'e7e5'] }), cancel() {} }) }, ucis: ['e2e4'], sans: ['e4'], headers: {}, signal: { aborted: false }, onProgress: () => {} });
  assert.deepEqual(json.moves[0].engine_lines, [{ move: 'e4', eval: 5, depth: 12, line: ['e4', 'e5'] }]);
  assert.equal(json.moves[0].search_lines, 1);
});

test('alternativesOf keeps the playable lines other than the move played', () => {
  const ls = [{ move: 'e4', eval: 30 }, { move: 'd4', eval: 10 }, { move: 'c4', eval: -10 }, { move: 'Nf3', eval: 25 }];
  assert.deepEqual(A.alternativesOf(ls, 'd4', 30), [['c4', -10], ['Nf3', 25]]);
});

test('engineSettings: the game analysis lines setting', () => {
  assert.equal(A.engineSettings({ sfGameLines: 3 }).game.lines, 3);
  assert.equal(A.engineSettings({ sfGameLines: 9 }).game.lines, 1);
  assert.equal(A.engineSettings({}).game.lines, 1);
});

// the opening book and its names are standard chess only (a 960 start, never 518, which is standard)
test('runAnalysis consults no opening book from a Chess960 start, and does from position 518', async () => {
  const CC = window.ChessCore, real = window.Openings, asked = [];
  window.Openings = { book: () => ({ identify: (u, f) => { asked.push(f); return { eco: 'C20', name: 'King\'s Pawn Game' }; } }) };
  try {
    const f960 = CC.chess960Fen(0), f518 = CC.chess960Fen(518);
    assert.ok(CC.fenIs960(f960) && !CC.fenIs960(f518));
    const mk = (startFen, ucis, sans) => A.runAnalysis({ engine: fakeEngine(), ucis, sans, startFen, headers: {}, signal: { aborted: false }, onProgress: () => {} });
    const j960 = await mk(f960, ['b2b3'], ['b3']);
    assert.equal(asked.length, 0);
    assert.equal(j960.opening_name, '');
    const j518 = await mk(f518, ['e2e4'], ['e4']);
    assert.deepEqual(asked, [f518]);
    assert.equal(j518.opening_name, 'King\'s Pawn Game');
  } finally { window.Openings = real; }
});
