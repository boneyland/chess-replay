const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { loadUnit } = require('./load.cjs');
loadUnit('board-themes.js');
const B = window.BoardThemes;
const DIR = path.join(__dirname, '..', 'vendor', 'boards');
const listed = () => fs.readdirSync(DIR).filter((f) => !f.startsWith('.')).sort();

test('THEMES: brown first (the default, the board as it was), then Lichess’s other 24 2D boards', () => {
  assert.equal(B.DEFAULT, 'brown');
  assert.equal(B.THEMES.length, 25);
  assert.equal(new Set(B.THEMES.map((t) => t.id)).size, 25);
  assert.equal(new Set(B.THEMES.map((t) => t.name)).size, 25);
  const brown = B.colours('brown');
  assert.deepEqual(brown, { light: '#f0d9b5', dark: '#b58863', onLight: '#b58863', onDark: '#f0d9b5' });
  for (const t of B.THEMES) {
    assert.ok(t.file ? !t.light && !t.dark : t.light && t.dark, t.id + ': a picture or two colours');
    assert.match(t.onLight, /^#[0-9a-f]{6}$/, t.id);
    assert.match(t.onDark, /^#[0-9a-f]{6}$/, t.id);
  }
});

test('valid, url and thumb: a board that is gone falls back to brown; pictures and tiles are files next to the page', () => {
  assert.equal(B.valid('wood4'), 'wood4');
  assert.equal(B.valid('ncf-board'), 'brown');
  assert.equal(B.valid(undefined), 'brown');
  assert.equal(B.url('brown'), null);
  assert.equal(B.url('canvas'), 'boards/canvas2.jpg');
  assert.equal(B.thumb('canvas'), 'boards/canvas2.thumbnail.jpg');
  assert.equal(B.thumb('blue'), 'boards/blue.thumbnail.png');
  assert.equal(B.thumb('newspaper'), null);
});

test('every picture and tile named is vendored, and nothing else', () => {
  const named = B.THEMES.flatMap((t) => [B.url(t.id), B.thumb(t.id)]).filter(Boolean).map((u) => u.slice('boards/'.length));
  assert.deepEqual(listed(), named.sort());
});

test('the vendored boards are the files pinned in LAYOUT.md', () => {
  const crypto = require('crypto');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  // as `cd vendor/boards && sha256sum * | LC_ALL=C sort -k2` lists them
  const files = listed();
  const list = files.map((f) => `${sha(fs.readFileSync(path.join(DIR, f)))}  ${f}\n`).join('');
  const pinned = fs.readFileSync(path.join(__dirname, '..', 'LAYOUT.md'), 'utf8').match(/all 44 board files: sha256 `([0-9a-f]{64})`/)[1];
  assert.equal(files.length, 44);
  assert.equal(sha(list), pinned);
});

test('adjust: the sliders’ values within Lichess’s ranges, the defaults for anything else', () => {
  assert.deepEqual(B.adjust(), { brightness: 100, contrast: 100, hue: 0 });
  assert.deepEqual(B.adjust({ brightness: 5, contrast: 900, hue: 'x' }), { brightness: 20, contrast: 200, hue: 0 });
  assert.equal(B.isDefault({}), true);
  assert.equal(B.isDefault({ hue: 1 }), false);
});

test('filter: brightness, then contrast, then hue, as CSS’s filter functions in that order', () => {
  const f = (a, ...rgb) => B.filter(a)(...rgb);
  assert.deepEqual(f({}, 240, 217, 181), [240, 217, 181], 'the defaults change nothing');
  assert.deepEqual(f({ brightness: 50 }, 200, 100, 0), [100, 50, 0]);
  assert.deepEqual(f({ brightness: 140 }, 200, 100, 0), [255, 140, 0], 'clamped after brightness');
  assert.deepEqual(f({ contrast: 200 }, 200, 100, 128), [255, 73, 129]);
  assert.deepEqual(f({ contrast: 40 }, 255, 0, 128), [179, 77, 128]);
  // a grey keeps its value through any hue; a full turn is no turn
  assert.deepEqual(f({ hue: 37 }, 90, 90, 90), [90, 90, 90]);
  assert.deepEqual(f({ hue: 100 }, 181, 136, 99), [181, 136, 99]);
  // hue-rotate(180deg) of pure red, by the spec's matrix
  assert.deepEqual(f({ hue: 50 }, 255, 0, 0), [0, 109, 109]);
});

test('colours: a flat board’s squares and every board’s coordinates go through the sliders', () => {
  const c = B.colours('brown', { hue: 50 }), f = B.filter({ hue: 50 });
  const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  assert.equal(c.light, hex(f(0xf0, 0xd9, 0xb5)));
  assert.equal(c.dark, hex(f(0xb5, 0x88, 0x63)));
  const w = B.colours('wood', { brightness: 50 });
  assert.equal(w.light, null);
  assert.equal(w.onLight, hex(B.filter({ brightness: 50 })(0x9b, 0x4d, 0x0f)));
});

test('filterPixels: the same change as filter, on RGBA pixels, alpha untouched', () => {
  const a = { brightness: 80, contrast: 150, hue: 23 }, f = B.filter(a);
  const px = new Uint8ClampedArray([240, 217, 181, 255, 12, 200, 99, 128]);
  B.filterPixels(px, a);
  assert.deepEqual([...px.slice(0, 3)], f(240, 217, 181));
  assert.deepEqual([...px.slice(4, 7)], f(12, 200, 99));
  assert.equal(px[3], 255);
  assert.equal(px[7], 128);
});

test('rendered: a flat board has no picture; a picture board at the defaults is lila’s file, else not yet drawn', () => {
  assert.equal(B.rendered('brown', {}), null);
  assert.equal(B.rendered('wood', {}), 'boards/wood.jpg');
  assert.equal(B.rendered('wood', { hue: 10 }), null);
});
