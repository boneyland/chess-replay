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
  // the browser's room for the copy: the files, plus a margin for the cache's own records
  const ROOM_FACTOR = 1.1;

  const supported = () => typeof caches !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle && typeof Worker !== 'undefined';
  const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const urlOf = (f) => BASE + f.name;

  // Both files of a build kept (checked when downloaded)
  async function present(build = 'single') {
    if (!supported()) return false;
    try {
      const cache = await caches.open(CACHE);
      for (const f of BUILDS[build]) if (!(await cache.match(urlOf(f)))) return false;
      return true;
    } catch (e) { return false; }
  }

  // One file into memory as it arrives, no bigger than its pinned size; onBytes(n) for each chunk. A connection that
  // sends nothing for limits.stallMs (before the answer or between chunks) is given up, else the download waits forever
  const limits = { stallMs: 30000 };
  async function fetchFile(f, signal, onBytes) {
    const ctl = new AbortController(), stop = () => ctl.abort();
    let stalled = false, timer = null;
    const wait = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; stop(); }, limits.stallMs); };
    if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop); }
    const out = new Uint8Array(f.size);
    let at = 0;
    try {
      wait();
      const r = await fetch(urlOf(f), { mode: 'cors', cache: 'no-store', signal: ctl.signal });
      if (!r.ok) throw new Error(`unpkg.com answered ${r.status} for ${f.name}`);
      const reader = r.body.getReader();
      for (;;) {
        wait();
        const { done, value } = await reader.read();
        if (done) break;
        if (at + value.length > f.size) { reader.cancel().catch(() => {}); throw new Error(f.name + ' is bigger than expected'); }
        out.set(value, at);
        at += value.length;
        onBytes(value.length);
      }
    } catch (e) {
      if (stalled) throw new Error(`unpkg.com stopped sending ${f.name}`);
      throw e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
    }
    if (at !== f.size) throw new Error(f.name + ' arrived incomplete');
    if ((await sha256(out)) !== f.sha256) throw new Error(f.name + ' does not match its pinned checksum');
    return out;
  }

  // Downloads and keeps both files; nothing is kept unless both arrive whole and match. onProgress(bytes, total bytes).
  // Asks the browser to keep the copy when storage runs low (Chrome decides by itself, Firefox asks the viewer).
  async function download({ build = 'single', onProgress = () => {}, signal } = {}) {
    const FILES = BUILDS[build];
    if (!supported()) throw new Error('This browser can’t keep the engine');
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const { quota, usage } = await navigator.storage.estimate();
        if (quota != null && quota - (usage || 0) < total(build) * ROOM_FACTOR) throw new Error('Not enough storage space in this browser');
      } catch (e) { if (/storage space/.test(e.message)) throw e; }
    }
    let got = 0;
    onProgress(0, total(build));
    const bodies = [];
    for (const f of FILES) bodies.push(await fetchFile(f, signal, (n) => { got += n; onProgress(got, total(build)); }));
    const cache = await caches.open(CACHE);
    try {
      for (let i = 0; i < FILES.length; i++) await cache.put(urlOf(FILES[i]), new Response(bodies[i], { headers: { 'content-type': FILES[i].type } }));
    } catch (e) {
      await drop(cache, FILES);
      throw new Error(/quota/i.test(e.name + e.message) ? 'Not enough storage space in this browser' : 'The browser would not keep the engine');
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  // The kept copy → a makeWorker for SFEngine.create. It was checked when downloaded, so it is trusted now: only its sizes
  // are compared (a missing or cut-short copy is dropped), and its Blobs are passed on without reading the 99 MB into the
  // page. Once per page and build: an engine started again (a dead one, a new hash size) reuses the Blob URLs
  let started = {}, blobs = [];
  const start = (build = 'single') => started[build] || (started[build] = load(BUILDS[build]).catch((e) => { delete started[build]; throw e; }));
  // a build's files out of the cache, the other build's left alone
  const drop = async (cache, files) => { for (const f of files) await cache.delete(urlOf(f)).catch(() => {}); };
  async function load(FILES) {
    const cache = await caches.open(CACHE);
    const urls = [];
    for (const f of FILES) {
      const r = await cache.match(urlOf(f));
      const blob = r && await r.blob();
      if (!blob || blob.size !== f.size) {
        urls.forEach((u) => URL.revokeObjectURL(u));
        await drop(cache, FILES);
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

  window.SFFull = { BASE, BUILDS, FILES, CACHE, TOTAL, total, limits, supported, present, download, start, remove };
})();
