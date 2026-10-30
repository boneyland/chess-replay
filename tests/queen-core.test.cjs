const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('queen-core.js');
const Q = window.QueenCore;

test('pyParse reads a Python dict repr: quotes, escapes, None/True/False, numbers, nesting', () => {
  const v = Q.pyParse(`{'best_move_uci': 'e2e4', "analysis": 'It\\'s "fine"\\nreally', 'x': None, 'ok': True, 'no': False, 'n': -1.5e2, 'l': [1, 'a', {'k': 2},], 'u': '\\u00e9\\x41\\U0001f600'}`);
  assert.deepEqual(v, { best_move_uci: 'e2e4', analysis: 'It\'s "fine"\nreally', x: null, ok: true, no: false, n: -150, l: [1, 'a', { k: 2 }], u: 'éA\u{1f600}' });
});

test('pyParse reads Python tuples as arrays, a one-element tuple included', () => {
  assert.deepEqual(Q.pyParse("{'line': ('e2e4', 'e7e5'), 'one': (1,), 'none': (), 'nest': [(1, 2), {'t': ('a',)}]}"),
    { line: ['e2e4', 'e7e5'], one: [1], none: [], nest: [[1, 2], { t: ['a'] }] });
  assert.throws(() => Q.pyParse("{'a': (1, 2}"));
});

test('pyParse throws on truncated input', () => {
  assert.throws(() => Q.pyParse("{'a': 'b"));
  assert.throws(() => Q.pyParse("{'a': 1"));
  assert.throws(() => Q.pyParse("{'a' 1}"));
  assert.throws(() => Q.pyParse("{'a': (1, 2"));
});

test('queenPayload takes JSON, a Python repr or an object, and rejects other shapes', () => {
  assert.equal(Q.queenPayload({ payload: '{"best_move_uci": "d2d4"}' }).best_move_uci, 'd2d4');
  assert.equal(Q.queenPayload({ payload: " {'analysis': 'x', 'best_move_uci': None} " }).analysis, 'x');
  assert.equal(Q.queenPayload({ analysis: 'y' }).analysis, 'y');
  assert.throws(() => Q.queenPayload({ payload: 'GPU quota exceeded' }), (e) => e.code === 'bad_answer' && e.raw === '"GPU quota exceeded"');
  assert.throws(() => Q.queenPayload({ payload: { foo: 1 } }), (e) => e.code === 'bad_answer');
});

test("queenEval turns Queen's evaluation sentence into pawns from White's side", () => {
  assert.equal(Q.queenEval('White is better by approximately 1.37 pawns.'), 1.37);
  assert.equal(Q.queenEval('White is losing by 5.24 pawns'), -5.24);
  assert.equal(Q.queenEval('Black is down about 0.5 pawns'), 0.5);
  assert.equal(Q.queenEval('Black has an edge of 0.8 pawns'), -0.8);
  assert.equal(Q.queenEval("+0.26 pawns from Black's perspective"), -0.26);
  assert.equal(Q.queenEval('Black is better by approx. 0.9 pawns'), -0.9);
  assert.equal(Q.queenEval('White is ahead by −0.3 pawns'), -0.3);
  assert.equal(Q.queenEval('The position is roughly equal.'), 0);
  assert.equal(Q.queenEval('Unclear.'), null);
  assert.equal(Q.queenEval(''), null);
});

test('queenProse keeps the analysis paragraphs and drops the labelled sections after them', () => {
  const text = 'ANALYSIS: First   paragraph\nwraps.\n\nSecond one.\nBEST_MOVE: e4\nCRITICAL_LINE: e4 e5';
  assert.deepEqual(Q.queenProse(text), ['First paragraph wraps.', 'Second one.']);
  assert.deepEqual(Q.queenProse(''), []);
});

test('readSse finds the complete event, or the error event as JSON or text', () => {
  const ok = 'event: generating\ndata: null\n\nevent: complete\ndata: [{"best_move_uci": "e2e4"}]\n\n';
  assert.deepEqual(Q.readSse(ok), { result: [{ best_move_uci: 'e2e4' }], error: null });
  const quota = 'event: error\ndata: {"error": "You have exceeded your ZeroGPU runs limit.", "title": "ZeroGPU quota"}\n\n';
  assert.equal(Q.readSse(quota).error.error, 'You have exceeded your ZeroGPU runs limit.');
  assert.deepEqual(Q.readSse('event: error\ndata: plain text\n\n'), { result: null, error: 'plain text' });
  assert.deepEqual(Q.readSse(''), { result: null, error: null });
});

test('capQueenCache drops the oldest answers until the JSON fits, keeping the newest even when it alone is too big', () => {
  const c = {}; for (let i = 0; i < 10; i++) c['k' + i] = { prose: 'x'.repeat(90) };
  assert.equal(Q.capQueenCache(c), c);
  const kept = Q.capQueenCache(c, 500);
  assert.ok(JSON.stringify(kept).length <= 500);
  assert.deepEqual(Object.keys(kept), ['k6', 'k7', 'k8', 'k9']);
  assert.deepEqual(Object.keys(Q.capQueenCache(c, 10)), ['k9']);
  assert.deepEqual(Q.capQueenCache({}, 10), {});
});

test("queenFile keeps only this game's positions, and readQueenFile reads them back", () => {
  // the shape the page caches: prose is queenProse's list of paragraphs
  const r = (prose) => ({ best: 'e2e4', bestSan: 'e4', line: '', evalText: '', evalPawns: 0, prose: [prose], seconds: 20, source: 'best_move', at: 0 });
  const cache = { '': r('start'), 'e2e4': r('one'), 'e2e4 e7e5': r('two'), 'd2d4': r('other game'), 'e2e4 e7e5 g1f3': r('after the last move') };
  const f = Q.queenFile(cache, ['e2e4', 'e7e5']);
  assert.deepEqual(Object.keys(f.answers), ['', 'e2e4', 'e2e4 e7e5']);
  assert.equal(f.moves, 'e2e4 e7e5');
  const back = Q.readQueenFile(JSON.stringify(f));
  assert.deepEqual(back['e2e4'], { ...r('one'), at: 1 });
  assert.equal(back['e2e4'].at, 1);
  assert.equal(back[''].at, 0);
});

test('readQueenFile rejects other files and drops entries that are not answers', () => {
  assert.equal(Q.readQueenFile('not json'), null);
  assert.equal(Q.readQueenFile('{"moves": []}'), null);
  require('./load.cjs').loadUnit('chess-core.js');
  assert.equal(window.ChessCore.classifyFile('a.json', JSON.stringify(Q.queenFile({}, []))), 'queen');
  const back = Q.readQueenFile(JSON.stringify({ format: 'queen-answers', version: 1, answers: { 'e2e4': { prose: 'ok' }, 'e2e4 zz': { prose: 'bad key' }, 'd2d4': { best: 'x' }, 'g1f3': null } }));
  assert.deepEqual(Object.keys(back), ['e2e4']);
});

// A saved answer is drawn on every visit, so a field of the wrong type must never reach the page
test('answers from a file or the cache keep only fields of the expected type', () => {
  const bad = { prose: ['ok', 3], best: { x: 1 }, bestSan: 5, line: { y: 2 }, evalText: { a: 1 }, evalPawns: 'x', seconds: NaN, source: [] };
  assert.deepEqual(Q.queenAnswer(bad, 2), { best: null, bestSan: null, line: '', evalText: '', evalPawns: null, prose: ['ok'], seconds: null, source: 'best_move', at: 2 });
  assert.deepEqual(Q.queenAnswer({ prose: 'one paragraph', best: 'e7e8q' }, 0).prose, ['one paragraph']);
  assert.equal(Q.queenAnswer({ prose: 'x', best: 'e2e4 e7e5' }, 0).best, null);
  assert.equal(Q.queenAnswer({ best: 'e2e4' }, 0), null);
  assert.deepEqual(Object.keys(Q.readQueenCache({ '': bad, 'e2e4': null, 'zz': { prose: [] } })), ['']);
  assert.deepEqual(Q.readQueenCache(null), {});
});

test('queenKey: the moves alone from the standard start, the start FEN in front otherwise', () => {
  const fen = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1';
  assert.equal(Q.queenKey(window.ChessCore.START_FEN, 'e2e4 e7e5'), 'e2e4 e7e5');
  assert.equal(Q.queenKey(null, ''), '');
  assert.equal(Q.queenKey(fen, ''), fen + '|');
  assert.equal(Q.queenKey(fen, 'e8d7'), fen + '|e8d7');
});

test('queen answers from a FEN start never mix with a standard game\'s', () => {
  const fen = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1';
  const ans = { prose: ['x'] };
  const cache = Q.readQueenCache({ '': ans, 'e2e4': ans, [fen + '|']: ans, [fen + '|e8d7']: ans, [fen + '|zz']: ans });
  assert.deepEqual(Object.keys(cache).sort(), ['', 'e2e4', fen + '|', fen + '|e8d7'].sort());
  assert.equal(cache[fen + '|e8d7'].at, 1);
  assert.equal(cache[fen + '|'].at, 0);
  assert.deepEqual(Object.keys(Q.queenFile(cache, ['e8d7'], fen).answers).sort(), [fen + '|', fen + '|e8d7']);
  assert.deepEqual(Object.keys(Q.queenFile(cache, ['e2e4'], window.ChessCore.START_FEN).answers).sort(), ['', 'e2e4']);
  assert.equal('start_fen' in Q.queenFile(cache, [], window.ChessCore.START_FEN), false);
  assert.equal(Q.queenFile(cache, [], fen).start_fen, fen);
});
