// Boards: Lichess's 2D ones (lila's public/images/board, AGPL-3.0-or-later, the lila authors and pirouetti), in
// Lichess's order, with its coordinate colours (ui/lib/css/theme/board/_boards.scss), and its Brightness, Contrast and
// Hue sliders. The flat boards are two colours, drawn as squares at once; the others are lila's pictures, unchanged,
// that build.cjs serves next to the page as boards/<file> (vendor/boards), fetched only when chosen, and redrawn here
// through the sliders into one picture (render) that sits under the squares, so an export paints it like any <img>.
(function () {
  // [id, name, file (null: flat), light, dark (the flat boards' squares), on light, on dark (the coordinates' colours)]
  const THEMES = [
    ['brown', 'Brown', null, '#f0d9b5', '#b58863', '#b58863', '#f0d9b5'], // the coordinates as before, not Lichess's #946f51
    ['wood', 'Wood', 'wood.jpg', null, null, '#9b4d0f', '#d8a45b'],
    ['wood2', 'Wood 2', 'wood2.jpg', null, null, '#6c5017', '#a38b5d'],
    ['wood3', 'Wood 3', 'wood3.jpg', null, null, '#755839', '#d0ceca'],
    ['wood4', 'Wood 4', 'wood4.jpg', null, null, '#7b5330', '#caaf7d'],
    ['maple', 'Maple', 'maple.jpg', null, null, '#bc7944', '#e8ceab'],
    ['maple2', 'Maple 2', 'maple2.jpg', null, null, '#996633', '#e2c89f'],
    ['horsey', 'Horsey', 'horsey.jpg', null, null, '#946f51', '#f0d9b5'],
    ['leather', 'Leather', 'leather.jpg', null, null, '#c28e16', '#d1d1c9'],
    ['blue', 'Blue', null, '#dee3e6', '#8ca2ad', '#788a94', '#dee3e6'],
    ['blue2', 'Blue 2', 'blue2.jpg', null, null, '#546f82', '#97b2c7'],
    ['blue3', 'Blue 3', 'blue3.jpg', null, null, '#315991', '#d9e0e6'],
    ['canvas', 'Canvas', 'canvas2.jpg', null, null, '#547388', '#d7daeb'],
    ['blue-marble', 'Blue marble', 'blue-marble.jpg', null, null, '#7c7f87', '#eae6dd'],
    ['ic', 'IC', null, '#ececec', '#c1c18e', '#c1c18e', '#ececec'],
    ['green', 'Green', null, '#ffffdd', '#86a666', '#6d8753', '#ffffdd'],
    ['marble', 'Marble', 'marble.jpg', null, null, '#4f644e', '#93ab91'],
    ['green-plastic', 'Green plastic', 'green-plastic.png', null, null, '#59935d', '#f2f9bb'],
    ['olive', 'Olive', 'olive.jpg', null, null, '#6d6655', '#b8b19f'],
    ['grey', 'Grey', 'grey.jpg', null, null, '#7d7d7d', '#b8b8b8'],
    ['metal', 'Metal', 'metal.jpg', null, null, '#727272', '#c9c9c9'],
    ['newspaper', 'Newspaper', 'newspaper.svg', null, null, '#8d8d8d', '#ffffff'],
    ['purple', 'Purple', null, '#9f90b0', '#7d4a8d', '#7d4a8d', '#9f90b0'],
    ['purple-diag', 'Purple diag', 'purple-diag.png', null, null, '#957ab0', '#e5daf0'],
    ['pink', 'Pink', 'pink-pyramid.png', null, null, '#ed7272', '#e8e9b7'],
  ].map(([id, name, file, light, dark, onLight, onDark]) => ({ id, name, file, light, dark, onLight, onDark }));
  const DEFAULT = THEMES[0].id, IDS = THEMES.map((t) => t.id);
  const valid = (id) => (IDS.includes(id) ? id : DEFAULT);
  const byId = (id) => THEMES.find((t) => t.id === valid(id));
  const url = (id) => { const t = byId(id); return t.file ? `boards/${t.file}` : null; };
  // the picker's tile: lila's 64×32 thumbnail of two squares (newspaper has none: its own picture, see the picker)
  const thumb = (id) => { const t = byId(id); return t.file === 'newspaper.svg' ? null : `boards/${t.file ? t.file.replace(/\.(\w+)$/, '.thumbnail.$1') : t.id + '.thumbnail.png'}`; };

  // the sliders, as Lichess has them: brightness and contrast in %, hue 0–100 (× 3.6°)
  const SLIDERS = { brightness: { min: 20, max: 140, step: 1, def: 100 }, contrast: { min: 40, max: 200, step: 2, def: 100 }, hue: { min: 0, max: 100, step: 1, def: 0 } };
  const num = (v, s) => (Number.isFinite(v) ? Math.min(s.max, Math.max(s.min, v)) : s.def);
  const adjust = (a = {}) => ({ brightness: num(a.brightness, SLIDERS.brightness), contrast: num(a.contrast, SLIDERS.contrast), hue: num(a.hue, SLIDERS.hue) });
  const isDefault = (a) => { a = adjust(a); return a.brightness === 100 && a.contrast === 100 && a.hue === 0; };
  // the same change as a CSS filter, for what has to follow a slider at once: the picker's tiles, and a picture board
  // until it's drawn through the sliders (render)
  const css = (a) => { a = adjust(a); return isDefault(a) ? 'none' : `brightness(${a.brightness}%) contrast(${a.contrast}%) hue-rotate(${Math.round(a.hue * 3.6 * 100) / 100}deg)`; };

  // The sliders' colour change, in Lichess's order (CSS's brightness(), contrast(), then hue-rotate(), each clamped to
  // 0–1 as a CSS filter step is), in sRGB. filter(a) is a function of r, g, b (0–255) to [r, g, b], for the squares
  // A 256-entry table does brightness and contrast (per channel), then hue-rotate()'s matrix (Filter Effects 1,
  // feColorMatrix type="hueRotate") mixes the channels
  const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  function steps(a) {
    a = adjust(a);
    const b = a.brightness / 100, k = a.contrast / 100, th = (a.hue * 3.6 * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    const lut = new Float64Array(256);
    for (let v = 0; v < 256; v++) lut[v] = cl((cl(v * b) - 127.5) * k + 127.5);
    const m = [
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
    ];
    return { lut, m };
  }
  function filter(a) {
    const { lut, m } = steps(a);
    return (r, g, b) => {
      r = lut[r]; g = lut[g]; b = lut[b];
      return [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b].map((v) => Math.round(cl(v)));
    };
  }
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  // a board's colours through the sliders: the squares (flat boards; null for a picture) and the coordinates on them
  function colours(id, a) {
    const t = byId(id), f = filter(a), go = (h) => (h ? toHex(f(...hex(h))) : null);
    return { light: go(t.light), dark: go(t.dark), onLight: go(t.onLight), onDark: go(t.onDark) };
  }
  // the sliders on an RGBA picture's pixels, in place
  // the sliders on an RGBA picture's pixels (a Uint8ClampedArray, which rounds and clamps what it's given), in place
  function filterPixels(px, a) {
    const { lut, m } = steps(a);
    for (let i = 0; i < px.length; i += 4) {
      const r = lut[px[i]], g = lut[px[i + 1]], b = lut[px[i + 2]];
      px[i] = m[0] * r + m[1] * g + m[2] * b; px[i + 1] = m[3] * r + m[4] * g + m[5] * b; px[i + 2] = m[6] * r + m[7] * g + m[8] * b;
    }
    return px;
  }

  // A picture board through the sliders, as a blob: URL of a SIZE px square PNG (the last few kept, so moving a slider
  // back, or a later view, finds it at once; older ones are let go). At the defaults it is lila's file as it is.
  const SIZE = 1024, KEEP = 4, made = new Map(), pictures = {}, decoded = {};
  const key = (id, a) => { a = adjust(a); return `${valid(id)}/${a.brightness}/${a.contrast}/${a.hue}`; };
  const rendered = (id, a) => (byId(id).file ? (isDefault(a) ? url(id) : made.get(key(id, a)) || null) : null);
  function picture(id) {
    if (pictures[id]) return pictures[id];
    const im = new Image(); im.src = url(id);
    return (pictures[id] = im.decode().then(() => { decoded[id] = true; return im; }, (e) => { delete pictures[id]; throw e; }));
  }
  // lila's file for the board has been loaded, so an <img> of it draws at once
  const loaded = (id) => !!decoded[valid(id)];
  async function render(id, a) {
    id = valid(id);
    if (!byId(id).file) return null;
    const k = key(id, a), have = rendered(id, a);
    if (have && isDefault(a)) { await picture(id); return have; }
    if (have) { made.delete(k); made.set(k, have); return have; } // the newest again, so the one shown is let go last
    const im = await picture(id);
    if (made.has(k)) return made.get(k);
    const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(im, 0, 0, SIZE, SIZE);
    const d = cx.getImageData(0, 0, SIZE, SIZE);
    filterPixels(d.data, a);
    cx.putImageData(d, 0, 0);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    if (made.has(k)) return made.get(k);
    const u = URL.createObjectURL(blob);
    made.set(k, u);
    while (made.size > KEEP) { const [old, ou] = made.entries().next().value; made.delete(old); setTimeout(() => URL.revokeObjectURL(ou), 5000); }
    return u;
  }

  window.BoardThemes = { THEMES, DEFAULT, SLIDERS, valid, byId, url, thumb, adjust, isDefault, css, filter, colours, filterPixels, rendered, loaded, render };
})();
