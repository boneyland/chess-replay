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
  function checkered(sum, x0, y0, s, t = s) {
    const p = Math.max(1, Math.round(0.15 * Math.min(s, t))), inset = Math.max(1, Math.round(0.08 * Math.min(s, t))), v = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const L = Math.round(x0 + c * s), T = Math.round(y0 + r * t), R = Math.round(x0 + (c + 1) * s), B = Math.round(y0 + (r + 1) * t);
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

  // the ink in a cell: its pixels far (over 60 levels) from the cell's own median, the glyph's background; n of them,
  // and their extent (x0, y0, x1, y1, in pixels, the cell's own corner at 0, 0). With inner (edges of the cell,
  // 'l', 't', 'r', 'b'), a blob of ink that touches one of them is left out: a piece reaching into a corner patch
  function ink({ g, w, h }, x0, y0, x1, y1, skip, inner) {
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(w, Math.round(x1)); y1 = Math.min(h, Math.round(y1));
    const cw = Math.max(0, x1 - x0), ch = Math.max(0, y1 - y0), out = { n: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, w: cw, h: ch };
    const v = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!skip || !skip[x]) v.push(g[y * w + x]);
    if (v.length < 4) return out;
    const m = median(v), on = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) on[y * cw + x] = (!skip || !skip[x + x0]) && Math.abs(g[(y + y0) * w + x + x0] - m) > 60 ? 1 : 0;
    const take = (x, y) => { out.n++; out.x0 = Math.min(out.x0, x); out.x1 = Math.max(out.x1, x + 1); out.y0 = Math.min(out.y0, y); out.y1 = Math.max(out.y1, y + 1); };
    if (!inner) { for (let i = 0; i < on.length; i++) if (on[i]) take(i % cw, (i / cw) | 0); return out; }
    const seen = new Uint8Array(cw * ch);
    for (let i = 0; i < on.length; i++) {
      if (!on[i] || seen[i]) continue;
      const blob = [i];
      seen[i] = 1;
      let touches = false;
      for (let j = 0; j < blob.length; j++) {
        const x = blob[j] % cw, y = (blob[j] / cw) | 0;
        if ((inner.includes('l') && x === 0) || (inner.includes('r') && x === cw - 1) || (inner.includes('t') && y === 0) || (inner.includes('b') && y === ch - 1)) touches = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = ny * cw + nx;
          if (nx >= 0 && ny >= 0 && nx < cw && ny < ch && on[k] && !seen[k]) { seen[k] = 1; blob.push(k); }
        }
      }
      if (!touches) for (const k of blob) take(k % cw, (k / cw) | 0);
    }
    return out;
  }

  // Which side the rank labels put at the bottom: 'w' when "1" is there, 'b' when "8" is, null when no label column
  // is clear. A label column is 8 cells, one a rank, each holding one glyph: some ink, none with far more than the
  // others, and shaped like a label, not a run of text or a piece reaching in. An "8" carries clearly more ink than a
  // "1", so its two ends tell. Columns looked at: just outside the box on the left and right (a frame's solid band
  // left out), and the corners of the edge files' squares (inside coordinates). File labels aren't read.
  function labelSide(im, box) {
    const X0 = box.x0 * im.w, Y0 = box.y0 * im.h, X1 = box.x1 * im.w, Y1 = box.y1 * im.h, s = (X1 - X0) / 8, t = (Y1 - Y0) / 8;
    // a strip's pixel columns that are almost all far from the strip's median (a frame, the picture's edge) are skipped;
    // a run of them at least 0.2 of a square wide is a frame band the labels may be printed in, looked at on its own
    const frame = (xa, xb) => {
      const skip = {}, a = Math.max(0, Math.round(xa)), b = Math.min(im.w, Math.round(xb)), all = [];
      for (let y = Math.round(Y0); y < Math.round(Y1); y++) for (let x = a; x < b; x++) all.push(im.g[y * im.w + x]);
      const m = median(all);
      for (let x = a; x < b; x++) {
        let far = 0, n = 0;
        for (let y = Math.max(0, Math.round(Y0)); y < Math.min(im.h, Math.round(Y1)); y++, n++) if (Math.abs(im.g[y * im.w + x] - m) > 60) far++;
        if (n && far > 0.9 * n) skip[x] = true;
      }
      const bands = [];
      for (let x = a; x < b; x++) {
        if (!skip[x]) continue;
        let e = x;
        while (e + 1 < b && skip[e + 1]) e++;
        if (e + 1 - x >= 0.2 * s) bands.push([x, e + 1]);
        x = e;
      }
      return { skip, bands };
    };
    const cols = [];
    // outside: a rank's label is one glyph, narrow, clear of the rank's top and bottom, its middle near the rank's, and
    // the 8 sit one above the other (lines of text run wide, or fill the rank)
    const outside = (xa, xb, skip) => {
      const cells = [...Array(8)].map((_, k) => ink(im, xa, Y0 + k * t, xb, Y0 + (k + 1) * t, skip));
      const glyph = (c) => c.n >= 3 && c.x1 - c.x0 <= 0.45 * s && c.y1 - c.y0 <= 0.6 * t && c.y0 >= 0.1 * c.h && c.y1 <= 0.9 * c.h
        && Math.abs((c.y0 + c.y1) / 2 - c.h / 2) <= 0.25 * c.h;
      const mid = median(cells.map((c) => (c.x0 + c.x1) / 2));
      cols.push(cells.every((c) => glyph(c) && Math.abs((c.x0 + c.x1) / 2 - mid) <= 0.15 * s) ? cells.map((c) => c.n) : null);
    };
    for (const [xa, xb] of [[X0 - 0.7 * s, X0 - 0.05 * s], [X1 + 0.05 * s, X1 + 0.7 * s]]) {
      const { skip, bands } = frame(xa, xb);
      outside(xa, xb, skip);
      for (const [ba, bb] of bands) outside(ba, bb, null);
    }
    // inside: a patch in a corner of each edge-file square; blobs of ink touching the patch's inner edges (a piece
    // reaching into the corner) don't count
    const c = 0.32;
    for (const [xa, xb, left] of [[X0 + 0.02 * s, X0 + c * s, true], [X1 - c * s, X1 - 0.02 * s, false]]) {
      for (const top of [true, false]) {
        const inner = (left ? 'r' : 'l') + (top ? 'b' : 't');
        cols.push([...Array(8)].map((_, k) => {
          const ya = top ? Y0 + k * t + 0.02 * t : Y0 + (k + 1) * t - c * t;
          return ink(im, xa, ya, xb, ya + (c - 0.02) * t, null, inner).n;
        }));
      }
    }
    let side = null, best = 0;
    for (const col of cols) {
      if (!col) continue;
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

  // the squares the picture shows something on, in picture order (index 0 the top-left square as seen): a square
  // whose middle half (the corners left out, where inside labels sit) isn't near-flat colour
  function occupied({ g, w, h }, box) {
    const X0 = box.x0 * w, Y0 = box.y0 * h, s = (box.x1 - box.x0) * w / 8, t = (box.y1 - box.y0) * h / 8, out = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      let n = 0, sum = 0, sq = 0;
      for (let y = Math.round(Y0 + (r + 0.25) * t); y < Math.round(Y0 + (r + 0.75) * t); y++) {
        for (let x = Math.round(X0 + (c + 0.25) * s); x < Math.round(X0 + (c + 0.75) * s); x++) { const v = g[y * w + x]; n++; sum += v; sq += v * v; }
      }
      out.push(n > 0 && Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) > 14);
    }
    return out;
  }

  // the side the model put at the bottom: its read (b, a8…h1) against what the picture shows (occ, as seen), taken as
  // read and turned 180°. The way that wins must win clearly, at least 4 squares fewer wrong and at most a third as
  // many, else null (a placement nearly the same either way): two misjudged squares, an arrowhead or an invented
  // piece, then never flip the answer
  function modelSide(occ, b) {
    let w = 0, bl = 0; // squares wrong each way
    for (let i = 0; i < 64; i++) { if (occ[i] !== !!b[i]) w++; if (occ[i] !== !!b[63 - i]) bl++; }
    const clear = (win, lose) => lose - win >= 4 && 3 * win <= lose;
    return clear(w, bl) ? 'w' : clear(bl, w) ? 'b' : null;
  }

  // whether a read (b) is to be turned: the labels and the model both answer, and differ. Through window.VisionGrid,
  // so a test can stand in for modelSide
  function shouldTurn(im, box, b) {
    const G = window.VisionGrid, label = G.labelSide(im, box);
    if (!label) return false;
    const model = G.modelSide(G.occupied(im, box), b);
    return !!model && model !== label;
  }

  // whether a box (fractions; found, or pulled by hand) is on checkered squares: orientation is worked out only then
  function isGrid(im, box) {
    const x0 = box.x0 * im.w, y0 = box.y0 * im.h, s = (box.x1 - box.x0) * im.w / 8, t = (box.y1 - box.y0) * im.h / 8;
    return s >= 4 && t >= 4 && !!checkered(integral(im), x0, y0, s, t);
  }

  window.VisionGrid = { SIDE, grey, findBoard, labelSide, occupied, modelSide, shouldTurn, isGrid };
})();
