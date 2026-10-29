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
  const dropShadowOf = (f) => {
    if (!f || f === 'none') return null;
    const m = f.match(/^drop-shadow\((.*)\)$/);
    if (!m || /drop-shadow/.test(m[1])) no('filter ' + f);
    return shadowOf(m[1].trim(), 'filter');
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
  function paint(cx, node, place, dev, a = 1, k = 1, rot = 0, shadow = null) {
    const s = getComputedStyle(node);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return;
    if (s.maskImage && s.maskImage !== 'none') no('mask');
    if (s.webkitMaskImage && s.webkitMaskImage !== 'none') no('mask');
    if (s.clipPath && s.clipPath !== 'none') no('clip-path');
    if (s.mixBlendMode && s.mixBlendMode !== 'normal') no('blend');
    a *= px(s.opacity);
    if (a <= 0) return;
    const m = matrixOf(s.transform);
    k *= m.k; rot += m.rot;
    const own = dropShadowOf(s.filter);
    if (own && shadow) no('nested filters');
    shadow = own || shadow;
    const tag = node.tagName.toLowerCase();
    if (tag === 'svg') return paintSvg(cx, node, place, dev, a, k, rot, shadow);
    if (tag === 'img') {
      if (rot) no('rotated image');
      if (!node.complete || !node.naturalWidth) no('image not loaded');
      const b = place(node);
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
    const bw = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(px);
    const border = bw[0] > 0 && !clear(s.borderTopColor);
    if (new Set(bw).size > 1 || (border && (s.borderTopStyle !== 'solid' || new Set([s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor]).size > 1))) no('border');
    const bs = s.boxShadow === 'none' ? null : shadowOf(s.boxShadow, 'box-shadow');
    if ((bg || img || border || bs) && (rot || shadow)) no('box under a rotation or filter');
    if (s.outlineStyle !== 'none' && px(s.outlineWidth) > 0) no('outline');
    cx.save(); cx.globalAlpha = a;
    if (bs) {
      const sp = bs.spread * k;
      if (bs.blur > 0) {
        // the shadow alone: the shape is drawn far off the canvas and its shadow moved back
        const far = 1e4;
        Object.assign(cx, { shadowColor: bs.color, shadowOffsetX: (bs.x * k + far) * dev, shadowOffsetY: bs.y * k * dev, shadowBlur: bs.blur * k * dev, fillStyle: '#000' });
        roundRect(cx, b.x - sp - far, b.y - sp, b.w + 2 * sp, b.h + 2 * sp, r + sp); cx.fill();
        Object.assign(cx, { shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 });
      } else {
        cx.fillStyle = bs.color; roundRect(cx, b.x + bs.x * k - sp, b.y + bs.y * k - sp, b.w + 2 * sp, b.h + 2 * sp, r + sp); cx.fill();
      }
    }
    if (bg) { cx.fillStyle = s.backgroundColor; roundRect(cx, b.x, b.y, b.w, b.h, r); cx.fill(); }
    if (img) { cx.fillStyle = gradientOf(cx, s.backgroundImage, b); roundRect(cx, b.x, b.y, b.w, b.h, r); cx.fill(); }
    if (border) {
      const w = bw[0] * k;
      cx.strokeStyle = s.borderTopColor; cx.lineWidth = w;
      roundRect(cx, b.x + w / 2, b.y + w / 2, b.w - w, b.h - w, Math.max(0, r - w / 2)); cx.stroke();
    }
    cx.restore();
    // what's in it, clipped to it where it hides its overflow
    const clip = s.overflowX !== 'visible' || s.overflowY !== 'visible';
    if (clip && (node.scrollTop || node.scrollLeft)) no('scrolled box');
    cx.save();
    if (clip) {
      if (rot) no('rotated clip');
      const w = border ? bw[0] * k : 0;
      roundRect(cx, b.x + w, b.y + w, b.w - 2 * w, b.h - 2 * w, Math.max(0, r - w)); cx.clip();
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
      else paint(cx, c, place, dev, a, k, rot, shadow);
    }
    cx.restore();
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

  // The stage's layers in paint order: a box that draws nothing itself (no background, border, shadow, opacity,
  // transform, filter or clip, and no text of its own) is opened up into its children
  function layersOf(node, out = []) {
    const kids = [...node.children].map((c, i) => ({ c, i, s: getComputedStyle(c) })).filter((x) => x.s.display !== 'none');
    const z = (x) => (x.s.position === 'static' ? 0 : parseInt(x.s.zIndex, 10) || 0);
    kids.sort((p, q) => z(p) - z(q) || p.i - q.i);
    for (const { c, s } of kids) {
      const plain = c.children.length && clear(s.backgroundColor) && s.backgroundImage === 'none' && s.boxShadow === 'none' && px(s.borderTopWidth) + px(s.borderRightWidth) + px(s.borderBottomWidth) + px(s.borderLeftWidth) === 0
        && s.opacity === '1' && s.transform === 'none' && s.filter === 'none' && s.overflowX === 'visible' && s.overflowY === 'visible' && s.visibility === 'visible'
        && ![...c.childNodes].some((t) => t.nodeType === 3 && t.data.trim());
      if (plain) layersOf(c, out); else out.push(c);
    }
    return out;
  }

  // compositor(root, { W, H, scale, html2canvas, skip }) gives draw(cx), which paints the stage as it is now into cx
  // (W × H, the stage's CSS px times scale), reusing every layer whose markup hasn't changed. skip(target) is
  // html2canvas's ignoreElements for a capture of target. stats counts the layers drawn each way.
  function compositor(root, { W, H, scale, html2canvas, skip }) {
    let cache = new Map();
    const stats = { painted: 0, captured: 0, reused: 0, why: {} };
    root.setAttribute('data-export-root', '');
    const onclone = (doc) => { const r = doc.querySelector('[data-export-root]'); if (r) r.style.transform = 'none'; };
    const capture = async (n, place) => {
      const b = place(n);
      const c = await html2canvas(n, { scale, backgroundColor: null, logging: false, ignoreElements: skip(n), onclone });
      return { bmp: c, x: b.x * scale, y: b.y * scale };
    };
    const render = (n, place) => {
      const b = place(n), x0 = b.x - MARGIN, y0 = b.y - MARGIN;
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil((b.w + 2 * MARGIN) * scale)); cv.height = Math.max(1, Math.ceil((b.h + 2 * MARGIN) * scale));
      const cx = cv.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
      paint(cx, n, place, scale);
      return { bmp: cv, x: x0 * scale, y: y0 * scale };
    };
    let warm = false;
    const draw = async (cx) => {
      // html2canvas's first capture in a page lays text out wrongly in WebKit (stray gaps between words, the Moves
      // highlights missing); one thrown-away capture of the stage first, at the export's scale, and the rest come out right
      if (!warm) { await html2canvas(root, { scale, backgroundColor: null, logging: false, ignoreElements: skip(root), onclone }); warm = true; }
      const R = root.getBoundingClientRect(), Z = R.width / root.offsetWidth || 1;
      // a box's place on the stage in its own (untransformed) CSS px
      const place = (n) => { const r = n.getBoundingClientRect(); return { x: (r.left - R.left) / Z, y: (r.top - R.top) / Z, w: r.width / Z, h: r.height / Z }; };
      const next = new Map(), layers = layersOf(root);
      for (const n of layers) {
        const key = n.outerHTML, had = cache.get(n);
        if (had && had.key === key) { next.set(n, had); stats.reused++; continue; }
        let got;
        try { got = render(n, place); stats.painted++; } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          stats.why[e.message] = (stats.why[e.message] || 0) + 1;
          got = await capture(n, place); stats.captured++;
        }
        next.set(n, { key, ...got });
      }
      cache = next;
      // as html2canvas drew the whole stage: on white, then the stage's own box, then its layers
      cx.save();
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, W, H);
      const rs = getComputedStyle(root);
      if (!clear(rs.backgroundColor)) { cx.fillStyle = rs.backgroundColor; cx.fillRect(0, 0, W, H); }
      for (const n of layers) { const l = cache.get(n); if (l) cx.drawImage(l.bmp, Math.round(l.x), Math.round(l.y)); }
      cx.restore();
    };
    return { draw, stats, done: () => root.removeAttribute('data-export-root') };
  }

  // for the tests: one layer drawn here, or Unsupported's reason
  function paintLayer(root, n, scale) {
    const R = root.getBoundingClientRect(), Z = R.width / root.offsetWidth || 1;
    const place = (x) => { const r = x.getBoundingClientRect(); return { x: (r.left - R.left) / Z, y: (r.top - R.top) / Z, w: r.width / Z, h: r.height / Z }; };
    const b = place(n), cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(b.w * scale)); cv.height = Math.max(1, Math.round(b.h * scale));
    const cx = cv.getContext('2d');
    cx.setTransform(scale, 0, 0, scale, -b.x * scale, -b.y * scale);
    try { paint(cx, n, place, scale); } catch (e) { if (e instanceof Unsupported) return e.message; throw e; }
    return cv;
  }

  window.ExportDraw = { compositor, layersOf, paintLayer, Unsupported };
})();
