const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('board-core.js'); loadUnit('analysis-core.js'); loadUnit('play-core.js');
const B = window.BoardCore, P = window.PlayCore, CC = window.ChessCore;
const playAll = (b, ucis) => ucis.reduce((x, u) => B.play(x, CC.stepFromUci(B.pos(x), u)), b);

test('checkmate and stalemate', () => {
  assert.deepEqual(P.outcome(playAll(B.fromFen(), ['f2f3', 'e7e5', 'g2g4', 'd8h4'])), { result: '0-1', reason: 'checkmate' });
  const b = B.fromFen('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1');
  assert.deepEqual(P.outcome(playAll(b, ['f1f7'])), { result: '1/2-1/2', reason: 'stalemate' });
  assert.deepEqual(P.outcome(playAll(b, ['f1f8'])), { result: '1-0', reason: 'checkmate' });
  assert.equal(P.outcome(b), null);
});
test('threefold repetition, counted from the start', () => {
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  assert.equal(P.outcome(playAll(B.fromFen(), shuffle)), null, 'twice is not yet a draw');
  assert.deepEqual(P.outcome(playAll(B.fromFen(), shuffle.concat(shuffle))), { result: '1/2-1/2', reason: 'repetition' });
});
test('repetition ignores an en-passant square nobody can use', () => {
  const b = playAll(B.fromFen(), ['e2e4', 'g8f6', 'g1f3', 'f6g8', 'f3g1', 'g8f6', 'g1f3', 'f6g8', 'f3g1']);
  assert.deepEqual(P.outcome(b), { result: '1/2-1/2', reason: 'repetition' });
  // one a pawn could take on is part of the position
  const ep = CC.parseFen('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1').pos;
  assert.notEqual(P.positionKey(ep), P.positionKey({ ...ep, ep: -1 }));
});
test('the fifty-move rule counts the FEN\'s half-move clock', () => {
  const b = B.fromFen('4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80');
  assert.deepEqual(P.outcome(playAll(b, ['a1a2'])), { result: '1/2-1/2', reason: 'fifty' });
  assert.equal(P.outcome(playAll(b, ['e2e3'])), null, 'a pawn move resets it');
  // mate on the hundredth half-move is mate
  assert.deepEqual(P.outcome(playAll(B.fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 99 80'), ['a1a8'])), { result: '1-0', reason: 'checkmate' });
});
test('insufficient material, and what still counts as mating material', () => {
  assert.deepEqual(P.outcome(playAll(B.fromFen('4k3/8/8/8/8/8/3r4/3BK3 w - - 0 1'), ['e1d2'])), { result: '1/2-1/2', reason: 'material' });
  const pos = (fen) => CC.parseFen(fen).pos;
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), 'w'), false, 'a lone king');
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/8/3NK3 w - - 0 1'), 'w'), false, 'K+N against K');
  assert.equal(P.canMate(pos('4k2n/8/8/8/8/8/8/3NK3 w - - 0 1'), 'w'), true, 'K+N against K+N');
  assert.equal(P.canMate(pos('4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1'), 'w'), false, 'bishops on one colour');
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1'), 'w'), true, 'bishops on both colours');
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'), 'w'), true, 'a pawn');
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), 'w'), true, 'a rook');
  assert.equal(P.outcome(playAll(B.fromFen('4k2n/8/8/8/8/8/8/3NK3 w - - 0 1'), ['e1e2'])), null, 'K+N against K+N plays on');
});

// a game played from a list of [uci, ms] moves
const game = (tc, moves, fen) => moves.reduce((b, [u, at]) => P.move(b, CC.stepFromUci(B.pos(b), u), at), P.start(B.fromFen(fen), tc, '2026.10.19'));

test('a new game: no moves, full clocks, stopped until the first move', () => {
  const g = P.start(B.fromFen(), '10+0', '2026.10.19');
  assert.deepEqual(g.game, { mode: 'human', id: g.game.id, tc: '10+0', date: '2026.10.19', clock: { left: { w: 600000, b: 600000 }, since: null, clk: [] }, result: null });
  assert.equal(P.inProgress(g), true);
  assert.equal(P.timeLeft(g, 'w', 99999), 600000, 'not running before the first move');
  assert.equal(P.start(B.fromFen(), null).game.clock, null);
  // a FEN that is already mate is a finished game
  assert.deepEqual(P.start(B.fromFen('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1'), null).game.result, { result: '1-0', reason: 'checkmate' });
});
test('clocks start with the first move and add the increment', () => {
  const g = game('5+0', [['e2e4', 1000], ['e7e5', 4000]]);
  assert.deepEqual(g.game.clock.clk, [300000, 297000]);
  assert.equal(g.game.clock.since, 4000);
  assert.equal(P.timeLeft(g, 'w', 6000), 298000, 'White\'s clock runs');
  assert.equal(P.timeLeft(g, 'b', 6000), 297000);
  const h = game('15+10', [['e2e4', 0], ['e7e5', 5000], ['g1f3', 7000]]);
  assert.deepEqual(h.game.clock.clk, [910000, 905000, 918000]);
});
test('a flag fall loses unless the opponent can\'t mate', () => {
  const g = game('5+0', [['e1d1', 0]], '4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  assert.equal(P.flag(g, 299999), g, 'still in time');
  assert.deepEqual(P.flag(g, 300000).game.result, { result: '1-0', reason: 'time', side: 'b' });
  assert.equal(P.flag(g, 300000).game.clock.left.b, 0);
  // Black, with a rook, flags against a lone king: a draw; White flagging against the rook loses
  const k = game('5+0', [['e1e2', 0]], '4k3/8/8/8/8/8/8/4K2r w - - 0 1');
  assert.deepEqual(P.flag(k, 300000).game.result, { result: '1/2-1/2', reason: 'time', side: 'b' });
  const kw = P.move(k, CC.stepFromUci(B.pos(k), 'h1h2'), 1000);
  assert.deepEqual(P.flag(kw, 400000).game.result, { result: '0-1', reason: 'time', side: 'w' });
  // a move made after the flag fell doesn't count
  const late = P.move(k, CC.stepFromUci(B.pos(k), 'h1h2'), 300001);
  assert.equal(late.steps.length, 1); assert.equal(late.game.result.reason, 'time');
});
test('takebacks only in a game in progress', () => {
  const g = game('15+10', [['e2e4', 0], ['e7e5', 5000]]);
  const t = P.takeback(g, 8000);
  assert.deepEqual(B.ucis(t), ['e2e4']); assert.equal(t.upto, 0);
  assert.equal(B.pos(t).turn, 'b');
  assert.deepEqual(t.game.clock.clk, [910000]);
  assert.deepEqual(t.game.clock.left, { w: 907000, b: 905000 - 10000 }, 'White\'s time used stays used; Black\'s increment goes');
  assert.equal(t.game.clock.since, 8000);
  const none = P.takeback(t, 9000);
  assert.equal(none.steps.length, 0); assert.equal(none.game.clock.since, null, 'every move taken back stops the clocks');
  assert.deepEqual(none.game.clock.left, { w: 907000 - 10000, b: 895000 - 1000 }, 'no time comes back, however far back');
  assert.equal(P.takeback(none, 9000), none);
  const mate = game(null, [['f2f3', 0], ['e7e5', 0], ['g2g4', 0], ['d8h4', 0]]);
  assert.equal(mate.game.result.reason, 'checkmate');
  assert.equal(P.takeback(mate, 0), mate);
  const resigned = P.resign(g, 6000);
  assert.equal(P.takeback(resigned, 7000), resigned);
});
test('resign: the side to move resigns, and its clock stops', () => {
  const r = P.resign(game('5+0', [['e2e4', 0]]), 2500);
  assert.deepEqual(r.game.result, { result: '1-0', reason: 'resign', side: 'b' });
  assert.equal(r.game.clock.left.b, 297500); assert.equal(r.game.clock.since, null);
  assert.equal(P.move(r, CC.stepFromUci(B.pos(r), 'e7e5'), 3000), r, 'no moves after the end');
  assert.deepEqual(P.resultText(r.game.result), { score: '1–0', why: 'Black resigned' });
  assert.deepEqual(P.resultText({ result: '1/2-1/2', reason: 'time', side: 'w' }), { score: '½–½', why: 'White’s flag fell, but Black can’t mate' });
});
test('the presets: 5+3 adds 3 s a move; a game stored at 5+0 (the preset before it) keeps its clock, an unknown one loses it', () => {
  assert.deepEqual(P.TIME_CONTROLS, ['5+3', '10+0', '15+10', '30+0']);
  const g = game('5+3', [['e2e4', 0], ['e7e5', 4000]]);
  assert.deepEqual(g.game.clock.clk, [303000, 299000]);
  const back = (tc) => B.restore(JSON.parse(JSON.stringify(B.save({ ...g, game: { ...g.game, tc } })))).game;
  assert.equal(back('5+3').tc, '5+3');
  assert.equal(back('5+0').tc, '5+0');
  assert.deepEqual([back('1+0').tc, back('1+0').clock], [null, null]);
});

test('resume pauses the clocks and trims what doesn\'t fit', () => {
  const g = game('5+0', [['e2e4', 0], ['e7e5', 4000]]);
  const back = B.restore(JSON.parse(JSON.stringify(B.save(g))));
  assert.deepEqual(back.game, { ...g.game, clock: { ...g.game.clock, since: null } });
  assert.equal(P.timeLeft(back, 'w', 1e9), 300000, 'paused');
  const odd = B.restore({ fen: CC.START_FEN, moves: ['e2e4', 'e2e4'], upto: 0, game: { mode: 'human', tc: '5+0', date: 'x', clock: { left: { w: 'x' }, clk: [1, 2, 3], since: 5 }, result: { result: '1-0', reason: 'checkmate' } } });
  assert.equal(odd.steps.length, 1); assert.equal(odd.upto, 0);
  assert.deepEqual(odd.game.clock, { left: { w: 300000, b: 300000 }, since: null, clk: [1] });
  assert.equal(odd.game.result, null, 'a result the moves don\'t give is dropped');
  assert.match(odd.game.date, /^\d{4}\.\d\d\.\d\d$/);
  assert.equal(B.restore({ fen: CC.START_FEN, moves: [], upto: -1, game: 'junk' }).game, undefined);
  // a game in progress shows its last move
  assert.equal(B.restore({ ...B.save(g), upto: -1 }).upto, 1);
});
test('the PGN has the result, the time control and the clocks', () => {
  const g = P.resign(game('10+0', [['e2e4', 0], ['e7e5', 2000], ['g1f3', 3500]]), 9000);
  const text = P.pgn(g);
  assert.match(text, /\[Event "Play vs human"\]/); assert.match(text, /\[Date "2026\.10\.19"\]/);
  assert.match(text, /\[Result "1-0"\]/); assert.match(text, /\[TimeControl "600\+0"\]/); assert.match(text, /\[Termination "normal"\]/);
  // the clocks as an annotated game writes them (ChessCore.pgnClk): tenths kept
  assert.match(text, /1\. e4 \{\[%clk 0:10:00\]\} 1\.\.\. e5 \{\[%clk 0:09:58\]\} 2\. Nf3 \{\[%clk 0:09:58\.5\]\} 1-0/);
  const M = CC.buildGame({ pgn: text });
  assert.equal(M.plies.length, 3); assert.equal(M.hasClock, true); assert.equal(M.result, '1-0');
  const f = P.pgn(P.start(B.fromFen('4k3/8/8/8/8/8/4P3/4K3 b - - 0 40'), null, '2026.10.19'));
  assert.match(f, /\[SetUp "1"\]\n\[FEN "4k3\/8\/8\/8\/8\/8\/4P3\/4K3 b - - 0 40"\]/); assert.match(f, /\n\n\*\n$/);
  assert.doesNotMatch(f, /TimeControl|Termination/);
});
test('a draw by agreement ends the game and survives a reload', () => {
  const g = game('5+0', [['e2e4', 0], ['e7e5', 3000]]);
  const d = P.agreeDraw(g, 5000);
  assert.deepEqual(d.game.result, { result: '1/2-1/2', reason: 'agreement' });
  assert.equal(d.game.clock.left.w, 298000); assert.equal(d.game.clock.since, null);
  assert.equal(P.agreeDraw(d, 6000), d, 'only in a game in progress');
  assert.deepEqual(P.resultText(d.game.result), { score: '½–½', why: 'Draw by agreement' });
  assert.deepEqual(B.restore(JSON.parse(JSON.stringify(B.save(d)))).game.result, d.game.result);
  assert.match(P.pgn(d), /\[Result "1\/2-1\/2"\][\s\S]*\[Termination "normal"\][\s\S]* 1\/2-1\/2\n$/);
});

// a Stockfish game played from a list of [uci, ms] moves
const sfGame = (you, tc, moves, fen) => moves.reduce((b, [u, at]) => P.move(b, CC.stepFromUci(B.pos(b), u), at), P.start(B.fromFen(fen), tc, '2026.10.21', { mode: 'stockfish', you }));

test('a Stockfish game carries the player\'s side and an empty critique; vs human stays as it was', () => {
  const g = P.start(B.fromFen(), null, '2026.10.21', { mode: 'stockfish', you: 'b' });
  assert.deepEqual(g.game, { mode: 'stockfish', you: 'b', id: g.game.id, tc: null, date: '2026.10.21', clock: null, result: null, critique: [] });
  assert.equal(P.start(B.fromFen(), null, null, { mode: 'stockfish' }).game.you, 'w', 'White by default');
  const h = P.start(B.fromFen(), null, '2026.10.21', { mode: 'human', you: 'b' });
  assert.deepEqual(Object.keys(h.game).sort(), ['clock', 'date', 'id', 'mode', 'result', 'tc']);
});
test('a Stockfish takeback goes back to the player\'s turn, one of the player\'s moves gone', () => {
  const g = sfGame('w', '15+10', [['e2e4', 0], ['e7e5', 5000], ['g1f3', 7000], ['b8c6', 9000]]);
  assert.equal(P.canTakeback(g), true);
  const t = P.takeback(g, 12000);
  assert.deepEqual(B.ucis(t), ['e2e4', 'e7e5'], 'its reply and the player\'s move');
  assert.equal(B.pos(t).turn, 'w'); assert.equal(t.upto, 1);
  assert.deepEqual(t.game.clock.clk, [910000, 905000]);
  assert.deepEqual(t.game.clock.left, { w: 918000 - 3000 - 10000, b: 913000 - 10000 }, 'each removed move\'s increment goes; White\'s 3 s since stays used');
  assert.equal(t.game.clock.since, 12000);
  // while Stockfish thinks, only the player's move goes
  const thinking = sfGame('w', null, [['e2e4', 0], ['e7e5', 0], ['g1f3', 0]]);
  assert.deepEqual(B.ucis(P.takeback(thinking, 0)), ['e2e4', 'e7e5']);
  // the last of the player's moves: back to the start
  const first = P.takeback(sfGame('w', '5+0', [['e2e4', 0], ['e7e5', 1000]]), 2000);
  assert.equal(first.steps.length, 0); assert.equal(first.game.clock.since, null);
  assert.equal(P.canTakeback(first), false); assert.equal(P.takeback(first, 3000), first);
});
test('as Black, Stockfish\'s first move alone can\'t be taken back; from a FEN with Black to move, sides come from the positions', () => {
  const g = sfGame('b', null, [['e2e4', 0]]);
  assert.equal(P.canTakeback(g), false); assert.equal(P.takeback(g, 0), g);
  const h = sfGame('b', null, [['e2e4', 0], ['e7e5', 0], ['g1f3', 0]]);
  assert.deepEqual(B.ucis(P.takeback(h, 0)), ['e2e4'], 'back to Black\'s turn, Stockfish\'s first move kept');
  const fen = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1', f = sfGame('b', null, [['e8d7', 0], ['e1d1', 0]], fen);
  assert.equal(P.canTakeback(f), true);
  assert.equal(P.takeback(f, 0).steps.length, 0, 'Black moved first, so both go');
  const fw = sfGame('w', null, [['e8d7', 0]], fen);
  assert.equal(P.canTakeback(fw), false, 'only Stockfish (Black) has moved');
  assert.equal(P.canTakeback(P.resign(h, 0)), false, 'not after the end');
});
test('thinkMs: 3 s without a clock, a share of Stockfish\'s time left with one, at least 0.1 s', () => {
  assert.equal(P.thinkMs(sfGame('w', null, [['e2e4', 0]]), 0), 3000);
  const g = sfGame('w', '5+0', [['e2e4', 0]]);
  assert.equal(P.thinkMs(g, 0), 3000, '300 s / 30 is over the cap');
  const low = { ...g, game: { ...g.game, clock: { ...g.game.clock, left: { w: 300000, b: 30000 }, since: 0 } } };
  assert.equal(P.thinkMs(low, 0), 1000);
  assert.equal(P.thinkMs(low, 27000), 100, 'its clock runs while it thinks');
  const inc = sfGame('b', '15+10', []);
  assert.equal(P.thinkMs({ ...inc, game: { ...inc.game, clock: { ...inc.game.clock, left: { w: 3000, b: 1000 } } } }, 0), 3000, 'half the increment');
});
test('critique: only the player\'s moves, once each, dropped with their moves, kept through a reload', () => {
  const g = sfGame('w', null, [['e2e4', 0], ['e7e5', 0], ['d1h5', 0], ['b8c6', 0]]);
  const c = P.addCritique(g, { j: 2, cls: 'mistake', best: 'g1f3' });
  assert.deepEqual(c.game.critique, [{ j: 2, cls: 'mistake', best: 'g1f3' }]);
  assert.equal(P.addCritique(c, { j: 2, cls: 'blunder', best: 'g1f3' }), c, 'once per move');
  assert.equal(P.addCritique(c, { j: 1, cls: 'blunder', best: 'g8f6' }), c, 'Stockfish\'s move');
  assert.equal(P.addCritique(c, { j: 4, cls: 'blunder', best: 'g8f6' }), c, 'not on the board');
  assert.equal(P.addCritique(c, { j: 0, cls: 'good', best: 'd2d4' }), c);
  const human = game(null, [['e2e4', 0]]);
  assert.equal(P.addCritique(human, { j: 0, cls: 'mistake', best: 'd2d4' }), human);
  const ended = P.addCritique(P.resign(c, 0), { j: 0, cls: 'inaccuracy', best: 'd2d4' });
  assert.deepEqual(ended.game.critique.map((x) => x.j), [2, 0], 'a rating after the end still lands');
  assert.deepEqual(P.takeback(c, 0).game.critique, [], 'taken back with its move');
  const back = B.restore(JSON.parse(JSON.stringify(B.save(ended))));
  assert.deepEqual(back.game, ended.game);
  // a Black player's moves, from a FEN with Black to move
  const f = sfGame('b', null, [['e8d7', 0], ['e1d1', 0]], '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1');
  assert.equal(P.addCritique(f, { j: 0, cls: 'blunder', best: 'e8f7' }).game.critique.length, 1);
  assert.equal(P.addCritique(f, { j: 1, cls: 'blunder', best: 'e1f1' }), f);
});
test('resume a Stockfish game: the side, and a critique that fits the moves', () => {
  const g = sfGame('b', '5+0', [['e2e4', 0], ['e7e5', 1000], ['g1f3', 2000]]);
  const saved = B.save(g);
  const critique = [{ j: 1, cls: 'blunder', best: 'c7c5' }, { j: 1, cls: 'mistake', best: 'c7c5' }, { j: 0, cls: 'mistake', best: 'd2d4' }, { j: 3, cls: 'mistake', best: 'b8c6' },
    { j: 1.5, cls: 'mistake', best: 'a7a6' }, { j: 1, cls: 'awful', best: 'a7a6' }, { j: 1, cls: 'mistake', best: 'nope' }, null, 'x'];
  const back = B.restore({ ...saved, game: { ...saved.game, you: 'x', critique } });
  assert.equal(back.game.mode, 'stockfish'); assert.equal(back.game.you, 'w', 'a bad side reads as White');
  assert.deepEqual(back.game.critique, [{ j: 0, cls: 'mistake', best: 'd2d4' }], 'only White\'s moves now');
  const asBlack = B.restore({ ...saved, game: { ...saved.game, critique } });
  assert.deepEqual(asBlack.game.critique, [{ j: 1, cls: 'blunder', best: 'c7c5' }]);
  assert.deepEqual(B.restore({ ...saved, game: { ...saved.game, critique: 'junk' } }).game.critique, []);
  assert.equal(B.restore({ ...saved, game: { ...saved.game, mode: 'other' } }).game, undefined);
});
test('critique text: critiqueText\'s line is kept with its move and through a reload, a bad one dropped', () => {
  const g = sfGame('w', null, [['e2e4', 0], ['e7e5', 0], ['d1h5', 0], ['b8c6', 0]]);
  const c = P.addCritique(g, { j: 2, cls: 'mistake', best: 'g1f3', text: 'that drops the queen' });
  assert.deepEqual(c.game.critique, [{ j: 2, cls: 'mistake', best: 'g1f3', text: 'that drops the queen' }]);
  assert.deepEqual(P.addCritique(g, { j: 2, cls: 'mistake', best: 'g1f3', text: 'x'.repeat(121) }).game.critique, [{ j: 2, cls: 'mistake', best: 'g1f3' }], 'too long');
  assert.deepEqual(P.addCritique(g, { j: 2, cls: 'mistake', best: 'g1f3', text: 7 }).game.critique, [{ j: 2, cls: 'mistake', best: 'g1f3' }]);
  assert.deepEqual(B.restore(JSON.parse(JSON.stringify(B.save(c)))).game.critique, c.game.critique);
  const saved = B.save(c);
  assert.deepEqual(B.restore({ ...saved, game: { ...saved.game, critique: [{ j: 2, cls: 'mistake', best: 'g1f3', text: {} }] } }).game.critique, [{ j: 2, cls: 'mistake', best: 'g1f3' }]);
});
test('resign: against Stockfish the player can resign while it is to move', () => {
  const g = sfGame('w', '5+0', [['e2e4', 0]]);
  assert.deepEqual(P.resign(g, 1000, 'w').game.result, { result: '0-1', reason: 'resign', side: 'w' });
  assert.equal(P.resign(g, 1000, 'w').game.clock.left.b, 299000, 'the running clock is charged');
  assert.deepEqual(P.resign(g, 1000).game.result.side, 'b', 'the side to move by default');
});
test('critiqueText: a piece dropped in the reply line, a mate allowed, else a line for the class', () => {
  const after = (fen, u) => CC.applyUci(CC.parseFen(fen).pos, u).pos;
  // 1. e4 e5 2. ... d6, and Qg4?? hangs the queen to ...Bxg4
  const q = after('rnbqkbnr/ppp2ppp/3p4/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', 'd1g4');
  assert.equal(P.critiqueText(q, ['c8g4'], 'w', 'blunder', false), 'that drops the queen');
  assert.equal(P.critiqueText(q, ['g8f6', 'g4c8'], 'w', 'blunder', false), 'that should lose', 'a line that wins Black\'s bishop drops nothing');
  // a knight for a pawn: the knight is named
  const n = after('4k3/8/3p4/8/8/8/8/4K1N1 w - - 0 1', 'g1f3');
  assert.equal(P.critiqueText(CC.parseFen('4k3/8/8/3p4/4N3/8/8/4K3 b - - 0 1').pos, ['d5e4'], 'w', 'mistake', false), 'that drops the knight');
  assert.equal(P.critiqueText(n, ['e8d7'], 'w', 'mistake', false), 'that gives Stockfish the edge');
  // a piece not won back is a drop, an even trade isn't; a pawn is "a pawn"
  const gone = CC.parseFen('4k3/8/8/3p4/4N3/5N2/8/4K3 b - - 0 1').pos;
  assert.equal(P.critiqueText(gone, ['d5e4', 'f3d4'], 'w', 'inaccuracy', false), 'that drops the knight', 'not won back');
  const pawn = CC.parseFen('4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1').pos;
  assert.equal(P.critiqueText(pawn, ['d5e4'], 'w', 'inaccuracy', false), 'that drops a pawn');
  const even = CC.parseFen('4k3/8/8/3p4/4P3/8/5N2/4K3 b - - 0 1').pos;
  assert.equal(P.critiqueText(even, ['d5e4', 'f2e4'], 'w', 'inaccuracy', false), 'there was a better move', 'a pawn each');
  // en passant counts; an illegal move ends the line
  const ep = CC.parseFen('4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 1').pos;
  assert.equal(P.critiqueText(ep, ['d5e6'], 'b', 'mistake', false), 'that drops a pawn');
  assert.equal(P.critiqueText(pawn, ['a1a2', 'd5e4'], 'w', 'mistake', false), 'that gives Stockfish the edge');
  assert.equal(P.critiqueText(n, ['e8d7'], 'w', 'blunder', true), 'that allows mate');
  assert.equal(P.critiqueText(q, ['c8g4'], 'w', 'blunder', true), 'that drops the queen', 'the piece first');
  // only four plies count
  assert.equal(P.critiqueText(pawn, ['e8d8', 'e1d1', 'd8e8', 'd1e1', 'd5e4'], 'w', 'mistake', false), 'that gives Stockfish the edge');
});
test('a Stockfish game\'s PGN names the players', () => {
  const w = P.pgn(sfGame('w', null, [['e2e4', 0]]));
  assert.match(w, /\[Event "Play vs Stockfish"\][\s\S]*\[White "You"\]\n\[Black "Stockfish 19"\]/);
  const b = P.pgn(sfGame('b', null, [['e2e4', 0]]));
  assert.match(b, /\[White "Stockfish 19"\]\n\[Black "You"\]/);
  assert.equal(CC.buildGame({ pgn: b }).plies.length, 1);
});
test('a reload charges the running clock for the time away; a game opened from My games runs from then', () => {
  const g = game('5+0', [['e2e4', 1000], ['e7e5', 4000]]);
  const saved = JSON.parse(JSON.stringify(B.save(g)));
  const back = B.restore(saved, 10000);
  assert.deepEqual(back.game.clock, g.game.clock);
  assert.equal(P.timeLeft(back, 'w', 10000), 300000 - 6000);
  const late = B.restore(saved, 4000 + 300001);
  assert.equal(P.flag(late, 4000 + 300001).game.result.reason, 'time', 'a flag that fell while away');
  assert.equal(B.restore(saved).game.clock.since, null, 'without now, stopped');
  assert.equal(B.restore(saved, 3000).game.clock.since, 3000, 'a start after now is not trusted: it runs from now');
  const opened = P.runClock(B.restore(saved), 50000);
  assert.equal(opened.game.clock.since, 50000);
  assert.equal(P.timeLeft(opened, 'w', 52000), 300000 - 2000, 'the time away isn\'t charged, the time since is');
  assert.equal(P.runClock(opened, 60000), opened, 'a running clock is left alone');
  // left for another board: charged up to then and stopped, so Resume goes on from there
  const left = P.pause(g, 9000);
  assert.deepEqual(left.game.clock.left, { w: 300000 - 5000, b: 297000 }); assert.equal(left.game.clock.since, null);
  assert.equal(P.timeLeft(P.runClock(left, 99999), 'w', 99999 + 1000), 300000 - 6000);
  assert.equal(P.pause(left, 10000), left, 'a stopped clock is left alone');
  assert.equal(P.pause(g, 4000 + 300001).game.result.reason, 'time', 'a flag that fell before leaving');
  const fresh = P.start(B.fromFen(), '5+0');
  assert.equal(P.runClock(fresh, 1), fresh, 'no moves: the clocks wait for the first');
  const done = B.restore(JSON.parse(JSON.stringify(B.save(P.resign(g, 5000)))), 9000);
  assert.equal(done.game.clock.since, null);
});
test('vs human: threefold and fifty moves are claimed; fivefold and 75 moves end the game', () => {
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const three = game(null, shuffle.concat(shuffle).map((u) => [u, 0]));
  assert.equal(three.game.result, null);
  assert.equal(P.claimable(three), 'repetition');
  assert.equal(P.claimable(game(null, shuffle.map((u) => [u, 0]))), null);
  const c = P.claimDraw(three, 0);
  assert.deepEqual(c.game.result, { result: '1/2-1/2', reason: 'repetition' });
  assert.equal(P.claimDraw(c, 0), c); assert.equal(P.claimable(c), null);
  assert.deepEqual(B.restore(JSON.parse(JSON.stringify(B.save(c)))).game.result, c.game.result, 'a claimed draw survives a reload');
  const fake = { ...B.save(game(null, [['e2e4', 0]])), game: { ...c.game } };
  assert.equal(B.restore(fake).game.result, null, 'a claim the moves don\'t allow is dropped');
  const five = game(null, shuffle.concat(shuffle, shuffle, shuffle).map((u) => [u, 0]));
  assert.deepEqual(five.game.result, { result: '1/2-1/2', reason: 'fivefold' });
  const fen = '4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80';
  const fifty = game(null, [['a1a2', 0]], fen);
  assert.equal(fifty.game.result, null); assert.equal(P.claimable(fifty), 'fifty');
  const sf = sfGame('w', null, [['a1a2', 0]], fen);
  assert.deepEqual(sf.game.result, { result: '1/2-1/2', reason: 'fifty' }, 'against Stockfish they stay automatic');
  assert.equal(P.claimable(sf), null);
  const seventy = game(null, [['a1a2', 0]], '4k3/8/8/8/8/8/4P3/R3K3 w - - 149 80');
  assert.deepEqual(seventy.game.result, { result: '1/2-1/2', reason: 'seventyfive' });
  assert.deepEqual(P.resultText(seventy.game.result), { score: '½–½', why: 'Draw by the 75-move rule' });
});
test('a dead position behind locked pawns ends the game; one a king can break into plays on', () => {
  const dead = (fen) => P.lockedDead(CC.parseFen(fen).pos);
  // four locked pairs: every square between the chains is guarded, so neither king gets through
  assert.equal(dead('8/8/1k6/p1p1p1p1/P1P1P1P1/8/4K3/8 w - - 0 1'), true);
  assert.equal(dead('8/8/1k6/p1p1p1p1/P1P1P1P1/8/4K3/8 b - - 0 1'), true);
  // the h-file pair gone: g4 is free, and White's king walks in to take g5's neighbour
  assert.equal(dead('8/8/1k6/p1p1p3/P1P1P3/8/4K3/8 w - - 0 1'), false);
  // a pawn that can still move, a capture on offer, a piece besides the pawns, no pawns at all
  assert.equal(dead('8/8/1k6/p1p1p1p1/P1P1P1P1/8/4K2P/8 w - - 0 1'), false);
  assert.equal(dead('8/8/1k6/p1p1p1p1/P1P1PPP1/8/4K3/8 w - - 0 1'), false);
  assert.equal(dead('8/8/1k6/p1p1p1p1/P1P1P1P1/8/4K3/5N2 w - - 0 1'), false);
  assert.equal(dead('8/8/1k6/8/8/8/4K3/8 w - - 0 1'), false);
  // an enemy pawn behind the line that a king reaches: not dead (it could take it and free a pawn)
  assert.equal(dead('8/8/1k6/p1p1p1p1/P1P1P1P1/7p/4K2P/8 w - - 0 1'), false);
  // the move that locks the last pair ends a game, vs human and against Stockfish alike
  const g = game('5+3', [['g3g4', 1000]], '8/8/1k6/p1p1p1p1/P1P1P3/6P1/4K3/8 w - - 0 1');
  assert.deepEqual(g.game.result, { result: '1/2-1/2', reason: 'dead' });
  assert.equal(g.game.clock.since, null);
  assert.deepEqual(P.resultText(g.game.result), { score: '½–½', why: 'Draw: dead position, neither side can mate' });
  assert.deepEqual(sfGame('w', null, [['g3g4', 0]], '8/8/1k6/p1p1p1p1/P1P1P3/6P1/4K3/8 w - - 0 1').game.result.reason, 'dead');
  // and stays ended through a reload
  assert.deepEqual(B.restore(JSON.parse(JSON.stringify(B.save(g)))).game.result, g.game.result);
  // a double step that locks the last pair but can be taken en passant: hxg3 e.p. opens the h-file, so play goes on
  const ep = game(null, [['g2g4', 0]], '8/8/1k6/p1p1p1p1/P1P1P2p/7P/4K1P1/8 w - - 0 1');
  assert.equal(ep.game.result, null);
  assert.equal(dead('8/8/1k6/p1p1p1p1/P1P1P1Pp/7P/4K3/8 b - g3 0 1'), false);
  // an en-passant square no pawn can take on changes nothing (a2a4 just played, no black pawn beside it)
  assert.equal(dead('8/8/1k6/p1p1p1p1/P1P1P1P1/8/4K3/8 b - a3 0 1'), true);
});
test('a dead position with bishops of one colour: none can take a pawn, and the king they face always has a square', () => {
  const dead = (fen) => P.lockedDead(CC.parseFen(fen).pos);
  // from a game: Black's dark bishop can't touch White's light-square pawns, and the kings can't cross
  assert.equal(dead('4k3/4b3/8/p1p1p1p1/P1P1P1P1/8/7K/8 b - - 0 29'), true);
  assert.deepEqual(game(null, [['g1h2', 0]], '4k3/4b3/8/p1p1p1p1/P1P1P1P1/8/8/6K1 w - - 0 1').game.result, { result: '1/2-1/2', reason: 'dead' });
  // the game's own last move, 29. Kxh2 taking Black's rook, ends it
  assert.deepEqual(game('30+0', [['h1h2', 0]], '4k3/4b3/8/p1p1p1p1/P1P1P1P1/8/7r/7K w - - 0 29').game.result, { result: '1/2-1/2', reason: 'dead' });
  // the bishop never gets past its own pawns on a5, c5, e5 and g5, the only dark squares through to White's side
  assert.equal(dead('4k3/4b3/8/p1p1p1p1/P1P1P1P1/8/8/K7 b - - 0 1'), true);
  // White's light-square bishop can't touch Black's dark-square pawns
  assert.equal(dead('4k3/8/8/p1p1p1p1/P1P1P1P1/8/7K/5B2 w - - 0 1'), true);
  // a bishop that can reach an enemy pawn on its colour
  assert.equal(dead('4k3/3b4/8/p1p1p1p1/P1P1P1P1/8/7K/8 b - - 0 1'), false);
  // bishops on both colours
  assert.equal(dead('4k3/4b3/8/p1p1p1p1/P1P1P1P1/8/7K/5B2 w - - 0 1'), false);
  // Black's dark bishop on White's side can check White's king, but it always has a light square to step to and Black's
  // king can't come to help
  assert.equal(dead('8/8/1k6/p1p1p1p1/P1P1P1P1/8/4K3/2b5 w - - 0 1'), true);
});

test('a Stockfish game rates a move at depth 15, and short of it only a blunder of a piece or more from depth 8', () => {
  const rate = (bcp, bd, acp, ad, you = 'w', playedIsBest = false) => P.rateMove({ before: { cp: bcp, depth: bd }, after: { cp: acp, depth: ad }, you, playedIsBest, isCheckmate: false });
  // 1. Qc4?? in WebKit on GitHub Actions: mate found before it, Stockfish's 3 s reply only depth 12
  assert.equal(rate(9990, 202, -900, 12), 'blunder', 'a hanging queen at depth 12');
  assert.equal(rate(30, 20, -9980, 9), 'blunder', 'walking into a mate at depth 9');
  assert.equal(rate(-30, 20, 900, 12, 'b'), 'blunder', 'from Black\'s side too');
  assert.equal(rate(30, 20, -900, 7), null, 'below depth 8 nothing is rated');
  assert.equal(rate(30, 14, -150, 14), null, 'a blunder under a piece waits for depth 15');
  assert.equal(rate(30, 14, -40, 14), null, 'so does a mistake');
  assert.equal(rate(30, 20, -40, 15), 'inaccuracy', 'at depth 15 anything is rated');
  assert.equal(rate(30, 15, -150, 16), 'blunder');
  assert.equal(rate(30, 16, 28, 16), 'best');
  assert.equal(rate(30, 20, -900, 12, 'w', true), null, 'the best move is never a blunder');
  assert.equal(P.rateMove({ before: null, after: { cp: 0, depth: 20 }, you: 'w' }), null, 'no search before it');
  assert.equal(P.rateMove({ before: { cp: null, depth: 20 }, after: { cp: 0, depth: 20 }, you: 'w' }), null);
});

// chasolver's answers reach PlayCore through a prover: (pos, color) → true (color can't mate), false, or null (unknown)
const LOCK = '4k3/8/8/1p1p1p1p/1P1P1P1P/8/8/4K1N1 w - - 0 1'; // a knight: not lockedDead's to prove
const keyOf = (pos) => CC.toFen(pos);
const proverFrom = (table) => (pos, c) => { const v = table[keyOf(pos)]; return v ? v[c] : null; };
const afterNf3 = (b) => keyOf(B.pos(playAll(b, ['g1f3'])));

test('a position the prover calls dead for both sides ends the game as a dead draw', (t) => {
  t.after(() => P.setProver(null));
  const g = P.start(B.fromFen(LOCK), '5+3', '2026.11.02');
  P.setProver(proverFrom({ [afterNf3(g)]: { w: true, b: true } }));
  const after = P.move(g, CC.stepFromUci(B.pos(g), 'g1f3'), 1000);
  assert.deepEqual(after.game.result, { result: '1/2-1/2', reason: 'dead' });
  assert.equal(after.game.clock.since, null);
});

test('unknown, or unwinnable for one side only, plays on', (t) => {
  t.after(() => P.setProver(null));
  const g = P.start(B.fromFen(LOCK), null, '2026.11.02');
  for (const v of [null, { w: true, b: false }, { w: true, b: null }]) {
    P.setProver(v ? proverFrom({ [afterNf3(g)]: v }) : () => null);
    assert.equal(P.move(g, CC.stepFromUci(B.pos(g), 'g1f3'), 1000).game.result, null);
  }
  P.setProver(null);
  assert.equal(P.move(g, CC.stepFromUci(B.pos(g), 'g1f3'), 1000).game.result, null);
});

test('a flag fall is a draw when the prover says the opponent can\'t mate', (t) => {
  t.after(() => P.setProver(null));
  // after Nf3 Black flags; White has a knight and pawns, so canMate alone calls it a loss
  const black = game('5+0', [['g1f3', 0]], LOCK);
  const last = keyOf(B.pos(black)); // Black to move, Black flags
  assert.deepEqual(P.flag(black, 300001).game.result, { result: '1-0', reason: 'time', side: 'b' });
  P.setProver(proverFrom({ [last]: { w: true, b: false } }));
  assert.deepEqual(P.flag(black, 300001).game.result, { result: '1/2-1/2', reason: 'time', side: 'b' });
  P.setProver(proverFrom({ [last]: { w: false, b: true } }));
  assert.deepEqual(P.flag(black, 300001).game.result, { result: '1-0', reason: 'time', side: 'b' });
  P.setProver(proverFrom({ [last]: { w: null, b: null } }));
  assert.deepEqual(P.flag(black, 300001).game.result, { result: '1-0', reason: 'time', side: 'b' });
});

test('a side proven unable to mate stays so: a later flag fall or dead draw reads earlier proofs', (t) => {
  t.after(() => P.setProver(null));
  const g = game('5+0', [['g1f3', 0], ['e8d8', 0], ['f3g5', 0]], LOCK);
  const afterNf3 = keyOf(B.pos(B.go(g, 0))), afterKd8 = keyOf(B.pos(B.go(g, 1)));
  assert.deepEqual(P.flag(g, 300001).game.result, { result: '1-0', reason: 'time', side: 'b' });
  // White proven unable after Nf3; the position now has no answer yet
  P.setProver(proverFrom({ [afterNf3]: { w: true, b: null } }));
  assert.deepEqual(P.flag(g, 300001).game.result, { result: '1/2-1/2', reason: 'time', side: 'b' });
  assert.equal(P.outcome(g), null, 'only one side proven');
  P.setProver(proverFrom({ [afterNf3]: { w: true, b: null }, [afterKd8]: { w: null, b: true } }));
  assert.deepEqual(P.outcome(g), { result: '1/2-1/2', reason: 'dead' }, 'each side proven in a different position');
});

test('recheck ends a game whose position the prover has since called dead', (t) => {
  t.after(() => P.setProver(null));
  const g0 = P.start(B.fromFen(LOCK), '5+3', '2026.11.02');
  const g1 = P.move(g0, CC.stepFromUci(B.pos(g0), 'g1f3'), 1000);
  const g2 = P.move(g1, CC.stepFromUci(B.pos(g1), 'e8d8'), 3000);
  assert.equal(P.recheck(g2, 4000), g2, 'nothing proven: unchanged');
  // the answer for the position after Nf3 came late; the position now is dead too
  P.setProver(proverFrom({ [keyOf(B.pos(g2))]: { w: true, b: true } }));
  const r = P.recheck(g2, 4000);
  assert.deepEqual(r.game.result, { result: '1/2-1/2', reason: 'dead' });
  assert.equal(r.game.clock.since, null);
  assert.equal(r.game.clock.left.w, g2.game.clock.left.w - 1000, 'the side to move charged to now');
  assert.equal(r.steps.length, g2.steps.length);
  // a finished game is left alone
  assert.equal(P.recheck(r, 5000), r);
});

test('a dead position\'s text', () => {
  assert.deepEqual(P.resultText({ result: '1/2-1/2', reason: 'dead' }), { score: '½–½', why: 'Draw: dead position, neither side can mate' });
});

test('the Moves list\'s last word: the game\'s result, else the position\'s end, else the PGN\'s', () => {
  const pos = (fen) => CC.parseFen(fen).pos;
  assert.deepEqual(P.ending({ r: { result: '1-0', reason: 'resign', side: 'b' } }), { score: '1–0', why: 'Black resigned' });
  assert.deepEqual(P.ending({ r: { result: '0-1', reason: 'time', side: 'w' } }), { score: '0–1', why: 'White’s flag fell' });
  assert.deepEqual(P.ending({ r: { result: '1/2-1/2', reason: 'dead' } }), { score: '½–½', why: 'Dead position' });
  const mate = pos('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), mated = pos('5Q1k/8/6K1/8/8/8/8/8 b - - 0 1');
  assert.deepEqual(P.ending({ pos: mated }), { score: '1–0', why: 'Checkmate' });
  assert.deepEqual(P.ending({ pos: mate }), { score: '½–½', why: 'Stalemate' });
  // stalemate and dead at once: stalemate ends the game first
  const both = pos('R7/8/8/8/1p6/1P2p3/p1K1P3/k7 b - - 0 2');
  assert.deepEqual(P.ending({ pos: both, dead: true }), { score: '½–½', why: 'Stalemate' });
  assert.deepEqual(P.ending({ pos: pos('8/8/4k3/8/8/4K3/8/8 w - - 0 1') }), { score: '½–½', why: 'Insufficient material' });
  const going = pos('2b1k3/8/8/1p1p1p1p/1P1P1P1P/8/3B4/4K3 b - - 0 1');
  assert.deepEqual(P.ending({ pos: going, dead: true }), { score: '½–½', why: 'Dead position' });
  assert.equal(P.ending({ pos: going }), null, 'not proven dead: the game goes on');
  assert.equal(P.ending({ pos: CC.parseFen(CC.START_FEN).pos }), null);
  // a loaded game: the position's end where it gives the PGN's result, else the Termination, else who won
  assert.deepEqual(P.ending({ pos: mated, pgn: { result: '1-0' } }), { score: '1–0', why: 'Checkmate' });
  assert.deepEqual(P.ending({ pos: mated, pgn: { result: '*' } }), { score: '1–0', why: 'Checkmate' });
  const start = CC.parseFen(CC.START_FEN).pos;
  assert.equal(P.ending({ pos: start, pgn: { result: '*' } }), null);
  assert.deepEqual(P.ending({ pos: start, pgn: { result: '1-0' } }), { score: '1–0', why: 'White wins' });
  assert.deepEqual(P.ending({ pos: start, pgn: { result: '0-1', termination: 'Black won by resignation' } }), { score: '0–1', why: 'White resigned' });
  assert.deepEqual(P.ending({ pos: start, pgn: { result: '1-0', termination: 'Time forfeit' } }), { score: '1–0', why: 'Black’s flag fell' });
  assert.deepEqual(P.ending({ pos: start, pgn: { result: '1/2-1/2', termination: 'Game drawn by agreement' } }), { score: '½–½', why: 'Draw agreed' });
  assert.deepEqual(P.ending({ pos: start, pgn: { result: '1/2-1/2' } }), { score: '½–½', why: 'Draw' });
});

test('fiftyRule: a note from the FEN\'s half-move clock once a draw can be claimed', () => {
  const at = (fen) => P.fiftyRule(fen, CC.parseFen(fen).pos);
  assert.equal(at('8/1k6/p3p2p/PpK1Pp1P/2p2P2/2P5/2P5/8 w - - 99 70'), null, 'not yet at 99');
  const w = at('8/1k6/p3p2p/PpK1Pp1P/2p2P2/2P5/2P5/8 w - - 107 70');
  assert.equal(w.head, 'Fifty-move rule');
  assert.match(w.note, /^53 moves without a capture or pawn move: the side to move can claim a draw/);
  assert.equal(at('4k3/8/8/8/8/8/4P3/R3K3 w - - 150 100').head, '75-move rule · ½–½');
  assert.equal(at('7k/5Q2/6K1/8/8/8/8/8 b - - 120 90'), null, 'stalemate ends the game first');
  assert.equal(at('7k/6Q1/6K1/8/8/8/8/8 b - - 120 90'), null, 'so does checkmate');
});

// Play from this position: a game that keeps the moves shown on the board (game.from of them) and plays on after them
test('a game from a position keeps the moves up to the one shown, and its clocks start there', () => {
  const b = B.go(playAll(B.fromFen(), ['e2e4', 'e7e5', 'g1f3', 'b8c6']), 2);
  const g = P.start(b, '5+3', '2026.11.04', { keep: true });
  assert.deepEqual(g.steps.map((s) => s.uci), ['e2e4', 'e7e5', 'g1f3'], 'moves after the one shown are dropped');
  assert.equal(g.upto, 2);
  assert.equal(g.game.from, 3);
  assert.equal(P.played(g), 0);
  assert.equal(g.game.clock.since, null, 'stopped until the first move of the game');
  assert.equal(P.canTakeback(g), false, 'nothing of the game to take back');
  assert.equal(P.start(b, null).game.from, undefined, 'without keep, the start as before');
  assert.equal(P.start(b, null).steps.length, 0);
});
test('a game from a position: takebacks stop where it began, clocks and critique count its own moves', () => {
  const b = playAll(B.fromFen(), ['e2e4', 'e7e5']);
  let g = P.start(b, '5+3', '2026.11.04', { keep: true });
  g = P.move(g, CC.stepFromUci(B.pos(g), 'g1f3'), 1000);
  assert.equal(P.played(g), 1);
  assert.deepEqual(g.game.clock.clk, [303000]);
  assert.equal(P.canTakeback(g), true);
  const back = P.takeback(g, 2000);
  assert.equal(back.steps.length, 2);
  assert.equal(back.game.clock.since, null, 'every move of the game taken back: the clocks stop again');
  assert.equal(P.canTakeback(back), false, 'the moves before the game stay');
  assert.equal(P.takeback(back, 3000), back);
  // against Stockfish, as Black: White's earlier move isn't the player's, and the player's first move is step 2
  let s = P.start(B.fromFen(), null, '2026.11.04', { mode: 'stockfish', you: 'b' });
  s = P.start(playAll(B.fromFen(), ['e2e4', 'e7e5', 'g1f3']), null, '2026.11.04', { mode: 'stockfish', you: 'b', keep: true });
  assert.equal(P.canTakeback(s), false, 'Black played e7e5 before the game');
  assert.equal(P.addCritique(s, { j: 1, cls: 'blunder', best: 'c7c5' }), s, 'no critique of a move before the game');
  s = P.move(s, CC.stepFromUci(B.pos(s), 'b8c6'), 1000);
  s = P.addCritique(s, { j: 3, cls: 'mistake', best: 'g8f6' });
  assert.equal(s.game.critique.length, 1);
  s = P.move(s, CC.stepFromUci(B.pos(s), 'f1b5'), 2000);
  const sb = P.takeback(s, 3000);
  assert.equal(sb.steps.length, 3);
  assert.deepEqual(sb.game.critique, []);
});
test('a game from a position: its PGN has the earlier moves, the clocks on its own, and it survives a reload', () => {
  let g = P.start(playAll(B.fromFen(), ['e2e4', 'e7e5']), '5+3', '2026.11.04', { keep: true });
  g = P.move(g, CC.stepFromUci(B.pos(g), 'g1f3'), 1000);
  g = P.move(g, CC.stepFromUci(B.pos(g), 'b8c6'), 2000);
  const pgn = P.pgn(g);
  assert.match(pgn, /1\. e4 e5 2\. Nf3 \{\[%clk 0:05:03\]\} 2\.\.\. Nc6 \{\[%clk 0:05:02\]\}/);
  const r = B.restore(B.save(g));
  assert.equal(r.game.from, 2);
  assert.deepEqual(r.game.clock.clk, g.game.clock.clk);
  assert.equal(P.played(r), 2);
  // a stored from past the moves is clamped; a bad one is dropped
  assert.equal(B.restore({ ...B.save(g), game: { ...g.game, from: 9 } }).game.from, 4);
  assert.equal(B.restore({ ...B.save(g), game: { ...g.game, from: 'x' } }).game.from, undefined);
  // a game whose earlier moves already repeat: the repetition counts them
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  let h = P.start(playAll(B.fromFen(), shuffle.concat(['g1f3', 'g8f6', 'f3g1'])), null, null, { keep: true });
  h = P.move(h, CC.stepFromUci(B.pos(h), 'f6g8'), 1000);
  assert.equal(h.game.result, null);
  assert.equal(P.claimable(h), 'repetition', 'the third time counts the two before the game');
});
test('a game stepped back to an earlier move: the clocks, flag, moves and resign go by its last position', () => {
  let g = game('5+3', [['e2e4', 1000], ['e7e5', 2000], ['g1f3', 3000]]);
  const back = B.go(g, 0);
  assert.equal(B.pos(back).turn, 'b', 'shown: the position after 1. e4');
  // Black is to move in the game; its clock runs, White's doesn't
  assert.equal(P.timeLeft(back, 'b', 4000), P.timeLeft(g, 'b', 4000));
  assert.equal(P.timeLeft(back, 'w', 4000), g.game.clock.left.w);
  assert.equal(P.resign(back, 4000).game.result.side, 'b');
  assert.equal(P.flag(back, 1e9).game.result.side, 'b');
  // a move made while stepped back goes after the last move
  const m = P.move(back, CC.stepFromUci(B.pos(g), 'b8c6'), 4000);
  assert.deepEqual(m.steps.map((s) => s.uci), ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
  assert.equal(m.upto, 3);
  assert.deepEqual(P.takeback(back, 4000).steps.map((s) => s.uci), ['e2e4', 'e7e5']);
});
