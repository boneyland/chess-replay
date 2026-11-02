// vendor/chasolver.wasm (tools/chasolver-wasm): its answers on known positions, refused FENs, and its pinned SHA-256
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const bytes = fs.readFileSync(path.join(ROOT, 'vendor', 'chasolver.wasm'));
const { exports: X } = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
// 0 unwinnable, 1 winnable, 2 undecided, 3 refused
const solve = (fen, side) => {
  const b = Buffer.from(fen, 'utf8');
  if (b.length <= 256) new Uint8Array(X.memory.buffer, X.buf(), b.length).set(b);
  return X.solve(b.length, side === 'w' ? 0 : 1);
};

test('bare kings are unwinnable for both sides', () => {
  assert.equal(solve('8/8/8/8/8/8/8/K1k5 w - - 0 1', 'w'), 0);
  assert.equal(solve('8/8/8/8/8/8/8/K1k5 w - - 0 1', 'b'), 0);
});

test('the starting position is winnable for both sides', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.equal(solve(fen, 'w'), 1);
  assert.equal(solve(fen, 'b'), 1);
});

test('positions from chasolver\'s own test file', () => {
  // "--": locked pawns with bishops, dead
  assert.equal(solve('2b1k3/8/8/1p1p1p1p/1P1P1P1P/8/8/2B1K3 w - -', 'w'), 0);
  assert.equal(solve('2b1k3/8/8/1p1p1p1p/1P1P1P1P/8/8/2B1K3 w - -', 'b'), 0);
  // "W-": only White can still mate
  assert.equal(solve('Bb1k1b2/bKp1p1p1/1pP1P1P1/pP6/6P1/P7/8/8 w - -', 'w'), 1);
  assert.equal(solve('Bb1k1b2/bKp1p1p1/1pP1P1P1/pP6/6P1/P7/8/8 w - -', 'b'), 0);
});

test('a lone king can\'t win, a king and rook can', () => {
  assert.equal(solve('8/8/8/4k3/8/8/r7/4K3 w - - 0 1', 'w'), 0);
  assert.equal(solve('8/8/8/4k3/8/8/r7/4K3 w - - 0 1', 'b'), 1);
});

test('a FEN it can\'t read, or one longer than the buffer, is refused', () => {
  assert.equal(solve('garbage', 'w'), 3);
  assert.equal(solve('8/'.repeat(150), 'w'), 3);
});

test('the file is the one pinned in LAYOUT.md', () => {
  const layout = fs.readFileSync(path.join(ROOT, 'LAYOUT.md'), 'utf8');
  const m = /`chasolver\.wasm`[^\n]*sha256 `([0-9a-f]{64})`/.exec(layout);
  assert.ok(m, 'LAYOUT.md pins chasolver.wasm');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), m[1]);
});
