const test = require('node:test');
const assert = require('node:assert/strict');
const { readPgm } = require('./load.cjs');

test('readPgm: the test pictures, at most 1024 px on a side', () => {
  const im = readPgm('lichess');
  assert.equal(im.g.length, im.w * im.h);
  assert.ok(Math.max(im.w, im.h) <= 1024);
});
