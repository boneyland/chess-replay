const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit, fixture } = require('./load.cjs');
loadUnit('chess-core.js');
loadUnit('lichess-core.js');
const LC = window.LichessCore;

// real answers from tablebase.lichess.ovh (2026-10-24)
const KBNK = fixture('tb-kbnk-win.json'); // 8/8/8/4k3/8/8/3KB3/7N w: White mates in 55 plies
const KRKR = fixture('tb-krkr-draw.json'); // 4k3/8/8/8/8/8/3RK3/7r w
const CURSED = fixture('tb-cursed-win.json'); // 8/8/8/3k4/p7/8/8/1N1NK3 w: a win the fifty-move rule draws
const MATED = fixture('tb-kqk-loss.json'); // 8/8/8/8/8/2k5/1q6/K7 w: White is mated

// a fetch that answers from a list and records what was asked
function fakeFetch(answers) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push(url);
    const a = answers.shift();
    if (a instanceof Error) throw a;
    if (a && a.wait) await new Promise((r) => { a.release = r; if (opts.signal) opts.signal.addEventListener('abort', r); });
    if (opts.signal && opts.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    const status = (a && a.status) || 200, body = a && 'body' in a ? a.body : a;
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('parseTablebase keeps the verdict, distances and moves of a real answer', () => {
  const t = LC.parseTablebase(KBNK);
  assert.equal(t.category, 'win');
  assert.equal(t.dtz, 55);
  assert.equal(t.dtm, 55);
  assert.equal(t.checkmate, false);
  assert.deepEqual(t.moves[0], { uci: 'd2e3', san: 'Ke3', category: 'loss', dtz: -54, dtm: -54, zeroing: false });
  assert.equal(t.moves.length, KBNK.moves.length);
  assert.equal(LC.parseTablebase(MATED).checkmate, true);
  assert.deepEqual(LC.parseTablebase(MATED).moves, []);
  assert.throws(() => LC.parseTablebase({ error: 'x' }));
  assert.throws(() => LC.parseTablebase(null));
});

test('verdicts in Lichess\'s words, for the side to move', () => {
  assert.equal(LC.verdict(LC.parseTablebase(KBNK), 'w'), 'White wins');
  assert.equal(LC.verdict(LC.parseTablebase(KBNK), 'b'), 'Black wins');
  assert.equal(LC.verdict(LC.parseTablebase(KRKR), 'w'), 'Draw');
  assert.equal(LC.verdict(LC.parseTablebase(CURSED), 'w'), 'Cursed win for White · drawn by the 50-move rule');
  assert.equal(LC.verdict({ category: 'blessed-loss', moves: [] }, 'b'), 'Blessed loss for Black · saved by the 50-move rule');
  assert.equal(LC.verdict({ category: 'loss', moves: [] }, 'w'), 'Black wins');
  assert.equal(LC.verdict(LC.parseTablebase(MATED), 'w'), 'Checkmate · Black wins');
  assert.equal(LC.verdict({ category: 'unknown', moves: [] }, 'w'), 'Unknown');
});

test('the eval bar: a win as a mate in moves from White\'s side, draws and cursed wins as 0.00, nothing uncertain', () => {
  assert.deepEqual(LC.bar(LC.parseTablebase(KBNK), 'w'), { cp: 10000 - 280, txt: 'TB M28' });
  assert.deepEqual(LC.bar(LC.parseTablebase(KBNK), 'b'), { cp: -(10000 - 280), txt: 'TB −M28' });
  assert.deepEqual(LC.bar({ category: 'loss', dtm: -3, moves: [] }, 'b'), { cp: 10000 - 20, txt: 'TB M2' });
  assert.deepEqual(LC.bar({ category: 'win', dtm: null, moves: [] }, 'w'), { cp: 9990, txt: 'TB 1-0' });
  assert.deepEqual(LC.bar(LC.parseTablebase(KRKR), 'w'), { cp: 0, txt: 'TB 0.00' });
  assert.deepEqual(LC.bar(LC.parseTablebase(CURSED), 'w'), { cp: 0, txt: 'TB 0.00' });
  assert.equal(LC.bar({ category: 'maybe-win', moves: [] }, 'w'), null);
  assert.equal(LC.bar(LC.parseTablebase(MATED), 'w'), null);
});

test('moves are grouped by what they get the mover, best first', () => {
  const g = LC.groups(LC.parseTablebase(KBNK));
  assert.equal(g[0].outcome, 'win');
  assert.equal(g[0].moves[0].san, 'Ke3');
  assert.equal(g[0].moves[0].mine, 'win');
  const all = g.flatMap((x) => x.moves.map((m) => m.uci)).sort(), want = KBNK.moves.map((m) => m.uci).sort();
  assert.deepEqual(all, want);
  // the cursed win's moves: the cursed ones are draws for the mover (the fifty-move rule)
  const c = LC.groups(LC.parseTablebase(CURSED));
  assert.deepEqual(c.map((x) => x.outcome), ['draw']);
  assert.ok(c[0].moves.some((m) => m.mine === 'cursed-win'));
});

test('fenOf writes castling rights, the en passant square and the fifty-move count', () => {
  const pos = window.ChessCore.posFromFen('4k3/8/8/3pP3/8/8/8/4K2R w K - 0 1');
  assert.equal(LC.fenOf({ ...pos, ep: window.ChessCore.sqIndex('d6') }), '4k3/8/8/3pP3/8/8/8/4K2R w K d6 0 1');
  assert.equal(LC.fenOf({ ...pos, castle: '', ep: -1 }, 60), '4k3/8/8/3pP3/8/8/8/4K2R w - - 60 1');
});

test('the fifty-move count is sent and keys the cache; the move number doesn\'t', async () => {
  // the real service: 8/8/8/4k3/8/8/3KB3/7N w - - 60 … is a cursed win (60 plies gone, DTZ 55)
  const f = fakeFetch([KBNK, { ...KBNK, category: 'cursed-win' }]);
  const c = LC.create({ fetchFn: f });
  assert.equal((await c.tablebase('8/8/8/4k3/8/8/3KB3/7N w - - 0 1')).category, 'win');
  assert.equal((await c.tablebase('8/8/8/4k3/8/8/3KB3/7N w - - 0 40')).category, 'win');
  assert.equal(f.calls.length, 1);
  assert.equal((await c.tablebase('8/8/8/4k3/8/8/3KB3/7N w - - 60 40')).category, 'cursed-win');
  assert.match(f.calls[1], /%20w%20-%20-%2060%2040$/);
  assert.equal(c.tablebaseCached('8/8/8/4k3/8/8/3KB3/7N w - - 60 99').category, 'cursed-win');
});

test('never asks above 7 pieces', async () => {
  const f = fakeFetch([]);
  const c = LC.create({ fetchFn: f });
  assert.equal(LC.pieceCount(window.ChessCore.START_FEN), 32);
  assert.equal(await c.tablebase(window.ChessCore.START_FEN), null);
  assert.equal(await c.tablebase('8/8/8/3k4/pppp4/8/8/1N1NK3 w - - 0 1'), null); // 8 pieces
  assert.equal(f.calls.length, 0);
});

test('a second ask for a position comes from the cache', async () => {
  const fen = '8/8/8/4k3/8/8/3KB3/7N w - - 0 1', f = fakeFetch([KBNK]);
  const c = LC.create({ fetchFn: f });
  const a = await c.tablebase(fen), b = await c.tablebase(fen);
  assert.equal(a.category, 'win');
  assert.equal(b, a);
  assert.equal(c.tablebaseCached(fen), a);
  assert.equal(c.tablebaseCached('4k3/8/8/8/8/8/3RK3/7r w - - 0 1'), undefined);
  assert.deepEqual(f.calls, ['https://tablebase.lichess.ovh/standard?fen=8%2F8%2F8%2F4k3%2F8%2F8%2F3KB3%2F7N%20w%20-%20-%200%201']);
});

test('errors answer null and aren\'t cached', async () => {
  const fen = '4k3/8/8/8/8/8/3RK3/7r w - - 0 1', f = fakeFetch([{ status: 400, body: {} }, new Error('offline'), { body: 'nonsense' }, KRKR]);
  const c = LC.create({ fetchFn: f });
  assert.equal(await c.tablebase(fen), null);
  assert.equal(await c.tablebase(fen), null);
  assert.equal(await c.tablebase(fen), null);
  assert.equal((await c.tablebase(fen)).category, 'draw');
  assert.equal(f.calls.length, 4);
});

test('a 429 backs off for a minute: nothing is sent meanwhile', async () => {
  let t = 1000;
  const fen = '4k3/8/8/8/8/8/3RK3/7r w - - 0 1', f = fakeFetch([{ status: 429, body: {} }, KRKR]);
  const c = LC.create({ fetchFn: f, now: () => t });
  assert.equal(await c.tablebase(fen), null);
  assert.equal(c.backedOff('tablebase'), true);
  t += LC.BACKOFF_MS - 1;
  assert.equal(await c.tablebase(fen), null);
  assert.equal(f.calls.length, 1);
  t += 1;
  assert.equal((await c.tablebase(fen)).category, 'draw');
  assert.equal(f.calls.length, 2);
});

test('one request at a time: the next waits, and an aborted one sends nothing', async () => {
  const slow = { wait: true, body: KBNK };
  const f = fakeFetch([slow, KRKR]);
  const c = LC.create({ fetchFn: f });
  const first = c.tablebase('8/8/8/4k3/8/8/3KB3/7N w - - 0 1');
  const ctl = new AbortController();
  const skipped = c.tablebase('8/8/8/8/8/8/2k5/K1q5 w - - 0 1', { signal: ctl.signal });
  const second = c.tablebase('4k3/8/8/8/8/8/3RK3/7r w - - 0 1');
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.length, 1); // the others wait for the first
  ctl.abort();
  slow.release();
  assert.equal((await first).category, 'win');
  assert.equal(await skipped, null);
  assert.equal((await second).category, 'draw');
  assert.equal(f.calls.length, 2);
});

// ---------- the cloud evaluation ----------
// real answers from lichess.org/api/cloud-eval (2026-10-27)
const E4 = fixture('cloud-e4-3lines.json'); // after 1.e4, multiPv=3: depth 60
const CASTLES = fixture('cloud-castles.json'); // both sides castle in the line, written e8h8 and e1h1
const CMATED = fixture('cloud-mated.json'); // 8/8/8/8/8/2k5/8/K1q5 w: Black mates in 1
const E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const CASTLES_FEN = 'r1b1k2r/pp3ppp/2n1p3/q7/1b1P4/2N2N2/PP1B1PPP/R2QKB1R w KQkq - 0 9';

test('parseCloud gives an engine result from White\'s side, its lines ranked', () => {
  const r = LC.parseCloud(E4, E4_FEN);
  assert.equal(r.source, 'cloud');
  assert.equal(r.depth, 60);
  assert.equal(r.cp, 22); // Black to move, White better: the API's scores are White's, as the page's
  assert.equal(r.nodes, 119133000);
  assert.deepEqual(r.lines.map((l) => [l.k, l.cp, l.depth]), [[1, 22, 60], [2, 27, 60], [3, 32, 60]]);
  assert.equal(r.best, 'e7e5');
  assert.deepEqual(r.pv, r.lines[0].pv);
  assert.throws(() => LC.parseCloud({ error: 'No cloud evaluation available for that position' }, E4_FEN));
  assert.throws(() => LC.parseCloud({ depth: 20, pvs: [] }, E4_FEN));
});

test('cloud mates as ±(10000 − 10·N), as the engine\'s', () => {
  const r = LC.parseCloud(CMATED, '8/8/8/8/8/2k5/8/K1q5 w - - 0 1');
  assert.equal(r.cp, -(10000 - 10));
  assert.equal(LC.parseCloud({ depth: 30, pvs: [{ moves: 'e2e4', mate: 3 }] }, window.ChessCore.START_FEN).cp, 10000 - 30);
});

test('cloud lines: the king taking its rook becomes castling, and the line stops at an illegal move', () => {
  const pv = LC.parseCloud(CASTLES, CASTLES_FEN).pv;
  assert.deepEqual(pv, ['f1d3', 'e8g8', 'a2a3', 'b4c3', 'd2c3', 'a5h5', 'd3e4', 'f8d8', 'e1g1', 'c8d7']);
  assert.deepEqual(LC.parseCloud(E4, E4_FEN).pv.slice(0, 6), ['e7e5', 'g1f3', 'b8c6', 'f1b5', 'g8f6', 'e1g1']);
  // a rook going to its own king's square is a rook move, not castling
  assert.deepEqual(LC.cloudMoves('4k3/8/8/8/8/8/8/4K2R w K - 0 1', 'h1h2 e8e7'), ['h1h2', 'e8e7']);
  assert.deepEqual(LC.cloudMoves(window.ChessCore.START_FEN, 'e2e4 e2e4 e7e5'), ['e2e4']);
});

test('the cloud\'s key leaves out the clocks and keeps the lines; the URL asks for them', () => {
  assert.equal(LC.cloudKey(CASTLES_FEN, 1), LC.cloudKey(CASTLES_FEN.replace('0 9', '17 40'), 1));
  assert.notEqual(LC.cloudKey(CASTLES_FEN, 1), LC.cloudKey(CASTLES_FEN, 3));
  assert.notEqual(LC.cloudKey(E4_FEN, 1), LC.cloudKey(E4_FEN.replace('KQkq', '-'), 1));
  assert.equal(LC.cloudUrl(E4_FEN, 3), 'https://lichess.org/api/cloud-eval?fen=' + encodeURIComponent(E4_FEN) + '&multiPv=3');
});

test('a cloud miss (404) is null and remembered: the position isn\'t asked again', async () => {
  const f = fakeFetch([{ status: 404, body: fixture('cloud-miss.json') }]);
  const c = LC.create({ fetchFn: f });
  assert.equal(c.cloudCached(E4_FEN, 1), undefined);
  assert.equal(await c.cloudEval(E4_FEN, 1), null);
  assert.equal(c.cloudCached(E4_FEN, 1), null);
  assert.equal(await c.cloudEval(E4_FEN, 1), null);
  assert.equal(f.calls.length, 1);
});

test('a cloud answer is cached by position and lines; errors aren\'t; a 429 backs the cloud off alone', async () => {
  let t = 1000;
  const f = fakeFetch([E4, new Error('offline'), { status: 429, body: {} }, KRKR]);
  const c = LC.create({ fetchFn: f, now: () => t });
  assert.equal((await c.cloudEval(E4_FEN, 3)).lines.length, 3);
  assert.equal((await c.cloudEval(E4_FEN.replace('0 1', '4 7'), 3)).depth, 60); // cached, the clocks aside
  assert.equal(c.cloudCached(E4_FEN, 3).depth, 60);
  assert.equal(await c.cloudEval(E4_FEN, 1), null); // another line count is another request: offline
  assert.equal(c.cloudCached(E4_FEN, 1), undefined);
  assert.equal(await c.cloudEval(E4_FEN, 1), null); // the 429
  assert.equal(c.backedOff('cloud'), true);
  assert.equal(c.backedOff('tablebase'), false);
  assert.equal(await c.cloudEval(E4_FEN, 1), null);
  assert.equal(f.calls.length, 3);
  assert.equal((await c.tablebase('4k3/8/8/8/8/8/3RK3/7r w - - 0 1')).category, 'draw');
  assert.ok(f.calls[0].startsWith('https://lichess.org/api/cloud-eval?fen='));
});
