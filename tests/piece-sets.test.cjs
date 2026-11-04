const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { loadUnit } = require('./load.cjs');
window.PIECE_IMG = Object.fromEntries(['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'].map((p) => [p, 'data:image/svg+xml;base64,' + p]));
loadUnit('piece-sets.js');
const P = window.PieceSets;

test('SETS: cburnett first (the default), then the 26 vendored sets, each credited with a licence', () => {
  assert.equal(P.DEFAULT, 'cburnett');
  assert.equal(P.SETS[0].id, 'cburnett');
  assert.equal(P.SETS.length, 27);
  assert.equal(new Set(P.SETS.map((s) => s.id)).size, 27);
  assert.equal(new Set(P.SETS.map((s) => s.name)).size, 27);
  for (const s of P.SETS) {
    assert.ok(s.name && s.by && s.licence, s.id);
    assert.match(s.licenceUrl, /^https:\/\//, s.id);
  }
});

test('valid: a set that is gone (or never was) falls back to the default', () => {
  assert.equal(P.valid('staunty'), 'staunty');
  assert.equal(P.valid('horsey'), 'cburnett'); // left out
  assert.equal(P.valid(undefined), 'cburnett');
});

test('NON_COMMERCIAL: the CC BY-NC-SA sets, which the Export tab warns about', () => {
  assert.deepEqual(P.NON_COMMERCIAL, P.SETS.filter((s) => /NC/.test(s.licence)).map((s) => s.id));
  assert.equal(P.NON_COMMERCIAL.length, 14);
  assert.ok(P.NON_COMMERCIAL.includes('xkcd') && !P.NON_COMMERCIAL.includes('merida'));
});

test('url: cburnett from the page, the others from files next to it', () => {
  assert.equal(P.url('cburnett', 'wK'), window.PIECE_IMG.wK);
  assert.equal(P.url('merida', 'bN'), 'pieces/merida/bN.svg');
  assert.equal(P.url('gone', 'bN'), window.PIECE_IMG.bN);
});

// a stand-in for new Image(): decode() settles when the test says
const fakeImages = () => {
  const made = [];
  const make = () => { const im = { src: '' }; im.decode = () => new Promise((ok, no) => { im.ok = ok; im.no = no; }); made.push(im); return im; };
  return { made, make };
};

test('load: a set is ready once all twelve pictures have decoded, and asked for once', async () => {
  const { made, make } = fakeImages();
  assert.equal(P.ready('cburnett'), true);
  assert.equal(P.ready('chessnut'), false);
  const a = P.load('chessnut', make), b = P.load('chessnut', make);
  assert.equal(a, b, 'one load at a time');
  assert.equal(made.length, 12);
  assert.ok(made.some((im) => im.src === 'pieces/chessnut/wK.svg'));
  made.slice(0, 11).forEach((im) => im.ok());
  await new Promise((r) => setTimeout(r));
  assert.equal(P.ready('chessnut'), false, 'not with one picture missing');
  made[11].ok();
  assert.equal(await a, true);
  assert.equal(P.ready('chessnut'), true);
  assert.equal(await P.load('chessnut', make), true);
  assert.equal(made.length, 12, 'not asked for again');
});

test('load: a picture that fails leaves the set unready, and the next load asks again', async () => {
  const { made, make } = fakeImages();
  const a = P.load('celtic', make);
  made[3].no(new Error('offline'));
  assert.equal(await a, false);
  assert.equal(P.ready('celtic'), false);
  P.load('celtic', make);
  assert.equal(made.length, 24);
});

test('every set but cburnett is vendored as twelve SVGs', () => {
  const dir = path.join(__dirname, '..', 'vendor', 'pieces');
  assert.deepEqual(fs.readdirSync(dir).sort(), P.SETS.slice(1).map((s) => s.id).sort());
  for (const s of P.SETS.slice(1)) for (const p of P.PIECES) {
    const svg = fs.readFileSync(path.join(dir, s.id, p + '.svg'), 'utf8');
    assert.match(svg, /^(<\?xml[^>]*>\s*)?<svg[\s>]/, `${s.id}/${p}`);
    assert.doesNotMatch(svg, /<script/i, `${s.id}/${p}`);
  }
});

test('the vendored piece sets are the files pinned in LAYOUT.md', () => {
  const crypto = require('crypto'), dir = path.join(__dirname, '..', 'vendor', 'pieces');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  // as `cd vendor/pieces && sha256sum */*.svg | sort -k2` lists them
  const files = fs.readdirSync(dir).flatMap((s) => fs.readdirSync(path.join(dir, s)).map((f) => `${s}/${f}`)).sort();
  const list = files.map((f) => `${sha(fs.readFileSync(path.join(dir, f)))}  ${f}\n`).join('');
  const pinned = fs.readFileSync(path.join(__dirname, '..', 'LAYOUT.md'), 'utf8').match(/all 312 files: sha256 `([0-9a-f]{64})`/)[1];
  assert.equal(files.length, 312);
  assert.equal(sha(list), pinned);
});
