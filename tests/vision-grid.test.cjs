const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit, readPgm } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('vision-grid.js');
const VG = window.VisionGrid;
const cases = require('./fixtures/vision-grid/cases.json');

test('readPgm: the test pictures, at most 1024 px on a side', () => {
  const im = readPgm('lichess');
  assert.equal(im.g.length, im.w * im.h);
  assert.ok(Math.max(im.w, im.h) <= 1024);
});

test('grey: luma', () => assert.deepEqual([...VG.grey(new Uint8ClampedArray([255, 255, 255, 255, 255, 0, 0, 255]), 2, 1).g], [255, 76]));

// within 2 px of the scaled picture on every edge
const near = (got, want, im) => {
  for (const [k, n] of [['x0', im.w], ['x1', im.w], ['y0', im.h], ['y1', im.h]]) assert.ok(Math.abs(got[k] - want[k]) * n <= 2, `${k}: ${got[k]} vs ${want[k]}`);
};
for (const name of Object.keys(cases)) test(`findBoard: ${name}`, () => {
  const im = readPgm(name), got = VG.findBoard(im), want = cases[name].box;
  if (name === 'two-boards') { if (got) assert.ok(got.x1 - got.x0 < 0.55, 'spans both boards'); return; }
  if (want === null) assert.equal(got, null); else { assert.ok(got, 'no grid found'); near(got, want, im); }
});

for (const name of Object.keys(cases)) if (cases[name].box && name !== 'inside-big') test(`labelSide: ${name}`, () => {
  assert.equal(VG.labelSide(readPgm(name), cases[name].box), cases[name].side);
});

const board = (fen) => window.ChessCore.posFromFen(fen).b;
test('occupied: the drawn placement, as seen', () => {
  for (const name of ['framed-white', 'framed-black', 'inside-white', 'inside-black', 'nolabels', 'lichess', 'diagram']) {
    const b = board(cases[name].fen), seen = cases[name].side === 'b' ? b.slice().reverse() : b;
    assert.deepEqual(VG.occupied(readPgm(name), cases[name].box), seen.map(Boolean), name);
  }
});
test('occupied: an arrow over empty squares costs a few, and the side still comes out', () => {
  const b = board(cases.highlights.fen), occ = VG.occupied(readPgm('highlights'), cases.highlights.box);
  assert.ok(occ.filter((o, i) => o !== !!b[i]).length <= 4);
  assert.equal(VG.modelSide(occ, b), 'w');
});
test('modelSide', () => {
  const b = board('4k3/8/8/8/8/8/8/R3K3'), occ = b.map(Boolean);
  assert.equal(VG.modelSide(occ, b), 'w');
  assert.equal(VG.modelSide(occ.slice().reverse(), b), 'b');
  const kk = board('4k3/8/8/8/8/8/8/2K5'); // two kings, not symmetric under 180°
  assert.equal(VG.modelSide(kk.map(Boolean), kk), 'w');
  const sym = board('3k4/8/8/8/8/8/8/4K3'); // d8 and e1 swap places under 180°
  assert.equal(VG.modelSide(sym.map(Boolean), sym), null);
});
// which way the model read it takes a clear win: at least 4 squares more, and at most a third as many wrong, so two
// misjudged squares (an arrowhead, an invented piece) can't flip the answer
test('modelSide: a near tie is no answer, and two wrong squares never flip it', () => {
  const near = board('4k3/8/8/8/8/8/8/2KN4'); // the turned read matches all but 2 squares
  assert.equal(VG.modelSide(near.map(Boolean), near), null);
  const kk = board('4k3/8/8/8/8/8/8/2K5'), occ = kk.map(Boolean);
  occ[3] = true; occ[59] = true; // two squares wrongly seen as occupied, both helping the turned read
  assert.notEqual(VG.modelSide(occ, kk), 'b');
  const full = board(cases.lichess.fen), seen = full.map(Boolean);
  seen[20] = !seen[20]; seen[40] = !seen[40];
  assert.equal(VG.modelSide(seen, full), 'w');
});
test('shouldTurn', () => {
  const fb = board(cases['framed-black'].fen), im = readPgm('framed-black'), box = cases['framed-black'].box;
  assert.equal(VG.shouldTurn(im, box, fb), false); // the model read it the right way round
  assert.equal(VG.shouldTurn(im, box, fb.slice().reverse()), true); // read from White's side: turn it
  assert.equal(VG.shouldTurn(readPgm('nolabels'), cases.nolabels.box, board(cases.nolabels.fen).reverse()), false);
  const iw = board(cases['inside-white'].fen);
  assert.equal(VG.shouldTurn(readPgm('inside-white'), cases['inside-white'].box, iw), false);
  assert.equal(VG.shouldTurn(readPgm('inside-white'), cases['inside-white'].box, iw.slice().reverse()), true);
});

test('labelSide: pieces filling the corner squares never give the wrong side', () => {
  assert.notEqual(VG.labelSide(readPgm('inside-big'), cases['inside-big'].box), 'b');
});
test('labelSide: text beside a diagram is not labels, wherever the box is pulled', () => {
  const im = readPgm('text-beside'), b = cases['text-beside'].box;
  for (const dx of [-0.01, 0, 0.01]) assert.equal(VG.labelSide(im, { x0: b.x0 + dx, y0: b.y0, x1: b.x1 + dx, y1: b.y1 }), null, `dx ${dx}`);
});
test('isGrid: a box on checkered squares, not one on a photo or a page', () => {
  for (const name of ['framed-white', 'nolabels', 'lichess', 'text-beside']) assert.equal(VG.isGrid(readPgm(name), cases[name].box), true, name);
  assert.equal(VG.isGrid(readPgm('photo'), { x0: 0.11, y0: 0.23, x1: 0.85, y1: 0.92 }), false, 'a loose box on the tilted board');
  assert.equal(VG.isGrid(readPgm('noboard'), { x0: 0, y0: 0, x1: 1, y1: 1 }), false, 'no board');
});
test('shouldTurn: the red-framed diagram with labels in its frame band, read from either side', () => {
  const b = board(cases['red-frame'].fen), im = readPgm('red-frame'), box = cases['red-frame'].box;
  assert.equal(VG.shouldTurn(im, box, b), false);
  assert.equal(VG.shouldTurn(im, box, b.slice().reverse()), true);
});

// a cell as ink gives it, drawn in rows of '#' (ink) and '.'
const cell = (...rows) => {
  const w = rows[0].length, h = rows.length, bits = new Uint8Array(w * h);
  let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') { bits[y * w + x] = 1; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); } }));
  return { n, x0, y0, x1, y1, w, h, bits };
};
const EIGHT = cell('..####..', '.##..##.', '.##..##.', '..####..', '.##..##.', '##....##', '##....##', '.##..##.', '..####..');
const ONE = cell('...##...', '..###...', '.####...', '...##...', '...##...', '...##...', '...##...', '...##...', '.######.');
const A = cell('.#####..', '##...##.', '.....##.', '.....##.', '.######.', '##...##.', '##...##.', '##..###.', '.###.##.');
const H = cell('##......', '##......', '##.###..', '###..##.', '##...##.', '##...##.', '##...##.', '##...##.', '........');
const MID = cell('..###...', '.#...#..', '.....#..', '....#...', '...#....', '..#.....', '.#####..', '........', '........');

test('holes: an 8 two, a 1 none, an a one; a gap a corner wide still closes', () => {
  assert.equal(VG.holes(EIGHT), 2);
  assert.equal(VG.holes(ONE), 0);
  assert.equal(VG.holes(A), 1);
  assert.equal(VG.holes(H), 0);
  assert.equal(VG.holes(cell('.#.', '#.#', '.#.')), 1);
  assert.equal(VG.holes(cell('##.', '#.#', '.##')), 1);
});
// the 2026-11-03 gap: a board turned a quarter puts its file letters down the side, a to h; ink alone (an "a" over a
// lighter "h" by 1.35, in some font) passed them for digits and turned a good read without a word
test('ends: "8" over "1" read by shape, so letters down the side are no answer however their ink compares', () => {
  const mids = [MID, MID, MID, MID, MID, MID];
  assert.ok(VG.ends([EIGHT, ...mids, ONE]) > 0);
  assert.ok(VG.ends([ONE, ...mids, EIGHT]) < 0);
  assert.equal(VG.ends([A, ...mids, H]), 0); // "h" is no "1": too wide
  assert.equal(VG.ends([H, ...mids, A]), 0); // "a" has a hole
  const light = cell('...#....', '..##....', '...#....', '...#....', '...#....', '...#....', '...#....', '...#....', '..###...');
  assert.ok(A.n / light.n >= 1.35);
  assert.equal(VG.ends([A, ...mids, light]), 0, 'a narrow "1" under an "a": no two holes up top');
  assert.equal(VG.ends([EIGHT, EIGHT, ...mids.slice(1), ONE]), 0, 'the "8" end must carry the most ink');
});
