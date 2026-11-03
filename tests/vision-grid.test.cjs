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
