// Board helpers shared by the live tests (site.test.cjs, android.test.cjs)
// the page has rendered and the board has its pieces
const loadedOn = async (page) => { await page.locator('.dock-primary').waitFor({ state: 'attached' }); await page.waitForFunction(() => document.querySelectorAll('img').length >= 32); };

// The board is where the 32 pieces stand at the start: the union of the piece images' boxes
async function boardBox(page) {
  return page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].map((i) => i.getBoundingClientRect()).filter((r) => r.width > 10);
    const w = imgs.map((r) => Math.round(r.width)).sort((a, b) => a - b)[Math.floor(imgs.length / 2)];
    const pcs = imgs.filter((r) => Math.abs(r.width - w) < 2);
    const x0 = Math.min(...pcs.map((r) => r.left)), y0 = Math.min(...pcs.map((r) => r.top));
    const x1 = Math.max(...pcs.map((r) => r.right)), y1 = Math.max(...pcs.map((r) => r.bottom));
    return { n: pcs.length, x0, y0, sq: (x1 - x0) / 8, h: y1 - y0 };
  });
}
// The board and the stage area have held still for two animation frames: WebKit on GitHub has read a box mid-layout
// (the board sized for the slim bar's area while the area still read the whole window; a drag that found no piece)
const settled = (page, timeout = 5000) => page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll('img')].map((i) => i.getBoundingClientRect()).filter((r) => r.width > 10);
  const now = [document.querySelector('.stage-area')?.clientHeight, ...imgs.map((r) => [r.left, r.top, r.width, r.height].map(Math.round).join(','))].join(';');
  const seen = window.__settledSeen || [];
  window.__settledSeen = [...seen, now].slice(-3);
  return seen.length >= 2 && seen.every((s) => s === now);
}, null, { polling: 'raf', timeout }).finally(() => page.evaluate(() => { delete window.__settledSeen; }));
const square = (b, name, flipped) => (flipped
  ? { x: b.x0 + (7 - (name.charCodeAt(0) - 97) + 0.5) * b.sq, y: b.y0 + (+name[1] - 1 + 0.5) * b.sq }
  : { x: b.x0 + (name.charCodeAt(0) - 97 + 0.5) * b.sq, y: b.y0 + (8 - +name[1] + 0.5) * b.sq });

// A goto or reload that times out says which requests were still loading and for how long: in CI a page sometimes
// never fires load in 30 s, in every browser, and the error alone doesn't say what held it back
function namePending(page) {
  const loading = new Map();
  page.on('request', (r) => loading.set(r, Date.now()));
  for (const ev of ['requestfinished', 'requestfailed']) page.on(ev, (r) => loading.delete(r));
  for (const m of ['goto', 'reload']) {
    const f = page[m].bind(page);
    page[m] = async (...args) => {
      try { return await f(...args); } catch (e) {
        if (e.name === 'TimeoutError') {
          const now = Date.now(), list = [...loading].map(([r, t]) => `${r.url().slice(0, 140)} (${r.resourceType()}, ${Math.round((now - t) / 1000)} s)`);
          e.message += `\nstill loading: ${list.join(', ') || 'nothing'}`;
        }
        throw e;
      }
    };
  }
  return page;
}

module.exports = { loadedOn, boardBox, settled, square, namePending };
