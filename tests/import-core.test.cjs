const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('lichess-core.js'); loadUnit('board-core.js'); loadUnit('edit-core.js'); loadUnit('import-core.js');
const I = window.ImportCore, E = window.EditCore;

test('empty text asks for something', () => {
  for (const t of ['', '   \n ', null]) assert.match(I.read(t).error, /Paste a PGN, a FEN or a Lichess link/);
});
test('a FEN is a setup, legal or not', () => {
  const r = I.read('  rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1 ');
  assert.equal(E.toFen(r.setup), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  const bad = I.read('8/8/8/8/8/8/8/8 w - - 0 1');
  assert.ok(bad.setup); assert.equal(E.ok(bad.setup), false);
  assert.ok(I.read('4k3/8/8/8/8/8/8/4K3').setup, 'placement alone');
  assert.ok(I.read('[FEN "4k3/8/8/8/8/8/8/4K3 b - - 0 40"]').setup, 'a lone FEN tag');
  assert.equal(E.toFen(I.read('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w HAha - 0 1').setup), window.ChessCore.START_FEN, 'Shredder-FEN rights');
});
test('a malformed FEN says so', () => {
  assert.match(I.read('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w').error, /isn't a FEN/);
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
test('a Lichess link is a link', () => {
  assert.equal(I.read(' https://lichess.org/q7ZvsdUF/black#32\n').link.id, 'q7ZvsdUF');
  assert.equal(I.read('lichess.org/broadcast/t/r/IKZUMzM4').link.kind, 'list');
  assert.match(I.read('https://lichess.org/analysis').error, /isn’t a Lichess game/);
  assert.match(I.read('https://example.com/x').error, /isn’t a Lichess game/);
});

test('a variant game is refused, naming it', () => {
  assert.match(I.read('[Variant "Crazyhouse"]\n[Result "1-0"]\n\n1. e4 d5 2. exd5 1-0').error, /That’s a Crazyhouse game: only standard chess opens here/);
  assert.deepEqual(I.read('[Variant "Standard"]\n\n1. e4 *'), { pgn: '[Variant "Standard"]\n\n1. e4 *' });
});
test('pgn: a fetched PGN is checked as a pasted one, before anything opens', () => {
  assert.deepEqual(I.pgn('[Result "1-0"]\n\n1. e4 1-0'), { pgn: '[Result "1-0"]\n\n1. e4 1-0' });
  assert.ok(I.pgn('[Result "1-0"]\n\n1. e5 1-0').error, 'an illegal move');
  assert.match(I.pgn('[Variant "Atomic"]\n[Result "1-0"]\n\n1. e4 1-0').error, /Atomic game/, 'refused even when it would build');
});
