const MOTION = { enter: Easing.easeOutCubic, move: Easing.easeInOutCubic, pop: Easing.easeOutBack };
const lerp = (a, b, k) => a + (b - a) * k;
const cl01 = (v) => clamp(v, 0, 1);
const { winChance, plyCp } = window.ChessCore;

// Frame palettes; light-theme text colours are at least 4.5:1 on the panel. Board squares and the eval bar's white/black halves are the sides' colours and stay put.
const PALETTES = {
  dark: {
    bg: '#13100f', panel: '#1b1715', line: 'rgba(255,236,214,0.09)', ctlLine: 'rgba(255,236,214,0.4)', ink: '#efe8de', dim: '#9a8e82',
    light: '#f0d9b5', dark: '#b58863', last: '#e3b55b', engine: '#5c5c5c',
    best: '#62c483', inaccuracy: '#e6c14d', mistake: '#ec9442', blunder: '#e4553f', none: '#efe8de',
    good: '#5aa9e6', brilliant: '#3cc7bd', interesting: '#c98be0', queen: '#e0609f',
    off: '#2a2320', scrim: '19,16,15', haloBoard: '0 0 3px rgba(255,236,214,0.5), 0 0 16px rgba(255,236,214,0.26), 0 0 44px rgba(255,236,214,0.18), ', halo: '0 0 3px rgba(255,236,214,0.3), 0 0 14px rgba(255,236,214,0.14), 0 0 36px rgba(255,236,214,0.1), ', rim: 'drop-shadow(0 0 1px rgba(239,232,222,0.95)) drop-shadow(0 0 1px rgba(239,232,222,0.6))',
  },
  light: {
    bg: '#f2ece3', panel: '#fbf7f1', line: 'rgba(60,40,20,0.13)', ctlLine: 'rgba(60,40,20,0.5)', ink: '#2a211b', dim: '#6b5f53',
    light: '#f0d9b5', dark: '#b58863', last: '#8a5e15', engine: '#5c5c5c',
    best: '#237a46', inaccuracy: '#8a6a0a', mistake: '#b05616', blunder: '#c63b29', none: '#2a211b',
    good: '#2a6fae', brilliant: '#1a7a73', interesting: '#8f4fab', queen: '#c03f7c',
    off: '#e4dbcd', scrim: '242,236,227', halo: '', haloBoard: '', rim: 'none',
  },
};
const C = { ...PALETTES.dark };
const setPalette = (mode) => Object.assign(C, PALETTES[mode] || PALETTES.dark);
const SANS = '"IBM Plex Sans", system-ui, sans-serif';
const MONO = '"JetBrains Mono", monospace';
const SERIF = '"Instrument Serif", serif';
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const CLASS_LABEL = { best: 'Best move', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', none: 'Playable', good: 'Good move', brilliant: 'Brilliant', interesting: 'Interesting' };
const clsColor = (cls) => C[cls] || C.ink;
// The board looks the same in both themes: what's drawn on it (highlights, badges, arrows, check glow) uses these
const BOARD = PALETTES.dark;
const boardCls = (cls) => BOARD[cls] || BOARD.last;
// A move's SAN chip, light for White's moves and dark for Black's in both themes (like the board's squares): the move
// list's and a line's at 16 px; rowChip, the explorers' rows, at 17 px and one width, so their columns line up. extra
// overrides any part (a flagged move's border, the current move's weight)
const chipEdge = (white) => `1px solid ${white ? 'rgba(60,40,20,0.22)' : 'rgba(255,236,214,0.22)'}`;
const moveChip = (white, extra) => ({ padding: `${tx(2)}px ${tx(8)}px`, borderRadius: 2, font: `600 ${tx(16)}px ${MONO}`, background: white ? '#f1ebe1' : '#2a2320', color: white ? '#15100d' : '#efe8de', border: chipEdge(white), ...extra });
const rowChip = (white, extra) => moveChip(white, { flex: 'none', minWidth: tx(58), boxSizing: 'border-box', textAlign: 'center', font: `600 ${tx(17)}px ${MONO}`, ...extra });
const LAST_MOVE = 'rgba(155,199,0,0.41)'; // Lichess's last-move tint, clear on both square colours
// the selected piece's square (a board index, or null), in the last move's tint under the pieces
const selSquare = (sel) => (sel == null ? null : <div key="sel" data-sel style={{ position: 'absolute', left: idxXY(sel)[0] * SQ, top: idxXY(sel)[1] * SQ, width: SQ, height: SQ, background: LAST_MOVE }} />);

const SQ = 96, BW = SQ * 8;
// The page's boxes in real CSS pixels (LayoutCore), for the window's size and the view; the board is drawn as a 768 px
// picture scaled into its box (BoardSpace). TX: panel and player-bar text sizes are written at the old 1920 frame's
// sizes, times 0.8 and the viewer's text size, through tx().
let L = window.LayoutCore.compute({ w: 1440, h: 900 }), TX = 0.8, TEXT = 1;
const setLayout = (frame, view = 'replay') => {
  L = window.LayoutCore.compute({ w: frame.w, h: frame.h, text: frame.text, view, video: frame.video, cols: frame.cols, dock: frame.dock, vw: frame.vw, vh: frame.vh });
  TEXT = L.text; TX = 0.8 * TEXT; // the viewer's text size, times the device tier's (smaller on phones and tablets)
};
const tx = (px) => Math.round(px * TX * 10) / 10;
// a text's width in px in a CSS font, measured on a canvas (in the page's fonts once they've loaded), to fit text to a box
const textWidth = (() => {
  let cx = null;
  return (txt, font) => { cx = cx || document.createElement('canvas').getContext('2d'); cx.font = font; return cx.measureText(txt).width; };
})();
// the text-bearing padding inside every panel: the device tier's (tighter on phones and tablets)
const panelPad = () => `${tx(L.pad[0])}px ${tx(L.pad[1])}px`;
// the move and eval headline in Analysis (and the free board's and a game's)
const HEADLINE = 28;
// a short Analysis panel (one column below a desktop, a phone held sideways) packs tighter: a smaller headline, about
// half the vertical spacing, and thinner padding at its top and bottom (Moves and Commentary take the padding and the
// title row's gap too: Panel's tight)
const tightAn = () => L.tier !== 'desktop' && (L.cols === 1 || L.tier === 'phone');
const headline = () => tx(tightAn() ? 22 : HEADLINE);
const anGap = (px) => tx(tightAn() ? Math.round(px / 2) : px);
// A paused one-column page flows (L.flow): the panels stack under the board as a column, each as tall as its contents,
// and the page scrolls. flowStyle() makes a view's container that column (its absolutely placed board and bars stay
// out of it); useFlowHeight reports how tall it came out, so the stage can scroll that far.
const flowStyle = () => (L.flow ? { display: 'flex', flexDirection: 'column', gap: L.flow.gap, padding: `${L.flow.top}px ${L.flow.x}px 0`, boxSizing: 'border-box' } : null);
function useFlowHeight(frame, ref) {
  const flow = !!L.flow, h = L.h, bottom = L.flow ? L.flow.bottom : 0;
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!flow || !el) { frame.setContentH(h); return; }
    const measure = () => {
      let end = 0;
      for (const c of el.children) if (getComputedStyle(c).position !== 'absolute') end = Math.max(end, c.offsetTop + c.offsetHeight);
      frame.setContentH(Math.ceil(end + bottom));
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  });
}
// The board's own 768 px space, scaled to L.board: the board, its touch layer, arrows and badges position from 0,0 in it
// onStep(±1), where there are moves to step through: the wheel over the board steps them (BoardCore.wheel). The listener
// isn't passive, so the page doesn't scroll under the board; a pinch (ctrl + wheel) or a sideways scroll is left alone
function BoardSpace({ children, onStep }) {
  const el = React.useRef(null), step = React.useRef(onStep), on = !!onStep;
  step.current = onStep;
  React.useEffect(() => {
    const node = el.current;
    if (!on || !node) return;
    let w = window.BoardCore.wheelStart();
    const onWheel = (e) => {
      if (e.ctrlKey || !e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const r = window.BoardCore.wheel(w, e.deltaY, e.deltaMode, e.timeStamp);
      w = r.w;
      if (r.d && step.current) step.current(r.d);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [on]);
  return <div ref={el} className="part-board" style={{ position: 'absolute', left: L.board.x, top: L.board.y, width: BW, height: BW, transform: `scale(${L.board.size / BW})`, transformOrigin: '0 0' }}>{children}</div>;
}

// The side at the bottom ('b' turns the board round). view() maps a board column and row (0 = a, 0 = rank 8) to where it
// is drawn, and back: every square-to-pixel conversion goes through it.
let ORIENT = 'w';
const setOrient = (o) => { ORIENT = o === 'b' ? 'b' : 'w'; };
const view = (x, y) => (ORIENT === 'b' ? [7 - x, 7 - y] : [x, y]);
const sqXY = (sq) => view(sq.charCodeAt(0) - 97, 8 - +sq[1]);
const idxXY = (i) => view(i % 8, Math.floor(i / 8));
const sqC = (sq) => { const [x, y] = sqXY(sq); return [x * SQ + SQ / 2, y * SQ + SQ / 2]; };
const label = (M, i) => `${window.ChessCore.moveNo(M.ply0 + i)} ${M.plies[i].san}${M.plies[i].mark || ''}`;
const fmtEval = (p) => {
  if (!p) return '0.00';
  if (p.checkmate) return p.side === 'w' ? '1-0' : '0-1';
  if (p.won) return p.won === 'w' ? '1-0' : '0-1'; // a tablebase win with no distance to mate
  if (p.mate != null) return (p.mate > 0 ? 'M' : '−M') + Math.abs(Math.round(p.mate));
  const v = plyCp(p) / 100; return (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + Math.abs(v).toFixed(2);
};
const fmtClock = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60), x = Math.floor(s % 60); return s < 20 ? `0:${String(Math.floor(s)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}` : `${m}:${String(x).padStart(2, '0')}`; };
// the piece set drawn (PieceSets), which GameApp sets on each render before the views below it draw (usePieceSet)
let PIECE_SET = 'cburnett';
const img = (color, type) => window.PieceSets.url(PIECE_SET, color + type.toUpperCase());
// The set to draw: the viewer's choice once its pictures have loaded (the last set drawn until then, so a switch never
// flashes another). failed: the choice couldn't be loaded (offline before it was ever kept); choosing it again, or the
// next visit, tries again.
function usePieceSet(chosen) {
  const PS = window.PieceSets, want = PS.valid(chosen);
  const [failed, setFailed] = React.useState(null);
  const [, bump] = React.useReducer((n) => n + 1, 0);
  const last = React.useRef(PS.DEFAULT);
  React.useEffect(() => {
    if (PS.ready(want)) return;
    let live = true;
    PS.load(want).then((ok) => { if (live) { setFailed(ok ? null : want); bump(); } });
    return () => { live = false; };
  }, [want]);
  if (PS.ready(want)) last.current = want;
  PIECE_SET = last.current;
  return { shown: last.current, failed: failed === want ? want : null };
}
// the board drawn (BoardThemes): the squares' colours (null under a picture) and the coordinates'; for a picture board,
// its picture (src) and the CSS filter it is shown through (css). Set by GameApp as PIECE_SET is (useBoardLook)
let BOARD_LOOK = { ...window.BoardThemes.colours('brown'), src: null, css: 'none' };
// The board to draw: a flat one at once. A picture board is lila's file through a CSS filter on the page, so it follows
// the sliders at once and never swaps pictures (a swap showed as a refresh when a slider stopped); a video export draws
// the picture worked out through the sliders instead (BoardThemes.render, which exportVideo waits for), as the export
// can't paint a filter. Until a newly chosen board's file has loaded, the last board. failed: it couldn't be loaded.
function useBoardLook(theme, adj, exporting) {
  const BT = window.BoardThemes, id = BT.valid(theme), a = BT.adjust(adj), want = [id, a.brightness, a.contrast, a.hue].join('/');
  const pic = !!BT.byId(id).file;
  const [failed, setFailed] = React.useState(null);
  const [, bump] = React.useReducer((n) => n + 1, 0);
  const last = React.useRef(BOARD_LOOK);
  const need = pic && (!BT.loaded(id) || (exporting && !BT.rendered(id, a)));
  React.useEffect(() => {
    if (!need) return;
    let live = true;
    (exporting ? BT.render(id, a) : BT.preload(id)).then(() => { if (live) { setFailed(null); bump(); } }, () => { if (live) setFailed(want); });
    return () => { live = false; };
  }, [want, need, exporting]);
  if (!pic) last.current = { ...BT.colours(id, a), src: null, css: 'none' };
  else if (exporting && BT.rendered(id, a)) last.current = { ...BT.colours(id, a), src: BT.rendered(id, a), css: 'none' };
  else if (BT.loaded(id)) last.current = { ...BT.colours(id, a), src: BT.url(id), css: BT.css(a) };
  BOARD_LOOK = last.current;
  return { failed: failed === want };
}

function simulate(M) {
  const board = {}, pieces = [];
  M.start.pos.b.forEach((ch, i) => {
    if (!ch) return;
    const sq = window.ChessCore.sqName(i);
    const p = { id: sq, color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase(), home: sq, track: [], captured: -1, promo: null };
    pieces.push(p); board[sq] = p;
  });
  const step = (from, to, i) => {
    const p = board[from];
    if (board[to]) board[to].captured = i;
    board[to] = p; delete board[from];
    p.track.push({ ply: i, from, to });
    return p;
  };
  M.plies.forEach((pl, i) => {
    const f = pl.uci.slice(0, 2), t = pl.uci.slice(2, 4), p = board[f];
    if (p.type === 'p' && f[0] !== t[0] && !board[t]) { const epSq = t[0] + f[1]; if (board[epSq]) { board[epSq].captured = i; delete board[epSq]; } }
    step(f, t, i);
    if (p.type === 'k' && Math.abs(f.charCodeAt(0) - t.charCodeAt(0)) === 2) { const r = t[1]; if (t[0] === 'g') step('h' + r, 'f' + r, i); else step('a' + r, 'd' + r, i); }
    if (pl.uci.length === 5) p.promo = { ply: i, type: pl.uci[4] };
  });
  return pieces;
}

// ---------- schedule ----------
function useSchedule(M, CUES, d) {
  return React.useMemo(() => window.ChessCore.schedule(M, CUES, d), [M, CUES, d]);
}
const lastPly = (T, S) => { let k = -1; for (let i = 0; i < S.N; i++) { if (T >= S.tp[i]) k = i; else break; } return k; };
const cpOf = (M, i) => (i < 0 ? M.evalStart : plyCp(M.plies[i]));
// a game without an analysis: no evals and no best lines (a PGN's own evals count as one)
const bareGame = (M) => !M.hasEval && !M.plies.some((p) => p.best);
// a move on screen for under a second (a short Seconds per move, or a long game squeezed into the video) shows its
// analysis at once: the eval count and the panel's fade would end too late to read
const QUICK_MOVE = 1;
const quickMove = (S, c) => c + 1 < S.N && S.tp[c + 1] - S.tp[c] < QUICK_MOVE;
function evalNow(M, T, S) {
  const c = lastPly(T, S);
  if (c < 0) return { c, cp: M.evalStart, k: 1 };
  const k = quickMove(S, c) ? 1 : MOTION.move(cl01((T - S.tp[c] - S.md[c] * 0.3) / 0.55));
  return { c, k, cp: lerp(cpOf(M, c - 1), cpOf(M, c), k) };
}

// ---------- shared ----------
// One line that scrolls sideways when it's too long (a finger or trackpad swipe), fading out at an edge with more past it
function SideScroll({ style, children }) {
  const ref = React.useRef(null);
  const [more, setMore] = React.useState('');
  const check = () => { const el = ref.current; if (el) setMore((el.scrollLeft > 1 ? 'l' : '') + (el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ? 'r' : '')); };
  React.useLayoutEffect(check);
  const fade = more ? `linear-gradient(to right, ${more.includes('l') ? 'transparent, #000 32px' : '#000'}, ${more.includes('r') ? '#000 calc(100% - 32px), transparent' : '#000'})` : 'none';
  return (
    <span ref={ref} onScroll={check}
      style={{ ...style, whiteSpace: 'nowrap', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', touchAction: 'pan-x pan-y', WebkitMaskImage: fade, maskImage: fade }}>{children}</span>
  );
}
// info: a node beside the title (an InfoTip); not part of the title's own text, which the live tests look panels up by
// extra: a node after right that never scrolls with it (Analysis: Go deeper beside the search's depth)
// head: the title row's own contents, in place of title, right and extra (the Analysis panel's)
// part: the panel's name, as the class part-<part> (docs/parts.md)
// progress: 0–1, drawn along the top border (the Analysis panel's while Stockfish searches for it, else while the game
// analysis runs); null draws none
function Panel({ box, part, title, info, right, extra, head, a, style, progress, tight, children }) {
  const { x, y, w, h } = box;
  // the entrance slide only while it fades in (a video's): a settled panel has no transform. A flowing panel (a paused
  // one-column page) takes its place in the view's column, as tall as its contents
  const place = box.flow ? { position: 'relative', order: box.order, flex: 'none', boxSizing: 'border-box', borderRadius: 4, overflow: 'hidden' }
    : { position: 'absolute', left: x, top: y, width: w, height: h, boxSizing: 'border-box', borderRadius: 4, opacity: a, ...(a < 1 && { transform: `translateY(${(1 - a) * 18}px)` }), overflow: 'hidden' };
  // the progress line goes over the panel's top edge: beside a placed panel, inside a flowing one
  const over = box.flow ? { position: 'absolute', left: 0, right: 0, top: 0, height: 3, pointerEvents: 'none' } : { ...place, pointerEvents: 'none' };
  // a box whose contents can outgrow it scrolls, and hands the wheel or finger on to the page at its ends
  return (
    <>
    <div className={part && 'part-' + part} style={{ ...place, background: C.panel, border: `1px solid ${C.line}`, boxShadow: `${C.halo}0 0 0 transparent`, padding: tight && tightAn() ? `${tx(L.pad[0] * 0.6)}px ${tx(L.pad[1])}px` : panelPad(), ...(box.scroll && { overflowY: 'auto', scrollbarWidth: 'thin' }), ...style }}>
      {(title || head) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: tx(16), font: `600 ${tx(16)}px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.dim, marginBottom: tight ? anGap(12) : tx(12) }}>
          {head || <><span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>{info && <span style={{ flex: 'none', marginLeft: -tx(8) }}>{info}</span>}<SideScroll style={{ minWidth: 0, flex: 1, textAlign: 'right', letterSpacing: '0.04em' }}>{right}</SideScroll>{extra}</>}
        </div>
      )}
      {children}
      {box.flow && progress != null && (
        <div style={over}>
          <div style={{ height: 3, width: `${(cl01(progress) * 100).toFixed(1)}%`, background: C.best, transition: progress > 0 ? 'width 0.3s linear' : 'none' }} />
        </div>
      )}
    </div>
    {/* over the panel rather than in it, so it covers the border and never scrolls with the contents */}
    {!box.flow && progress != null && (
      <div style={over}>
        <div style={{ height: 3, width: `${(cl01(progress) * 100).toFixed(1)}%`, background: C.best, transition: progress > 0 ? 'width 0.3s linear' : 'none' }} />
      </div>
    )}
    </>
  );
}

// Optional text at the bottom of a Panel: hidden unless it fits whole above the panel's bottom padding
function FitOrHide({ style, children }) {
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    const el = ref.current, panel = el && el.offsetParent;
    if (!panel) return;
    // a flowing panel grows to fit, so it always fits there; elsewhere a pixel allows for the offsets' rounding (hidden,
    // it still holds its line, which showed as an empty line under the Analysis panel's lines)
    const fits = !!L.flow || el.offsetTop + el.offsetHeight <= panel.clientHeight - parseFloat(getComputedStyle(panel).paddingBottom) + 1;
    el.style.visibility = fits ? '' : 'hidden';
  });
  return <span ref={ref} style={style}>{children}</span>;
}

// ---------- board ----------
// a press or drag selects no text here (the board's pieces and coordinates, the eval bar and graph, the panels' hints),
// nor drags a piece's image out
const NO_SELECT = { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' };
function Piece({ p, T, S }) {
  let [x, y] = sqXY(p.home), lift = 0;
  for (const mv of p.track) {
    const t0 = S.tp[mv.ply];
    if (T < t0) break;
    const k = cl01((T - t0) / S.md[mv.ply]);
    const a = sqXY(mv.from), b = sqXY(mv.to), e = MOTION.move(k);
    x = lerp(a[0], b[0], e); y = lerp(a[1], b[1], e); lift = Math.sin(Math.PI * k);
  }
  let o = 1, sc = 1;
  if (p.captured >= 0) {
    const k = cl01((T - S.tp[p.captured] - S.md[p.captured] * 0.6) / 0.2);
    o = 1 - k; sc = 1 - 0.35 * MOTION.enter(k);
  }
  if (o <= 0) return null;
  const type = p.promo && T >= S.tp[p.promo.ply] + S.md[p.promo.ply] ? p.promo.type : p.type;
  return (
    <div style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, opacity: o, zIndex: lift > 0 ? 5 : 2, transform: `translateY(${-lift * 10}px) scale(${sc * (1 + lift * 0.08)})`, filter: `drop-shadow(0 ${2 + lift * 10}px ${2 + lift * 8}px rgba(0,0,0,${0.25 + lift * 0.2}))` }}>
      <img src={img(p.color, type)} alt="" style={{ width: SQ, height: SQ, display: 'block' }} />
    </div>
  );
}

// thin: a lesser engine line's arrow
function Arrow({ from, to, color, a, grow, thin }) {
  const [x1, y1] = sqC(from), [x2, y2] = sqC(to);
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
  const L = (d - 16) * grow, head = thin ? 26 : 34, sw = thin ? 4.5 : 8, hw = thin ? 15 : 22;
  const bx = x1 + ux * (L - head), by = y1 + uy * (L - head), tx = x1 + ux * L, ty = y1 + uy * L;
  const pts = [[x1 + nx * sw, y1 + ny * sw], [bx + nx * sw, by + ny * sw], [bx + nx * hw, by + ny * hw], [tx, ty], [bx - nx * hw, by - ny * hw], [bx - nx * sw, by - ny * sw], [x1 - nx * sw, y1 - ny * sw]].map((p) => p.join(',')).join(' ');
  return <polygon points={pts} fill={color} opacity={0.85 * a} />;
}

// the 64 squares with their rank and file coordinates, through view() (a flipped board turns them); the replay's
// Board and the free board both draw these
function boardSquares() {
  const B = BOARD_LOOK, sq = [];
  // a picture board lies under the squares, which are then only where the coordinates go (a flipped board's picture
  // stays put, as Lichess's does)
  if (B.src) sq.push(<img key="pic" src={B.src} alt="" draggable={false} style={{ position: 'absolute', left: 0, top: 0, width: BW, height: BW, display: 'block', filter: B.css }} />);
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const light = (r + f) % 2 === 0, [sf, sr] = view(f, r); // the square drawn here
    if (B.src && f !== 0 && r !== 7) continue;
    sq.push(
      <div key={r * 8 + f} style={{ position: 'absolute', left: f * SQ, top: r * SQ, width: SQ, height: SQ, background: B.src ? 'transparent' : light ? B.light : B.dark }}>
        {f === 0 && <span style={{ position: 'absolute', left: 6, top: 4, font: `600 16px ${MONO}`, color: light ? B.onLight : B.onDark }}>{8 - sr}</span>}
        {r === 7 && <span style={{ position: 'absolute', right: 6, bottom: 3, font: `600 16px ${MONO}`, color: light ? B.onLight : B.onDark }}>{String.fromCharCode(97 + sf)}</span>}
      </div>
    );
  }
  return sq;
}

// lines: the engine lines' arrows on the viewer's own line (lineArrows)
// sel: the square of the piece picked to move (useBoardInput)
function Board({ M, T, S, a, arrows, pieces, queen, vline, hide, lines, sel, idle }) {
  const c = lastPly(T, S);
  const sq = boardSquares();
  if (vline) return <LineBoard a={a} sq={sq} v={vline} hide={hide} arrows={lines} sel={sel} />;
  const over = [];
  let badge = null, best = null;
  if (c >= 0) {
    const P = M.plies[c], marked = !!P.mark;
    const k = cl01((T - S.tp[c]) / 0.2);
    [P.uci.slice(0, 2), P.uci.slice(2, 4)].forEach((s, j) => {
      const [x, y] = sqXY(s);
      over.push(<div key={'h' + j} style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, background: marked ? boardCls(P.cls) : LAST_MOVE, opacity: (marked ? 0.6 : 1) * k }} />);
    });
    if (P.checkSq) {
      const [x, y] = sqXY(P.checkSq);
      over.push(<div key="chk" style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, opacity: cl01((T - S.tp[c] - S.md[c]) / 0.2), background: `radial-gradient(circle, ${BOARD.blunder} 0%, rgba(228,85,63,0.55) 40%, rgba(228,85,63,0) 72%)` }} />);
    }
    if (marked || P.checkmate) {
      const kb = cl01((T - S.tp[c] - S.md[c]) / 0.35);
      const [x, y] = sqXY(P.checkmate ? P.checkSq : P.uci.slice(2, 4));
      badge = (
        <div style={{ position: 'absolute', left: x * SQ + SQ - 30, top: y * SQ - 12, minWidth: 42, height: 42, padding: '0 7px', boxSizing: 'border-box', borderRadius: 21, background: P.checkmate ? BOARD.blunder : boardCls(P.cls), color: '#15100d', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 20px ${MONO}`, zIndex: 8, boxShadow: '0 4px 14px rgba(0,0,0,0.45)', transform: `scale(${MOTION.pop(kb)})`, opacity: kb > 0 ? 1 : 0 }}>{P.checkmate ? '#' : P.mark}</div>
      );
    }
    if (arrows && P.best && ['inaccuracy', 'mistake', 'blunder'].includes(P.cls)) {
      const tA = S.tp[c] + S.md[c] + 0.45, tE = c + 1 < S.N ? S.tp[c + 1] - 0.1 : Infinity;
      const al = cl01((T - tA) / 0.25) * (1 - cl01((T - tE) / 0.2));
      if (al > 0) best = <Arrow from={P.best.uci.slice(0, 2)} to={P.best.uci.slice(2, 4)} color={BOARD.best} a={al} grow={MOTION.enter(cl01((T - tA) / 0.45))} />;
    }
  }
  return (
    <div onDragStart={(e) => e.preventDefault()} style={{ ...NO_SELECT, position: 'absolute', left: 0, top: 0, width: BW, height: BW, borderRadius: 2, overflow: 'hidden', boxShadow: `${C.haloBoard}0 4px 12px rgba(0,0,0,0.28)`, opacity: a, transform: `scale(${lerp(0.96, 1, a)})` }}>
      {sq}{over}{selSquare(sel)}
      {pieces.map((p) => <Piece key={p.id} p={p} T={T} S={S} />)}
      <svg width={BW} height={BW} style={{ position: 'absolute', left: 0, top: 0, zIndex: 6, pointerEvents: 'none' }}>
        {best}
        {idle && lines && lines.slice().reverse().map((r) => <Arrow key={r.k} from={r.uci.slice(0, 2)} to={r.uci.slice(2, 4)} color={BOARD.engine} a={r.k === 1 ? 1 : 0.5} grow={1} thin={r.k > 1} />)}
        {queen && (queen.at === c + 1 || queen.at === c) && queen.best && <Arrow from={queen.best.slice(0, 2)} to={queen.best.slice(2, 4)} color={BOARD.queen} a={1} grow={1} />}
      </svg>
      {badge}
    </div>
  );
}

// ---------- exploring a best line on the board ----------
const LINE_CACHE = new Map();
function playLineCached(M, c, moves) {
  const P = c === 0 ? M.start : M.plies[c - 1];
  const fen = P.fen, castle = c === 0 ? M.start.pos.castle : P.castle, ep = c === 0 ? M.start.pos.ep : P.ep, key = fen + ' ' + castle + ' ' + ep + '|' + moves.join(' ');
  if (!LINE_CACHE.has(key)) LINE_CACHE.set(key, window.ChessCore.playLine(fen, moves, castle, ep));
  return LINE_CACHE.get(key);
}
// Go deeper's best line from the position after a ply P, as steps: the last one kept (the panel re-renders while the
// search streams in, and the line changes far less often)
const DEEP_LINE = { key: '', steps: null };
function deepLineSteps(P, pv) {
  const key = P.fen + ' ' + P.castle + ' ' + P.ep + '|' + pv.slice(0, 8).join(' ');
  if (DEEP_LINE.key !== key) Object.assign(DEEP_LINE, { key, steps: engineSteps({ ...window.ChessCore.posFromFen(P.fen), castle: P.castle, ep: P.ep }, pv) });
  return DEEP_LINE.steps;
}
// The lines of the position after ply P on the loaded analysis (several searched lines: Go deeper's once it shows, else the
// analysis file's engine_lines), each { k, cp, depth, pv: uci }; null with one line or none
// the engine lines' arrows from the position after ply c (grey: the green one is Better was's): each line's first
// move where several were kept (Go deeper's, else the analysis's), else the Best line's, as the panel lists them
function nextArrows(M, c, deeper) {
  const many = nextLinesOf(M.plies[c], deeper);
  if (many) return lineArrows({ lines: many });
  if (deeper && deeper.pv && deeper.pv[0]) return [{ uci: deeper.pv[0], k: 1 }];
  const P = M.plies[c], s = P && P.next && P.next.length ? playLineCached(M, c + 1, P.next.slice(0, 1)) : [];
  return s.length && s[0].uci ? [{ uci: s[0].uci, k: 1 }] : null;
}
const nextLinesOf = (P, deeper) => (deeper ? (deeper.lines && deeper.lines.length > 1 ? deeper.lines : null) : P && P.nextLines && P.nextLines.length > 1 ? P.nextLines : null);
const lineLabel = (M, c, j, san) => `${window.ChessCore.moveNo(M.ply0 + c + j)} ${san}`;

// What a search actually did: "Stockfish 19 lite · depth 22 (23 unfinished) · 3.0 s · 1.5M nodes" (the eval is from depth 22)
const engineLabel = (name) => (name || 'Stockfish').replace(/\s*\(browser\)$/, '');
// the Analysis title row's word on a search: the depth it reached, or the tablebase that answered it
function searchDepth(s) {
  if (s && s.tablebase) return 'Tablebase'; // a game analysis's position the tablebase answered
  if (s && s.source === 'cloud') return 'cloud depth ' + s.depth; // Lichess's cloud evaluation
  return s && s.depth ? 'depth ' + s.depth : null;
}

// The browser engine's menu for the Analysis panel (GameApp provides it): name, the engine's label; pick, the
// Lite/Full choice ({ value, options: [{ value, label }], onChange }) where the full engine is offered; body, the
// engine settings, which take the panel's place while its menu is open
const EngineMenuContext = React.createContext(null);
const headCtl = () => ({ ...NO_SELECT, flex: 'none', height: '1.8em', margin: '-0.4em 0', borderRadius: 3, cursor: 'pointer', border: `1.5px solid ${C.ctlLine}`, background: 'transparent', color: C.ink, letterSpacing: 0 }); // C changes with the colour scheme; ctlLine stands out more than the panels' line
const stopHere = (e) => e.stopPropagation();
// The Analysis panel's title row (on the right: the Stockfish switch, the engine, the game analysis's computer button,
// the engine menu) and, while the menu is open, the engine settings in place of the panel's contents. Only a paused
// replay offers them; playing (an export too) shows the engine's name. depth and deep (Go deeper, useMoveEval's) go to
// the eval's row through AnalysisStatContext, where AnalysisStat draws them
const AnalysisStatContext = React.createContext(null);
function AnalysisPanel({ box, a, depth, deep, paused, style, children }) {
  const E = React.useContext(EngineMenuContext);
  const [open, setOpen] = React.useState(false);
  const live = !!E && paused, shown = open && live, pick = live && E.pick;
  const name = E ? E.name : 'Stockfish';
  const head = (
    // the controls go under the title rather than over it where even then they don't fit (a small phone, large text)
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: tx(16), rowGap: tx(8) }}>
      <span style={{ flex: 'none' }}>Analysis</span>
      {/* spaced as the desktop's heading whatever the layout's title gap (the phone's wide one left no room) */}
      <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: tx(12) }}>
      {live && E.setOn && <button type="button" className="twk-toggle an-switch" data-on={E.on ? '1' : '0'} role="switch" aria-checked={!!E.on} aria-label="Stockfish" title={E.run && E.on ? 'Stockfish on, looking only at the game while it is analysed: turn it off' : E.on ? 'Stockfish on: turn it off' : 'Stockfish off: turn it on'}
        onClick={(e) => { e.stopPropagation(); E.setOn(!E.on); }} onPointerDown={stopHere}><i /></button>}
      {/* smaller on the phone, where the row is tight */}
      {pick
        ? <select aria-label="Engine" value={pick.value} onChange={(e) => { const go = pick.onChange(e.target.value); if (go) setOpen(true); }} onClick={stopHere} onPointerDown={stopHere}
            style={{ ...headCtl(), flex: '0 1 auto', minWidth: '3em', padding: '0 0.4em', font: 'inherit', fontSize: L.cols === 2 ? '1.15em' : '1em', height: 'auto', minHeight: '1.6em', textTransform: 'none', background: C.panel }}>
            {pick.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        : <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'none', letterSpacing: '0.04em', color: C.ink }}>{name}</span>}
      {/* the game analysis: its dialog, with its own settings; while a run goes on, a turning rainbow ring in place
          of the computer, so a run going on isn't forgotten */}
      {live && E.analyse && (
        <button type="button" aria-label={E.run ? `Analyse the game: analysing, ${E.run.done} of ${E.run.total} positions` : 'Analyse the game'} title={E.run ? `Analysing the game: ${E.run.done} of ${E.run.total} positions` : 'Analyse the game'} onClick={(e) => { e.stopPropagation(); E.analyse(); }} onPointerDown={stopHere}
          style={{ ...headCtl(), width: '1.8em', padding: 0, display: 'grid', placeItems: 'center', color: C.dim, borderColor: E.run ? 'transparent' : C.ctlLine }}>
          {E.run ? <span className="an-spin" aria-hidden="true" />
            : <svg viewBox="0 0 16 16" width="70%" height="70%" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><rect x="1.5" y="2.5" width="13" height="8.5" rx="1" /><path d="M5.5 14h5M8 11v3" /></svg>}
        </button>
      )}
      {live && (
        <button type="button" aria-label="Engine options" aria-expanded={shown} title="Engine settings" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} onPointerDown={stopHere}
          style={{ ...headCtl(), width: '1.8em', padding: 0, display: 'grid', placeItems: 'center', color: shown ? C.best : C.dim, borderColor: shown ? C.best : C.ctlLine }}>
          <svg viewBox="0 0 16 16" width="60%" height="60%" aria-hidden="true"><path d="M2 3.5h12M2 8h12M2 12.5h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      )}
      </span>
    </span>
  );
  return (
    <Panel box={shown && !box.flow ? { ...box, scroll: true } : box} part="analysis" a={a} style={style} tight head={head} progress={!shown && deep && deep.pending ? deep.progress || 0 : E && E.run ? E.run.k : null}>
      {shown ? <div className="an-engine part-engine-menu" onClick={stopHere} onPointerDown={stopHere}><div className="twk-flow">{E.body}</div></div>
        : <AnalysisStatContext.Provider value={{ depth, deep, paused }}>
          {E && E.runErr && <div role="alert" style={{ marginBottom: tx(10), font: `500 ${tx(15)}px ${MONO}`, color: C.blunder }}>{E.runErr}</div>}
          {E && E.runNote && <div role="status" style={{ marginBottom: tx(10), font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{E.runNote}</div>}
          <div className="an-lines" data-playing={paused ? undefined : '1'} style={{ display: 'contents' }}>{children}</div>
        </AnalysisStatContext.Provider>}
    </Panel>
  );
}
// The eval's row: Go deeper's + and the depth the search behind the eval reached ("depth 20", "cloud depth 40",
// "Tablebase"; in full even on a phone, where the eval's row has room), to the left of the eval
function AnalysisStat() {
  const X = React.useContext(AnalysisStatContext);
  const [whyOpen, setWhyOpen] = React.useState(false); // Go deeper's failure in full (a touchscreen shows no tooltip)
  const failed = X && X.deep && X.deep.failed;
  React.useEffect(() => setWhyOpen(false), [failed]); // a new failure starts short again
  if (!X) return null;
  // a narrow panel shortens Go deeper's failure to its first words ("Engine failed" on a phone)
  const { depth, deep, paused } = X, roomy = !L.analysis || L.analysis.w >= 440 * TEXT;
  const depthTip = depth && depth.startsWith('cloud ') ? 'Lichess cloud, depth ' + depth.slice(12) : depth;
  if (!depth && !(paused && deep && (deep.deeper || failed))) return null;
  return (
    <span style={{ ...NO_SELECT, flex: '0 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: tx(12), font: `600 ${tx(15)}px ${MONO}`, letterSpacing: '0.04em', color: C.dim, flexWrap: whyOpen ? 'wrap' : 'nowrap' }}>
      {paused && <DeeperButton ev={deep} />}
      {/* Go deeper's failure: short, its reason in the tooltip, and all of it at a tap */}
      {failed && <span role="status" title={failed} onClick={(e) => { e.stopPropagation(); setWhyOpen((o) => !o); }} onPointerDown={stopHere}
        style={{ flex: whyOpen ? '1 1 100%' : '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: whyOpen ? 'normal' : 'nowrap', color: C.blunder, cursor: 'pointer' }}>{whyOpen ? failed : roomy ? failed.split(':')[0] : 'Engine failed'}</span>}
      {depth && <span title={depthTip} style={{ flex: 'none', whiteSpace: 'nowrap' }}>{depth}</span>}
    </span>
  );
}
// the eval at the right of a move's row, with AnalysisStat to its left
function EvalWithStat({ children }) {
  return (
    <span style={{ marginLeft: 'auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: tx(14) }}>
      <AnalysisStat />
      <span style={{ flex: 'none', font: `700 ${headline()}px ${MONO}`, color: C.ink }}>{children}</span>
    </span>
  );
}
const lineAccent = (src) => (src === 'queen' ? C.queen : src === 'you' ? C.last : C.best);
// the name of the panel's line a shown line was picked from
const lineName = (src) => (src === 'queen' ? 'Queen line' : src === 'sf' ? 'better line' : 'best line');
// under the Analysis panel's lines while a line is shown: the viewer's moves, or the picked line's move on the board
const shownLineNote = (M, vline) => (
  <span style={{ color: lineAccent(vline.src) }}>
    {vline.src === 'you'
      ? (vline.upto < 0 ? 'Your moves: drag a piece to play' : `Your moves: ${vline.moves.slice(0, vline.upto + 1).map((m, j) => (j === 0 || (M.ply0 + vline.at + j) % 2 === 0 ? lineLabel(M, vline.at, j, m.san) : m.san)).join(' ')}`)
      : `On the board: ${lineName(vline.src)} to ${lineLabel(M, vline.at, vline.upto, vline.moves[vline.upto].san)} · drag a piece to branch off`}
  </span>
);
// arrows: the engine lines' first moves from the position shown ([{ uci, k }], lineArrows), line 1 the strongest
function LineBoard({ a, sq, v, hide, arrows, sel }) {
  // the ring around the board says whose line it is; its last move gets the same tint as the game's
  const step = v.upto >= 0 ? v.moves[v.upto] : null, accent = v.src === 'queen' ? BOARD.queen : v.src === 'you' ? BOARD.last : BOARD.best;
  const board = step ? step.board : v.base.b;
  const over = !step ? [] : [step.uci.slice(0, 2), step.uci.slice(2, 4)].map((s, j) => {
    const [x, y] = sqXY(s);
    return <div key={'h' + j} style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, background: LAST_MOVE }} />;
  });
  if (step && step.checkSq) {
    const [x, y] = sqXY(step.checkSq);
    over.push(<div key="chk" style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, background: `radial-gradient(circle, ${BOARD.blunder} 0%, rgba(228,85,63,0.55) 40%, rgba(228,85,63,0) 72%)` }} />);
  }
  const pieces = board.map((p, i) => (p && i !== hide ? (
    <div key={i} style={{ position: 'absolute', left: idxXY(i)[0] * SQ, top: idxXY(i)[1] * SQ, width: SQ, height: SQ, zIndex: 2, filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.25))' }}>
      <img src={img(p === p.toUpperCase() ? 'w' : 'b', p.toLowerCase())} alt="" style={{ width: SQ, height: SQ, display: 'block' }} />
    </div>
  ) : null));
  return (
    // drawing only: taps and drags go to BoardTouch (without this its pieces sit above it and swallow them)
    <div style={{ ...NO_SELECT, position: 'absolute', left: 0, top: 0, width: BW, height: BW, borderRadius: 2, overflow: 'hidden', boxShadow: `0 0 0 2px ${accent}, ${C.haloBoard}0 4px 12px rgba(0,0,0,0.28)`, opacity: a, pointerEvents: 'none' }}>
      {sq}{over}{selSquare(sel)}{pieces}
      {arrows && (
        <svg width={BW} height={BW} style={{ position: 'absolute', left: 0, top: 0, zIndex: 6, pointerEvents: 'none' }}>
          {arrows.slice().reverse().map((r) => <Arrow key={r.k} from={r.uci.slice(0, 2)} to={r.uci.slice(2, 4)} color={r.color || BOARD.engine} a={r.a != null ? r.a : r.k === 1 ? 1 : 0.5} grow={1} thin={r.k > 1} />)}
        </svg>
      )}
    </div>
  );
}

// A dragged piece ('N', 'p'…) at board pixels x, y of el (the board's touch layer), drawn over everything on the page: the
// stage clips what is inside it, so the dock, bars and panels would cover it there. Its own compositing layer: drawn in the
// scaled board, its shadow left trails Epiphany (WebKitGTK) never repainted
function DragGhost({ el, piece, x, y }) {
  if (!el) return null;
  const r = el.getBoundingClientRect(), k = r.width / BW, s = SQ * 1.1 * k;
  return ReactDOM.createPortal(
    <img src={img(piece === piece.toUpperCase() ? 'w' : 'b', piece.toLowerCase())} alt=""
      style={{ position: 'fixed', left: r.left + x * k - s / 2, top: r.top + y * k - s / 2, width: s, height: s, pointerEvents: 'none', filter: `drop-shadow(0 ${10 * k}px ${12 * k}px rgba(0,0,0,0.45))`, willChange: 'transform', transform: 'translateZ(0)', zIndex: 100 }} />,
    document.body);
}

// The pieces a pawn can become, in the picker's order, and where each sits: a column on the promotion square's file
const PROMO_PIECES = ['q', 'n', 'r', 'b'];
const promoPieces = (pr) => PROMO_PIECES.map((t, k) => ({ t, sq: pr.to + (pr.white ? 8 : -8) * k }));
function BoardTouch({ pos, targets, drag, promo, onDown, onMove, onUp, onCancel }) {
  const dragged = drag && drag.moved ? pos.b[drag.from] : null, el = React.useRef(null);
  return (
    <div ref={el} data-no-drag-scroll onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
      onDragStart={(e) => e.preventDefault()} title="Drag a piece to try your own move"
      style={{ ...NO_SELECT, position: 'absolute', left: 0, top: 0, width: BW, height: BW, cursor: drag && drag.moved ? 'grabbing' : 'grab', touchAction: 'none' }}>
      {targets.map((t) => (
        <div key={t} style={{ position: 'absolute', left: idxXY(t)[0] * SQ, top: idxXY(t)[1] * SQ, width: SQ, height: SQ, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          {pos.b[t]
            ? <div style={{ width: SQ - 8, height: SQ - 8, borderRadius: '50%', border: '6px solid rgba(21,16,13,0.35)', boxSizing: 'border-box' }} />
            : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(21,16,13,0.32)' }} />}
        </div>
      ))}
      {dragged && <DragGhost el={el.current} piece={dragged} x={drag.x} y={drag.y} />}
      {promo && <div style={{ position: 'absolute', inset: 0, background: 'rgba(21,16,13,0.45)', pointerEvents: 'none', zIndex: 4 }} />}
      {promo && promoPieces(promo).map(({ t, sq }) => (
        <div key={t} role="button" aria-label={'Promote to ' + { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[t]}
          style={{ position: 'absolute', left: idxXY(sq)[0] * SQ, top: idxXY(sq)[1] * SQ, width: SQ, height: SQ, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: BOARD.light, boxShadow: '0 4px 14px rgba(0,0,0,0.45)', pointerEvents: 'none', zIndex: 5 }}>
          <img src={img(promo.white ? 'w' : 'b', t)} alt="" style={{ width: SQ * 0.86, height: SQ * 0.86 }} />
        </div>
      ))}
    </div>
  );
}

// The viewer's circles and arrows (DrawCore): a right click on a square rings it, a right-button drag draws an arrow, a
// left click clears them all, and they go when the position (key) changes
function useBoardDraw(key) {
  const [shapes, setShapes] = React.useState([]);
  const [cur, setCur] = React.useState(null); // { from, to, brush } while the right button is down; to null off the board
  React.useEffect(() => { setShapes([]); setCur(null); }, [key]);
  return { shapes, setShapes, cur, setCur };
}
// Draws the viewer's shapes over the board and takes the right button before BoardTouch (its child) sees it; the
// left button clears them and goes on to BoardTouch. hidden: a preview or the video is on the board
function BoardDraw({ draw, hidden, children }) {
  const D = window.DrawCore, { shapes, setShapes, cur, setCur } = draw;
  const sqAt = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
    const [vx, vy] = view(Math.floor(x * 8), Math.floor(y * 8));
    return D.sqName(vy * 8 + vx);
  };
  const onDown = (e) => {
    if (e.button === 2) {
      e.stopPropagation();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
      const s = sqAt(e);
      if (s) setCur({ from: s, to: s, brush: D.brush(e) });
    } else if (e.button === 0 && shapes.length) setShapes([]);
  };
  const onMove = (e) => {
    if (!cur) return;
    e.stopPropagation();
    const s = sqAt(e);
    if (s !== cur.to) setCur((c) => c && { ...c, to: s });
  };
  // the arrow ends where the button comes up (pointerup comes once every button is up); off the board it's dropped
  const onUp = (e) => {
    if (!cur) return;
    e.stopPropagation();
    const s = sqAt(e);
    setCur(null);
    if (s) setShapes((t) => D.toggle(t, D.shape(cur.from, s, cur.brush)));
  };
  const shape = (s, a, key) => (s.to
    ? <Arrow key={key} from={s.from} to={s.to} color={D.COLORS[s.brush]} a={a} grow={1} />
    : <circle key={key} cx={sqC(s.from)[0]} cy={sqC(s.from)[1]} r={SQ / 2 - 5} fill="none" stroke={D.COLORS[s.brush]} strokeWidth={7} opacity={0.85 * a} />);
  const drawn = hidden ? [] : cur && cur.to ? [...shapes.map((s) => [s, 1]), [D.shape(cur.from, cur.to, cur.brush), 0.6]] : shapes.map((s) => [s, 1]);
  return (
    <div onPointerDownCapture={onDown} onPointerMoveCapture={onMove} onPointerUpCapture={onUp} onPointerCancelCapture={() => setCur(null)}
      onContextMenu={(e) => e.preventDefault()} style={{ position: 'absolute', left: 0, top: 0, width: BW, height: BW }}>
      {children}
      {drawn.length > 0 && (
        <svg data-drawings width={BW} height={BW} style={{ position: 'absolute', left: 0, top: 0, zIndex: 3, pointerEvents: 'none' }}>
          {drawn.map(([s, a], k) => shape(s, a, k))}
        </svg>
      )}
    </div>
  );
}

// Move chips for a line; legal moves can be clicked to show the line on the board up to that move
// name: null for none (the caller labels the line); tip: what the moves' tooltips call the line (else the name)
// a line's row (.line-row): lit while the mouse is over it (not a finger, so a tapped line doesn't stay lit), and
// onLeave as the mouse leaves it. data-hover rather than CSS :hover, which headless Firefox never reports
const lineRow = (onLeave) => ({
  className: 'line-row',
  onPointerEnter: (e) => { if (e.pointerType === 'mouse') e.currentTarget.dataset.hover = '1'; },
  onPointerLeave: (e) => { if (e.pointerType !== 'mouse') return; delete e.currentTarget.dataset.hover; if (onLeave) onLeave(); },
});

// onHover(j) as the mouse enters a move, and onHover(null) only as it leaves the whole line, so sliding between
// moves never flashes the game's position. bare: the caller's row (lineRow) does both
function LineChips({ name, nameColor, accent, moves, ply0, c, legal, sel, onPick, tip, onHover, bare }) {
  const what = tip || String(name).toLowerCase();
  return (
    <div {...(bare ? {} : lineRow(onHover && (() => onHover(null))))} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 0, rowGap: tx(6) }}>
      {name != null && <span style={{ color: nameColor, marginRight: tx(14) }}>{name}</span>}
      {moves.map((m, j) => {
        const ply = ply0 + c + j, white = ply % 2 === 0, ok = j < legal, on = sel === j;
        return (
          <span key={j} style={{ display: 'flex', alignItems: 'center', gap: tx(5), marginRight: white && j + 1 < moves.length ? tx(2) : tx(6) }}>
            {(white || j === 0) && <span style={{ color: C.dim, marginLeft: j ? tx(6) : 0, font: `500 ${tx(16)}px ${MONO}` }}>{window.ChessCore.moveNo(ply)}</span>}
            <span className={ok ? 'mv' : undefined} role={ok ? 'button' : undefined} title={ok ? `Show ${what} on the board up to ${m}` : 'Not a legal move in this line'}
              onClick={ok ? (e) => { e.stopPropagation(); onPick(j); } : undefined}
              onPointerEnter={ok && onHover ? (e) => { if (e.pointerType === 'mouse') onHover(j); } : undefined} tabIndex={ok ? 0 : undefined}
              onKeyDown={ok ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPick(j); } } : undefined}
              style={moveChip(white, { cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.4, font: `${j === 0 || on ? 700 : 600} ${tx(16)}px ${MONO}`, boxShadow: on ? `0 0 0 3px ${C.last}` : 'none', ...(j === 0 && { border: `2px solid ${accent}` }) })}>{m}</span>
          </span>
        );
      })}
    </div>
  );
}

// tb: the endgame tablebase's result for the position shown ({ cp, txt }, tbBar), drawn instead of the evals; dead: a dead
// position's (deadBar), drawn instead of both; deep: the live eval of the move paused on, once it shows (as in Analysis):
// Go deeper's on an analysis, the move's own search on a game without one
function EvalBar({ M, T, S, a, tb, dead, deep }) {
  if (dead || tb) return <EvalBarView cp={(dead || tb).cp} txt={(dead || tb).txt} a={a} />;
  if (deep != null) return <EvalBarView cp={deep} txt={fmtSf(deep)} a={a} />;
  const { c, cp } = evalNow(M, T, S);
  const shown = c >= 0 ? M.plies[c] : null;
  const txt = !M.hasEval ? '' : shown && shown.checkmate && T > S.tp[c] + 1 ? fmtEval(shown) : shown && (shown.mate != null || shown.won) ? fmtEval(shown) : fmtEval({ cp });
  return <EvalBarView cp={M.hasEval ? cp : 0} txt={txt} a={a} />;
}
// the bar itself: White's share from cp (White's view), and txt in the part of the bar it favours
function EvalBarView({ cp, txt, a }) {
  const f = (winChance(cp) + 1) / 2;
  const flip = ORIENT === 'b', inWhite = cp >= 0, top = inWhite === flip; // the number sits in the part of the bar it favours
  if (!L.eval) return null;
  const H = L.board.size, ef = Math.round(L.eval.w * (L.tier === 'phone' ? 0.69 : 0.75) * 10) / 10; // the number, sized to the bar's width: its digits a little over half of it (less on a phone's thin bar)
  return (
    <div className="part-eval-bar" style={{ ...NO_SELECT, position: 'absolute', left: L.eval.x, top: L.board.y, width: L.eval.w, height: H, borderRadius: 2, overflow: 'hidden', background: '#2a2320', boxShadow: `0 0 0 1px ${C.line}, ${C.halo}0 0 0 transparent`, opacity: a }}>
      <div style={{ position: 'absolute', left: 0, right: 0, [flip ? 'top' : 'bottom']: 0, height: f * H, background: '#ffffff' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: H / 2 - 1, height: 2, background: C.last, opacity: 0.5 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: ef / 2, height: ef * 5, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 ${ef}px ${MONO}`, color: inWhite ? '#2a2320' : '#f1ebe1' }}>
        {/* a rotated line rather than writing-mode, which the video export's html2canvas lays out wrongly */}
        <span style={{ flex: 'none', whiteSpace: 'nowrap', transform: 'rotate(-90deg)' }}>{txt}</span>
      </div>
    </div>
  );
}

function clockOf(M, color, T, S) {
  const c = lastPly(T, S);
  let own = M.clockStart;
  for (let i = 0; i <= c; i++) if (M.plies[i].side === color && M.plies[i].clk != null) own = M.plies[i].clk;
  const n = c + 1;
  if (n < S.N && M.plies[n].side === color) {
    const t0 = c >= 0 ? S.tp[c] + S.md[c] : S.tp[0] - 0.8, t1 = S.tp[n];
    const target = M.plies[n].clk;
    return { s: target != null && target < own ? lerp(own, target, cl01((T - t0) / (t1 - t0))) : own, active: T > t0 - 0.01 };
  }
  return { s: own, active: false };
}

// a player bar's place: above or below the board (the side at the bottom below it), as wide as the board
// a player bar runs from the eval bar's left edge (the board's, where there's none) to the board's right edge
const barLeft = () => (L.eval ? L.eval.x : L.board.x), barWidth = () => L.board.x + L.board.size - barLeft();
const barPlace = (side) => ({
  position: 'absolute', left: barLeft(), width: barWidth(), height: L.bars.h, display: 'flex', alignItems: 'center',
  top: side === ORIENT ? L.board.y + L.board.size + L.bars.gap : L.board.y - L.bars.gap - L.bars.h,
});
// The pieces a side has taken and its material edge, counted from the pieces on the board (left(colour, type)) against a
// full set, so a position set up with an edge shows it: { taken, pts } for SideBar
const FULL_SET = { q: 1, r: 2, b: 2, n: 2, p: 8 };
function materialOf(side, left) {
  const lost = (col, t) => Math.max(0, FULL_SET[t] - left(col, t));
  const worth = (col) => Object.keys(FULL_SET).reduce((s, t) => s + left(col, t) * VALUE[t], 0);
  const opp = side === 'w' ? 'b' : 'w', taken = {};
  Object.keys(FULL_SET).forEach((t) => { taken[t] = lost(opp, t) - lost(side, t); });
  return { taken, pts: worth(side) - worth(opp) };
}
// A game's player bar: the captures and material edge from the pieces on the board at time T (taken off as they are
// captured, a pawn counted as its new piece once it has promoted, as the board draws them), the clock from the PGN's clocks
function PlayerBar({ M, T, S, side, a, pieces }) {
  const P = side === 'w' ? M.white : M.black;
  const count = { w: {}, b: {} };
  pieces.forEach((p) => {
    if (p.captured >= 0 && T >= S.tp[p.captured] + S.md[p.captured] * 0.6) return;
    const type = p.promo && T >= S.tp[p.promo.ply] + S.md[p.promo.ply] ? p.promo.type : p.type;
    count[p.color][type] = (count[p.color][type] || 0) + 1;
  });
  const { taken, pts } = materialOf(side, (col, t) => count[col][t] || 0);
  return <SideBar side={side} a={a} name={P.name} rating={[P.title, P.elo].filter(Boolean).join(' ')} taken={taken} pts={pts} clock={M.hasClock ? clockOf(M, side, T, S) : null} />;
}

// A player bar, the replay's and the free board's: the side's mark, the name and rating, the pieces it has taken (taken:
// a count by type, more of the opponent's than of its own; none drawn where it's less) and its material edge pts, and
// the clock ({ s, active }, or null) at the right. The full name, title and rating always; where the bar is too narrow
// (a phone's) their text gets smaller, down to 0.6 of its size, then the captures go, then the name ends in an ellipsis
function SideBar({ side, a, name, rating, taken, pts, clock }) {
  const opp = side === 'w' ? 'b' : 'w', shown = [];
  ['q', 'r', 'b', 'n', 'p'].forEach((t) => {
    // black pieces get a light rim so they read on the dark frame
    for (let i = 0; i < (taken[t] || 0); i++) shown.push(<img key={t + i} src={img(opp, t)} alt="" style={{ width: tx(30), height: tx(30), flex: 'none', marginLeft: shown.length ? -tx(8) : 0, filter: opp === 'b' ? C.rim : 'none' }} />);
  });
  const capsW = shown.length ? tx(6) + tx(30) + (shown.length - 1) * tx(22) + (pts > 0 ? tx(8) + textWidth('+' + pts, `600 ${tx(16)}px ${MONO}`) : 0) : 0;
  const fixedW = tx(14) + (clock ? tx(72) + tx(14) + 2 * tx(7) : 0);
  const needW = textWidth(name, `600 ${tx(20)}px ${SANS}`) + (rating ? tx(10) + textWidth(rating, `500 ${tx(16)}px ${MONO}`) : 0) + tx(14);
  const fit = (caps) => Math.min(1, (barWidth() - fixedW - (caps ? capsW + tx(14) : 0)) / needW);
  const caps = fit(true) >= 0.6 || !shown.length;
  const k = Math.max(0.6, fit(caps));
  return (
    <div className={'part-player-bar ' + (side === ORIENT ? 'bottom' : 'top')} style={{ ...barPlace(side), gap: tx(14), opacity: a }}>
      <span style={{ width: tx(14), height: tx(14), borderRadius: 2, background: side === 'w' ? '#fff' : '#1c1613', border: `1.5px solid ${C.dim}`, flex: 'none' }} />
      <span style={{ display: 'flex', alignItems: 'baseline', gap: tx(10) * k, minWidth: 0, whiteSpace: 'nowrap' }}>
        <span title={name} style={{ font: `600 ${tx(20) * k}px ${SANS}`, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{name}</span>
        {rating && <span style={{ flex: 'none', font: `500 ${tx(16) * k}px ${MONO}`, color: C.dim }}>{rating}</span>}
      </span>
      {caps && <span style={{ display: 'flex', alignItems: 'center', marginLeft: tx(6) }}>{shown}</span>}
      {caps && pts > 0 && <span style={{ font: `600 ${tx(16)}px ${MONO}`, color: C.dim, marginLeft: tx(8) }}>+{pts}</span>}
      {clock && <span className="game-clock" style={{ marginLeft: 'auto', minWidth: tx(72), textAlign: 'center', padding: `${tx(1)}px ${tx(7)}px`, borderRadius: 3, font: `600 ${tx(17)}px ${MONO}`, background: clock.active ? (clock.s < 60 ? C.blunder : 'rgb(251, 247, 241)') : C.off, color: clock.active ? '#15100d' : C.dim, boxShadow: clock.active ? `0 0 0 1px ${C.line}` : 'none' }}>{fmtClock(clock.s)}</span>}
    </div>
  );
}

// ---------- right column ----------
// Where the game was played, in three lines: event, round and teams, then place and date, then the opening; each
// scrolls sideways when it's long. The players, titles and ratings are the player bars'
function Header({ M, a }) {
  const teams = M.white.team && M.black.team ? `${M.white.team} vs ${M.black.team}` : M.white.team || M.black.team;
  const lines = [[M.event, M.round && 'Round ' + M.round, teams].filter(Boolean).join(' · '), [M.site, M.date].filter(Boolean).join(' · '), [M.eco, M.opening].filter(Boolean).join(' ')].filter(Boolean);
  return (
    <Panel box={L.header} part="game-info" a={a} style={{ padding: `${tx(10)}px ${tx(L.pad[1])}px`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: tx(4), font: `500 ${tx(16)}px/1.35 ${MONO}`, color: C.dim }}>
      {lines.map((t, i) => <SideScroll key={i} style={{ display: 'block', color: C.ink }}>{t}</SideScroll>)}
    </Panel>
  );
}

// The Moves list's mark where a game played on from a position begins: the moves before it came with the position. The
// panel's colour on the accent (light on the light theme's dark gold, dark on the dark theme's bright one) for contrast
function StartPill() {
  return (
    <span className="start-pill" title="The game begins here; the moves before it came with the position" style={{ ...NO_SELECT, flex: 'none', alignSelf: 'center', marginLeft: tx(6), padding: `${tx(3)}px ${tx(8)}px`, borderRadius: tx(8), background: C.last, color: C.panel, font: `700 ${tx(13)}px ${MONO}`, letterSpacing: '0.06em' }}>GAME STARTS</span>
  );
}

// deadAt: the ply after which the position is dead (useFirstDead), marked with a pill on the paused list; end: the
// game's result after the last move ({ score, why }, PlayCore.ending), shown while paused or once the last move is played,
// and taking the pill's place there; startAt: a game played on from a position (PlayCore's game.from), whose first
// move gets a Game starts pill before it
function MoveList({ M, T, S, a, paused, onPick, deadAt, end, startAt }) {
  const c = lastPly(T, S);
  // the moves wrap in lines, as the Analysis panel's lines do: a light chip for White's move, a dark one for Black's,
  // the move number before White's (and before the first, when the game starts on Black's). A line is a chip (CHIP)
  // and the gap under it: ROW, the line LayoutCore counts
  const ROW = tx(38), CHIP = tx(28), GAP = tx(6);
  // a white move and the black one after it sit PAIR_GAP apart (each its own flex item, so a long list still wraps between them)
  const PAIR_GAP = tx(2);
  // a flowing list grows up to maxRows lines, then scrolls; a placed one takes all the box's height under its title (the
  // tight panel's padding and title gap where it has them, as LayoutCore counts them)
  const listH = L.moves.flow ? null : Math.max(ROW, L.moves.h - 2 * tx(L.pad[0] * (tightAn() ? 0.6 : 1)) - tx(15) * 1.4 - (tightAn() ? anGap(12) : tx(12)) - 2);
  const k = c >= 0 ? MOTION.move(cl01((T - S.tp[c]) / 0.35)) : 1, listRef = React.useRef(null);
  // a new move scrolls the list by whole lines so the move's line keeps one line under it (none in a box of one line,
  // where the move's own line must show), sliding there as the move plays, and leaves it
  // where the viewer put it (wheel, finger, a mouse drag) until the next
  const applied = React.useRef(null);
  React.useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const at = (i) => {
      const m = i >= 0 && el.querySelector(`[data-ply="${i}"]`);
      // the lines in view: clientHeight is rounded to whole pixels, so a box of exactly n lines can read a pixel short
      const lines = Math.max(1, Math.floor((el.clientHeight + 1) / ROW)), under = Math.min(1, lines - 1);
      return m ? Math.max(0, Math.round(m.offsetTop / ROW) + 1 + under - lines) * ROW : 0;
    };
    const scroll = Math.round(lerp(at(c - 1), at(c), k));
    if (applied.current !== scroll) { el.scrollTop = scroll; applied.current = scroll; }
  });
  // one Tab stop for the whole list (the current move); the arrows move between moves (up and down a line), and focus follows
  const focusPly = Math.max(0, c);
  const lineStep = (i, dir) => {
    const el = listRef.current, from = el && el.querySelector(`[data-ply="${i}"]`);
    if (!from) return i + dir;
    const x = from.offsetLeft + from.offsetWidth / 2, chips = [...el.querySelectorAll('[data-ply]')];
    const tops = chips.map((m) => m.offsetTop).filter((t) => (dir > 0 ? t > from.offsetTop + 1 : t < from.offsetTop - 1));
    if (!tops.length) return dir > 0 ? S.N - 1 : 0;
    const top = dir > 0 ? Math.min(...tops) : Math.max(...tops);
    const near = chips.filter((m) => Math.abs(m.offsetTop - top) <= 1).sort((p, q) => Math.abs(p.offsetLeft + p.offsetWidth / 2 - x) - Math.abs(q.offsetLeft + q.offsetWidth / 2 - x))[0];
    return +near.dataset.ply;
  };
  const moveKey = (e, i) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(i); return; }
    if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    const j = { ArrowLeft: () => i - 1, ArrowRight: () => i + 1, ArrowUp: () => lineStep(i, -1), ArrowDown: () => lineStep(i, 1), Home: () => 0, End: () => S.N - 1 }[e.key];
    if (!j) return;
    e.preventDefault(); e.stopPropagation();
    const to = clamp(j(), 0, S.N - 1);
    onPick(to);
    requestAnimationFrame(() => { const el = listRef.current && listRef.current.querySelector(`[data-ply="${to}"]`); if (el) el.focus({ preventScroll: true }); });
  };
  const moves = [];
  for (let i = 0; i < S.N; i++) {
    // moves still to come are hidden while the game plays (keeping their place, so the lines don't reflow) and faded,
    // but readable, while paused; a flagged move's chip (not a best one: most are) is edged in its class colour
    const P = M.plies[i], cur = i === c, ahead = T < S.tp[i], white = (M.ply0 + i) % 2 === 0;
    const shown = paused ? 1 : cl01((T - S.tp[i]) / 0.15);
    const edge = P.cls !== 'none' && P.cls !== 'best' ? `2px solid ${clsColor(P.cls)}` : chipEdge(white);
    moves.push(
      <span key={i} style={{ display: 'flex', alignItems: 'center', gap: tx(5), opacity: shown, marginRight: white && i + 1 < S.N && i + 1 !== startAt ? PAIR_GAP : GAP }}>
        {startAt > 0 && i === startAt && <StartPill />}
        {(white || i === 0 || i === startAt) && <span style={{ color: i <= c ? C.ink : C.dim, marginLeft: i ? tx(6) : 0, font: `500 ${tx(16)}px ${MONO}` }}>{window.ChessCore.moveNo(M.ply0 + i)}</span>}
        <span className="mv" role="button" data-ply={i} tabIndex={i === focusPly ? 0 : -1} title={`Go to ${label(M, i)}`} onClick={(e) => { e.stopPropagation(); onPick(i); }}
          onKeyDown={(e) => moveKey(e, i)}
          style={moveChip(white, { opacity: ahead ? 0.5 : 1, height: CHIP, boxSizing: 'border-box', display: 'flex', alignItems: 'center', padding: `0 ${tx(8)}px`, cursor: 'pointer', font: `${cur ? 700 : 600} ${tx(16)}px ${MONO}`, border: edge, boxShadow: cur ? `0 0 0 3px ${C.last}` : 'none' })}>{P.san}{P.mark || ''}</span>
        {paused && i === deadAt && !(end && i === S.N - 1) && <DeadPill />}
      </span>
    );
  }
  // a game from a position with none of its own moves yet: the pill after the moves before it
  if (startAt > 0 && startAt === S.N) moves.push(<StartPill key="start" />);
  if (end && S.N) {
    moves.push(
      <span key="end" className="move-result" style={{ ...NO_SELECT, display: 'flex', alignItems: 'baseline', gap: tx(6), marginLeft: tx(6), opacity: paused ? 1 : cl01((T - S.tp[S.N - 1]) / 0.15) }}>
        <span style={{ color: C.ink, font: `700 ${tx(16)}px ${MONO}` }}>{end.score}</span>
        <span style={{ color: C.dim, font: `500 ${tx(14)}px ${MONO}` }}>{end.why}</span>
      </span>
    );
  }
  return (
    <Panel box={L.moves} part="moves" a={a} tight title="Moves" info={paused && <InfoTip label="Moves" info="Drag or tap a piece to try your own moves; click a move in Moves to jump to it." />}>
      <div ref={listRef} className="moves-list" style={{ position: 'relative', height: listH ?? 'auto', maxHeight: listH == null ? L.moves.maxRows * ROW : undefined, overflowY: 'auto', scrollbarWidth: 'thin' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 0, rowGap: ROW - CHIP, padding: 4 }}>{moves}</div>
      </div>
    </Panel>
  );
}

function Commentary({ M, T, S, a, book, line }) {
  const video = useFrame().video;
  const c = lastPly(T, S);
  // the book name of this position while the game is in book (before the book loads: the game's opening, early on)
  const bookAt = line ? line.book : c < 0 ? null : book ? book[c] : c < 12 && M.opening ? { eco: M.eco, name: M.opening } : null;
  const txt = (c >= 0 ? M.plies[c].comment : M.intro) || '';
  const qtxt = (c >= 0 && M.plies[c].queenText) || '';
  // with the Analysis panel's fade, before the piece lands
  const t0 = c >= 0 ? S.tp[c] + S.md[c] * 0.6 : S.tp[0] - 1.5;
  // one typewriter across the comment, then Queen's sentence
  const total = txt.length + qtxt.length;
  const avail = (c + 1 < S.N ? S.tp[c + 1] : t0 + 8) - t0;
  // the typewriter is a video touch: a paused or stepped page shows the whole text
  const n = !video ? total : total ? Math.floor(cl01((T - t0) / Math.max(0.4, Math.min(total / 60, avail * 0.45))) * total) : 0;
  const nh = Math.min(n, txt.length), nq = Math.max(0, n - txt.length);
  // about 22–27 px: smaller for a long comment, or one that shares the box with Queen's sentence
  // a phone's comments a size smaller
  const ph = L.tier === 'phone' ? 0.88 : 1;
  const size = tx(qtxt ? (txt.length > 90 ? 26 : 30) : txt.length > 140 ? 28 : 34) * ph;
  const qsize = tx(qtxt.length > 200 ? 20 : 22) * ph;
  return (
    <Panel box={L.comment} part="commentary" a={a} tight title="Commentary" right={bookAt ? `${bookAt.eco} ${bookAt.name}` : null}>
      {total ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: tx(14) }}>
          {/* the Analysis panel names the move, unless the game has no analysis */}
          {c >= 0 && bareGame(M) && <span style={{ font: `600 ${tx(18)}px ${MONO}`, color: M.plies[c].mark ? clsColor(M.plies[c].cls) : C.last }}>{label(M, c)}</span>}
          {txt && <span style={{ font: `400 ${size}px/1.14 ${SERIF}`, color: C.ink, textWrap: 'pretty' }}>{txt.slice(0, nh)}<span style={{ opacity: 0 }}>{txt.slice(nh)}</span></span>}
          {qtxt && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: tx(6), opacity: nq > 0 || !txt ? 1 : 0 }}>
              <span style={{ font: `600 ${tx(15)}px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.queen }}>Queen · after {M.plies[c].san}{M.plies[c].mark || ''}</span>
              <span style={{ font: `italic 400 ${qsize}px/1.2 ${SERIF}`, color: C.ink, textWrap: 'pretty', paddingLeft: tx(12), borderLeft: `2px solid ${C.queen}` }}>{qtxt.slice(0, nq)}<span style={{ opacity: 0 }}>{qtxt.slice(nq)}</span></span>
            </div>
          )}
        </div>
      ) : (
        // a quiet line instead of an empty box: why there's nothing here
        <span style={{ ...NO_SELECT, font: `italic 400 ${tx(28)}px/1.25 ${SERIF}`, color: C.dim }}>
          {!M.intro && !M.plies.some((p) => p.comment) ? (M.commentaryHidden ? 'Commentary is off.' : 'This game has no commentary.')
            : c < 0 ? 'Comments appear here as the game plays.' : `No comment on ${label(M, c)}.`}
        </span>
      )}
    </Panel>
  );
}

// tb: the endgame tablebase's answer for the position on the board (useTablebase); onTb plays one of its moves
// dead: chasolver's answers for the position on the board (useDead), for the dead-position block above the tablebase's
// fifty: PlayCore.fiftyRule's note for the position on the board, shown where no dead-position block is
// moveEval: Stockfish's search of the move paused on, in a game without an analysis (useGameMoveEval); gamePos(c): the
// position after ply c
function Analysis({ M, T, S, a, vline, onLine, onPreview, onReplyHover, paused, sf, own, onReply, deep, moveEval, gamePos, tb, onTb, dead, fifty }) {
  const c = lastPly(T, S);
  // Stockfish runs as asm.js here (stockfish.jsx, which a page without the engine doesn't load)
  const sfAsm = typeof SF_SIMD !== 'undefined' && !SF_SIMD;
  // a rule block (a dead position, the fifty-move rule) goes under the lines; the panel scrolls where they don't fit
  const rule = deadWords(dead) || fifty;
  const deadEl = rule && <div style={{ marginTop: tx(12), paddingTop: tx(12), borderTop: `1px solid ${C.line}` }}><RuleBlock w={rule} /></div>;
  const box = (tb || deadEl) && !L.analysis.flow ? { ...L.analysis, scroll: true } : L.analysis;
  // the Tablebase block goes above Stockfish's analysis (its lines, or the analysis's progress) in every layout: ruled off
  // above it, or below it where it comes first in the panel
  const tbAt = (first) => tb && <div style={first ? { marginBottom: anGap(16), paddingBottom: anGap(14), borderBottom: `1px solid ${C.line}` } : { marginTop: anGap(16), paddingTop: anGap(14), borderTop: `1px solid ${C.line}` }}><TablebaseBlock t={tb} onPlay={onTb} /></div>;
  // Go deeper's search of this move, once it has passed the analysis's (deep: useMoveEval's)
  const deeper = paused && deep && deep.after && !deep.after.stored ? deep.after : null;
  // this move's own search when the analysis recorded it, else the engine settings
  const depth = searchDepth(deeper || (c >= 0 ? M.plies[c].search : null));
  // the viewer's own move, or a move picked from a line (Better was, Best line, Queen line): Stockfish rates it and plays on
  if (own && vline && vline.upto >= 0) {
    return (
      <AnalysisPanel box={box} a={a} paused={paused} depth={sf && !sf.off && (sf.status === 'unavailable' || sf.status === 'stopped') ? null : searchDepth(own.after)} deep={own}>
        <OwnMoveAnalysis M={M} vline={vline} own={own} who={vline.src === 'you' ? undefined : lineName(vline.src).toUpperCase()} status={!sf ? 'idle' : sf.busy ? 'busy' : sf.off ? 'off' : sf.status} why={sf ? sf.why : ''} onReply={onReply} onHover={onReplyHover} top={tbAt(false)} />
        {deadEl}
        <span style={{ display: 'block', marginTop: tx(8), font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{shownLineNote(M, vline)}</span>
      </AnalysisPanel>
    );
  }
  if (moveEval && c >= 0 && paused) {
    // the game's move rated as the viewer's own are; its lines play on from the position after it
    const P = M.plies[c], mv = { at: c, moves: [{ san: P.san, uci: P.uci, pos: gamePos(c) }], upto: 0 };
    const fromHere = (steps) => (steps && steps.length ? steps : null);
    return (
      <AnalysisPanel box={box} a={a} paused={paused} depth={sf.status === 'unavailable' || sf.status === 'stopped' ? null : searchDepth(moveEval.after)} deep={moveEval}>
        <OwnMoveAnalysis M={M} vline={mv} own={moveEval} who={null} status={sf.busy ? 'busy' : sf.off ? 'off' : sf.status} why={sf.why} top={tbAt(false)}
          onReply={(steps) => { const st = fromHere(steps); if (st) onLine('next', st, st.length - 1, c + 1); }}
          onHover={(steps) => { const st = fromHere(steps); onPreview('next', st || [], st ? st.length - 1 : null, c + 1); }} />
        {deadEl}
      </AnalysisPanel>
    );
  }
  if (bareGame(M)) {
    return <AnalysisPanel box={box} a={a} paused={paused} depth={depth}>{tbAt(true)}{sf ? <EngineEmptyState M={M} sf={sf} paused={paused} ask={c < 0} /> : <span style={{ font: `400 ${tx(26)}px ${SERIF}`, color: C.dim, fontStyle: 'italic' }}>No engine analysis loaded.</span>}{deadEl}</AnalysisPanel>;
  }
  if (c < 0) return (
    <AnalysisPanel box={box} a={a} paused={paused} depth={depth}>
      {paused && <span style={{ ...NO_SELECT, font: `500 ${tx(16)}px ${MONO}`, color: C.dim }}>Press play to watch the game, or drag a piece to try your own move.</span>}
      {tbAt(!paused)}
      {sf && !M.hasAnalysis && (sf.run.state === 'running' || paused) && <div style={{ marginTop: tx(16) }}><EngineEmptyState M={M} sf={sf} paused={paused} compact /></div>}
      {deadEl}
    </AnalysisPanel>
  );
  const P = M.plies[c], cls = P.cls;
  const k = quickMove(S, c) ? 1 : cl01((T - S.tp[c] - S.md[c] * 0.6) / 0.25);
  const { cp } = evalNow(M, T, S);
  const col = cls === 'none' ? C.ink : clsColor(cls);
  const big = headline();
  // Queen's line from the position after this move (its scores are left out: often off, and they squeezed the move's labels onto more lines)
  const Qp = P.queen || {};
  // the best line from the position on the board, as the eval's; and, where the move wasn't rated best, the line the
  // engine preferred to it (P.best is also an equally good move rated best with 0 cp lost: "as good as" says that one)
  // Go deeper's result, once it shows, gives the best line too (as it gives the eval): the line streams in with its
  // search, as on the viewer's own moves
  const deepLine = deeper && deeper.pv && deeper.pv.length && typeof engineSteps === 'function' ? deepLineSteps(P, deeper.pv) : null;
  const nextLegal = deepLine && deepLine.length ? deepLine : P.next ? playLineCached(M, c + 1, P.next.slice(0, 8)) : [];
  const nextMoves = deepLine && deepLine.length ? deepLine.map((s) => s.san) : P.next ? P.next.slice(0, 8) : [];
  // the chip of the line shown on the board, while that line is still the one listed (a deeper search can change it)
  const nextSel = vline && vline.src === 'next' && vline.moves.slice(0, vline.upto + 1).every((s, j) => nextMoves[j] === s.san) ? vline.upto : null;
  // several lines: listed as the Lines of a search of the viewer's own moves, line 1 the Best line (moves along the board's arrows)
  const manyLines = typeof EngineLines === 'function' ? nextLinesOf(P, deeper) : null;
  const betterLegal = P.best && cls !== 'best' ? playLineCached(M, c, P.best.line.slice(0, 8)) : [];
  // name the engine (the analysis may come from another one), and say where Queen stands once it has looked
  const engName = P.tbBefore ? 'The tablebase' : (M.engine || '').split(' · ')[0] || 'The engine';
  const qPick = Qp.before && Qp.before.best ? Qp.before : null;
  const agreeText = `${engName} agrees with the move played.` + (qPick ? (qPick.best === P.uci ? ' So does Queen.' : ` Queen preferred ${qPick.bestSan || qPick.best}.`) : '');
  const qLine = Qp.after && Qp.after.line ? Qp.after.line.split(/\s+/).filter((x) => x && !/^\d+\.+$/.test(x) && !/^\d+\.\.\.$/.test(x)).map((x) => x.replace(/^\d+\.+/, '')).filter(Boolean).slice(0, 6) : [];
  const qLegal = qLine.length ? playLineCached(M, c + 1, qLine) : [];
  return (
    <AnalysisPanel box={box} a={a} paused={paused} depth={depth} deep={M.hasEval ? deep : null}>
      <div style={{ opacity: k, transform: `translateY(${(1 - k) * 8}px)` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: tx(28) }}>
          <span style={{ font: `700 ${big}px ${MONO}`, color: col }}>{label(M, c)}</span>
          {M.hasEval && <EvalWithStat>{deeper ? fmtSf(deeper.cp) : (P.mate != null || P.won) && k >= 1 ? fmtEval(P) : fmtEval({ cp })}</EvalWithStat>}
        </div>
        {/* the verdict spans the panel under the move and the eval; spaced parts rather than " · " separators, so a
            line too long for a narrow panel breaks between them */}
        <div style={{ marginTop: anGap(6), display: 'flex', flexWrap: 'wrap', columnGap: tx(14), font: `600 ${tx(16)}px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: col }}>
          {[P.checkmate ? 'Checkmate' : CLASS_LABEL[cls], P.loss > 0 && `−${P.loss} cp`, cls === 'best' && P.best && P.best.line[0] && `as good as ${P.best.line[0]}`].filter(Boolean).map((t) => <span key={t} style={{ whiteSpace: 'nowrap' }}>{t}</span>)}
        </div>
      </div>
      {/* the Tablebase block above the lines, where it shows without scrolling the panel; its results keep two rows'
          height, so the lines under it don't move from one position to the next */}
      {tbAt(false)}
      <div style={{ marginTop: anGap(16), paddingTop: anGap(14), borderTop: `1px solid ${C.line}`, font: `500 ${tx(18)}px ${MONO}`, color: C.dim, display: 'flex', flexDirection: 'column', gap: anGap(8), opacity: k }}>
        {betterLegal.length > 0 && (
          <LineChips name="Better was" tip="better line" nameColor={C.ink} accent={C.best} moves={P.best.line.slice(0, 8)} ply0={M.ply0} c={c} legal={betterLegal.length}
            sel={vline && vline.src === 'sf' ? vline.upto : null} onPick={(j) => onLine('sf', betterLegal, j)} onHover={(j) => onPreview('sf', betterLegal, j)} />
        )}
        {manyLines ? (
          <EngineLines lines={manyLines} pos={{ ...window.ChessCore.posFromFen(P.fen), castle: P.castle, ep: P.ep }} ply0={M.ply0} c={c + 1} cloud={!!deeper && deeper.source === 'cloud'}
            onPick={(st) => onLine('next', st, st.length - 1, c + 1)} onHover={(st) => onPreview('next', st || [], st ? st.length - 1 : null, c + 1)} />
        ) : nextLegal.length ? (
          <LineChips name="Best line" tip={deepLine && deeper.source === 'cloud' ? 'Lichess cloud’s best line' : 'best line'} nameColor={C.ink} accent={C.best} moves={nextMoves} ply0={M.ply0} c={c + 1} legal={nextLegal.length}
            sel={nextSel} onPick={(j) => onLine('next', nextLegal, j, c + 1)} onHover={(j) => onPreview('next', nextLegal, j, c + 1)} />
        ) : cls === 'best' ? <span>{agreeText}</span> : !betterLegal.length && <span />}
        {qLine.length > 0 && (
          <LineChips name="Queen line" nameColor={C.queen} accent={C.queen} moves={qLine} ply0={M.ply0} c={c + 1} legal={qLegal.length}
            sel={vline && vline.src === 'queen' ? vline.upto : null} onPick={(j) => onLine('queen', qLegal, j, c + 1)} onHover={(j) => onPreview('queen', qLegal, j, c + 1)} />
        )}
        {P.advice && <span style={{ color: C.inaccuracy }}>{P.advice}</span>}
        {rule && <div style={{ paddingTop: tx(8), borderTop: `1px solid ${C.line}` }}><RuleBlock w={rule} /></div>}
        {vline && (
          <span style={{ font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{shownLineNote(M, vline)}</span>
        )}
        {/* a running analysis's progress; Analyse with Stockfish itself only at the start */}
        {sf && !M.hasAnalysis && sf.run.state === 'running' && <EngineEmptyState M={M} sf={sf} paused={paused} compact />}
        {!vline && paused && M.hasEval && sfAsm && <FitOrHide style={{ ...NO_SELECT, font: `500 ${tx(15)}px ${MONO}`, color: C.blunder }}>{SF_ASM_SHORT}</FitOrHide>}
      </div>
    </AnalysisPanel>
  );
}

function EvalPlot({ M, T, S, a, paused, onPick }) {
  const { c, k } = evalNow(M, T, S);
  const PLOT = L.plot, W = PLOT.w - 40, H = PLOT.h - 30, mid = H / 2, N = S.N;
  const [hover, setHover] = React.useState(null);
  const down = React.useRef(false), lastPick = React.useRef(null), fade = React.useRef(null);
  React.useEffect(() => () => clearTimeout(fade.current), []);
  // nearest move to the pointer: ply j sits at x = px(j + 1); -1 is the starting position
  const plyAt = (e) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(-1, Math.min(N - 1, Math.round(((e.clientX - r.left) / r.width) * N) - 1)); };
  const full = M.hasEval && paused ? 'M' + [[0, py0()], ...M.plies.map((p, j) => [(j + 1) / N * W, py0(cpOf(M, j))])].map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' L') : null;
  function py0(cp = M.evalStart) { return mid - winChance(cp) * mid * 0.92; }
  const px = (j) => (j / N) * W, py = (cp) => mid - winChance(cp) * mid * 0.92;
  const pts = [[px(0), py(M.evalStart)]];
  for (let j = 0; j <= c; j++) {
    const x = px(j + 1), y = py(cpOf(M, j));
    if (j === c) { const [lx, ly] = pts[pts.length - 1]; pts.push([lerp(lx, x, k), lerp(ly, y, k)]); } else pts.push([x, y]);
  }
  const line = 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' L');
  const last = pts[pts.length - 1];
  const area = `${line} L${last[0].toFixed(1)},${mid} L0,${mid} Z`;
  const ticks = window.ChessCore.evalTicks(M.ply0, N);
  return (
    <div className="part-eval-graph" style={{ ...NO_SELECT, position: 'absolute', left: PLOT.x, top: PLOT.y, width: PLOT.w, height: PLOT.h, boxSizing: 'border-box', background: C.panel, border: `1px solid ${C.line}`, boxShadow: `${C.halo}0 0 0 transparent`, borderRadius: 4, padding: '10px 20px', opacity: a }}>
      <svg width={W} height={H + 14} style={{ display: 'block', overflow: 'visible', cursor: 'pointer', touchAction: 'none' }}
        onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {} down.current = true; clearTimeout(fade.current); const j = plyAt(e); setHover(j); lastPick.current = j; onPick(j); }}
        onPointerMove={(e) => {
          if (!down.current && e.pointerType !== 'mouse') return;
          const j = plyAt(e); setHover(j);
          if (down.current && j !== lastPick.current) { lastPick.current = j; onPick(j); } // a drag lands on whole moves, as it crosses them
        }}
        onPointerUp={(e) => {
          if (!down.current) return;
          down.current = false;
          if (e.pointerType !== 'mouse') fade.current = setTimeout(() => setHover(null), 1200); // let a finger see where it landed
        }}
        onPointerCancel={() => { down.current = false; setHover(null); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !down.current) setHover(null); }}>
        <title>Click or drag to go to a move</title>
        <rect x="0" y="0" width={W} height={H} fill="transparent" />
        <defs>
          <clipPath id="cp-up"><rect x="0" y="-10" width={W} height={mid + 10} /></clipPath>
          <clipPath id="cp-dn"><rect x="0" y={mid} width={W} height={mid + 10} /></clipPath>
        </defs>
        <line x1="0" x2={W} y1={mid} y2={mid} stroke={C.line} strokeWidth="2" />
        {ticks.map(({ m, at }) => (
          <g key={m}>
            <line x1={px(at)} x2={px(at)} y1="0" y2={H} stroke={C.line} strokeWidth="1" />
            <text x={px(at) + 6} y={H + 12} fill={C.dim} style={{ font: `500 ${tx(15)}px ${MONO}` }}>{m}</text>
          </g>
        ))}
        {M.hasEval ? (
          <g>
            {full && <path d={full} fill="none" stroke={C.dim} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.6" />}
            <path d={area} fill={C.best} opacity="0.16" clipPath="url(#cp-up)" />
            <path d={area} fill={C.blunder} opacity="0.16" clipPath="url(#cp-dn)" />
            <path d={line} fill="none" stroke={C.best} strokeWidth="2.5" clipPath="url(#cp-up)" />
            <path d={line} fill="none" stroke={C.blunder} strokeWidth="2.5" clipPath="url(#cp-dn)" />
            {M.plies.map((p, j) => (p.mark && (j < c || (j === c && k > 0.95)) ? <circle key={j} cx={px(j + 1)} cy={py(cpOf(M, j))} r="5" fill={clsColor(p.cls)} /> : null))}
            <circle cx={last[0]} cy={last[1]} r="6" fill={C.ink} />
          </g>
        ) : (
          <text x={W / 2} y={mid + 5} textAnchor="middle" fill={C.dim} style={{ font: `500 ${tx(16)}px ${MONO}` }}>No evaluation data</text>
        )}
        {/* under the hover label, which would otherwise sit behind WHITE */}
        <text x="4" y="12" fill={C.dim} style={{ font: `600 ${tx(15)}px ${MONO}`, letterSpacing: '0.1em' }}>WHITE</text>
        <text x="4" y={H - 4} fill={C.dim} style={{ font: `600 ${tx(15)}px ${MONO}`, letterSpacing: '0.1em' }}>BLACK</text>
        {hover != null && (() => {
          const x = px(hover + 1), name = hover < 0 ? 'Start' : label(M, hover), w = name.length * tx(16) * 0.62 + 16;
          const bx = Math.min(Math.max(x - w / 2, 0), W - w);
          return (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={x} x2={x} y1="0" y2={H} stroke={C.last} strokeWidth="2" opacity="0.8" />
              <rect x={bx} y={-6} width={w} height={22} rx="4" fill={C.bg} stroke={C.last} strokeWidth="1" />
              <text x={bx + w / 2} y={10} textAnchor="middle" fill={C.ink} style={{ font: `600 ${tx(16)}px ${MONO}` }}>{name}</text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// ---------- title & end cards ----------
// A card is drawn at the 1920 frame's sizes and scaled: by the text size, and down to fit the stage with 16 px to spare
// (w × h: the card's size at scale 1). One column stacks it, narrower.
const cardLayout = (w, h) => ({ stack: L.cols === 1, k: Math.min(TX, (L.w - 32) / w, (L.h - 32) / h) });
function TitleCard({ M, T, CUES }) {
  const out = 1 - cl01((T - (CUES.Opening - 0.7)) / 0.6);
  if (out <= 0) return null;
  const st = (d) => { const k = MOTION.enter(cl01((T - d) / 0.8)); return { opacity: k, transform: `translateY(${(1 - k) * 22}px)` }; };
  const len = M.white.short.length + M.black.short.length;
  // side by side in two columns; one name per line in one
  const card = { w: L.cols === 1 ? 640 : 1700, ...cardLayout(L.cols === 1 ? 640 : 1700, L.cols === 1 ? 640 : 420) };
  const size = card.stack ? Math.min(120, Math.floor(1300 / Math.max(M.white.short.length, M.black.short.length, 6))) : Math.min(130, Math.floor(1560 / (len * 0.5 + 3)));
  const sub = (P) => [[P.title, P.elo].filter(Boolean).join(' '), P.team].filter(Boolean).join(' · ');
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.bg, opacity: out, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, transform: `scale(${(1 + T * 0.006) * card.k})`, maxWidth: card.w, textAlign: 'center' }}>
        <span style={{ ...st(0.3), font: `600 20px ${MONO}`, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.last }}>{[M.event, M.round && 'Round ' + M.round].filter(Boolean).join(' · ')}</span>
        <div style={{ display: 'flex', flexDirection: card.stack ? 'column' : 'row', alignItems: card.stack ? 'center' : 'baseline', gap: card.stack ? 12 : 40 }}>
          <span style={{ ...st(0.6), font: `400 ${size}px ${SERIF}`, color: C.ink, lineHeight: 1 }}>{M.white.short}</span>
          <span style={{ ...st(0.9), font: `400 ${Math.round(size * 0.42)}px ${SERIF}`, color: C.dim, fontStyle: 'italic' }}>vs</span>
          <span style={{ ...st(1.1), font: `400 ${size}px ${SERIF}`, color: C.ink, lineHeight: 1 }}>{M.black.short}</span>
        </div>
        {(sub(M.white) || sub(M.black)) && <span style={{ ...st(1.6), font: `500 22px ${MONO}`, color: C.dim }}>{sub(M.white)}   —   {sub(M.black)}</span>}
        {M.opening && <span style={{ ...st(2.1), font: `500 22px ${MONO}`, color: C.ink }}>{[M.eco, M.opening].filter(Boolean).join(' · ')}</span>}
        <span style={{ ...st(2.4), font: `500 18px ${MONO}`, color: C.dim }}>{[M.site, M.date].filter(Boolean).join(' · ')}</span>
      </div>
    </div>
  );
}

function EndCard({ M, T, CUES }) {
  const k = MOTION.enter(cl01((T - (CUES.Outro + 0.2)) / 0.7));
  if (k <= 0) return null;
  const st = (d) => { const e = MOTION.enter(cl01((T - CUES.Outro - d) / 0.7)); return { opacity: e, transform: `translateY(${(1 - e) * 20}px)` }; };
  const res = M.result.replace('1/2-1/2', '½–½').replace('-', '–');
  const verdict = M.result === '1-0' ? `${M.white.short} wins` : M.result === '0-1' ? `${M.black.short} wins` : M.result === '1/2-1/2' ? 'Draw' : '';
  const hasAcc = typeof M.white.acc === 'number' && typeof M.black.acc === 'number';
  const card = { w: L.cols === 1 ? 640 : 1700, ...cardLayout(L.cols === 1 ? 660 : 1100, 700) };
  const bar = (P, d) => {
    const g = MOTION.move(cl01((T - CUES.Outro - d) / 1.2));
    return (
      <div style={{ ...st(d), display: 'grid', gridTemplateColumns: card.stack ? '190px 300px 100px' : '320px 520px 110px', alignItems: 'center', gap: 24 }}>
        <span style={{ font: `500 24px ${SANS}`, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{P.name}</span>
        <div style={{ height: 12, borderRadius: 3, background: C.off, overflow: 'hidden' }}><div style={{ width: `${P.acc * g}%`, height: '100%', background: C.best }} /></div>
        <span style={{ font: `700 24px ${MONO}`, color: C.ink, textAlign: 'right' }}>{(P.acc * g).toFixed(1)}%</span>
      </div>
    );
  };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: `rgba(${C.scrim},${0.86 * k})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
     <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, flex: 'none', transform: `scale(${card.k})` }}>
      <span style={{ ...st(0.3), font: `400 170px ${SERIF}`, color: C.ink, lineHeight: 1 }}>{res}</span>
      {verdict && <span style={{ ...st(0.6), font: `400 44px ${SERIF}`, color: C.ink }}>{verdict}</span>}
      {M.conclusion && <span style={{ ...st(0.8), font: `400 30px ${SERIF}`, color: C.dim, fontStyle: 'italic', maxWidth: Math.min(1100, card.w), textAlign: 'center' }}>{M.conclusion}</span>}
      {hasAcc && <span style={{ ...st(0.9), font: `600 15px ${MONO}`, letterSpacing: '0.14em', color: C.dim, marginTop: 16 }}>ACCURACY</span>}
      {hasAcc && bar(M.white, 1.0)}
      {hasAcc && bar(M.black, 1.2)}
      {M.engine && <span style={{ ...st(1.8), font: `500 17px ${MONO}`, color: C.dim, marginTop: 20 }}>{M.engine}</span>}
     </div>
    </div>
  );
}

// ---------- composition ----------
// The board's pointer input: tap-tap and drag moves, and the promotion picker. pos is the position on the board;
// onPick() runs when a piece of the side to move is picked up, onMiss() after a tap or drop that played nothing,
// onMove(step) with a legal move (a ChessCore.userMove step, promotion piece included)
function useBoardInput({ pos, onPick, onMiss, onMove }) {
  const [sel, setSel] = React.useState(null); // selected square (0 = a8)
  const [drag, setDrag] = React.useState(null); // { from, x, y, x0, y0, moved, again (pressed on the selected piece) } in board pixels
  const [promo, setPromo] = React.useState(null); // { from, to, white }: a pawn move waiting for its piece
  // a promotion first shows the picker, and plays once a piece is picked
  const playMove = (from, to, piece) => {
    if (!piece && window.ChessCore.isPromotion(pos, from, to)) { setPromo({ from, to, white: pos.turn === 'w' }); return true; }
    const step = window.ChessCore.userMove(pos, from, to, piece);
    if (!step) return false;
    onMove(step);
    return true;
  };
  const targets = sel != null ? window.ChessCore.legalTargets(pos, sel) : [];
  const boardXY = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * BW, y = ((e.clientY - r.top) / r.height) * BW;
    const [vx, vy] = view(Math.max(0, Math.min(7, Math.floor(x / SQ))), Math.max(0, Math.min(7, Math.floor(y / SQ))));
    return { x, y, sq: vy * 8 + vx };
  };
  // a drag once the pointer is 14 px from where it went down; also asked where it is let go, as the render with the last
  // move's state may not have run yet (a quick flick read as a tap)
  const moved = (d, p) => d.moved || Math.hypot(p.x - d.x0, p.y - d.y0) > 14;
  const handlers = {
    onDown: (e) => {
      const p = boardXY(e);
      if (promo) {
        // the picker's squares run from the promotion square towards the middle; anywhere else takes the move back
        const k = promoPieces(promo).findIndex((q) => q.sq === p.sq);
        setPromo(null);
        if (k >= 0) playMove(promo.from, promo.to, PROMO_PIECES[k]); else onMiss();
        return;
      }
      if (sel != null && sel !== p.sq && targets.includes(p.sq)) { playMove(sel, p.sq); setSel(null); return; }
      const pc = pos.b[p.sq];
      if (pc && (pc === pc.toUpperCase() ? 'w' : 'b') === pos.turn) {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
        onPick(); setSel(p.sq); setDrag({ from: p.sq, x: p.x, y: p.y, x0: p.x, y0: p.y, moved: false, again: sel === p.sq });
      } else { setSel(null); onMiss(); }
    },
    onMove: (e) => { if (!drag) return; const p = boardXY(e); setDrag((d) => d && { ...d, x: p.x, y: p.y, moved: moved(d, p) }); },
    onUp: (e) => {
      if (!drag) return;
      const p = boardXY(e), d = drag;
      setDrag(null);
      // a tap keeps the piece selected (the next tap picks its square); a tap on the piece already selected lets it go
      if (!moved(d, p)) { if (d.again) setSel(null); return; }
      if (p.sq !== d.from && playMove(d.from, p.sq)) setSel(null); else { setSel(null); onMiss(); }
    },
    onCancel: () => setDrag(null),
  };
  const cancelPromo = () => setPromo(null);
  const clear = () => { setSel(null); setDrag(null); setPromo(null); };
  return { sel, drag, promo, targets, handlers, cancelPromo, clear };
}

// When the schedule changes (a Queen answer lengthens a move's hold, a commentary source is turned off), keep the board
// on the same move: returns the time to draw, T0 itself or its place on the new schedule. The time is moved in this
// render, not after it: the old time on the new schedule is another move, which the board would draw (and slide its
// pieces back from) for a frame
function useHeldSchedule(T0, S) {
  const tl = useTimeline();
  const prevS = React.useRef(S);
  const shift = React.useRef(null); // { S, from, to } until the timeline holds `to`
  if (prevS.current !== S) {
    const p = prevS.current, c = lastPly(T0, p);
    prevS.current = S; shift.current = null;
    if (c >= 0 && c < S.N) {
      const next = c + 1 < S.N ? S.tp[c + 1] - 0.05 : Infinity;
      const t = Math.min(S.tp[c] + (T0 - p.tp[c]), next);
      if (Math.abs(t - T0) > 0.01) shift.current = { S, from: T0, to: t };
    }
  }
  const sh = shift.current && shift.current.S === S && shift.current.from === T0 ? shift.current : null;
  React.useLayoutEffect(() => { if (sh && tl.setTime) tl.setTime(sh.to); }, [sh]);
  return sh ? sh.to : T0;
}

// The line shown on the board in the game's place, and the one previewed under the mouse, both dropped when the game
// moves on or plays. vline: { c, at, src, moves, upto, base } while a line is shown: c the game's ply it was shown
// from, at the ply its first move stands in for (c: instead of the move on the board; c + 1: after it), src 'you' (the
// viewer's own moves, from base) or the panel it was picked from. pv: the same shape, previewed until the mouse leaves
function useShownLine(M, cNow, playing) {
  const [vline, setVline] = React.useState(null);
  React.useEffect(() => { if (vline && (playing || cNow !== vline.c)) setVline(null); }, [playing, cNow]);
  const [pv, setPv] = React.useState(null);
  React.useEffect(() => { setPv(null); }, [playing, cNow]);
  // a line steps back to its first move (the viewer's own line back to its starting position), then closes
  const stepLine = (d) => setVline((v) => {
    if (!v) return v;
    const u = v.upto + d, min = v.src === 'you' ? -1 : 0;
    return u < min ? null : { ...v, upto: Math.min(v.moves.length - 1, u) };
  });
  const gamePos = (cc) => (cc < 0 ? M.start.pos : { ...window.ChessCore.posFromFen(M.plies[cc].fen), castle: M.plies[cc].castle, ep: M.plies[cc].ep });
  const newLine = () => ({ c: cNow, at: cNow + 1, src: 'you', moves: [], upto: -1, base: gamePos(cNow) });
  const leaveIfEmpty = () => setVline((v) => (v && v.src === 'you' && v.upto < 0 ? null : v));
  const playOwn = (step) => setVline((v) => { const b = v || newLine(); const prefix = b.moves.slice(0, b.upto + 1); return { ...b, src: 'you', moves: [...prefix, step], upto: prefix.length }; });
  return {
    vline, setVline, pv, setPv, stepLine, gamePos, newLine, leaveIfEmpty, playOwn,
    // the position on the board
    pos: vline ? (vline.upto >= 0 ? vline.moves[vline.upto].pos : vline.base) : gamePos(cNow),
    // the moves from the start to the position on the board: the game's up to the line's, then the line's
    moves: () => (vline ? M.plies.slice(0, vline.at).concat(vline.moves.slice(0, vline.upto + 1)) : M.plies.slice(0, cNow + 1)),
  };
}

// What the rules say about the position on the board (pos, null while nothing is asked): the endgame tablebase's
// answer (tbOn: asked here at all; tablebase: the setting), chasolver's on a dead position (known: the position is dead
// already, so it isn't asked) and the fifty-move rule's. fen() gives the position's full FEN, worked out once here
function useBoardFacts({ pos, fen, tbOn, tablebase, known }) {
  const f = pos ? fen() : null;
  const tb = useTablebase(tbOn ? f : null, tablebase);
  const dead = useDead(pos, known);
  return { tb, dead, fifty: pos ? window.PlayCore.fiftyRule(f, pos) : null, fen: f };
}

// Stockfish on the line shown (vline from useShownLine: the viewer's own, or one picked from the panel): the positions
// before and after its move on the board, with the best move's SAN; null when no line's move is shown
function useOwnLineEval(M, line, sf, tw) {
  const { vline, gamePos } = line;
  const on = !!(sf && vline && vline.upto >= 0);
  const before = on ? M.plies.slice(0, vline.at).map((p) => p.uci).concat(vline.moves.slice(0, vline.upto).map((m) => m.uci)) : null;
  const after = on ? before.concat([vline.moves[vline.upto].uci]) : null;
  const ev = useMoveEval(sf ? sf.engine : null, before, after, sf ? sf.own : window.AnalysisCore.engineSettings().own, M.start.fen, null, cloudSetting(tw), !sf || sf.off);
  if (!on) return null;
  const posBefore = vline.upto > 0 ? vline.moves[vline.upto - 1].pos : vline.base || gamePos(vline.at - 1);
  const bm = ev.before && ev.before.best ? window.ChessCore.applyUci(posBefore, ev.before.best) : null;
  return { ...ev, bestSan: bm ? bm.san : null };
}

// Go deeper's finished results on the loaded analysis's moves, for the session: by position (the start, the analysis's
// engine, the moves), the deepest kept (whichever engine or the cloud gave it), its eval and line. The annotated PGN
// writes their evals and lines (withDeeper); an analysis with other settings starts afresh, as Go deeper's presses do (one with the same settings
// keeps them, as the panel does: they are deeper searches of the same positions)
const DEEPER_SHOWN = new Map();
const deeperBase = (M) => M.start.fen + '|' + M.engine + '|';
const deeperKey = (M, c) => deeperBase(M) + M.plies.slice(0, c + 1).map((q) => q.uci).join(' ');
// M with Go deeper's results in place of the analysis's on the moves it searched (ChessCore.withSearches: the eval on
// the move, the line on the next one; the marks and everything rated from the evals stay the analysis's)
function withDeeper(M) {
  if (M.evalSource !== 'analysis' || !DEEPER_SHOWN.size) return M;
  let key = deeperBase(M);
  const found = M.plies.map((p, i) => {
    key += (i ? ' ' : '') + p.uci; // deeperKey(M, i), built a move at a time
    return DEEPER_SHOWN.get(key) || null;
  });
  return window.ChessCore.withSearches(M, (i) => found[i]);
}

// Go deeper on a move of the loaded analysis, while paused on it (on): from its own search (else the game settings),
// what describes the position after the move (the eval, the Best line, the eval bar, and in the annotated PGN the
// eval and, on the next move, the line: DEEPER_SHOWN); the ratings, graph and accuracy stay the analysis's. On a PGN's own
// evals (Lichess's [%eval]s) too, as the Stockfish switch searches every move: the PGN's eval stands until the search
// passes it, and the annotated PGN, marks and graph stay the PGN's (nothing goes into DEEPER_SHOWN). Not on a position
// the tablebase answered (its result is final): on says when
function useGoDeeper(M, c, on, sf, tw) {
  const p = on ? M.plies[c] : null, settings = sf ? sf.game : window.AnalysisCore.ENGINE;
  // name: the engine running keys Go deeper's results, so lite and full ones never mix
  // lines: as many as the Lines setting asks (the live searches', the same as for the viewer's own moves)
  const base = { name: settings.name, depth: p && p.search ? p.search.depth : settings.depth, time_limit: settings.time_limit, lines: sf && sf.own ? sf.own.lines : 1 };
  const moves = on ? M.plies.slice(0, c + 1).map((q) => q.uci) : null;
  // the Stockfish switch on searches every move deeper by itself (auto), as a press of Go deeper would
  const src = M.evalSource === 'pgn' ? 'pgn' : M.engine;
  const ev = useMoveEval(sf ? sf.engine : null, moves, moves, base, M.start.fen, on ? { cp: cpOf(M, c), depth: base.depth, pv: [], stored: true, src } : null, cloudSetting(tw), !sf || sf.off, !!sf && !sf.off);
  const r = on && M.evalSource === 'analysis' && ev.after && !ev.after.stored && !ev.after.partial && ev.after.cp != null ? ev.after : null;
  React.useEffect(() => {
    if (!r) return;
    const k = deeperKey(M, c), had = DEEPER_SHOWN.get(k);
    if (!had || r.depth > had.depth || (r.lines && r.lines.length > 1 && !(had.lines && had.lines.length > 1))) DEEPER_SHOWN.set(k, { cp: r.cp, depth: r.depth, pv: r.pv || [], lines: r.lines && r.lines.length > 1 ? r.lines : null });
  }, [r]);
  return ev;
}

// Stockfish on a move of a loaded game without an analysis, while paused on it (on), as the free board rates a move: the
// positions before and after it, at the live searches' settings, with the best move's SAN; null when not on (on needs sf)
const NO_OWN = { depth: null, time_limit: 1, lines: 1 }; // the settings when there's no engine (on needs sf: nothing searched)
function useGameMoveEval(M, c, on, sf, tw, gamePos) {
  const after = on ? M.plies.slice(0, c + 1).map((q) => q.uci) : null, before = on ? after.slice(0, -1) : null;
  const ev = useMoveEval(sf ? sf.engine : null, before, after, sf ? sf.own : NO_OWN, M.start.fen, null, cloudSetting(tw), !sf || sf.off);
  if (!on) return null;
  const bm = ev.before && ev.before.best ? window.ChessCore.applyUci(gamePos(c - 1), ev.before.best) : null;
  return { ...ev, bestSan: bm ? bm.san : null };
}

// The transport bar (nav: its label, buttons and Copy FEN) and the keys for the replay: ← → step through a shown line's
// moves, else the game's (as the wheel over the board does: the step returned), End goes to the last move, Esc cancels
// a promotion, then leaves a shown line. goTo(i): paused on ply i, settled; fen(): the position's FEN
function useReplayNav({ nav, M, S, c, line, input, goTo, fen }) {
  const { vline, stepLine, setVline, leaveIfEmpty } = line;
  const step = (d) => { if (vline) stepLine(d); else goTo(c + d); };
  if (nav) {
    nav.current = vline ? {
      label: vline.upto < 0 ? 'Your move' : (vline.src === 'you' ? 'You ' : 'Line ') + lineLabel(M, vline.at, vline.upto, vline.moves[vline.upto].san), color: lineAccent(vline.src),
      hasPrev: true, hasNext: vline.upto < vline.moves.length - 1, prev: () => stepLine(-1), next: () => stepLine(1),
      hasLast: true, last: () => goTo(S.N - 1),
    } : {
      label: c < 0 ? 'Start' : label(M, c), color: c >= 0 && M.plies[c].mark ? clsColor(M.plies[c].cls) : C.last,
      hasPrev: c >= 0, hasNext: c < S.N - 1, prev: () => goTo(c - 1), next: () => goTo(c + 1),
      hasLast: c < S.N - 1, last: () => goTo(S.N - 1),
    };
    // the position on the board as a FEN, for the menu's Copy FEN
    nav.current.fen = fen;
    // the moves to the position on the board, for the Play dialogs' This position
    nav.current.line = () => ({ fen: M.start.fen, moves: line.moves().map((p) => p.uci) });
  }
  const navSig = nav && nav.current ? `${nav.current.label}|${nav.current.hasPrev}|${nav.current.hasNext}|${nav.current.hasLast}` : '';
  React.useEffect(() => { if (nav && nav.listen) nav.listen(); }, [navSig]);
  useKeydown((e) => {
    if (e.shiftKey || hasModifier(e)) return;
    if (e.code === 'Escape' && input.promo) { e.preventDefault(); input.cancelPromo(); leaveIfEmpty(); return; }
    if (e.code === 'Escape' && vline) { e.preventDefault(); setVline(null); return; }
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight' && e.code !== 'End') return;
    e.preventDefault();
    if (e.code === 'End') goTo(Infinity); else step(e.code === 'ArrowRight' ? 1 : -1);
  });
  return step;
}

function GameVideo({ M, tw, d, probe, queen, nav, scheme, sf, orient }) {
  const { T: T0, CUES, authoredTotal, playing: live } = useComposition();
  // the export steps through a paused player; its frames look like playback (no paused-only hints or buttons)
  const playing = live || !!tw.exporting;
  const frame = useFrame(), video = frame.video;
  setLayout(frame); // before the children render, which read the layout
  // a paused one-column page is as tall as its panels; the stage scrolls it
  const flowRef = React.useRef(null);
  useFlowHeight(frame, flowRef);
  setOrient(orient);
  const S = useSchedule(M, CUES, d);
  const tl = useTimeline();
  const T = useHeldSchedule(T0, S);
  const cNow = lastPly(T, S);
  const line = useShownLine(M, cNow, playing), { vline, setVline, pv, setPv, playOwn } = line;
  useMoveSounds(M, T, S, tw, playing, vline);
  const onPreview = (src, moves, j, at = cNow) => setPv(!playing && j != null && j < moves.length ? { c: cNow, at, src, moves, upto: j, base: line.gamePos(at - 1) } : null);
  const onReplyHover = (steps) => setPv(!playing && steps && steps.length && vline ? { ...vline, moves: [...vline.moves.slice(0, vline.upto + 1), ...steps], upto: vline.upto + steps.length } : null);
  const onLine = (src, moves, j, at = cNow) => { setPv(null); if (j < moves.length) { tl.setPlaying(false); input.clear(); setVline({ c: cNow, at, src, moves, upto: j, base: line.gamePos(at - 1) }); } };
  // ---- moves the viewer plays on the board ----
  const explore = () => { tl.setPlaying(false); if (!vline) setVline(line.newLine()); };
  const touchPos = line.pos;
  const input = useBoardInput({ pos: touchPos, onPick: explore, onMiss: line.leaveIfEmpty, onMove: (step) => playOwn(step) });
  // the viewer's circles and arrows, until the position on the board changes
  const draw = useBoardDraw(touchPos.b.join() + touchPos.turn);
  const shownFen = () => window.ChessCore.fenAfter(M.start.fen, line.moves().map((p) => p.san), touchPos);
  // the move after which the game's position is first dead (a line branches from the position after ply at − 1); the
  // tablebase, chasolver and the fifty-move rule on the position on the board, while paused (never in the video or its export)
  const deadAt = useFirstDead(M), pastDead = deadAt != null && (vline ? vline.at - 1 : cNow) >= deadAt;
  const { tb, dead, fifty } = useBoardFacts({ pos: playing ? null : touchPos, fen: shownFen, tbOn: true, tablebase: tw.tablebase !== false, known: pastDead });
  // the result after the last move: the PGN's, with the final position's own end where it gives that result
  const end = M.plies.length ? window.PlayCore.ending({ pos: line.gamePos(M.plies.length - 1), dead: deadAt != null, pgn: { result: M.result, termination: M.headers && M.headers.Termination } }) : null;
  const onTb = (uci) => { const step = window.ChessCore.stepFromUci(touchPos, uci); if (step) { tl.setPlaying(false); input.clear(); playOwn(step); } };
  React.useEffect(() => { if (!vline) input.clear(); }, [vline]);
  const own = useOwnLineEval(M, line, sf, tw);
  const gameEval = useGoDeeper(M, cNow, !!(sf && M.evalSource !== 'none' && !playing && cNow >= 0 && !M.plies[cNow].tb && !vline), sf, tw);
  // a game without an analysis: the move paused on searched live (the Stockfish switch on), while no game analysis runs
  const moveEval = useGameMoveEval(M, cNow, !!(sf && bareGame(M) && !sf.off && !playing && cNow >= 0 && !vline), sf, tw, line.gamePos);
  // the live eval of the position shown, for the eval bar and the arrows: the bare game's search, else Go deeper's
  const liveAfter = moveEval ? moveEval.after : gameEval.after && !gameEval.after.stored ? gameEval.after : null;
  const onReply = (steps) => { setPv(null); setVline((v) => v && { ...v, moves: [...v.moves.slice(0, v.upto + 1), ...steps], upto: v.upto + steps.length }); };
  // the book name of the position on the board while a line is shown (it can reach openings the game never played)
  const lineKey = vline && vline.upto >= 0 ? line.moves().map((p) => p.uci).join(' ') : null;
  const lineBook = React.useMemo(() => {
    if (!lineKey || !window.Openings) return null;
    try { return window.Openings.book().byPly(lineKey.split(' '), M.start.fen).pop() || null; } catch (e) { return null; }
  }, [lineKey, M.start.fen]);
  const settled = (i) => window.ChessCore.settledAt(S, CUES, i);
  const goTo = (i) => { setVline(null); tl.setPlaying(false); tl.setTime(settled(Math.max(-1, Math.min(S.N - 1, i)))); };
  // open on the starting position, paused, with every panel in place
  // (before the first paint, so the title card never flashes); GameApp keys this view on the game, so another game
  // loaded opens the same way, not at the old game's move with its line still shown
  React.useLayoutEffect(() => { if (tl.setPlaying) tl.setPlaying(false); if (tl.setStart) tl.setStart(settled(-1)); }, []);
  const stepBy = useReplayNav({ nav, M, S, c: cNow, line, input, goTo, fen: shownFen });
  const pieces = React.useMemo(() => simulate(M), [M]);
  // the video touches (panels fading in, the camera push, the blunder glow, the final fade, the title and end cards)
  // only while playing or exporting: stepping, exploring and analysing show a still page
  const enter = (i) => (video ? MOTION.enter(cl01((T - (CUES.Opening - 0.5 + i * 0.12)) / 0.7)) : 1);
  let f = 0;
  if (video && tw.cameraPush) S.blunders.forEach((i) => {
    const t0 = S.tp[i] - 0.3, t1 = Math.min(S.tp[i] + S.md[i] + 0.8, i + 1 < S.N ? S.tp[i + 1] - 0.5 : CUES.Outro);
    f = Math.max(f, MOTION.move(cl01((T - t0) / 0.7)) * (1 - MOTION.move(cl01((T - t1) / 0.7))));
  });
  const c = lastPly(T, S);
  if (probe) probe.current = { S, CUES, c };
  const flash = video && tw.blunderGlow !== false && c >= 0 && (M.plies[c].cls === 'blunder' || M.plies[c].checkmate) ? Math.max(0, 1 - Math.abs(T - S.tp[c] - S.md[c] - 0.25) / 0.6) : 0;
  const cx = L.board.x + L.board.size / 2, cy = L.board.y + L.board.size / 2, sc = 1 + 0.1 * f;
  const fade = video ? 1 - cl01((T - (authoredTotal - 0.9)) / 0.8) : 1;
  return (
    <div data-screen-label={'t=' + Math.floor(T) + 's'} style={{ position: 'absolute', inset: 0, background: C.bg, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: fade }}>
        {/* an export keeps the page still and has the compositor zoom the layers in here (data-push, export-draw.js) */}
        <div ref={flowRef} data-push={f > 0 && tw.exporting ? `${sc} ${cx} ${cy}` : undefined} style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', ...flowStyle(), ...(f > 0 && !tw.exporting && { transform: `translate(${cx}px,${cy}px) scale(${sc}) translate(${-cx}px,${-cy}px)` }) }}>
          <EvalBar M={M} T={T} S={S} a={enter(1)} tb={tbBar(tb)} dead={deadBar(dead)} deep={!playing && liveAfter && liveAfter.cp != null ? liveAfter.cp : null} />
          <PlayerBar M={M} T={T} S={S} side="b" a={enter(1)} pieces={pieces} />
          <BoardSpace onStep={tw.exporting ? null : stepBy}>
            <Board M={M} T={T} S={S} a={enter(0)} arrows={tw.bestArrows} pieces={pieces} queen={queen} vline={pv || vline} hide={input.drag && input.drag.moved ? input.drag.from : null} lines={tw.bestArrows ? (own ? lineArrows(own.after) : !playing && !pv && !vline && cNow >= 0 ? (moveEval ? lineArrows(moveEval.after) : nextArrows(M, cNow, liveAfter)) : null) : null} idle={!playing && !pv && !vline} sel={input.sel} />
            <BoardDraw draw={draw} hidden={playing || !!pv}>
              <BoardTouch pos={touchPos} targets={input.targets} drag={input.drag} promo={input.promo} {...input.handlers} />
            </BoardDraw>
          </BoardSpace>
          <PlayerBar M={M} T={T} S={S} side="w" a={enter(1)} pieces={pieces} />
          {L.header && <Header M={M} a={enter(2)} />}
          <MoveList M={M} T={T} S={S} a={enter(3)} paused={!playing} onPick={goTo} deadAt={deadAt} end={end} />
          <Commentary M={M} T={T} S={S} a={enter(4)} book={sf ? sf.book : null} line={lineKey ? { book: lineBook } : null} />
          <Analysis M={M} T={T} S={S} a={enter(5)} vline={vline} onLine={onLine} onPreview={onPreview} onReplyHover={onReplyHover} paused={!playing} sf={sf} own={own} onReply={onReply} deep={gameEval} moveEval={moveEval} gamePos={line.gamePos} tb={tb} onTb={onTb} dead={dead} fifty={fifty} />
          {L.plot && <EvalPlot M={M} T={T} S={S} a={enter(6)} paused={!playing} onPick={goTo} />}
        </div>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: `inset 0 0 220px rgba(228,85,63,${0.55 * flash})` }} />
        {video && <TitleCard M={M} T={T} CUES={CUES} />}
        {video && <EndCard M={M} T={T} CUES={CUES} />}
      </div>
    </div>
  );
}
