// Dead positions: whether a side can still mate by any legal sequence of moves (FIDE 5.2.2 and 6.9), as chasolver
// proves it in a Worker (app/dead-worker.js, vendor/chasolver.wasm). The client asks one position and side at a time and
// caches the answers by position: 'unwinnable', 'winnable' or 'undecided' (chasolver gave up, the search ran past its
// time, or a FEN it refuses). A worker that can't start or load its module answers 'undecided' too, but that isn't
// cached: every ask for retryMs after the failure answers 'undecided' without a worker, and the first ask after tries
// again (offline before the module was kept). Undecided proves nothing.
(function () {
  const CACHE_MAX = 5000;

  // a position's key: placement, side to move, castling and en passant (the move counters don't change who can mate)
  const key = (fen) => String(fen).trim().split(/\s+/).slice(0, 4).join(' ');

  // makeWorker() → a Worker running dead-worker.js; a search past timeoutMs ends with the worker terminated, and one
  // that grew the module's memory (which never shrinks) past memLimitMb restarts it after answering; one that fails to
  // start or load isn't started again for retryMs
  function create({ makeWorker, timeoutMs = 5000, memLimitMb = 64, retryMs = 30000, now = Date.now }) {
    const cache = new Map(), queue = [];
    let worker = null, busy = null, seq = 0, downUntil = -Infinity;
    const ck = (fen, side) => key(fen) + ' ' + side;
    const remember = (k, v) => {
      cache.set(k, v);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    };
    const kill = () => {
      if (worker) try { worker.terminate(); } catch (e) {}
      worker = null;
    };
    function finish(verdict, { restart = false, keep = true, failed = false } = {}) {
      if (!busy) { kill(); return; }
      const { job, timer } = busy;
      clearTimeout(timer);
      busy = null;
      if (restart) kill();
      if (failed) downUntil = now() + retryMs;
      const v = verdict === 'unwinnable' || verdict === 'winnable' ? verdict : 'undecided';
      if (keep) remember(job.k, v);
      job.resolve(v);
      pump();
    }
    function pump() {
      if (busy) return;
      let job;
      while ((job = queue.shift())) {
        const hit = cache.get(job.k);
        if (hit) job.resolve(hit);
        else if ((job.signal && job.signal.aborted) || now() < downUntil) job.resolve('undecided');
        else break;
      }
      if (!job) return;
      if (!worker) {
        try {
          worker = makeWorker();
          worker.onmessage = (e) => {
            const d = e.data || {};
            if (busy && d.id === busy.id) finish(d.verdict, { restart: d.mb > memLimitMb || !!d.error, keep: !d.error, failed: !!d.error });
          };
          // handled here, so the browser needn't report it as uncaught
          worker.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); finish('undecided', { restart: true, keep: false, failed: true }); };
        } catch (e) {
          worker = null;
          downUntil = now() + retryMs;
          job.resolve('undecided');
          pump();
          return;
        }
      }
      busy = { job, id: ++seq, timer: setTimeout(() => finish('undecided', { restart: true }), timeoutMs) };
      worker.postMessage({ id: busy.id, fen: job.fen, side: job.side });
    }
    // side: 'w' or 'b', the side that would mate; an ask aborted while it waits its turn answers 'undecided', unsent
    function ask(fen, side, { signal } = {}) {
      const hit = cache.get(ck(fen, side));
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve) => {
        queue.push({ k: ck(fen, side), fen, side, signal, resolve });
        pump();
      });
    }
    const cached = (fen, side) => cache.get(ck(fen, side));
    const both = (fen, opts) => Promise.all([ask(fen, 'w', opts), ask(fen, 'b', opts)]).then(([w, b]) => ({ w, b }));
    const close = () => {
      if (busy) finish('undecided', { keep: false });
      kill();
    };
    return { ask, cached, both, close };
  }

  // The index of the first FEN where neither side can mate, asked in order and stopping there (a dead position stays
  // dead after any legal move); null when none is proven, or when signal aborts
  async function firstDead(fens, client, { signal } = {}) {
    for (let i = 0; i < fens.length; i++) {
      const v = await client.both(fens[i], { signal });
      if (signal && signal.aborted) return null;
      if (v.w === 'unwinnable' && v.b === 'unwinnable') return i;
    }
    return null;
  }

  window.DeadCore = { key, create, firstDead };
})();
