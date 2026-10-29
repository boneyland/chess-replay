const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { loadUnit } = require('./load.cjs');
loadUnit('webp-core.js');
const W = window.WebPAnim;

// 2×2 stills made with cwebp: lossy (VP8), lossless (VP8L) and lossy with alpha (VP8X, an odd-length ALPH, VP8)
const STILLS = {
  lossy: 'UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoCAAIAAUAmJaQAAudZtgAA/vZ//5wOIS38q//7Rj88te91eiYeAAAA',
  lossless: 'UklGRiwAAABXRUJQVlA4TB8AAAAvAUAAAB8gEEjeHzqN+RcQFPwf3fxHZA/gBgwR/Q8BAA==',
  alpha: 'UklGRl4AAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAgP//AABWUDggMgAAALABAJ0BKgIAAgABQCYlkAJ0AQ74ptAA/vNmdO/J5t5SKFfM60NlAnrf/Fv2j+9sKAAA',
};
const still = (k) => new Uint8Array(Buffer.from(STILLS[k], 'base64'));
const frame = (k, duration) => {
  const b = still(k), { offset, alpha } = W.stillImage(b);
  return { data: b.subarray(offset), size: b.length - offset, duration, alpha };
};
const join = (parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
// the top-level chunks after 'WEBP', and the ANMF frames' fields
function chunks(buf) {
  const out = [];
  for (let at = 12; at < buf.length;) {
    const id = buf.toString('ascii', at, at + 4), len = buf.readUInt32LE(at + 4), d = buf.subarray(at + 8, at + 8 + len);
    out.push(id === 'ANMF' ? { id, x: d.readUIntLE(0, 3) * 2, y: d.readUIntLE(3, 3) * 2, w: d.readUIntLE(6, 3) + 1, h: d.readUIntLE(9, 3) + 1, duration: d.readUIntLE(12, 3), flags: d[15], inner: d.toString('ascii', 16, 20) } : { id, len, d });
    at += 8 + len + (len & 1);
  }
  return out;
}

test('stillImage finds the image chunks and the alpha flag', () => {
  assert.deepEqual(W.stillImage(still('lossy')), { offset: 12, alpha: false });
  assert.deepEqual(W.stillImage(still('lossless')), { offset: 12, alpha: false });
  assert.deepEqual(W.stillImage(still('alpha')), { offset: 30, alpha: true });
  assert.throws(() => W.stillImage(new Uint8Array(30)), /not a WebP/);
  // Chromium's canvas.toBlob: VP8X, then a colour profile, then the image
  const iccp = Buffer.concat([Buffer.from('ICCP'), Buffer.from([3, 0, 0, 0, 1, 2, 3, 0])]);
  const vp8x = Buffer.concat([Buffer.from('VP8X'), Buffer.from([10, 0, 0, 0, 0x20, 0, 0, 0, 1, 0, 0, 1, 0, 0])]);
  const lossy = Buffer.from(still('lossy')), chromium = Buffer.concat([lossy.subarray(0, 12), vp8x, iccp, lossy.subarray(12)]);
  assert.deepEqual(W.stillImage(chromium), { offset: 12 + 18 + 12, alpha: false });
});

test('durations are whole milliseconds that add up to the clip', () => {
  assert.deepEqual(W.durations(6, 12), [83, 84, 83, 83, 84, 83]);
  assert.deepEqual(W.durations(3, 8), [125, 125, 125]);
  assert.equal(W.durations(15 * 60, 15).reduce((a, b) => a + b), 60000);
});

test('changedBox finds the rectangle that changed, starting on even coordinates', () => {
  const w = 10, h = 8, pic = () => new Uint8ClampedArray(w * h * 4).fill(200);
  const set = (p, x, y) => { p[(y * w + x) * 4 + 1] = 7; return p; };
  assert.equal(W.changedBox(pic(), pic(), w, h), null);
  assert.deepEqual(W.changedBox(pic(), set(pic(), 5, 3), w, h), { x: 4, y: 2, w: 2, h: 2 });
  assert.deepEqual(W.changedBox(pic(), set(set(pic(), 0, 7), 9, 1), w, h), { x: 0, y: 0, w: 10, h: 8 });
  assert.deepEqual(W.changedBox(pic(), set(set(pic(), 2, 4), 6, 4), w, h), { x: 2, y: 4, w: 5, h: 1 });
  // ImageData from a canvas can sit at an offset in a larger buffer
  const big = new Uint8ClampedArray(w * h * 4 + 8), view = big.subarray(8);
  view.fill(200);
  assert.deepEqual(W.changedBox(view, set(pic(), 9, 7), w, h), { x: 8, y: 6, w: 2, h: 2 });
});

test('mux writes a well-formed animated WebP', () => {
  const frames = [frame('lossy', 83), frame('alpha', 84), frame('lossless', 1500)];
  const buf = join(W.mux(frames, { width: 2, height: 2 }));
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.readUInt32LE(4), buf.length - 8);
  const c = chunks(buf);
  assert.deepEqual(c.map((x) => x.id), ['VP8X', 'ANIM', 'ANMF', 'ANMF', 'ANMF']);
  assert.equal(c[0].d[0], 0x12); // animation, and alpha because one frame has it
  assert.equal(c[1].d.readUInt16LE(4), 0); // loops forever
  assert.deepEqual(c.slice(2).map((f) => [f.w, f.h, f.duration, f.flags, f.inner]), [[2, 2, 83, 2, 'VP8 '], [2, 2, 84, 2, 'ALPH'], [2, 2, 1500, 2, 'VP8L']]);
  assert.equal(join(W.mux([frame('lossy', 100)], { width: 2, height: 2 }))[20], 0x02); // no alpha flag without alpha
  assert.throws(() => W.mux([frame('lossy', 0)], { width: 2, height: 2 }), /duration/);
  // a frame can cover part of the canvas; its corner must be on even coordinates and it must fit
  const part = chunks(join(W.mux([{ ...frame('lossy', 100), w: 2, h: 2 }, { ...frame('lossless', 100), x: 2, y: 4, w: 2, h: 2 }], { width: 4, height: 6 })));
  assert.deepEqual(part.slice(2).map((f) => [f.x, f.y, f.w, f.h]), [[0, 0, 2, 2], [2, 4, 2, 2]]);
  assert.throws(() => W.mux([{ ...frame('lossy', 100), x: 1 }], { width: 4, height: 4 }), /doesn't fit/);
  assert.throws(() => W.mux([{ ...frame('lossy', 100), x: 4 }], { width: 4, height: 4 }), /doesn't fit/);

  // libwebp's own reader agrees, where it is installed
  let info = null;
  const file = path.join(__dirname, 'out', 'webp-core.webp');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  try { info = execFileSync('webpmux', ['-info', file], { encoding: 'utf8' }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (info) {
    assert.match(info, /Number of frames: 3/);
    assert.match(info, /Loop Count\s*: 0/);
    const durs = [...info.matchAll(/^\s*\d+:\s+\d+\s+\d+\s+\S+\s+\d+\s+\d+\s+(\d+)/gm)].map((m) => +m[1]);
    assert.deepEqual(durs, [83, 84, 1500]);
  }
});

// The export's encoder: vendor/webp_enc_simd.* (libwebp in WebAssembly) with export.jsx's WEBP_CONFIG
const ROOT = path.join(__dirname, '..');
const WEBP_CONFIG = Function('return ' + fs.readFileSync(path.join(ROOT, 'app', 'export.jsx'), 'utf8').match(/const WEBP_CONFIG = (\{[\s\S]*?\});/)[1])();
const codec = async (glue, wasm) => (await import(glue)).default({ noInitialRun: true, wasmBinary: fs.readFileSync(wasm) });
const encoder = () => codec(path.join(ROOT, 'vendor', 'webp_enc_simd.js'), path.join(ROOT, 'vendor', 'webp_enc_simd.wasm'));
// libwebp's decoder, for the tests only
const decoder = () => codec(path.join(__dirname, 'fixtures', 'webp_dec.js'), path.join(__dirname, 'fixtures', 'webp_dec.wasm'));
const psnr = (a, b) => {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; s += d * d; n++; }
  return 10 * Math.log10((255 * 255 * n) / s);
};

test('the encoder makes stills that mux into an animation', async () => {
  const enc = await encoder(), w = 40, h = 30, px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([(i % w) * 6, 120, 200, 255], i * 4);
  const still = enc.encode(px, w, h, WEBP_CONFIG);
  const { offset, alpha } = W.stillImage(still);
  assert.equal(alpha, false);
  assert.equal(Buffer.from(still).toString('ascii', offset, offset + 4), 'VP8 ');
  const f = { data: still.subarray(offset), size: still.length - offset, duration: 100, alpha };
  const c = chunks(join(W.mux([f, f], { width: w, height: h })));
  assert.deepEqual(c.slice(2).map((x) => [x.w, x.h, x.inner]), [[w, h, 'VP8 '], [w, h, 'VP8 ']]);
  const back = (await decoder()).decode(still);
  assert.ok(psnr(px, back.data) > 35);
});

// A 907×476 patch of an export (the board, the header and the move list), which libwebp's default deblocking filter
// smeared: the square edges and text went soft for that frame alone. WEBP_CONFIG turns the filter off.
test('the WebP config keeps a patch sharp where the default filter blurs it', async () => {
  const enc = await encoder(), dec = await decoder();
  const src = dec.decode(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'webp-blur.webp'))));
  const quality = (opts) => psnr(src.data, dec.decode(enc.encode(src.data, src.width, src.height, { ...WEBP_CONFIG, ...opts })).data);
  const blurred = quality({ filter_strength: 60 }), ours = quality({});
  assert.ok(blurred < 37, 'the fixture shows the blur: ' + blurred.toFixed(2));
  assert.ok(ours > blurred + 1.5 && ours > 38, ours.toFixed(2) + ' vs ' + blurred.toFixed(2));
  // where the filter doesn't blur, leaving it off costs well under 1 dB
  for (const q of [50, 70, 80, 95]) assert.ok(quality({ quality: q }) > quality({ quality: q, filter_strength: 60 }) - 0.6, 'quality ' + q);
});

test('the top WebP quality is lossless: a VP8L still that decodes to the same pixels', async () => {
  const enc = await encoder(), dec = await decoder();
  const WEBP_LOSSLESS = Function('return ' + fs.readFileSync(path.join(ROOT, 'app', 'export.jsx'), 'utf8').match(/const WEBP_LOSSLESS = (\{[\s\S]*?\});/)[1])();
  const src = dec.decode(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'webp-blur.webp'))));
  const still = enc.encode(src.data, src.width, src.height, { ...WEBP_CONFIG, quality: 100, ...WEBP_LOSSLESS });
  assert.equal(Buffer.from(still).toString('ascii', W.stillImage(still).offset, W.stillImage(still).offset + 4), 'VP8L');
  assert.deepEqual(Buffer.from(dec.decode(still).data), Buffer.from(src.data));
});
