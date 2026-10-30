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
// My games (GamesCore), read afresh for each change, so games kept by another tab stay
const GAMES = 'chess-video.games.v1';
const readGames = () => { try { return window.GamesCore.read(localStorage.getItem(GAMES)); } catch (e) { return []; } };

// Full screen hides the browser's bars, and the phone layouts grow into the space. iPhone Safari has no element
// full screen (only <video>), so the item shows only where the browser says it works;
// an installed copy opened full screen (the manifest) has no bars to hide
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
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const flipRef = React.useRef(false);
  flipRef.current = !!t.flip;
  const busyRef = React.useRef(false);
  const scheme = useScheme(t.scheme || 'Auto');
  setPalette(scheme);
  const [files, setFiles] = React.useState(readStored);
  const filesRef = React.useRef(files);
  filesRef.current = files;
  const [err, setErr] = React.useState(() => storedNote);
  const [drag, setDrag] = React.useState(false);
  const [panel, setPanel] = React.useState(false);
  const [panelTab, setPanelTab] = React.useState('game'); // Settings' open tab, kept while the page is open
  const inputRef = React.useRef(null);
  const probe = React.useRef(null);
  const nav = React.useRef(null);
  const clockRef = React.useRef(null); // the stage's { time }, for the playhead a game is left at
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
  const [pgnOpen, setPgnOpen] = React.useState(false);
  // Edit position: { setup, text, msg, resume } while the editor shows in place of the board or the loaded game; text is
  // the FEN field's, msg why it doesn't parse, resume the paused game in progress left to open it (Cancel goes back to it)
  const [editing, setEditing] = React.useState(null);
  const [fenNote, setFenNote] = React.useState(null); // { fen, ok } after Copy FEN; a copy that failed stays up to select

  // the Play dialog's mode while it is open: 'human' or 'stockfish'
  const [playOpen, setPlayOpen] = React.useState(null);
  // My games' list while its dialog is open
  const [gamesOpen, setGamesOpen] = React.useState(null);
  // the Keyboard shortcuts dialog
  const [keysOpen, setKeysOpen] = React.useState(false);
  // leaving a game in progress asks first: { run } is what waits on the answer
  const [leave, setLeave] = React.useState(null);
  const newRef = React.useRef(null);
  React.useEffect(() => {
    if (!newMenu) return;
    const away = (e) => { if (newRef.current && !newRef.current.contains(e.target)) setNewMenu(false); };
    const esc = (e) => { if (e.key === 'Escape') setNewMenu(false); };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [newMenu]);
  React.useEffect(() => { if (phone) setNewMenu(false); }, [phone]);
  const dockRef = React.useRef(null);
  React.useEffect(() => {
    if (!menu) return;
    const away = (e) => { if (dockRef.current && !dockRef.current.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [menu]);
  // F turns the board round (not in a field, not in a game, whose board turns by itself, not with a modifier, which belongs to the browser)
  React.useEffect(() => {
    const onF = (e) => {
      const tag = e.target && e.target.tagName;
      if (e.defaultPrevented || e.repeat || (e.key || '').toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable) || busyRef.current || gameRef.current) return;
      setTweak('flip', !flipRef.current);
    };
    window.addEventListener('keydown', onF);
    return () => window.removeEventListener('keydown', onF);
  }, []);
  const lastGood = React.useRef(null);
  // a free board keeps the last good game (the sample on a fresh page) for the hooks that want one
  const built = React.useMemo(() => {
    if (files.board) return { M: lastGood.current || window.ChessCore.buildGame(SAMPLE) };
    try { return { M: window.ChessCore.buildGame(files) }; } catch (e) { return { error: e.message }; }
  }, [files]);
  // the board's state, restored from its stored form (on a reload, a game's running clock charged for the time away); a
  // board this page just committed is used as it is
  const boardSaved = React.useRef(null);
  const board = React.useMemo(() => (!files.board ? null : boardSaved.current && boardSaved.current.saved === files.board ? boardSaved.current.board : window.BoardCore.restore(files.board, Date.now())), [files.board]);
  if (built.M) lastGood.current = built.M;
  const gameRef = React.useRef(false);
  gameRef.current = !!(board && board.game);
  // a game with moves and no result yet is thrown away only after asking
  const playing = !!(board && window.PlayCore.inProgress(board) && board.steps.length);
  // (a game left to open the editor was kept then, and isn't asked about again)
  const guard = (run) => { if (playing && !editing) setLeave({ run }); else run(); };
  const guardRef = React.useRef(guard);
  guardRef.current = guard;
  const M = built.M || lastGood.current || window.ChessCore.buildGame(SAMPLE);
  const hf = useHfAuth();
  const Q = useQueen(M, hf);
  // the engine drop-down: Full runs once its download is kept; until then Lite does
  const full = useFullEngine();
  // Remove the full engine asks first (getting it back is another 99 MB); any change to the download drops the question
  const [askRemove, setAskRemove] = React.useState(false);
  React.useEffect(() => setAskRemove(false), [full.state]);
  const sfKind = t.sfEngine === 'Full' && full.state === 'ready' ? 'full' : 'lite';
  // threads where the page allows them, lite or full
  const threading = useSfThreading();
  const ES = React.useMemo(() => window.AnalysisCore.engineSettings(t, sfKind, threading), [t.sfDepth, t.sfTime, t.sfOwnDepth, t.sfOwnTime, t.sfHash, t.sfLines, t.sfThreads, sfKind, threading]);
  const engine = useEngine(ES.game.hash_mb, ES.game.threads, sfKind, full.broken);
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
  const queenSays = queenInVideo && M.plies.some((p, i) => { const r = Q.resultAt(i + 1); return r && r.evalText; });
  const TM = React.useMemo(() => window.ChessCore.timing(MV, { secondsPerMove: t.secondsPerMove, keyHold: t.keyHold, fastOpening: t.fastOpening }), [MV, t.secondsPerMove, t.keyHold, t.fastOpening]);
  const scenes = JSON.stringify(TM.scenes);
  const fmtLen = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
  const closePanel = React.useCallback(() => setPanel(false), []);
  const closeQueen = React.useCallback(() => setQueenOpen(false), []);
  React.useEffect(() => { setQueenArrow(null); }, [M]);

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
    setErr(''); setFiles(withLast); if (!keep) setEditing(null);
    try {
      if (next.sample && !next.evalSource) localStorage.removeItem(STORE);
      else try { localStorage.setItem(STORE, JSON.stringify(withLast)); } catch (e) { if (withLast === next) throw e; setFiles(next); localStorage.setItem(STORE, JSON.stringify(next)); }
    } catch (e) { setErr(next.board ? 'The board couldn’t be remembered after reload: the browser’s storage is full.' : 'Loaded, but the files are too large to remember after reload.'); return false; }
    return true;
  };
  // a game is kept in My games as it goes; a full storage doesn't stop the board. The new list, or null when it couldn't
  // be stored (with `fail` shown, unless null)
  const updateGames = (fn, fail) => {
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
  const keepLeft = (b) => { if (b && window.PlayCore.inProgress(b) && b.steps.length) updateGames((list) => window.GamesCore.keep(list, window.PlayCore.pause(b, Date.now()), Date.now()), null); };
  const boardRef = React.useRef(board);
  boardRef.current = board;
  React.useEffect(() => {
    const hide = () => keepLeft(boardRef.current);
    window.addEventListener('pagehide', hide);
    return () => window.removeEventListener('pagehide', hide);
  }, []);
  const newBoard = () => { setNewMenu(false); setMenu(false); guard(() => { setQueenOpen(false); commitBoard(window.BoardCore.fromFen()); }); };
  // the editor opens on the position on the board (empty when there is none); a game in progress is paused for it (and
  // kept, when it has moves, by guard's Leave). play: the Play dialog's { mode, tc, you } when its Set-up position opened
  // the editor, whose Done starts that game
  const openEditor = (play) => {
    // the board as it is now: Stockfish may have replied, or a flag fallen, while the Leave dialog was up
    const E = window.EditCore, P = window.PlayCore, b = boardRef.current, fen = nav.current && nav.current.fen && nav.current.fen();
    const s = (fen && E.fromFen(fen).setup) || E.empty();
    const resume = editing ? editing.resume : b && P.inProgress(b) ? P.pause(b, Date.now()) : null;
    if (resume && !editing) commitBoard(resume);
    setQueenOpen(false); setEditing({ setup: s, text: E.toFen(s), msg: '', resume, play: play || null });
  };
  const editPosition = () => { setNewMenu(false); setMenu(false); setPanel(false); guard(() => openEditor()); };
  const editTo = (setup) => setEditing((e) => e && { ...e, setup, text: window.EditCore.toFen(setup), msg: '' });
  // a typed FEN sets up the board as soon as it is well-formed, legal or not; until then the board stays as it was
  const editText = (text) => setEditing((e) => { if (!e) return e; const r = window.EditCore.fromFen(text); return r.setup ? { ...e, setup: r.setup, text, msg: '' } : { ...e, text, msg: r.error }; });
  const editDone = () => {
    const fen = window.EditCore.toFen(editing.setup), play = editing.play;
    if (play) startGame(play.mode, { fen, tc: play.tc, you: play.you });
    else { setQueenOpen(false); commitBoard(window.BoardCore.fromFen(fen)); }
  };
  // Cancel goes back to what showed before: a game left for the editor resumes, its clock running from now, and the Play
  // dialog that opened it comes back as it was
  const editCancel = () => {
    const { resume: r, play } = editing || {};
    setEditing(null);
    if (r) commitBoard(window.PlayCore.runClock(r, Date.now()));
    if (play) { setPlayInit({ from: 'setup', tc: play.tc, you: play.you }); setPlayOpen(play.mode); }
  };
  const pastePgn = () => { setNewMenu(false); setMenu(false); setPanel(false); guard(() => setPgnOpen(true)); };
  // the position on the board, whichever view it's in; where the clipboard is refused the note shows it to select
  const copyFen = () => {
    setNewMenu(false); setMenu(false);
    const fen = nav.current && nav.current.fen && nav.current.fen();
    if (!fen) return;
    const shown = (ok) => setFenNote({ fen, ok });
    try { navigator.clipboard.writeText(fen).then(() => shown(true), () => shown(false)); } catch (e) { shown(false); }
  };
  // the game's PGN (a free board's moves, or the loaded game with its annotations), copied like the FEN
  const copyPgn = () => {
    setNewMenu(false); setMenu(false);
    const pgn = board ? window.BoardCore.pgn(board) : window.ChessCore.annotatedPgn(withQueen(M, Q.resultAt));
    const shown = (ok) => setFenNote({ fen: pgn, ok, what: 'PGN' });
    try { navigator.clipboard.writeText(pgn).then(() => shown(true), () => shown(false)); } catch (e) { shown(false); }
  };
  React.useEffect(() => { if (fenNote && fenNote.ok) { const id = setTimeout(() => setFenNote(null), 4000); return () => clearTimeout(id); } }, [fenNote]);
  // the Play dialog's choices to open with (after the editor's Cancel), else its defaults
  const [playInit, setPlayInit] = React.useState(null);
  const playIn = (mode) => () => { setNewMenu(false); setMenu(false); setPanel(false); guard(() => { setPlayInit(null); setPlayOpen(mode); }); };
  const playHuman = playIn('human'), playSf = playIn('stockfish');
  // against Stockfish the side is remembered as picked, and Random resolved here, for this game
  const startGame = (mode, { fen, tc, you }) => {
    setQueenOpen(false); setTweak('playClock', tc || 'Off');
    if (mode === 'stockfish') setTweak('playSide', you);
    const side = you === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : you;
    commitBoard(window.PlayCore.start(window.BoardCore.fromFen(fen), tc, null, mode === 'stockfish' ? { mode, you: side } : undefined));
  };
  const playStart = (choice) => { const mode = playOpen; setPlayOpen(null); startGame(mode, choice); };
  // Set-up position with no position set up: the editor first, keeping the dialog's choices
  const playSetUp = ({ tc, you }) => { const mode = playOpen; setPlayOpen(null); openEditor({ mode, tc, you }); };
  const closePlay = React.useCallback(() => setPlayOpen(null), []);
  const myGames = () => { setNewMenu(false); setMenu(false); setPanel(false); setGamesOpen(readGames()); };
  const closeGames = React.useCallback(() => setGamesOpen(null), []);
  const openKeys = () => { setNewMenu(false); setMenu(false); setPanel(false); setQueenOpen(false); setKeysOpen(true); };
  const closeKeys = React.useCallback(() => setKeysOpen(false), []);
  // a finished game replays as a loaded game; one in progress goes back on the board, the side to move's clock running
  // from now (the time away isn't charged)
  const replayGame = (e) => { setGamesOpen(null); guard(() => { const b = window.BoardCore.restore(e.board); if (!b) return; setQueenOpen(false); commit({ pgn: window.PlayCore.pgn(b), pgnName: `my-game-${b.game.date}.pgn`, gameIndex: 0 }); }); };
  const resumeGame = (e) => { setGamesOpen(null); guard(() => { const b = window.BoardCore.restore(e.board); if (!b) return; setQueenOpen(false); commitBoard(window.PlayCore.runClock(b, Date.now())); }); };
  const deleteGame = (id) => { const next = updateGames((list) => window.GamesCore.remove(list, id), 'The game couldn’t be deleted: the browser’s storage is full.'); if (next) setGamesOpen(next); };
  const loadGame = () => guard(() => inputRef.current.click());
  // a pasted PGN is a loaded game, as a picked file; the dialog has checked it builds
  const pgnLoad = (text) => { setPgnOpen(false); setQueenOpen(false); commit({ pgn: text, pgnName: 'pasted.pgn', gameIndex: 0 }); };
  const closePgn = React.useCallback(() => setPgnOpen(false), []);
  // the board's moves as a loaded game (replay, Analyse with Stockfish, PGN and video export); the board is kept with it, to go back to
  const boardAsGame = () => { commit({ pgn: window.BoardCore.pgn(board), pgnName: 'free-board.pgn', gameIndex: 0, fromBoard: files.board, fromLastGame: files.lastGame || null }); };
  // the game left for the board comes back as it was, paused where the playhead was (the board is kept to go back to)
  const backToGame = () => guard(() => { const l = files.lastGame; if (!l) return; seekAfter.current = l.at; setQueenOpen(false); if (!commit({ ...l.files, fromBoard: files.board })) seekAfter.current = null; });
  React.useEffect(() => {
    if (seekAfter.current == null || files.board) return;
    const time = seekAfter.current; seekAfter.current = null;
    window.dispatchEvent(new CustomEvent('chess-video:seek', { detail: { time } }));
  }, [files]);
  // a dialog closed (Esc, Cancel, Set up, Start game): focus goes back to what opened it, Menu
  const newBtn = React.useRef(null), menuBtn = React.useRef(null), fenWasOpen = React.useRef(false), dialogOpen = pgnOpen || !!playOpen || !!gamesOpen || keysOpen;
  React.useEffect(() => {
    if (fenWasOpen.current && !dialogOpen) { const b = phone ? menuBtn.current : newBtn.current; if (b) b.focus(); }
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
    }
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
  // Drag-and-drop: dragover repeats every few ms while a file is over the page, so the overlay hides itself
  // shortly after those stop (dropped elsewhere or cancelled)
  const dragTimer = React.useRef(null);
  const loadRef = React.useRef(loadFiles);
  loadRef.current = loadFiles; // the listeners below are registered once and always load with the current files
  React.useEffect(() => {
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const hideSoon = (ms) => { clearTimeout(dragTimer.current); dragTimer.current = setTimeout(() => setDrag(false), ms); };
    const over = (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDrag(true); hideSoon(400); };
    const leave = (e) => { if (!e.relatedTarget) hideSoon(80); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); clearTimeout(dragTimer.current); setDrag(false);
      let list = Array.from(e.dataTransfer.files || []);
      if (!list.length) list = Array.from(e.dataTransfer.items || []).filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
      if (list.length) guardRef.current(() => loadRef.current(list)); else setErr('The drop arrived without a file. Use “Load game” to pick the files instead.');
    };
    const end = () => { clearTimeout(dragTimer.current); setDrag(false); };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop); window.addEventListener('dragend', end);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); window.removeEventListener('dragend', end); clearTimeout(dragTimer.current); };
  }, []);

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
  // the whole annotation whatever the video shows: commentary even when hidden, Queen's answers even when out of the video
  const savePgn = () => saveFile(fileStem + '_annotated.pgn', window.ChessCore.annotatedPgn(withQueen(M, Q.resultAt)), 'application/x-chess-pgn');
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
  const exportFps = EXPORT_FPS_OPTIONS.includes(+t.exportFps) ? +t.exportFps : 8;
  const exportFormat = EXPORT_FORMATS.includes(t.exportFormat) ? t.exportFormat : EXPORT_FORMATS[0], webp = exportFormat === 'WebP';
  // WebP widths, largest first: the page's own (0), half of it ('Half', the default) and fixed ones below the frame's
  const halfW = Math.round(frameW / 2), wPx = (x) => (x === 'Half' ? halfW : x || frameW), webpPx = (x) => (x === 'Half' ? `${halfW} px (half)` : x ? x + ' px' : `${frameW} px (full)`);
  const webpWidths = [0].concat(WEBP_WIDTHS.filter((x) => x < frameW && x !== halfW), 'Half').sort((a, b) => wPx(b) - wPx(a));
  const webpWidth = webpWidths.includes(t.webpWidth) ? t.webpWidth : webpWidths.includes(+t.webpWidth) ? +t.webpWidth : 'Half';
  // the old setting was a ratio, 'Full' or 'Half': carry it over once
  // the page's rem is 16 px × this, so the overlays (dock, bars, Settings, menus, dialogs) follow the Text size setting; the panels get it through Stage's text
  React.useLayoutEffect(() => { document.documentElement.style.setProperty('--text', String(LayoutCore.textScale(t.textSize))); }, [t.textSize]);
  React.useEffect(() => { if (t.webpSize !== undefined) { setTweak('webpWidth', t.webpSize === 'Full' ? 0 : 'Half'); setTweak('webpSize', undefined); } }, []);
  const webpQuality = Math.min(WEBP_QUALITY.max, Math.max(WEBP_QUALITY.min, +t.webpQuality || 75));
  const mp4Quality = MP4_QUALITIES.includes(t.mp4Quality) ? t.mp4Quality : 'High';
  const mp4Vfr = t.mp4Vfr === true;
  const video = useVideoExport({ fps: exportFps, format: exportFormat, webp: { width: webpWidth, quality: webpQuality }, mp4Quality, mp4Vfr: mp4Vfr && !webp, stem: fileStem, save: (name, blob) => saveFile(name, blob, blob.type) });
  busyRef.current = video.busy;
  // the stretch to export, in plies: from -1 starts on the title card, to N (the ply count) ends after the end card
  const [clip, setClip] = React.useState({ from: -1, to: Infinity });
  React.useEffect(() => { setClip({ from: -1, to: Infinity }); }, [M]);
  const NP = MV.plies.length, clipFrom = Math.min(clip.from, NP - 1), clipTo = Math.max(clipFrom, Math.min(clip.to, NP));
  const clipOpts = React.useMemo(() => {
    const at = window.ChessCore.clipRange(MV, TM), ply = MV.plies.map((p, i) => ({ i, l: label(MV, i), t: at(i, i) }));
    return {
      at, S: window.ChessCore.schedule(MV, window.ChessCore.cues(TM.scenes), TM.d),
      from: [{ i: -1, s: 'Title card · 0:00' }].concat(ply.map((o) => ({ i: o.i, s: `${o.l} · ${fmtLen(o.t.start)}` }))),
      to: ply.map((o) => ({ i: o.i, s: `${o.l} · ${fmtLen(o.t.end)}` })).concat([{ i: NP, s: `End card · ${fmtLen(TM.total)}` }]),
    };
  }, [MV, TM]);
  const clipT = clipOpts.at(clipFrom, clipTo), clipFromOpts = clipOpts.from, clipToOpts = clipOpts.to.filter((o) => o.i >= clipFrom);
  const plyTag = (i) => `${Math.floor((MV.ply0 + i) / 2) + 1}${(MV.ply0 + i) % 2 ? 'b' : 'w'}`;
  const clipSuffix = clipFrom < 0 && clipTo >= NP ? '' : `_${clipFrom < 0 ? 'start' : plyTag(clipFrom)}-${clipTo >= NP ? 'end' : plyTag(clipTo)}`;
  const exportVideo = () => { setPanel(false); setQueenOpen(false); video.run({ start: clipT.start, end: clipT.end, suffix: clipSuffix, audio: t.sound === false || webp ? null
    : () => window.Sfx.renderTrack(window.SFX_DATA || {}, soundSet, window.Sfx.track(MV, clipOpts.S, clipT.start, clipT.end), soundVolume, clipT.end - clipT.start) }); };
  const depthText = (d) => (d == null ? 'No limit' : String(d)), SF_KEYS = ['sfDepth', 'sfTime', 'sfOwnDepth', 'sfOwnTime', 'sfLines', 'sfHash', 'sfThreads'];
  const sfChanged = JSON.stringify(ES) !== JSON.stringify(window.AnalysisCore.engineSettings(window.TWEAK_DEFAULTS, sfKind, threading));
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
  const sf = { engine, own: ES.own, game: ES.game, book, status: engine.status, run: analysis, start: analysis.start, stop: analysis.stop, estimateMin: analysis.estimateMin };

  // The Analysis panel's engine menu (EngineMenuContext): the Lite/Full choice in its title row, and these settings in
  // the panel while the menu is open; the explanations sit behind ⓘ. A game has no engine menu.
  const MB = sfMB(full.total), stopsAt = 'Each search stops at its depth or time limit, whichever comes first.';
  const engineBody = <>
    {full.offered && <>
      {t.sfEngine === 'Full' && full.state === 'absent' && <TweakButton label={`Download full Stockfish · ${MB} MB`} onClick={full.download}
        info={`Full Stockfish 19 is stronger than Lite, with the big neural network. It is a ${MB} MB download from unpkg.com, kept in this browser for next time and offline. Until it is downloaded, Lite runs.`} />}
      {full.state === 'downloading' && <>
        <div className="twk-note" role="status">Downloading full Stockfish · {sfMB(full.got)} of {MB} MB</div>
        <div className="twk-progress"><i style={{ width: `${(100 * full.got / full.total).toFixed(1)}%` }} /></div>
        <TweakButton secondary label="Cancel the download" onClick={full.cancel} />
      </>}
      {full.err && <div className="twk-note twk-err">{full.err}</div>}
      {full.state === 'ready' && (askRemove ? <>
        <div className="twk-note" role="alert">Remove the full engine? You’d need to download {MB} MB again to use it.</div>
        <div className="twk-pair">
          <TweakButton danger label="Remove" onClick={full.remove} />
          <TweakButton secondary label="Keep" onClick={() => setAskRemove(false)} />
        </div>
      </> : <TweakButton secondary label={`Remove the full engine download · ${MB} MB`} onClick={() => setAskRemove(true)}
        info={`Full Stockfish is kept in this browser (${MB} MB) and takes a few seconds to start. It reaches less depth than Lite in the same time but judges positions better.`} />)}
    </>}
    {/* the game-analysis limits apply only to a loaded game; the own-move ones only on the free board and your own moves in a replay */}
    {!board && <>
      <TweakSlider id="tw-sf-depth" label="Game analysis: depth" value={ES.game.depth} stops={window.AnalysisCore.DEPTHS} format={depthText} onChange={(v) => setTweak('sfDepth', v)} info={`For “Analyse with Stockfish”. ${stopsAt}`} />
      <TweakSlider id="tw-sf-time" label="Game analysis: time limit per position" value={ES.game.time_limit} stops={window.AnalysisCore.SECONDS} unit="s" onChange={(v) => setTweak('sfTime', v)} info={`For “Analyse with Stockfish”. ${stopsAt}`} />
    </>}
    <TweakSlider id="tw-sf-odepth" label="Your moves: depth" value={ES.own.depth} stops={window.AnalysisCore.DEPTHS} format={depthText} onChange={(v) => setTweak('sfOwnDepth', v)} info={`For the moves you play on the board${board ? ': on the free board every move is rated with these' : ''}. ${stopsAt}`} />
    <TweakSlider id="tw-sf-otime" label="Your moves: time limit per position" value={ES.own.time_limit} stops={window.AnalysisCore.SECONDS} unit="s" onChange={(v) => setTweak('sfOwnTime', v)} info={`For the moves you play on the board. ${stopsAt}`} />
    <TweakSelect id="tw-sf-lines" label="Your moves: lines" value={String(ES.own.lines)} options={window.AnalysisCore.LINES.map(String)} onChange={(v) => setTweak('sfLines', parseInt(v, 10))}
      info="Above one, Stockfish shows that many best moves, with an arrow each. Every line takes its share of the search, so each one goes less deep in the same time." />
    <TweakSelect id="tw-sf-hash" label="Hash table" value={ES.game.hash_mb + ' MB'} options={window.AnalysisCore.HASH_MB.map((x) => x + ' MB')} onChange={(v) => setTweak('sfHash', parseInt(v, 10))} info="Helps long searches; a phone may run out of memory." />
    {/* sfThreads null (the default): half the cores, at most 4 */}
    <TweakSelect id="tw-sf-threads" label="Threads" value={String(ES.game.threads)} options={window.AnalysisCore.threadChoices(threading.cores).map(String)} disabled={!threading.on} onChange={(v) => setTweak('sfThreads', parseInt(v, 10))}
      info="How many of your processor’s threads Stockfish uses. More threads let it look at more positions in the same time, which helps most in sharp positions, but keep your computer busier." />
    {!threading.on && <div className="twk-note">{threading.reason}</div>}
    {sfChanged && <TweakButton secondary label="Reset engine settings" onClick={() => SF_KEYS.forEach((k) => setTweak(k, window.TWEAK_DEFAULTS[k]))} />}
    {!board && (analysis.state === 'running'
      ? <>
        <div className="twk-note">Analysing {analysis.done} of {analysis.total} positions{analysis.etaSec != null ? ' · ' + fmtEta(analysis.etaSec) : ''}</div>
        <TweakButton secondary label="Stop the analysis" onClick={analysis.stop} />
      </>
      : <TweakButton disabled={engine.status === 'unavailable'} label={`${analysis.resumeAt ? `Resume analysis from move ${Math.floor((MV.ply0 + analysis.resumeAt) / 2) + 1}` : files.analysis ? 'Analyse again' : 'Analyse with Stockfish'} · about ${analysis.estimateMin} min`} onClick={analysis.start}
        info={`${engineLabel(ES.game.name)} runs in your browser. New settings apply to the next analysis${files.analysis ? ', which replaces this one' : ''}; a stopped analysis resumes with its original settings.`} />)}
    {!board && analysis.err && <div className="twk-note twk-err">{analysis.err}</div>}
    {!board && files.analysis && analysis.state !== 'running' && <TweakButton secondary label="Remove analysis" onClick={() => commit({ ...files, analysis: null, analysisName: null, evalSource: null })} />}
    <div className="twk-note">Stockfish is free software under the GPL-3.0; <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">source</a>.</div>
  </>;
  // picking Full before it is downloaded opens the menu, where its Download button is
  const engineMenu = { name: engineLabel(ES.game.name), body: engineBody,
    pick: full.offered ? { value: t.sfEngine === 'Full' ? 'Full' : 'Lite', options: [{ value: 'Lite', label: engineLabel(window.AnalysisCore.ENGINE_NAMES.lite) }, { value: 'Full', label: engineLabel(window.AnalysisCore.ENGINE_NAMES.full) + ' full' }],
      onChange: (v) => { setTweak('sfEngine', v); return v === 'Full' && full.state === 'absent'; } } : null };

  const gameName = (g) => (g.mode === 'stockfish' ? `Play vs Stockfish · you play ${g.you === 'w' ? 'White' : 'Black'}` : 'Play vs human');
  const boardStatus = board && board.game ? `${gameName(board.game)} · ${board.game.tc || 'no clock'} · ${board.steps.length} move${board.steps.length === 1 ? '' : 's'}${board.game.result ? ' · ' + window.PlayCore.resultText(board.game.result).score : ''}`
    : board && `Free board · ${board.fen === window.ChessCore.START_FEN ? 'from the starting position' : 'from a set-up position'} · ${board.steps.length} move${board.steps.length === 1 ? '' : 's'}`;
  const status = boardStatus || `${M.white.short} – ${M.black.short} · ${M.plies.length} plies` + (M.evalSource === 'analysis' ? ' · analysis evals' : M.evalSource === 'pgn' ? ' · PGN evals' : '') + (M.hasNotes ? ' · notes' : '') + (files.sample ? ' (sample)' : '') + ' · ' + fmtLen(TM.total);
  const shownErr = err || built.error;

  const newGroups = [{ label: 'Explore', items: [{ label: 'Starting position', run: newBoard }, { label: 'Edit position', run: editPosition }, { label: 'Paste PGN', run: pastePgn }, { label: 'Copy FEN', run: copyFen }, { label: 'Copy PGN', run: copyPgn }] },
    { label: 'Play', items: [{ label: 'Play vs human', run: playHuman }, { label: 'Play vs Stockfish', run: playSf }, { label: 'My games', run: myGames }] },
    // Ask Queen sits here on the wide layouts; the folded menu keeps it in its last row. The folded menu's shortcuts item is hidden on a touch screen
    { label: 'More', items: [{ label: 'Keyboard shortcuts', run: openKeys }, ...(!phone && !board ? [{ label: 'Ask Queen', cls: 'dock-queen', run: () => { setNewMenu(false); askQueen(); } }] : [])] }];
  const newItems = newGroups.map((g) => <div key={g.label} className={`dock-group dock-group-${g.label.toLowerCase()}`}>
    <span className="dock-menu-label">{g.label}</span>
    {g.items.map((it) => <button key={it.label} type="button" className={it.cls ? 'dock-btn ' + it.cls : 'dock-btn'} onClick={it.run}>{it.label}</button>)}
  </div>);
  const fsLabel = fullscreen.on ? 'Exit full screen' : 'Full screen';
  const dockItems = (
    <div id="dock-items" className="dock-items">
      {phone && <span className="dock-menu-status">{shownErr || status}</span>}
      <button type="button" className="dock-btn dock-primary" onClick={() => { setMenu(false); loadGame(); }}>Load game</button>
      {/* a list of starting points and tools in groups, each under its heading; on the phone they sit in the folded menu */}
      {phone ? newItems : (
        <div ref={newRef} className="dock-new">
          <button ref={newBtn} type="button" className="dock-btn" aria-expanded={newMenu} aria-controls="dock-new-items" onClick={() => { setNewMenu((m) => !m); setPanel(false); setQueenOpen(false); }}>Menu</button>
          {newMenu && (
            <div id="dock-new-items" className="dock-pop">
              {newItems}
            </div>
          )}
        </div>
      )}
      {/* Settings and Full screen are icons in every layout; on the phone they share the menu's last row with Ask Queen */}
      <div className="dock-icons">
      {phone && !board && <button type="button" className="dock-btn dock-queen" aria-expanded={queenOpen} onClick={() => { setMenu(false); askQueen(); }}>Ask Queen</button>}
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
    <div ref={dockRef} className={'pmenu' + (shownErr ? ' pmenu-err' : '') + (menu ? ' pmenu-open' : '')}>
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
      <CompositionStage clock={clockRef} nav={nav} forceVideo={video.busy} text={LayoutCore.textScale(t.textSize)} top={!net.online && <span className="net-chip" role="status" title={OFFLINE_NOTE}>Offline</span>} menu={<React.Fragment>{!(phone && short) && <SoundButton on={t.sound !== false} onChange={(v) => setTweak('sound', v)} />}{phone ? menuEl : deskDock}</React.Fragment>} onLayout={onLayout} scenes={scenes} playback={PLAYBACK} bg={C.bg} still={!!board || !!editing}>
        {editing
          ? <EditBoard setup={editing.setup} onChange={editTo} onDone={editDone} onCancel={editCancel} fenText={editing.text} onFenText={editText} fenMsg={editing.msg} doneLabel={editing.play ? 'Start game' : 'Done'} orient={t.flip ? 'b' : 'w'} nav={nav} overlay={panel || newMenu || menu || queenOpen} />
          : board
          ? <FreeBoard board={board} onChange={commitBoard} tw={t} sf={sf} nav={nav} orient={t.flip ? 'b' : 'w'} book={book && !board.game ? window.Openings.book() : null} />
          : <GameVideo M={MV} tw={video.busy ? { ...t, cameraPush: false, exporting: true } : t} d={TM.d} probe={probe} queen={queenArrow} nav={nav} scheme={scheme} sf={sf} orient={t.flip ? 'b' : 'w'} />}
      </CompositionStage>
      </EngineMenuContext.Provider>
      <input ref={inputRef} id="game-files" type="file" multiple accept=".pgn,.txt,.json,application/json,text/plain" hidden onChange={(e) => { loadFiles(e.target.files); e.target.value = ''; }} />
      {hf.note && (
        <div className="signin-note" role="status">{hf.note}<button type="button" className="twk-x" aria-label="Dismiss" onClick={hf.clearNote}>✕</button></div>
      )}
      {fenNote && !hf.note && (
        <div className="signin-note net-note fen-note" role="status">
          <span>{fenNote.ok ? `${fenNote.what || 'FEN'} copied` : `Copy this ${fenNote.what || 'FEN'}`}{(!fenNote.ok || !fenNote.what) && <>: <textarea className="fen-note-fen" readOnly rows={2} value={fenNote.fen} aria-label={fenNote.what || 'FEN'} onFocus={(e) => e.target.select()} /></>}</span>
          <button type="button" className="twk-x" aria-label="Dismiss" onClick={() => setFenNote(null)}>✕</button>
        </div>
      )}
      {net.note && !hf.note && !fenNote && (
        <div className={'signin-note net-note ' + (net.online ? 'net-note-on' : 'net-note-off')} role="status">{net.note}<button type="button" className="twk-x" aria-label="Dismiss" onClick={net.clearNote}>✕</button></div>
      )}
      {drag && (
        <div className="drop">
          <div className="drop-box">Drop a PGN<br /><span>with this page’s analysis or notes files too, if you have them · if dropping doesn’t work here, use Load game</span></div>
        </div>
      )}
      <ExportOverlay x={video} />
      {pgnOpen && <PgnDialog onLoad={pgnLoad} onClose={closePgn} />}
      {playOpen && <PlayDialog key={playOpen} mode={playOpen} setUpFen={board && board.fen !== window.ChessCore.START_FEN ? board.fen : null} clock={t.playClock} side={t.playSide} initial={playInit} onStart={playStart} onSetUp={playSetUp} onClose={closePlay} />}
      {keysOpen && <ShortcutsDialog onClose={closeKeys} />}
      {gamesOpen && <MyGamesDialog games={gamesOpen} current={board && window.PlayCore.inProgress(board) ? board.game.id : null} onReplay={replayGame} onResume={resumeGame} onDelete={deleteGame} onClose={closeGames} />}
      {leave && <LeaveDialog onStay={() => setLeave(null)} onLeave={() => { const run = leave.run; setLeave(null); keepLeft(board); run(); }} />}
      {queenOpen && !board && <QueenPanel M={M} Q={Q} hf={hf} probe={probe} onClose={closeQueen} onOverlay={setQueenArrow} onSave={saveQueen} left={queenLeft} />}
      <TweaksPanel open={panel} onClose={closePanel} tab={panelTab} onTab={setPanelTab} tabs={[
        { id: 'game', label: 'Game', body: <>
          <div className={shownErr ? 'twk-note twk-err' : 'twk-note'}>{shownErr || status}</div>
          <TweakButton label="Load game" onClick={loadGame} />
          {board && board.game && <div className="twk-note">{board.game.mode === 'stockfish' ? 'Stockfish 19 plays the other side at full strength (there is no strength setting) and quietly rates your moves; Analyse on the free board shows its eval once the game ends.' : 'Stockfish is off during a game; Analyse on the free board brings it back once the game ends.'}</div>}
          {!board && <div className="twk-note">Uses the PGN’s own evals (Lichess [%eval] or cutechess +0.25/20). Without them, run “Analyse with Stockfish” from the Analysis panel’s ☰ menu. Saved analysis, notes and Queen files load here too.</div>}
          {board && !window.PlayCore.inProgress(board) && <TweakButton label="Replay these moves as a game" disabled={!board.steps.length} onClick={boardAsGame} />}
          {board && !window.PlayCore.inProgress(board) && <div className="twk-note">{board.steps.length ? 'Opens every move on the board as a game: watch it, analyse it with Stockfish, and export it as a video or WebP. The board comes back with “Back to the free board”.' : 'Play some moves first; then they can be replayed and exported as a video.'}</div>}
          {board && files.lastGame && <TweakButton secondary label="Back to the loaded game" onClick={backToGame} />}
          {!board && files.fromBoard && <TweakButton secondary label="Back to the free board" onClick={() => { const b = window.BoardCore.restore(files.fromBoard); if (b) commitBoard(b); }} />}
          {!files.sample && <TweakButton secondary label="Back to sample game" onClick={() => guard(() => commit(SAMPLE))} />}
          {!board && M.canChooseSource && (
            <TweakRadio id="tw-source" label="Evaluations from" value={M.evalSource === 'pgn' ? 'PGN' : 'Analysis'} options={['Analysis', 'PGN']} onChange={(v) => commit({ ...files, evalSource: v === 'PGN' ? 'pgn' : 'analysis' })} />
          )}
          {!board && M.gameCount > 1 && (
            <TweakSelect id="tw-game" label="Game in PGN" value={String((files.gameIndex || 0) + 1)} options={Array.from({ length: M.gameCount }, (_, i) => String(i + 1))} onChange={(v) => commit({ ...files, gameIndex: +v - 1, analysis: null, analysisName: null })} />
          )}
          <TweakSection label="About">
            <div className="twk-note">This player is free software under the GPL-3.0-or-later; <a href="https://github.com/boneyland/chess-replay" target="_blank" rel="noopener">source on GitHub</a>.</div>
          </TweakSection>
          {/* every setting back to its default; the kept games, the loaded game, Queen's answers, sign-ins and the engine download stay, and so does the engine choice */}
          <TweakButton danger label="Reset all settings" onClick={() => { if (window.confirm('Reset every setting to its default? Your saved games and the downloaded engine are kept.')) Object.keys(window.TWEAK_DEFAULTS).filter((k) => k !== 'sfEngine').forEach((k) => setTweak(k, window.TWEAK_DEFAULTS[k])); }} />
        </> },
        { id: 'view', label: 'View', body: <>
          <TweakSection label="Appearance">
            <TweakRadio id="tw-scheme" label="Theme" value={t.scheme || 'Auto'} options={['Auto', 'Light', 'Dark']} onChange={(v) => setTweak('scheme', v)} />
            <TweakRadio id="tw-text-size" label="Text size" value={t.textSize || 'Default'} options={Object.keys(LayoutCore.TEXT_SIZES)} onChange={(v) => setTweak('textSize', v)} />
          </TweakSection>
          <TweakSection label="Board">
            {board && board.game ? (
              <div className="twk-note">{board.game.mode === 'stockfish'
                ? 'Drag or tap a piece to play a move; the board stays on your side, and Stockfish replies after a short pause. Take back and Resign are in the Game box.'
                : 'Drag or tap a piece to play a move; the board turns after each one, so the side to move plays from the bottom. Take back, Offer a draw and Resign are in the Game box.'}</div>
            ) : board ? <>
              <div className="twk-note">Drag or tap a piece to play a move, for either side; Stockfish rates each one.</div>
              <TweakToggle id="tw-flip" label="Flip board" value={!!t.flip} onChange={(v) => setTweak('flip', v)} />
            </> : <>
              <TweakToggle id="tw-flip" label="Flip board" value={!!t.flip} onChange={(v) => setTweak('flip', v)} />
              <TweakToggle id="tw-arrows" label="Best-move arrows" value={t.bestArrows} onChange={(v) => setTweak('bestArrows', v)} />
              <TweakToggle id="tw-push" label="Camera push on blunders" value={t.cameraPush} onChange={(v) => setTweak('cameraPush', v)} />
              <TweakToggle id="tw-glow" label="Red glow on blunders and mates" value={t.blunderGlow !== false} onChange={(v) => setTweak('blunderGlow', v)} />
              <TweakToggle id="tw-queen" label="Queen in the video" info="Shows Queen’s comments and lines on the moves it has analysed; those moves stay on screen longer." value={queenInVideo} onChange={(v) => setTweak('queenInVideo', v)} />
            </>}
          </TweakSection>
          {!board && <TweakSection label="Pace">
            <div className="twk-note">Video length {fmtLen(TM.total)}{TM.capped ? ' (capped at 5:00)' : ''}</div>
            <TweakSlider id="tw-spm" label="Seconds per move" value={t.secondsPerMove} min={0.5} max={4} step={0.1} unit="s" onChange={(v) => setTweak('secondsPerMove', v)} />
            <TweakSlider id="tw-hold" label="Extra hold on !/? moves and uncommented mates" value={t.keyHold} min={0} max={6} step={0.5} unit="s" onChange={(v) => setTweak('keyHold', v)} />
            <TweakToggle id="tw-fast" label="Faster opening" value={t.fastOpening} onChange={(v) => setTweak('fastOpening', v)} />
          </TweakSection>}
        </> },
        { id: 'online', label: 'Online', body: <>
          <TweakToggle id="tw-tablebase" label="Endgame tablebase (7 pieces or fewer)" info="Positions with 7 pieces or fewer go to Lichess’s tablebase (tablebase.lichess.ovh) for the result with best play and every move ranked by it: in the Analysis panel and the eval bar (tagged TB), while the replay is paused and on the free board, never during a game. “Analyse with Stockfish” takes them from it too, and rates those moves by whether they keep the win or the draw. Nothing is sent with this off." value={t.tablebase !== false} onChange={(v) => setTweak('tablebase', v)} />
          <div className="twk-keep">
            <TweakToggle id="tw-cloud" label="Lichess cloud evaluation" info="The positions Stockfish searches for your moves (the free board, moves you try in the replay) also go to Lichess’s cloud (lichess.org/api/cloud-eval), which has deep evaluations of many positions: whichever answer comes first shows, the deeper one replacing it, labelled “cloud depth”; Go deeper on a move of a loaded analysis asks it too. Never for “Analyse with Stockfish” or in a game. Nothing is sent with this off." value={t.cloudEval === true} onChange={(v) => setTweak('cloudEval', v)} />
            {t.cloudEval === true && <TweakToggle id="tw-cloud-prefer" label="Prefer cloud" info="Skips the search in your browser where the cloud is at least as deep as its depth limit (30 with No limit)." value={t.cloudPrefer === true} onChange={(v) => setTweak('cloudPrefer', v)} />}
          </div>
          <ExplorerSettings t={t} setTweak={setTweak} />
        </> },
        !board && { id: 'commentary', label: 'Commentary', body: <>
          <TweakToggle id="tw-comm" label="Show commentary" value={showCommentary} onChange={(v) => setTweak('commentary', v)} />
          {showCommentary && <>
            {sources.includes('pgn') && <TweakToggle id="tw-comm-pgn" label="From the PGN" value={sayFrom.pgn} onChange={(v) => setTweak('commentPgn', v)} />}
            {sources.includes('notes') && <TweakToggle id="tw-comm-notes" label={files.sample && !files.notes ? 'From the sample notes' : 'From the notes file'} value={sayFrom.notes} onChange={(v) => setTweak('commentNotes', v)} />}
            {queenSays && <TweakToggle id="tw-comm-queen" label="From Queen" value={sayFrom.queen} onChange={(v) => setTweak('commentQueen', v)} />}
            {sources.length + (queenSays ? 1 : 0) > 1 && <div className="twk-note">Where several comment on a move, the first one on wins: notes file, then the PGN; Queen’s sentence follows.</div>}
          </>}
          {browserAnalysis && <TweakButton secondary label="Save analysis" onClick={saveAnalysis} />}
          <TweakButton secondary label="Save as annotated PGN" onClick={savePgn} />
        </> },
        !board && { id: 'export', label: 'Export', body: <>
          <TweakRadio id="tw-format" label="Export as" value={exportFormat} options={EXPORT_FORMATS} onChange={(v) => setTweak('exportFormat', v)} />
          {webp && <>
            <TweakSelect id="tw-webp-width" label="WebP width" value={webpPx(webpWidth)} options={webpWidths.map(webpPx)} onChange={(v) => setTweak('webpWidth', webpWidths.find((x) => webpPx(x) === v))} />
            <TweakSlider id="tw-webp-q" label="WebP quality" value={webpQuality} min={WEBP_QUALITY.min} max={WEBP_QUALITY.max} step={WEBP_QUALITY.step} format={(v) => (v >= 100 ? 'Lossless' : v)} onChange={(v) => setTweak('webpQuality', v)} />
          </>}
          {!webp && <TweakSelect id="tw-mp4-q" label="MP4 quality" value={mp4Quality} options={MP4_QUALITIES} onChange={(v) => setTweak('mp4Quality', v)} />}
          {!webp && <TweakToggle id="tw-mp4-vfr" label="Variable frame rate" info="A frame that doesn’t change (a pause, the title and end cards) isn’t encoded: the frame before is held for its time. The frame rate is then the most frames a second a move’s animation gets. Some players and editors seek a variable-rate video less smoothly." value={mp4Vfr} onChange={(v) => setTweak('mp4Vfr', v)} />}
          <TweakSelect id="tw-fps" label={!webp && mp4Vfr ? 'Export frame rate (at most)' : 'Export frame rate'} value={exportFps + ' fps'} options={EXPORT_FPS_OPTIONS.map((f) => f + ' fps')} onChange={(v) => setTweak('exportFps', parseInt(v, 10))} />
          <div className="twk-pair">
            <TweakSelect id="tw-clip-from" label="From" aria="Export from" value={clipFromOpts.find((o) => o.i === clipFrom).s} options={clipFromOpts.map((o) => o.s)} onChange={(v) => setClip((c) => ({ ...c, from: clipFromOpts.find((o) => o.s === v).i }))} />
            <TweakSelect id="tw-clip-to" label="To" aria="Export to" value={clipToOpts.find((o) => o.i === clipTo).s} options={clipToOpts.map((o) => o.s)} onChange={(v) => setClip((c) => ({ ...c, to: clipToOpts.find((o) => o.s === v).i }))} />
          </div>
          <TweakButton label={`${webp ? 'Export animated WebP (' : 'Export video (MP4, '}${!webp && mp4Vfr ? 'up to ' : ''}${exportFps} fps${!webp && mp4Vfr ? ', variable' : ''}, ${fmtLen(clipT.end - clipT.start)})`} disabled={video.busy} onClick={exportVideo} />
          <div className="twk-note">Renders every frame in this tab: about {fmtLen(Math.ceil((clipT.end - clipT.start) * exportFps * 0.04))} for {clipSuffix ? 'these moves' : 'this game'}, longer on a phone. Higher frame rates are smoother but slower. Each move’s clip runs from just before it until the board settles. {webp ? 'No sound, and it loops; a smaller width or quality makes a smaller file, and Lossless a much larger one.' : 'Includes move sounds when on; a lower quality makes a smaller file.'} No camera push.</div>
        </> },
        { id: 'sound', label: 'Sound', body: <>
          <TweakToggle id="tw-sound" label="Move sounds" value={t.sound !== false} onChange={(v) => setTweak('sound', v)} />
          <TweakSelect id="tw-sset" label="Sound set" value={soundSet} options={window.Sfx.SETS} onChange={(v) => { setTweak('soundSet', v); sfxPlayer.play(v, ['move'], soundVolume); }} />
          <TweakSlider id="tw-vol" label="Volume" value={soundVolume} min={0} max={100} step={5} unit="%" onChange={(v) => { setTweak('soundVolume', v); sfxPlayer.play(soundSet, ['move'], v); }} />
          <div className="twk-note">The Lichess sets are by <a href="https://github.com/Enigmahack" target="_blank" rel="noopener">Enigmahack</a>, from <a href="https://github.com/lichess-org/lila" target="_blank" rel="noopener">Lichess’s source</a>, under the AGPL-3.0-or-later. Wood is made in your browser.</div>
        </> },
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
      try { Object.keys(localStorage).filter((k) => k.startsWith('chess-video.') && k !== AUTH_STORE && k !== LI_AUTH_STORE && k !== GAMES).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
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
