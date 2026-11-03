// The board auto-crop's pure parts, on a greyscale copy of the picture ({ g, w, h }, one byte a pixel, longest side at
// most SIDE): where a clean upright 8×8 grid is (findBoard), which side the rank labels put at the bottom (labelSide),
// which side the model assumed (occupied, modelSide) and so whether its read is to be turned (shouldTurn). Boxes are
// fractions of the picture, as the crop box's. Nothing here touches the network or the model.
(function () {
  const SIDE = 1024;
  const D = 3; // the corner detector's quadrant size, in pixels

  // luma per pixel of an RGBA picture the caller has already scaled
  function grey(rgba, w, h) {
    const g = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = (77 * rgba[i * 4] + 150 * rgba[i * 4 + 1] + 29 * rgba[i * 4 + 2]) >> 8;
    return { g, w, h };
  }

  // an integral image: sum(x0, y0, x1, y1) of the pixels in [x0, x1) × [y0, y1)
  function integral({ g, w, h }) {
    const S = new Int32Array((w + 1) * (h + 1)), W = w + 1;
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += g[y * w + x]; S[(y + 1) * W + x + 1] = S[y * W + x + 1] + row; }
    }
    return (x0, y0, x1, y1) => S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0];
  }

  // Down each column (and along each row), the steps from one pixel to the next, rising and falling summed apart. On a
  // grid line between checkered squares the step rises in some squares and falls in the others, so both sums are large
  // and so is their geometric mean; a frame's edge or the picture's border steps one way only. Taken over the pixels
  // in [x0, x1) × [y0, y1).
  function profiles({ g, w }, x0, y0, x1, y1) {
    const cp = new Float64Array(x1 - x0), cn = new Float64Array(x1 - x0), rp = new Float64Array(y1 - y0), rn = new Float64Array(y1 - y0);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = g[y * w + x];
      if (x + 1 < x1) { const d = g[y * w + x + 1] - v; if (d > 0) cp[x - x0] += d; else cn[x - x0] -= d; }
      if (y + 1 < y1) { const d = g[(y + 1) * w + x] - v; if (d > 0) rp[y - y0] += d; else rn[y - y0] -= d; }
    }
    return { cols: cp.map((v, i) => Math.sqrt(v * cn[i])), rows: rp.map((v, i) => Math.sqrt(v * rn[i])) };
  }

  const median = (a) => { const s = Array.from(a).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : 0; };

  // the best 7 evenly spaced lines on one axis: { a, s } (the first line and the spacing, in pixels, fitted through
  // the peaks) or null when they aren't clearly there
  function lines(p, n, strict) {
    const best3 = new Float64Array(n);
    for (let i = 0; i < n; i++) best3[i] = Math.max(p[i - 1] || 0, p[i], p[i + 1] || 0);
    let top = null;
    for (let s = 8; s * 8 <= n + 2; s += 0.25) {
      for (let a = 1; a + 6 * s < n - 1; a++) {
        let t = 0;
        for (let k = 0; k < 7; k++) t += best3[Math.round(a + k * s)];
        if (!top || t > top.t) top = { t, a, s };
      }
    }
    if (!top) return null;
    // each line where its peak is, within a pixel; then a straight fit through the seven
    const at = [], peak = [];
    for (let k = 0; k < 7; k++) {
      const c = Math.round(top.a + k * top.s);
      let x = c;
      for (const d of [-1, 1]) if ((p[c + d] || 0) > p[x]) x = c + d;
      at.push(x); peak.push(p[x]);
    }
    const mid = median(peak);
    if (strict && (Math.min(...peak) < 0.35 * mid || mid < 4 * median(p))) return null;
    const km = 3, xm = at.reduce((q, v) => q + v, 0) / 7;
    let num = 0, den = 0;
    at.forEach((v, k) => { num += (k - km) * (v - xm); den += (k - km) * (k - km); });
    const s = num / den;
    return { a: xm - km * s + 1, s }; // the step at i is the edge between pixels i and i + 1
  }

  // the 64 squares' brightness (the median of four small patches in each square's corners, away from a centred
  // piece) must alternate in a checkerboard, with a clear step between light and dark
  function checkered(sum, x0, y0, s) {
    const p = Math.max(1, Math.round(0.15 * s)), inset = Math.max(1, Math.round(0.08 * s)), v = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const L = Math.round(x0 + c * s), T = Math.round(y0 + r * s), R = Math.round(x0 + (c + 1) * s), B = Math.round(y0 + (r + 1) * s);
      const m = [[L + inset, T + inset], [R - inset - p, T + inset], [L + inset, B - inset - p], [R - inset - p, B - inset - p]]
        .map(([x, y]) => sum(x, y, x + p, y + p) / (p * p)).sort((a, b) => a - b);
      v.push((m[1] + m[2]) / 2);
    }
    const o = v.slice().sort((a, b) => a - b), thr = (o[15] + o[48]) / 2; // between the darker and the lighter half
    let even = 0, light = 0, dark = 0, nl = 0, nd = 0;
    v.forEach((b, i) => {
      if ((b > thr) === (((i >> 3) + (i & 7)) % 2 === 0)) even++;
      if (b > thr) { light += b; nl++; } else { dark += b; nd++; }
    });
    return Math.max(even, 64 - even) >= 56 && nl && nd && light / nl - dark / nd >= 20;
  }

  // a clean, upright 8×8 grid's squares as a box, or null. A first look over the whole picture, then a second over
  // the band the first found (so a page's text beside a small board doesn't drown its lines), judged strictly
  function findBoard(im) {
    const { w, h } = im;
    if (Math.min(w, h) < 64) return null;
    // columns over every row first, then each axis over the other's band (a square wider on each side, as the first
    // look may sit a line off), the last two judged strictly
    let X = lines(profiles(im, 0, 0, w, h).cols, w, false), Y = null;
    const band = (L, n) => [Math.max(0, Math.floor(L.a - 2 * L.s)), Math.min(n, Math.ceil(L.a + 8 * L.s))];
    for (const strict of [false, true]) {
      if (!X) return null;
      const [x0, x1] = band(X, w);
      Y = lines(profiles(im, x0, 0, x1, h).rows, h, strict);
      if (!Y) return null;
      const [y0, y1] = band(Y, h);
      X = lines(profiles(im, 0, y0, w, y1).cols, w, strict);
    }
    if (!X) return null;
    if (Math.abs(X.s - Y.s) > 0.08 * Math.max(X.s, Y.s)) return null;
    const bx0 = X.a - X.s, by0 = Y.a - Y.s, bx1 = X.a + 7 * X.s, by1 = Y.a + 7 * Y.s;
    if (bx0 < -1 || by0 < -1 || bx1 > w + 1 || by1 > h + 1) return null;
    const c = (v, n) => Math.min(n, Math.max(0, v));
    const box = { x0: c(bx0, w), y0: c(by0, h), x1: c(bx1, w), y1: c(by1, h) };
    if (!checkered(integral(im), box.x0, box.y0, (box.x1 - box.x0 + box.y1 - box.y0) / 16)) return null;
    return { x0: box.x0 / w, y0: box.y0 / h, x1: box.x1 / w, y1: box.y1 / h };
  }

  // the ink in a cell: pixels far (over 60 levels) from the cell's own median, the glyph's background
  function ink({ g, w, h }, x0, y0, x1, y1, skip) {
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(w, Math.round(x1)); y1 = Math.min(h, Math.round(y1));
    const v = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!skip || !skip[x]) v.push(g[y * w + x]);
    if (v.length < 4) return 0;
    const m = median(v);
    return v.filter((b) => Math.abs(b - m) > 60).length;
  }

  // Which side the rank labels put at the bottom: 'w' when "1" is there, 'b' when "8" is, null when no label column
  // is clear. A label column is 8 cells, one a rank, each with some ink and none with far more than the others (a
  // piece or text would); an "8" carries clearly more ink than a "1", so its two ends tell. Columns looked at: just
  // outside the box on the left and right (a frame's solid band left out), and the corners of the edge files' squares
  // (inside coordinates). File labels aren't read.
  function labelSide(im, box) {
    const X0 = box.x0 * im.w, Y0 = box.y0 * im.h, X1 = box.x1 * im.w, Y1 = box.y1 * im.h, s = (X1 - X0) / 8, t = (Y1 - Y0) / 8;
    // a strip's pixel columns that are almost all far from the strip's median (a frame, the picture's edge) are skipped
    const frame = (xa, xb) => {
      const skip = {}, a = Math.max(0, Math.round(xa)), b = Math.min(im.w, Math.round(xb)), all = [];
      for (let y = Math.round(Y0); y < Math.round(Y1); y++) for (let x = a; x < b; x++) all.push(im.g[y * im.w + x]);
      const m = median(all);
      for (let x = a; x < b; x++) {
        let far = 0, n = 0;
        for (let y = Math.max(0, Math.round(Y0)); y < Math.min(im.h, Math.round(Y1)); y++, n++) if (Math.abs(im.g[y * im.w + x] - m) > 60) far++;
        if (n && far > 0.9 * n) skip[x] = true;
      }
      return skip;
    };
    const cols = [];
    for (const [xa, xb] of [[X0 - 0.7 * s, X0 - 0.05 * s], [X1 + 0.05 * s, X1 + 0.7 * s]]) {
      const skip = frame(xa, xb);
      cols.push([...Array(8)].map((_, k) => ink(im, xa, Y0 + k * t, xb, Y0 + (k + 1) * t, skip)));
    }
    const c = 0.32;
    for (const [xa, xb] of [[X0 + 0.02 * s, X0 + c * s], [X1 - c * s, X1 - 0.02 * s]]) {
      for (const top of [true, false]) {
        cols.push([...Array(8)].map((_, k) => {
          const ya = top ? Y0 + k * t + 0.02 * t : Y0 + (k + 1) * t - c * t;
          return ink(im, xa, ya, xb, ya + (c - 0.02) * t);
        }));
      }
    }
    let side = null, best = 0;
    for (const col of cols) {
      const m = median(col);
      if (Math.min(...col) < 3 || Math.max(...col) > 3 * m) continue;
      // the "8" end carries at least 1.35 times the "1" end's ink
      const r = Math.log(col[0] / col[7]);
      if (Math.abs(r) < Math.log(1.35)) continue;
      const here = r > 0 ? 'w' : 'b';
      if (side && side !== here) return null;
      if (Math.abs(r) > best) { side = here; best = Math.abs(r); }
    }
    return side;
  }

  window.VisionGrid = { SIDE, grey, findBoard, labelSide };
})();
