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

  // A search's lines in rank order, [{ k, cp, depth, pv }]: one still at a depth below line 1's last but one has
  // stopped being reported (Stockfish reports every line at each depth, line 1 first), so it is dropped
  const linesOf = (q) => {
    const top = q.byK[1];
    return top ? q.byK.filter((l) => l && l.depth >= top.depth - 1) : [];
  };

  // makeWorker: () => a Worker (or anything with postMessage, onmessage, onerror, terminate)
  // the 1.8 MB wasm downloads and compiles inside this window, so it allows a slow phone connection
  const READY_TIMEOUT_MS = 30000;

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

  // onFail(err): called once when the engine dies, before or after it started; threads: more than 1 only for the threaded build
  function create(makeWorker, { hashMB = 64, threads = 1, readyTimeoutMs = READY_TIMEOUT_MS, onFail } = {}) {
    const worker = makeWorker();
    const waiting = []; // [regex, resolve] for ready()
    const queue = [];
    let cur = null, readyP = null, rejectReady = null, isReady = false, failed = null;
    let hashWant = hashMB, hashSet = null; // a new hash size waits for the engine to be between searches
    let threadsWant = threads, threadsSet = 1; // Stockfish starts with one
    let linesSet = 1; // MultiPV, Stockfish's default until a search asks for more

    const pump = () => {
      if (cur || !isReady || failed) return;
      if (hashWant !== hashSet) { worker.postMessage(`setoption name Hash value ${hashWant}`); hashSet = hashWant; }
      if (threadsWant !== threadsSet) { worker.postMessage(`setoption name Threads value ${threadsWant}`); threadsSet = threadsWant; }
      let i = queue.findIndex((q) => q.priority === 'play');
      if (i < 0) i = queue.findIndex((q) => q.priority === 'own');
      if (i < 0) i = 0;
      const q = queue.splice(i, 1)[0];
      if (!q) return;
      cur = q;
      if (q.lines !== linesSet) { worker.postMessage(`setoption name MultiPV value ${q.lines}`); linesSet = q.lines; }
      worker.postMessage(positionCommand(q.moves, q.fen));
      worker.postMessage(`go ${q.depth == null ? '' : `depth ${q.depth} `}movetime ${q.movetimeMs}`);
    };
    worker.onmessage = (e) => {
      const line = String(e.data);
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
        // line 1 is the search's result; every line's last complete score is kept by its rank
        if (s && s.multipv <= cur.lines) { cur.byK[s.multipv] = { k: s.multipv, cp: s.cp, depth: s.depth, pv: s.pv }; if (s.multipv === 1) cur.last = s; }
        if (cur.onInfo && cur.last && (s || st)) cur.onInfo({ ...cur.last, lines: linesOf(cur), nodes: cur.nodes, timeMs: cur.timeMs, maxDepth: cur.maxDepth });
      } else if (line.startsWith('bestmove')) {
        const best = line.split(/\s+/)[1], q = cur, l = q.last;
        cur = null;
        q.resolve({ cp: l ? l.cp : null, depth: l ? l.depth : 0, lines: linesOf(q), maxDepth: q.maxDepth == null ? (l ? l.depth : 0) : q.maxDepth, pv: l ? l.pv : [], nodes: q.nodes == null ? null : q.nodes, timeMs: q.timeMs == null ? null : q.timeMs, best: !best || best === '(none)' ? null : best });
        pump();
      }
    };
    // a dead engine answers every pending and later search with null, so nothing waits forever
    const fail = (e) => {
      const first = !failed;
      failed = failed || e || new Error('engine error');
      const pending = (cur ? [cur] : []).concat(queue.splice(0));
      cur = null;
      pending.forEach((q) => q.resolve(null));
      if (rejectReady) { rejectReady(failed); rejectReady = null; }
      try { worker.terminate(); } catch (err) {} // a late-loading worker would otherwise hold its memory
      if (first && onFail) onFail(failed);
    };
    worker.onerror = (e) => fail(e);

    const expect = (re) => new Promise((res) => waiting.push([re, res]));
    function ready() {
      if (readyP) return readyP;
      if (failed) return (readyP = Promise.reject(failed)); // the engine died before anyone waited for it
      readyP = new Promise((resolve, reject) => {
        rejectReady = reject;
        const timer = setTimeout(() => fail(new Error('Stockfish did not start')), readyTimeoutMs);
        (async () => {
          const ok = expect(/^uciok/); worker.postMessage('uci'); await ok;
          worker.postMessage(`setoption name Hash value ${hashWant}`); hashSet = hashWant;
          if (threadsWant !== threadsSet) { worker.postMessage(`setoption name Threads value ${threadsWant}`); threadsSet = threadsWant; }
          const rd = expect(/^readyok/); worker.postMessage('isready'); await rd;
          clearTimeout(timer);
          if (!failed) { isReady = true; rejectReady = null; resolve(); pump(); }
        })();
      });
      return readyP;
    }

    // lines: how many lines to search (MultiPV); the result's cp, pv and best stay line 1's, and lines lists them all
    function search({ moves, fen, depth, movetimeMs, priority = 'game', onInfo, lines = 1 }) {
      let q;
      const promise = new Promise((resolve) => { q = { moves, fen, depth, movetimeMs, priority, onInfo, resolve, last: null, lines, byK: [] }; });
      if (failed) q.resolve(null); else { queue.push(q); pump(); }
      return {
        promise,
        cancel() {
          const i = queue.indexOf(q);
          if (i >= 0) { queue.splice(i, 1); q.resolve(null); } else if (cur === q) { q.onInfo = null; worker.postMessage('stop'); }
        },
      };
    }

    // takes effect before the next search (the one running keeps its table)
    function setHash(mb) { hashWant = mb; pump(); }
    function setThreads(n) { threadsWant = n; pump(); }

    // the running search answers null too, as a dead engine's would (the page switching engines quits this one mid-search)
    function quit() {
      const pending = (cur ? [cur] : []).concat(queue.splice(0));
      cur = null;
      failed = failed || new Error('Stockfish was closed'); // later searches answer null at once
      pending.forEach((q) => q.resolve(null));
      try { worker.postMessage('quit'); } catch (e) {}
      try { worker.terminate(); } catch (e) {}
    }

    return { ready, search, setHash, setThreads, quit, failed: () => failed };
  }

  window.SFEngine = { create, threadSupport, positionCommand, READY_TIMEOUT_MS };
})();
