const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('board-core.js'); loadUnit('edit-core.js'); loadUnit('vision-core.js');
const V = window.VisionCore, E = window.EditCore, CC = window.ChessCore;
const CLASSES = '.PNBRQKpnbrqk';
const BIG = 20;

// logits for a placement: the placed class at a big margin on each square
function logitsOf(placement) {
  const b = CC.posFromFen(placement).b, out = new Float32Array(832);
  b.forEach((p, i) => { out[i * 13 + (p ? CLASSES.indexOf(p) : 0)] = BIG; });
  return out;
}
const TESTED = 'R7/7q/8/8/1p6/1P2p3/p3P3/k1K1N3';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('constants', () => {
  assert.equal(V.CACHE, 'chess-vision-1'); assert.equal(V.SIZE, 644); assert.equal(V.MAX_SIDE, 2048);
  assert.equal(V.UNSURE, 0.8);
  assert.deepEqual(V.WHOLE, { x0: 0, y0: 0, x1: 1, y1: 1 });
  assert.equal(V.FILES.length, 4);
  assert.equal(V.FILES.reduce((n, f) => n + f.size, 0), 55684802);
  for (const f of V.FILES) { assert.match(f.sha256, /^[0-9a-f]{64}$/); assert.ok(f.type); }
});

test('read: argmax per square, null for empty, ties go to the first class', () => {
  const l = new Float32Array(832);
  l[0 * 13 + 4] = BIG; l[63 * 13 + 12] = BIG;
  l[5 * 13 + 3] = 3; l[5 * 13 + 0] = 3; // tie between classes 0 and 3
  const r = V.read(l);
  assert.equal(r.b.length, 64); assert.equal(r.conf.length, 64);
  assert.equal(r.b[0], 'R'); assert.equal(r.b[63], 'k'); assert.equal(r.b[1], null); assert.equal(r.b[5], null);
  assert.ok(r.conf[0] > 0.999);
});

test('read: confidence is the softmax top probability; below 0.8 is unsure', () => {
  const l = new Float32Array(832).fill(-30);
  for (let i = 0; i < 64; i++) l[i * 13] = BIG;
  l[7 * 13 + 0] = 2; l[7 * 13 + 1] = 1; l[7 * 13 + 2] = 0; for (let c = 3; c < 13; c++) l[7 * 13 + c] = 0;
  const r = V.read(l);
  const e = Math.E; near(r.conf[7], e * e / (e * e + e + 11));
  assert.ok(Math.abs(r.conf[7] - 0.350) < 0.001);
  assert.deepEqual(V.unsure(r.conf), [7]);
  assert.deepEqual(V.unsure([0.9, 0.79, 0.8, 0.1]), [1, 3]);
});

test('setupFrom: white to move, rights where king and rook are home', () => {
  const r = V.read(logitsOf(TESTED));
  assert.equal(E.toFen(V.setupFrom(r.b)), TESTED + ' w - - 0 1');
  assert.equal(E.toFen(V.setupFrom(V.read(logitsOf(CC.START_FEN.split(' ')[0])).b)), CC.START_FEN);
  assert.equal(V.setupFrom(V.read(logitsOf(CC.START_FEN.split(' ')[0])).b).castle, 'KQkq');
});

test('turn: 180 degrees, rights re-derived, twice is the identity', () => {
  const s = V.setupFrom(V.read(logitsOf(TESTED)).b), t = V.turn(s);
  assert.equal(E.toFen(t), '3N1K1k/3P3p/3p2P1/6p1/8/8/q7/7R w - - 0 1');
  assert.deepEqual(V.turn(t), s);
  const st = V.setupFrom(V.read(logitsOf(CC.START_FEN.split(' ')[0])).b);
  assert.equal(V.turn({ ...st, turn: 'b', half: 3, full: 7, ep: 20 }).turn, 'b');
  const k = V.turn({ ...st, turn: 'b', half: 3, full: 7, ep: 20 });
  assert.deepEqual([k.half, k.full, k.ep], [3, 7, -1]);
  assert.equal(k.castle, ''); // king on d1/d8 after the turn, not home
  assert.deepEqual(V.turnSquares([0, 9]), [54, 63]);
  assert.deepEqual(V.turnSquares([63, 0]), [0, 63]);
});

test('cropRect: pixels rounded, longest side at most 2048, never upscaled', () => {
  assert.deepEqual(V.cropRect(V.WHOLE, 8000, 6000), { sx: 0, sy: 0, sw: 8000, sh: 6000, dw: 2048, dh: 1536 });
  assert.deepEqual(V.cropRect({ x0: .25, y0: .25, x1: .75, y1: .75 }, 1000, 600), { sx: 250, sy: 150, sw: 500, sh: 300, dw: 500, dh: 300 });
});

test('dragBox: move keeps size, edges keep 5% minimum, all inside the picture', () => {
  assert.deepEqual(V.dragBox(V.WHOLE, 'move', .2, 0), V.WHOLE);
  const b = { x0: .1, y0: .1, x1: .5, y1: .5 };
  const m = V.dragBox(b, 'move', .9, -.9);
  near(m.x1 - m.x0, .4); near(m.y1 - m.y0, .4); near(m.x1, 1); near(m.y0, 0);
  const se = V.dragBox(b, 'se', .9, .9); assert.equal(se.x1, 1); assert.equal(se.y1, 1);
  near(V.dragBox(b, 'w', .6, 0).x0, .45);
  const nw = V.dragBox(b, 'nw', .9, .9); near(nw.x0, .45); near(nw.y0, .45);
  const nw2 = V.dragBox(b, 'nw', -.9, -.9); assert.equal(nw2.x0, 0); assert.equal(nw2.y0, 0);
  near(V.dragBox(b, 'n', 0, .6).y0, .45); near(V.dragBox(b, 's', 0, -.6).y1, .15); near(V.dragBox(b, 'e', -.6, 0).x1, .15);
  assert.equal(V.dragBox(b, 'e', .1, 0).y0, .1);
});
