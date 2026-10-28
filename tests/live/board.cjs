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

module.exports = { loadedOn, boardBox, square, namePending };
