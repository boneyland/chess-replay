// Load the page's plain-script units (IIFEs that assign window.*) into Node for tests.
const path = require('path');
globalThis.window = globalThis;
const APP = path.join(__dirname, '..', 'app');
function loadUnit(rel) { require(path.join(APP, rel)); }
const fixture = (name) => require(path.join(__dirname, 'fixtures', name));
// a binary greyscale PGM (P5, maxval 255) from tests/fixtures/vision-grid, as the dialog's greyscale copy { g, w, h }
function readPgm(name) {
  const buf = require('fs').readFileSync(path.join(__dirname, 'fixtures', 'vision-grid', name + '.pgm'));
  const head = buf.toString('latin1', 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+255\s/);
  const w = +head[1], h = +head[2];
  return { g: new Uint8Array(buf.buffer, buf.byteOffset + head[0].length, w * h), w, h };
}
module.exports = { loadUnit, fixture, readPgm };
