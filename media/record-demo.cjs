// Records media/demo.mp4, the README's showcase video, from a local build served by tests/live/serve.cjs:
//   node build.cjs && node tests/live/serve.cjs &   then   node media/record-demo.cjs [base URL]
// Chromium's screencast (CDP) gives one frame per repaint with its timestamp; ffmpeg turns them into a constant-rate
// MP4. A drawn cursor stands in for the mouse, which headless screencasts don't show. Needs Playwright and ffmpeg.
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const pw = (() => { try { return require('playwright'); } catch (e) { return require(path.join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')); } })();

const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const ROOT = path.join(__dirname, '..');
const PGN = fs.readFileSync(path.join(__dirname, 'demo-game.pgn'));
const W = 1440, H = 900, FPS = 30;
const WORK = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'demo-'));
const CHROMIUM = process.env.CHROMIUM_PATH || ['/var/lib/flatpak/exports/bin/io.github.ungoogled_software.ungoogled_chromium'].find((f) => fs.existsSync(f));

// a browser left running past a low-memory floor takes the machine down with it: kill everything first
const watchdog = setInterval(() => {
  const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
  if (m && +m[1] < 2200 * 1024) { console.error('low memory, stopping'); process.kill(0, 'SIGKILL'); }
}, 500);

const CURSOR = `(() => {
  const draw = () => {
    if (document.getElementById('demo-cursor')) return;
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M1 1 L1 23 L7 18 L11 28 L15 26 L11 17 L19 17 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;left:-50px;top:-50px;z-index:2147483647;pointer-events:none;transition:transform .08s';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.transform = 'scale(.85)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = ''; }, true);
  };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', draw) : draw();
})()`;

// one clip: a fresh context whose repaints are saved as numbered JPEGs with their times
async function clip(browser, name, ctxOpts, script) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const dir = path.join(WORK, name); fs.mkdirSync(dir);
  const frames = [];
  let recording = false;
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (!recording) return;
    const f = path.join(dir, String(frames.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    frames.push({ f, t: metadata.timestamp });
  });
  const vp = ctxOpts.viewport, dpr = ctxOpts.deviceScaleFactor || 1;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: vp.width * dpr, maxHeight: vp.height * dpr });
  const rec = { start: () => { recording = true; }, hold: (ms) => page.waitForTimeout(ms) };
  await script(page, rec);
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await ctx.close();
  // ffmpeg concat list: each frame shown until the next one
  const list = frames.map((fr, i) => `file '${fr.f}'\nduration ${((frames[i + 1] ? frames[i + 1].t : end) - fr.t).toFixed(4)}`).join('\n') + `\nfile '${frames.at(-1).f}'\n`;
  fs.writeFileSync(path.join(dir, 'list.txt'), list);
  console.log(name, frames.length, 'frames', (end - frames[0].t).toFixed(1) + 's');
  return path.join(dir, 'list.txt');
}

// the pointer glides to an element (or point) the way a hand would, then clicks
async function glide(page, target, { click = true, steps = 30 } = {}) {
  const b = typeof target.boundingBox === 'function' ? await target.boundingBox() : target;
  const x = b.x + (b.width || 0) / 2, y = b.y + (b.height || 0) / 2;
  await page.mouse.move(x, y, { steps });
  if (click) { await page.waitForTimeout(150); await page.mouse.click(x, y); }
}
// Upscayl-style zoom: the page eases in on the panels whose headings match (union of their boxes), or back out with
// none. A CSS transform on <body>, so text stays sharp; the drawn cursor sits outside it at its true size.
async function zoom(page, headings = [], max = 1.7) {
  await page.evaluate(({ headings, max, W, H }) => {
    const b = document.body, z = window.__zoom || { s: 1, tx: 0, ty: 0 };
    if (!window.__zoom) { b.style.transformOrigin = '0 0'; b.style.transition = 'transform 1s cubic-bezier(.65,0,.35,1)'; }
    const rects = headings.map((h) => {
      const re = new RegExp(h, 'i');
      let e = [...b.querySelectorAll('*')].find((x) => x.children.length === 0 && re.test(x.textContent.trim()) && x.getBoundingClientRect().width > 0);
      while (e && e.parentElement && (e.getBoundingClientRect().height < 150 || e.getBoundingClientRect().width < 250)) e = e.parentElement;
      const r = e.getBoundingClientRect();
      // back to unzoomed page coordinates
      return { l: (r.left - z.tx) / z.s, t: (r.top - z.ty) / z.s, r: (r.right - z.tx) / z.s, b: (r.bottom - z.ty) / z.s };
    });
    let n = { s: 1, tx: 0, ty: 0 };
    if (rects.length) {
      const l = Math.min(...rects.map((r) => r.l)), t = Math.min(...rects.map((r) => r.t)), r = Math.max(...rects.map((r) => r.r)), bt = Math.max(...rects.map((r) => r.b));
      const sc = Math.min(max, (W * 0.94) / (r - l), (H * 0.94) / (bt - t));
      const clamp = (v, lo) => Math.min(0, Math.max(lo, v));
      n = { s: sc, tx: clamp(W / 2 - sc * (l + r) / 2, W - sc * W), ty: clamp(H / 2 - sc * (t + bt) / 2, H - sc * H) };
    }
    window.__zoom = n;
    b.style.transform = `translate(${n.tx}px, ${n.ty}px) scale(${n.s})`;
  }, { headings, max, W, H });
  await page.waitForTimeout(1100);
}
async function boardBox(page) {
  return page.evaluate(() => {
    const sq = [...document.querySelectorAll('img')].map((i) => i.getBoundingClientRect()).filter((r) => r.width > 40);
    const w = sq.map((r) => r.width).sort((a, b) => a - b)[Math.floor(sq.length / 2)];
    const board = [...document.querySelectorAll('div')].map((d) => d.getBoundingClientRect()).find((r) => Math.abs(r.width - 8 * w) < 6 && Math.abs(r.height - 8 * w) < 6);
    return { x0: board.left, y0: board.top, sq: board.width / 8 };
  });
}
const square = (b, s) => ({ x: b.x0 + (s.charCodeAt(0) - 97 + 0.5) * b.sq, y: b.y0 + (8 - +s[1] + 0.5) * b.sq });
async function drag(page, from, to) {
  const b = await boardBox(page), a = square(b, from), z = square(b, to);
  await page.mouse.move(a.x, a.y, { steps: 25 });
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 40 });
  await page.waitForTimeout(120);
  await page.mouse.up();
}
const ready = async (page) => { await page.locator('.dock-primary').waitFor({ state: 'attached' }); await page.waitForFunction(() => document.querySelectorAll('img').length >= 32); };

(async () => {
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM });
  const lists = [];
  try {
    // shots 1-4: the desktop page
    lists.push(await clip(browser, 'desktop', { viewport: { width: W, height: H } }, async (page, rec) => {
      await page.goto(BASE); await ready(page);
      await zoom(page);
      await page.mouse.move(700, 450);
      await page.waitForTimeout(800);
      rec.start();
      await rec.hold(1200);
      // 1. load the Game of the Century
      const chooser = page.waitForEvent('filechooser');
      await glide(page, page.getByRole('button', { name: 'Load game' }));
      await (await chooser).setFiles({ name: 'Byrne-Fischer_1956.pgn', mimeType: 'application/x-chess-pgn', buffer: PGN });
      await page.getByText('Donald Byrne').first().waitFor();
      await rec.hold(1800);
      // 2. it plays from move 10, into White's mistake and Fischer's 11...Na4!!: eval graph, move ratings, commentary
      await page.getByRole('button', { name: 'Qc5?!' }).scrollIntoViewIfNeeded();
      await glide(page, page.getByRole('button', { name: 'Qc5?!' }));
      await rec.hold(700);
      await glide(page, page.getByRole('button', { name: 'Play (space)' }));
      await page.mouse.move(1000, 640, { steps: 30 });
      await rec.hold(10000);
      await glide(page, page.getByRole('button', { name: 'Pause (space)' }));
      // 3. the queen sacrifice
      await page.getByRole('button', { name: 'Be6!!' }).scrollIntoViewIfNeeded();
      await glide(page, page.getByRole('button', { name: 'Be6!!' }));
      await rec.hold(900);
      await zoom(page, ['^commentary$', '^analysis$']);
      await rec.hold(2800);
      await zoom(page);
      // 4. try 18.Bxe6 instead: Stockfish finds the smothered mate
      await drag(page, 'c4', 'e6');
      await page.waitForFunction(() => /your move · .*(stockfish’s choice|cp vs|as good as|mate)/i.test(document.body.innerText), null, { timeout: 45000 }).catch(() => {});
      await page.mouse.move(1000, 560, { steps: 30 });
      await rec.hold(600);
      await zoom(page, ['^analysis$']);
      await rec.hold(3200);
      await zoom(page);
      // ... and the opening explorer on the free board
      await glide(page, page.getByRole('button', { name: 'Play/Explore' }));
      await rec.hold(500);
      await glide(page, page.getByRole('button', { name: 'Starting position' }));
      await rec.hold(1500);
      await drag(page, 'e2', 'e4');
      await rec.hold(2000);
      await drag(page, 'c7', 'c5');
      await rec.hold(700);
      await zoom(page, ['^opening explorer$']);
      await rec.hold(2800);
    }));
    // 5. the phone layout
    lists.push(await clip(browser, 'phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, async (page, rec) => {
      await page.goto(BASE); await ready(page);
      await page.setInputFiles('#game-files', { name: 'Byrne-Fischer_1956.pgn', mimeType: 'application/x-chess-pgn', buffer: PGN });
      await page.getByText('Donald Byrne').first().waitFor();
      await page.getByRole('button', { name: 'Be6!!' }).click().catch(() => {});
      await page.waitForTimeout(1500);
      rec.start();
      await rec.hold(1500);
      await page.getByRole('button', { name: 'Play (space)' }).click();
      await rec.hold(6000);
    }));
    // 6. export as a video
    lists.push(await clip(browser, 'export', { viewport: { width: W, height: H } }, async (page, rec) => {
      await page.goto(BASE); await ready(page);
      await page.setInputFiles('#game-files', { name: 'Byrne-Fischer_1956.pgn', mimeType: 'application/x-chess-pgn', buffer: PGN });
      await page.getByText('Donald Byrne').first().waitFor();
      await page.getByRole('button', { name: 'Be6!!' }).click();
      await zoom(page);
      await page.mouse.move(1000, 640);
      await page.waitForTimeout(1500);
      rec.start();
      await rec.hold(600);
      await glide(page, page.getByRole('button', { name: 'Settings' }));
      await rec.hold(800);
      await glide(page, page.getByRole('tab', { name: 'Export' }));
      await rec.hold(500);
      await zoom(page, ['^export as$']);
      await glide(page, page.getByRole('button', { name: /^Export (video|animated WebP)/ }), { click: false });
      await rec.hold(3000);
    }));
  } finally { await browser.close(); }

  // each clip to a 1440×900 constant-rate piece (the phone one centred on the page's background), then joined
  const bg = '0xF3ECE2';
  const parts = lists.map((list, i) => {
    const out = path.join(WORK, `part${i}.mp4`);
    const fit = i !== 1 ? `scale=${W}:${H}` : `scale=-2:${H - 40},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg}`;
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `${fit},fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-threads', '4', out]);
    return out;
  });
  const out = path.join(__dirname, 'demo.mp4');
  const joined = path.join(WORK, 'join.txt');
  fs.writeFileSync(joined, parts.map((p) => `file '${p}'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', joined, '-c', 'copy', '-movflags', '+faststart', out]);
  fs.rmSync(WORK, { recursive: true, force: true });
  clearInterval(watchdog);
  console.log('wrote', out, (fs.statSync(out).size / 1e6).toFixed(1), 'MB');
})().catch((e) => { console.error(e); process.exit(1); });
