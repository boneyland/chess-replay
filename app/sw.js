// The site's service worker (build.cjs fills in VERSION, LOCAL and REMOTE): it keeps a copy of the page and everything
// it loads, so the player, Stockfish and the export work with no connection. Only Ask Queen, Hugging Face sign-in and
// the endgame tablebase need the network. The page itself comes from the network first, so a deploy shows up at once;
// the files around it change only with a deploy that changes this file's VERSION, so they come from the copy first.
const VERSION = '__VERSION__';
const LOCAL = __LOCAL__; // next to the page, the page first
const REMOTE = __REMOTE__; // pinned CDN files: React, the export's libraries, the fonts' stylesheet
const PAGE = 'chess-game-video.html';
const CACHE = 'chess-replay-' + VERSION;
// hosts whose files are kept as they're used (the fonts' stylesheet names font files by the browser that asks)
const KEEP_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
// a page that hasn't answered by then comes from the copy (a connection that is up but not getting through)
const PAGE_TIMEOUT_MS = 6000;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(LOCAL);
    // the CDN files are kept if they can be fetched now (three tries each: one font missed offline is one font in the
    // wrong face), and otherwise when the page first uses them
    const keep = async (url) => {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(url, { mode: 'cors' });
          if (r.ok) { await cache.put(url, r.clone()); return r; }
        } catch (err) {}
      }
      return null;
    };
    await Promise.all(REMOTE.map(async (url) => {
      const r = await keep(url);
      if (r && /^https:\/\/fonts\.googleapis\.com\//.test(url)) {
        const fonts = [...new Set([...(await r.text()).matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];
        await Promise.all(fonts.map(keep));
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('chess-replay-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const here = url.origin === self.location.origin;
  if (req.mode === 'navigate' && here) return e.respondWith(page(req).then(isolated));
  if (here) return e.respondWith(cacheFirst(req).then(isolated));
  if (KEEP_HOSTS.includes(url.hostname) && req.method === 'GET') return e.respondWith(cacheFirst(req));
  // anything else (Hugging Face, Lichess's tablebase: live data, never kept) goes to the network as usual
});

// the page from the network, kept for next time; offline (or too slow), the kept one
async function page(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((r) => {
    if (r.ok && r.type === 'basic') cache.put(PAGE, r.clone());
    return r;
  });
  net.catch(() => {}); // when the copy has answered, a later failure has no one to tell
  const slow = new Promise((ok) => setTimeout(ok, PAGE_TIMEOUT_MS));
  try {
    const r = await Promise.race([net, slow.then(() => null)]);
    if (r) return r;
  } catch (err) {}
  return (await cache.match(PAGE)) || net;
}

// The site sends the cross-origin isolation headers (render.yaml) that let Stockfish use threads; the page and its files
// answered from here carry them too, also from a copy kept before they existed (a worker without them isn't isolated)
const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
function isolated(r) {
  if (!r || r.type === 'opaque' || Object.keys(ISOLATION).every((k) => r.headers.has(k))) return r;
  const headers = new Headers(r.headers);
  for (const [k, v] of Object.entries(ISOLATION)) headers.set(k, v);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
}

// a kept GET answers a HEAD too (Stockfish checks its file with one), without its body (Firefox refuses one with a body)
async function kept(req) {
  const hit = await (await caches.open(CACHE)).match(req.url, { ignoreVary: true });
  return hit && req.method === 'HEAD' ? new Response(null, { status: hit.status, statusText: hit.statusText, headers: hit.headers }) : hit;
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await kept(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (req.method === 'GET' && (r.ok || r.type === 'opaque')) cache.put(req.url, r.clone()).catch(() => {});
  return r;
}
