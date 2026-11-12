// The board reader on the page: its kept files (the vision/ folder next to the page, downloaded only on the viewer's
// click, kept by KeptFiles in VisionCore.CACHE, and handed to the Worker as Blob URLs, so it reads with or without
// sw.js) and the Worker that runs it (vision-worker.js). read(bitmap) gives the model's logits for a cropped picture; VisionCore.read turns them into a board.
// Nothing here draws or touches the DOM, and the picture never leaves the device.
(function () {
  const VC = window.VisionCore;
  // the same prefix the kept cache's keys use, so sw.js finds the files there
  const BASE = new URL('vision/', location.href).href;
  // removing the files also stops a Worker that has them loaded
  const kept = window.KeptFiles.make({ cache: VC.CACHE, base: BASE, files: VC.FILES, host: 'the site', what: 'board reader', onRemove: () => stop() });
  // ONNX Runtime's wasm build needs SIMD (as Stockfish 19 does); the Worker draws on an OffscreenCanvas
  const supported = () => window.SFEngine.simdSupport() && kept.supported() && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';

  // gen: bumped by stop(), so a load it overtook (still reading the kept copy) doesn't start a Worker after all
  let worker = null, loaded = null, waiting = null, busy = false, gen = 0;
  // ONNX Runtime's threads can fail to start, and its load then waits for ever (Firefox on GitHub's runners, 2026-11-11):
  // a threaded load not done in LOAD_MS is stopped and started again on one thread, which this page then keeps to
  // (the second load waits as long as it takes: a slow device isn't stopped twice)
  const LOAD_MS = 30000;
  let oneThread = false;

  // the Worker's next answer of type `want`; its error, or the Worker failing, rejects
  function answer(want) {
    return new Promise((ok, no) => { waiting = { want, ok, no }; });
  }
  function settle(fn) {
    const w = waiting;
    waiting = null;
    if (w) fn(w);
  }
  // started and loaded once per page; a load that fails stops it, so the next read starts afresh
  function load() {
    if (!loaded) { const g = gen; loaded = start(g).catch((e) => { if (g === gen) stop(); if (e.slow) return load(); throw e; }); }
    return loaded;
  }
  // the kept copy as Blob URLs (a missing or cut-short one is dropped and refused) to a new Worker, let go once it has
  // loaded them, or failed to
  async function start(g) {
    const files = await kept.blobUrls();
    if (g !== gen) { files.revoke(); throw new Error('The board reader was stopped'); }
    worker = new Worker('vision-worker.js', { type: 'module' });
    worker.onmessage = (e) => settle((w) => (e.data.type === w.want ? w.ok(e.data) : w.no(new Error(e.data.message || 'The board reader gave an unexpected answer'))));
    // a Worker whose script or module imports don't load says so only by an error event
    worker.onerror = (e) => { e.preventDefault(); settle((w) => w.no(new Error(e.message || 'The board reader did not start'))); stop(); };
    const got = answer('ready');
    const urls = Object.fromEntries(VC.FILES.map((f) => [f.name, files.url(f.name)]));
    const threads = oneThread ? 1 : Math.min(4, navigator.hardwareConcurrency || 1);
    const timer = threads > 1 && setTimeout(() => { oneThread = true; settle((w) => w.no(Object.assign(new Error('The board reader’s threads didn’t start'), { slow: true }))); }, LOAD_MS);
    worker.postMessage({ type: 'load', urls, size: VC.SIZE, threads });
    try { return await got; } finally { clearTimeout(timer); files.revoke(); }
  }

  // The logits (Float32Array, 64 x 13) for the picture. One read at a time: a call while one runs rejects, leaving its
  // bitmap alone; otherwise the bitmap is the reader's (transferred to the Worker, which closes it, or closed here)
  async function read(bitmap) {
    if (busy) throw new Error('Already reading');
    busy = true;
    try {
      try { await load(); } catch (e) { bitmap.close(); throw e; }
      const got = answer('logits');
      worker.postMessage({ type: 'image', image: bitmap }, [bitmap]);
      return (await got).logits;
    } finally {
      busy = false;
    }
  }

  // The Worker ended (its memory freed); a read under way rejects
  function stop() {
    gen++;
    const w = worker;
    worker = null;
    loaded = null;
    if (w) w.terminate();
    settle((p) => p.no(new Error('The board reader was stopped')));
  }

  window.Vision = { supported, kept, read, stop };
})();
