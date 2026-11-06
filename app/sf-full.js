// The full Stockfish 19 (with the big NNUE net; the multi-threaded build where the page allows threads, else the single-thread one) for the site, downloaded only when the viewer asks
// (the Analysis panel's engine drop-down): stockfish.js v19.0.1 from unpkg, both files checked against pinned SHA-256s, then kept in their own
// cache, which sw.js never clears on a deploy. The engine then starts from the kept copy, offline too, as Blob URLs
// (the glue reads its wasm URL from the worker's #hash).
(function () {
  const BASE = 'https://unpkg.com/stockfish@19.0.1/bin/';
  // each build is kept apart in the one cache: a viewer who had the single-thread copy downloads the threaded one too
  const BUILDS = {
    single: [
      { name: 'stockfish-19-single.js', size: 28130, type: 'text/javascript', sha256: '8071dee87312f74805a859de933e1a1ef465579ab1a51fbd597388cdce9d444d' },
      { name: 'stockfish-19-single.wasm', size: 99169054, type: 'application/wasm', sha256: '991bede2f253ebb08ff01fcc48270f4b9c8e66b12d5bd5f8d6f52eb3e3b3a740' },
    ],
    threads: [
      { name: 'stockfish-19.js', size: 33326, type: 'text/javascript', sha256: '623ee70a10d6dc202375127b49e2e1822635f9ab07693ae7be28e50a787f6218' },
      { name: 'stockfish-19.wasm', size: 99076105, type: 'application/wasm', sha256: 'a599d78d72e0722d8895be84aca8b492d12e8bba3cdfcbcbc4a64017888c6667' },
    ],
  };
  const FILES = BUILDS.single;
  const CACHE = 'stockfish-full-19';
  const total = (build = 'single') => BUILDS[build].reduce((s, f) => s + f.size, 0), TOTAL = total();

  // The generic part (download, check, keep) is KeptFiles', one per build over the same cache
  const KEPT = {};
  for (const b of Object.keys(BUILDS)) KEPT[b] = window.KeptFiles.make({ cache: CACHE, base: BASE, files: BUILDS[b], host: 'unpkg.com', what: 'engine' });
  // one stall limit for both builds
  const limits = {};
  Object.defineProperty(limits, 'stallMs', { enumerable: true, get: () => KEPT.single.limits.stallMs, set: (v) => { for (const b in KEPT) KEPT[b].limits.stallMs = v; } });
  const supported = () => KEPT.single.supported() && typeof Worker !== 'undefined';
  const urlOf = (f) => BASE + f.name;

  // Both files of a build kept (checked when downloaded)
  const present = async (build = 'single') => supported() && KEPT[build].present();

  // Downloads and keeps both files of a build; nothing is kept unless both arrive whole and match. onProgress(bytes, total bytes).
  // Keeping one build drops the other: only one of them runs on a page, and the other's 99 MB would count against the
  // storage check with no way to remove it.
  async function download({ build = 'single', onProgress, signal } = {}) {
    if (!supported()) throw new Error('This browser can’t keep the engine');
    for (const b of Object.keys(BUILDS)) if (b !== build) await KEPT[b].drop();
    return KEPT[build].download({ onProgress, signal });
  }

  // The kept copy → a makeWorker for SFEngine.create. It was checked when downloaded, so it is trusted now: only its sizes
  // are compared (a missing or cut-short copy is dropped), and its Blobs are passed on without reading the 99 MB into the
  // page. Once per page and build: an engine started again (a dead one, a new hash size) reuses the Blob URLs
  let started = {}, blobs = [];
  const start = (build = 'single') => started[build] || (started[build] = load(build).catch((e) => { delete started[build]; throw e; }));
  async function load(build) {
    const FILES = BUILDS[build], kept = KEPT[build];
    const cache = await caches.open(CACHE);
    const urls = [];
    for (const f of FILES) {
      const r = await cache.match(urlOf(f));
      const blob = r && await r.blob();
      if (!blob || blob.size !== f.size) {
        urls.forEach((u) => URL.revokeObjectURL(u));
        await kept.drop(cache);
        throw new Error('The downloaded engine is missing');
      }
      urls.push(URL.createObjectURL(blob.type === f.type ? blob : new Blob([blob], { type: f.type })));
    }
    blobs = blobs.concat(urls);
    const [glue, wasm] = urls;
    return () => new Worker(glue + '#' + encodeURIComponent(wasm));
  }

  function remove() {
    blobs.forEach((u) => URL.revokeObjectURL(u));
    blobs = [];
    started = {};
    return caches.delete(CACHE);
  }
  // Remove, for the Remove button: { kept: { single, threads }, err }. A removal that fails says why (err), and kept is
  // then what is still in the cache, so the page doesn't show the engine as gone while its 99 MB stay
  async function removeKept() {
    try { await remove(); return { kept: { single: false, threads: false }, err: '' }; } catch (e) {
      return { kept: { single: await present('single'), threads: await present('threads') }, err: 'The full engine could not be removed: ' + ((e && e.message) || e) };
    }
  }

  window.SFFull = { BASE, BUILDS, FILES, CACHE, TOTAL, total, limits, supported, present, download, start, remove, removeKept };
})();
