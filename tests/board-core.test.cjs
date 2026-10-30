const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('board-core.js');
const B = window.BoardCore, CC = window.ChessCore;
const step = (b, uci) => CC.stepFromUci(B.pos(b), uci);

test('a new board is the starting position with no moves', () => {
  const b = B.fromFen();
  assert.equal(b.fen, CC.START_FEN); assert.equal(b.upto, -1); assert.equal(B.pos(b).turn, 'w');
});
test('play, go back, and play again branches', () => {
  let b = B.fromFen();
  for (const u of ['e2e4', 'e7e5', 'g1f3']) b = B.play(b, step(b, u));
  assert.deepEqual(B.ucis(b), ['e2e4', 'e7e5', 'g1f3']);
  b = B.go(b, 0);
  assert.deepEqual(B.ucis(b), ['e2e4']); assert.equal(b.steps.length, 3, 'redo kept until a new move');
  b = B.play(b, step(b, 'c7c5'));
  assert.deepEqual(B.ucis(b), ['e2e4', 'c7c5']); assert.equal(b.steps.length, 2);
  assert.equal(B.go(b, 9).upto, 1); assert.equal(B.go(b, -5).upto, -1);
});
test('boards are never mutated', () => {
  const a = B.fromFen(), b = B.play(a, step(a, 'e2e4'));
  assert.equal(a.steps.length, 0); assert.equal(a.upto, -1);
  B.go(b, -1); assert.equal(b.upto, 0);
});
test('a FEN with Black to move numbers its moves from the FEN', () => {
  let b = B.fromFen('4k3/8/8/8/8/8/4P3/4K3 b - - 0 40');
  b = B.play(b, step(b, 'e8d7'));
  assert.equal(B.label(b, 0), '40… Kd7');
});
test('save and restore round-trip; restore keeps the legal prefix', () => {
  let b = B.fromFen();
  for (const u of ['e2e4', 'e7e5']) b = B.play(b, step(b, u));
  b = B.go(b, 0);
  assert.deepEqual(B.save(B.restore(B.save(b))), { fen: CC.START_FEN, moves: ['e2e4', 'e7e5'], upto: 0 });
  const r = B.restore({ fen: CC.START_FEN, moves: ['e2e4', 'e2e4', 'd7d5'], upto: 2 });
  assert.deepEqual(B.ucis(r), ['e2e4']); assert.equal(r.steps.length, 1);
  assert.equal(B.restore({ fen: 'nonsense', moves: [], upto: -1 }), null);
});
test('restore never throws on a damaged stored board', () => {
  for (const bad of [null, undefined, 3, 'x', [], {}, { fen: 5 }, { fen: null }, { fen: '' }]) assert.equal(B.restore(bad), null);
  const odd = [{ fen: CC.START_FEN }, { fen: CC.START_FEN, moves: 'e2e4' }, { fen: CC.START_FEN, moves: [null, 7, {}], upto: 'x' }];
  for (const s of odd) { const r = B.restore(s); assert.equal(r.steps.length, 0); assert.equal(r.upto, -1); }
  const r = B.restore({ fen: CC.START_FEN, moves: ['e2e4', 42, 'e7e5'], upto: 1.5 });
  assert.deepEqual(B.ucis(r), ['e2e4']);
  assert.equal(B.restore({ fen: CC.START_FEN, moves: ['e2e4', 'e7e5'] }).upto, 1, 'a missing upto shows the last move');
});
test('pgn writes every move of the board as a game that buildGame replays', () => {
  let b = B.fromFen();
  for (const u of ['e2e4', 'e7e5', 'g1f3']) b = B.play(b, step(b, u));
  b = B.go(b, 0); // the whole line goes in, not just up to the move shown
  const pgn = B.pgn(b, '2026.10.19');
  assert.match(pgn, /\[Date "2026\.10\.19"\]/);
  assert.doesNotMatch(pgn, /\[FEN /);
  assert.match(pgn, /\n\n1\. e4 e5 2\. Nf3 \*\n$/);
  const M = CC.buildGame({ pgn });
  assert.deepEqual(M.plies.map((p) => p.uci), ['e2e4', 'e7e5', 'g1f3']);
});
test('pgn from a FEN with Black to move carries the FEN and starts on Black\'s move', () => {
  let b = B.fromFen('4k3/8/8/8/8/8/4P3/4K3 b - - 0 40');
  for (const u of ['e8d7', 'e2e4']) b = B.play(b, step(b, u));
  const pgn = B.pgn(b, '2026.10.19');
  assert.match(pgn, /\[SetUp "1"\]\n\[FEN "4k3\/8\/8\/8\/8\/8\/4P3\/4K3 b - - 0 40"\]/);
  assert.match(pgn, /\n\n40\.\.\. Kd7 41\. e4 \*\n$/);
  const M = CC.buildGame({ pgn });
  assert.equal(M.ply0, 79); assert.deepEqual(M.plies.map((p) => p.san), ['Kd7', 'e4']);
});
