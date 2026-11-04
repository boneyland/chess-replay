const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('board-core.js'); loadUnit('edit-core.js'); loadUnit('import-core.js');
const I = window.ImportCore, E = window.EditCore;

test('empty text asks for something', () => {
  for (const t of ['', '   \n ', null]) assert.match(I.read(t).error, /Paste a PGN or FEN/);
});
test('a FEN is a setup, legal or not', () => {
  const r = I.read('  rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1 ');
  assert.equal(E.toFen(r.setup), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  const bad = I.read('8/8/8/8/8/8/8/8 w - - 0 1');
  assert.ok(bad.setup); assert.equal(E.ok(bad.setup), false);
  assert.ok(I.read('4k3/8/8/8/8/8/8/4K3').setup, 'placement alone');
  assert.ok(I.read('[FEN "4k3/8/8/8/8/8/8/4K3 b - - 0 40"]').setup, 'a lone FEN tag');
});
test('a malformed FEN says so', () => {
  assert.match(I.read('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w').error, /isn't a FEN/);
  assert.match(I.read('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w HAha - 0 1').error, /Chess960/);
});
test('a PGN is kept as pasted', () => {
  const pgn = '[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 *';
  assert.deepEqual(I.read('\n' + pgn + '\n'), { pgn });
  assert.deepEqual(I.read('1. e4 e5'), { pgn: '1. e4 e5' });
  const tagged = '[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. O-O *';
  assert.deepEqual(I.read(tagged), { pgn: tagged }, 'a [FEN] tag with moves is a game');
});
test('text that is neither gets the PGN reader\'s message', () => {
  const r = I.read('hello there');
  assert.equal(typeof r.error, 'string'); assert.ok(r.error.length);
  assert.ok(I.read('1. e4 e5 2. Ke3 Ke6').error, 'an illegal move');
});
