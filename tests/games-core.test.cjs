const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('board-core.js'); loadUnit('play-core.js'); loadUnit('games-core.js');
const B = window.BoardCore, P = window.PlayCore, G = window.GamesCore, CC = window.ChessCore;
const playAll = (b, ucis, now = 0) => ucis.reduce((x, u) => P.move(x, CC.stepFromUci(B.pos(x), u), now), b);
const game = (ucis, tc = null) => playAll(P.start(B.fromFen(), tc), ucis);

test('a game has an id, kept through a reload', () => {
  const a = P.start(B.fromFen(), null), b = P.start(B.fromFen(), null);
  assert.match(a.game.id, /^[\w-]+$/);
  assert.notEqual(a.game.id, b.game.id);
  const g = playAll(a, ['e2e4']);
  assert.equal(B.restore(B.save(g)).game.id, a.game.id);
  const { id, ...old } = g.game;
  assert.match(B.restore({ ...B.save(g), game: old }).game.id, /^[\w-]+$/, 'a game stored before ids gets one');
});
test('a game is kept from its first move, newest first, updated in place', () => {
  const g = P.start(B.fromFen(), null);
  assert.deepEqual(G.keep([], g, 1), [], 'no moves, not kept');
  let list = G.keep([], playAll(g, ['e2e4']), 1);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].board.moves, ['e2e4']);
  const h = game(['d2d4']);
  list = G.keep(list, h, 2);
  assert.deepEqual(list.map((e) => e.id), [h.game.id, g.game.id]);
  list = G.keep(list, playAll(g, ['e2e4', 'e7e5']), 3);
  assert.deepEqual(list.map((e) => e.id), [g.game.id, h.game.id], 'the game played last comes first');
  assert.deepEqual(list[0].board.moves, ['e2e4', 'e7e5']);
  assert.equal(list.length, 2);
});
test('taking every move back drops an untimed game, keeps a timed one (its clocks run on); a board without a game changes nothing', () => {
  const g = game(['e2e4']);
  const list = G.keep([], g, 1);
  assert.deepEqual(G.keep(list, P.takeback(g, 2), 2), []);
  assert.equal(G.keep(list, B.fromFen(), 3), list);
  const t = game(['e2e4'], '5+0'), back = P.takeback(t, 2);
  assert.equal(P.played(back), 0); assert.equal(P.begun(back), true);
  const kept = G.keep(G.keep([], t, 1), back, 2);
  assert.deepEqual(kept.map((e) => e.id), [t.game.id]);
  assert.deepEqual(G.read(JSON.stringify(kept)).map((e) => e.id), [t.game.id], 'and read back with no moves');
  const open = G.playable(JSON.parse(JSON.stringify(kept[0])));
  assert.ok(open, 'it opens from My games'); assert.equal(open.steps.length, 0);
  assert.equal(P.begun(P.start(B.fromFen(), '5+0')), false, 'a new game hasn\'t begun');
});
test('the list keeps the newest 50', () => {
  let list = [];
  for (let i = 0; i < 55; i++) list = G.keep(list, game(['e2e4']), i);
  assert.equal(list.length, G.KEEP);
  assert.equal(list[0].updated, 54);
  assert.equal(G.read(JSON.stringify(list)).length, 50);
});
test('remove', () => {
  const a = game(['e2e4']), b = game(['d2d4']);
  const list = G.keep(G.keep([], a, 1), b, 2);
  assert.deepEqual(G.remove(list, a.game.id).map((e) => e.id), [b.game.id]);
});
test('read keeps what restores and drops the rest, whatever was stored', () => {
  const mate = game(['f2f3', 'e7e5', 'g2g4', 'd8h4']), live = game(['e2e4'], '5+0');
  const list = G.keep(G.keep([], mate, 1), live, 2);
  const back = G.read(JSON.stringify(list));
  assert.deepEqual(back, list);
  const r = B.restore(back[1].board);
  assert.deepEqual(r.game.result, { result: '0-1', reason: 'checkmate' });
  assert.equal(B.restore(back[0].board).game.clock.left.w, 300000);
  for (const raw of [null, '', 'nope', '{}', '[1, null, "x"]', JSON.stringify([{ id: 'a', updated: 1, board: { fen: 'bad' } }])]) assert.deepEqual(G.read(raw), [], String(raw));
  const noGame = { id: 'x', updated: 3, board: B.save(playAll(B.fromFen(), [])) };
  const wrongId = { ...list[0], id: 'other', updated: 4 };
  const twice = { ...list[1], updated: 0 };
  assert.deepEqual(G.read(JSON.stringify([noGame, wrongId, list[0], list[1], twice])).map((e) => e.id), [live.game.id, mate.game.id]);
  assert.deepEqual(G.read(JSON.stringify([list[1], list[0]])).map((e) => e.id), [live.game.id, mate.game.id], 'sorted newest first');
});
test('read checks only the shape, so a game that no longer restores is kept in storage; playable leaves it out', () => {
  const g = game(['e2e4', 'e7e5']), [e] = G.keep([], g, 1);
  assert.equal(G.playable(e).game.id, g.game.id);
  const odd = { ...e, board: { ...e.board, fen: 'not a fen' } };
  assert.deepEqual(G.read(JSON.stringify([odd])), [odd]);
  assert.equal(G.playable(odd), null);
  assert.equal(G.playable({ ...e, id: 'other' }), null);
});
test('a kept game opens as a PGN the replay reads', () => {
  const mate = game(['f2f3', 'e7e5', 'g2g4', 'd8h4'], '10+0');
  const [e] = G.read(JSON.stringify(G.keep([], mate, 1)));
  const M = CC.buildGame({ pgn: P.pgn(B.restore(e.board)), gameIndex: 0 });
  assert.equal(M.plies.length, 4);
  assert.equal(M.result, '0-1');
});
test('a Stockfish game is kept and playable, its side and critique with it', () => {
  let g = playAll(P.start(B.fromFen(), '5+0', '2026.10.21', { mode: 'stockfish', you: 'b' }), ['e2e4', 'e7e5', 'g1f3']);
  g = P.addCritique(g, { j: 1, cls: 'mistake', best: 'c7c5' });
  const [e] = G.read(JSON.stringify(G.keep([], g, 1)));
  assert.equal(e.id, g.game.id);
  const back = G.playable(e);
  assert.equal(back.game.mode, 'stockfish'); assert.equal(back.game.you, 'b');
  assert.deepEqual(back.game.critique, [{ j: 1, cls: 'mistake', best: 'c7c5' }]);
  assert.deepEqual(B.ucis(back), ['e2e4', 'e7e5', 'g1f3']);
  assert.match(P.pgn(back), /\[White "Stockfish 19"\]\n\[Black "You"\]/);
});

test('an unreadable stored list reads as empty but says so, so a write can set it aside first', () => {
  for (const raw of [null, '', '[]', JSON.stringify([{ id: 'x' }])]) assert.equal(G.readable(raw), true, String(raw));
  for (const raw of ['{', '{"a":1}', '"text"']) {
    assert.equal(G.readable(raw), false, raw);
    assert.deepEqual(G.read(raw), []);
  }
});

test('read keeps a Chess960 entry with its number', () => {
  const g = playAll(P.start(B.fromFen(CC.chess960Fen(612), { chess960: 612 }), null), ['e2e4']);
  const list = G.keep([], g, 5);
  assert.equal(list[0].board.chess960, 612);
  const back = G.read(JSON.stringify(list));
  assert.equal(back[0].board.chess960, 612);
  assert.equal(G.playable(back[0]).chess960, 612);
});
