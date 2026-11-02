const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('sfx-core.js');
const X = window.Sfx;

test('kinds: a move or a capture, then a check on checks and mates', () => {
  assert.deepEqual(X.kinds('Nf3'), ['move']);
  assert.deepEqual(X.kinds('O-O'), ['move']);
  assert.deepEqual(X.kinds('exd5'), ['capture']);
  assert.deepEqual(X.kinds('Qxf7#'), ['capture', 'check']);
  assert.deepEqual(X.kinds('e8=Q+'), ['move', 'check']);
  assert.deepEqual(X.kinds(''), ['move']);
});

test('endKind: decisive results ring victory, draws ring draw, unfinished games nothing', () => {
  assert.equal(X.endKind('1-0'), 'victory');
  assert.equal(X.endKind('0-1'), 'victory');
  assert.equal(X.endKind('1/2-1/2'), 'draw');
  assert.equal(X.endKind('*'), null);
  assert.equal(X.endKind(undefined), null);
});

// three plies starting at 1, 2 and 3 s, each taking 0.5 s to land
const S = { N: 3, tp: [1, 2, 3], md: [0.5, 0.5, 0.5] };
test('landed: the last ply whose piece has reached its square', () => {
  assert.equal(X.landed(0, S), -1);
  assert.equal(X.landed(1.2, S), -1); // still moving
  assert.equal(X.landed(1.5, S), 0);
  assert.equal(X.landed(2.9, S), 1);
  assert.equal(X.landed(9, S), 2);
});

const M = { result: '1-0', plies: [{ san: 'e4' }, { san: 'exd5' }, { san: 'Qh5#' }] };
test('cue: the sound of the move now on the board, and the end of the game when playback reaches it', () => {
  assert.equal(X.cue(M, 0, 0, true), null);
  assert.equal(X.cue(M, 0, -1, false), null); // back to the start position
  assert.deepEqual(X.cue(M, -1, 0, true), { kinds: ['move'], end: null });
  assert.deepEqual(X.cue(M, 0, 1, false), { kinds: ['capture'], end: null });
  assert.deepEqual(X.cue(M, 2, 1, false), { kinds: ['capture'], end: null }); // stepping back plays the move now shown
  assert.deepEqual(X.cue(M, 1, 2, true), { kinds: ['move', 'check'], end: 'victory' });
  assert.deepEqual(X.cue(M, 1, 2, false), { kinds: ['move', 'check'], end: null }); // stepping onto the last move
  assert.deepEqual(X.cue({ ...M, result: '*' }, 1, 2, true), { kinds: ['move', 'check'], end: null });
});

test('every set but the built-in one has its five sound files', () => {
  assert.equal(X.SETS[0], 'Lichess sfx'); // the default, also for a stored set that no longer exists
  assert.equal(X.soundUrl('Lichess lisp', 'victory'), 'sounds/lisp/Victory.mp3');
  assert.equal(X.soundUrl('Lichess NES', 'move'), 'sounds/nes/Move.mp3');
  assert.equal(X.soundUrl('Wood', 'move'), null);
  assert.equal(X.soundUrl('Gone', 'move'), null);
  assert.deepEqual(X.SETS.filter((s) => s !== 'Wood').map((s) => X.SET_DIR[s]).sort(), ['futuristic', 'lisp', 'nes', 'piano', 'sfx']);
  assert.deepEqual(X.KINDS, ['move', 'capture', 'check', 'victory', 'draw']);
});

test('fetchSound: the bytes, or null for a missing file or no connection', async () => {
  const was = global.fetch, bytes = new ArrayBuffer(4);
  try {
    global.fetch = async (u) => (u === 'ok' ? { ok: true, arrayBuffer: async () => bytes } : { ok: false });
    assert.equal(await X.fetchSound('ok'), bytes);
    assert.equal(await X.fetchSound('gone'), null);
    global.fetch = async () => { throw new TypeError('Failed to fetch'); };
    assert.equal(await X.fetchSound('ok'), null);
  } finally { global.fetch = was; }
});

test('exportSet: a non-commercial set is swapped for the default in exports, the others kept', () => {
  assert.deepEqual(X.NON_COMMERCIAL, ['Lichess lisp']);
  assert.equal(X.exportSet('Lichess lisp'), 'Lichess sfx');
  for (const s of X.SETS.filter((s) => s !== 'Lichess lisp')) assert.equal(X.exportSet(s), s);
  assert.equal(X.exportSet('Gone'), 'Lichess sfx');
});

test('synth: every Wood sound is short, audible, never clips, and the same every time', () => {
  for (const k of X.KINDS) {
    const a = X.synth(k, 48000), b = X.synth(k, 48000);
    assert.ok(a instanceof Float32Array, k);
    assert.ok(a.length > 48000 * 0.05 && a.length <= 48000 * 1.6, `${k}: ${a.length} samples`);
    let peak = 0;
    for (const v of a) { assert.ok(Number.isFinite(v), k); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > 0.2 && peak <= 0.9, `${k}: peak ${peak}`);
    assert.ok(Math.abs(a[a.length - 1]) < 1e-3, `${k} ends in silence`);
    assert.deepEqual(a, b, k);
  }
  assert.throws(() => X.synth('nope', 48000));
});

test('track: each ply sounds when it lands, the end of the game after the last, all from the clip start', () => {
  const M = { result: '1-0', plies: [{ san: 'e4' }, { san: 'exd5' }, { san: 'Qh5#' }] };
  assert.deepEqual(X.track(M, S, 0, 10), [{ at: 1.5, kinds: ['move'] }, { at: 2.5, kinds: ['capture'] }, { at: 3.5, kinds: ['move', 'check'] }, { at: 4.1, kinds: ['victory'] }]);
  assert.deepEqual(X.track(M, S, 2, 3.5), [{ at: 0.5, kinds: ['capture'] }]); // a ply landing at the end is left out
  assert.deepEqual(X.track(M, S, 3, 3.9).map((e) => e.kinds), [['move', 'check']]); // no room for the end sound
  assert.deepEqual(X.track({ ...M, result: '*' }, S, 0, 10).length, 3);
});
