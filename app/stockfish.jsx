// ---------- Stockfish in the browser ----------
// One engine per page, started on first use; a full-game analysis on request; the viewer's own moves.
// the engine sits next to the page: the multi-threaded build where the page allows threads, else the single-thread one
const SF_FILE = 'stockfish-19-lite-single', SF_FILE_THREADS = 'stockfish-19-lite';
const sfMakeWorker = (file) => () => new Worker(file + '.js');
// A missing engine file only shows up inside the worker (it never reaches the page as an error), so the
// page checks the wasm is there first rather than waiting out the start timeout
const sfFilesPresent = (file) => fetch(file + '.wasm', { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok, () => false);

// Whether Stockfish may search with threads on this page ({ on, cores, reason }, SFEngine.threadSupport); a threaded
// engine that won't start or dies turns them off for the rest of the page, with the reason the engine menu shows
let sfThreading = (() => { const s = window.SFEngine.threadSupport(); return { on: s.ok, cores: s.cores, reason: s.reason }; })();
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

// kind: 'lite' (next to the page) or 'full' (the viewer's download, sf-full.js); a change quits the engine running, and
// the next use starts the other. onBroken: the full engine's kept copy turned out missing (it is dropped).
// threads: Threads (engineSettings), changed between searches without a restart; a single-thread engine ignores it
function useEngine(hashMB, threads, kind = 'lite', onBroken) {
  const ref = React.useRef(null), hash = React.useRef(hashMB), want = React.useRef(kind), has = React.useRef(kind), broken = React.useRef(onBroken);
  const nThreads = React.useRef(threads), threaded = React.useRef(false);
  hash.current = hashMB;
  nThreads.current = threads;
  // set while rendering, not in an effect: the panels' effects run before this one and must not get the engine being replaced
  want.current = kind;
  broken.current = onBroken;
  React.useEffect(() => { if (ref.current) ref.current.then((eng) => eng.setHash(hashMB), () => {}); }, [hashMB]);
  React.useEffect(() => { if (ref.current) ref.current.then((eng) => { if (threaded.current) eng.setThreads(threads); }, () => {}); }, [threads]);
  const [status, setStatus] = React.useState('idle');
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
      setStatus('loading');
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
          const file = withThreads ? SF_FILE_THREADS : SF_FILE;
          if (!(await sfFilesPresent(file))) throw new Error('The Stockfish files are missing next to this page');
          make = sfMakeWorker(file);
        }
        threaded.current = withThreads;
        // a threaded engine that dies before it is ready is start()'s to handle (ready() rejects, and it falls back)
        let up = false;
        const onFail = () => {
          if (!up && withThreads) return;
          if (withThreads) sfThreadsFailed('The threaded engine stopped');
          if (ref.current === mine) { ref.current = null; setStatus('stopped'); }
        };
        const eng = window.SFEngine.create(make, { hashMB: hash.current, threads: withThreads ? nThreads.current : 1, onFail });
        await eng.ready();
        up = true;
        return eng;
      };
      const start = async () => {
        if (!sfThreading.on) return attempt(false);
        try { return await attempt(true); } catch (e) {
          if (!threaded.current) throw e;
          sfThreadsFailed('The threaded engine didn’t start');
          return attempt(false, k === 'full' && !(await window.SFFull.present('single')) ? 'lite' : k);
        }
      };
      mine = ref.current = start().then((eng) => { if (ref.current === mine) setStatus('ready'); return eng; }, (e) => { if (ref.current === mine) { setStatus('unavailable'); ref.current = null; } throw e; });
      mine.catch(() => {});
    }
    return ref.current;
  }, []);
  return { get, status };
}

// The full engine's download (the Analysis panel's engine drop-down and menu).
// state: 'checking', 'absent', 'downloading' (got: bytes so far) or 'ready'; err: why the last download or start failed
const SF_FULL_OFFERED = !!(window.SFFull && window.SFFull.supported());
const sfMB = (bytes) => Math.round(bytes / 1e6);
// build: the threaded one where the page allows threads; threads turned off later (the threaded engine wouldn't run)
// look for the single-thread copy, and without one the viewer is back on Lite
function useFullEngine() {
  const threading = useSfThreading(), build = threading.on ? 'threads' : 'single';
  const [st, setSt] = React.useState({ state: SF_FULL_OFFERED ? 'checking' : 'absent', got: 0, err: '' });
  const ctl = React.useRef(null), first = React.useRef(true);
  React.useEffect(() => {
    if (!SF_FULL_OFFERED) return;
    const again = !first.current;
    first.current = false;
    setSt((s) => (s.state === 'downloading' ? s : { ...s, state: 'checking' }));
    window.SFFull.present(build).then((ok) => setSt((s) => (s.state === 'checking' ? { ...s, state: ok ? 'ready' : 'absent', err: !ok && again ? 'The threaded engine didn’t run here, so Lite is running. Download Full again to use it.' : s.err } : s)));
  }, [build]);
  const download = async () => {
    if (ctl.current) return;
    const c = ctl.current = new AbortController();
    setSt({ state: 'downloading', got: 0, err: '' });
    try {
      // a render per megabyte, not per chunk
      await window.SFFull.download({ build, signal: c.signal, onProgress: (got) => setSt((s) => (sfMB(got) === sfMB(s.got) ? s : { ...s, got })) });
      setSt({ state: 'ready', got: 0, err: '' });
    } catch (e) {
      setSt({ state: 'absent', got: 0, err: c.signal.aborted ? '' : 'Download failed: ' + ((e && e.message) || e) });
    } finally { ctl.current = null; }
  };
  const cancel = () => { if (ctl.current) ctl.current.abort(); };
  const remove = async () => { cancel(); await window.SFFull.remove().catch(() => {}); setSt({ state: 'absent', got: 0, err: '' }); };
  const broken = React.useCallback(() => setSt({ state: 'absent', got: 0, err: 'The downloaded engine was missing, so Lite is running. Download it again to use Full.' }), []);
  return { offered: SF_FULL_OFFERED, ...st, build, total: window.SFFull ? window.SFFull.total(build) : 0, download, cancel, remove, broken };
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
const sfPartialKey = (ucis, settings, fen, tb) => JSON.stringify((sfStartFen(fen) ? [fen, settings, ucis] : [settings, ucis]).concat(tb ? ['tablebase'] : []));
function readSfPartial(ucis, settings, fen, tb) {
  try { const s = JSON.parse(localStorage.getItem(SF_PARTIAL_STORE) || 'null'); return s && s.key === sfPartialKey(ucis, settings, fen, tb) && Array.isArray(s.searched) ? s.searched : []; } catch (e) { return []; }
}
function writeSfPartial(ucis, settings, searched, fen, tb) {
  try { if (searched) localStorage.setItem(SF_PARTIAL_STORE, JSON.stringify({ key: sfPartialKey(ucis, settings, fen, tb), searched })); else localStorage.removeItem(SF_PARTIAL_STORE); } catch (e) {}
}
// A position the tablebase answers costs about this in a run: one request, AnalysisCore.TB_GAP_MS after the last
const SF_TB_SECONDS = window.AnalysisCore.TB_GAP_MS / 1000;
// which of a game's positions (0: the start, k: after k moves) are small enough for the tablebase
const sfTbPositions = (M) => [M.start.fen, ...M.plies.map((p) => p.fen)].map((f) => window.LichessCore.pieceCount(f) <= window.LichessCore.TB_MAX_PIECES);

// This device's pace against the model's (AnalysisCore.paceFactor), from the last run that timed enough positions, for
// each engine (name: the settings' engine name; the full engine searches fewer nodes a second)
const SF_PACE_STORE = 'chess-video.sf-pace.v1', SF_PACE_MIN_POSITIONS = 10;
// and thread count (one thread keeps the key it always had)
const sfPaceKey = (name, threads) => (name === window.AnalysisCore.ENGINE_NAMES.full ? SF_PACE_STORE + '.full' : SF_PACE_STORE) + (threads > 1 ? '.t' + threads : '');
function readSfPace(name, threads) { try { const f = +localStorage.getItem(sfPaceKey(name, threads)); return f > 0 ? f : 1; } catch (e) { return 1; } }
function writeSfPace(name, threads, f) { try { localStorage.setItem(sfPaceKey(name, threads), String(f)); } catch (e) {} }

// The full-game analysis. Loading other files (another game, the sample) abandons a run in progress; its searches
// so far are kept, and starting it again resumes from them.
// getFiles: the loaded files as they are now (notes or commentary may have changed during the run)
// settings: the engine settings for a game (AnalysisCore.engineSettings().game); a run keeps those it started with
// tbOn: Settings › Online data › Endgame tablebase: positions of 7 pieces or fewer ask it first (runAnalysis)
function useGameAnalysis(M, files, getFiles, commit, engine, settings, tbOn) {
  const A = window.AnalysisCore, tb = !!(tbOn && TB), setKey = JSON.stringify(settings) + (tb ? ' tablebase' : '');
  const [pace, setPace] = React.useState(() => readSfPace(settings.name, settings.threads));
  React.useEffect(() => { setPace(readSfPace(settings.name, settings.threads)); }, [settings.name, settings.threads]);
  const perPos = A.secondsPerPosition(settings, pace);
  const idle = { state: 'idle', done: 0, total: 0, etaSec: null, err: '' };
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
  // seconds for positions from..N: Stockfish's at perSec, the tablebase's at SF_TB_SECONDS
  const secondsFrom = (from, perSec) => { let t = 0; for (let k = from; k <= M.plies.length; k++) t += tbAt[k] ? SF_TB_SECONDS : perSec; return t; };
  React.useEffect(() => () => { if (run.current) { run.current.signal.aborted = true; run.current = null; } setSt(idle); }, [files.pgn, files.gameIndex || 0, !!files.sample, files.analysis]);
  const start = async () => {
    if (run.current) return;
    const me = { signal: { aborted: false } };
    run.current = me;
    const ucis = M.plies.map((p) => p.uci), sans = M.plies.map((p) => p.san), N = ucis.length;
    const S = settings, T = tb, earlier = readSfPartial(ucis, S, M.start.fen, T), d0 = Math.max(0, earlier.length - 1), prior = perPos;
    // the run's own pace: positions timed from when the engine is ready (its start-up isn't a position's cost)
    const timed = { n: 0, sec: 0, last: 0 };
    // { sec, at }: the latest estimate and when it was made; a timer counts it down in between
    me.eta = { sec: secondsFrom(earlier.length, prior), at: Date.now() };
    setSt({ state: 'running', done: d0, total: N, etaSec: Math.round(me.eta.sec), err: '' });
    try {
      const eng = await engine.get();
      timed.last = Date.now();
      const json = await window.AnalysisCore.runAnalysis({
        engine: eng, ucis, sans, headers: M.headers, signal: me.signal, earlier, settings: S, startFen: M.start.fen, tablebase: T ? TB : null, tablebaseOn: () => tbRef.current,
        onSearched: (R, { searches = 0, tbMs = 0 } = {}) => {
          writeSfPartial(ucis, S, R, M.start.fen, T);
          if (JSON.stringify(S) + (T ? ' tablebase' : '') === setKeyRef.current) setResumeAt(Math.max(0, R.length - 1));
          const now = Date.now();
          // the searches' time only: the tablebase's (its requests and the waits between them) says nothing of this device's pace
          if (searches) { timed.sec += Math.max(0, now - timed.last - tbMs) / 1000; timed.n += searches; }
          timed.last = now;
          me.eta = { sec: secondsFrom(R.length, A.blendPace(prior, timed.sec, timed.n)), at: now };
        },
        onProgress: (d, n) => { if (run.current === me && d > d0 && me.eta) setSt((s) => ({ ...s, done: d, total: n, etaSec: Math.round(me.eta.sec) })); },
      });
      if (run.current !== me) return;
      run.current = null;
      if (!json) { setSt(idle); return; }
      writeSfPartial(ucis, S, null, M.start.fen, T);
      setResumeAt(0);
      // with no depth limit every position takes its time limit, which says nothing about this device's pace
      if (S.depth != null && timed.n >= SF_PACE_MIN_POSITIONS) { const f = A.paceFactor(S, timed.sec / timed.n); writeSfPace(S.name, S.threads, f); setPace(f); }
      const name = (M.white.short + '_' + M.black.short).replace(/[^\w-]+/g, '_') + '_analysis.json';
      setSt(idle);
      commit({ ...getFiles(), analysis: json, analysisName: name, evalSource: null }); // shown, even over PGN evals
    } catch (e) {
      if (run.current !== me) return;
      run.current = null;
      setSt({ ...idle, err: engine.status === 'unavailable' ? '' : 'Analysis stopped: ' + ((e && e.message) || e) });
    }
  };
  // between positions the estimate counts down by the second
  React.useEffect(() => {
    if (st.state !== 'running') return;
    const id = setInterval(() => {
      const r = run.current;
      if (r && r.eta) setSt((s) => ({ ...s, etaSec: Math.max(1, Math.round(r.eta.sec - (Date.now() - r.eta.at) / 1000)) }));
    }, 1000);
    return () => clearInterval(id);
  }, [st.state]);
  const stop = () => { if (run.current) { run.current.signal.aborted = true; run.current = null; } setSt(idle); };
  return { ...st, start, stop, resumeAt, plies: M.plies.length, estimateMin: Math.max(1, Math.ceil(secondsFrom(resumeAt ? resumeAt + 1 : 0, perPos) / 60)) };
}

// A button inside a panel (theme colours, sized with the panel text)
function FrameButton({ primary, color, onClick, children, label, disabled }) {
  const c = color || C.best;
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }} onPointerDown={(e) => e.stopPropagation()}
      style={{ whiteSpace: 'nowrap', font: `600 ${tx(primary ? 20 : 15)}px ${MONO}`, letterSpacing: primary ? '0.02em' : '0.1em', textTransform: primary ? 'none' : 'uppercase', padding: primary ? `${tx(12)}px ${tx(22)}px` : `${tx(5)}px ${tx(12)}px`, borderRadius: 4, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, userSelect: 'none', WebkitUserSelect: 'none', border: `1.5px solid ${c}`, background: primary ? c : 'transparent', color: primary ? C.bg : c }}>
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
// compact: a row under a panel that already shows PGN variations (no heading text)
function EngineEmptyState({ M, sf, paused, compact }) {
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
  if (!paused) return text;
  if (sf.status === 'unavailable') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: tx(12) }}>
        {text}
        <span style={{ font: `500 ${tx(17)}px ${MONO}`, color: C.dim }}>Stockfish can't run here.</span>
        <div><FrameButton onClick={sf.start} label="Try starting Stockfish again">Try again</FrameButton></div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tx(14), alignItems: 'flex-start' }}>
      {text}
      <div style={{ display: 'flex', alignItems: 'center', gap: tx(14), flexWrap: 'wrap' }}>
        <FrameButton primary onClick={sf.start}>{(run.resumeAt ? `${narrow ? 'Resume' : 'Resume analysis'} from move ${Math.floor((M.ply0 + run.resumeAt) / 2) + 1}` : 'Analyse with Stockfish') + (narrow ? '' : ` · ${est}`)}</FrameButton>
        {narrow && <span style={{ ...NO_SELECT, font: `500 ${tx(15)}px ${MONO}`, color: C.dim, whiteSpace: 'nowrap' }}>{est}</span>}
      </div>
      {run.resumeAt > 0 && <span style={{ ...NO_SELECT, font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{run.resumeAt} of {run.plies} moves analysed so far.</span>}
      {!compact && <span style={{ ...NO_SELECT, font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{engineLabel(sf.game.name)} runs in your browser.</span>}
      {run.err && <span style={{ font: `500 ${tx(15)}px ${MONO}`, color: C.blunder }}>{run.err}</span>}
    </div>
  );
}

// ---------- the viewer's own moves ----------
const SF_EVAL_CACHE = new Map(); // finished searches by settings and move list, for the session
const SF_DEEPER = new Map(); // presses of Go deeper by position (its key at the base settings), for the session
const CLOUD = window.LichessCore ? window.LichessCore.create() : null; // Lichess's cloud evaluation, cached for the session
const CLOUD_DEBOUNCE_MS = 300; // after the last position change (stepping through moves asks nothing for the ones passed)

// Evaluates the positions before and after the viewer's move (move lists from the start, or from fen); the score streams in.
// own: the search settings (AnalysisCore.engineSettings().own; its lines are searched for after only); fen: the game's start FEN, omitted for the standard start.
// deeper(): searches both positions again, deeper (null when the search can't go further or hasn't finished); it counts
// for that position only, and a deeper search shows the last result until it passes that result's depth.
// progress: 0–1 through the searches still to run while pending (each one's depth or time limit, whichever it nears first)
// stored: a loaded analysis's result for after (with before the same moves), standing in for the first search, which
// then never runs: only a press of Go deeper searches. Results from it carry stored: true; its src names the evals it
// comes from, so presses on one analysis's move don't carry over to another's (or the PGN's) once it is removed
// cloud: Settings › Online › Lichess cloud evaluation ({ on, prefer }); with stored, only once Go deeper is pressed
// (the analysis's own eval stands until then, and its ratings are never touched): each position asks the cloud (after CLOUD_DEBOUNCE_MS, at once when cached) while the local search runs; whichever comes first
// shows, and a finished local search replaces the cloud's only when deeper. prefer: a position the cloud has as deep
// as the local depth limit (No limit: the slider's top stop) isn't searched locally. A miss falls back silently
const cloudSetting = (tw) => ({ on: !!(tw && tw.cloudEval), prefer: !!(tw && tw.cloudPrefer) });
function useMoveEval(engine, before, after, own, fen, stored, cloud) {
  const A = window.AnalysisCore;
  // a search of several lines (Analysis › ☰ › Lines) is cached apart from one of one line
  const keyOf = (s, moves) => (own.name ? own.name + '|' : '') + (sfStartFen(fen) ? fen + '|' : '') + `${s.depth}/${s.movetimeMs}${s.lines > 1 ? '/' + s.lines : ''}:` + moves.join(' ');
  const toSearch = (o, lines = own.lines || 1) => ({ depth: o.depth, movetimeMs: o.time_limit * 1000, lines });
  const baseKey = after ? keyOf(toSearch(own), after) + (stored ? '|' + stored.src : '') : '';
  const [, bump] = React.useState(0);
  const level = SF_DEEPER.get(baseKey) || 0;
  const search = toSearch(A.deeperSearch(own, level));
  const sfKey = (moves) => keyOf(search, moves);
  const cloudOn = !!(cloud && cloud.on && CLOUD && after && (!stored || level > 0)), prefer = cloudOn && !!cloud.prefer;
  const key = after ? sfKey(after) + (cloudOn ? (prefer ? '|cloud+' : '|cloud') : '') : '';
  const empty = { key: '', before: null, after: null, cloud: {}, pending: false, progress: 0 };
  const [st, setSt] = React.useState(empty);
  React.useEffect(() => {
    if (!after) { setSt(empty); return; }
    let live = true;
    // only after's lines are shown, so before (what the move is rated against) searches one line, as deep as it can;
    // the start position is both, and searches after's lines
    const lines = (which) => (which === 'after' || before.join(' ') === after.join(' ') ? own.lines || 1 : 1);
    const moves = { after, before };
    // the cloud's answers, as promises (null: a miss); a cached one shows at once
    const ctl = new AbortController(), timers = [], asked = {};
    const fenOf = (m) => { const f = window.AnalysisCore.positionFens(fen || window.ChessCore.START_FEN, m); return f.length === m.length + 1 ? f[m.length] : null; };
    const cloudHit = {};
    if (cloudOn) for (const which of ['after', 'before']) {
      const f = fenOf(moves[which]), n = lines(which), hit = f ? CLOUD.cloudCached(f, n) : null;
      if (hit !== undefined) { cloudHit[which] = hit; asked[which] = Promise.resolve(hit); continue; }
      asked[which] = new Promise((res) => { timers.push(setTimeout(() => CLOUD.cloudEval(f, n, { signal: ctl.signal }).then(res), CLOUD_DEBOUNCE_MS)); })
        .then((r) => { if (live && r) setSt((s) => ({ ...s, cloud: { ...s.cloud, [which]: r } })); return r; });
    }
    const cloudLimit = search.depth == null ? A.SEARCH_LIMITS.depth[1] : search.depth;
    const keyAt = (lv, which) => keyOf(toSearch(A.deeperSearch(own, lv), lines(which)), moves[which]);
    const at = (lv, which) => (lv === 0 && stored ? stored : SF_EVAL_CACHE.get(keyAt(lv, which)) || null);
    const handles = [], cached = (which) => at(level, which);
    // the result a press of Go deeper started from, shown until the deeper search passes its depth
    const prev = (which) => (level > 0 ? at(level - 1, which) : null);
    const shown = (which) => cached(which) || (prev(which) && { ...prev(which), partial: true, held: true });
    setSt({ key, before: shown('before'), after: shown('after'), cloud: { before: cloudHit.before || null, after: cloudHit.after || null }, pending: !cached('after') || !cached('before'), progress: 0 });
    // the searches to run (the start position's two are one)
    const todo = [...new Set(['after', 'before'].filter((w) => !cached(w)).map((w) => keyAt(level, w)))].length;
    let ran = 0;
    (async () => {
      let eng;
      try { eng = await engine.get(); } catch (e) { if (live) setSt((s) => ({ ...s, pending: false })); return; }
      for (const which of ['after', 'before']) {
        if (!live) return;
        // the start position is both before and after: its second search is the first one's, cached
        if (cached(which)) { const c = cached(which); setSt((s) => ({ ...s, [which]: c })); continue; }
        if (prefer) {
          const c = await asked[which];
          if (!live) return;
          if (c && c.depth >= cloudLimit) { ran++; continue; }
        }
        const floor = prev(which) ? prev(which).depth : 0;
        // a depth takes about 1.5 times the one before it, so depth d of D is about 1.5^(d − D) of the way
        const part = (sc) => Math.max(sc.timeMs ? sc.timeMs / search.movetimeMs : 0, search.depth ? Math.pow(1.5, sc.depth - search.depth) : 0);
        const i = ran++;
        const h = eng.search({ moves: moves[which], fen, ...search, lines: lines(which), priority: 'own', onInfo: (sc) => {
          if (!live) return;
          const progress = (i + Math.min(1, part(sc))) / todo;
          setSt((s) => ({ ...s, progress: Math.max(s.progress, progress), ...(sc.depth > floor && { [which]: { ...sc, best: sc.pv[0] || null, partial: true } }) }));
        } });
        handles.push(h);
        const r = await h.promise;
        if (!live) return;
        if (r && r.cp != null) { const fin = { ...r, best: A.bestOf(r) }; SF_EVAL_CACHE.set(keyAt(level, which), fin); setSt((s) => ({ ...s, [which]: fin })); }
      }
      if (live) setSt((s) => ({ ...s, pending: false }));
    })();
    return () => { live = false; handles.forEach((h) => h.cancel()); timers.forEach(clearTimeout); ctl.abort(); };
  }, [key]);
  const raw = st.key === key ? st : { ...empty, pending: !!after };
  // the cloud's answer stands until a finished local search goes deeper; it replaces the result a Go deeper started
  // from (the stored analysis's among them) only when deeper
  const pick = (loc, cl) => (cl && (!loc || cl.depth >= loc.depth || (loc.partial && !loc.held)) ? cl : loc);
  const out = { ...raw, before: pick(raw.before, raw.cloud.before), after: pick(raw.after, raw.cloud.after) };
  const fromCloud = (r) => !!(r && r.source === 'cloud');
  const done = out.after && !out.after.partial && out.before && !out.before.partial && !out.pending;
  const next = A.deeperSearch(own, level + 1);
  // nothing to go deeper on where both positions show the cloud's answer
  const deeper = done && !(fromCloud(out.after) && fromCloud(out.before)) && A.canGoDeeper(own, level) ? () => { SF_DEEPER.set(baseKey, level + 1); bump((n) => n + 1); } : null;
  return { ...out, deeper, deeperTo: deeper ? next : null };
}

// Go deeper: the small + after the search's stats in the Analysis heading, once an eval has finished; sized in em to
// the heading, its negative margins keep the heading's height whether or not it shows, so the panel doesn't jump
function DeeperButton({ ev }) {
  if (!ev || !ev.deeper) return null;
  const t = ev.deeperTo, tip = t.depth == null ? `Go deeper: ${t.time_limit} s` : `Go deeper: depth ${t.depth}, up to ${t.time_limit} s`;
  return (
    <button type="button" aria-label={tip} title={tip} onClick={(e) => { e.stopPropagation(); ev.deeper(); }} onPointerDown={(e) => e.stopPropagation()}
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
function EngineLines({ lines, pos, ply0, c, onPick, cloud }) {
  const top = lines[0].depth;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tx(6) }}>
      {lines.map((l) => {
        const st = engineSteps(pos, l.pv, 6), ev = fmtSf(l.cp);
        return (
          <div key={l.k} style={{ display: 'flex', alignItems: 'flex-start', gap: tx(6) }}>
            <span style={{ flex: '0 0 auto', width: tx(100), whiteSpace: 'nowrap', lineHeight: `${tx(30)}px`, color: l.k === 1 ? C.ink : C.dim }}>{ev}{l.depth < top && <span style={{ font: `500 ${tx(13)}px ${MONO}`, color: C.dim }}> d{l.depth}</span>}</span>
            <div style={{ flex: '1 1 0', minWidth: 0 }}>
              <LineChips name={null} tip={`${cloud ? 'Lichess cloud' : 'Stockfish'}'s line ${l.k} (${ev})`} accent={l.k === 1 ? C.best : C.line}
                moves={st.map((m) => m.san)} ply0={ply0} c={c} legal={st.length} sel={null} onPick={(j) => onPick(st.slice(0, j + 1))} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Arrows for the lines' first moves (Lines above one): line 1 as the best-move arrow, the others thinner and fainter
const lineArrows = (r) => (r && r.lines && r.lines.length > 1 ? r.lines.filter((l) => l.pv[0]).map((l) => ({ uci: l.pv[0], k: l.k })) : null);

const fmtSf = (cp) => {
  if (cp == null) return '…';
  if (Math.abs(cp) >= 9000) { const n = Math.round((10000 - Math.abs(cp)) / 10); return n === 0 ? (cp > 0 ? '1-0' : '0-1') : (cp > 0 ? 'M' : '−M') + n; }
  return (cp > 0 ? '+' : cp < 0 ? '−' : '') + Math.abs(cp / 100).toFixed(2);
};

// The Analysis panel while the viewer plays their own line: their move, its eval, what it costs, Stockfish's reply
function OwnMoveAnalysis({ M, vline, own, status, onReply }) {
  const step = vline.moves[vline.upto], ply = vline.at + vline.upto, isWhite = (M.ply0 + ply) % 2 === 0;
  const { before, after } = own;
  const done = before && after && !before.partial && !after.partial;
  const rated = done ? window.AnalysisCore.rateMove({ bestEval: before.cp, currentEval: after.cp, isWhite, playedIsBest: step.uci === before.best, isCheckmate: step.san.endsWith('#') }) : null;
  const bad = rated && ['inaccuracy', 'mistake', 'blunder'].includes(rated.classification);
  const col = bad ? clsColor(rated.classification) : lineAccent('you');
  const who = step.byEngine ? 'STOCKFISH’S REPLY' : 'YOUR MOVE';
  const verdict = !rated ? (status === 'unavailable' ? 'Stockfish can’t run here' : status === 'stopped' ? 'Stockfish stopped · play a move to restart it' : 'Stockfish is thinking…')
    : step.uci === before.best ? 'Stockfish’s choice'
    : rated.evalLoss > 0 ? `−${Math.round(rated.evalLoss)} cp vs ${own.bestSan || before.best}` : `as good as ${own.bestSan || before.best}`;
  const replies = engineSteps(step.pos, after && after.pv);
  const many = after && after.lines && after.lines.length > 1;
  return (
    <React.Fragment>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: tx(28) }}>
        <span style={{ font: `700 ${tx(HEADLINE)}px ${MONO}`, color: col }}>{lineLabel(M, vline.at, vline.upto, step.san)}</span>
        <span style={{ marginLeft: 'auto', font: `700 ${tx(HEADLINE)}px ${MONO}`, color: C.ink }}>{(status === 'unavailable' || status === 'stopped') && !(after && !after.partial) ? '—' : fmtSf(after && after.cp)}</span>
      </div>
      {/* the verdict spans the panel, under the move and the eval, so it fits on one line in the phone layout */}
      <div style={{ marginTop: tx(6), font: `600 ${tx(16)}px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: col }}>{who} · {bad ? CLASS_LABEL[rated.classification] + ' · ' : ''}{verdict}</div>
      <div style={{ marginTop: tx(16), paddingTop: tx(14), borderTop: `1px solid ${C.line}`, font: `500 ${tx(18)}px ${MONO}`, color: C.dim, display: 'flex', flexDirection: 'column', gap: tx(8) }}>
        {many ? <EngineLines lines={after.lines} pos={step.pos} ply0={M.ply0} c={ply + 1} onPick={onReply} cloud={after.source === 'cloud'} />
          : replies.length > 0
          ? <LineChips name={null} tip={after.source === 'cloud' ? 'Lichess cloud’s reply' : 'Stockfish’s reply'} accent={C.best} moves={replies.map((r) => r.san)} ply0={M.ply0} c={ply + 1} legal={replies.length} sel={null} onPick={(j) => onReply(replies.slice(0, j + 1))} />
          : <span>{step.san.endsWith('#') ? 'Checkmate.' : ' '}</span>}
      </div>
    </React.Fragment>
  );
}
