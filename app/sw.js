// The site's service worker (build.cjs fills in VERSION, LOCAL, REMOTE, KEEP_HOSTS, VISION_CACHE and ISOLATION): it keeps a copy of the page and everything
// it loads, so the player, Stockfish and the export work with no connection. What needs the network: Ask Queen and its
// Hugging Face sign-in; Lichess (the tablebase, the opening explorer and its sign-in, cloud evaluation, importing a
// Lichess link); and the first download of Full Stockfish (from unpkg) or of the board reader (vision/), each kept in
// a cache of its own after that. The page itself comes from the network first, so a deploy shows up at once; the files
// around it change only with a deploy that changes this file's VERSION, so they come from the copy first.
const VERSION = '__VERSION__';
const LOCAL = __LOCAL__; // next to the page, the page first
const REMOTE = __REMOTE__; // pinned CDN files: React, the export's libraries, the fonts' stylesheet
const PAGE = 'chess-game-video.html';
// the folder the page is served from: the page answers there (Render rewrites it) and at its own name
const SCOPE = new URL('./', self.location.href).pathname;
const CACHE = 'chess-replay-' + VERSION;
// hosts whose files are kept as they're used (the fonts' stylesheet names font files by the browser that asks)
const KEEP_HOSTS = __KEEP_HOSTS__; // build.cjs's CDN_HOSTS, which the page's CSP allows
// The board reader's model and runtime (vision/, 56 MB) are kept only by viewers who ask for them, in a cache of their own
// that no deploy replaces (kept-files.js fills it under these same URLs): VisionCore's CACHE, which a model update bumps
const VISION_CACHE = '__VISION_CACHE__';
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
    // older deploys' copies, and a board reader kept under an older name (a model or runtime update bumps VISION_CACHE)
    for (const k of await caches.keys()) if ((k.startsWith('chess-replay-') && k !== CACHE) || (k.startsWith('chess-vision-') && k !== VISION_CACHE)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const here = url.origin === self.location.origin;
  if (here && url.pathname.startsWith(new URL('vision/', self.location.href).pathname)) return e.respondWith(vision(req).then(isolated));
  // only the page's own address is kept as the page: opening another file in a tab (the link-preview image) must
  // not replace it, or the next offline visit would show that file
  if (req.mode === 'navigate' && here && (url.pathname === SCOPE || url.pathname === SCOPE + PAGE)) return e.respondWith(page(e).then(isolated));
  if (here) return e.respondWith(cacheFirst(e).then(isolated));
  if (KEEP_HOSTS.includes(url.hostname) && req.method === 'GET') return e.respondWith(cacheFirst(e));
  // anything else (Hugging Face, Lichess's tablebase: live data, never kept) goes to the network as usual
});

// A vision/ file comes from the cache the viewer filled, else from the network, and is never put in a cache here: it is
// 56 MB, wanted only by those who asked, and kept apart from the per-deploy copy so a deploy doesn't download it again
async function vision(req) {
  return (await kept(req, VISION_CACHE)) || fetch(req);
}

// the page from the network, kept for next time; offline, too slow or a server error (a deploy, an outage), the kept one.
// A 404 is the network's answer. Keeping the page is held open with waitUntil, called now while the event can still take
// it: the network may answer after the copy has, and the browser may stop an idle worker before a write ends
function page(e) {
  let saved = Promise.resolve();
  const net = fetch(e.request).then((r) => {
    if (r.ok && r.type === 'basic') {
      const copy = r.clone(); // before the page's answer starts reading the body
      saved = caches.open(CACHE).then((cache) => cache.put(PAGE, copy));
    }
    return r;
  });
  net.catch(() => {}); // when the copy has answered, a later failure has no one to tell
  e.waitUntil(net.then(() => saved).catch(() => {}));
  return answer(net);
}

async function answer(net) {
  const cache = await caches.open(CACHE);
  const slow = new Promise((ok) => setTimeout(ok, PAGE_TIMEOUT_MS));
  try {
    const r = await Promise.race([net, slow.then(() => null)]);
    if (r && r.status < 500) return r;
  } catch (err) {}
  return (await cache.match(PAGE)) || net;
}

// The site sends the cross-origin isolation headers (render.yaml) that let Stockfish use threads; the page and its files
// answered from here carry them too, also from a copy kept before they existed (a worker without them isn't isolated).
// They are render.yaml's, filled in by build.cjs: none there, none here
const ISOLATION = __ISOLATION__;
function isolated(r) {
  if (!r || r.type === 'opaque' || r.type === 'opaqueredirect' || r.status === 0 || Object.keys(ISOLATION).every((k) => r.headers.has(k))) return r;
  const headers = new Headers(r.headers);
  for (const [k, v] of Object.entries(ISOLATION)) headers.set(k, v);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
}

// a kept GET answers a HEAD too (Stockfish checks its file with one), without its body (Firefox refuses one with a body)
async function kept(req, name = CACHE) {
  const hit = await (await caches.open(name)).match(req.url, { ignoreVary: true });
  return hit && req.method === 'HEAD' ? new Response(null, { status: hit.status, statusText: hit.statusText, headers: hit.headers }) : hit;
}

// the write is held open with waitUntil, which the event still takes while its answer is pending
async function cacheFirst(e) {
  const req = e.request;
  const cache = await caches.open(CACHE);
  const hit = await kept(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (req.method === 'GET' && (r.ok || r.type === 'opaque')) e.waitUntil(cache.put(req.url, r.clone()).catch(() => {}));
  return r;
}
