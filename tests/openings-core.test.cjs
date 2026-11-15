const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit, fixture } = require('./load.cjs');
const { openingsTsv } = require('../openings-data.cjs');
loadUnit('chess-core.js');
window.OPENINGS_TSV = openingsTsv();
loadUnit('openings-core.js');
const CC = window.ChessCore;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';

test('applySan returns the next position and the move in uci', () => {
  const r = CC.applySan(CC.posFromFen(START), 'Nf3');
  assert.equal(r.uci, 'g1f3');
  assert.equal(r.pos.turn, 'b');
});

test('applyUci returns SAN, castles, promotes, and rejects illegal moves', () => {
  let pos = CC.posFromFen(START);
  assert.equal(CC.applyUci(pos, 'e2e4').san, 'e4');
  assert.equal(CC.applyUci(pos, 'e2e5'), null);
  pos = CC.posFromFen('4k3/8/8/8/8/8/8/4K2R w');
  assert.equal(CC.applyUci(pos, 'e1g1').san, 'O-O');
  pos = CC.posFromFen('8/P6k/8/8/8/8/8/4K3 w');
  assert.equal(CC.applyUci(pos, 'a7a8q').san, 'a8=Q');
});

test('byPly and identify match Python on every fixture game', () => {
  const book = window.Openings.book();
  for (const c of fixture('openings-expected.json')) {
    assert.deepEqual(book.byPly(c.ucis), c.byPly, c.name);
    assert.deepEqual(book.identify(c.ucis), c.identify, c.name);
  }
});

// The page builds the book after the first paint; ~200–250 ms in Chromium (2026-10-16). The bound only catches a
// large regression: run beside the engine tests it measured 312 ms.
test('book builds from cold within 600 ms', () => {
  const t0 = performance.now();
  window.Openings.book({ fresh: true });
  const ms = performance.now() - t0;
  console.log(`opening book build: ${ms.toFixed(0)} ms`);
  assert.ok(ms < 600, `${ms.toFixed(0)} ms`);
});

test('positionKey keeps castling rights and only a legal en-passant square, like epd()', () => {
  const key = (u) => window.Openings.positionKey(u.split(' '));
  assert.ok(key('e2e4 g8f6 e4e5 d7d5').endsWith(' w KQkq d6'), key('e2e4 g8f6 e4e5 d7d5'));
  assert.ok(key('e2e4 d7d5').endsWith(' w KQkq -'), key('e2e4 d7d5'));
  assert.ok(key('e2e4 e7e5 e1e2 e8e7 e2e1 e7e8').endsWith(' w - -'), key('e2e4 e7e5 e1e2 e8e7 e2e1 e7e8'));
});

test('a FEN start inside the book is named', () => {
  const O = window.Openings;
  // the position after 1. e4 e5 2. Nf3 Nc6, given as a FEN, then 3. Bb5
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  assert.match(O.book().identify(['f1b5'], fen).name, /^Ruy Lopez/);
  assert.equal(O.book().byPly(['e2e4']).length, 1); // the standard start still works without a FEN
  assert.equal(O.book().identify(['e1g1'], '4k3/8/8/8/8/8/8/4K2R w - - 0 1'), null); // outside the book: no name
});

test('continuations from the start are the book first moves, most lines first', () => {
  const next = window.Openings.book().continuations([]);
  assert.deepEqual(
    next
      .slice(0, 2)
      .map((m) => m.uci)
      .sort(),
    ['d2d4', 'e2e4'],
  );
  assert.ok(next.length >= 15, next.length);
  assert.ok(
    next.every((m) => m.san && m.uci),
    'every move has SAN and UCI',
  );
  assert.equal(new Set(next.map((m) => m.uci)).size, next.length, 'no move twice');
});
test('continuations name the opening each move reaches, from moves or a FEN', () => {
  const book = window.Openings.book();
  const bb5 = book.continuations(['e2e4', 'e7e5', 'g1f3', 'b8c6']).find((m) => m.uci === 'f1b5');
  assert.match(bb5.name, /^Ruy Lopez/);
  assert.equal(bb5.san, 'Bb5');
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  assert.deepEqual(book.continuations([], fen), book.continuations(['e2e4', 'e7e5', 'g1f3', 'b8c6']));
});
test('continuations out of the book, or after an illegal move, are empty', () => {
  const book = window.Openings.book();
  assert.deepEqual(book.continuations(['e2e4', 'e7e5', 'e1e2', 'e8e7', 'e2e1', 'e7e8']), []);
  assert.deepEqual(book.continuations(['e2e5']), []);
  assert.deepEqual(book.continuations([], '4k3/8/8/8/8/8/8/4K2R w - - 0 1'), []);
});
test('name gives the position after the moves its name, the start position included', () => {
  const book = window.Openings.book();
  // a pasted FEN that is itself a book position: named with no moves played, and its moves fall back to it
  const e4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  assert.deepEqual(book.name([], e4), { eco: 'B00', name: "King's Pawn Game" });
  assert.deepEqual(book.name(['e7e5'], e4), book.identify(['e2e4', 'e7e5']));
  assert.deepEqual(book.name(['a7a6', 'h2h3', 'h7h6'], e4), book.identify(['e2e4', 'a7a6', 'h2h3', 'h7h6']));
  // the standard start isn't named; outside the book there is no name
  assert.equal(book.name([]), null);
  assert.equal(book.name([], '4k3/8/8/8/8/8/8/4K2R w - - 0 1'), null);
  // with moves from the standard start it agrees with identify
  for (const c of fixture('openings-expected.json')) assert.deepEqual(book.name(c.ucis), c.identify, c.name);
});
test('inBook tells a book position from one out of the book', () => {
  const book = window.Openings.book();
  assert.equal(book.inBook([]), true);
  assert.equal(book.inBook(['e2e4', 'c7c5']), true);
  assert.equal(book.inBook(['e2e4', 'e7e5', 'e1e2', 'e8e7', 'e2e1', 'e7e8']), false);
  assert.equal(book.inBook([], 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'), true);
  assert.equal(book.inBook([], '4k3/8/8/8/8/8/8/4K2R w - - 0 1'), false);
  assert.equal(book.inBook(['e2e5']), false);
});
