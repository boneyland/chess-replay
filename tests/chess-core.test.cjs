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
  assert.equal(M.plies[5].castle, 'Qq');
  assert.equal(M.plies[0].castle, 'KQkq');
});

test('playLine keeps the castling rights it is given', () => {
  const steps = CC.playLine('4k3/8/8/8/8/8/8/4K2R w', ['Rg1', 'Kd8', 'Rh1', 'Ke8'], 'K');
  assert.equal(steps[3].pos.castle, '');
  assert.equal(CC.applyUci(steps[3].pos, 'e1g1'), null);
  assert.ok(CC.applyUci(CC.playLine('4k3/8/8/8/8/8/8/4K2R w', ['Kf1', 'Kd8'], 'K')[0].pos, 'e8d7')); // sanity: lines still play
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

// Positions rebuilt from a move's FEN (own moves, best lines, variations) keep the en passant square
test('en passant is playable from a game position after a double pawn push', () => {
  const M = CC.buildGame({ pgn: '1. e4 Nf6 2. e5 d5 *' });
  const P = M.plies[3];
  const pos = { ...CC.posFromFen(P.fen), castle: P.castle, ep: P.ep };
  assert.equal(CC.userMove(pos, CC.sqIndex('e5'), CC.sqIndex('d6')).san, 'exd6');
  assert.deepEqual(CC.playLine(P.fen, ['exd6', 'exd6'], P.castle, P.ep).map((s) => s.san), ['exd6', 'exd6']);
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

test('annotatedPgn writes marks as NAGs, evals, clocks, notes and the better line, and reads back the same game', () => {
  const pgn = '[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 { [%eval 0.3] [%clk 0:05:00] } e5 { [%eval 0.25] [%clk 0:04:58] } 2. Qh5 { [%eval -0.1] } Ke7?? { [%eval 5.0] } ( 2... Nc6 3. Bc4 ) *';
  const M = CC.buildGame({ pgn, notes: '[INTRO]\nA {short} game.\n[4]\nThe king walks.' });
  const out = CC.annotatedPgn(M);
  assert.match(out, /^\[Event "\?"\]\n\[Site "\?"\]\n\[Date "\?\?\?\?\.\?\?\.\?\?"\]\n\[Round "\?"\]\n\[White "A"\]\n\[Black "B"\]\n\[Result "\*"\]/);
  const moves = out.split('\n\n')[1].replace(/\n/g, ' ');
  assert.ok(out.split('\n').every((l) => l.length <= 80));
  assert.match(moves, /^\{A \(short\) game\.\} 1\. e4 \{\[%eval 0\.30\] \[%clk 0:05:00\]\} 1\.\.\. e5/);
  assert.match(moves, /Ke7 \$4 \{\[%eval 5\.00\] The king walks\.\} \(2\.\.\. Nc6 3\. Bc4\) \* $/);
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
  assert.equal(moves, '1. a3 $2 (1. e4 e5 (1... c5 {Sicilian}) 2. Nf3 {a line comment}) 1... e5 2. h3 $14 $10 (2. Nf3) 2... Nc6 {[%clk 0:00:05.3]} * ');
  const back = CC.buildGame({ pgn: out });
  assert.deepEqual(back.plies[2].nags, [14, 10]);
  assert.equal(back.plies[0].pgnVars.length, 1);
  assert.equal(back.plies[3].clk, 5.3);
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
    ['4k2R/8/8/8/8/8/8/4K3 w - - 0 1', /not to move is in check/i], // Black, not to move, is in check
    ['P3k3/8/8/8/8/8/8/4K3 w - - 0 1', /pawn/i],        // a pawn on the back rank
    ['4k3/8/8/8/8/8/8/4K3 w KQ - 0 1', /castling/i],    // rights without the rooks
    ['4k3/8/8/8/8/8/8/1R2K1R1 w BG - 0 1', /Chess960/], // Shredder-FEN rights by file: Chess960
    ['4k3/8/8/8/8/8/8/4K3 w - e3 0 1', /en passant/i],  // no pawn behind e3
    ['not a fen', /FEN/],
  ]) assert.throws(() => CC.parseFen(fen), msg, fen);
  assert.doesNotThrow(() => CC.parseFen('4k3/8/8/8/8/8/8/R3K2r w Q - 0 1')); // White to move in check is legal
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
