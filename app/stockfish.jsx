// ---------- Stockfish in the browser ----------
// One engine per page, started on first use; a full-game analysis on request; the viewer's own moves.
// the engine sits next to the page: the multi-threaded build where the page allows threads, else the single-thread one
const SF_FILE = 'stockfish-19-lite-single', SF_FILE_THREADS = 'stockfish-19-lite';
// a browser without WebAssembly SIMD runs only the asm.js build (one thread, no Full): very slow and weak, but it runs
const SF_SIMD = window.SFEngine.simdSupport(), SF_FILE_ASM = 'stockfish-19-asm';
// the hash sizes offered here (AnalysisCore.hashChoices)
const SF_HASH_CHOICES = window.AnalysisCore.hashChoices({ touchOnly: !!window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches, memoryGB: navigator.deviceMemory });
// what to do about it: on iPhone and iPad every browser is Safari's WebKit, which has SIMD from iOS 16.4 (an iPad
// says it is a Mac, with touch)
const SF_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const SF_ASM_FIX = SF_IOS ? 'Update to iOS 16.4 or later' : 'Use Chrome';
const SF_ASM_NOTE = `This browser can’t run Stockfish’s WebAssembly (it has no WebAssembly SIMD), so Stockfish runs as JavaScript (asm.js), which is very slow and weak. ${SF_IOS ? SF_ASM_FIX : 'Open this page in Chrome'} for full-strength Stockfish.`;
// the same, in a line (the Analysis panel's tip row)
const SF_ASM_SHORT = `No WebAssembly SIMD: Stockfish is very slow and weak here. ${SF_ASM_FIX}`;
// (this deploy's files, window.siteFile; a wasm build's glue is told its wasm's URL after the #, else it would drop the ?v=)
const sfMakeWorker = (file, wasm) => () => new Worker(window.siteFile(file + '.js') + (wasm ? '#' + encodeURIComponent(new URL(window.siteFile(file + '.wasm'), document.baseURI).href) : ''));
// A missing engine file only shows up inside the worker (it never reaches the page as an error), so the
// page checks the wasm is there first rather than waiting out the start timeout
// A threaded engine must start its threads and answer a depth-1 search this soon after it loads (SFEngine's probeMs:
// about 0.9 s a thread in Firefox on a laptop; a slow phone has room), and the lite one load this soon (its 1.7 MB,
// against 30 s for the single-thread one on a slow connection). In Firefox one can hang before it answers uci, while it
// starts its threads, or on its first search, and a fresh one then mostly works (2026-10-28, Firefox 159: about 1 load
// in 4 needed a second), so it gets up to three tries; then this page runs one thread. Nothing is remembered: a hang
// can't be told from a browser that can't run threads, and remembering one would turn threads off in Firefox for good
const SF_PROBE_MS = (threads) => 3000 + 1500 * threads, SF_LITE_LOAD_MS = 10000, SF_THREADED_TRIES = 3;
// The asm.js engine (3.2 MB of JavaScript, compiled as it loads) gets this long to start: about 1–1.7 s in Firefox on a
// laptop, but the Samsung SM-T510 it runs on went past 30 s on a first visit ("Stockfish did not start", 2026-11-01)
const SF_ASM_LOAD_MS = 120000;
// ...so where it is the engine, it starts this soon after the page, not on the first search, which would otherwise wait
// for all of that (the page has drawn by then, and the engine compiles in its own worker)
const SF_ASM_EARLY_MS = 1500;
// url: the engine file to check (its .wasm, or the asm.js build's one .js)
const sfFilesPresent = (url) => fetch(window.siteFile(url), { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok, () => false);

// Whether Stockfish may search with threads on this page ({ on, cores, reason }, SFEngine.threadSupport); a threaded
// engine that won't start or dies turns them off for the rest of the page, with the reason the engine menu shows
let sfThreading = (() => { const s = window.SFEngine.threadSupport(); return SF_SIMD ? { on: s.ok, cores: s.cores, reason: s.reason } : { on: false, cores: s.cores, reason: 'Stockfish runs as asm.js here, with one thread' }; })();
const sfThreadingSubs = new Set();
function sfThreadsFailed(reason) {
  if (!sfThreading.on) return;
  sfThreading = { ...sfThreading, on: false, reason };
  sfThreadingSubs.forEach((f) => f(sfThreading));
}
function useSfThreading() {
  const [v, setV] = React.useState(sfThreading);
  React.useEffect(() => { sfThreadingSubs.add(setV); setV(sfThreading); return () => { sfThreadingSubs.delete(setV); }; }, []);
  return v;
}

// An engine failure as words: an Error's message, a worker's ErrorEvent (its message, which can be empty), or anything else
const sfReason = (e) => (!e ? '' : e.message ? String(e.message) : e.type === 'error' ? 'the engine’s worker crashed' : String(e));
// What the Analysis panel says while the engine is down (status 'unavailable' or 'stopped'), with why, so a failure on
// a device we can't test on can be read off the screen. then: what to do next, after a stop
function sfDownText(status, why, then = 'play a move to restart it') {
  if (status === 'off') return 'Stockfish is off: turn it on with the switch by the engine';
  if (status === 'busy') return 'Stockfish is analysing the game: it looks at your moves again once that ends';
  const r = why ? ` (${why})` : '';
  return status === 'unavailable' ? 'Stockfish can’t run here' + r : `Stockfish stopped${r} · ${then}`;
}

// kind: 'lite' or 'asm' (next to the page) or 'full' (the viewer's download, sf-full.js); a change quits the engine running, and
// the next use starts the other. onBroken: the full engine's kept copy turned out missing (it is dropped).
// threads: Threads (engineSettings), changed between searches without a restart; a single-thread engine ignores it
// onHashFail(mb, to): the engine couldn't get memory for an mb MB hash table and runs with to MB (SFEngine)
// hashMB: the live searches' hash table; holdHash(mb) gives the engine the game analysis's size while a run goes on (its
// searches and any live ones between them share the table, so it isn't resized and cleared on every switch), and
// holdHash(null) gives hashMB back
function useEngine(hashMB, threads, kind = 'lite', onBroken, onHashFail) {
  const ref = React.useRef(null), hash = React.useRef(hashMB), want = React.useRef(kind), has = React.useRef(kind), broken = React.useRef(onBroken), hashFail = React.useRef(onHashFail);
  const nThreads = React.useRef(threads), threaded = React.useRef(false);
  hash.current = hashMB;
  nThreads.current = threads;
  const held = React.useRef(null), hashNow = () => (held.current != null ? held.current : hash.current);
  // set while rendering, not in an effect: the panels' effects run before this one and must not get the engine being replaced
  want.current = kind;
  broken.current = onBroken;
  hashFail.current = onHashFail;
  React.useEffect(() => { if (ref.current && held.current == null) ref.current.then((eng) => eng.setHash(hashMB), () => {}); }, [hashMB]);
  const holdHash = React.useCallback((mb) => {
    if (held.current === mb) return;
    held.current = mb;
    if (ref.current) ref.current.then((eng) => eng.setHash(hashNow()), () => {});
  }, []);
  React.useEffect(() => { if (ref.current) ref.current.then((eng) => eng.setThreads(threads), () => {}); }, [threads]);
  // statusNow: the status as just set, for code that runs before the next render (a run's catch, right after the
  // engine's start failed)
  const [status, showStatus] = React.useState('idle'), statusNow = React.useRef('idle');
  const setStatus = React.useCallback((v) => { statusNow.current = v; showStatus(v); }, []);
  const [why, setWhy] = React.useState(''); // why the engine stopped or can't run (sfDownText shows it)
  // the engine of the other kind, quit (its running search answers null)
  const drop = React.useCallback(() => {
    if (has.current === want.current) return false;
    has.current = want.current;
    const old = ref.current;
    ref.current = null;
    if (old) old.then((eng) => eng.quit(), () => {});
    return true;
  }, []);
  // a change no panel asks for at once still frees the old engine (the full one holds about 100 MB)
  React.useEffect(() => { if (drop()) setStatus('idle'); }, [kind]);
  const get = React.useCallback(() => {
    drop();
    if (!ref.current) {
      setStatus('loading'); setWhy('');
      // an engine that dies later is dropped too: the panels say so, and the next use starts a new one
      let mine = null;
      const k = has.current;
      // one try with threads where the page allows them, and if that engine won't start, one without. kk: the engine
      // kind to start (a full engine whose threaded build won't start, with no single-thread copy kept, falls back to lite)
      const attempt = async (withThreads, kk = k) => {
        threaded.current = false; // set once the files are there: a missing file is not the threads' fault
        let make;
        if (kk === 'full') {
          try { make = await window.SFFull.start(withThreads ? 'threads' : 'single'); } catch (e) { if (broken.current) broken.current(); throw e; }
        } else {
          const file = kk === 'asm' ? SF_FILE_ASM : withThreads ? SF_FILE_THREADS : SF_FILE;
          if (!(await sfFilesPresent(file + (kk === 'asm' ? '.js' : '.wasm')))) throw new Error('The Stockfish files are missing next to this page');
          make = sfMakeWorker(file, kk !== 'asm');
        }
        threaded.current = withThreads;
        // an engine that dies before it is ready is start()'s to handle: ready() rejects, and a threaded one falls back,
        // a single-thread one ends 'unavailable' (with Try again), not 'stopped'
        let up = false;
        const onFail = (err) => {
          if (!up) return;
          if (withThreads) sfThreadsFailed('The threaded engine stopped');
          if (ref.current === mine) { ref.current = null; setStatus('stopped'); setWhy(sfReason(err)); }
        };
        const eng = window.SFEngine.create(make, { hashMB: hashNow(), threaded: withThreads, threads: withThreads ? nThreads.current : 1, probeMs: withThreads ? SF_PROBE_MS(nThreads.current) : 0,
          ...(withThreads && kk === 'lite' ? { readyTimeoutMs: SF_LITE_LOAD_MS } : kk === 'asm' ? { readyTimeoutMs: SF_ASM_LOAD_MS } : {}), onFail, onHashFail: (mb, to) => { if (held.current != null) held.current = to; else hash.current = to; if (hashFail.current) hashFail.current(mb, to); } });
        await eng.ready();
        up = true;
        return eng;
      };
      const start = async () => {
        if (!sfThreading.on) return attempt(false);
        for (let i = 0; i < SF_THREADED_TRIES; i++) {
          try { return await attempt(true); } catch (e) { if (!threaded.current) throw e; }
        }
        // Full with no single-thread copy kept runs Lite: marked as running before the threads turn off, so the switch
        // to Lite that follows (useFullEngine) doesn't quit this engine
        const kk = k === 'full' && !(await window.SFFull.present('single')) ? 'lite' : k;
        if (kk !== k) has.current = kk;
        sfThreadsFailed('The threaded engine didn’t start');
        return attempt(false, kk);
      };
      mine = ref.current = start().then((eng) => { if (ref.current === mine) setStatus('ready'); return eng; }, (e) => { if (ref.current === mine) { setStatus('unavailable'); setWhy(sfReason(e)); ref.current = null; } throw e; });
      mine.catch(() => {});
    }
    return ref.current;
  }, []);
  React.useEffect(() => {
    if (kind !== 'asm') return;
    const id = setTimeout(() => get().catch(() => {}), SF_ASM_EARLY_MS);
    return () => clearTimeout(id);
  }, [kind]);
  return { get, status, statusNow, why, holdHash };
}

// The full engine's download (the Analysis panel's engine drop-down and menu).
// state: 'checking', 'absent', 'downloading' (got: bytes so far) or 'ready'; err: why the last download, start or removal failed
const SF_FULL_OFFERED = SF_SIMD && !!(window.SFFull && window.SFFull.supported());
// build: the threaded one where the page allows threads. Which builds are kept is checked once, so the state follows the
// build at once when threads turn off (the threaded engine wouldn't run): Full stays where its single-thread copy is
// kept, else the viewer is back on Lite (a state passing through 'checking' would switch engines twice, quitting the
// one just started)
function useFullEngine() {
  const threading = useSfThreading(), build = threading.on ? 'threads' : 'single';
  const [kept, setKept] = React.useState(null); // { single, threads } once checked
  const dl = useKeptDownload(), wasReady = React.useRef(false);
  React.useEffect(() => {
    if (SF_FULL_OFFERED) Promise.all([window.SFFull.present('single'), window.SFFull.present('threads')]).then(([single, threads]) => setKept((k) => k || { single, threads }));
  }, []);
  const state = !SF_FULL_OFFERED ? 'absent' : dl.on ? 'downloading' : !kept ? 'checking' : kept[build] ? 'ready' : 'absent';
  // (this runs before the next effect, so wasReady is still the last build's)
  React.useEffect(() => {
    if (state === 'absent' && wasReady.current) dl.setErr('Full’s threaded build didn’t run here, so Lite is running. Download Full again to use it.');
  }, [build]);
  React.useEffect(() => { if (state !== 'checking') wasReady.current = state === 'ready'; }, [state]);
  const download = async () => {
    const b = build, ok = await dl.start((o) => window.SFFull.download({ build: b, ...o }));
    // a download replaces the other build, which went before it began, whether or not it ended kept
    if (ok !== null) setKept({ single: ok && b === 'single', threads: ok && b === 'threads' });
  };
  // a removal that fails says why, and the state follows what is still kept
  const remove = async () => { dl.cancel(); const r = await window.SFFull.removeKept(); setKept(r.kept); dl.setErr(r.err); };
  const broken = React.useCallback(() => {
    setKept((k) => ({ ...k, [build]: false }));
    dl.setErr('The downloaded engine was missing, so Lite is running. Download it again to use Full.');
  }, [build]);
  return { offered: SF_FULL_OFFERED, state, got: dl.got, err: dl.err, build, total: window.SFFull ? window.SFFull.total(build) : 0, download, cancel: dl.cancel, remove, broken };
}

const sfIsBrowserAnalysis = (analysis) => {
  try { const a = typeof analysis === 'string' ? JSON.parse(analysis) : analysis; return !!(a && a.engine && Object.values(window.AnalysisCore.ENGINE_NAMES).includes(a.engine.name)); } catch (e) { return false; }
};

// The searches of a run that stopped part-way, kept for one game (the latest) so starting again resumes it; a page
// reload keeps them too. Keyed by the game's moves and the engine settings, so they never fill in another game.
const SF_PARTIAL_STORE = 'chess-video.sf-partial.v1';
// A game from a start FEN adds it to the key, and so does the endgame tablebase (tb: on); a standard game's key with
// the tablebase off is as it always was.
const sfStartFen = (fen) => (fen && fen !== window.ChessCore.START_FEN ? fen : null);
// (its stored form is older than sfRunKey and kept, so a deploy drops nobody's partial run)
const sfPartialKey = (ucis, settings, fen, tb) => JSON.stringify((sfStartFen(fen) ? [fen, settings, ucis] : [settings, ucis]).concat(tb ? ['tablebase'] : []));
// A run's identity apart from its game: the engine settings and whether the tablebase answers (tb). The page's own
// (the settings as they are now) against a run's says whether that run's progress is what "Resume from move N" shows
const sfRunKey = (settings, tb) => JSON.stringify(settings) + (tb ? ' tablebase' : '');
function readSfPartial(ucis, settings, fen, tb) {
  try { const s = JSON.parse(localStorage.getItem(SF_PARTIAL_STORE) || 'null'); return s && s.key === sfPartialKey(ucis, settings, fen, tb) && Array.isArray(s.searched) ? s.searched : []; } catch (e) { return []; }
}
function writeSfPartial(ucis, settings, searched, fen, tb) {
  try { if (searched) localStorage.setItem(SF_PARTIAL_STORE, JSON.stringify({ key: sfPartialKey(ucis, settings, fen, tb), searched })); else localStorage.removeItem(SF_PARTIAL_STORE); } catch (e) {}
}
// A position the tablebase answers costs at least this in a run: one request, AnalysisCore.TB_GAP_MS after the last
// (a slow answer costs more; a run then counts the time its requests took)
const SF_TB_SECONDS = window.AnalysisCore.TB_GAP_MS / 1000;
// which of a game's positions (0: the start, k: after k moves) are small enough for the tablebase
const sfTbPositions = (M) => [M.start.fen, ...M.plies.map((p) => p.fen)].map((f) => window.LichessCore.pieceCount(f) <= window.LichessCore.TB_MAX_PIECES);

// a game analysis whose tablebase requests stopped answering part-way (runAnalysis's onTablebaseLost)
const SF_TB_LOST = 'Lichess’s tablebase stopped answering: Stockfish searched the endgame positions after that';

// This device's pace against the model's (AnalysisCore.paceFactor), from the last run that timed enough positions, for
// each engine (name: the settings' engine name; the full engine searches fewer nodes a second)
const SF_PACE_STORE = 'chess-video.sf-pace.v1', SF_PACE_MIN_POSITIONS = 10;
// and thread count (one thread keeps the key it always had)
const sfPaceKey = (name, threads) => (name === window.AnalysisCore.ENGINE_NAMES.full ? SF_PACE_STORE + '.full' : name === window.AnalysisCore.ENGINE_NAMES.asm ? SF_PACE_STORE + '.asm' : SF_PACE_STORE) + (threads > 1 ? '.t' + threads : '');
// (the engine's starting factor, AnalysisCore.paceStart, until a run has timed enough positions)
function readSfPace(name, threads) { const k = window.AnalysisCore.paceStart(name); try { const f = +localStorage.getItem(sfPaceKey(name, threads)); return f > 0 ? f : k; } catch (e) { return k; } }
function writeSfPace(name, threads, f) { try { localStorage.setItem(sfPaceKey(name, threads), String(f)); } catch (e) {} }

// The full-game analysis. Loading other files (another game, the sample) abandons a run in progress; its searches
// so far are kept, and starting it again resumes from them.
// getFiles: the loaded files as they are now (notes or commentary may have changed during the run)
// settings: the engine settings for a game (AnalysisCore.engineSettings().game); a run keeps those it started with
// tbOn: Settings › Online data › Endgame tablebase: positions of 7 pieces or fewer ask it first (runAnalysis)
function useGameAnalysis(M, files, getFiles, commit, engine, settings, tbOn) {
  const A = window.AnalysisCore, tb = !!(tbOn && TB), setKey = sfRunKey(settings, tb);
  const [pace, setPace] = React.useState(() => readSfPace(settings.name, settings.threads));
  React.useEffect(() => { setPace(readSfPace(settings.name, settings.threads)); }, [settings.name, settings.threads]);
  const perPos = A.secondsPerPosition(settings, pace);
  // note: what the viewer should know about the run that isn't a failure (Lichess's tablebase lost part-way), kept after it
  // ends until the next run starts
  const idle = { state: 'idle', done: 0, total: 0, etaSec: null, err: '', note: '' };
  const [st, setSt] = React.useState(idle);
  const run = React.useRef(null);
  const ucisKey = M.plies.map((p) => p.uci).join(' ');
  const setKeyRef = React.useRef(setKey);
  setKeyRef.current = setKey;
  // the setting as it is now: turned off during a run, the run asks the tablebase no more
  const tbRef = React.useRef(tb);
  tbRef.current = tb;
  // moves already analysed by a run that stopped
  const [resumeAt, setResumeAt] = React.useState(0);
  React.useEffect(() => { setResumeAt(Math.max(0, readSfPartial(M.plies.map((p) => p.uci), settings, M.start.fen, tb).length - 1)); }, [ucisKey, setKey, M.start.fen]);
  // the positions the tablebase will answer, near-free in the estimate (an uncertain answer is searched after all)
  const tbAt = React.useMemo(() => (tb ? sfTbPositions(M) : []), [ucisKey, M.start.fen, tb]);
  // seconds for positions from..N: Stockfish's at perSec, the tablebase's at tbSec
  const secondsFrom = (from, perSec, tbSec = SF_TB_SECONDS) => { let t = 0; for (let k = from; k <= M.plies.length; k++) t += tbAt[k] ? tbSec : perSec; return t; };
  React.useEffect(() => () => { if (run.current) { run.current.ctl.abort(); run.current = null; } setSt(idle); }, [files.pgn, files.gameIndex || 0, !!files.sample, files.analysis]);
  const start = async () => {
    if (run.current) return;
    const me = { ctl: new AbortController() };
    run.current = me;
    const ucis = M.plies.map((p) => p.uci), sans = M.plies.map((p) => p.san), N = ucis.length;
    const T = tb, prior = perPos;
    let S = { ...settings }, earlier = readSfPartial(ucis, S, M.start.fen, T), d0 = Math.max(0, earlier.length - 1);
    // the run's own pace: positions timed from when the engine is ready (its start-up isn't a position's cost)
    const timed = { n: 0, sec: 0, last: 0, tbN: 0, tbSec: 0 };
    // { sec, at }: the latest estimate and when it was made; a timer counts it down in between
    me.eta = { sec: secondsFrom(earlier.length, prior), at: Date.now() };
    setSt({ state: 'running', done: d0, total: N, etaSec: Math.round(me.eta.sec), err: '', note: '' });
    if (engine.holdHash) engine.holdHash(S.hash_mb);
    try {
      const eng = await engine.get();
      // an engine that fell back to one thread searches, records and resumes as one
      // and one whose hash table fell back (SFEngine's hashMB) as that size; so does one that falls back during the run:
      // S is runAnalysis's own settings object, so the analysis records the size the run ended with, and its partial
      // run is kept under the settings the page now has (GameApp offers no bigger size for the rest of the visit)
      const hashNow = () => (eng && eng.hashMB ? eng.hashMB() : S.hash_mb);
      if (eng && ((!eng.threaded && S.threads !== 1) || hashNow() !== S.hash_mb)) { S = { ...S, threads: eng.threaded ? S.threads : 1, hash_mb: hashNow() }; earlier = readSfPartial(ucis, S, M.start.fen, T); d0 = Math.max(0, earlier.length - 1); }
      timed.last = Date.now();
      const json = await window.AnalysisCore.runAnalysis({
        engine: eng, ucis, sans, headers: M.headers, signal: me.ctl.signal, earlier, settings: S, startFen: M.start.fen, tablebase: T ? TB : null, tablebaseOn: () => tbRef.current,
        onSearched: (R, { searches = 0, tbMs = 0, tbAsks = 0 } = {}) => {
          S.hash_mb = hashNow();
          writeSfPartial(ucis, S, R, M.start.fen, T);
          if (sfRunKey(S, T) === setKeyRef.current) setResumeAt(Math.max(0, R.length - 1));
          const now = Date.now();
          // the searches' time only: the tablebase's (its requests and the waits between them) says nothing of this device's pace
          if (searches) { timed.sec += Math.max(0, now - timed.last - tbMs) / 1000; timed.n += searches; }
          timed.last = now;
          // the tablebase's own time per request, where its answers come slower than TB_GAP_MS
          if (tbAsks) { timed.tbSec += tbMs / 1000; timed.tbN += tbAsks; }
          me.eta = { sec: secondsFrom(R.length, A.blendPace(prior, timed.sec, timed.n), timed.tbN ? Math.max(SF_TB_SECONDS, timed.tbSec / timed.tbN) : SF_TB_SECONDS), at: now };
        },
        onProgress: (d, n) => { if (run.current === me && d > d0 && me.eta) setSt((s) => ({ ...s, done: d, total: n, etaSec: Math.round(me.eta.sec) })); },
        onTablebaseLost: () => { if (run.current === me) setSt((s) => ({ ...s, note: SF_TB_LOST })); },
      });
      if (run.current !== me) return;
      run.current = null;
      if (!json) { setSt((s) => ({ ...idle, note: s.note })); return; }
      writeSfPartial(ucis, S, null, M.start.fen, T);
      setResumeAt(0);
      // with no depth limit every position takes its time limit, which says nothing about this device's pace
      if (S.depth != null && timed.n >= SF_PACE_MIN_POSITIONS) { const f = A.paceFactor(S, timed.sec / timed.n); writeSfPace(S.name, S.threads, f); setPace(f); }
      const name = (M.white.short + '_' + M.black.short).replace(/[^\w-]+/g, '_') + '_analysis.json';
      setSt((s) => ({ ...idle, note: s.note }));
      commit({ ...getFiles(), analysis: json, analysisName: name, evalSource: null }); // shown, even over PGN evals
    } catch (e) {
      if (run.current !== me) return;
      run.current = null;
      setSt((s) => ({ ...idle, note: s.note, err: engine.statusNow.current === 'unavailable' ? '' : `Analysis stopped: ${(e && e.message) || e}. Press the computer button to start analysis again.` }));
    }
  };
  // the run's hash table goes back to the live searches' once it ends, however it ends
  React.useEffect(() => { if (st.state !== 'running' && engine.holdHash) engine.holdHash(null); }, [st.state]);
  // between positions the estimate counts down by the second
  React.useEffect(() => {
    if (st.state !== 'running') return;
    const id = setInterval(() => {
      const r = run.current;
      if (r && r.eta) setSt((s) => ({ ...s, etaSec: Math.max(1, Math.round(r.eta.sec - (Date.now() - r.eta.at) / 1000)) }));
    }, 1000);
    return () => clearInterval(id);
  }, [st.state]);
  const stop = () => { if (run.current) { run.current.ctl.abort(); run.current = null; } setSt(idle); };
  return { ...st, start, stop, resumeAt, plies: M.plies.length, estimateMin: Math.max(1, Math.ceil(secondsFrom(resumeAt ? resumeAt + 1 : 0, perPos) / 60)) };
}

// A button inside a panel (theme colours, sized with the panel text)
// compact: a size down, for a phone's tight panels (Edit position held sideways)
function FrameButton({ primary, color, onClick, children, label, disabled, compact, className }) {
  const c = color || C.best;
  return (
    <button type="button" className={['frame-btn', primary && 'frame-btn-primary', className].filter(Boolean).join(' ')} aria-label={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }} onPointerDown={(e) => e.stopPropagation()}
      style={{ whiteSpace: 'nowrap', font: `600 ${tx(primary ? (compact ? 17 : 20) : (compact ? 14 : 15))}px ${MONO}`, letterSpacing: primary ? '0.02em' : '0.1em', textTransform: primary ? 'none' : 'uppercase', padding: primary ? (compact ? `${tx(7)}px ${tx(18)}px` : `${tx(12)}px ${tx(22)}px`) : (compact ? `${tx(4)}px ${tx(10)}px` : `${tx(5)}px ${tx(12)}px`), borderRadius: 4, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, userSelect: 'none', WebkitUserSelect: 'none', border: `1.5px solid ${c}`, background: primary ? c : 'transparent', color: primary ? C.bg : c }}>
      {children}
    </button>
  );
}

// time left: to 5 s under a minute, to 10 s under 5 min (so it visibly counts down), then to the minute
const fmtEta = (s) => {
  if (s == null) return '';
  if (Math.round(s / 5) * 5 < 60) return `about ${Math.max(5, Math.round(s / 5) * 5)} s left`;
  if (s >= 300) return `about ${Math.round(s / 60)} min left`;
  const t = Math.round(s / 10) * 10, m = Math.floor(t / 60), x = t % 60;
  return `about ${m} min${x ? ` ${x} s` : ''} left`;
};

// The Analysis panel's body for a game without evals
// compact: a row under a panel that already shows PGN variations (no heading text); ask: Analyse with Stockfish (or Resume)
// offered, only before the game's first move (the Analysis panel's computer button has it everywhere)
function EngineEmptyState({ M, sf, paused, compact, ask = true }) {
  const run = sf.run;
  if (run.state === 'running') {
    const k = run.total ? run.done / run.total : 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: tx(14) }}>
        <span style={{ ...NO_SELECT, font: `500 ${tx(22)}px ${MONO}`, color: C.ink }}>{sf.status !== 'ready' ? 'Starting Stockfish…' : `Analysing ${run.done} / ${run.total}${run.done > 0 ? ' · ' + fmtEta(run.etaSec) : ''}`}</span>
        <div style={{ height: tx(8), borderRadius: 2, background: C.off, overflow: 'hidden' }}><div style={{ width: `${(k * 100).toFixed(1)}%`, height: '100%', background: C.best }} /></div>
        {paused && <div><FrameButton onClick={sf.stop} label="Stop the analysis">Stop</FrameButton></div>}
      </div>
    );
  }
  // a panel too narrow for the estimate on the button (a phone's) puts it beside the button
  const narrow = !L.analysis || L.analysis.w < 480, est = `about ${sf.estimateMin} min`;
  const text = compact ? null : <span style={{ ...NO_SELECT, font: `400 ${tx(26)}px ${SERIF}`, color: C.dim, fontStyle: 'italic' }}>No engine analysis for this game.</span>;
  if (!paused || !ask) return text;
  if (sf.status === 'unavailable') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: tx(12) }}>
        {text}
        <span style={{ font: `500 ${tx(17)}px ${MONO}`, color: C.dim }}>Stockfish can't run here.</span>
        <div><FrameButton onClick={() => sf.engine.get().catch(() => {})} label="Try starting Stockfish again">Try again</FrameButton></div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tx(14), alignItems: 'flex-start' }}>
      {text}
      <div style={{ display: 'flex', alignItems: 'center', gap: tx(14), flexWrap: 'wrap' }}>
        <FrameButton primary onClick={sf.ask}>{(run.resumeAt ? `${narrow ? 'Resume' : 'Resume analysis'} from move ${Math.floor((M.ply0 + run.resumeAt) / 2) + 1}` : 'Analyse with Stockfish') + (narrow ? '' : ` · ${est}`)}</FrameButton>
        {narrow && <span style={{ ...NO_SELECT, font: `500 ${tx(15)}px ${MONO}`, color: C.dim, whiteSpace: 'nowrap' }}>{est}</span>}
      </div>
      {run.resumeAt > 0 && <span style={{ ...NO_SELECT, font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{run.resumeAt} of {run.plies} moves analysed so far.</span>}
      {!compact && <span style={{ ...NO_SELECT, font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{engineLabel(sf.game.name)} runs in your browser.</span>}
      {!SF_SIMD && <span style={{ ...NO_SELECT, font: `500 ${tx(15)}px ${MONO}`, color: C.blunder }}>{SF_ASM_NOTE}</span>}
    </div>
  );
}

// ---------- the viewer's own moves ----------
const CLOUD = window.LichessCore ? window.LichessCore.create() : null; // Lichess's cloud evaluation, cached for the session
// The session's finished searches and presses of Go deeper, and the rules for what shows: app/move-eval.js, which
// says what a request's fields mean and what a watch reports. The cloud is asked 300 ms after the last position change
// (stepping through moves asks nothing for the ones passed)
const MOVE_EVAL = window.MoveEval.create({ cloud: CLOUD });
const cloudSetting = (tw) => ({ on: !!(tw && tw.cloudEval), prefer: !!(tw && tw.cloudPrefer) });

// Evaluates the positions before and after the viewer's move; the score streams in. req: a MoveEval request
// ({ engine, before, after, settings, fen, stored, cloud, off, auto }). Returns its watch's state (before, after,
// pending, progress, deeper, deeperTo) and failed: why a Go deeper search didn't run, shown in place of its depth. The
// message is kept here, not by the watch, so it is still there after a step to another move and back, until a press
function useMoveEval(req) {
  const key = MOVE_EVAL.keyOf(req), base = MOVE_EVAL.positionKey(req);
  const [st, setSt] = React.useState({ key: '', ev: null });
  const [fail, setFail] = React.useState(null); // { key: base, msg }
  // a layout effect: a new key's state (the cached results and cloud answers it starts with) replaces the old one
  // before the page paints, so no frame shows the bare analysis in between (switching Stockfish off flashed it)
  React.useLayoutEffect(() => {
    if (!key) { setSt({ key: '', ev: null }); return; }
    const read = () => {
      const ev = w.get();
      if (ev.failed) setFail((f) => (f && f.key === base && f.msg === ev.failed ? f : { key: base, msg: ev.failed }));
      setSt({ key, ev });
    };
    const w = MOVE_EVAL.watch(req, read);
    read();
    return w.stop;
  }, [key]);
  // a new key's first render, before its layout effect: pending only where it will search (off, as while a game analysis
  // runs, never does, so the Analysis panel's progress line keeps showing the run's rather than starting over at each move)
  const ev = st.key === key && st.ev ? st.ev : { ...window.MoveEval.EMPTY, pending: !!req.after && !req.off, deeper: null, deeperTo: null };
  return { ...ev, deeper: ev.deeper && (() => { setFail(null); ev.deeper(); }), failed: fail && fail.key === base ? fail.msg : null };
}

// Go deeper: the small + after the search's stats in the Analysis heading, once an eval has finished; sized in em to
// the heading, its negative margins keep the heading's height whether or not it shows, so the panel doesn't jump
function DeeperButton({ ev }) {
  if (!ev || !ev.deeper) return null;
  const t = ev.deeperTo, tip = t.depth == null ? `Go deeper: ${t.time_limit} s` : `Go deeper: depth ${t.depth}, up to ${t.time_limit} s`;
  return (
    <button type="button" className="frame-btn" aria-label={tip} title={tip} onClick={(e) => { e.stopPropagation(); ev.deeper(); }} onPointerDown={(e) => e.stopPropagation()}
      style={{ ...NO_SELECT, flex: 'none', width: '1.5em', height: '1.5em', padding: 0, margin: '-0.25em 0 -0.25em -0.4em', borderRadius: 3, cursor: 'pointer', border: `1.5px solid ${C.best}`, background: 'transparent', color: C.best, font: `700 1.2em/1 ${MONO}`, letterSpacing: 0 }}>+</button>
  );
}

// An engine line's moves from pos as steps the board can play, stopping at the first illegal one
function engineSteps(pos, pv, max = 8) {
  const out = [];
  for (const u of (pv || []).slice(0, max)) { const s = window.ChessCore.stepFromUci(pos, u); if (!s) break; out.push({ ...s, byEngine: true }); pos = s.pos; }
  return out;
}

// Analysis › ☰ › Lines above one: each line's eval and first moves, the moves wrapping under each other beside
// the eval (a narrow panel scrolls to the later lines); a move plays the line on the board up to it. c: the ply the lines start at
// cloud: the lines are Lichess's cloud evaluation's
function EngineLines({ lines, pos, ply0, c, onPick, onHover, cloud }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tx(6) }}>
      {lines.map((l) => {
        const st = engineSteps(pos, l.pv, 6), ev = fmtSf(l.cp);
        return (
          <div key={l.k} {...lineRow(onHover && (() => onHover(null)))} style={{ display: 'flex', alignItems: 'flex-start', gap: tx(6) }}>
            <span style={{ flex: '0 0 auto', width: tx(72), whiteSpace: 'nowrap', lineHeight: `${tx(30)}px`, color: l.k === 1 ? C.ink : C.dim }}>{ev}</span>
            <div style={{ flex: '1 1 0', minWidth: 0 }}>
              <LineChips name={null} tip={`${cloud ? 'Lichess cloud' : 'Stockfish'}'s line ${l.k} (${ev})`} accent={l.k === 1 ? C.best : C.line}
                moves={st.map((m) => m.san)} ply0={ply0} c={c} legal={st.length} sel={null} onPick={(j) => onPick(st.slice(0, j + 1))} onHover={onHover && ((j) => onHover(j == null ? null : st.slice(0, j + 1)))} bare />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Arrows for the lines' first moves, one line or several: line 1 the best line's, the others thinner and fainter, each
// as thick (w, 0 to 1) as its winning chances stand between the worst line's (0, the thinnest) and the best line's (1)
const lineArrows = (r) => {
  if (!(r && r.lines && r.lines.length)) return r && r.pv && r.pv[0] ? [{ uci: r.pv[0], k: 1 }] : null;
  const ls = r.lines.filter((l) => l.pv && l.pv[0]), wc = (l) => (l.cp == null ? null : window.ChessCore.winChance(l.cp));
  const best = ls.find((l) => l.k === 1), b = best ? wc(best) : null;
  const gaps = ls.map((l) => (b == null || wc(l) == null ? null : Math.abs(b - wc(l)))), worst = Math.max(0, ...gaps.filter((g) => g != null));
  return ls.map((l, i) => ({ uci: l.pv[0], k: l.k, w: gaps[i] == null ? 0 : worst > 0 ? 1 - gaps[i] / worst : 1 }));
};

// a search's eval (tb: its tablebase answer, if it came from one; ChessCore.decodeEval)
const fmtSf = (cp, tb) => {
  if (cp == null) return '…';
  const ev = window.ChessCore.decodeEval(cp, tb);
  if (ev.won) return ev.won === 'w' ? '1-0' : '0-1';
  if (ev.mate != null) return window.ChessCore.mateIn(cp) === 0 ? (cp > 0 ? '1-0' : '0-1') : (cp > 0 ? 'M' : '−M') + Math.abs(ev.mate);
  return (cp > 0 ? '+' : cp < 0 ? '−' : '') + Math.abs(cp / 100).toFixed(2);
};

// The Analysis panel while the viewer plays their own line: their move, its eval, what it costs, Stockfish's reply; top:
// what goes between the verdict and the lines (the replay's Tablebase block)
// who: the words before the verdict (null: none, for a loaded game's move); by default YOUR MOVE or STOCKFISH'S REPLY
function OwnMoveAnalysis({ M, vline, own, status, why, onReply, onHover, top, who: whoIs }) {
  const step = vline.moves[vline.upto], ply = vline.at + vline.upto, isWhite = (M.ply0 + ply) % 2 === 0;
  const { before, after } = own;
  const done = before && after && !before.partial && !after.partial;
  const rated = done ? window.AnalysisCore.rateMove({ bestEval: before.cp, currentEval: after.cp, isWhite, playedIsBest: step.uci === before.best, isCheckmate: step.san.endsWith('#') }) : null;
  const bad = rated && ['inaccuracy', 'mistake', 'blunder'].includes(rated.classification);
  const col = bad ? clsColor(rated.classification) : lineAccent(vline.src || 'you');
  const who = whoIs !== undefined ? whoIs : step.byEngine ? 'STOCKFISH’S REPLY' : 'YOUR MOVE';
  const down = status === 'unavailable' || status === 'stopped' || status === 'off' || status === 'busy';
  const verdict = !rated ? (down ? sfDownText(status, why) : 'Stockfish is thinking…')
    : step.uci === before.best ? 'Stockfish’s choice'
    : rated.evalLoss > 0 ? `−${Math.round(rated.evalLoss)} cp vs ${own.bestSan || before.best}` : `as good as ${own.bestSan || before.best}`;
  const replies = engineSteps(step.pos, after && after.pv);
  const many = after && after.lines && after.lines.length > 1;
  return (
    <React.Fragment>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: tx(28) }}>
        <span style={{ font: `700 ${headline()}px ${MONO}`, color: col }}>{lineLabel(M, vline.at, vline.upto, step.san)}</span>
        <EvalWithStat>{down && !(after && !after.partial) ? '—' : fmtSf(after && after.cp, after && after.tb)}</EvalWithStat>
      </div>
      {/* the verdict spans the panel, under the move and the eval, so it fits on one line in the phone layout */}
      <div style={{ marginTop: anGap(6), font: `600 ${tx(16)}px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: col }}>{who && who + ' · '}{bad ? CLASS_LABEL[rated.classification] + ' · ' : ''}{verdict}</div>
      {top}
      <div style={{ marginTop: anGap(16), paddingTop: anGap(14), borderTop: `1px solid ${C.line}`, font: `500 ${tx(18)}px ${MONO}`, color: C.dim, display: 'flex', flexDirection: 'column', gap: anGap(8) }}>
        {many ? <EngineLines lines={after.lines} pos={step.pos} ply0={M.ply0} c={ply + 1} onPick={onReply} onHover={onHover} cloud={after.source === 'cloud'} />
          : replies.length > 0
          ? <LineChips name={null} tip={after.source === 'cloud' ? 'Lichess cloud’s reply' : 'Stockfish’s reply'} accent={C.best} moves={replies.map((r) => r.san)} ply0={M.ply0} c={ply + 1} legal={replies.length} sel={null} onPick={(j) => onReply(replies.slice(0, j + 1))} onHover={onHover && ((j) => onHover(j == null ? null : replies.slice(0, j + 1)))} />
          : <span>{step.san.endsWith('#') ? 'Checkmate.' : ' '}</span>}
      </div>
    </React.Fragment>
  );
}
