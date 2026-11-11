// Stockfish over UCI in a Web Worker: one search at a time, picked by priority: 'play' (Stockfish's own move in a game against
// the viewer, which must never wait behind analysis), then 'own' (the viewer's own moves), then 'game' (queued game positions);
// in queue order within a priority. A running search is never interrupted for a higher one.
// A search can ask for several lines (MultiPV): the option is sent between searches, only when it changes; so are Hash and
// Threads, which change with no restart (the threaded build, where the page allows it: threadSupport).
// Positions go to the engine as move lists from the start: the standard one, or a game's start FEN (the page's FENs carry no castling or en passant).
(function () {
  const positionCommand = (moves, fen) => {
    const base = fen && fen !== window.ChessCore.START_FEN ? 'position fen ' + fen : 'position startpos';
    return moves.length ? base + ' moves ' + moves.join(' ') : base;
  };

  // A search's lines in rank order, [{ k, cp, depth, pv }]. Line 1 is the search's result (its last complete score);
  // each other line is the move last reported at its rank, bound-only reports included, with that move's last complete
  // score, whatever its depth. With several threads Stockfish ends on the deepest thread's line 1 (19 → 21 at once), and
  // the last depth can end mid-way, so the complete scores kept by rank can be stale: when line 1 turns to line 2's move,
  // line 2's report there can be a bound, leaving at rank 2 the move now line 1; when line 1's last report is a bound
  // on a new move, line 1 keeps the old move, which line 2's last report can also name. A move already listed is left
  // out (k renumbered). A rank left empty takes a move another rank last named (line 1's new move), else the deepest other
  // move with a complete score (a rank's last report can be a bound on a move never scored complete)
  const linesOf = (q) => {
    if (!q.byK[1]) return [];
    const seen = new Set(), out = [];
    const add = (c) => { if (c && c.pv.length && !seen.has(c.pv[0])) { seen.add(c.pv[0]); out.push({ ...c, k: out.length + 1 }); return true; } return false; };
    q.byK.forEach((l, k) => { if (k === 1) add(l); else if (!add(q.byMove[q.moveK[k]])) add(l); });
    const ranks = q.byK.filter(Boolean).length;
    const rest = Object.values(q.byMove).reverse().sort((a, b) => b.depth - a.depth); // deepest first, latest first within a depth
    [...q.moveK.map((m) => q.byMove[m]), ...rest].forEach((c) => { if (out.length < ranks) add(c); });
    return out;
  };
  // the rank and first move of any info line with a pv (bound-only ones too): [k, uci], or null
  const rankMove = (line) => { const k = / multipv (\d+)/.exec(line), m = / pv (\S+)/.exec(line); return m ? [k ? +k[1] : 1, m[1]] : null; };

  // makeWorker: () => a Worker (or anything with postMessage, onmessage, onerror, terminate)
  // the 1.8 MB wasm downloads and compiles inside this window, so it allows a slow phone connection
  const READY_TIMEOUT_MS = 30000;
  // A search still running this long past its movetime has hung (Stockfish stops within a few ms of it)
  const HANG_MS = 5000, HANG_TRIES = 3;

  // Whether the threaded builds can run here, as Lichess decides it (lila's sharedMemoryTest): the page cross-origin
  // isolated, shared memory a WebAssembly module can use, and not Safari 26.2 (a WebKit crash). g: the page's globals
  function threadSupport(g = globalThis) {
    const nav = g.navigator || {}, cores = nav.hardwareConcurrency || 1;
    const no = (reason) => ({ ok: false, cores, reason });
    if (!g.crossOriginIsolated) return no('This page isn’t cross-origin isolated');
    try {
      if (typeof g.Atomics !== 'object' || typeof g.SharedArrayBuffer !== 'function') throw new Error('none');
      const mem = new g.WebAssembly.Memory({ shared: true, initial: 1, maximum: 2 });
      if (!(mem.buffer instanceof g.SharedArrayBuffer)) throw new Error('not shared');
    } catch (e) { return no('This browser has no shared memory'); }
    if (/version\/26\.2\b/i.test(nav.userAgent || '')) return no('Safari 26.2 crashes with threads');
    return { ok: true, cores, reason: '' };
  }

  // Whether WebAssembly SIMD is here, which every wasm build of Stockfish 19 needs (Firefox on 32-bit ARM has none: a
  // Samsung SM-T510's engines never answered, 2026-10-31); without it only the asm.js build runs. A function that
  // returns a v128 (wasm-feature-detect's test)
  const SIMD_TEST = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];
  function simdSupport(g = globalThis) {
    try { return !!g.WebAssembly && g.WebAssembly.validate(new Uint8Array(SIMD_TEST)); } catch (e) { return false; }
  }

  // onFail(err): called once when the engine dies, before or after it started. threaded: the multi-threaded build, the only
  // one sent Threads; threads: its count for searches that don't ask for their own (search({ threads })).
  // probeMs: from uciok, ready() also waits for the threads to start and a depth-1 search to answer, failing the engine
  // without them by then: in Firefox a threaded engine can hang while it starts its threads, or answer readyok and then
  // never search (no info, no bestmove, even after stop), while a fresh worker mostly works (found 2026-10-28, Firefox 159)
  // hangMs: a search can hang after the probe too (WebKit's threaded engine, GitHub Actions 2026-10-28); one still running
  // this long past its movetime moves to a fresh worker (started and probed as the first was), the same engine to the
  // page; HANG_TRIES workers in a row that hang on searches fail the engine
  // hashFallbackMB, onHashFail(mb, to): a hash table the engine can't get memory for ("Failed to allocate 512MB for
  // transposition table.", after which it answers nothing) moves to a fresh worker with hashFallbackMB, the search that was
  // running starting again there, and onHashFail says so; one at hashFallbackMB or less fails the engine
  function create(makeWorker, { hashMB = 64, threads = 1, readyTimeoutMs = READY_TIMEOUT_MS, probeMs = 0, threaded = false, hangMs = HANG_MS, onFail, hashFallbackMB = 64, onHashFail } = {}) {
    let worker = null, hangs = 0;
    const waiting = []; // [regex, resolve] for ready()
    const queue = [];
    let cur = null, readyP = null, rejectReady = null, isReady = false, failed = null;
    let hashWant = hashMB, hashSet = null; // a new hash size waits for the engine to be between searches
    let threadsWant = threaded ? threads : 1, threadsSet = 1; // Stockfish starts with one
    let linesSet = 1; // MultiPV, Stockfish's default until a search asks for more

    const pump = () => {
      if (cur || !isReady || failed) return;
      if (hashWant !== hashSet) { worker.postMessage(`setoption name Hash value ${hashWant}`); hashSet = hashWant; }
      let i = queue.findIndex((q) => q.priority === 'play');
      if (i < 0) i = queue.findIndex((q) => q.priority === 'own');
      if (i < 0) i = 0;
      const q = queue.splice(i, 1)[0];
      if (!q) return;
      cur = q;
      const n = !threaded ? 1 : q.threads || threadsWant;
      if (n !== threadsSet) { worker.postMessage(`setoption name Threads value ${n}`); threadsSet = n; }
      if (q.lines !== linesSet) { worker.postMessage(`setoption name MultiPV value ${q.lines}`); linesSet = q.lines; }
      worker.postMessage(positionCommand(q.moves, q.fen));
      worker.postMessage(`go ${q.depth == null ? '' : `depth ${q.depth} `}movetime ${q.movetimeMs}`);
      q.watch = setTimeout(() => hung(q), q.movetimeMs + hangMs);
    };
    const resultOf = (q, best) => {
      const l = q.last;
      return { cp: l ? l.cp : null, depth: l ? l.depth : 0, lines: linesOf(q), maxDepth: q.maxDepth == null ? (l ? l.depth : 0) : q.maxDepth, pv: l ? l.pv : [], nodes: q.nodes == null ? null : q.nodes, timeMs: q.timeMs == null ? null : q.timeMs, best: !best || best === '(none)' ? null : best };
    };
    const onLine = (line) => {
      const nomem = /^Failed to allocate (\d+) ?MB for transposition table/.exec(line);
      if (nomem) return hashFailed(+nomem[1]);
      for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i][0].test(line)) waiting.splice(i, 1)[0][1]();
      if (!cur) return;
      if (line.startsWith('info')) {
        // the eval and line come from the last complete depth; time, nodes and depth reached from the whole search
        const st = window.AnalysisCore.infoStats(line);
        if (st) {
          cur.maxDepth = Math.max(cur.maxDepth || 0, st.depth);
          if (st.nodes != null) cur.nodes = st.nodes;
          if (st.timeMs != null) cur.timeMs = st.timeMs;
        }
        const s = window.AnalysisCore.infoToScore(line, (cur.moves.length % 2 === 0) === (cur.fen ? cur.fen.split(' ')[1] !== 'b' : true) ? 'w' : 'b');
        // line 1 is the search's result; every line's last complete score is kept by its rank and by its first move, and
        // the move last reported at each rank (linesOf puts them together)
        if (s && s.multipv <= cur.lines) {
          cur.byK[s.multipv] = { k: s.multipv, cp: s.cp, depth: s.depth, pv: s.pv };
          if (s.pv.length) cur.byMove[s.pv[0]] = cur.byK[s.multipv];
          if (s.multipv === 1) cur.last = s;
        }
        const rm = rankMove(line);
        if (rm && rm[0] <= cur.lines) cur.moveK[rm[0]] = rm[1];
        if (cur.onInfo && cur.last && (s || st)) cur.onInfo({ ...cur.last, lines: linesOf(cur), nodes: cur.nodes, timeMs: cur.timeMs, maxDepth: cur.maxDepth });
      } else if (line.startsWith('bestmove')) {
        const q = cur;
        cur = null; hangs = 0;
        clearTimeout(q.watch);
        q.resolve(resultOf(q, line.split(/\s+/)[1]));
        pump();
      }
    };
    // a dead engine answers every pending and later search with null, so nothing waits forever
    const fail = (e) => {
      const first = !failed;
      failed = failed || e || new Error('engine error');
      const pending = (cur ? [cur] : []).concat(queue.splice(0));
      cur = null;
      pending.forEach((q) => { clearTimeout(q.watch); q.resolve(null); });
      if (rejectReady) { rejectReady(failed); rejectReady = null; }
      try { worker.terminate(); } catch (err) {} // a late-loading worker would otherwise hold its memory
      if (first && onFail) onFail(failed);
    };
    // messages from a worker already replaced are dropped
    const spawn = () => {
      const w = worker = makeWorker();
      w.onmessage = (e) => { if (w === worker) onLine(String(e.data)); };
      // handled here (a replaced worker's too), so the browser needn't also report it as uncaught: WebKit did, as a bare
      // "[object Event]", when a reload cut off a worker still loading (GitHub, 2026-11-11)
      w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); if (w === worker) fail(e); };
    };
    // a fresh worker, which gets every option again before the search that was running (q) runs on it (a stopped search
    // answers its last score); a boot under way goes on with the new worker
    const restart = (q) => {
      cur = null; isReady = false;
      if (q) { clearTimeout(q.watch); if (q.stopped) q.resolve(resultOf(q, null)); else { Object.assign(q, { last: null, byK: [], byMove: {}, moveK: [], maxDepth: null, nodes: null, timeMs: null }); queue.unshift(q); } }
      waiting.length = 0;
      bootTimers.forEach(clearTimeout);
      try { worker.terminate(); } catch (err) {}
      hashSet = null; threadsSet = 1; linesSet = 1;
      try { spawn(); } catch (err) { return fail(err); }
      if (bootDone) runBoot(); else boot().then(() => { isReady = true; pump(); });
    };
    // q has hung
    const hung = (q) => {
      if (cur !== q || failed) return;
      if (++hangs >= HANG_TRIES) return fail(new Error('Stockfish stopped answering'));
      restart(q);
    };
    // judged by the size last sent (hashSet), not hashWant, which a setHash() may have changed since; a smaller size asked
    // for meanwhile is kept. The hang count starts again with the new worker
    const hashFailed = (mb) => {
      if (failed) return;
      if ((hashSet == null ? mb : hashSet) <= hashFallbackMB) return fail(new Error(`Not enough memory for Stockfish’s ${mb} MB hash table`));
      hashWant = Math.min(hashWant, hashFallbackMB); hangs = 0;
      if (onHashFail) onHashFail(mb, hashWant);
      restart(cur);
    };
    spawn();

    const expect = (re) => new Promise((res) => waiting.push([re, res]));
    // uci, the options and (probeMs) the probe on the current worker: resolves once it answers, and fail() ends the
    // engine if it doesn't in time. A restart() meanwhile runs it again on the new worker (runBoot), and the first
    // worker's steps stop where they are
    let bootDone = null, bootTimers = [];
    const runBoot = () => {
      const w = worker;
      bootTimers = [setTimeout(() => fail(new Error('Stockfish did not start')), readyTimeoutMs)];
      (async () => {
        const ok = expect(/^uciok/); w.postMessage('uci'); await ok;
        if (w !== worker) return;
        // loaded: from here a threaded engine has probeMs to start its threads and answer a depth-1 search
        if (probeMs && !failed) { bootTimers.forEach(clearTimeout); bootTimers = [setTimeout(() => fail(new Error('Stockfish’s threads didn’t start')), probeMs)]; }
        w.postMessage(`setoption name Hash value ${hashWant}`); hashSet = hashWant;
        if (threadsWant !== threadsSet) { w.postMessage(`setoption name Threads value ${threadsWant}`); threadsSet = threadsWant; }
        const rd = expect(/^readyok/); w.postMessage('isready'); await rd;
        if (w !== worker) return;
        if (probeMs) {
          const bm = expect(/^bestmove/); w.postMessage('position startpos'); w.postMessage('go depth 1'); await bm;
          if (w !== worker) return;
        }
        bootTimers.forEach(clearTimeout);
        const done = bootDone; bootDone = null;
        if (!failed && done) done();
      })();
    };
    const boot = () => new Promise((resolve) => { bootDone = resolve; runBoot(); });
    function ready() {
      if (readyP) return readyP;
      if (failed) return (readyP = Promise.reject(failed)); // the engine died before anyone waited for it
      readyP = new Promise((resolve, reject) => {
        rejectReady = reject;
        boot().then(() => { isReady = true; rejectReady = null; resolve(); pump(); });
      });
      return readyP;
    }

    // lines: how many lines to search (MultiPV); the result's cp, pv and best stay line 1's, and lines lists them all
    // threads: this search's (a game's analysis keeps the count it started with), else the engine's (setThreads)
    function search({ moves, fen, depth, movetimeMs, priority = 'game', onInfo, lines = 1, threads }) {
      let q;
      const promise = new Promise((resolve) => { q = { moves, fen, depth, movetimeMs, priority, onInfo, resolve, last: null, lines, threads, byK: [], byMove: {}, moveK: [] }; });
      if (failed) q.resolve(null); else { queue.push(q); pump(); }
      return {
        promise,
        cancel() {
          const i = queue.indexOf(q);
          if (i >= 0) { queue.splice(i, 1); q.resolve(null); } else if (cur === q) { q.onInfo = null; q.stopped = true; worker.postMessage('stop'); }
        },
      };
    }

    // takes effect before the next search (the one running keeps its table)
    function setHash(mb) { hashWant = mb; pump(); }
    function setThreads(n) { if (threaded) threadsWant = n; pump(); }

    // the running search answers null too, as a dead engine's would (the page switching engines quits this one mid-search)
    function quit() {
      const pending = (cur ? [cur] : []).concat(queue.splice(0));
      cur = null;
      failed = failed || new Error('Stockfish was closed'); // later searches answer null at once
      pending.forEach((q) => { clearTimeout(q.watch); q.resolve(null); });
      try { worker.postMessage('quit'); } catch (e) {}
      try { worker.terminate(); } catch (e) {}
    }

    // hashMB(): the hash size the engine runs with (or will, before the next search), after any fallback
    return { ready, search, setHash, setThreads, threaded, quit, failed: () => failed, hashMB: () => hashWant };
  }

  window.SFEngine = { create, threadSupport, simdSupport, positionCommand, READY_TIMEOUT_MS, HANG_MS };
})();
