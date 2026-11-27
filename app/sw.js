// The site's service worker (build.cjs fills in VERSION, LOCAL, REMOTE, INTEGRITY, PAGE, KEEP_HOSTS, VISION_CACHE and ISOLATION): it keeps a copy of the page and everything
// it loads, so the player, Stockfish and the export work with no connection. What needs the network: Ask Queen and its
// Hugging Face sign-in; Lichess (the tablebase, the opening explorer and its sign-in, cloud evaluation, importing a
// Lichess link); and the first download of Full Stockfish (from unpkg) or of the board reader (vision/), each kept in
// a cache of its own after that. The page itself comes from the network first, so a deploy shows up at once; the files
// around it change only with a deploy that changes this file's VERSION, so they come from the copy first.
const VERSION = '__VERSION__';
const LOCAL = __LOCAL__; // next to the page, the page first
const REMOTE = __REMOTE__; // pinned CDN files: React, the export's libraries, the fonts' stylesheet
// the CDN scripts' integrity hashes, the page's own: each is fetched with its hash and kept only if it passes, so a wrong
// answer (a proxy, a CDN edge) is never kept for the page to refuse on every visit until the next deploy
const INTEGRITY = __INTEGRITY__;
const PAGE = '__PAGE__'; // render.yaml's rewrite of the folder
// the folder the page is served from: the page answers there (Render rewrites it) and at its own name
const SCOPE = new URL('./', self.location.href).pathname;
const CACHE = 'chess-replay-' + VERSION;
// hosts whose files are kept as they're used (the fonts' stylesheet names font files by the browser that asks)
const KEEP_HOSTS = __KEEP_HOSTS__; // build.cjs's CDN_HOSTS, which the page's CSP allows
// The board reader's model and runtime (vision/, 56 MB) are kept only by viewers who ask for them, in a cache of their own
// that no deploy replaces (kept-files.js fills it under these same URLs): VisionCore's CACHE, which a model update bumps
const VISION_CACHE = '__VISION_CACHE__';
// an install's fetch of a CDN file that hasn't arrived by then is given up (and tried again, up to three times): a
// network that swallows a host's requests must not hold the install open
const KEEP_TIMEOUT_MS = 20000;
// a page that hasn't answered by then comes from the copy (a connection that is up but not getting through)
const PAGE_TIMEOUT_MS = 6000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(LOCAL);
      // the CDN files are kept if they can be fetched now (three tries each: one font missed offline is one font in the
      // wrong face), and otherwise when the page first uses them
      const keep = async (url) => {
        for (let i = 0; i < 3; i++) {
          const ctl = new AbortController(),
            timer = setTimeout(() => ctl.abort(), KEEP_TIMEOUT_MS);
          try {
            const r = await fetch(url, { mode: 'cors', signal: ctl.signal, integrity: INTEGRITY[url] || '' });
            if (r.ok) {
              await cache.put(url, r.clone());
              return r;
            }
          } catch (err) {
          } finally {
            clearTimeout(timer);
          }
        }
        return null;
      };
      await Promise.all(
        REMOTE.map(async (url) => {
          const r = await keep(url);
          if (r && /^https:\/\/fonts\.googleapis\.com\//.test(url)) {
            const fonts = [
              ...new Set(
                [...(await r.text()).matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]),
              ),
            ];
            await Promise.all(fonts.map(keep));
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      await prune();
      await self.clients.claim();
    })(),
  );
});

// A page older than this worker (open in a tab when the deploy's worker took over) still asks for its own deploy's
// files (?v=), and its board reader reads its own VISION_CACHE: cacheFirst answers them from that deploy's copy, so it
// must outlive the tab. Older deploys' copies, and a board reader kept under an older name (a model or runtime update
// bumps VISION_CACHE), are deleted only when every window of the site shows a page this worker served (FRESH: the
// navigations it answered; a restarted worker knows none, so it waits for the next visit with no other window open), and
// never while a newer worker is installing or waiting (it deletes them itself, and this worker would take its new copy
// for an old one). The worker checks at activate and a moment after each visit to the page (a reloaded tab's old
// document is still a window while the new one loads). Whatever the windows, no more than KEEP_OLD older copies stay
// (the newest: caches.keys() lists caches in the order they were made), so a browser that never names a navigation's
// client (resultingClientId) or a tab left open for weeks doesn't pile up a copy per deploy
const FRESH = new Set();
// a board reader's cache number (chess-vision-N), NaN for another cache: only an older one is deleted, never a newer
// one a newer worker filled before its install failed (the 56 MB download would repeat on every visit)
const visionNo = (k) => (/^chess-vision-\d+$/.test(k) ? +k.slice('chess-vision-'.length) : NaN);
const PRUNE_DELAY_MS = 5000;
const KEEP_OLD = 2;
async function prune() {
  const reg = self.registration;
  if (reg && (reg.installing || reg.waiting)) return;
  const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const all = open.every((c) => FRESH.has(c.id));
  const old = (await caches.keys()).filter(
    (k) => (k.startsWith('chess-replay-') && k !== CACHE) || visionNo(k) < visionNo(VISION_CACHE),
  );
  const replays = old.filter((k) => k.startsWith('chess-replay-'));
  for (const k of old)
    if (all || (k.startsWith('chess-replay-') && replays.indexOf(k) < replays.length - KEEP_OLD))
      await caches.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request,
    url = new URL(req.url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const here = url.origin === self.location.origin;
  if (here && url.pathname.startsWith(new URL('vision/', self.location.href).pathname))
    return e.respondWith(vision(req).then(isolated));
  // only the page's own address is kept as the page: opening another file in a tab (the link-preview image) must
  // not replace it, or the next offline visit would show that file
  if (req.mode === 'navigate' && here && (url.pathname === SCOPE || url.pathname === SCOPE + PAGE))
    return e.respondWith(page(e).then(isolated));
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
  if (e.resultingClientId) FRESH.add(e.resultingClientId);
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
  const answered = answer(net);
  e.waitUntil(
    answered
      .then(() => new Promise((ok) => setTimeout(ok, PRUNE_DELAY_MS)))
      .then(prune)
      .catch(() => {}),
  );
  return answered;
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
  if (
    !r ||
    r.type === 'opaque' ||
    r.type === 'opaqueredirect' ||
    r.status === 0 ||
    Object.keys(ISOLATION).every((k) => r.headers.has(k))
  )
    return r;
  const headers = new Headers(r.headers);
  for (const [k, v] of Object.entries(ISOLATION)) headers.set(k, v);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
}

// a kept GET answers a HEAD too (Stockfish checks its file with one), without its body (Firefox refuses one with a body).
// caches.match with cacheName opens no cache that isn't there (caches.open would make an empty one)
async function kept(req, name = CACHE, key = req.url) {
  const hit = await caches.match(key, { cacheName: name, ignoreVary: true });
  return hit && req.method === 'HEAD'
    ? new Response(null, { status: hit.status, statusText: hit.statusText, headers: hit.headers })
    : hit;
}

// The page asks for its Workers and libraries with its deploy's VERSION (?v=, window.siteFile in build.cjs). This
// deploy's is answered from the copy, kept under the file's plain URL. Another deploy's comes from that deploy's own
// copy where it is still kept (a page older than this worker: prune keeps it while the page is open; or newer, its
// worker installed but not yet active), else from the network, and isn't kept here, so the page runs its own deploy's
// file. Only offline is it answered with this deploy's copy, the closest there is (a new page kept by this worker,
// whose worker never installed): one that works, perhaps out of step, rather than none.
// Only a whole answer is kept (a CDN's error would otherwise stick until the next deploy): a CDN file is fetched with
// CORS, which the CDNs and font hosts allow, so its status can be read, and a CDN script with its integrity hash, so a
// wrong body fails the fetch and isn't kept. The write is held open with waitUntil, which the
// event still takes while its answer is pending
async function cacheFirst(e) {
  const req = e.request,
    url = new URL(req.url);
  const here = url.origin === self.location.origin,
    v = here ? url.searchParams.get('v') : null;
  if (v !== null) url.searchParams.delete('v');
  const key = url.href;
  if (v !== null && v !== VERSION) {
    const own = /^[0-9a-f]{16}$/.test(v) && (await kept(req, 'chess-replay-' + v, key));
    if (own) return own;
    try {
      return await fetch(req);
    } catch (err) {
      const near = await kept(req, CACHE, key);
      if (near) return near;
      throw err;
    }
  }
  const cache = await caches.open(CACHE);
  const hit = await kept(req, CACHE, key);
  if (hit) return hit;
  // a CDN GET carries its pinned hash, else the one the page asked with (a HEAD has no body to check)
  const integrity = req.method === 'GET' ? INTEGRITY[key] || req.integrity || '' : '';
  const r = await (here
    ? fetch(req)
    : fetch(req.url, { method: req.method, mode: 'cors', credentials: 'omit', integrity }));
  if (req.method === 'GET' && r.ok) e.waitUntil(cache.put(key, r.clone()).catch(() => {}));
  return r;
}
