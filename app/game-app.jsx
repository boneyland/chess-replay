// ---------- loader ----------
// Replaces the Claude Design host hooks: files load and save in the browser, and settings open from a page button.
const STORE = 'chess-video.files.v1';
const SAMPLE = { pgn: window.SAMPLE_PGN, analysis: window.SAMPLE_ANALYSIS, sampleNotes: window.SAMPLE_NOTES, sample: true };
// a free board is stored as { board: BoardCore.save(…), lastGame } (see commit) in the loaded game's place; one that no longer restores gives the sample.
// A stored game that no longer reads (one kept before the reader got stricter) is dropped, and storedNote says so once,
// rather than the error showing on every visit; a free board's lastGame that no longer reads is let go the same way
let storedNote = '';
const readsAsGame = (files) => { try { window.ChessCore.buildGame(files); return ''; } catch (e) { return e.message || String(e); } };
function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && s.board) {
      if (!window.BoardCore.restore(s.board)) return SAMPLE;
      const last = s.lastGame && s.lastGame.files && !readsAsGame(s.lastGame.files) ? s.lastGame : undefined;
      if (s.lastGame && !last) try { localStorage.setItem(STORE, JSON.stringify({ ...s, lastGame: last })); } catch (e) {}
      return { board: s.board, lastGame: last };
    }
    if (s && (s.pgn || s.analysis)) {
      const why = readsAsGame(s);
      if (!why) return s;
      try { localStorage.removeItem(STORE); } catch (e) {}
      storedNote = `The game kept from your last visit can’t be read any more (${why}), so the sample game is shown.`;
    }
  } catch (e) {}
  return SAMPLE;
}
const PLAYBACK = '{"mode":"loop"}';
// a picked or dropped file is read whole into the page, so a huge one (a dropped video, a PGN database) is refused first
const MAX_FILE_BYTES = 50e6;
// Files dragged over the window (the PGN overlay; Position from image's drop zone): over(e) on each dragover, off() once the
// files leave the window, are dropped or the drag ends, drop(e) on a drop. No timer: Firefox fires dragover only while the
// pointer moves, so a file held still would time out. Leaving is counted (dragenter up, dragleave down: the next element's
// enter comes before the last one's leave); a mouse move with no dragover just before it means a drag that ended unseen.
// skip(): another listener takes the drag. Returns the cleanup
function watchFileDrag({ over, off, drop, skip = () => false }) {
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  let n = 0, on = false, last = 0;
  const stop = () => { n = 0; if (on) { on = false; off(); } };
  const L = {
    dragenter: (e) => { if (!hasFiles(e) || skip()) return; e.preventDefault(); n++; },
    dragover: (e) => { if (!hasFiles(e) || skip()) return; e.preventDefault(); n = Math.max(n, 1); on = true; last = Date.now(); over(e); },
    dragleave: (e) => { if (!hasFiles(e) || skip()) return; n = Math.max(0, n - 1); if (!n) stop(); },
    drop: (e) => { if (!hasFiles(e) || skip()) return; e.preventDefault(); stop(); drop(e); },
    dragend: stop,
    mousemove: () => { if (on && Date.now() - last > 300) stop(); },
  };
  for (const k in L) window.addEventListener(k, L[k]);
  return () => { for (const k in L) window.removeEventListener(k, L[k]); };
}
// a drop's files (some browsers fill only items)
const droppedFiles = (e) => {
  const list = Array.from(e.dataTransfer.files || []);
  return list.length ? list : Array.from(e.dataTransfer.items || []).filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
};
// My games (GamesCore), read afresh for each change, so games kept by another tab stay
const GAMES = 'chess-video.games.v1';
const readGames = () => { try { return window.GamesCore.read(localStorage.getItem(GAMES)); } catch (e) { return []; } };
// a stored list that can't be read is set aside here, once, before the next write replaces it
const GAMES_UNREADABLE = 'chess-video.games.v1.unreadable';

// The loaded game or board, as stored (STORE): files, the game they build (M; while a board shows, the last good game,
// the sample on a fresh page, for the hooks that want one), the board restored from them, and the commits that store a
// change and keep games in My games. stored: readStored()'s files to start from. setErr says what couldn't be stored; onCommit(keep) runs on each commit; clockRef
// is the stage's { time }, the playhead a loaded game left for a board is kept at
function useStoredFiles({ stored, setErr, onCommit, clockRef }) {
  const [files, setFiles] = React.useState(stored);
  const filesRef = React.useRef(files);
  filesRef.current = files;
  const lastGood = React.useRef(null);
  const built = React.useMemo(() => {
    if (files.board) return { M: lastGood.current || window.ChessCore.buildGame(SAMPLE) };
    try { return { M: window.ChessCore.buildGame(files) }; } catch (e) { return { error: e.message }; }
  }, [files]);
  // the board's state, restored from its stored form (on a reload, a game's running clock charged for the time away); a
  // board this page just committed is used as it is
  const boardSaved = React.useRef(null);
  const board = React.useMemo(() => (!files.board ? null : boardSaved.current && boardSaved.current.saved === files.board ? boardSaved.current.board : window.BoardCore.restore(files.board, Date.now())), [files.board]);
  if (built.M) lastGood.current = built.M;
  const M = built.M || lastGood.current || window.ChessCore.buildGame(SAMPLE);
  // false when it couldn't be remembered (the error says so)
  // keep: the editor stays open (an analysis finishing in the background isn't the viewer leaving it)
  // The loaded game left for a board is kept in the board's place (lastGame: { files, at }, at its playhead) for Back to the
  // loaded game; the board's own commits carry it, loading or replacing a game drops it
  const commit = (next, keep) => {
    if (!next.board) try { window.ChessCore.buildGame(next); } catch (e) { setErr(e.message); return false; }
    const cur = filesRef.current;
    let withLast = next;
    if (next.board && !next.lastGame && !keep) {
      const { lastGame, fromBoard, fromLastGame, ...game } = cur;
      const last = cur.board ? lastGame : 'fromLastGame' in cur ? fromLastGame : cur.sample ? null : { files: game, at: clockRef.current ? clockRef.current.time : 0 };
      if (last) withLast = { ...next, lastGame: last };
    }
    setErr(''); setFiles(withLast); onCommit(keep);
    try {
      // the sample as it comes needs no storing; once its analysis is replaced (a run, Remove analysis) the change is kept
      if (next.sample && !next.evalSource && next.analysis === SAMPLE.analysis) localStorage.removeItem(STORE);
      else try { localStorage.setItem(STORE, JSON.stringify(withLast)); } catch (e) { if (withLast === next) throw e; setFiles(next); localStorage.setItem(STORE, JSON.stringify(next)); }
    } catch (e) { setErr(next.board ? 'The board couldn’t be remembered after reload: the browser’s storage is full.' : 'Loaded, but the files are too large to remember after reload.'); return false; }
    return true;
  };
  // a game is kept in My games as it goes; a full storage doesn't stop the board. The new list, or null when it couldn't
  // be stored (with `fail` shown, unless null)
  const updateGames = (fn, fail) => {
    try {
      const raw = localStorage.getItem(GAMES);
      if (!window.GamesCore.readable(raw) && localStorage.getItem(GAMES_UNREADABLE) == null) localStorage.setItem(GAMES_UNREADABLE, raw);
    } catch (e) { if (fail) setErr(fail); return null; }
    const next = fn(readGames());
    try { localStorage.setItem(GAMES, JSON.stringify(next)); return next; } catch (e) { if (fail) setErr(fail); return null; }
  };
  // only a game that changed (a move, a takeback, its clocks or result) is kept again: stepping through it isn't, so a
  // finished game deleted while on the board stays deleted. A board that couldn't be stored has said so already
  const commitBoard = (b) => {
    const saved = window.BoardCore.save(b), prev = board;
    boardSaved.current = { saved, board: b };
    const ok = commit({ board: saved });
    if (b.game && !(prev && prev.game === b.game && prev.steps === b.steps)) updateGames((list) => window.GamesCore.keep(list, b, Date.now()), ok ? 'This game couldn’t be kept in My games: the browser’s storage is full.' : null);
  };
  // a game left (for another board, a loaded game, or by closing the page) is kept with its clock charged up to then, so
  // Resume goes on from there; the stored board keeps its running clock, which a reload charges for the time away
  const keepLeft = (b) => { if (b && window.PlayCore.inProgress(b) && window.PlayCore.begun(b)) updateGames((list) => window.GamesCore.keep(list, window.PlayCore.pause(b, Date.now()), Date.now()), null); };
  const boardRef = React.useRef(board);
  boardRef.current = board;
  React.useEffect(() => {
    const hide = () => keepLeft(boardRef.current);
    window.addEventListener('pagehide', hide);
    return () => window.removeEventListener('pagehide', hide);
  }, []);
  return { files, filesRef, built, board, boardRef, M, commit, commitBoard, updateGames, keepLeft };
}

// Full screen hides the browser's bars, and the phone layouts grow into the space. The item shows only where the browser
// says it works: older iPhone Safari had no element full screen (only <video>), iOS 26.5's has it (seen in the Simulator).
// An installed copy opened full screen (the manifest) has no bars to hide
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const FS_OK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !(() => { try { return window.matchMedia('(display-mode: fullscreen)').matches; } catch (e) { return false; } })();
function useFullscreen() {
  const [on, setOn] = React.useState(() => !!fsElement());
  React.useEffect(() => {
    const sync = () => setOn(!!fsElement());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => { document.removeEventListener('fullscreenchange', sync); document.removeEventListener('webkitfullscreenchange', sync); };
  }, []);
  // called from the tap itself: browsers refuse full screen outside a user gesture (iPad Safari's prefixed call returns no promise)
  const toggle = () => {
    const el = document.documentElement;
    try {
      const r = fsElement() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document) : (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      if (r && r.catch) r.catch(() => {});
    } catch (e) {}
  };
  return { ok: FS_OK, on, toggle };
}

// Whether the browser has a connection (navigator.onLine: false means none; true can still be a network that gets
// nowhere). A change shows a note for a few seconds, and a tag above the frame says Offline for as long as it lasts.
// the Settings button's icon: an eight-toothed cog with a hole (16 × 16)
// the Share and export button's icon: an arrow up out of an open box (16 × 16, stroked)
const SHARE = 'M8 10V1.8M5 4.6L8 1.6L11 4.6M5.6 7H3v7.4h10V7h-2.6';
// a copy icon: one sheet over another (16 × 16, stroked); TICK once copied
const COPY = 'M6 5.5h7v8.5H6Z M10 3V2H3v8.5h1', TICK = 'M3 8.5l3.2 3.2L13 4.8';
const GEAR = 'M13.33 6.27L15.24 6.46L15.24 9.54L13.33 9.73L12.99 10.54L14.21 12.03L12.03 14.21L10.54 12.99L9.73 13.33L9.54 15.24L6.46 15.24L6.27 13.33L5.46 12.99L3.97 14.21L1.79 12.03L3.01 10.54L2.67 9.73L0.76 9.54L0.76 6.46L2.67 6.27L3.01 5.46L1.79 3.97L3.97 1.79L5.46 3.01L6.27 2.67L6.46 0.76L9.54 0.76L9.73 2.67L10.54 3.01L12.03 1.79L14.21 3.97L12.99 5.46Z M10.4 8a2.4 2.4 0 1 0 -4.8 0a2.4 2.4 0 1 0 4.8 0Z';
const OFFLINE_NOTE = 'You’re offline. Replays, Stockfish and exports keep working; Ask Queen needs a connection.';
function useOnline() {
  const [online, setOnline] = React.useState(() => navigator.onLine !== false);
  const [note, setNote] = React.useState(() => (navigator.onLine === false ? OFFLINE_NOTE : null));
  React.useEffect(() => {
    const sync = () => { const on = navigator.onLine !== false; setOnline(on); setNote(on ? 'Back online.' : OFFLINE_NOTE); };
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);
  // a page loaded offline doesn't always hear the connection come back (Firefox), so it looks too
  React.useEffect(() => {
    if (online) return;
    const id = setInterval(() => { if (navigator.onLine !== false) { setOnline(true); setNote('Back online.'); } }, 2000);
    return () => clearInterval(id);
  }, [online]);
  React.useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), note === OFFLINE_NOTE ? 8000 : 3000);
    return () => clearTimeout(id);
  }, [note]);
  return { online, note, clearNote: () => setNote(null) };
}

// Auto follows the system setting; Light/Dark override it
function useScheme(pref) {
  const read = () => {
    if (pref === 'Light') return 'light';
    if (pref === 'Dark') return 'dark';
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'dark'; }
  };
  const [mode, setMode] = React.useState(read);
  React.useEffect(() => {
    const el = document.documentElement;
    const update = () => {
      const m = read();
      setMode(m);
      if (pref === 'Light' || pref === 'Dark') el.setAttribute('data-scheme', m); else el.removeAttribute('data-scheme');
    };
    update();
    let mq = null;
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', update); } catch (e) {}
    return () => { try { if (mq) mq.removeEventListener('change', update); } catch (e) {} };
  }, [pref]);
  return mode;
}

function GameApp() {
  // the game analysis's Threads and Hash table were the live searches' until it had its own (2026-11-08): a viewer
  // who stored those keeps them for the game analysis too (and a stopped run, keyed by them, still resumes), once
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS, (s) => ('sfGameThreads' in s || 'sfGameHash' in s ? null
    : { ...('sfThreads' in s && { sfGameThreads: s.sfThreads }), ...('sfHash' in s && { sfGameHash: s.sfHash }) }));
  const scheme = useScheme(t.scheme || 'Auto');
  setPalette(scheme);
  // the stored files are read first: reading them says (storedNote) when a kept game was dropped
  const [stored] = React.useState(readStored);
  const [err, setErr] = React.useState(() => storedNote);
  const [drag, setDrag] = React.useState(false);
  const [panel, setPanel] = React.useState(false);
  const [panelTab, setPanelTab] = React.useState('game'); // Settings' open tab, kept while the page is open
  const inputRef = React.useRef(null);
  const probe = React.useRef(null);
  const nav = React.useRef(null);
  const clockRef = React.useRef(null); // the stage's { time }, for the playhead a game is left at
  const { files, filesRef, built, board, boardRef, M, commit, commitBoard, updateGames, keepLeft } = useStoredFiles({ stored, setErr, clockRef, onCommit: (keep) => { if (!keep) setEditing(null); } });
  const seekAfter = React.useRef(null); // the playhead a game just brought back opens at
  const fullscreen = useFullscreen();
  const net = useOnline();
  const [queenOpen, setQueenOpen] = React.useState(false);
  const [queenArrow, setQueenArrow] = React.useState(null);
  // the phone layouts (portrait, or a narrow one held sideways) fold the dock's buttons into a menu in the transport bar; it closes on a pick, an outside tap or Esc,
  // and opening it closes Settings or Queen, which would otherwise cover it
  // short: a phone held sideways, whose transport bar sits in the sidebar; its sound toggle moves into the menu
  const [phone, setPhone] = React.useState(false), [frameW, setFrameW] = React.useState(1920), [short, setShort] = React.useState(false);
  const onLayout = React.useCallback((isPhone, w, isShort) => { setPhone(isPhone); setFrameW(w); setShort(!!isShort); }, []);
  const [menu, setMenu] = React.useState(false);
  React.useEffect(() => { if (!phone) setMenu(false); }, [phone]);
  // the dock's Menu (landscape); on a phone its items sit in the folded menu instead
  const [newMenu, setNewMenu] = React.useState(false);
  // Import game's dialog while it is open: { text, auto }, the paste box's text to open with (kept when it comes back from
  // Edit position or Position from image), auto to fetch it at once (a Lichess link the explorer opens)
  const [importOpen, setImportOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  // Edit position: { setup, text, msg, resume, play, image } while the editor shows in place of the board or the loaded
  // game; text is the FEN field's, msg why it doesn't parse, resume the paused game in progress left to open it (Cancel
  // goes back to it), image the picture it was read from ({ url, unsure, bitmap, box }, or null)
  const [editing, setEditing] = React.useState(null);
  // Position from image's dialog while it is open: { play, again, back }, play the Play dialog's choices it came from (or null),
  // again the picture, box, greyscale copy and found squares for Back to crop (or null), back true when Import game opened it
  const [vision, setVision] = React.useState(null);
  const focusBack = React.useRef(null); // see the focus's return when a dialog closes
  const [fenNote, setFenNote] = React.useState(null); // { fen, ok } after Copy FEN; a copy that failed stays up to select

  // the Play dialog's mode while it is open: 'human' or 'stockfish'
  const [playOpen, setPlayOpen] = React.useState(null);
  // My games' list while its dialog is open
  const [gamesOpen, setGamesOpen] = React.useState(null);
  // the Keyboard shortcuts dialog
  const [keysOpen, setKeysOpen] = React.useState(false);
  const [analyseOpen, setAnalyseOpen] = React.useState(false); // the Analyse the game dialog (GameAnalysisDialog)
  React.useEffect(() => { if (board) setAnalyseOpen(false); }, [!!board]); // a loaded game's only
  const [shareOpen, setShareOpen] = React.useState(null); // the Share and export dialog: { fen } of the position it opened on
  // leaving a game in progress asks first: { run } is what waits on the answer
  const [leave, setLeave] = React.useState(null);
  const newRef = React.useRef(null);
  useDismiss(newMenu, newRef, () => setNewMenu(false));
  React.useEffect(() => { if (phone) setNewMenu(false); }, [phone]);
  const dockRef = React.useRef(null);
  useDismiss(menu, dockRef, () => setMenu(false));
  // F turns the board round (not in a game, whose board turns by itself)
  useKeydown((e) => {
    if (e.repeat || (e.key || '').toLowerCase() !== 'f' || hasModifier(e) || X.video.busy || (board && board.game)) return;
    setTweak('flip', !t.flip);
  });
  // a game with moves and no result yet is thrown away only after asking (one with every move taken back is kept in My
  // games already, PlayCore.begun)
  const playing = !!(board && window.PlayCore.inProgress(board) && window.PlayCore.played(board));
  // (a game left to open the editor was kept then, and isn't asked about again)
  const guard = (run) => { if (playing && !editing) setLeave({ run }); else run(); };
  const guardRef = React.useRef(guard);
  guardRef.current = guard;
  const hf = useHfAuth();
  const Q = useQueen(M, hf);
  // the engine drop-down: Full runs once its download is kept; until then Lite does
  const full = useFullEngine();
  const sfKind = !SF_SIMD ? 'asm' : t.sfEngine === 'Full' && full.state === 'ready' ? 'full' : 'lite';
  // threads where the page allows them, lite or full
  const threading = useSfThreading();
  // a hash table this device couldn't give memory for: for the rest of this visit sizes from the one that failed up aren't
  // offered (a stored size among them gets the default, what the engine now runs with), and a note says why. The saved
  // setting is left alone: the memory may be there next time
  const [hashCap, setHashCap] = React.useState(Infinity), [hashNote, setHashNote] = React.useState('');
  const hashChoices = React.useMemo(() => SF_HASH_CHOICES.filter((mb) => mb < hashCap), [hashCap]);
  const ES = React.useMemo(() => window.AnalysisCore.engineSettings(t, sfKind, threading, hashChoices), [t.sfDepth, t.sfTime, t.sfOwnDepth, t.sfOwnTime, t.sfHash, t.sfLines, t.sfGameLines, t.sfThreads, t.sfGameHash, t.sfGameThreads, sfKind, threading, hashChoices]);
  const hashAsked = React.useRef(ES.game.hash_mb);
  hashAsked.current = Math.max(ES.game.hash_mb, ES.own.hash_mb);
  const onHashFail = React.useCallback((mb, to) => { setHashCap((c) => Math.min(c, mb, hashAsked.current)); setHashNote(`This device couldn’t give Stockfish ${mb} MB for its hash table, so it uses ${to} MB for this visit.`); }, []);
  const engine = useEngine(ES.own.hash_mb, ES.own.threads, sfKind, full.broken, onHashFail);
  const queenInVideo = t.queenInVideo !== false;
  const showCommentary = t.commentary !== false;
  const sayFrom = { pgn: t.commentPgn !== false, notes: t.commentNotes !== false, queen: t.commentQueen !== false };
  const sources = React.useMemo(() => window.ChessCore.commentarySources(M), [M]);
  // commentary off (or a source off): no comments, intro or conclusion from it, so the video's timing drops their reading time too
  const MV = React.useMemo(() => {
    const G = queenInVideo ? withQueen(M, Q.resultAt) : M;
    const hidden = !showCommentary ? sources.length > 0 : sources.some((k) => !sayFrom[k]);
    const C = !showCommentary ? { ...G, intro: '', conclusion: '', plies: G.plies.map((p) => ({ ...p, comment: '' })) } : window.ChessCore.withCommentary(G, sayFrom);
    const D = showCommentary && sayFrom.queen ? C : { ...C, plies: C.plies.map((p) => (p.queenText ? { ...p, queenText: '' } : p)) };
    return hidden ? { ...D, commentaryHidden: true } : D;
  }, [M, Q.cache, queenInVideo, showCommentary, sources, sayFrom.pgn, sayFrom.notes, sayFrom.queen]);
  // the replay's key: a new number for each game loaded (another PGN or game in it), not for an analysis, notes or a
  // setting added to the same game, which keep the playhead on its move
  const gameSeq = React.useRef({ pgn: undefined, i: undefined, n: 0 });
  if (gameSeq.current.pgn !== files.pgn || gameSeq.current.i !== files.gameIndex) gameSeq.current = { pgn: files.pgn, i: files.gameIndex, n: gameSeq.current.n + 1 };
  const gameKey = gameSeq.current.n;
  const queenSays = queenInVideo &&M.plies.some((p, i) => { const r = Q.resultAt(i + 1); return r && r.evalText; });
  const TM = React.useMemo(() => window.ChessCore.timing(MV, { secondsPerMove: t.secondsPerMove, keyHold: t.keyHold, fastOpening: t.fastOpening }), [MV, t.secondsPerMove, t.keyHold, t.fastOpening]);
  const scenes = JSON.stringify(TM.scenes);
  const fmtLen = window.ChessCore.fmtLen;
  const closePanel = React.useCallback(() => setPanel(false), []);
  const closeQueen = React.useCallback(() => setQueenOpen(false), []);
  // a menu item closes what is open over the board first: both menus, Settings and Queen's panel
  const closeOverlays = () => { setNewMenu(false); setMenu(false); setPanel(false); setQueenOpen(false); };
  React.useEffect(() => { setQueenArrow(null); }, [M]);
  // Queen's panel is tied to the game it was opened for (queenLive, read when its late answers land), and a game
  // being replaced stops the call or test still running for the old one
  const gameNow = React.useRef(gameKey);
  gameNow.current = gameKey;
  const queenLive = React.useCallback(() => gameNow.current === gameKey, [gameKey]);
  const queenStop = React.useRef(null);
  queenStop.current = Q.stop;
  React.useEffect(() => () => { queenStop.current(); }, [gameKey]);

  const newBoard = () => { closeOverlays(); guard(() => { commitBoard(window.BoardCore.fromFen()); }); };
  // the editor opens on the position on the board (empty when there is none); a game in progress is paused for it (and
  // kept, when it has moves, by guard's Leave). play: the Play dialog's { mode, tc, you } when its Set-up position opened
  // the editor, whose Done starts that game
  // read: Position from image's { setup, image }, the editor opening on it with the picture, or Import game's
  // { setup, image: null, back }, an illegal pasted FEN, back the paste box's text for Cancel to restore
  const openEditor = (play, read) => {
    // the board as it is now: Stockfish may have replied, or a flag fallen, while the Leave dialog was up
    const E = window.EditCore, P = window.PlayCore, b = boardRef.current, fen = nav.current && nav.current.fen && nav.current.fen();
    const s = (fen && E.fromFen(fen).setup) || E.empty();
    const resume = editing ? editing.resume : b && P.inProgress(b) ? P.pause(b, Date.now()) : null;
    if (resume && !editing) commitBoard(resume);
    const setup = read ? read.setup : s;
    setQueenOpen(false); setEditing({ setup, text: E.toFen(setup), msg: '', resume, play: play || null, image: read ? read.image : null, back: read && read.back != null ? read.back : null });
  };
  const editPosition = () => { closeOverlays(); guard(() => openEditor()); };
  // a square the reader was unsure of stops being outlined once its piece changes, however it was edited
  const sureOf = (e, setup) => {
    const im = e.image;
    if (!im || !im.unsure.some((i) => e.setup.b[i] !== setup.b[i])) return im;
    return { ...im, unsure: im.unsure.filter((i) => e.setup.b[i] === setup.b[i]) };
  };
  const editTo = (setup) => setEditing((e) => e && { ...e, setup, text: window.EditCore.toFen(setup), msg: '', image: sureOf(e, setup) });
  // a typed FEN sets up the board as soon as it is well-formed, legal or not; until then the board stays as it was
  const editText = (text) => setEditing((e) => {
    if (!e) return e;
    const r = window.EditCore.fromFen(text);
    return r.setup ? { ...e, setup: r.setup, text, msg: '', image: sureOf(e, r.setup) } : { ...e, text, msg: r.error };
  });
  // Turn board 180° turns the board as it stands, edits included, and the outlines still showing with it
  const editTurn = () => setEditing((e) => {
    if (!e) return e;
    const V = window.VisionCore, setup = V.turn(e.setup);
    return { ...e, setup, text: window.EditCore.toFen(setup), msg: '', image: e.image && { ...e.image, unsure: V.turnSquares(e.image.unsure) } };
  });
  const backToCrop = () => { if (editing && editing.image) { const { bitmap, box, grey, found } = editing.image; setVision({ play: editing.play, again: { bitmap, box, grey, found } }); } };
  // The picture's object URL and bitmap are GameApp's while the editor shows it: one the editor no longer holds (Done,
  // Cancel, a new editor, another read) is let go here, whichever way it went, but never one the next state still holds
  // (Back to crop's read may keep the bitmap and replace the URL)
  const heldPic = React.useRef(null), editPic = editing && editing.image;
  React.useEffect(() => {
    const was = heldPic.current;
    heldPic.current = editPic || null;
    if (!was) return;
    if (!editPic || editPic.url !== was.url) URL.revokeObjectURL(was.url);
    if (!editPic || editPic.bitmap !== was.bitmap) was.bitmap.close();
  }, [editPic]);
  // Import game's Position from image tile, where the reader can run
  const visionOk = React.useMemo(() => !!window.Vision && window.Vision.supported(), []);
  // Read board: from Back to crop it replaces the editor's board, edits and marks with the new read; else the editor opens
  // on it (in the Play dialog's mode when that is where it came from, so Done starts the game)
  const visionRead = ({ setup, unsure, url, bitmap, box, grey, found }) => {
    const v = vision, image = { url, unsure, bitmap, box, grey, found };
    setVision(null);
    if (v && v.again && editing) setEditing((e) => e && { ...e, setup, text: window.EditCore.toFen(setup), msg: '', image });
    else openEditor(v && v.play, { setup, image });
  };
  // Cancel goes back to what showed before: the editor as it was (Back to crop), else the Play dialog as it was, or Import game
  const visionClose = () => {
    const v = vision;
    setVision(null);
    if (v && v.again) focusBack.current = '.edit-back-to-crop'; // Back to crop › Cancel: back on the button that opened it
    if (v && v.back) setImportOpen({ text: '' });
    if (v && !v.again && v.play) { setPlayInit({ from: 'image', tc: v.play.tc, you: v.play.you }); setPlayOpen(v.play.mode); }
  };
  const editDone = () => {
    const fen = window.EditCore.toFen(editing.setup), play = editing.play;
    if (play) startGame(play.mode, { fen, tc: play.tc, you: play.you });
    else { setQueenOpen(false); commitBoard(window.BoardCore.fromFen(fen)); }
  };
  // Cancel goes back to what showed before: a game left for the editor resumes, its clock running from now, and the Play
  // dialog or Import game that opened it comes back as it was
  const editCancel = () => {
    const { resume: r, play, image, back } = editing || {};
    setEditing(null);
    if (back != null) setImportOpen({ text: back });
    if (r) commitBoard(window.PlayCore.runClock(r, Date.now()));
    if (play) { setPlayInit({ from: image ? 'image' : 'setup', tc: play.tc, you: play.you }); setPlayOpen(play.mode); }
  };
  const importGame = () => { closeOverlays(); guard(() => setImportOpen({ text: '' })); };
  // where the clipboard is refused, Share and export closes and the note shows the text to select
  const copyFailed = (what) => (text) => { setShareOpen(null); setFenNote({ fen: text, ok: false, what }); };
  React.useEffect(() => { if (fenNote && fenNote.ok) { const id = setTimeout(() => setFenNote(null), 4000); return () => clearTimeout(id); } }, [fenNote]);
  // the Play dialog's choices to open with (after the editor's Cancel), else its defaults
  const [playInit, setPlayInit] = React.useState(null);
  // the position on the board when a Play dialog opens, with the moves to it, for its This position
  const [playHere, setPlayHere] = React.useState(null);
  const playIn = (mode) => () => {
    const here = editing ? null : (nav.current && nav.current.line && nav.current.line()) || null;
    closeOverlays(); guard(() => { setPlayInit(null); setPlayHere(here); setPlayOpen(mode); });
  };
  const playHuman = playIn('human'), playSf = playIn('stockfish');
  // against Stockfish the side is remembered as picked, and Random resolved here, for this game
  // This position (here): a game played on after the moves to it, which it keeps
  const startGame = (mode, { fen, here, tc, you }) => {
    setQueenOpen(false); setTweak('playClock', tc || 'Off');
    if (mode === 'stockfish') setTweak('playSide', you);
    const side = you === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : you;
    const from = here && window.BoardCore.restore({ fen: here.fen, moves: here.moves });
    commitBoard(window.PlayCore.start(from || window.BoardCore.fromFen(fen), tc, null, { ...(mode === 'stockfish' ? { mode, you: side } : {}), keep: !!from }));
  };
  const playStart = (choice) => { const mode = playOpen; setPlayOpen(null); startGame(mode, choice); };
  // Set-up position with no position set up: the editor first, keeping the dialog's choices
  const playSetUp = ({ tc, you }) => { const mode = playOpen; setPlayOpen(null); openEditor({ mode, tc, you }); };
  // Start from › From image: the picture's dialog, keeping the Play dialog's choices for the editor it opens
  const playFromImage = ({ tc, you }) => { const mode = playOpen; setPlayOpen(null); setVision({ play: { mode, tc, you }, again: null }); };
  const closePlay = React.useCallback(() => setPlayOpen(null), []);
  const myGames = () => { closeOverlays(); setGamesOpen(readGames()); };
  const closeGames = React.useCallback(() => setGamesOpen(null), []);
  const openKeys = () => { closeOverlays(); setKeysOpen(true); };
  const closeKeys = React.useCallback(() => setKeysOpen(false), []);
  // the dialog shows the FEN of the position on the board, whichever view it's in, as it was when opened
  const openShare = () => { closeOverlays(); setShareOpen({ fen: (nav.current && nav.current.fen && nav.current.fen()) || '' }); };
  const closeShare = React.useCallback(() => setShareOpen(null), []);
  // a finished game replays as a loaded game; one in progress goes back on the board, the side to move's clock running
  // from now (the time away isn't charged)
  const replayGame = (e) => { setGamesOpen(null); guard(() => { const b = window.BoardCore.restore(e.board); if (!b) return; setQueenOpen(false); commit({ pgn: window.PlayCore.pgn(b), pgnName: `my-game-${b.game.date}.pgn`, gameIndex: 0 }); }); };
  const resumeGame = (e) => { setGamesOpen(null); guard(() => { const b = window.BoardCore.restore(e.board); if (!b) return; setQueenOpen(false); commitBoard(window.PlayCore.runClock(b, Date.now())); }); };
  const deleteGame = (id) => { const next = updateGames((list) => window.GamesCore.remove(list, id), 'The game couldn’t be deleted: the browser’s storage is full.'); if (next) setGamesOpen(next); };
  // Import game's tiles and paste box (guard asked before the dialog opened): the picker's files close the dialog as they load
  const chooseFiles = () => inputRef.current.click();
  const importImage = () => { setImportOpen(false); setVision({ play: null, again: null, back: true }); };
  // a pasted PGN is a loaded game, as a picked file; the dialog has checked it is standard chess and builds
  // (ImportCore.pgn, a fetched one too), so closing it first loses nothing. link: the Lichess link it was fetched from
  // (LichessCore.gameLink), which sets Flip as Lichess shows it (from Black's side for /black, else White's), and whose
  // #ply opens the replay paused after that ply
  const pgnLoad = (text, link) => {
    setImportOpen(false); setQueenOpen(false);
    if (link) setTweak('flip', link.side === 'b');
    seekPly.current = link && link.ply ? link.ply : null;
    if (!commit({ pgn: text, pgnName: link ? `lichess-${link.id}.pgn` : 'pasted.pgn', gameIndex: 0 })) seekPly.current = null;
  };
  // the explorer's games (Open games: Here): Import game on the game's link, fetched at once
  const openLichess = (url) => guard(() => { closeOverlays(); setImportOpen({ text: url, auto: true }); });
  // a pasted FEN: a legal position on the free board, else Edit position on it, saying what's wrong
  const fenLoad = (setup, text) => {
    setImportOpen(false);
    if (window.EditCore.ok(setup)) { setQueenOpen(false); commitBoard(window.BoardCore.fromFen(window.EditCore.toFen(setup))); } else openEditor(null, { setup, image: null, back: text });
  };
  const closeImport = React.useCallback(() => setImportOpen(false), []);
  // the board's moves as a loaded game (replay, Analyse with Stockfish, PGN and video export); the board is kept with it, to go back to
  const boardAsGame = () => { commit({ pgn: window.BoardCore.pgn(board), pgnName: 'free-board.pgn', gameIndex: 0, fromBoard: files.board, fromLastGame: files.lastGame || null }); };
  // the game left for the board comes back as it was, paused where the playhead was (the board is kept to go back to)
  const backToGame = () => guard(() => { const l = files.lastGame; if (!l) return; seekAfter.current = l.at; setQueenOpen(false); if (!commit({ ...l.files, fromBoard: files.board })) seekAfter.current = null; });
  // a Lichess link's #ply: once the replay has its timeline (probe), paused just after that ply, as Queen's moves seek
  const seekPly = React.useRef(null);
  React.useEffect(() => {
    if (seekPly.current == null || files.board) return;
    const ply = seekPly.current; seekPly.current = null;
    let tries = 0, id;
    const go = () => {
      const { S, CUES } = probe.current || {};
      if (!S || S.N !== MV.plies.length) { if (++tries < 60) id = requestAnimationFrame(go); return; }
      const i = Math.min(ply, S.N) - 1;
      window.dispatchEvent(new CustomEvent('chess-video:seek', { detail: { time: window.ChessCore.settledAt(S, CUES, i) } }));
    };
    id = requestAnimationFrame(go);
    return () => cancelAnimationFrame(id);
  }, [files]);
  React.useEffect(() => {
    if (seekAfter.current == null || files.board) return;
    const time = seekAfter.current; seekAfter.current = null;
    window.dispatchEvent(new CustomEvent('chess-video:seek', { detail: { time } }));
  }, [files]);
  // a dialog closed (Esc, Cancel, Set up, Start game): focus goes back to what opened it, Menu, or the control focusBack
  // names (a selector) where that is what opened it and it still shows
  const newBtn = React.useRef(null), menuBtn = React.useRef(null), fenWasOpen = React.useRef(false), dialogOpen = !!importOpen || !!playOpen || !!gamesOpen || keysOpen || !!vision;
  React.useEffect(() => {
    if (fenWasOpen.current && !dialogOpen) {
      const back = focusBack.current && document.querySelector(focusBack.current);
      const b = back || (phone ? menuBtn.current : newBtn.current);
      if (b) b.focus();
    }
    focusBack.current = null;
    fenWasOpen.current = dialogOpen;
  }, [dialogOpen]);
  const loadFiles = async (list) => {
    const batch = {};
    try {
      const big = Array.from(list).find((f) => f.size > MAX_FILE_BYTES);
      if (big) { setErr(`${big.name} is too large to load (over ${MAX_FILE_BYTES / 1e6} MB).`); return; }
      for (const f of Array.from(list)) { const text = await f.text(); const kind = window.ChessCore.classifyFile(f.name, text); batch[kind] = text; batch[kind + 'Name'] = f.name; }
    } catch (e) { setErr('Could not read that file: ' + ((e && e.message) || e)); return; }
    if (batch.queen) {
      const answers = window.QueenCore.readQueenFile(batch.queen);
      delete batch.queen; delete batch.queenName;
      if (answers) { Q.merge(answers); setErr(''); setQueenOpen(true); setPanel(false); }
      if (!batch.pgn && !batch.analysis && !batch.notes) return;
    } else if (batch.pgn) setQueenOpen(false); // another game: Queen's panel closes, as the other ways to load one close it
    if (!batch.pgn && !batch.analysis && !batch.notes) { setErr('That file isn’t a PGN, an analysis JSON or a notes file.'); return; }
    // a free board has no game for notes or an analysis to go with
    if (board && !batch.pgn) { setErr('Load a PGN first: notes and analysis files go with a game.'); return; }
    let next;
    if (batch.pgn) {
      next = { ...batch, gameIndex: 0 };
      if (!batch.analysis && files.analysis && !files.sample) { try { window.ChessCore.buildGame({ ...next, analysis: files.analysis }); next.analysis = files.analysis; next.analysisName = files.analysisName; } catch (e) {} }
    } else next = { ...(board ? {} : files), ...batch, sample: false };
    commit(next);
  };
  // Drag-and-drop: the overlay shows while files are held over the page (watchFileDrag); Position from image takes
  // the drags while it is open
  const loadRef = React.useRef(loadFiles);
  loadRef.current = loadFiles; // the listeners below are registered once and always load with the current files
  const visionOpen = React.useRef(false), importRef = React.useRef(false);
  visionOpen.current = !!vision; importRef.current = importOpen;
  React.useEffect(() => watchFileDrag({
    skip: () => visionOpen.current,
    over: (e) => { e.dataTransfer.dropEffect = 'copy'; setDrag(true); },
    off: () => setDrag(false),
    drop: (e) => {
      const list = droppedFiles(e);
      // over Import game, which asked before it opened, the files load at once
      if (list.length) { if (importRef.current) { setImportOpen(false); loadRef.current(list); } else guardRef.current(() => loadRef.current(list)); } else setErr('The drop arrived without a file. Use “Import game” to pick the files instead.');
    },
  }), []);
  React.useEffect(() => { if (vision) setDrag(false); }, [vision]);

  // txt is a string or a Blob
  const saveFile = (name, txt, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const fileStem = (M.white.short + '_' + M.black.short).replace(/[^\w-]+/g, '_');
  const browserAnalysis = React.useMemo(() => sfIsBrowserAnalysis(files.analysis), [files.analysis]);
  const saveAnalysis = () => {
    const a = typeof files.analysis === 'string' ? files.analysis : JSON.stringify(files.analysis, null, 2);
    saveFile(files.analysisName || fileStem + '_analysis.json', a, 'application/json');
  };
  // the whole annotation whatever the video shows: commentary even when hidden, Queen's answers even when out of the video,
  // and Go deeper's evals in place of the analysis's on the moves it searched
  const annotatedPgn = () => window.ChessCore.annotatedPgn(withQueen(withDeeper(M), Q.resultAt));
  const rawPgn = () => window.ChessCore.annotatedPgn(M, { raw: true });
  // a free board's moves (with a game's result and clocks)
  const boardPgn = () => (board.game ? window.PlayCore.pgn(board) : window.BoardCore.pgn(board));
  const savePgn = () => saveFile(fileStem + '_annotated.pgn', annotatedPgn(), 'application/x-chess-pgn');
  const saveRawPgn = () => saveFile(fileStem + '.pgn', rawPgn(), 'application/x-chess-pgn');
  // the game's notes (a loaded notes file's, or the sample's own) as a notes file; none without notes
  const notes = React.useMemo(() => window.ChessCore.notesText(M), [M]);
  const saveNotes = () => saveFile(fileStem + '_notes.txt', notes, 'text/plain');
  const saveBoardPgn = () => saveFile(board.game ? `my-game-${board.game.date}.pgn` : 'free-board.pgn', boardPgn(), 'application/x-chess-pgn');
  const saveQueen = () => saveFile(fileStem + '_queen.json', JSON.stringify(Q.saved(), null, 1), 'application/json');
  const analysis = useGameAnalysis(M, files, () => filesRef.current, (next) => commit(next, true), engine, ES.game, t.tablebase !== false);
  // switching engines stops a running analysis (its searches so far are kept, to resume with the engine that made them)
  const analysisStop = React.useRef(analysis.stop);
  analysisStop.current = analysis.stop;
  const kindSeen = React.useRef(sfKind);
  React.useEffect(() => { if (kindSeen.current !== sfKind) { kindSeen.current = sfKind; analysisStop.current(); } }, [sfKind]);
  // Lichess's opening book per ply, built after the first paint (about 0.25 s the first time)
  const [book, setBook] = React.useState(null);
  React.useEffect(() => { setBook(null); const id = setTimeout(() => { try { setBook(window.Openings.book().byPly(M.plies.map((p) => p.uci), M.start.fen)); } catch (e) {} }, 50); return () => clearTimeout(id); }, [M]);
  const soundSet = window.Sfx.SETS.includes(t.soundSet) ? t.soundSet : window.Sfx.SETS[0];
  const soundVolume = Number.isFinite(+t.soundVolume) ? +t.soundVolume : 70;
  // the page's rem is 16 px × this, so the overlays (dock, bars, Settings, menus, dialogs) follow the Text size setting; the panels get it through Stage's text
  React.useLayoutEffect(() => { document.documentElement.style.setProperty('--text', String(LayoutCore.textScale(t.textSize))); }, [t.textSize]);
  const pieces = usePieceSet(t.pieceSet);
  const pieceSet = window.PieceSets.byId(t.pieceSet);
  const boardTheme = window.BoardThemes.byId(t.boardTheme);
  const boardAdj = window.BoardThemes.adjust({ brightness: t.boardBrightness, contrast: t.boardContrast, tint: t.boardTint, saturation: t.boardSaturation, hue: t.boardHue });
  const X = useExportSettings({ t, setTweak, M, MV, TM, frameW, stem: fileStem, saveFile, pieceSet, boardTheme, boardAdj, soundSet, soundVolume }), video = X.video;
  // Settings' Reset colours to default, while the mouse is on it, shows the board as the reset would leave it (never in an export)
  const [resetPreview, setResetPreview] = React.useState(false);
  const boardLook = useBoardLook(boardTheme.id, resetPreview && !video.busy ? window.BoardThemes.adjust() : boardAdj, video.busy);
  const exportVideo = () => { setShareOpen(null); setPanel(false); setQueenOpen(false); X.run(); };
  const askQueen = () => { setQueenOpen((q) => !q); setPanel(false); };
  // the Queen panel opens centred over its button in the transport bar, or over the menu button when the dock is folded
  // into a menu (a phone frame, or a window under 900 px), kept on screen
  const [queenLeft, setQueenLeft] = React.useState(null);
  React.useLayoutEffect(() => {
    if (!queenOpen) { setQueenLeft(null); return; }
    const place = () => {
      const btn = phone ? menuBtn.current : newBtn.current, b = btn && btn.getBoundingClientRect();
      if (!b) return;
      const w = Math.min(400, window.innerWidth - 32);
      setQueenLeft(Math.round(Math.max(16, Math.min(b.left + b.width / 2 - w / 2, window.innerWidth - 16 - w))));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [queenOpen, phone]);
  // sfOn: the Analysis panel's switch; off, Stockfish searches nothing live (your moves, the free board, Go deeper),
  // while a loaded analysis still shows and the game analysis still runs from its dialog (ask opens it). A running game
  // analysis turns the live searches off too (busy: the panel says why), so the engine never switches between the
  // run's threads and theirs (Stockfish resizes its thread pool and clears its hash table on each change)
  const sfOn = t.sfOn === true, running = analysis.state === 'running', askAnalysis = () => { closeOverlays(); setAnalyseOpen(true); };
  const sf = { engine, own: ES.own, game: ES.game, book, status: engine.status, why: engine.why, off: !sfOn || running, busy: running, run: analysis, start: analysis.start, stop: analysis.stop, ask: askAnalysis, estimateMin: analysis.estimateMin };

  // the Analysis panel's engine menu (EngineMenuContext): the Lite/Full choice in its title row, and EngineSettings in the
  // panel while the menu is open
  const hashProp = { choices: hashChoices, note: hashNote, clearNote: () => setHashNote('') };
  const engineBody = <EngineSettings t={t} setTweak={setTweak} full={full} ES={ES} sfKind={sfKind} threading={threading} hash={hashProp} board={board} />;
  // picking Full before it is downloaded opens the menu, where its Download button is
  // on/setOn: the switch left of the engine; analyse: the computer button right of it (a loaded game only)
  const engineMenu = { name: engineLabel(ES.game.name), body: engineBody, on: sfOn, setOn: (v) => setTweak('sfOn', v), analyse: board ? null : askAnalysis,
    // run: the game analysis going on ({ done, total, k }), for the computer button's ring and the panel's progress line
    // runErr: why the last run stopped, shown at the top of the panel (the dialog it started from has closed)
    runErr: !board && analysis.err ? analysis.err : '',
    // runNote: what the run going on or the last one has to say (Lichess's tablebase lost part-way), under runErr
    runNote: !board && analysis.note ? analysis.note : '',
    run: !board && analysis.state === 'running' ? { done: analysis.done, total: analysis.total, k: analysis.total ? analysis.done / analysis.total : 0 } : null,
    pick: full.offered ? { value: t.sfEngine === 'Full' ? 'Full' : 'Lite', options: [{ value: 'Lite', label: engineLabel(window.AnalysisCore.ENGINE_NAMES.lite) }, { value: 'Full', label: engineLabel(window.AnalysisCore.ENGINE_NAMES.full) + ' full' }],
      onChange: (v) => { setTweak('sfEngine', v); return v === 'Full' && full.state === 'absent'; } } : null };

  const gameName = (g) => (g.mode === 'stockfish' ? `Play vs computer · you play ${g.you === 'w' ? 'White' : 'Black'}` : 'Play vs human');
  const boardStatus = board && board.game ? `${gameName(board.game)} · ${board.game.tc || 'no clock'} · ${window.PlayCore.played(board)} move${window.PlayCore.played(board) === 1 ? '' : 's'}${board.game.result ? ' · ' + window.PlayCore.resultText(board.game.result).score : ''}`
    : board && `Free board · ${window.PlayCore.fromText(board)} · ${board.steps.length} move${board.steps.length === 1 ? '' : 's'}`;
  const status = boardStatus || `${M.white.short} – ${M.black.short} · ${M.plies.length} plies` + (M.evalSource === 'analysis' ? ' · analysis evals' : M.evalSource === 'pgn' ? ' · PGN evals' : '') + (M.hasNotes ? ' · notes' : '') + (files.sample ? ' (sample)' : '') + ' · ' + fmtLen(TM.total);
  const shownErr = err || built.error;

  const newGroups = [{ label: 'Explore', items: [{ label: 'Starting position', run: newBoard }, { label: 'Edit position', run: editPosition }] },
    { label: 'Play', items: [{ label: 'Play vs human', run: playHuman }, { label: 'Play vs computer', run: playSf }, { label: 'My games', run: myGames }] },
    // Ask Queen sits here on the wide layouts; the folded menu keeps it in its last row. The folded menu's shortcuts item is hidden on a touch screen
    { label: 'More', items: [{ label: 'Keyboard shortcuts', run: openKeys }, ...(!phone && !board ? [{ label: 'Ask Queen', cls: 'dock-queen', run: () => { setNewMenu(false); askQueen(); } }] : [])] }];
  const newItems = newGroups.map((g) => <div key={g.label} className={`dock-group dock-group-${g.label.toLowerCase()}`}>
    <span className="dock-menu-label">{g.label}</span>
    {g.items.map((it) => <button key={it.label} type="button" className={it.cls ? 'dock-btn ' + it.cls : 'dock-btn'} onClick={it.run}>{it.label}</button>)}
  </div>);
  const fsLabel = fullscreen.on ? 'Exit full screen' : 'Full screen';
  const dockItems = (
    <div id="dock-items" className="dock-items part-dock">
      {phone && <span className="dock-menu-status">{shownErr || status}</span>}
      <button type="button" className="dock-btn dock-primary" onClick={importGame}>Import game</button>
      {/* a list of starting points and tools in groups, each under its heading; on the phone they sit in the folded menu */}
      {phone ? newItems : (
        <div ref={newRef} className="dock-new">
          <button ref={newBtn} type="button" className="dock-btn" aria-expanded={newMenu} aria-controls="dock-new-items" onClick={() => { setNewMenu((m) => !m); setPanel(false); setQueenOpen(false); }}>Menu</button>
          {newMenu && (
            <div id="dock-new-items" className="dock-pop part-play-explore-menu">
              {newItems}
            </div>
          )}
        </div>
      )}
      {/* Share and export, Settings and Full screen are icons in every layout; on the phone they share the menu's last row with Ask Queen */}
      <div className="dock-icons">
      {phone && !board && <button type="button" className="dock-btn dock-queen" aria-expanded={queenOpen} onClick={() => { setMenu(false); askQueen(); }}>Ask Queen</button>}
      <button type="button" className="dock-btn dock-iconic" aria-label="Share and export" title="Share and export" aria-haspopup="dialog" onClick={openShare}>
        <svg className="dock-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d={SHARE} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button type="button" className="dock-btn dock-iconic" aria-label="Settings" title="Settings" aria-expanded={panel} onClick={() => { setMenu(false); setPanel((p) => !p); setQueenOpen(false); }}>
        <svg className="dock-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d={GEAR} /></svg>
      </button>
      {phone && short && <SoundButton className="dock-btn dock-iconic" on={t.sound !== false} onChange={(v) => setTweak('sound', v)} />}
      {fullscreen.ok && <button type="button" className="dock-btn dock-iconic" aria-label={fsLabel} title={fsLabel} onClick={() => { setMenu(false); fullscreen.toggle(); }}>
        <svg className="dock-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d={fullscreen.on ? 'M6 2v4H2M10 2v4h4M14 10h-4v4M2 10h4v4' : 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>}
      </div>
    </div>
  );
  const menuEl = (
    <div ref={dockRef} className={'pmenu part-menu' + (shownErr ? ' pmenu-err' : '') + (menu ? ' pmenu-open' : '')}>
      <button ref={menuBtn} type="button" className="pbtn dock-menu" aria-label="Menu" aria-expanded={menu} aria-controls="dock-items" onClick={() => { setMenu((m) => !m); setPanel(false); setQueenOpen(false); }}>
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          {menu
            ? <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            : <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        </svg>
      </button>
      {dockItems}
    </div>
  );
  // landscape: the buttons sit at the end of the transport bar, with an error above them
  const deskDock = (
    <div className="pdock">
      {shownErr && <span className="dock-status" role="alert">{shownErr}</span>}
      {dockItems}
    </div>
  );

  return (
    <React.Fragment>
      <EngineMenuContext.Provider value={board && board.game ? null : engineMenu}>
      <CompositionStage clock={clockRef} fps={X.exportFps} nav={nav} forceVideo={video.busy} text={LayoutCore.textScale(t.textSize)} top={!net.online && <span className="net-chip" role="status" title={OFFLINE_NOTE}>Offline</span>} menu={<React.Fragment>{!(phone && short) && <SoundButton on={t.sound !== false} onChange={(v) => setTweak('sound', v)} />}{phone ? menuEl : deskDock}</React.Fragment>} onLayout={onLayout} scenes={scenes} playback={PLAYBACK} bg={C.bg} still={!!board || !!editing}>
        {editing
          ? <EditBoard setup={editing.setup} onChange={editTo} onDone={editDone} onCancel={editCancel} fenText={editing.text} onFenText={editText} fenMsg={editing.msg} doneLabel={editing.play ? 'Start game' : 'Done'} orient={t.flip ? 'b' : 'w'} nav={nav} overlay={panel || newMenu || menu || queenOpen}
            image={editing.image} onTurn={editTurn} onBackToCrop={backToCrop} />
          : board
          ? <FreeBoard board={board} onChange={commitBoard} tw={t} setTweak={setTweak} onLichess={openLichess} sf={sf} nav={nav} orient={t.flip ? 'b' : 'w'} book={book && !board.game ? window.Openings.book() : null} />
          : <GameVideo key={gameKey} M={MV} tw={video.busy ? { ...t, exporting: true } : t} d={TM.d} probe={probe} queen={queenArrow} nav={nav} scheme={scheme} sf={sf} orient={t.flip ? 'b' : 'w'} />}
      </CompositionStage>
      </EngineMenuContext.Provider>
      <input ref={inputRef} id="game-files" type="file" multiple accept=".pgn,.txt,.json,application/json,text/plain" hidden onChange={(e) => { if (e.target.files.length) setImportOpen(false); loadFiles(e.target.files); e.target.value = ''; }} />
      {hf.note && (
        <div className="signin-note" role="status">{hf.note}<button type="button" className="twk-x" aria-label="Dismiss" onClick={hf.clearNote}>✕</button></div>
      )}
      {fenNote && !hf.note && (
        <div className="signin-note net-note copy-note" role="status">
          <span>{fenNote.ok ? `${fenNote.what || 'FEN'} copied` : `Copy this ${fenNote.what || 'FEN'}`}{(!fenNote.ok || !fenNote.what) && <>: <textarea className="copy-note-fen" readOnly rows={2} value={fenNote.fen} aria-label={fenNote.what || 'FEN'} onFocus={(e) => e.target.select()} /></>}</span>
          <button type="button" className="twk-x" aria-label="Dismiss" onClick={() => setFenNote(null)}>✕</button>
        </div>
      )}
      {net.note && !hf.note && !fenNote && (
        <div className={'signin-note net-note ' + (net.online ? 'net-note-on' : 'net-note-off')} role="status">{net.note}<button type="button" className="twk-x" aria-label="Dismiss" onClick={net.clearNote}>✕</button></div>
      )}
      {drag && (
        <div className={importOpen ? 'drop drop-top' : 'drop'}>
          <div className="drop-box">Drop a PGN<br /><span>with this page’s analysis or notes files too, if you have them · if dropping doesn’t work here, use Import game</span></div>
        </div>
      )}
      <ExportOverlay x={video} />
      {importOpen && <ImportDialog text={importOpen.text} auto={importOpen.auto} onChoose={chooseFiles} onPgn={pgnLoad} onFen={fenLoad} onImage={visionOk ? importImage : null} onClose={closeImport} />}
      {resetOpen && (
        <DialogBox label="Reset all settings" part="reset-settings" onClose={() => setResetOpen(false)}>
          <div className="dlg-note">Every setting goes back to its default. Your saved games and the downloaded engine are kept.</div>
          <div className="dlg-btns">
            <button type="button" className="twk-btn secondary" data-autofocus onClick={() => setResetOpen(false)}>Cancel</button>
            <button type="button" className="twk-btn danger" onClick={() => { setResetOpen(false); Object.keys(window.TWEAK_DEFAULTS).filter((k) => k !== 'sfEngine').forEach((k) => setTweak(k, window.TWEAK_DEFAULTS[k])); }}>Reset</button>
          </div>
        </DialogBox>
      )}
      {playOpen && <PlayDialog key={playOpen} mode={playOpen} setUpFen={board && board.fen !== window.ChessCore.START_FEN ? board.fen : null} here={playHere} clock={t.playClock} side={t.playSide} initial={playInit} onStart={playStart} onSetUp={playSetUp} onFromImage={visionOk ? playFromImage : null} onClose={closePlay} />}
      {vision && <VisionDialog again={vision.again} onRead={visionRead} onClose={visionClose} />}
      {keysOpen && <ShortcutsDialog onClose={closeKeys} />}
      {shareOpen && <ShareDialog fen={shareOpen.fen} board={board} x={X} setTweak={setTweak} onFail={copyFailed} onClose={closeShare} onExport={exportVideo}
        onReplay={() => { setShareOpen(null); boardAsGame(); }}
        pgn={{ board: boardPgn, saveBoard: saveBoardPgn, annotated: annotatedPgn, saveAnnotated: savePgn, raw: rawPgn, saveRaw: saveRawPgn, saveAnalysis: browserAnalysis ? saveAnalysis : null, notes: notes ? () => notes : null, saveNotes }} />}
      {analyseOpen && !board && <GameAnalysisDialog t={t} setTweak={setTweak} ES={ES} sfKind={sfKind} threading={threading} hash={hashProp} analysis={analysis} engine={engine} files={files} M={MV}
        onRemoveAnalysis={() => { setAnalyseOpen(false); commit({ ...files, analysis: null, analysisName: null, evalSource: null }); }} onClose={() => setAnalyseOpen(false)} />}
      {gamesOpen && <MyGamesDialog games={gamesOpen} current={board && window.PlayCore.inProgress(board) ? board.game.id : null} onReplay={replayGame} onResume={resumeGame} onDelete={deleteGame} onClose={closeGames} />}
      {leave && <LeaveDialog onStay={() => setLeave(null)} onLeave={() => { const run = leave.run; setLeave(null); keepLeft(board); run(); }} />}
      {queenOpen && !board && <QueenPanel key={gameKey} M={M} Q={Q} hf={hf} probe={probe} live={queenLive} onClose={closeQueen} onOverlay={setQueenArrow} onSave={saveQueen} left={queenLeft} />}
      <TweaksPanel open={panel} onClose={closePanel} tab={panelTab} onTab={setPanelTab} tabs={[
        { id: 'game', label: 'Game', body: <GameSettings M={M} files={files} board={board} status={status} err={shownErr} commit={commit}
          commentary={!board && <CommentarySettings t={t} setTweak={setTweak} files={files} sources={sources} queenSays={queenSays} />}
          go={{ importGame, boardAsGame, backToGame, backToBoard: () => { const b = window.BoardCore.restore(files.fromBoard); if (b) commitBoard(b); }, backToSample: () => guard(() => commit(SAMPLE)), reset: () => setResetOpen(true) }} /> },
        { id: 'view', label: 'View', body: <ViewSettings t={t} setTweak={setTweak} board={board} TM={TM} pieceSet={pieceSet} pieces={pieces} boardTheme={boardTheme} boardAdj={boardAdj} boardLook={boardLook} resetPreview={resetPreview} setResetPreview={setResetPreview} /> },
        { id: 'online', label: 'Online', body: <OnlineSettings t={t} setTweak={setTweak} sfKind={sfKind} /> },
        { id: 'sound', label: 'Sound', body: <SoundSettings t={t} setTweak={setTweak} soundSet={soundSet} soundVolume={soundVolume} /> },
      ]} />
    </React.Fragment>
  );
}

// A render error would leave a blank page, and saved data could bring it back on every visit: offer to clear it
// (the loaded game, Queen's answers and settings; the Hugging Face sign-in and My games stay)
class Recover extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    const reset = () => {
      try { Object.keys(localStorage).filter((k) => k.startsWith('chess-video.') && k !== AUTH_STORE && k !== LI_AUTH_STORE && k !== GAMES && k !== GAMES_UNREADABLE).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
      location.reload();
    };
    return (
      <div role="alert" style={{ maxWidth: 520, margin: '15vh auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14, color: 'var(--ink)', font: '15px/1.55 var(--sans)' }}>
        <strong style={{ fontSize: 18 }}>Something on this page broke.</strong>
        <span>It may be a file loaded earlier, which the page reloads on every visit. Clearing the saved game, Queen’s answers and settings usually fixes it.</span>
        <span style={{ font: '13px var(--mono)', color: 'var(--dim)' }}>{String((this.state.error && this.state.error.message) || this.state.error)}</span>
        <button type="button" className="twk-btn" style={{ alignSelf: 'flex-start' }} onClick={reset}>Clear saved data and reload</button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(<Recover><GameApp /></Recover>);
