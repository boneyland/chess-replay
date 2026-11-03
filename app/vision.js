// The board reader on the page: its kept files (the vision/ folder next to the page, downloaded only on the viewer's
// click, kept by KeptFiles in VisionCore.CACHE, which sw.js serves them from) and the Worker that runs it
// (vision-worker.js). read(bitmap) gives the model's logits for a cropped picture; VisionCore.read turns them into a board.
// Nothing here draws or touches the DOM, and the picture never leaves the device.
(function () {
  const VC = window.VisionCore;
  // the same prefix the kept cache's keys use, so sw.js finds the Worker's requests there
  const BASE = new URL('vision/', location.href).href;
  const made = window.KeptFiles.make({ cache: VC.CACHE, base: BASE, files: VC.FILES, host: 'the site', what: 'board reader' });
  // removing the files also stops a Worker that has them loaded
  const kept = { ...made, remove: () => { stop(); return made.remove(); } };
  // ONNX Runtime's wasm build needs SIMD (as Stockfish 19 does); the Worker draws on an OffscreenCanvas
  const supported = () => window.SFEngine.simdSupport() && made.supported() && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';

  let worker = null, loaded = null, waiting = null, busy = false;

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
    if (loaded) return loaded;
    worker = new Worker('vision-worker.js', { type: 'module' });
    worker.onmessage = (e) => settle((w) => (e.data.type === w.want ? w.ok(e.data) : w.no(new Error(e.data.message || 'The board reader gave an unexpected answer'))));
    // a Worker whose script or module imports don't load says so only by an error event
    worker.onerror = (e) => { e.preventDefault(); settle((w) => w.no(new Error(e.message || 'The board reader did not start'))); stop(); };
    const got = answer('ready');
    worker.postMessage({ type: 'load', base: BASE, threads: Math.min(4, navigator.hardwareConcurrency || 1) });
    loaded = got.catch((e) => { stop(); throw e; });
    return loaded;
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
    const w = worker;
    worker = null;
    loaded = null;
    if (w) w.terminate();
    settle((p) => p.no(new Error('The board reader was stopped')));
  }

  window.Vision = { supported, kept, read, stop };
})();
