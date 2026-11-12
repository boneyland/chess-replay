const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js');
const CC = window.ChessCore;
const PGN = '[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 *';
const analysis = (engine) => ({ white: 'A', black: 'B', engine, moves: [
  { ply: 1, move_san: 'e4', move_uci: 'e2e4', eval_before: 20, eval_after: 30, classification: 'best', eval_loss: 0, best_move_uci: 'e2e4', best_line: ['e4'] },
  { ply: 2, move_san: 'e5', move_uci: 'e7e5', eval_before: 30, eval_after: 25, classification: 'best', eval_loss: 0, best_move_uci: 'e7e5', best_line: ['e5'] }] });

test('engine label for a depth search with a time cap reads like describe_search', () => {
  const M = CC.buildGame({ pgn: PGN, analysis: analysis({ name: 'Stockfish 19 lite (browser)', depth: 22, time_limit: 3, lines: 1, threads: 1, hash_mb: 64 }) });
  assert.equal(M.engine, 'Stockfish 19 lite (browser) · depth 22, max 3s per position');
});

test('engine label for a timed native search is unchanged', () => {
  const M = CC.buildGame({ pgn: PGN, analysis: analysis({ name: 'Stockfish 19', depth: null, time_limit: 4, lines: 1, threads: 7, hash_mb: 256 }) });
  assert.equal(M.engine, 'Stockfish 19 · 4s per position · 1 line · 7 threads');
});

test('a game without evals that ends in checkmate has no evals', () => {
  const M = CC.buildGame({ pgn: '[Result "1-0"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0' });
  assert.equal(M.plies[6].checkmate, true);
  assert.equal(M.hasEval, false);
});

test('stepFromUci builds a line step like userMove, keeping under-promotion', () => {
  const s = CC.stepFromUci(CC.posFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'), 'e2e4');
  assert.equal(s.san, 'e4');
  assert.equal(s.uci, 'e2e4');
  assert.equal(s.pos.turn, 'b');
  assert.equal(s.board.length, 64);
  assert.equal(s.checkSq, null);
  const p = CC.stepFromUci(CC.posFromFen('8/P5k1/8/8/8/8/8/4K3 w'), 'a7a8n');
  assert.equal(p.san, 'a8=N');
  assert.equal(p.board[0], 'N');
  assert.equal(CC.stepFromUci(CC.posFromFen('8/8/8/8/8/8/8/4K2k w'), 'e1e5'), null);
});

test('buildGame names the opening from the book when the PGN has none', () => {
  window.OPENINGS_TSV = require('../openings-data.cjs').openingsTsv();
  loadUnit('openings-core.js');
  const M = CC.buildGame({ pgn: '[White "A"]\n[Black "B"]\n[Opening "?"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0' });
  assert.equal(M.opening, "King's Pawn Game: Wayward Queen Attack");
  assert.equal(M.eco, 'C20');
  const named = CC.buildGame({ pgn: '[ECO "B00"]\n[Opening "My name"]\n\n1. e4 e5 *' });
  assert.equal(named.opening, 'My name');
});

test('castling needs the right: lost after the rook or king has moved', () => {
  let pos = CC.posFromFen('4k3/8/8/8/8/8/8/4K2R w K');
  assert.ok(CC.applyUci(pos, 'e1g1'), 'O-O with the right');
  for (const u of ['h1g1', 'e8d8', 'g1h1', 'd8e8']) pos = CC.applyUci(pos, u).pos;
  assert.equal(CC.applyUci(pos, 'e1g1'), null);
  assert.ok(!CC.legalTargets(pos, CC.sqIndex('e1')).includes(CC.sqIndex('g1')));
  assert.equal(CC.applyUci(CC.posFromFen('4k3/8/8/8/8/8/8/4K2R w -'), 'e1g1'), null);
});

test('game positions carry castling rights from the moves played', () => {
  const M = CC.buildGame({ pgn: '1. Nf3 Nf6 2. Rg1 Rg8 3. Rh1 Rh8 *' });
  assert.equal(M.plies[5].pos.castle, 'Qq');
  assert.equal(M.plies[0].pos.castle, 'KQkq');
  assert.equal(CC.posAt(M, 0), M.start.pos);
  assert.equal(CC.posAt(M, 6), M.plies[5].pos);
});

test('playLine keeps the castling rights it is given', () => {
  const steps = CC.playLine(CC.posFromFen('4k3/8/8/8/8/8/8/4K2R w K'), ['Rg1', 'Kd8', 'Rh1', 'Ke8']);
  assert.equal(steps[3].pos.castle, '');
  assert.equal(CC.applyUci(steps[3].pos, 'e1g1'), null);
  assert.ok(CC.applyUci(CC.playLine(CC.posFromFen('4k3/8/8/8/8/8/8/4K2R w K'), ['Kf1', 'Kd8'])[0].pos, 'e8d7')); // sanity: lines still play
});

test('buildGame keeps the actual search stats of each move', () => {
  const A = analysis({ name: 'Stockfish 19 lite (browser)', depth: 22, time_limit: 3, lines: 1, threads: 1, hash_mb: 64 });
  Object.assign(A.moves[0], { search_depth_after: 21, search_maxdepth_after: 22, search_time_after_ms: 1432, search_nodes_after: 812345 });
  const M = CC.buildGame({ pgn: PGN, analysis: A });
  assert.deepEqual(M.plies[0].search, { depth: 21, maxDepth: 22, timeMs: 1432, nodes: 812345 });
  assert.equal(M.plies[1].search, undefined);
  assert.equal(M.engineName, 'Stockfish 19 lite (browser)');
});

test('analysis mate scores keep their distance (±(10000 − 10·N) is mate in N)', () => {
  const fs = require('fs'), path = require('path');
  const dir = path.join(__dirname, 'fixtures');
  const M = CC.buildGame({ pgn: fs.readFileSync(path.join(dir, 'byrne-fischer.pgn'), 'utf8'), analysis: fs.readFileSync(path.join(dir, 'byrne-fischer_analysis.json'), 'utf8') });
  const at = (san) => M.plies.findLast((p) => p.san === san); // the final mating sequence
  assert.equal(at('Kd1').mate, -4);   // eval_after -9960
  assert.equal(at('Bb3+').mate, -3);  // -9970
  assert.equal(at('Nc3+').mate, -1);  // -9990
  assert.equal(at('Rc2#').checkmate, true);
});

// formats from cutechess's MoveEvaluation::scoreText and evalString: M is plies to mate (UCI mate 3 → +M5, mate -2 → -M4)
test('cutechess engine comments give evals, turned to White’s point of view', () => {
  const M = CC.buildGame({ pgn: '[Result "*"]\n\n1. e4 {book} e5 {book} 2. Nf3 {+0.31/20 1.2s} Nc6 {-0.25/18 0.95s} 3. Bc4 {-M4/12 0.081s} Nf6 {+M5/30 2.0s Book exit} 4. d3 {0.00/1 0s} *' });
  assert.deepEqual(M.plies.map((p) => p.cp ?? (p.mate != null ? 'M' + p.mate : null)), [null, null, 31, 25, 'M-2', 'M-3', 0]);
  assert.ok(!M.plies[0].comment);
  assert.equal(M.hasEval, true);
});

test('cutechess engine comments in a game starting with Black to move are turned to White’s point of view too', () => {
  const M = CC.buildGame({ pgn: '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 b - - 0 1"]\n\n1... Kd7 {+1.00/20 0.1s} 2. e4 {+2.00/20 0.1s} *' });
  assert.deepEqual(M.plies.map((p) => p.cp), [-100, 200]);
});

test('a cutechess eval needs its time or the comment\'s end: a fraction in words isn\'t one', () => {
  const M = CC.buildGame({ pgn: '1. e4 {3/4 of players choose this} e5 {+0.40/12} *' });
  assert.equal(M.plies[0].cp, undefined);
  assert.equal(M.plies[0].comment, '3/4 of players choose this');
  assert.equal(M.plies[1].cp, -40);
});

test('TimeControl gives the first period\'s seconds, a move count before it or not', () => {
  const clock = (tc) => CC.buildGame({ pgn: `[TimeControl "${tc}"]\n\n1. e4 e5 *` }).clockStart;
  assert.equal(clock('40/7200:3600'), 7200);
  assert.equal(clock('300+2'), 300);
});

test('splitGames: a tag line inside a comment stays in its game, and header-less games split after their result', () => {
  assert.deepEqual(CC.splitGames('[White "A"]\n\n1. e4 {a note\n[Event "x"]\nends} e5 *').length, 1);
  assert.deepEqual(CC.splitGames('1. e4 e5 1-0\n\n1. d4 d5 0-1').map((g) => g.trim()), ['1. e4 e5 1-0', '1. d4 d5 0-1']);
  assert.equal(CC.splitGames('1. e4 (1. d4 1-0)\ne5 *').length, 1, 'a result in a variation ends nothing');
  assert.equal(CC.splitGames('1. e4 {ends 1-0}\ne5 *').length, 1, 'nor one in a comment');
  assert.equal(CC.splitGames('1. e4 e5 1-0\n{a last word}\n').length, 1, 'a comment after the result stays with its game');
  assert.equal(CC.splitGames('[White "A"]\n\n1. e4 *\n\n[White "B"]\n\n1. d4 *').length, 2);
});

test('SAN castling needs the king on its square', () => {
  assert.throws(() => CC.buildGame({ pgn: '[SetUp "1"]\n[FEN "k7/8/8/8/8/8/3K4/4R3 w - - 0 1"]\n\n1. O-O *' }), /not a legal move/);
});

test('posFromFen keeps an en passant square a pawn just crossed, and drops one none did', () => {
  assert.equal(CC.posFromFen('4k3/8/8/3pPp2/8/8/8/4K3 w - f6 0 2').ep, CC.sqIndex('f6'));
  assert.equal(CC.posFromFen('4k3/8/8/3pP3/8/8/8/4K3 w - f6 0 2').ep, -1);
  assert.equal(CC.posFromFen('4k3/8/8/3pPp2/8/8/8/4K3 w').ep, -1);
  assert.ok(CC.applyUci(CC.posFromFen('4k3/8/8/3pPp2/8/8/8/4K3 w - f6 0 2'), 'e5f6'));
});

// a PGN's move is checked as fully as a move on the board: an illegal one would otherwise corrupt every position after it
test('illegal castling and promotions in a PGN are refused', () => {
  const bad = (pgn) => assert.throws(() => CC.buildGame({ pgn }), /not a legal move/);
  bad('1. O-O *'); // pieces in the way (it once took White's own bishop and knight)
  bad('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R w - - 0 1"]\n\n1. O-O *'); // no castling right
  bad('[SetUp "1"]\n[FEN "4kr2/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. O-O *'); // through check
  bad('[SetUp "1"]\n[FEN "4r1k1/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. O-O *'); // out of check
  bad('1. e4=Q *'); // a promotion short of the last rank
  bad('[SetUp "1"]\n[FEN "8/P7/8/8/8/8/8/k6K w - - 0 1"]\n\n1. a8 *'); // a pawn left on the last rank
  assert.equal(CC.buildGame({ pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *' }).plies[6].uci, 'e1g1');
  assert.throws(() => CC.buildGame({ pgn: '1. e4 e5 2. O-O *' }), /^Error: "O-O" is not a legal move here \(move 2\.\)$/); // says where
});

test('escaped quotes and backslashes in a PGN tag are read as the characters', () => {
  const M = CC.buildGame({ pgn: '[White "Smith, \\"J\\""]\n[Black "a\\\\b"]\n\n1. e4 *' });
  assert.equal(M.headers.White, 'Smith, "J"');
  assert.equal(M.headers.Black, 'a\\b');
});

test('a tag written inside a comment stays the comment’s text', () => {
  const M = CC.buildGame({ pgn: '[Event "Real"]\n\n1. e4 {see [Event "x"] here} e5 ; [White "y"]\n2. Nf3 *' });
  assert.equal(M.headers.Event, 'Real');
  assert.equal(M.headers.White, undefined);
  assert.equal(M.plies[0].comment, 'see [Event "x"] here');
});

// what other programs write besides plain SAN, shown in the move list as standard SAN
test('figurines, long algebraic, e.p. and castling with zeros are read, and shown as standard SAN', () => {
  const M = CC.buildGame({ pgn: '1. e2-e4 ♞f6 2. e5 d7-d5 3. exd6 e.p. e6 4. ♘g1-f3 ♗e7 5. Bf1-c4 0-0 6. 0-0 *' });
  assert.deepEqual(M.plies.map((p) => p.san), ['e4', 'Nf6', 'e5', 'd5', 'exd6', 'e6', 'Nf3', 'Be7', 'Bc4', 'O-O', 'O-O']);
  assert.equal(CC.buildGame({ pgn: '1. e4 e5 2. Ng1f3 *' }).plies[2].san, 'Nf3'); // more of the square than it needs
});

test('a null move gets a message saying so', () => {
  assert.throws(() => CC.buildGame({ pgn: '1. e4 -- 2. d4 *' }), /null move \("--"\)/);
  // in a variation it only ends that line
  assert.equal(CC.buildGame({ pgn: '1. e4 (1. d4 -- 2. c4) e5 *' }).plies.length, 2);
});

test('an engine comment is not shown as commentary, the text after it is', () => {
  const P = CC.buildGame({ pgn: '[Result "*"]\n\n1. e4 {+0.31/20 1.2s Book exit} e5 {Played 1/2 the time} *' });
  assert.equal(P.plies[0].comment, 'Book exit');
  assert.equal(P.plies[1].cp, undefined);
});

// A move's position (own moves, best lines, variations start from it) keeps the en passant square
test('en passant is playable from a game position after a double pawn push', () => {
  const M = CC.buildGame({ pgn: '1. e4 Nf6 2. e5 d5 *' });
  const P = M.plies[3];
  assert.equal(CC.userMove(P.pos, CC.sqIndex('e5'), CC.sqIndex('d6')).san, 'exd6');
  assert.deepEqual(CC.playLine(P.pos, ['exd6', 'exd6']).map((s) => s.san), ['exd6', 'exd6']);
});

test('the viewer picks the promotion piece', () => {
  const pos = CC.posFromFen('8/P5k1/8/8/8/8/6Kp/8 w'), a7 = CC.sqIndex('a7'), a8 = CC.sqIndex('a8');
  assert.equal(CC.isPromotion(pos, a7, a8), true);
  assert.equal(CC.isPromotion(pos, CC.sqIndex('g2'), CC.sqIndex('g3')), false);
  assert.equal(CC.isPromotion(pos, a7, CC.sqIndex('a6')), false); // not legal
  assert.equal(CC.userMove(pos, a7, a8).san, 'a8=Q'); // a queen unless told otherwise
  for (const [t, san] of [['q', 'a8=Q'], ['r', 'a8=R'], ['b', 'a8=B'], ['n', 'a8=N']]) {
    const s = CC.userMove(pos, a7, a8, t);
    assert.equal(s.san, san);
    assert.equal(s.uci, 'a7a8' + t);
    assert.equal(s.board[a8], t.toUpperCase());
  }
  assert.equal(CC.userMove(pos, a7, a8, 'k'), null);
  // black promotes towards rank 1
  const b = CC.posFromFen('8/8/8/8/8/8/4Kp2/7k b'), f2 = CC.sqIndex('f2'), f1 = CC.sqIndex('f1');
  assert.equal(CC.isPromotion(b, f2, f1), true);
  const n = CC.userMove(b, f2, f1, 'n');
  assert.equal(n.san, 'f1=N');
  assert.equal(n.board[f1], 'n');
  // the piece doesn't matter to a move that isn't a promotion
  assert.equal(CC.userMove(pos, CC.sqIndex('g2'), CC.sqIndex('g3'), 'n').san, 'Kg3');
});

test('a best move from a PGN variation keeps its promotion piece', () => {
  const N = CC.buildGame({ pgn: '1. e4 d5 2. exd5 c6 3. dxc6 Qd6 4. cxb7 Qd5 5. Nc3 (5. bxa8=Q) *' });
  assert.equal(N.plies[8].best.uci, 'b7a8q');
});

test('clip range: the whole game spans the video, and a move range sits between its moves', () => {
  const fx = (f) => require('fs').readFileSync(require('path').join(__dirname, 'fixtures', f), 'utf8');
  const M = CC.buildGame({ pgn: fx('byrne-fischer.pgn'), analysis: fx('byrne-fischer_analysis.json') });
  const TM = CC.timing(M, { secondsPerMove: 1.6, keyHold: 1.5 });
  const at = CC.clipRange(M, TM), N = M.plies.length;
  const S = CC.schedule(M, CC.cues(TM.scenes), TM.d);
  assert.deepEqual(at(-1, N), { start: 0, end: TM.total });
  const r = at(20, 29);
  assert.ok(r.start < S.tp[20] && r.start > S.tp[19], 'starts just before ply 20');
  assert.ok(r.end > S.tp[29] + S.md[29] && r.end < S.tp[30], 'ends once ply 29 has settled, before ply 30');
  const last = at(N - 1, N - 1);
  assert.ok(last.end < CC.cues(TM.scenes).Outro, 'the last move alone stops before the end card');
  assert.ok(at(5, 5).end > at(5, 5).start);
});

test('schedule: a move that ends a section holds no longer than its own time', () => {
  const fx = (f) => require('fs').readFileSync(require('path').join(__dirname, 'fixtures', f), 'utf8');
  const M = CC.buildGame({ pgn: fx('byrne-fischer.pgn'), analysis: fx('byrne-fischer_analysis.json') });
  const TM = CC.timing(M, { secondsPerMove: 1.6, keyHold: 1.5 });
  const S = CC.schedule(M, CC.cues(TM.scenes), TM.d);
  const ends = CC.plan(M).map((r) => r[2]).filter((b) => b >= 0 && b < M.plies.length - 1);
  assert.ok(ends.length >= 2);
  // scene lengths are rounded to 0.1 s, which a section's moves share
  for (const i of ends) assert.ok(Math.abs(S.tp[i + 1] - S.tp[i] - TM.d[i]) < 0.06, `ply ${i} holds ${S.tp[i + 1] - S.tp[i]} s, not ${TM.d[i]} s`);
});

test('annotatedPgn writes marks after the moves, evals, clocks, notes and the better line, and reads back the same game', () => {
  const pgn = '[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 { [%eval 0.3] [%clk 0:05:00] } e5 { [%eval 0.25] [%clk 0:04:58] } 2. Qh5 { [%eval -0.1] } Ke7?? { [%eval 5.0] } ( 2... Nc6 3. Bc4 ) *';
  const M = CC.buildGame({ pgn, notes: '[INTRO]\nA {short} game.\n[4]\nThe king walks.' });
  const out = CC.annotatedPgn(M);
  assert.match(out, /^\[Event "\?"\]\n\[Site "\?"\]\n\[Date "\?\?\?\?\.\?\?\.\?\?"\]\n\[Round "\?"\]\n\[White "A"\]\n\[Black "B"\]\n\[Result "\*"\]/);
  const moves = out.split('\n\n')[1].replace(/\n/g, ' ');
  assert.ok(out.split('\n').every((l) => l.length <= 80));
  assert.match(moves, /^\{A \(short\) game\.\} 1\. e4 \{\[%eval 0\.30\] \[%clk 0:05:00\]\} 1\.\.\. e5/);
  assert.match(moves, /Ke7\?\? \{\[%eval 5\.00\] The king walks\.\} \(2\.\.\. Nc6 3\. Bc4\) \* $/);
  const back = CC.buildGame({ pgn: out });
  assert.deepEqual(back.plies.map((p) => p.san + (p.mark || '')), ['e4', 'e5', 'Qh5', 'Ke7??']);
  assert.equal(back.plies[3].cp, 500);
  assert.equal(back.plies[0].clk, 300);
});

test('annotatedPgn keeps the source PGN variations and other NAGs, and clocks in tenths', () => {
  const M = CC.buildGame({ pgn: '1. a3? (1. e4 e5 (1... c5 {Sicilian}) 2. Nf3; a line comment\n) e5 2. h3 $14 $10 (2. Nf3) Nc6 { [%clk 0:00:05.3] } *' });
  const out = CC.annotatedPgn(M);
  assert.match(out, /\[Date "\?\?\?\?\.\?\?\.\?\?"\]\n\[Round "\?"\]\n\[White "\?"\]\n\[Black "\?"\]/);
  const moves = out.split('\n\n')[1].replace(/\n/g, ' ');
  assert.equal(moves, '1. a3? (1. e4 e5 (1... c5 {Sicilian}) 2. Nf3 {a line comment}) 1... e5 2. h3 $14 $10 (2. Nf3) 2... Nc6 {[%clk 0:00:05.3]} * ');
  const back = CC.buildGame({ pgn: out });
  assert.deepEqual(back.plies[2].nags, [14, 10]);
  assert.equal(back.plies[0].pgnVars.length, 1);
  assert.equal(back.plies[3].clk, 5.3);
});

// the better line follows Game › Evaluations from, as the Analysis panel does: the analysis's in place of the PGN's first
// variation on that move (never two better lines), the PGN's other variations kept as written
test('annotatedPgn writes the better line of the evaluations shown and keeps the PGN\'s other variations', () => {
  const pgn = '[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4?! { [%eval 0.1] } (1. d4 {the classical move} d5) (1. c4 {English}) e5 { [%eval 0.2] } (1... c5 {Sicilian}) *';
  const A = analysis({ name: 'Stockfish 19' });
  A.moves[0] = { ...A.moves[0], classification: 'inaccuracy', eval_loss: 60, best_move_uci: 'd2d4', best_line: ['d4', 'Nf6', 'c4'] };
  const moves = (M) => CC.annotatedPgn(M).split('\n\n')[1].replace(/\n/g, ' ');
  const fromA = CC.buildGame({ pgn, analysis: A });
  assert.equal(fromA.evalSource, 'analysis');
  assert.match(moves(fromA), /1\. e4\?! \{\[%eval 0\.30\]\} \(1\. d4 Nf6 2\. c4\) \(1\. c4 \{English\}\) 1\.\.\. e5 \{\[%eval 0\.25\]\} \(1\.\.\. c5 \{Sicilian\}\)/);
  assert.doesNotMatch(moves(fromA), /classical/);
  const fromPgn = CC.buildGame({ pgn, analysis: A, evalSource: 'pgn' });
  assert.equal(fromPgn.evalSource, 'pgn');
  assert.match(moves(fromPgn), /1\. e4\?! \{\[%eval 0\.10\]\} \(1\. d4 \{the classical move\} d5\) \(1\. c4 \{English\}\) 1\.\.\. e5 \{\[%eval 0\.20\]\} \(1\.\.\. c5 \{Sicilian\}\)/);
  // an analysis without a better line on a move leaves its variations alone
  const plain = CC.buildGame({ pgn, analysis: analysis({ name: 'Stockfish 19' }) });
  assert.match(moves(plain), /\(1\. d4 \{the classical move\} d5\) \(1\. c4 \{English\}\)/);
  assert.doesNotMatch(moves(fromPgn), /Nf6/);
});

// a notes file's note sits beside the PGN's own comment (the PGN's first), never in its place; the same words once
test('annotatedPgn keeps the PGN\'s own comments beside a notes file\'s', () => {
  const M = CC.buildGame({ pgn: '{PGN intro} 1. e4 {pgn 1} e5 {same} 2. Nf3 {pgn 3} *', notes: '[INTRO]\nNotes intro\n[1]\nnotes 1\n[2]\nsame\n[CONCLUSION]\nNotes end' });
  const moves = CC.annotatedPgn(M).split('\n\n')[1].replace(/\n/g, ' ');
  assert.equal(moves, '{PGN intro Notes intro} 1. e4 {pgn 1 notes 1} 1... e5 {same} 2. Nf3 {pgn 3} {Notes end} * ');
});

test('notesText writes a game\'s notes as a notes file that reads back the same', () => {
  const notes = '[INTRO]\nNotes intro\n[1]\nnotes 1\n[3]\nnotes {3}\n[CONCLUSION]\nNotes end';
  const M = CC.buildGame({ pgn: '{PGN intro} 1. e4 {pgn 1} e5 2. Nf3 *', notes });
  const out = CC.notesText(M);
  assert.equal(out, '[INTRO] Notes intro\n\n[1] notes 1\n\n[3] notes {3}\n\n[CONCLUSION] Notes end\n');
  assert.equal(CC.classifyFile('a_notes.txt', out), 'notes');
  assert.deepEqual(CC.buildGame({ pgn: '1. e4 e5 2. Nf3 *', notes: out }).plies.map((p) => p.comment), ['notes 1', '', 'notes {3}']);
  assert.equal(CC.notesText(CC.buildGame({ pgn: '1. e4 {pgn 1} *' })), '');
});

// the engine's line goes on every move the analysis didn't rate best (an unmarked small loss too), never on one it rated
// best (an equally good move: the line would only stand beside it), as the Analysis panel shows its line; the marks follow
// the SAN as ?!, ?, ??, !, !!, !?
test('annotatedPgn writes the analysis\'s line on every move not rated best, and the marks after the moves', () => {
  const A = analysis({ name: 'Stockfish 19' });
  A.moves[0] = { ...A.moves[0], classification: 'best', best_move_uci: 'd2d4', best_line: ['d4', 'd5'] };
  A.moves[1] = { ...A.moves[1], classification: 'good', eval_loss: 15, best_move_uci: 'c7c5', best_line: ['c5', 'Nf3'] };
  const M = CC.buildGame({ pgn: '[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5!? *', analysis: A });
  const moves = CC.annotatedPgn(M).split('\n\n')[1].replace(/\n/g, ' ');
  assert.equal(moves, '1. e4 {[%eval 0.30]} 1... e5!? {[%eval 0.25]} (1... c5 2. Nf3) * ');
  assert.equal(CC.buildGame({ pgn: CC.annotatedPgn(M) }).plies[1].mark, '!?');
});

// Go deeper's search of the position after ply i: its eval for ply i, and its line on ply i + 1 in place of the analysis's
// (the line the annotated PGN writes there), none where its first move is the move played; marks and ratings stay
test('withSearches puts a deeper search\'s eval on its move and its line on the next', () => {
  const A = { white: 'A', black: 'B', engine: { name: 'Stockfish 19' }, moves: [
    { ply: 1, move_san: 'e4', move_uci: 'e2e4', eval_before: 20, eval_after: 30, classification: 'best', eval_loss: 0, best_move_uci: 'e2e4', best_line: ['e4'] },
    { ply: 2, move_san: 'e5', move_uci: 'e7e5', eval_before: 30, eval_after: 60, classification: 'inaccuracy', eval_loss: 30, best_move_uci: 'c7c5', best_line: ['c5', 'Nf3'] },
    { ply: 3, move_san: 'Nf3', move_uci: 'g1f3', eval_before: 60, eval_after: 50, classification: 'inaccuracy', eval_loss: 40, best_move_uci: 'f1c4', best_line: ['Bc4'] }] };
  const M = CC.buildGame({ pgn: '[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *', analysis: A });
  const moves = (G) => CC.annotatedPgn(G).split('\n\n')[1].replace(/\n/g, ' ');
  assert.equal(moves(M), '1. e4 {[%eval 0.30]} 1... e5?! {[%eval 0.60]} (1... c5 2. Nf3) 2. Nf3?! {[%eval 0.50]} (2. Bc4) * ');
  // after 1. e4 the deeper search prefers 1... e6 (its line on 1... e5); after 1... e5 it agrees with 2. Nf3 (no line)
  const at = { 0: { cp: 25, pv: ['e7e6', 'd2d4', 'd7d5'] }, 1: { cp: CC.mateCp(-3), pv: ['g1f3', 'b8c6'] } };
  const G = CC.withSearches(M, (i) => at[i] || null);
  assert.equal(moves(G), '1. e4 {[%eval 0.25]} 1... e5?! {[%eval #-3]} (1... e6 2. d4 d5) 2. Nf3?! {[%eval 0.50]} * ');
  assert.equal(G.plies[1].cls, 'inaccuracy');
  assert.equal(CC.withSearches(M, () => null), M);
  // a line that doesn't play from the position is cut where it stops, and an empty one leaves the analysis's
  assert.deepEqual(CC.withSearches(M, (i) => (i === 0 ? { cp: 25, pv: ['e7e6', 'e1e8'] } : null)).plies[1].best, { uci: 'e7e6', line: ['e6'] });
  assert.deepEqual(CC.withSearches(M, (i) => (i === 0 ? { cp: 25, pv: [] } : null)).plies[1].best, M.plies[1].best);
});

// a note that starts like a key ([RESULT], [12]) stays that move's note: the key and its text share a line
test('notesText reads back a note that starts like a notes key', () => {
  const M = CC.buildGame({ pgn: '1. e4 e5 *', notes: '[1]\nfirst\n[2]\nsecond' });
  const odd = { ...M, plies: M.plies.map((p, i) => ({ ...p, says: { ...p.says, notes: ['[12] was the plan', '[RESULT] matters'][i] } })) };
  const back = CC.buildGame({ pgn: '1. e4 e5 *', notes: CC.notesText(odd) });
  assert.deepEqual(back.plies.map((p) => p.comment), ['[12] was the plan', '[RESULT] matters']);
  assert.equal(back.conclusion, '');
});

// the annotated PGN and the notes file, imported together, give back the same annotated PGN: the notes written into the
// PGN's comments (beside its own words, and the conclusion after the last move) aren't counted twice
test('an annotated PGN imported with its notes file exports the same annotated PGN', () => {
  const M = CC.buildGame({ pgn: '{PGN intro} 1. e4 {pgn 1} e5 {same} 2. Nf3 *', notes: '[INTRO]\nNotes intro\n[1]\nnotes {1}\n[2]\nsame\n[3]\nnotes 3\n[CONCLUSION]\nNotes end' });
  const pgn = CC.annotatedPgn(M), notes = CC.notesText(M);
  const back = CC.buildGame({ pgn, notes });
  assert.equal(CC.annotatedPgn(back), pgn);
  assert.equal(CC.notesText(back), notes);
  assert.equal(back.plies[0].says.pgn, 'pgn 1');
  assert.equal(back.says.pgn.intro, 'PGN intro');
  // a PGN whose comment only happens to match a note keeps it (the same words once in the export, as before)
  assert.equal(CC.buildGame({ pgn: '1. e4 {same} *', notes: '[1]\nsame' }).plies[0].says.pgn, 'same');
});

test('annotatedPgn raw writes the tags and bare moves: no comments, NAGs, evals, clocks or variations', () => {
  const pgn = '[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 { [%eval 0.3] [%clk 0:05:00] } e5 { [%eval 0.25] } 2. Qh5 $10 { A queen. } Ke7?? ( 2... Nc6 3. Bc4 ) *';
  const M = CC.buildGame({ pgn, notes: '[INTRO]\nA game.\n[4]\nThe king walks.' });
  const out = CC.annotatedPgn(M, { raw: true });
  assert.match(out, /\[White "A"\]\n\[Black "B"\]\n\[Result "\*"\]/);
  assert.equal(out.split('\n\n')[1], '1. e4 e5 2. Qh5 Ke7 *\n');
  assert.deepEqual(CC.buildGame({ pgn: out }).plies.map((p) => p.san), ['e4', 'e5', 'Qh5', 'Ke7']);
});

test('annotatedPgn never starts a line with %, which would make it an escape line', () => {
  const word = 'x'.repeat(70);
  const M = CC.buildGame({ pgn: '1. e4 e5 *', notes: `[1]\n${word} % up` });
  const out = CC.annotatedPgn(M);
  assert.ok(out.split('\n').every((l) => l[0] !== '%'), out);
  assert.match(out.replace(/\n/g, ' '), /x % up\}/);
});

// a { inside a comment leaves a stray } in the movetext; it used to stall the parser for good
test('a stray } in the movetext is skipped', () => {
  const M = CC.buildGame({ pgn: '1. e4 e5 {see {this}} 2. Nf3 } Nc6 *' });
  assert.deepEqual(M.plies.map((p) => p.san), ['e4', 'e5', 'Nf3', 'Nc6']);
});

test('parseFen reads a full FEN and its move number', () => {
  const f = CC.parseFen('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
  assert.equal(f.pos.turn, 'w'); assert.equal(f.pos.castle, 'KQkq'); assert.equal(f.ply0, 4);
  assert.equal(CC.parseFen('4k3/8/8/8/8/8/8/4K3 b - - 0 40').ply0, 79);
  assert.equal(CC.parseFen('4k3/8/8/8/8/8/8/4K3 w').fen, '4k3/8/8/8/8/8/8/4K3 w - - 0 1'); // missing fields default
});
test('parseFen rejects what is not a legal position', () => {
  for (const [fen, msg] of [
    ['8/8/8/8/8/8/8/4K3 w - - 0 1', /king/i],          // no black king
    ['4k2R/8/8/8/8/8/8/4K3 w - - 0 1', /Black is in check, but it's White's turn/], // Black, not to move, is in check
    ['4k3/8/8/8/8/8/8/4K2R w QK - 0 1', /castling/i],   // rights in any order, but still checked against the pieces
    ['P3k3/8/8/8/8/8/8/4K3 w - - 0 1', /pawn/i],        // a pawn on the back rank
    ['4k3/8/8/8/8/8/8/4K3 w KQ - 0 1', /castling/i],    // rights without the rooks
    ['4k3/8/8/8/8/8/8/1R2K1R1 w BG - 0 1', /Chess960/], // Shredder-FEN rights by file: Chess960
    ['4k3/8/8/8/8/8/8/4K3 w - e3 0 1', /en passant/i],  // no pawn behind e3
    ['not a fen', /FEN/],
  ]) assert.throws(() => CC.parseFen(fen), msg, fen);
  assert.doesNotThrow(() => CC.parseFen('4k3/8/8/8/8/8/8/R3K2r w Q - 0 1')); // White to move in check is legal
});
test('parseFen takes castling rights in any order, as Edit position does, and writes them in KQkq order', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w QKqk - 0 1';
  assert.equal(CC.parseFen(fen).fen, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(CC.parseFen(fen).pos.castle, 'KQkq');
  assert.ok(window.EditCore === undefined || window.EditCore.fromFen(fen).setup);
});
test('readFen keeps what the pieces allow and says what it dropped', () => {
  const r = CC.readFen('r3k3/8/8/8/8/8/8/4K2R w KQkq e3 0 1');
  assert.equal(r.setup.castle, 'Kq'); assert.equal(r.setup.ep, -1);
  assert.deepEqual(r.dropped, { castle: 'Qk', ep: true });
  assert.deepEqual(CC.readFen(CC.START_FEN).dropped, { castle: '', ep: false });
  assert.equal(CC.setupFen(CC.readFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 3 20').setup), '4k3/8/8/3pP3/8/8/8/4K3 w - d6 3 20');
  assert.match(CC.readFen('rnbqkbnr/pppppppp').error, /isn't a FEN/);
});
test('a FEN start with Black to move numbers and sides its plies', () => {
  const M = CC.buildGame({ pgn: '[SetUp "1"]\n[FEN "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 3"]\n\n3... Nf6 4. Nc3 { [%clk 0:04:50] } Bc5 *' });
  assert.equal(M.ply0, 5);
  assert.deepEqual(M.plies.map((p) => p.side), ['b', 'w', 'b']);
  assert.deepEqual(M.plies.map((p, i) => CC.moveNo(M.ply0 + i)), ['3…', '4.', '4…']);
  assert.match(CC.annotatedPgn(M), /\[SetUp "1"\][\s\S]*\[FEN "r1bqkbnr\/pppp1ppp\/2n5\/4p3\/4P3\/5N2\/PPPP1PPP\/RNBQKB1R b KQkq - 3 3"\][\s\S]*3\.\.\.\s?Nf6 4\.\s?Nc3/);
});
test('a standard game is unchanged', () => {
  const M = CC.buildGame({ pgn: '1. e4 e5 2. Nf3 *' });
  assert.equal(M.ply0, 0); assert.equal(M.start.fen, CC.START_FEN);
  assert.doesNotMatch(CC.annotatedPgn(M), /\[FEN /);
});
test('an analysis file for another start does not attach', () => {
  const pgn = '[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 *';
  const other = JSON.stringify({ start_fen: '4k3/8/8/8/8/8/3P4/4K3 w - - 0 1', moves: [{ move_san: 'e4', move_uci: 'e2e4' }] });
  assert.throws(() => CC.buildGame({ pgn, analysis: other }), /doesn't match/);
  const wrongSide = JSON.stringify({ moves: [{ move_san: 'e4', move_uci: 'e2e4', is_white_move: false }] });
  assert.throws(() => CC.buildGame({ pgn, analysis: wrongSide }), /doesn't match/);
});
test('a Python-style analysis file (no start_fen) attaches to its FEN PGN', () => {
  const A = JSON.stringify({ moves: [{ ply: 79, move_san: 'e4', move_uci: 'e2e4', is_white_move: true }] });
  assert.equal(CC.buildGame({ pgn: '[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 40"]\n\n40. e4 *', analysis: A }).hasAnalysis, true);
});
test('a FEN game does not invent a +0.20 position before its first move', () => {
  const M = CC.buildGame({ pgn: '[FEN "4k3/8/8/8/8/8/8/3QK3 b - - 0 40"]\n\n40... Kf7 {[%eval 9.10]} *' });
  assert.ok(!M.plies[0].mark);
  assert.equal(M.evalStart, 910);
  assert.equal(M.evalStartKnown, false);
});
test('plan does not pick a FEN game\'s first ply as its biggest swing', () => {
  const mv = ['Kf7', 'Qd2', 'Ke8', 'Qd3', 'Kf7', 'Qd4', 'Ke8', 'Qd5'];
  const text = mv.map((m, i) => (i % 2 ? '' : (40 + i / 2) + '... ') + m + ' {[%eval 9.10]}').join(' ');
  const M = CC.buildGame({ pgn: '[FEN "4k3/8/8/8/8/8/8/3QK3 b - - 0 40"]\n\n' + text + ' *' });
  const crit = CC.plan(M).find((r) => r[0] === 'Critical');
  assert.ok(crit[1] > 0);
});
test('a standard game still rates its first move against +0.20', () => {
  const M = CC.buildGame({ pgn: '[Result "*"]\n\n1. e4 {[%eval -3.50]} *' });
  assert.equal(M.evalStart, 20); assert.equal(M.evalStartKnown, true);
  assert.equal(M.plies[0].mark, '??');
});
test('evalTicks are absolute move numbers, and unchanged for a standard game', () => {
  assert.deepEqual(CC.evalTicks(0, 45).map((t) => [t.m, t.at]), [[10, 18], [20, 38]]);
  assert.deepEqual(CC.evalTicks(0, 130).map((t) => t.m), [20, 40, 60]);
  // first move is move 30 (ply0 58): the 40 line is at ply 78 - 58 = 20
  assert.deepEqual(CC.evalTicks(58, 45).map((t) => [t.m, t.at]), [[30, 0], [40, 20], [50, 40]]);
  assert.deepEqual(CC.evalTicks(59, 45).map((t) => [t.m, t.at]), [[40, 19], [50, 39]]);
});
test('an analysis file with the same start_fen attaches', () => {
  const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
  const A = JSON.stringify({ start_fen: fen, moves: [{ move_san: 'e4', move_uci: 'e2e4' }] });
  assert.equal(CC.buildGame({ pgn: `[FEN "${fen}"]\n\n1. e4 *`, analysis: A }).hasAnalysis, true);
});

test('withCommentary shows only the sources left on, notes file first, then the PGN', () => {
  const M = CC.buildGame({ pgn: '{PGN intro} 1. e4 {pgn 1} e5 {pgn 2} 2. Nf3 {pgn 3} *', notes: '[1]\nnotes 1\n[3]\nnotes 3\n[CONCLUSION]\nNotes end' });
  assert.deepEqual(CC.commentarySources(M), ['notes', 'pgn']);
  assert.deepEqual(M.plies.map((p) => p.comment), ['notes 1', 'pgn 2', 'notes 3']);
  assert.equal(CC.withCommentary(M, {}), M);
  const pgnOnly = CC.withCommentary(M, { notes: false });
  assert.deepEqual(pgnOnly.plies.map((p) => p.comment), ['pgn 1', 'pgn 2', 'pgn 3']);
  assert.equal(pgnOnly.intro, 'PGN intro');
  assert.equal(pgnOnly.conclusion, '');
  const notesOnly = CC.withCommentary(M, { pgn: false });
  assert.deepEqual(notesOnly.plies.map((p) => p.comment), ['notes 1', '', 'notes 3']);
  assert.equal(notesOnly.conclusion, 'Notes end');
  assert.deepEqual(CC.commentarySources(CC.buildGame({ pgn: '1. e4 e5 *' })), []);
});

test('fenAfter gives the six-field FEN: castling, en passant square, half-move clock and move number', () => {
  const play = (fen, sans) => { let pos = CC.parseFen(fen).pos; for (const san of sans) pos = CC.applySan(pos, san).pos; return CC.fenAfter(fen, sans, pos); };
  assert.equal(play(CC.START_FEN, []), CC.START_FEN);
  assert.equal(play(CC.START_FEN, ['e4']), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  assert.equal(play(CC.START_FEN, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O']), 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4');
  // counting on from a set-up position's clock and move number, Black to move first
  assert.equal(play('4k3/8/8/8/8/8/8/R3K3 b Q - 7 30', ['Kd7', 'Ra7+']), '8/R2k4/8/8/8/8/8/4K3 b - - 9 31');
});

// the Analysis panel's best line is the engine's from the position after the move, as Lichess shows it; the line the
// engine preferred to a move not rated best stays the move's own
test('each move gets the line from the position after it: the next best line, or the last move pv_line', () => {
  const A = analysis({ name: 'Stockfish 19' });
  A.moves[0] = { ...A.moves[0], classification: 'mistake', eval_loss: 80, best_move_uci: 'd2d4', best_line: ['d4', 'd5', 'c4'] };
  A.moves[1] = { ...A.moves[1], best_line: ['e5', 'Nf3'], pv_line: ['Nf3', 'Nc6'] };
  const M = CC.buildGame({ pgn: PGN, analysis: A });
  assert.deepEqual(M.plies[0].best.line, ['d4', 'd5', 'c4']);
  assert.deepEqual(M.plies[0].next, ['e5', 'Nf3']);
  assert.deepEqual(M.plies[1].next, ['Nf3', 'Nc6']);
  assert.equal(M.plies[1].best, undefined);
});

test('fmtLen floors to whole seconds, so a length never reads 1:60', () => {
  assert.equal(CC.fmtLen(119.6), '1:59');
  assert.equal(CC.fmtLen(59.99), '0:59');
  assert.equal(CC.fmtLen(60), '1:00');
  assert.equal(CC.fmtLen(0), '0:00');
  assert.equal(CC.fmtLen(-3), '0:00');
  assert.equal(CC.fmtLen(605.2), '10:05');
});

test('settledAt: a move settles before the next starts, the start before the first move, the last before the end card', () => {
  const fx = (f) => require('fs').readFileSync(require('path').join(__dirname, 'fixtures', f), 'utf8');
  const M = CC.buildGame({ pgn: fx('byrne-fischer.pgn'), analysis: fx('byrne-fischer_analysis.json') });
  const TM = CC.timing(M, { secondsPerMove: 1.6, keyHold: 1.5 });
  const CUES = CC.cues(TM.scenes), S = CC.schedule(M, CUES, TM.d), N = S.N;
  const at = (i) => CC.settledAt(S, CUES, i);
  assert.ok(at(-1) > 0 && at(-1) < S.tp[0], 'the starting position: after the title card, before the first move');
  for (let i = 0; i + 1 < N; i++) assert.ok(at(i) > S.tp[i] + S.md[i] && at(i) < S.tp[i + 1], `ply ${i} has settled before ply ${i + 1}`);
  assert.ok(at(N - 1) > S.tp[N - 1] + S.md[N - 1] && at(N - 1) < CUES.Outro, 'the last move: settled, before the end card');
  // a last move whose hold runs into the end card is capped just before it
  const tight = { ...S, md: S.md.map((x, i) => (i === N - 1 ? CUES.Outro - S.tp[N - 1] : x)) };
  assert.equal(CC.settledAt(tight, CUES, N - 1), CUES.Outro - 0.1);
  // the export's clip ends where a jump to its last move lands
  assert.equal(CC.clipRange(M, TM)(3, 7).end, at(7));
  assert.equal(CC.clipRange(M, TM)(0, N - 1).end, at(N - 1));
});

test('fullFen: rights only where king and rook are home, the en passant square any or only where it can be taken', () => {
  const pos = { ...CC.posFromFen('4k3/8/8/3pP3/8/8/8/4K2R w'), castle: 'KQ', ep: CC.sqIndex('d6') };
  assert.equal(CC.fullFen(pos), '4k3/8/8/3pP3/8/8/8/4K2R w K d6');
  assert.equal(CC.fullFen(pos, { ep: 'legal', counters: [0, 30] }), '4k3/8/8/3pP3/8/8/8/4K2R w K d6 0 30');
  // no white pawn beside d5: the square stays out of a key
  const none = { ...CC.posFromFen('4k3/8/8/3p4/8/8/8/4K2R w'), castle: 'K', ep: CC.sqIndex('d6') };
  assert.equal(CC.fullFen(none, { ep: 'legal' }), '4k3/8/8/3p4/8/8/8/4K2R w K -');
  assert.equal(CC.epCapturable(none), false);
  // a pawn beside it, pinned to its king along the e-file: taking would leave the file, so not legal either
  const pinned = { ...CC.posFromFen('4r1k1/8/8/3pP3/8/8/8/4K3 w'), castle: '', ep: CC.sqIndex('d6') };
  assert.equal(CC.epCapturable(pinned), false);
  assert.equal(CC.epCapturable(pos), true);
});
test('square names, and castling rights lost from the homes', () => {
  assert.equal(CC.sqName(0), 'a8'); assert.equal(CC.sqName(63), 'h1'); assert.equal(CC.sqName(CC.sqIndex('e4')), 'e4');
  let pos = CC.posFromFen(CC.START_FEN);
  for (const u of ['h2h4', 'a7a5', 'h1h3', 'a8a6']) pos = CC.applyUci(pos, u).pos;
  assert.equal(pos.castle, 'Qk');
  for (const u of ['e2e3', 'e7e6', 'e1e2']) pos = CC.applyUci(pos, u).pos;
  assert.equal(pos.castle, 'k');
});

// ---------- engine lines read from an analysis file ----------
test('buildGame reads engine_lines: the next position\'s lines, and the other lines of a move not rated best', () => {
  const C = window.ChessCore;
  const mv = (o) => ({ is_white_move: true, eval_before: 0, eval_after: 0, eval_loss: 0, classification: 'best', best_line: [], pv_line: [], ...o });
  const A = { white: 'W', black: 'B', moves: [
    mv({ move_san: 'e4', move_uci: 'e2e4', best_move_uci: 'd2d4', best_move_san: 'd4', classification: 'inaccuracy', eval_loss: 30, best_line: ['d4', 'd5'],
      engine_lines: [{ move: 'd4', eval: 30, depth: 20, line: ['d4', 'd5'] }, { move: 'e4', eval: 20, depth: 19, line: ['e4', 'e5'] }, { move: 'c4', eval: 15, depth: 18, line: ['c4', 'e5', 'Nc3'] }] }),
    mv({ move_san: 'e5', move_uci: 'e7e5', is_white_move: false, best_move_uci: 'e7e5', best_line: ['e5', 'Nf3'],
      engine_lines: [{ move: 'e5', eval: 20, depth: 20, line: ['e5', 'Nf3'] }, { move: 'c5', eval: 25, depth: 19, line: ['c5'] }] }),
  ] };
  const M = C.buildGame({ pgn: '1. e4 e5 *', analysis: A });
  assert.deepEqual(M.plies[0].best.more, [['c4', 'e5', 'Nc3']]);
  assert.deepEqual(M.plies[0].nextLines.map((l) => [l.k, l.cp, l.depth, l.pv]), [[1, 20, 20, ['e7e5', 'g1f3']], [2, 25, 19, ['c7c5']]]);
  assert.equal(M.plies[1].nextLines, undefined);
  const pgn = C.annotatedPgn(M);
  assert.match(pgn, /\(1\. d4 d5\) \(1\. c4 e5 2\. Nc3\)/);
});

test('buildGame reads a file without engine_lines as before', () => {
  const C = window.ChessCore;
  const A = { white: 'W', black: 'B', moves: [{ move_san: 'e4', move_uci: 'e2e4', is_white_move: true, eval_before: 0, eval_after: 0, eval_loss: 0, classification: 'best', best_line: [], pv_line: [] }] };
  const M = C.buildGame({ pgn: '1. e4 *', analysis: A });
  assert.equal(M.plies[0].nextLines, undefined);
});

test('buildGame reads chess_game_analyzer.py\'s engine_lines (3 lines)', () => {
  const { fixture } = require('./load.cjs');
  const M = CC.buildGame({ pgn: require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'lines.pgn'), 'utf8'), analysis: fixture('lines_analysis.json') });
  // after 1. e4: the lines of the position after it are move 2's engine_lines
  const ls = M.plies[0].nextLines;
  assert.equal(ls.length, 3);
  assert.deepEqual(ls.map((l) => l.k), [1, 2, 3]);
  assert.ok(ls.every((l) => l.depth > 0 && l.pv.length > 1 && typeof l.cp === 'number'));
  assert.equal(M.plies[5].nextLines, undefined); // after the last move: pv_line alone
});

test('links cuts web addresses out of a header line', () => {
  assert.deepEqual(CC.links('https://lichess.org/abc123 · 12 Nov 2026'), [{ text: 'https://lichess.org/abc123', url: 'https://lichess.org/abc123' }, { text: ' · 12 Nov 2026' }]);
  assert.deepEqual(CC.links('See (https://example.com/a_(b)).'), [{ text: 'See (' }, { text: 'https://example.com/a_(b)', url: 'https://example.com/a_(b)' }, { text: ').' }]);
  assert.deepEqual(CC.links('Bengaluru, India'), [{ text: 'Bengaluru, India' }]);
  assert.deepEqual(CC.links('javascript:alert(1) ftp://x https://'), [{ text: 'javascript:alert(1) ftp://x https://' }]);
  assert.deepEqual(CC.links(''), []);
});

// one decoder of a stored eval: a tablebase win with no distance to mate is stored as a mate in 1 (±9990) and is won, not M1
test('decodeEval tells a mate from a tablebase win with no distance to mate', () => {
  assert.deepEqual(CC.decodeEval(35), { cp: 35 });
  assert.deepEqual(CC.decodeEval(CC.mateCp(3)), { mate: 3 });
  assert.deepEqual(CC.decodeEval(CC.mateCp(-2)), { mate: -2 });
  assert.deepEqual(CC.decodeEval(CC.MATE_CP), { mate: 1 }); // a checkmate's score
  assert.deepEqual(CC.decodeEval(CC.mateCp(1), { category: 'win', dtz: 12, dtm: null }), { cp: CC.mateCp(1), won: 'w' });
  assert.deepEqual(CC.decodeEval(CC.mateCp(-1), { category: 'win', dtz: 12, dtm: 0 }), { cp: CC.mateCp(-1), won: 'b' });
  assert.deepEqual(CC.decodeEval(CC.mateCp(4), { category: 'win', dtz: 7, dtm: 7 }), { mate: 4 }); // with a distance: a mate
  // a Go deeper search that came from the tablebase keeps the win in the game
  const M = CC.buildGame({ pgn: '1. e4 e5 *' });
  const W = CC.withSearches(M, (i) => (i === 1 ? { cp: CC.mateCp(-1), tb: { category: 'win', dtm: null } } : null));
  assert.equal(W.plies[1].won, 'b'); assert.equal(W.plies[1].mate, null);
});

// buildGame's parts: the position after each ply is the whole position, as the game left it
test('a ply carries the whole position after it', () => {
  const M = CC.buildGame({ pgn: '1. e4 Nf6 2. e5 d5 3. Ke2 *' });
  assert.equal(M.plies[3].pos.ep, CC.sqIndex('d6'));
  assert.equal(M.plies[4].pos.castle, 'kq');
  assert.equal(M.plies[4].pos.turn, 'b');
  assert.equal(CC.fullFen(M.plies[4].pos), 'rnbqkb1r/ppp1pppp/5n2/3pP3/8/8/PPPPKPPP/RNBQ1BNR b kq -');
});
