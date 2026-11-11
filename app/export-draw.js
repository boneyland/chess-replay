// Faster frames for the video export. html2canvas takes 0.3–0.5 s for the whole stage, and about 65 ms even for one
// small element (it clones the document on every call), while at 24 fps about half the frames change, mostly in the
// board, the eval bar and the eval graph. So the stage is split into its layers (the board, the bars, each panel),
// each kept as a bitmap: a frame redraws only the layers whose markup changed, drawing what it can straight onto a
// canvas (paint() below: boxes, images, single lines of text, and the SVG of the arrows and the graph) and handing any
// other layer to html2canvas on its own. paint() knows a short list of elements and styles; a layer with anything
// else in it (a wrapped line, a button, a gradient other than the check glow's) is html2canvas's, whole.
(function () {
  class Unsupported extends Error {}
  const no = (why) => { throw new Unsupported(why); };
  const MARGIN = 32; // CSS px drawn around a layer, for its shadows

  const clear = (c) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c);
  const px = (v) => parseFloat(v) || 0;
  // a transform's scale and rotation (none, or a 2D matrix without skew)
  const matrixOf = (t) => {
    if (!t || t === 'none') return { k: 1, rot: 0 };
    const m = t.match(/^matrix\(([^)]*)\)$/);
    if (!m) no('transform ' + t);
    const [a, b, c, d] = m[1].split(',').map(Number);
    const k = Math.hypot(a, b);
    if (Math.abs(k - Math.hypot(c, d)) > 1e-3 || Math.abs(a * c + b * d) > 1e-3) no('skewed transform');
    return { k, rot: Math.atan2(b, a) };
  };
  // the colour and lengths of a single box-shadow or drop-shadow ("rgba(0, 0, 0, 0.28) 0px 4px 12px 0px")
  const shadowOf = (v, what) => {
    if (!v || v === 'none') return null;
    const m = v.match(/^(rgba?\([^)]*\)|#[0-9a-f]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+([\d.]+)px)?(?:\s+(-?[\d.]+)px)?$/i);
    if (!m) no(what + ' ' + v);
    return { color: m[1], x: +m[2], y: +m[3], blur: +(m[4] || 0), spread: +(m[5] || 0) };
  };
  // A blurred box-shadow, worked out here rather than by the canvas's shadowBlur: Firefox for Android draws that about
  // three times too strong and cuts it off short (measured 2026-11-06), so the dark theme's halo lit up the board and
  // left bands in the panels. The shadow of a rectangle blurred by a Gaussian (sigma: half the blur, as CSS has it) is
  // the colour's alpha times the product of two erf differences, one across and one down. It is worked out at no more
  // than a CSS px a pixel (finer for a small blur), scaled up where drawn, and kept for the next box of its size
  // (the round corners, a few px, are left square)
  const erf = (x) => {
    // Abramowitz and Stegun 7.1.26, within 1.5e-7
    const s = Math.sign(x), t = 1 / (1 + 0.3275911 * Math.abs(x));
    return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  };
  const rgbaOf = (c) => { const m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/); return m && [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]]; };
  // A canvas no longer needed, emptied so its memory goes now rather than when it is collected: where canvases are drawn
  // on the GPU (Firefox for Android), an export's discarded layer bitmaps took Firefox's GPU process from 0.3 to 1.8 GB
  // (measured 2026-11-06), and a page short of memory reloaded mid-export
  const free = (cv) => { if (cv && cv.width) { cv.width = 0; cv.height = 0; } };
  const BLURS_KEPT = 48;
  const blurs = new Map();
  // false where the colour isn't one this reads (the canvas's own shadow is drawn then)
  function blurredBox(cx, x, y, w, h, blur, color) {
    const rgba = rgbaOf(color);
    if (!rgba) return false;
    const sigma = blur / 2, pad = Math.ceil(3 * sigma), W = w + 2 * pad, H = h + 2 * pad;
    const key = [w, h, blur, color].join('|');
    let bmp = blurs.get(key);
    if (!bmp) {
      const step = Math.min(1, sigma / 2), cw = Math.max(1, Math.ceil(W / step)), ch = Math.max(1, Math.ceil(H / step));
      // how much of the box a Gaussian centred at each pixel covers, along one side
      const cover = (n, size, len) => Float32Array.from({ length: n }, (_, i) => {
        const u = ((i + 0.5) * size) / n - pad, r = sigma * Math.SQRT2;
        return 0.5 * (erf(u / r) - erf((u - len) / r));
      });
      const fx = cover(cw, W, w), fy = cover(ch, H, h);
      bmp = document.createElement('canvas'); bmp.width = cw; bmp.height = ch;
      const g = bmp.getContext('2d'), im = g.createImageData(cw, ch), d = im.data, A = rgba[3] * 255;
      for (let j = 0, k = 0; j < ch; j++) for (let i = 0; i < cw; i++, k += 4) { d[k] = rgba[0]; d[k + 1] = rgba[1]; d[k + 2] = rgba[2]; d[k + 3] = A * fx[i] * fy[j]; }
      g.putImageData(im, 0, 0);
      if (blurs.size >= BLURS_KEPT) { for (const c of blurs.values()) free(c); blurs.clear(); }
      blurs.set(key, bmp);
    }
    cx.save();
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(bmp, x - pad, y - pad, W, H);
    cx.restore();
    return true;
  }
  // A box's shadows (shadowsOf's list, topmost first) for box b (radius r, scale k), drawn bottom first: blurred ones
  // by blurredBox, others filled
  function boxShadows(cx, bs, b, r, k, dev) {
    for (const sh of bs.slice().reverse()) {
      const sp = sh.spread * k;
      if (sh.blur > 0 && blurredBox(cx, b.x + sh.x * k - sp, b.y + sh.y * k - sp, b.w + 2 * sp, b.h + 2 * sp, sh.blur * k, sh.color)) continue;
      if (sh.blur > 0) {
        // the shadow alone: the shape is drawn far off the canvas and its shadow moved back
        const far = 1e4;
        Object.assign(cx, { shadowColor: sh.color, shadowOffsetX: (sh.x * k + far) * dev, shadowOffsetY: sh.y * k * dev, shadowBlur: sh.blur * k * dev, fillStyle: '#000' });
        roundRect(cx, b.x - sp - far, b.y - sp, b.w + 2 * sp, b.h + 2 * sp, r + sp); cx.fill();
        Object.assign(cx, { shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 });
      } else {
        cx.fillStyle = sh.color; roundRect(cx, b.x + sh.x * k - sp, b.y + sh.y * k - sp, b.w + 2 * sp, b.h + 2 * sp, r + sp); cx.fill();
      }
    }
  }
  // a box-shadow list, first (topmost) shadow first; the commas inside rgba() don't split it
  const shadowsOf = (v) => v === 'none' ? [] : v.split(/,(?![^(]*\))/).map((x) => shadowOf(x.trim(), 'box-shadow'));
  // a filter of drop-shadows, in the order they apply (the captured pieces' rim is two); [] for none
  const dropShadowsOf = (f) => {
    if (!f || f === 'none') return [];
    const parts = f.match(/drop-shadow\((?:[^()]|\([^()]*\))*\)/g);
    if (!parts || parts.join(' ') !== f.trim()) no('filter ' + f);
    return parts.map((p) => shadowOf(p.slice(12, -1).trim(), 'filter'));
  };
  // radial-gradient(circle, <colour> <n>%, …): the check glow's, centred, to the farthest corner
  const gradientOf = (cx, v, b) => {
    const m = v.match(/^radial-gradient\(circle, (.*)\)$/);
    if (!m) no('background ' + v);
    const stops = [...m[1].matchAll(/(rgba?\([^)]*\)|#[0-9a-f]+)\s+([\d.]+)%/gi)];
    if (!stops.length) no('background ' + v);
    const g = cx.createRadialGradient(b.x + b.w / 2, b.y + b.h / 2, 0, b.x + b.w / 2, b.y + b.h / 2, Math.hypot(b.w, b.h) / 2);
    for (const s of stops) g.addColorStop(Math.min(1, +s[2] / 100), s[1]);
    return g;
  };
  const roundRect = (cx, x, y, w, h, r) => { cx.beginPath(); if (r > 0) cx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else cx.rect(x, y, w, h); };
  // one radius for all four corners, or none
  const radiusOf = (s) => {
    const r = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius];
    if (r.some((x) => / /.test(x) || /%/.test(x)) || new Set(r).size > 1) no('border-radius');
    return px(r[0]);
  };
  const fontOf = (s) => `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;

  // Draws node (an element of the stage) and what's in it. cx's transform maps the stage's own CSS px (place()) to the
  // canvas; dev is the canvas's px per stage px, for the shadows, which canvas draws in device pixels.
  // a: the opacity so far; k: the scale of the transforms so far; rot: their rotation; shadow: a drop-shadow filter
  // depth: how many faded groups (see group) it is drawn inside; grouped: its opacity is already drawn by its group
  function paint(cx, node, place, dev, a = 1, k = 1, rot = 0, shadow = null, depth = 0, grouped = false) {
    const s = getComputedStyle(node);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return;
    if (s.maskImage && s.maskImage !== 'none') no('mask');
    if (s.webkitMaskImage && s.webkitMaskImage !== 'none') no('mask');
    if (s.clipPath && s.clipPath !== 'none') no('clip-path');
    if (s.mixBlendMode && s.mixBlendMode !== 'normal') no('blend');
    const o = grouped ? 1 : px(s.opacity);
    if (a * o <= 0) return;
    // CSS fades a box and what's in it as one picture: where they overlap (a chip and its text), fading each apart lets
    // the chip show through the text. So a faded box drawing two things or more is drawn opaque on a scratch canvas, which
    // is then drawn here at its opacity
    if (o < 1 && drawsTwo(node)) return group(cx, node, place, dev, a * o, k, rot, shadow, depth);
    a *= o;
    const m = matrixOf(s.transform);
    k *= m.k; rot += m.rot;
    const own = dropShadowsOf(s.filter);
    if (own.length && shadow) no('nested filters');
    const tag = node.tagName.toLowerCase();
    // more than one drop-shadow only on a picture (the captured pieces' rim)
    if (own.length > 1 && tag !== 'img') no('filter ' + s.filter);
    shadow = own.length === 1 ? own[0] : shadow;
    if (tag === 'svg') return paintSvg(cx, node, place, dev, a, k, rot, shadow);
    if (tag === 'img') {
      if (rot) no('rotated image');
      if (!node.complete || !node.naturalWidth) no('image not loaded');
      const b = place(node);
      if (own.length > 1) return paintShadowed(cx, node, b, a, k, dev, own);
      cx.save(); cx.globalAlpha = a;
      if (shadow) Object.assign(cx, { shadowColor: shadow.color, shadowOffsetX: shadow.x * k * dev, shadowOffsetY: shadow.y * k * dev, shadowBlur: shadow.blur * k * dev });
      cx.drawImage(node, b.x, b.y, b.w, b.h);
      cx.restore();
      return;
    }
    if (tag !== 'div' && tag !== 'span') no('element ' + tag);
    // the box: its shadow, background and border
    const b = place(node), r = radiusOf(s) * k;
    const bg = !clear(s.backgroundColor), img = s.backgroundImage !== 'none';
    // the border's sides (top, right, bottom, left) that show: solid ones only, all alike (round corners allowed), or on
    // square corners any of them (a divider's border-top)
    const bw = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(px);
    const bc = [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor];
    const bst = [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle];
    const sides = [0, 1, 2, 3].filter((i) => bw[i] > 0 && !clear(bc[i]));
    const border = sides.length > 0, even = sides.length === 4 && new Set(bw).size === 1 && new Set(bc).size === 1;
    if (sides.some((i) => bst[i] !== 'solid') || (border && !even && r > 0)) no('border');
    const bs = shadowsOf(s.boxShadow);
    if ((bg || img || border || bs.length) && (rot || shadow)) no('box under a rotation or filter');
    if (s.outlineStyle !== 'none' && px(s.outlineWidth) > 0) no('outline');
    cx.save(); cx.globalAlpha = a;
    boxShadows(cx, bs, b, r, k, dev);
    if (bg) { cx.fillStyle = s.backgroundColor; roundRect(cx, b.x, b.y, b.w, b.h, r); cx.fill(); }
    if (img) { cx.fillStyle = gradientOf(cx, s.backgroundImage, b); roundRect(cx, b.x, b.y, b.w, b.h, r); cx.fill(); }
    if (even) {
      const w = bw[0] * k;
      cx.strokeStyle = bc[0]; cx.lineWidth = w;
      roundRect(cx, b.x + w / 2, b.y + w / 2, b.w - w, b.h - w, Math.max(0, r - w / 2)); cx.stroke();
    } else {
      // each side a strip along its edge of the box
      for (const i of sides) {
        const w = bw[i] * k;
        cx.fillStyle = bc[i];
        cx.fillRect(i === 1 ? b.x + b.w - w : b.x, i === 2 ? b.y + b.h - w : b.y, i % 2 ? w : b.w, i % 2 ? b.h : w);
      }
    }
    cx.restore();
    // what's in it, clipped to its padding box where it hides its overflow; a scrolled box needs nothing more, as place()
    // reads where each child is now, scrolled with it
    const clip = s.overflowX !== 'visible' || s.overflowY !== 'visible';
    cx.save();
    if (clip) {
      if (rot) no('rotated clip');
      const [t, rt, bt, l] = [0, 1, 2, 3].map((i) => (sides.includes(i) ? bw[i] * k : 0));
      roundRect(cx, b.x + l, b.y + t, b.w - l - rt, b.h - t - bt, Math.max(0, r - t)); cx.clip();
    }
    // the paint order: the box's own flow (text and unpositioned children, in order), then the positioned children by z-index
    const flow = [], placed = [];
    for (const c of node.childNodes) {
      if (c.nodeType === 3) flow.push(c);
      else if (c.nodeType === 1) {
        const cs = getComputedStyle(c);
        if (cs.position === 'static') flow.push(c);
        else placed.push({ c, z: parseInt(cs.zIndex, 10) || 0 });
      }
    }
    placed.sort((p, q) => p.z - q.z);
    const kids = [...placed.filter((p) => p.z < 0).map((p) => p.c), ...flow, ...placed.filter((p) => p.z >= 0).map((p) => p.c)];
    for (const c of kids) {
      if (c.nodeType === 3) paintText(cx, c, s, place, a, k, rot, shadow);
      else paint(cx, c, place, dev, a, k, rot, shadow, depth);
    }
    cx.restore();
  }

  // A picture under a chain of drop-shadows, as CSS applies them: each to the picture with the shadows before it. Drawn
  // in device px on canvases of its size (with room for the shadows). Each shadow is worked out here rather than with
  // the canvas's own (WebKit drew a canvas under its shadow see-through, the piece grey): the last picture's alpha in the
  // shadow's colour, blurred by a Gaussian whose standard deviation is the drop-shadow's blur, moved by its offset and
  // drawn under the picture
  function paintShadowed(cx, img, b, a, k, dev, chain) {
    const T = cx.getTransform();
    if (T.b || T.c) no('rotated canvas');
    const rgbs = chain.map((sh) => rgbaOf(sh.color) || no('shadow colour ' + sh.color));
    const X = T.a * b.x + T.e, Y = T.d * b.y + T.f, w = T.a * b.w, h = T.d * b.h;
    const pad = Math.ceil(chain.reduce((p, sh) => p + (Math.max(Math.abs(sh.x), Math.abs(sh.y)) + 3 * sh.blur) * k * dev, 0)) + 2;
    const W = Math.max(1, Math.ceil(w + 2 * pad)), H = Math.max(1, Math.ceil(h + 2 * pad));
    const canvas = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    let last = canvas(), shade = null;
    try {
      const g0 = last.getContext('2d'); g0.imageSmoothingQuality = 'high'; g0.drawImage(img, pad, pad, w, h);
      chain.forEach((sh, i) => {
        shade = canvas();
        const s = shade.getContext('2d', { willReadFrequently: true });
        s.drawImage(last, 0, 0);
        const sigma = sh.blur * k * dev, rgb = rgbs[i], im = s.getImageData(0, 0, W, H), d = im.data;
        const A = new Float32Array(W * H);
        for (let p = 0; p < A.length; p++) A[p] = d[p * 4 + 3] * rgb[3];
        if (sigma > 0) blurAlpha(A, W, H, sigma);
        for (let p = 0; p < A.length; p++) { d[p * 4] = rgb[0]; d[p * 4 + 1] = rgb[1]; d[p * 4 + 2] = rgb[2]; d[p * 4 + 3] = A[p]; }
        s.putImageData(im, 0, 0);
        const c = canvas(), g = c.getContext('2d');
        g.drawImage(shade, sh.x * k * dev, sh.y * k * dev);
        g.drawImage(last, 0, 0);
        free(shade); shade = null; free(last); last = c;
      });
      cx.save();
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalAlpha = a;
      cx.drawImage(last, X - pad, Y - pad);
      cx.restore();
    } finally { free(shade); free(last); }
  }
  // a W × H alpha map blurred in place by a Gaussian of standard deviation sigma (px), across then down; outside is 0
  function blurAlpha(A, W, H, sigma) {
    const r = Math.ceil(3 * sigma), ker = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += ker[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    for (let i = 0; i < ker.length; i++) ker[i] /= sum;
    const t = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) { const xx = x + i; if (xx >= 0 && xx < W) v += A[y * W + xx] * ker[i + r]; }
      t[y * W + x] = v;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) { const yy = y + i; if (yy >= 0 && yy < H) v += t[yy * W + x] * ker[i + r]; }
      A[y * W + x] = v;
    }
  }

  // whether node (shown, its opacity aside) draws two things or more, which then may overlap: its own box (background,
  // border or shadow), lines of text, pictures, an svg (which may hold several shapes)
  function drawsTwo(node) {
    let n = 0;
    const count = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || px(s.opacity) <= 0) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'svg') return (n += 2) >= 2;
      if (s.visibility === 'visible') {
        if (tag === 'img') return ++n >= 2;
        const box = !clear(s.backgroundColor) || s.backgroundImage !== 'none' || s.boxShadow !== 'none'
          || [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].some((w) => px(w) > 0);
        if (box && ++n >= 2) return true;
      }
      for (const c of el.childNodes) {
        if (c.nodeType === 3 ? s.visibility === 'visible' && c.data.trim() && ++n >= 2 : c.nodeType === 1 && count(c)) return true;
      }
      return false;
    };
    return count(node);
  }

  // Each faded group is drawn on a canvas of its own, let go once drawn. A scratch canvas kept from one group to the
  // next (one per depth of nesting) left Firefox for Android drawing the last group's picture under the next: a new
  // move's chip, fading in, came with the corner of the Moves panel, which had faded in on the same canvas at the same
  // offset (seen 2026-11-06), though the part used had been cleared
  function group(cx, node, place, dev, a, k, rot, shadow, depth) {
    // what it covers, on cx's canvas in device px: the box and everything in it (with MARGIN round each for shadows),
    // no more than the canvas
    const T = cx.getTransform();
    if (T.b || T.c) no('rotated canvas');
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of [node, ...node.querySelectorAll('*')]) {
      const b = place(e);
      if (!b.w && !b.h) continue;
      x0 = Math.min(x0, b.x - MARGIN); y0 = Math.min(y0, b.y - MARGIN); x1 = Math.max(x1, b.x + b.w + MARGIN); y1 = Math.max(y1, b.y + b.h + MARGIN);
    }
    const X0 = Math.max(0, Math.floor(T.a * x0 + T.e)), Y0 = Math.max(0, Math.floor(T.d * y0 + T.f));
    const X1 = Math.min(cx.canvas.width, Math.ceil(T.a * x1 + T.e)), Y1 = Math.min(cx.canvas.height, Math.ceil(T.d * y1 + T.f));
    if (X1 <= X0 || Y1 <= Y0) return;
    const w = X1 - X0, h = Y1 - Y0;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    try {
      const g = cv.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.setTransform(T.a, 0, 0, T.d, T.e - X0, T.f - Y0);
      // its own opacity is the group's
      paint(g, node, place, dev, 1, k, rot, shadow, depth + 1, true);
      cx.save();
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalAlpha = a;
      cx.drawImage(cv, X0, Y0);
      cx.restore();
    } finally { free(cv); }
  }
  // a text node: one line of it, in its parent's font
  function paintText(cx, t, s, place, a, k, rot, shadow) {
    const collapse = !/^(pre|pre-wrap|break-spaces)$/.test(s.whiteSpace);
    let txt = collapse ? t.data.replace(/\s+/g, ' ') : t.data;
    if (!txt.trim()) return;
    if (shadow) no('text under a filter');
    if (s.textShadow !== 'none' || (s.webkitTextStrokeWidth && px(s.webkitTextStrokeWidth) > 0)) no('text effect');
    const range = document.createRange(); range.selectNodeContents(t);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    if (rects.length !== 1) no('text on ' + rects.length + ' lines');
    const el = t.parentElement;
    if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) no('cut text');
    if (collapse) txt = txt.trim();
    if (s.textTransform === 'uppercase') txt = txt.toUpperCase();
    else if (s.textTransform === 'lowercase') txt = txt.toLowerCase();
    else if (s.textTransform !== 'none') no('text-transform ' + s.textTransform);
    const b = place(range);
    cx.save();
    cx.globalAlpha = a; cx.fillStyle = s.color; cx.font = fontOf(s);
    const ls = s.letterSpacing === 'normal' ? 0 : px(s.letterSpacing);
    if (ls) { if (!('letterSpacing' in cx)) no('letter-spacing'); cx.letterSpacing = ls + 'px'; }
    const mt = cx.measureText(txt), asc = mt.fontBoundingBoxAscent, desc = mt.fontBoundingBoxDescent;
    if (!(asc > 0)) no('font metrics');
    if (rot) {
      // drawn round the middle of its box (its rotated bounds share that centre)
      cx.translate(b.x + b.w / 2, b.y + b.h / 2); cx.rotate(rot); cx.scale(k, k);
      cx.textAlign = 'center'; cx.fillText(txt, 0, (asc - desc) / 2);
    } else {
      cx.translate(b.x, b.y + (b.h * asc) / (asc + desc)); cx.scale(k, k);
      cx.fillText(txt, 0, 0);
    }
    cx.restore();
  }

  // an <svg> without a viewBox: its user units are its CSS px
  function paintSvg(cx, svg, place, dev, a, k, rot, shadow) {
    if (rot || shadow) no('rotated or filtered svg');
    if (svg.getAttribute('viewBox')) no('svg viewBox');
    const b = place(svg), s = getComputedStyle(svg);
    cx.save();
    cx.translate(b.x, b.y); cx.scale(k, k);
    if (s.overflow !== 'visible') { cx.beginPath(); cx.rect(0, 0, b.w / k, b.h / k); cx.clip(); }
    for (const c of svg.children) paintSvgNode(cx, svg, c, a);
    cx.restore();
  }
  const NUM = (el, n) => { const v = el.getAttribute(n); if (v != null && /[a-z%]/i.test(v)) no('svg length ' + v); return +(v || 0); };
  function paintSvgNode(cx, svg, el, a) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'title' || tag === 'desc' || tag === 'defs' || tag === 'clippath') return;
    if (el.getAttribute('transform')) no('svg transform');
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return;
    a *= px(s.opacity);
    if (a <= 0) return;
    if (s.filter && s.filter !== 'none') no('svg filter');
    if (s.mask && s.mask !== 'none') no('svg mask');
    cx.save();
    if (s.clipPath && s.clipPath !== 'none') {
      const id = s.clipPath.match(/^url\("?#([^")]+)"?\)$/);
      const cp = id && svg.querySelector('#' + CSS.escape(id[1]));
      if (!cp || cp.tagName.toLowerCase() !== 'clippath' || [...cp.children].some((r) => r.tagName.toLowerCase() !== 'rect')) no('clip-path ' + s.clipPath);
      cx.beginPath();
      for (const r of cp.children) cx.rect(NUM(r, 'x'), NUM(r, 'y'), NUM(r, 'width'), NUM(r, 'height'));
      cx.clip();
    }
    if (tag === 'g') { for (const c of el.children) paintSvgNode(cx, svg, c, a); cx.restore(); return; }
    if (tag === 'text') {
      if (el.children.length) no('tspan');
      if (s.dominantBaseline && !/^(auto|alphabetic)$/.test(s.dominantBaseline)) no('dominant-baseline');
      if (clear(s.fill) || s.fill === 'none') { cx.restore(); return; }
      if (/url/.test(s.fill)) no('svg paint ' + s.fill);
      cx.globalAlpha = a * px(s.fillOpacity);
      cx.fillStyle = s.fill; cx.font = fontOf(s);
      const ls = s.letterSpacing === 'normal' ? 0 : px(s.letterSpacing);
      if (ls) { if (!('letterSpacing' in cx)) no('letter-spacing'); cx.letterSpacing = ls + 'px'; }
      cx.textAlign = { start: 'left', middle: 'center', end: 'right' }[s.textAnchor] || no('text-anchor');
      let txt = el.textContent.replace(/\s+/g, ' ').trim();
      if (s.textTransform === 'uppercase') txt = txt.toUpperCase();
      cx.fillText(txt, NUM(el, 'x'), NUM(el, 'y'));
      cx.restore();
      return;
    }
    const p = new Path2D();
    if (tag === 'path') p.addPath(new Path2D(el.getAttribute('d') || ''));
    else if (tag === 'polygon' || tag === 'polyline') {
      const n = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i + 1 < n.length; i += 2) (i ? p.lineTo(n[i], n[i + 1]) : p.moveTo(n[i], n[i + 1]));
      if (tag === 'polygon') p.closePath();
    } else if (tag === 'line') { p.moveTo(NUM(el, 'x1'), NUM(el, 'y1')); p.lineTo(NUM(el, 'x2'), NUM(el, 'y2')); }
    else if (tag === 'circle') p.arc(NUM(el, 'cx'), NUM(el, 'cy'), NUM(el, 'r'), 0, 2 * Math.PI);
    else if (tag === 'rect') { const rx = NUM(el, 'rx'); p.roundRect(NUM(el, 'x'), NUM(el, 'y'), NUM(el, 'width'), NUM(el, 'height'), rx); }
    else no('svg element ' + tag);
    if (s.fill !== 'none' && !clear(s.fill) && tag !== 'line') {
      if (/url/.test(s.fill)) no('svg paint ' + s.fill);
      cx.globalAlpha = a * px(s.fillOpacity); cx.fillStyle = s.fill; cx.fill(p, s.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
    }
    if (s.stroke !== 'none' && !clear(s.stroke) && px(s.strokeWidth) > 0) {
      if (/url/.test(s.stroke)) no('svg paint ' + s.stroke);
      cx.globalAlpha = a * px(s.strokeOpacity); cx.strokeStyle = s.stroke; cx.lineWidth = px(s.strokeWidth);
      cx.lineCap = s.strokeLinecap; cx.lineJoin = s.strokeLinejoin;
      cx.setLineDash(s.strokeDasharray === 'none' ? [] : s.strokeDasharray.split(/[\s,]+/).map(px));
      cx.stroke(p);
    }
    cx.restore();
  }

  // The stage's layers in paint order: a box that draws nothing itself (no background, border, shadow, transform,
  // filter or clip, and no text of its own) is opened up into its children. A faded one too (the end of the video fades
  // the whole stage): its layers are drawn together at its opacity by the compositor (fadeOf), as CSS fades it as one,
  // rather than the box going whole to html2canvas when anything in it is something the painter can't draw
  function layersOf(node, out = []) {
    const kids = [...node.children].map((c, i) => ({ c, i, s: getComputedStyle(c) })).filter((x) => x.s.display !== 'none');
    const z = (x) => (x.s.position === 'static' ? 0 : parseInt(x.s.zIndex, 10) || 0);
    kids.sort((p, q) => z(p) - z(q) || p.i - q.i);
    for (const { c, s } of kids) {
      const plain = c.children.length && clear(s.backgroundColor) && s.backgroundImage === 'none' && s.boxShadow === 'none' && px(s.borderTopWidth) + px(s.borderRightWidth) + px(s.borderBottomWidth) + px(s.borderLeftWidth) === 0
        && s.transform === 'none' && s.filter === 'none' && s.overflowX === 'visible' && s.overflowY === 'visible' && s.visibility === 'visible'
        && ![...c.childNodes].some((t) => t.nodeType === 3 && t.data.trim());
      if (plain) layersOf(c, out); else out.push(c);
    }
    return out;
  }
  // the faded boxes layersOf opened round layer n, below root: the outermost one (top, its layers drawn on a canvas of
  // their own and that drawn at its opacity, outer) and the product of the opacities of those inside it (inner, each
  // layer's own alpha on that canvas). A faded box keeps its layers together in layersOf's order
  function fadeOf(n, root) {
    let top = null, outer = 1, inner = 1;
    for (let e = n.parentElement; e && e !== root; e = e.parentElement) {
      const o = px(getComputedStyle(e).opacity);
      if (o >= 1) continue;
      if (top) inner *= outer;
      top = e; outer = o;
    }
    return { top, outer, inner };
  }

  // place(n): a box's place on the root stage in the stage's own (untransformed) CSS px, as the stage is now
  // the scroll offsets in a layer, which its markup doesn't hold: the Moves list slides to each new move with the
  // same markup, frame after frame
  function scrollsOf(n) {
    let out = '';
    [n, ...n.querySelectorAll('*')].forEach((e, i) => { if (e.scrollTop || e.scrollLeft) out += ` ${i}:${e.scrollLeft},${e.scrollTop}`; });
    return out;
  }

  function placer(root) {
    const R = root.getBoundingClientRect(), Z = R.width / root.offsetWidth || 1;
    return (n) => { const r = n.getBoundingClientRect(); return { x: (r.left - R.left) / Z, y: (r.top - R.top) / Z, w: r.width / Z, h: r.height / Z }; };
  }

  // compositor(root, { W, H, scale, html2canvas, skip }) gives draw(cx), which paints the stage as it is now into cx
  // (W × H, the stage's CSS px times scale), reusing every layer whose markup hasn't changed, and resolves whether it
  // painted: when the layers, their order, their camera push and the stage's colour are all as the last draw into
  // this cx left them, cx is left as it is (false), so a held frame costs one look at the layers. skip(target) is html2canvas's
  // ignoreElements for a capture of target. stats counts the layers drawn each way.
  function compositor(root, { W, H, scale, html2canvas, skip }) {
    let cache = new Map(), last = { cx: null, layers: [], look: null };
    const stats = { painted: 0, captured: 0, reused: 0, why: {} };
    root.setAttribute('data-export-root', '');
    const onclone = (doc) => { const r = doc.querySelector('[data-export-root]'); if (r) r.style.transform = 'none'; };
    // html2canvas draws the box but not its box-shadow outside it (the dark theme's halo): that is drawn here, under
    // the capture, where the layer's own shadow is one the painter reads and it isn't transformed
    const capture = async (n, place) => {
      const b = place(n);
      const c = await html2canvas(n, { scale, backgroundColor: null, logging: false, ignoreElements: skip(n), onclone });
      let bs = [];
      const s = getComputedStyle(n);
      try { if (s.transform === 'none') bs = shadowsOf(s.boxShadow); } catch (e) { if (!(e instanceof Unsupported)) throw e; }
      if (!bs.length) return { bmp: c, x: b.x * scale, y: b.y * scale };
      const x0 = b.x - MARGIN, y0 = b.y - MARGIN, cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil((b.w + 2 * MARGIN) * scale)); cv.height = Math.max(1, Math.ceil((b.h + 2 * MARGIN) * scale));
      const cx = cv.getContext('2d');
      cx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
      cx.globalAlpha = px(s.opacity);
      boxShadows(cx, bs, b, radiusOf(s), 1, scale);
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalAlpha = 1;
      cx.drawImage(c, Math.round(MARGIN * scale), Math.round(MARGIN * scale));
      free(c);
      return { bmp: cv, x: x0 * scale, y: y0 * scale };
    };
    const render = (n, place) => {
      const b = place(n), x0 = b.x - MARGIN, y0 = b.y - MARGIN;
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil((b.w + 2 * MARGIN) * scale)); cv.height = Math.max(1, Math.ceil((b.h + 2 * MARGIN) * scale));
      const cx = cv.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
      try { paint(cx, n, place, scale); } catch (e) { free(cv); throw e; } // an Unsupported layer goes to html2canvas: its canvas let go now (see free)
      return { bmp: cv, x: x0 * scale, y: y0 * scale };
    };
    let warm = false;
    const draw = async (cx) => {
      // html2canvas's first capture in a page lays text out wrongly in WebKit (stray gaps between words, the Moves
      // highlights missing); one thrown-away capture of the stage first, at the export's scale, and the rest come out right
      if (!warm) { await html2canvas(root, { scale, backgroundColor: null, logging: false, ignoreElements: skip(root), onclone }); warm = true; }
      const place = placer(root);
      const next = new Map(), layers = layersOf(root);
      let changed = false;
      for (const n of layers) {
        const key = n.outerHTML + scrollsOf(n), had = cache.get(n);
        if (had && had.key === key) { next.set(n, had); stats.reused++; continue; }
        changed = true;
        let got;
        try { got = render(n, place); stats.painted++; } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          stats.why[e.message] = (stats.why[e.message] || 0) + 1;
          got = await capture(n, place); stats.captured++;
        }
        next.set(n, { key, ...got });
      }
      // the bitmaps no longer used, let go at once (see free)
      for (const [n, l] of cache) if (next.get(n) !== l) free(l.bmp);
      cache = next;
      // the camera push: the page stays still while exporting and names the zoom on the box it would have transformed
      // (data-push="<scale> <x> <y>", round that point in the stage's CSS px), and its layers are drawn zoomed here, so
      // their bitmaps stay reusable
      const pushes = layers.map((n) => { const p = n.parentElement && n.parentElement.closest('[data-push]'); return p && root.contains(p) ? p.dataset.push : ''; });
      const fades = layers.map((n) => fadeOf(n, root));
      const bg = getComputedStyle(root).backgroundColor, look = bg + '|' + pushes.join('|') + '|' + fades.map((f) => (f.top ? f.outer + '/' + f.inner : '')).join('|');
      const same = !changed && cx === last.cx && look === last.look && layers.length === last.layers.length && layers.every((n, i) => n === last.layers[i]);
      last = { cx, layers, look };
      if (same) return false;
      // as html2canvas drew the whole stage: on white, then the stage's own box, then its layers
      cx.save();
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.imageSmoothingQuality = 'high';
      cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, W, H);
      if (!clear(bg)) { cx.fillStyle = bg; cx.fillRect(0, 0, W, H); }
      // a faded box's layers go on a canvas of their own, drawn at the box's opacity once its last layer is on it
      let top = null, gc = null;
      const flush = () => {
        if (gc) { cx.globalAlpha = top.outer; cx.drawImage(gc.canvas, 0, 0); cx.globalAlpha = 1; free(gc.canvas); }
        top = null; gc = null;
      };
      layers.forEach((n, i) => {
        const f = fades[i];
        if (f.top !== (top && top.el)) {
          flush();
          if (f.top) {
            top = { el: f.top, outer: f.outer };
            if (f.outer > 0) { const c = document.createElement('canvas'); c.width = W; c.height = H; gc = c.getContext('2d'); gc.imageSmoothingQuality = 'high'; }
          }
        }
        const g = f.top ? gc : cx, l = cache.get(n);
        if (!g || !l) return;
        g.globalAlpha = f.top ? f.inner : 1;
        if (!pushes[i]) g.drawImage(l.bmp, Math.round(l.x), Math.round(l.y));
        else {
          const [k, px0, py0] = pushes[i].split(' ').map(Number), ox = px0 * scale, oy = py0 * scale;
          g.drawImage(l.bmp, ox + k * (l.x - ox), oy + k * (l.y - oy), k * l.bmp.width, k * l.bmp.height);
        }
        g.globalAlpha = 1;
      });
      flush();
      cx.restore();
      return true;
    };
    return { draw, stats, done: () => { root.removeAttribute('data-export-root'); for (const l of cache.values()) free(l.bmp); cache = new Map(); for (const c of blurs.values()) free(c); blurs.clear(); } };
  }

  // for the tests: one layer drawn here, with margin CSS px round it (for its shadows), or Unsupported's reason
  function paintLayer(root, n, scale, margin = 0) {
    const place = placer(root);
    const b = place(n), cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round((b.w + 2 * margin) * scale)); cv.height = Math.max(1, Math.round((b.h + 2 * margin) * scale));
    const cx = cv.getContext('2d');
    cx.setTransform(scale, 0, 0, scale, (margin - b.x) * scale, (margin - b.y) * scale);
    try { paint(cx, n, place, scale); } catch (e) { if (e instanceof Unsupported) return e.message; throw e; }
    return cv;
  }

  window.ExportDraw = { compositor, layersOf, paintLayer, Unsupported };
})();
