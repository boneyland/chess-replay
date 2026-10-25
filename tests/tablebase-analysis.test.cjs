// The endgame tablebase in a game's analysis (runAnalysis with Lichess's client): positions of 7 pieces or fewer take
// its certain answer instead of a search, and moves between them are rated by the outcome
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js');
loadUnit('analysis-core.js');
loadUnit('lichess-core.js');
const A = window.AnalysisCore, LC = window.LichessCore, CC = window.ChessCore;

// KBN v K, White to move and winning: 1. Ke3 Kd5 2. Bd3 Kc5
const START = '8/8/8/4k3/8/8/3KB3/7N w - - 0 1';
const GAME = { ucis: ['d2e3', 'e5d5', 'e2d3', 'd5c5'], sans: ['Ke3', 'Kd5', 'Bd3', 'Kc5'], startFen: START };
const PGN = `[SetUp "1"]\n[FEN "${START}"]\n\n1. Ke3 Kd5 2. Bd3 Kc5 *`;
const FENS = A.positionFens(START, GAME.ucis);

// an answer as the API gives it (the side to move's category; its first move the best)
const answer = (category, dtz, dtm, first) => LC.parseTablebase({ category, dtz, dtm, checkmate: false, stalemate: false, insufficient_material: false, moves: first ? [{ uci: first, san: '?', category: LC.flip(category), dtz: dtz && -dtz, dtm: dtm && -dtm }] : [] });
// the answers for positions 0..4 (null: the request fails); records what was asked
function fakeTb(answers) {
  const asked = [];
  return { asked, tablebase: async (fen) => { const k = FENS.indexOf(fen); asked.push(k); return answers[k] === undefined ? null : answers[k]; } };
}
const fakeEngine = () => ({
  calls: [],
  search(req) { this.calls.push(req.moves.length); return { promise: Promise.resolve({ cp: 50, depth: 20, pv: [], best: null }), cancel() {} }; },
});
const run = (engine, tablebase, extra = {}) => A.runAnalysis({ engine, ...GAME, headers: {}, signal: { aborted: false }, onProgress: () => {}, tablebase, tbGapMs: 0, ...extra });

// all certain: White wins throughout until 2. Bd3, which (in this made-up table) only draws
const WINNING = [answer('win', 55, 55, 'd2e3'), answer('loss', -54, -54, 'e5d6'), answer('win', 53, 53, 'e2d3'), answer('draw', 0, 0, 'd5c4'), answer('draw', 0, 0, 'd3c2')];

test('positionFens gives each position its full FEN, the fifty-move count counted on', () => {
  assert.equal(FENS.length, 5);
  assert.equal(FENS[0], START);
  assert.equal(FENS[1], '8/8/8/4k3/8/4K3/4B3/7N b - - 1 1');
  assert.equal(FENS[4], '8/8/8/2k5/8/3BK3/8/7N w - - 4 3');
});

test('tablebase positions skip the engine: their evals, best moves and fields come from the tablebase', async () => {
  const eng = fakeEngine(), tb = fakeTb(WINNING);
  const out = await run(eng, tb);
  assert.deepEqual(eng.calls, [], 'no search');
  assert.deepEqual(tb.asked, [0, 1, 2, 3, 4]);
  const [m1, m2, m3] = out.moves;
  assert.equal(m1.eval_before, 10000 - 10 * 28); // a mate in 28 moves from DTM 55
  assert.equal(m1.eval_after, 10000 - 10 * 27); // Black to move, mated in 27
  assert.equal(m1.best_move_uci, 'd2e3');
  assert.deepEqual(m1.best_line, ['Ke3'], 'the best move alone');
  assert.equal(m2.best_move_uci, 'e5d6');
  assert.deepEqual(m2.best_line, ['Kd6']);
  assert.deepEqual([m1.search_depth, m1.search_depth_after], [0, 0]);
  assert.deepEqual(m1.tb_before, { category: 'win', dtz: 55, dtm: 55 });
  assert.deepEqual(m1.tb_after, { category: 'loss', dtz: -54, dtm: -54 });
  assert.equal(m3.eval_after, 0);
  assert.equal(out.engine.tablebase, true);
  const dir = path.join(__dirname, 'out');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tb_analysis.json'), JSON.stringify(out));
});

test('rated by outcome: a win given up for a draw is a blunder, the same outcome loses nothing, however slow', async () => {
  const out = await run(fakeEngine(), fakeTb(WINNING));
  // Kd5 isn't the table's first move, but Black loses either way; Kc5 keeps the draw
  assert.deepEqual(out.moves.map((m) => m.classification), ['best', 'best', 'blunder', 'best']);
  assert.deepEqual(out.moves.map((m) => m.eval_loss), [0, 0, A.C.MAX_EVAL_LOSS_FOR_ACCURACY, 0]);
  assert.ok(out.moves.every((m) => !m.mate_advice), 'no mate rules between tablebase positions');
});

test('rateByOutcome: win → draw, draw → loss and win → loss are blunders; a cursed win is a draw', () => {
  const r = (before, after) => A.rateByOutcome({ bestEval: 0, currentEval: 0, isWhite: true, before: { category: before }, after: { category: after } }).classification;
  // after: the category for the opponent, who moves next
  assert.equal(r('win', 'loss'), 'best');
  assert.equal(r('win', 'draw'), 'blunder');
  assert.equal(r('win', 'blessed-loss'), 'blunder', 'a cursed win for the mover is a draw');
  assert.equal(r('cursed-win', 'draw'), 'best');
  assert.equal(r('draw', 'win'), 'blunder');
  assert.equal(r('win', 'win'), 'blunder');
  assert.equal(r('draw', 'draw'), 'best');
  assert.equal(r('loss', 'win'), 'best');
  assert.equal(r('blessed-loss', 'win'), 'blunder', 'a saved loss lost after all');
  assert.equal(A.rateByOutcome({ bestEval: 0, currentEval: 0, isWhite: true, before: { category: 'maybe-win' }, after: { category: 'loss' } }), null, 'uncertain: not rated by outcome');
  const loss = A.rateByOutcome({ bestEval: -9700, currentEval: 0, isWhite: false, before: { category: 'win' }, after: { category: 'draw' } });
  assert.deepEqual(loss, { evalLoss: A.C.MAX_EVAL_LOSS_FOR_ACCURACY, classification: 'blunder', mateAdvice: '' });
});

test('a cursed win given up the fifty-move rule is no loss; a real win given up for one is a blunder', async () => {
  const cursed = [answer('win', 55, 55, 'd2e3'), answer('loss', -54, -54, 'e5d6'), answer('win', 53, 53, 'e2d3'), answer('blessed-loss', -120, null, 'd5c4'), answer('cursed-win', 119, null, 'd3c2')];
  const out = await run(fakeEngine(), fakeTb(cursed));
  assert.equal(out.moves[2].classification, 'blunder');
  assert.equal(out.moves[2].eval_after, 0);
  assert.equal(out.moves[3].classification, 'best', 'blessed loss to cursed win: a draw kept');
});

test('an uncertain answer is searched; a failed request is searched and the run asks no more', async () => {
  const eng = fakeEngine();
  const tb = fakeTb([WINNING[0], WINNING[1], answer('maybe-win', 90, null, 'e2d3'), null, WINNING[4]]);
  const out = await run(eng, tb);
  assert.deepEqual(eng.calls, [2, 3, 4]);
  assert.deepEqual(tb.asked, [0, 1, 2, 3], 'nothing asked after the failure');
  assert.equal(out.moves[2].tb_before, undefined);
  assert.equal(out.moves[1].tb_after, undefined);
  assert.equal(out.moves[1].search_depth_after, 20);
  // Ke3 into a searched position: the usual eval rules
  assert.ok(out.moves[0].tb_before && out.moves[0].tb_after);
});

test('a win with no distance to mate next to a searched position is searched too: the move rated on both searches, no mate in 1', async () => {
  // 6 and 7 pieces have no DTM: White wins at 0, 2 and 4, Black loses at 3; 1 is uncertain, so searched
  const tb = fakeTb([answer('win', 55, null, 'e2d3'), answer('maybe-loss', -54, null, 'e5d6'), answer('win', 53, null, 'e2d3'), answer('loss', -52, null, 'd5c6'), answer('win', 51, null, 'e3d4')]);
  const cps = { 0: 700, 1: 600, 2: 650 }, eng = fakeEngine();
  eng.search = function (req) { this.calls.push(req.moves.length); return { promise: Promise.resolve({ cp: cps[req.moves.length], depth: 20, pv: [], best: null }), cancel() {} }; };
  const info = [];
  const out = await run(eng, tb, { onSearched: (R, x) => info.push(x.searches) });
  // 1 as uncertain, then 0 beside it; 2 beside 1; 3 and 4 between tablebase positions
  assert.deepEqual(eng.calls, [1, 0, 2]);
  assert.deepEqual(info, [0, 2, 1, 0, 0], 'the searches each step made, for the pace');
  const [m1, m2, m3] = out.moves;
  // the evals shown stay the tablebase's
  assert.deepEqual([m1.eval_before, m2.eval_after], [9990, 9990]);
  // Ke3 keeps the win (700 → 600 searched) and Kd5 is a capture-like step into it (600 → 650): no blunder, no mate talk
  for (const m of [m1, m2]) {
    assert.notEqual(m.classification, 'blunder', m.move_san);
    assert.equal(m.mate_advice, '', m.move_san);
    assert.equal(m.mate_line, '', m.move_san);
  }
  assert.equal(m1.eval_loss, 100);
  assert.equal(m2.eval_loss, 50);
  assert.equal(m3.classification, 'best', 'between tablebase positions: the outcome');
});

test('the setting turned off during a run: nothing more is asked, the rest is searched', async () => {
  const eng = fakeEngine(), tb = fakeTb(WINNING);
  let on = true;
  const ask = tb.tablebase;
  tb.tablebase = async (fen) => { const r = await ask(fen); on = false; return r; };
  await run(eng, tb, { tablebaseOn: () => on });
  assert.deepEqual(tb.asked, [0]);
  assert.deepEqual(eng.calls, [1, 2, 3, 4]);
  // off while the run waits for its turn to ask: not asked either
  const tb2 = fakeTb(WINNING);
  let on2 = true;
  await run(fakeEngine(), tb2, { tablebaseOn: () => on2, tbGapMs: 4000, now: () => 0, sleep: async () => { on2 = false; } });
  assert.deepEqual(tb2.asked, [0]);
});

test('onSearched: the time spent on the tablebase is reported apart from the searches', async () => {
  let t = 0;
  const tb = fakeTb([WINNING[0], answer('maybe-loss', -54, -54, 'e5d6'), WINNING[2], WINNING[3], WINNING[4]]);
  const ask = tb.tablebase;
  tb.tablebase = async (fen) => { t += 300; return ask(fen); };
  const info = [];
  await run(fakeEngine(), tb, { tbGapMs: 4000, now: () => t, sleep: async (ms) => { t += ms; }, onSearched: (R, x) => info.push(x) });
  // position 1: a 4 s wait and a 300 ms request, then searched
  assert.deepEqual(info.map((x) => x.searches), [0, 1, 0, 0, 0]);
  // each later request 4 s after the one before: 3.7 s of waiting, then the request
  assert.deepEqual(info.map((x) => x.tbMs), [300, 4000, 4000, 4000, 4000]);
});

test('a 429 back-off: the positions during it are searched, then the tablebase is asked again', async () => {
  const eng = fakeEngine(), tb = fakeTb([...WINNING]);
  let off = false;
  tb.backedOff = (name) => name === 'tablebase' && off;
  // position 2's request is answered 429; the back-off ends while position 3 is searched
  const ask = tb.tablebase;
  tb.tablebase = async (fen) => { if (FENS.indexOf(fen) === 2) { tb.asked.push(2); off = true; return null; } return ask(fen); };
  const search = eng.search.bind(eng);
  eng.search = (req) => { if (req.moves.length === 3) off = false; return search(req); };
  const out = await run(eng, tb);
  assert.deepEqual(eng.calls, [2, 3]);
  assert.deepEqual(tb.asked, [0, 1, 2, 4]);
  assert.ok(out.moves[3].tb_after, 'asked again after the back-off');
});

test('the run\'s requests go tbGapMs apart; an answer the client already has doesn\'t wait', async () => {
  let t = 0;
  const waits = [], at = [];
  const tb = fakeTb(WINNING);
  const ask = tb.tablebase;
  tb.tablebase = async (fen) => { at.push(t); return ask(fen); };
  tb.tablebaseCached = (fen) => (FENS.indexOf(fen) === 0 ? WINNING[0] : undefined);
  await run(fakeEngine(), tb, { tbGapMs: 4000, now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  // position 0's answer is cached: position 1's is the first request, every later one 4 s after the one before
  assert.deepEqual(at, [0, 0, 4000, 8000, 12000]);
  assert.deepEqual(waits, Array(3).fill(4000));
  assert.equal(A.TB_GAP_MS, 4000);
});

test('the setting off (no client) sends nothing; more than 7 pieces is never asked', async () => {
  const eng = fakeEngine();
  const out = await run(eng, null);
  assert.deepEqual(eng.calls, [0, 1, 2, 3, 4]);
  assert.ok(out.moves.every((m) => !m.tb_before && !m.tb_after));
  assert.equal(out.engine.tablebase, undefined);
  const tb = fakeTb([]);
  const big = await A.runAnalysis({ engine: fakeEngine(), ucis: ['e2e4', 'e7e5'], sans: ['e4', 'e5'], headers: {}, signal: { aborted: false }, onProgress: () => {}, tablebase: tb });
  assert.deepEqual(tb.asked, []);
  assert.equal(big.engine.tablebase, undefined, 'recorded only when the tablebase answered');
});

test('a stopped run resumes from its tablebase answers without asking again', async () => {
  let kept = null;
  const first = fakeTb(WINNING);
  await run(fakeEngine(), first, { onSearched: (R) => { if (R.length === 3) kept = R; } });
  const tb = fakeTb(WINNING), eng = fakeEngine();
  const out = await run(eng, tb, { earlier: JSON.parse(JSON.stringify(kept)) });
  assert.deepEqual(tb.asked, [3, 4]);
  assert.deepEqual(out.moves.map((m) => m.classification), ['best', 'best', 'blunder', 'best']);
});

test('buildGame shows tablebase positions: no-DTM wins as won, its search as the tablebase, the engine summary', async () => {
  const noDtm = [answer('win', 55, null, 'd2e3'), answer('loss', -54, null, 'e5d6'), ...WINNING.slice(2)];
  const out = await run(fakeEngine(), fakeTb(noDtm));
  assert.equal(out.moves[0].eval_after, 9990);
  const M = CC.buildGame({ pgn: PGN, analysis: out });
  assert.equal(M.plies[0].won, 'w');
  assert.equal(M.plies[0].mate, undefined, 'DTZ is not a distance to mate');
  assert.deepEqual(M.plies[0].search, { tablebase: true });
  assert.ok(M.plies[1].tbBefore && M.plies[1].tb);
  assert.equal(M.plies[2].cls, 'blunder');
  assert.match(M.engine, / · Lichess tablebase$/);
  // with DTM the mate count stands
  const M2 = CC.buildGame({ pgn: PGN, analysis: await run(fakeEngine(), fakeTb(WINNING)) });
  assert.equal(M2.plies[0].mate, 27);
  assert.equal(M2.plies[0].won, undefined);
});

test('LichessCore.evalCp: certain answers as the bar\'s value, checkmate ±10000, stalemate 0, uncertain null', () => {
  assert.equal(LC.evalCp(answer('win', 55, 55), 'w'), 9720);
  assert.equal(LC.evalCp(answer('win', 20, null), 'b'), -9990);
  assert.equal(LC.evalCp(answer('cursed-win', 120, null), 'w'), 0);
  assert.equal(LC.evalCp(answer('maybe-win', 90, null), 'w'), null);
  assert.equal(LC.evalCp({ ...answer('loss', 0, 0), checkmate: true }, 'w'), -10000);
  assert.equal(LC.evalCp({ ...answer('draw', 0, 0), stalemate: true }, 'b'), 0);
});
