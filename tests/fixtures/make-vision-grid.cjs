// Draws the board auto-crop's test pictures (tests/fixtures/vision-grid/*.pgm and cases.json, plus two PNGs for the
// live test) in one Chromium, and converts vision-lichess.png and vision-diagram.png the same way. Each picture is
// screenshotted, scaled so its longest side is at most 1024 px and turned to luma, as the dialog does. Every drawn
// board's grid edges come from the page, so cases.json's boxes are exact. Run with the sandbox disabled:
//   NODE_PATH=<an npx Playwright, see the browser-tests skill> node tests/fixtures/make-vision-grid.cjs
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const pw = (() => { try { return require('playwright'); } catch (e) { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } })();

const DIR = __dirname, OUT = path.join(DIR, 'vision-grid'), SIDE = 1024;
const LICHESS = '2r3k1/pp3pp1/4p2p/3pP3/3P1P2/P1rB4/1P4PP/R4RK1';
const DIAGRAM = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR';
const ENDGAME = '8/5k2/3p4/1p1P1p2/1P3P2/6K1/8/8';
const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const SERIF = "'DejaVu Serif', 'Liberation Serif', serif", SANS = "'DejaVu Sans', 'Liberation Sans', sans-serif"; // single quotes: they go in style attributes

function squares(fen) {
  const out = [];
  for (const row of fen.split('/')) for (const ch of row) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) out.push(null); else out.push(ch); }
  return out;
}

// one board as absolutely placed HTML, its grid (the squares) in a .grid element
function board({ fen, side = 'w', sq = 56, light = '#f0f0f0', dark = '#a0a0a0', frame = 0, labels = null, font = SERIF, lines = false, marks = '' }) {
  const b = squares(fen), n = 8 * sq;
  let cells = '';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const i = side === 'w' ? r * 8 + c : 63 - (r * 8 + c), p = b[i], lit = (r + c) % 2 === 0;
    const bg = lines ? light : lit ? light : dark;
    let lab = '';
    if (labels === 'inside') {
      const col = lit ? dark : light, file = 'abcdefgh'[side === 'w' ? c : 7 - c], rank = side === 'w' ? 8 - r : r + 1;
      if (c === 0) lab += `<span style="position:absolute;left:3px;top:1px;font:bold ${Math.round(sq * 0.2)}px ${font};color:${col}">${rank}</span>`;
      if (r === 7) lab += `<span style="position:absolute;right:3px;bottom:0;font:bold ${Math.round(sq * 0.2)}px ${font};color:${col}">${file}</span>`;
    }
    cells += `<div style="position:absolute;left:${c * sq}px;top:${r * sq}px;width:${sq}px;height:${sq}px;background:${bg};${lines ? 'box-shadow:inset 0 0 0 1px #555;' : ''}">${lab}`
      + (p ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:${Math.round(sq * 0.78)}px ${SANS};line-height:1;color:#000;font-variant-emoji:text">${GLYPH[p]}&#xFE0E;</span>` : '') + '</div>';
  }
  let outside = '';
  if (labels === 'outside') {
    for (let k = 0; k < 8; k++) {
      const rank = side === 'w' ? 8 - k : k + 1, file = 'abcdefgh'[side === 'w' ? k : 7 - k];
      outside += `<div style="position:absolute;left:${-frame - sq * 0.5}px;top:${k * sq}px;width:${sq * 0.35}px;height:${sq}px;display:flex;align-items:center;justify-content:center;font:${Math.round(sq * 0.36)}px ${font}">${rank}</div>`;
      outside += `<div style="position:absolute;top:${n + frame + sq * 0.12}px;left:${k * sq}px;width:${sq}px;height:${sq * 0.4}px;display:flex;align-items:center;justify-content:center;font:${Math.round(sq * 0.36)}px ${font}">${file}</div>`;
    }
  }
  const fr = frame ? `<div style="position:absolute;left:${-frame}px;top:${-frame}px;width:${n + 2 * frame}px;height:${n + 2 * frame}px;background:#222"></div>` : '';
  return `<div style="position:relative;width:${n}px;height:${n}px">${fr}${outside}<div class="grid" style="position:absolute;left:0;top:0;width:${n}px;height:${n}px">${cells}${marks}</div></div>`;
}

// a seeded noise canvas laid over the page, for the photo-like pictures
const NOISE = `<canvas id="noise" style="position:absolute;left:0;top:0;z-index:10;pointer-events:none"></canvas><script>
  const cv = document.getElementById('noise'), W = document.body.scrollWidth, H = document.body.scrollHeight;
  cv.width = W; cv.height = H; const g = cv.getContext('2d'), im = g.createImageData(W, H); let s = 12345;
  for (let i = 0; i < W * H; i++) { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; const v = (s >> 16) & 255; im.data.set([v, v, v, 60], i * 4); }
  g.putImageData(im, 0, 0);
</script>`;
const TEXT = '<p style="font:18px ' + SERIF + ';max-width:1400px;line-height:1.5">' + 'The position after White’s twenty-third move shows the knight heading for d5, where it eyes both c7 and e7. '.repeat(6) + '</p>';
const page = (inner, pad = 40, extra = '') => `<!doctype html><html><body style="margin:0;background:#fff"><div id="pic" style="display:inline-block;position:relative;padding:${pad}px;background:#fff">${inner}</div>${extra}</body></html>`;

const HL = '<div style="position:absolute;left:240px;top:360px;width:60px;height:60px;background:rgba(155,199,0,0.41)"></div><div style="position:absolute;left:240px;top:240px;width:60px;height:60px;background:rgba(155,199,0,0.41)"></div>'
  + '<svg style="position:absolute;left:0;top:0" width="480" height="480"><line x1="90" y1="390" x2="270" y2="150" stroke="rgba(21,120,27,0.8)" stroke-width="12" stroke-linecap="round"/></svg>';

const CASES = {
  'framed-white': { side: 'w', fen: LICHESS, html: page(board({ fen: LICHESS, frame: 6, labels: 'outside' }), 50) },
  'framed-black': { side: 'b', fen: LICHESS, html: page(board({ fen: LICHESS, side: 'b', frame: 6, labels: 'outside' }), 50), png: 'vision-black-labels.png' },
  'inside-white': { side: 'w', fen: DIAGRAM, html: page(board({ fen: DIAGRAM, sq: 64, light: '#ebecd0', dark: '#739552', labels: 'inside', font: SANS }), 0) },
  'inside-black': { side: 'b', fen: DIAGRAM, html: page(board({ fen: DIAGRAM, side: 'b', sq: 64, light: '#ebecd0', dark: '#739552', labels: 'inside', font: SANS }), 0) },
  nolabels: { side: null, fen: ENDGAME, html: page(board({ fen: ENDGAME, sq: 60, light: '#f0d9b5', dark: '#b58863' }), 20) },
  highlights: { side: null, fen: ENDGAME, html: page(board({ fen: ENDGAME, sq: 60, light: '#f0d9b5', dark: '#b58863', marks: HL }), 20) },
  'small-on-page': { side: 'w', fen: LICHESS, html: `<!doctype html><html><body style="margin:0;background:#fff"><div id="pic" style="position:relative;width:1600px;height:2200px;background:#fff;padding:0">${TEXT}<div style="margin:60px 0 60px 500px;width:300px">${board({ fen: LICHESS, sq: 36, frame: 4, labels: 'outside' })}</div>${TEXT}${TEXT}</div></body></html>` },
  'two-boards': { side: null, fen: null, html: page(`<div style="display:flex;gap:60px">${board({ fen: LICHESS, sq: 40 })}${board({ fen: DIAGRAM, sq: 40 })}</div>`, 40) },
  sideways: { side: null, fen: null, html: page(`<div style="transform:rotate(90deg)">${board({ fen: LICHESS, frame: 6, labels: 'outside' })}</div>`, 70) },
  onecolour: { side: null, fen: LICHESS, box: null, html: page(board({ fen: LICHESS, lines: true, light: '#e4e4e4' }), 30) },
  noboard: { side: null, fen: null, box: null, html: `<!doctype html><html><body style="margin:0"><div id="pic" style="position:relative;width:900px;height:700px;background:linear-gradient(135deg,#8a9bb0,#d8c9a8)">${TEXT}</div>${NOISE}</body></html>`, png: 'vision-noboard.png' },
  photo: { side: null, fen: ENDGAME, box: null, html: `<!doctype html><html><body style="margin:0"><div id="pic" style="position:relative;width:800px;height:640px;background:#6b5a48;perspective:700px;display:flex;align-items:center;justify-content:center"><div style="transform:rotateX(35deg) rotateZ(4deg)">${board({ fen: ENDGAME, sq: 60, light: '#f0d9b5', dark: '#b58863' })}</div></div>${NOISE}</body></html>` },
};

// the picture as luma, scaled so its longest side is at most SIDE, as a PGM
async function pgmOf(p, png) {
  const { w, h, b64 } = await p.evaluate(async ({ src, SIDE }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const k = Math.min(1, SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = (77 * d[i * 4] + 150 * d[i * 4 + 1] + 29 * d[i * 4 + 2]) >> 8;
    let s = '';
    for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
    return { w, h, b64: btoa(s) };
  }, { src: 'data:image/png;base64,' + png.toString('base64'), SIDE });
  return Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), Buffer.from(b64, 'base64')]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch({ executablePath: '/var/lib/flatpak/exports/bin/io.github.ungoogled_software.ungoogled_chromium' });
  const p = await browser.newPage({ viewport: { width: 1700, height: 2300 }, deviceScaleFactor: 1 });
  const cases = {};
  // the existing fixtures: Lichess's export fills the picture; the diagram's grid measured from the file
  cases.lichess = { box: { x0: 0, y0: 0, x1: 1, y1: 1 }, side: 'w', fen: LICHESS };
  cases.diagram = { box: { x0: 50 / 612, y0: 50 / 612, x1: 562 / 612, y1: 562 / 612 }, side: 'w', fen: DIAGRAM };
  for (const name of ['lichess', 'diagram']) fs.writeFileSync(path.join(OUT, name + '.pgm'), await pgmOf(p, fs.readFileSync(path.join(DIR, `vision-${name}.png`))));
  for (const [name, c] of Object.entries(CASES)) {
    await p.setContent(c.html);
    await p.evaluate(() => document.fonts.ready);
    const pic = p.locator('#pic'), r = await pic.boundingBox();
    const png = await pic.screenshot();
    const grids = await p.$$eval('.grid', (els) => els.map((e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }));
    let box = null;
    if (!('box' in c) && grids.length === 1) {
      const g = grids[0];
      box = { x0: (g.x - r.x) / r.width, y0: (g.y - r.y) / r.height, x1: (g.x + g.w - r.x) / r.width, y1: (g.y + g.h - r.y) / r.height };
    }
    cases[name] = { box, side: c.side, fen: c.fen };
    fs.writeFileSync(path.join(OUT, name + '.pgm'), await pgmOf(p, png));
    fs.writeFileSync(path.join(process.env.TMPDIR || '/tmp', `vision-grid-${name}.png`), png);
    if (c.png) fs.writeFileSync(path.join(DIR, c.png), png);
    console.log(name, Math.round(r.width) + '×' + Math.round(r.height), box ? Object.values(box).map((v) => v.toFixed(4)).join(' ') : 'null');
  }
  fs.writeFileSync(path.join(OUT, 'cases.json'), JSON.stringify(cases, null, 1) + '\n');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
