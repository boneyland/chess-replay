const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('draw-core.js');
const D = window.DrawCore;

test('the modifier held picks the brush', () => {
  assert.equal(D.brush({}), 'green');
  assert.equal(D.brush({ shiftKey: true }), 'red');
  assert.equal(D.brush({ altKey: true }), 'blue');
  assert.equal(D.brush({ metaKey: true }), 'blue');
  assert.equal(D.brush({ ctrlKey: true }), 'red');
  assert.equal(D.brush({ ctrlKey: true, shiftKey: true }), 'red');
  assert.equal(D.brush({ shiftKey: true, altKey: true }), 'yellow');
  assert.equal(D.brush({ ctrlKey: true, altKey: true }), 'yellow');
  for (const b of D.BRUSHES) assert.match(D.COLORS[b], /^#[0-9a-f]{6}$/);
});

test('a drag back to its own square is a circle', () => {
  assert.deepEqual(D.shape('e4', 'e4', 'green'), { from: 'e4', to: null, brush: 'green' });
  assert.deepEqual(D.shape('e4', null, 'red'), { from: 'e4', to: null, brush: 'red' });
  assert.deepEqual(D.shape('e2', 'e4', 'blue'), { from: 'e2', to: 'e4', brush: 'blue' });
});

test('drawing a shape again removes it, in another colour recolours it', () => {
  const a = D.shape('e2', 'e4', 'green'), c = D.shape('d5', null, 'green');
  let s = D.toggle(D.toggle([], a), c);
  assert.deepEqual(s, [a, c]);
  s = D.toggle(s, D.shape('e2', 'e4', 'red'));
  assert.deepEqual(s, [{ ...a, brush: 'red' }, c]);
  s = D.toggle(s, D.shape('e2', 'e4', 'red'));
  assert.deepEqual(s, [c]);
  // the reverse arrow and a circle on the arrow's square are other shapes
  s = D.toggle(D.toggle(s, D.shape('e4', 'e2', 'green')), D.shape('e2', null, 'green'));
  assert.equal(s.length, 3);
  assert.deepEqual(D.toggle(s, c), s.slice(1));
});

test('square names run from a8', () => {
  assert.equal(D.sqName(0), 'a8');
  assert.equal(D.sqName(63), 'h1');
  assert.equal(D.sqName(36), 'e4');
});
