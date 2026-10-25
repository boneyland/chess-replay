const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('board-core.js'); loadUnit('edit-core.js');
const E = window.EditCore, CC = window.ChessCore;
const setup = (fen) => { const r = E.fromFen(fen); assert.ok(r.setup, `${fen}: ${r.error}`); return r.setup; };
const sq = (s) => CC.sqIndex(s);

test('empty and start', () => {
  assert.equal(E.toFen(E.empty()), '8/8/8/8/8/8/8/8 w - - 0 1');
  assert.equal(E.toFen(E.start()), CC.START_FEN);
});
test('fromFen loads an illegal but well-formed position', () => {
  for (const f of ['8/8/8/8/8/8/8/8 b - - 0 1', 'P7/8/8/8/8/8/8/K6k w - - 0 1', '4k3/8/8/8/8/8/8/K2KR3 w - - 0 1']) assert.ok(E.fromFen(f).setup, f);
  assert.equal(E.toFen(setup('4k3/8/8/8/8/8/8/K2KR3 w - - 0 1')), '4k3/8/8/8/8/8/8/K2KR3 w - - 0 1');
});
test('fromFen refuses malformed text', () => {
  for (const f of ['', 'rnbqkbnr/pppppppp', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w', '8/8/8/8/8/8/8/8 x - - 0 1']) {
    const r = E.fromFen(f);
    assert.equal(r.setup, undefined, f); assert.equal(typeof r.error, 'string', f);
  }
  const s = setup('[FEN "4k3/8/8/8/8/8/8/4K3 b - - 0 40"]');
  assert.equal(s.turn, 'b'); assert.equal(s.full, 40);
});
test('unsupported castling is dropped, not refused', () => {
  assert.equal(setup('4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1').castle, '');
  assert.equal(setup('r3k3/8/8/8/8/8/8/4K2R w KQkq - 0 1').castle, 'Kq');
});
test('put and move drop rights and en passant', () => {
  const s = E.start();
  assert.equal(E.put(s, sq('h1'), null).castle, 'Qkq');
  assert.equal(E.move(s, sq('e1'), sq('e2')).castle, 'kq');
  const e = setup('4k3/8/8/3pP3/8/8/8/4K3 w - d6 3 20');
  assert.equal(e.ep, 19);
  const p = E.put(e, sq('a1'), 'R');
  assert.equal(p.ep, -1); assert.equal(p.half, 3); assert.equal(p.full, 20);
  assert.equal(E.setTurn(e, 'b').ep, -1);
});
test('castling boxes', () => {
  assert.equal(E.canCastle(E.empty(), 'K'), false);
  assert.equal(E.setCastle(E.empty(), 'K', true).castle, '');
  const s = E.setCastle(E.start(), 'Q', false);
  assert.equal(s.castle, 'Kkq');
  assert.equal(E.setCastle(s, 'Q', true).castle, 'KQkq');
});
test('problems, each message', () => {
  assert.deepEqual(E.problems(E.empty()), ['White has no king.', 'Black has no king.']);
  assert.deepEqual(E.problems(setup('kk6/8/8/8/8/8/8/K7 w - - 0 1')), ['Black has 2 kings.']);
  assert.deepEqual(E.problems(setup('4k3/8/8/8/8/8/8/P3K3 w - - 0 1')), ["The pawn on a1 can't stand on the first or last rank."]);
  assert.deepEqual(E.problems(setup('4k3/4R3/8/8/8/8/8/4K3 w - - 0 1')), ["Black is in check, but it's White's turn."]);
  assert.deepEqual(E.problems(setup('4k3/8/8/8/8/8/8/4K3 w - - 0 1')), []);
});
test('impossible checks', () => {
  assert.deepEqual(E.problems(setup('4r2k/8/8/b7/8/3n4/8/4K3 w - - 0 1')), ['White is in check from 3 pieces, which no move can give.']);
  assert.deepEqual(E.problems(setup('7k/8/8/8/8/8/8/r3K2r w - - 0 1')), ['White is in check from two pieces in a line, which no move can give.']);
  assert.deepEqual(E.problems(setup('4r2k/8/8/8/8/5n2/8/4K3 w - - 0 1')), []);
});
test('ok means parseFen accepts it', () => {
  for (const s of [E.start(), setup('4r2k/8/8/8/8/5n2/8/4K3 w - - 0 1'), setup('4k3/8/8/8/8/8/8/4K3 b - - 0 1')]) {
    assert.ok(E.ok(s));
    assert.doesNotThrow(() => CC.parseFen(E.toFen(s)));
  }
  assert.equal(E.ok(E.empty()), false);
  assert.equal(E.isEmpty(E.empty()), true); assert.equal(E.isEmpty(E.start()), false);
});
test('setups are never mutated', () => {
  const s = E.start(), f = E.toFen(s);
  E.put(s, 0, null); E.move(s, 52, 36); E.setTurn(s, 'b'); E.setCastle(s, 'K', false);
  assert.equal(E.toFen(s), f);
});
test('ChessCore.checkers lists the checking pieces', () => {
  const s = setup('4r2k/8/8/8/8/5n2/8/4K3 w - - 0 1');
  assert.deepEqual(CC.checkers(s.b, 'w').sort((a, b) => a - b), [sq('e8'), sq('f3')].sort((a, b) => a - b));
  assert.deepEqual(CC.checkers(E.empty().b, 'w'), []);
});
