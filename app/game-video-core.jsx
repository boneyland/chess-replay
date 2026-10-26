const MOTION = { enter: Easing.easeOutCubic, move: Easing.easeInOutCubic, pop: Easing.easeOutBack };
const lerp = (a, b, k) => a + (b - a) * k;
const cl01 = (v) => clamp(v, 0, 1);
const { winChance, plyCp } = window.ChessCore;

// Frame palettes; light-theme text colours are at least 4.5:1 on the panel. Board squares and the eval bar's white/black halves are the sides' colours and stay put.
const PALETTES = {
  dark: {
    bg: '#13100f', panel: '#1b1715', line: 'rgba(255,236,214,0.09)', ink: '#efe8de', dim: '#8e8276',
    light: '#f0d9b5', dark: '#b58863', last: '#e3b55b',
    best: '#62c483', inaccuracy: '#e6c14d', mistake: '#ec9442', blunder: '#e4553f', none: '#efe8de',
    good: '#5aa9e6', brilliant: '#3cc7bd', interesting: '#c98be0', queen: '#e0609f',
    off: '#2a2320', scrim: '19,16,15', rim: 'drop-shadow(0 0 1px rgba(239,232,222,0.95)) drop-shadow(0 0 1px rgba(239,232,222,0.6))',
  },
  light: {
    bg: '#f2ece3', panel: '#fbf7f1', line: 'rgba(60,40,20,0.13)', ink: '#2a211b', dim: '#76695c',
    light: '#f0d9b5', dark: '#b58863', last: '#8a5e15',
    best: '#237a46', inaccuracy: '#8a6a0a', mistake: '#b05616', blunder: '#c63b29', none: '#2a211b',
    good: '#2a6fae', brilliant: '#1a7a73', interesting: '#8f4fab', queen: '#c03f7c',
    off: '#e4dbcd', scrim: '242,236,227', rim: 'none',
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
const LAST_MOVE = 'rgba(155,199,0,0.41)'; // Lichess's last-move tint, clear on both square colours

const SQ = 96, BW = SQ * 8;
// Frame layouts. Landscape is the 1920×1080 video; portrait (phones) stacks the panels under the board.
// k magnifies a box's contents, so text designed for the wide frame stays readable on a small screen.
const LAYOUTS = {
  wide: {
    // the smallest text (15 px and under) 2 px larger, as in the square frame
    eval: 44, bx: 100, by: 88, bar: { k: 1, gap: 10 }, title: 15, small: 2, hint: 17,
    // header and Moves/Commentary fit their contents; Analysis (long with Queen's lines) takes the rest down to the graph
    header: { x: 916, y: 40, w: 964, h: 174, k: 1 },
    moves: { x: 916, y: 232, w: 330, h: 322, k: 1, rows: 7 },
    comment: { x: 1266, y: 232, w: 614, h: 322, k: 1, text: 1, gap: 18, right: 1 },
    analysis: { x: 916, y: 572, w: 964, h: 340, k: 1, right: 1 },
    plot: { x: 44, y: 930, w: 1836, h: 120, k: 1 },
    card: { k: 1, w: 1700, stack: false },
  },
};
// Compact landscape, for windows under 1300 px wide: the wide frame's panels at their sizes, with the square frame's
// margins, gaps and panel padding (its smallest text 2 px larger too), so the frame is 1800×1040 and shows larger. The
// export draws it at that size.
const COMPACT = { width: 1800, height: 1040 };
LAYOUTS.compact = (() => {
  const m = 20, gap = 14, x = m + 48 + BW + 20, w = COMPACT.width - m - x, py = COMPACT.height - m - 120, my = m + 174 + gap, ay = my + 322 + gap;
  return {
    eval: m, bx: m + 48, by: m + 50, bar: { k: 1, gap: 10 }, title: 15, small: 2, hint: 17, pad: '12px 16px', frameH: COMPACT.height, edge: m,
    header: { x, y: m, w, h: 174, k: 1 },
    moves: { x, y: my, w: 330, h: 322, k: 1, rows: 7 },
    comment: { x: x + 330 + gap, y: my, w: w - 330 - gap, h: 322, k: 1, text: 1, gap: 18, right: 1 },
    analysis: { x, y: ay, w, h: py - gap - ay, k: 1, right: 1 },
    plot: { x: m, y: py, w: COMPACT.width - 2 * m, h: 120, k: 1 },
    card: { k: 1, w: 1640, stack: false },
  };
})();
// Portrait: 840 wide, and as tall as the screen allows. A phone shows it at about 0.43×, so text here is ~27 px
// (about 12 px on screen): no eval graph (the eval bar stays), so Commentary sits right under the board; Moves the full
// width with two move pairs a row.
const PORTRAIT = { width: 840, minHeight: 1810, maxHeight: 2100 };
function tallLayout(H) {
  // Moves gets two thirds of the extra height (each row is 38 px × 1.4), commentary the rest
  const extra = Math.max(0, H - PORTRAIT.minHeight), movesH = 250 + Math.floor(extra * 2 / 3), commentH = 284 + extra - Math.floor(extra * 2 / 3);
  // player bars (40 px × 1.4) sit 5 px from the board, 2 px from the frame's top edge
  const by = 2 + 56 + 5, cy = by + BW + 5 + 56 + 8;
  const ay = cy + commentH + 8, my = ay + 360 + 8;
  return {
    eval: 12, bx: 60, by, bar: { k: 1.4, gap: 5 }, title: 26, titleGap: 44,
    header: null,
    plot: null,
    comment: { x: 4, y: cy, w: 832, h: commentH, k: 1, text: 0.78, label: 1.6, gap: 8 },
    // scrolls: Queen's line and verdict can outgrow it
    analysis: { x: 4, y: ay, w: 832, h: 360, k: 1.6, big: 30, scroll: true },
    moves: { x: 4, y: my, w: 832, h: movesH, k: 1.4, font: 22, cols: 2, rows: Math.max(3, Math.floor((movesH / 1.4 - 64) / 38)) },
    card: { k: 1.3, w: 600, stack: true },
  };
}
// Phone held sideways: 880 high (the board and its player bars, 2 px from the edges), as wide as the screen's shape
// (1900–2400). The board fills the height; Moves and Commentary sit beside it with Analysis under them, all magnified,
// and the eval graph under Analysis.
const SHORT = { height: 880, minWidth: 1900, maxWidth: 2400, maxArea: 560 };
function shortLayout(W) {
  const x = 60 + BW + 24, w = W - x - 12, top = 420, k = 1.22, ph = 120, ay = top + 22, ah = SHORT.height - 10 - ph - 12 - ay;
  return {
    eval: 12, bx: 60, by: 2 + 48 + 6, bar: { k: 1.2, gap: 6 }, title: 16,
    header: null,
    moves: { x, y: 10, w: 330, h: top, k, rows: Math.floor((top / k - 61) / 38) },
    comment: { x: x + 342, y: 10, w: w - 342, h: top, k, text: 1, gap: 14, right: 1 },
    analysis: { x, y: ay, w, h: ah, k, scroll: true, right: 1 },
    plot: { x, y: ay + ah + 12, w, h: ph, k },
    card: { k: 1, w: 1700, stack: false },
  };
}
// Square-ish screen (a desktop window near 1:1, a tablet, an unfolded foldable): 1520 wide, 1400–1720 high. The board
// with the header (players stacked) and Commentary beside it; the eval graph the full width under the board, then
// Analysis and Moves side by side, taking the extra height. Tighter margins, gaps and panel padding than the wide frame,
// its smallest text (15 px and under) 2 px larger, and Commentary's notes and the
// hints under Analysis larger still.
const SQUARE = { width: 1520, minHeight: 1400, maxHeight: 1720 };
function squareLayout(H) {
  const m = 20, gap = 14, hh = 290, cy = m + hh + gap, by = 70, py = by + BW + 10 + 40 + gap, ay = py + 120 + gap, bh = H - ay - m;
  return {
    eval: m, bx: m + 48, by, bar: { k: 1, gap: 10 }, title: 15, small: 2, hint: 20, pad: '12px 16px',
    header: { x: 856, y: m, w: 644, h: hh, k: 1, stack: true },
    comment: { x: 856, y: cy, w: 644, h: by + BW + 50 - cy, k: 1, text: 1, label: 1.25, gap: 14, right: 1 },
    plot: { x: m, y: py, w: 1480, h: 120, k: 1 },
    analysis: { x: m, y: ay, w: 976, h: bh, k: 1, scroll: true, right: 1 },
    moves: { x: 1010, y: ay, w: 490, h: bh, k: 1, font: 26, num: 68, rows: Math.floor((bh - 53) / 38) },
    card: { k: 1, w: 1440, stack: false },
  };
}
let L = LAYOUTS.wide, BX = L.bx, BY = L.by, tallH = 0, shortW = 0, squareH = 0;
// a font size of 15 px or under, raised by the layout's small (the wide, compact and square frames')
const sm = (px) => px + (L.small || 0);
const setLayout = (frame) => {
  if (frame.tall && frame.height !== tallH) { tallH = frame.height; LAYOUTS.tall = tallLayout(tallH); }
  if (frame.short && frame.width !== shortW) { shortW = frame.width; LAYOUTS.short = shortLayout(shortW); }
  if (frame.square && frame.height !== squareH) { squareH = frame.height; LAYOUTS.square = squareLayout(squareH); }
  L = frame.tall ? LAYOUTS.tall : frame.square ? LAYOUTS.square : frame.short ? LAYOUTS.short : frame.compact ? LAYOUTS.compact : LAYOUTS.wide; BX = L.bx; BY = L.by;
};

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
const img = (color, type) => window.PIECE_IMG[color + type.toUpperCase()];

function simulate(M) {
  const board = {}, pieces = [];
  M.start.pos.b.forEach((ch, i) => {
    if (!ch) return;
    const sq = String.fromCharCode(97 + (i % 8)) + (8 - Math.floor(i / 8));
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
function evalNow(M, T, S) {
  const c = lastPly(T, S);
  if (c < 0) return { c, cp: M.evalStart, k: 1 };
  const k = MOTION.move(cl01((T - S.tp[c] - S.md[c] * 0.6) / 0.55));
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
      style={{ ...style, whiteSpace: 'nowrap', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', touchAction: 'pan-x', WebkitMaskImage: fade, maskImage: fade }}>{children}</span>
  );
}
// extra: a node after right that never scrolls with it (Analysis: Go deeper beside the search's depth)
// head: the title row's own contents, in place of title, right and extra (the Analysis panel's)
// progress: 0–1, drawn along the top border (the Analysis panel's while Stockfish searches); null draws none
function Panel({ box, title, right, extra, head, a, style, progress, children }) {
  const { x, y, w, h, k } = box;
  const place = { position: 'absolute', left: x, top: y, width: w / k, height: h / k, boxSizing: 'border-box', borderRadius: 8, opacity: a, transform: `translateY(${(1 - a) * 18}px) scale(${k})`, transformOrigin: '0 0', overflow: 'hidden' };
  return (
    <>
    <div style={{ ...place, background: C.panel, border: `1px solid ${C.line}`, padding: L.pad || '16px 22px', ...(box.scroll && { overflowY: 'auto', overscrollBehavior: 'contain', scrollbarWidth: 'thin' }), ...style }}>
      {(title || head) && (
        // the same heading size in every panel, whatever its magnification k; box.right sizes the text on the right
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: (L.titleGap || 16) / k, font: `600 ${L.title / k}px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.dim, marginBottom: 12 / k }}>
          {head || <><span style={{ flex: 'none' }}>{title}</span><SideScroll style={{ minWidth: 0, flex: 1, textAlign: 'right', letterSpacing: '0.04em', fontSize: `${box.right || 0.85}em` }}>{right}</SideScroll>{extra}</>}
        </div>
      )}
      {children}
    </div>
    {/* over the panel rather than in it, so it covers the border and never scrolls with the contents */}
    {progress != null && (
      <div style={{ ...place, pointerEvents: 'none' }}>
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
    const fits = el.offsetTop + el.offsetHeight <= panel.clientHeight - parseFloat(getComputedStyle(panel).paddingBottom);
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
  const sq = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const light = (r + f) % 2 === 0, [sf, sr] = view(f, r); // the square drawn here
    sq.push(
      <div key={r * 8 + f} style={{ position: 'absolute', left: f * SQ, top: r * SQ, width: SQ, height: SQ, background: light ? C.light : C.dark }}>
        {f === 0 && <span style={{ position: 'absolute', left: 6, top: 4, font: `600 ${sm(14)}px ${MONO}`, color: light ? C.dark : C.light }}>{8 - sr}</span>}
        {r === 7 && <span style={{ position: 'absolute', right: 6, bottom: 3, font: `600 ${sm(14)}px ${MONO}`, color: light ? C.dark : C.light }}>{String.fromCharCode(97 + sf)}</span>}
      </div>
    );
  }
  return sq;
}

// lines: the engine lines' arrows on the viewer's own line (lineArrows)
function Board({ M, T, S, a, arrows, pieces, queen, vline, hide, lines }) {
  const c = lastPly(T, S);
  const sq = boardSquares();
  if (vline) return <LineBoard a={a} sq={sq} v={vline} hide={hide} arrows={lines} />;
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
    <div onDragStart={(e) => e.preventDefault()} style={{ ...NO_SELECT, position: 'absolute', left: BX, top: BY, width: BW, height: BW, borderRadius: 4, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.28)', opacity: a, transform: `scale(${lerp(0.96, 1, a)})` }}>
      {sq}{over}
      {pieces.map((p) => <Piece key={p.id} p={p} T={T} S={S} />)}
      <svg width={BW} height={BW} style={{ position: 'absolute', left: 0, top: 0, zIndex: 6, pointerEvents: 'none' }}>
        {best}
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
const lineLabel = (M, c, j, san) => `${window.ChessCore.moveNo(M.ply0 + c + j)} ${san}`;

// What a search actually did: "Stockfish 19 lite · depth 22 (23 unfinished) · 3.0 s · 1.5M nodes" (the eval is from depth 22)
const engineLabel = (name) => (name || 'Stockfish').replace(/\s*\(browser\)$/, '');
// the portrait frame (no header panel) has room for the numbers only
// the Analysis title row's word on a search: the depth it reached, or the tablebase that answered it
function searchDepth(s) {
  if (s && s.tablebase) return 'Tablebase'; // a game analysis's position the tablebase answered
  return s && s.depth ? 'depth ' + s.depth : null;
}

// The browser engine's menu for the Analysis panel (GameApp provides it): name, the engine's label; pick, the
// Lite/Full choice ({ value, options: [{ value, label }], onChange }) where the full engine is offered; body, the
// engine settings, which take the panel's place while its menu is open
const EngineMenuContext = React.createContext(null);
const headCtl = () => ({ ...NO_SELECT, flex: 'none', height: '1.8em', margin: '-0.4em 0', borderRadius: 5, cursor: 'pointer', border: `1.5px solid ${C.line}`, background: 'transparent', color: C.ink, letterSpacing: 0 }); // C changes with the colour scheme
const stopHere = (e) => e.stopPropagation();
// The Analysis panel's title row (on the right: Go deeper, the search's depth, the engine, the engine menu) and, while the menu is
// open, the engine settings in place of the panel's contents. Only a paused replay offers them; playing (an export
// too) shows the engine's name.
function AnalysisPanel({ box, a, depth, deep, paused, style, children }) {
  const E = React.useContext(EngineMenuContext);
  const [open, setOpen] = React.useState(false);
  const live = !!E && paused, shown = open && live, pick = live && E.pick;
  const name = E ? E.name : 'Stockfish';
  const head = (
    <>
      <span style={{ flex: 'none' }}>Analysis</span>
      <span style={{ flex: 1 }} />
      {/* the engine stays put, next to the menu; Go deeper and the depth come and go to its left */}
      {!shown && paused && <DeeperButton ev={deep} />}
      {!shown && depth && <SideScroll style={{ minWidth: 0, flex: '0 1 auto', letterSpacing: '0.04em', fontSize: `${box.right || 0.85}em` }}>{depth}</SideScroll>}
      {pick
        ? <select aria-label="Engine" value={pick.value} onChange={(e) => { const go = pick.onChange(e.target.value); if (go) setOpen(true); }} onClick={stopHere} onPointerDown={stopHere}
            style={{ ...headCtl(), padding: '0 0.4em', font: 'inherit', fontSize: '1.15em', height: '1.6em', textTransform: 'none', background: C.panel }}>
            {pick.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        : <span style={{ flex: 'none', textTransform: 'none', letterSpacing: '0.04em', color: C.ink }}>{name}</span>}
      {live && (
        <button type="button" aria-label="Engine options" aria-expanded={shown} title="Engine settings" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} onPointerDown={stopHere}
          style={{ ...headCtl(), width: '1.8em', padding: 0, display: 'grid', placeItems: 'center', color: shown ? C.best : C.dim, borderColor: shown ? C.best : C.line }}>
          <svg viewBox="0 0 16 16" width="60%" height="60%" aria-hidden="true"><path d="M2 3.5h12M2 8h12M2 12.5h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      )}
    </>
  );
  return (
    <Panel box={shown ? { ...box, scroll: true } : box} a={a} style={style} head={head} progress={!shown && deep && deep.pending ? deep.progress || 0 : null}>
      {shown ? <div className="an-engine" onClick={stopHere} onPointerDown={stopHere}><div className="twk-flow">{E.body}</div></div> : children}
    </Panel>
  );
}
const lineAccent = (src) => (src === 'queen' ? C.queen : src === 'you' ? C.last : C.best);
// arrows: the engine lines' first moves from the position shown ([{ uci, k }], lineArrows), line 1 the strongest
function LineBoard({ a, sq, v, hide, arrows }) {
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
    <div style={{ ...NO_SELECT, position: 'absolute', left: BX, top: BY, width: BW, height: BW, borderRadius: 4, overflow: 'hidden', boxShadow: `0 0 0 4px ${accent}, 0 4px 12px rgba(0,0,0,0.28)`, opacity: a, pointerEvents: 'none' }}>
      {sq}{over}{pieces}
      {arrows && (
        <svg width={BW} height={BW} style={{ position: 'absolute', left: 0, top: 0, zIndex: 6, pointerEvents: 'none' }}>
          {arrows.slice().reverse().map((r) => <Arrow key={r.k} from={r.uci.slice(0, 2)} to={r.uci.slice(2, 4)} color={BOARD.best} a={r.k === 1 ? 1 : 0.5} grow={1} thin={r.k > 1} />)}
        </svg>
      )}
    </div>
  );
}

// The pieces a pawn can become, in the picker's order, and where each sits: a column on the promotion square's file
const PROMO_PIECES = ['q', 'n', 'r', 'b'];
const promoPieces = (pr) => PROMO_PIECES.map((t, k) => ({ t, sq: pr.to + (pr.white ? 8 : -8) * k }));
function BoardTouch({ pos, sel, targets, drag, promo, onDown, onMove, onUp, onCancel }) {
  const dragged = drag && drag.moved ? pos.b[drag.from] : null;
  return (
    <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
      onDragStart={(e) => e.preventDefault()} title="Drag a piece to try your own move"
      style={{ ...NO_SELECT, position: 'absolute', left: BX, top: BY, width: BW, height: BW, cursor: drag && drag.moved ? 'grabbing' : 'grab', touchAction: 'none' }}>
      {sel != null && <div style={{ position: 'absolute', left: idxXY(sel)[0] * SQ, top: idxXY(sel)[1] * SQ, width: SQ, height: SQ, boxSizing: 'border-box', border: `5px solid ${BOARD.last}`, background: 'rgba(255,255,255,0.12)', pointerEvents: 'none' }} />}
      {targets.map((t) => (
        <div key={t} style={{ position: 'absolute', left: idxXY(t)[0] * SQ, top: idxXY(t)[1] * SQ, width: SQ, height: SQ, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          {pos.b[t]
            ? <div style={{ width: SQ - 8, height: SQ - 8, borderRadius: '50%', border: '6px solid rgba(21,16,13,0.35)', boxSizing: 'border-box' }} />
            : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(21,16,13,0.32)' }} />}
        </div>
      ))}
      {dragged && (
        <img src={img(dragged === dragged.toUpperCase() ? 'w' : 'b', dragged.toLowerCase())} alt=""
          style={{ position: 'absolute', left: drag.x - SQ * 0.55, top: drag.y - SQ * 0.55, width: SQ * 1.1, height: SQ * 1.1, pointerEvents: 'none', filter: 'drop-shadow(0 10px 12px rgba(0,0,0,0.45))', zIndex: 3 }} />
      )}
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

// Move chips for a line; legal moves can be clicked to show the line on the board up to that move
// name: null for none (the caller labels the line); tip: what the moves' tooltips call the line (else the name)
function LineChips({ name, nameColor, accent, moves, ply0, c, legal, sel, onPick, tip }) {
  const what = tip || String(name).toLowerCase();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 6 }}>
      {name != null && <span style={{ color: nameColor, marginRight: 8 }}>{name}</span>}
      {moves.map((m, j) => {
        const ply = ply0 + c + j, white = ply % 2 === 0, ok = j < legal, on = sel === j;
        return (
          <span key={j} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {(white || j === 0) && <span style={{ color: C.dim, marginLeft: j ? 6 : 0, font: `500 ${sm(15)}px ${MONO}` }}>{window.ChessCore.moveNo(ply)}</span>}
            <span className={ok ? 'mv' : undefined} role={ok ? 'button' : undefined} title={ok ? `Show ${what} on the board up to ${m}` : 'Not a legal move in this line'}
              onClick={ok ? (e) => { e.stopPropagation(); onPick(j); } : undefined} tabIndex={ok ? 0 : undefined}
              onKeyDown={ok ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPick(j); } } : undefined}
              style={{ cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.4, padding: '2px 8px', borderRadius: 4, font: `${j === 0 || on ? 700 : 600} 16px ${MONO}`, background: white ? '#f1ebe1' : '#2a2320', color: white ? '#15100d' : '#efe8de', boxShadow: on ? `0 0 0 3px ${C.last}` : 'none', border: j === 0 ? `2px solid ${accent}` : `1px solid ${white ? 'rgba(60,40,20,0.22)' : 'rgba(255,236,214,0.22)'}` }}>{m}</span>
          </span>
        );
      })}
    </div>
  );
}

// tb: the endgame tablebase's result for the position shown ({ cp, txt }, tbBar), drawn instead of the evals
function EvalBar({ M, T, S, a, tb }) {
  if (tb) return <EvalBarView cp={tb.cp} txt={tb.txt} a={a} />;
  const { c, cp } = evalNow(M, T, S);
  const shown = c >= 0 ? M.plies[c] : null;
  const txt = !M.hasEval ? '' : shown && shown.checkmate && T > S.tp[c] + 1 ? fmtEval(shown) : shown && (shown.mate != null || shown.won) ? fmtEval(shown) : fmtEval({ cp });
  return <EvalBarView cp={M.hasEval ? cp : 0} txt={txt} a={a} />;
}
// the bar itself: White's share from cp (White's view), and txt in the part of the bar it favours
function EvalBarView({ cp, txt, a }) {
  const f = (winChance(cp) + 1) / 2;
  const flip = ORIENT === 'b', inWhite = cp >= 0, top = inWhite === flip; // the number sits in the part of the bar it favours
  return (
    <div style={{ ...NO_SELECT, position: 'absolute', left: L.eval, top: BY, width: 36, height: BW, borderRadius: 4, overflow: 'hidden', background: '#2a2320', boxShadow: `0 0 0 1px ${C.line}`, opacity: a }}>
      <div style={{ position: 'absolute', left: 0, right: 0, [flip ? 'top' : 'bottom']: 0, height: f * BW, background: '#ffffff' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: BW / 2 - 1, height: 2, background: C.last, opacity: 0.5 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 8, height: 104, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 22px ${MONO}`, color: inWhite ? '#2a2320' : '#f1ebe1' }}>
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

function PlayerBar({ M, T, S, side, a, pieces }) {
  const P = side === 'w' ? M.white : M.black;
  const cap = { w: {}, b: {} };
  pieces.forEach((p) => { if (p.captured >= 0 && T >= S.tp[p.captured] + S.md[p.captured] * 0.6) cap[p.color][p.type] = (cap[p.color][p.type] || 0) + 1; });
  const opp = side === 'w' ? 'b' : 'w';
  const shown = []; let pts = 0;
  ['q', 'r', 'b', 'n', 'p'].forEach((t) => {
    const n = (cap[opp][t] || 0) - (cap[side][t] || 0);
    pts += n * VALUE[t];
    // black pieces get a light rim so they read on the dark frame
    for (let i = 0; i < n; i++) shown.push(<img key={t + i} src={img(opp, t)} alt="" style={{ width: 30, height: 30, flex: 'none', marginLeft: shown.length ? -8 : 0, filter: opp === 'b' ? C.rim : 'none' }} />);
  });
  const clk = M.hasClock ? clockOf(M, side, T, S) : null;
  const low = clk && clk.s < 60;
  return (
    <div style={{ position: 'absolute', left: BX, width: BW / L.bar.k, top: side === ORIENT ? BY + BW + L.bar.gap : BY - L.bar.gap - 40 * L.bar.k, height: 40, transform: `scale(${L.bar.k})`, transformOrigin: '0 0', display: 'flex', alignItems: 'center', gap: 14, opacity: a }}>
      <span style={{ width: 14, height: 14, borderRadius: 3, background: side === 'w' ? '#f1ebe1' : '#1c1613', border: `1.5px solid ${C.dim}`, flex: 'none' }} />
      <span style={{ font: `600 20px ${SANS}`, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{P.name}</span>
      <span style={{ font: `500 16px ${MONO}`, color: C.dim, whiteSpace: 'nowrap' }}>{[P.title, P.elo].filter(Boolean).join(' ')}</span>
      <span style={{ display: 'flex', alignItems: 'center', marginLeft: 6 }}>{shown}</span>
      {pts > 0 && <span style={{ font: `600 16px ${MONO}`, color: C.dim, marginLeft: 8 }}>+{pts}</span>}
      {clk && <span style={{ marginLeft: 'auto', minWidth: 96, textAlign: 'center', padding: '2px 10px', borderRadius: 5, font: `600 22px ${MONO}`, background: clk.active ? (low ? C.blunder : '#f1ebe1') : C.off, color: clk.active ? '#15100d' : C.dim, boxShadow: clk.active ? `0 0 0 1px ${C.line}` : 'none' }}>{fmtClock(clk.s)}</span>}
    </div>
  );
}

// ---------- right column ----------
function Header({ M, a }) {
  const person = (P, side, align) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, alignItems: align }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, maxWidth: '100%' }}>
        <span style={{ width: 14, height: 14, borderRadius: 3, background: side === 'w' ? '#f1ebe1' : '#1c1613', border: `1.5px solid ${C.dim}`, flex: 'none' }} />
        <span style={{ font: `400 40px ${SERIF}`, color: C.ink, lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{P.name}</span>
      </div>
      <span style={{ font: `500 ${sm(15)}px ${MONO}`, color: C.dim, whiteSpace: 'nowrap' }}>{[[P.title, P.elo].filter(Boolean).join(' '), P.team].filter(Boolean).join(' · ')}</span>
    </div>
  );
  const line = { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };
  // stacked (the square frame's narrower header): the players one above the other, then event, place and date, opening
  if (L.header.stack) return (
    <Panel box={L.header} a={a}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{person(M.white, 'w', 'flex-start')}{person(M.black, 'b', 'flex-start')}</div>
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 8, font: `500 ${sm(15)}px ${MONO}`, color: C.dim, whiteSpace: 'nowrap' }}>
        <span style={{ ...line, color: C.ink }}>{[M.event, M.round && 'Round ' + M.round].filter(Boolean).join(' · ')}</span>
        <span style={line}>{[M.site, M.date].filter(Boolean).join(' · ')}</span>
        {(M.eco || M.opening) && <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {M.eco && <span style={{ flex: 'none', padding: '2px 8px', border: `1px solid ${C.line}`, borderRadius: 4, color: C.ink }}>{M.eco}</span>}
          <span style={line}>{M.opening}</span>
        </div>}
      </div>
    </Panel>
  );
  return (
    <Panel box={L.header} a={a}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
        {person(M.white, 'w', 'flex-start')}
        <span style={{ font: `500 16px ${MONO}`, color: C.dim, paddingTop: 12 }}>vs</span>
        {person(M.black, 'b', 'flex-end')}
      </div>
      {/* two rows, so each shows whole: event and round, then place and date on the right; the opening under them */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 6, font: `500 ${sm(15)}px ${MONO}`, color: C.dim, whiteSpace: 'nowrap', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 18, minWidth: 0 }}>
          <span style={{ ...line, color: C.ink, flexShrink: 0.5 }}>{[M.event, M.round && 'Round ' + M.round].filter(Boolean).join(' · ')}</span>
          <span style={{ ...line, marginLeft: 'auto' }}>{[M.site, M.date].filter(Boolean).join(' · ')}</span>
        </div>
        {(M.eco || M.opening) && <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {M.eco && <span style={{ flex: 'none', padding: '0 8px', border: `1px solid ${C.line}`, borderRadius: 4, color: C.ink }}>{M.eco}</span>}
          <span style={line}>{M.opening}</span>
        </div>}
      </div>
    </Panel>
  );
}

function MoveList({ M, T, S, a, paused, onPick }) {
  const c = lastPly(T, S);
  // COLS move pairs to a row (the phone's full-width list), VIS rows in view
  const ROW = 38, VIS = L.moves.rows, COLS = L.moves.cols || 1, NUM = L.moves.num || 50; // NUM: the move number's column
  const odd = M.ply0 % 2, scrollFor = (i) => Math.max(0, Math.floor((Math.max(i, 0) + odd) / (2 * COLS)) - (VIS - (COLS > 1 ? 2 : 3))) * ROW;
  const k = c >= 0 ? MOTION.move(cl01((T - S.tp[c]) / 0.35)) : 1;
  const scroll = lerp(scrollFor(c - 1), scrollFor(c), k), listRef = React.useRef(null);
  // the list scrolls (wheel, finger, a mouse drag); a new move scrolls it to that move, and leaves it where the viewer put it until the next
  const applied = React.useRef(null);
  React.useLayoutEffect(() => { const el = listRef.current; if (el && applied.current !== scroll) { el.scrollTop = scroll; applied.current = scroll; } });
  // one Tab stop for the whole list (the current move); the arrows move between moves, and focus follows
  const focusPly = Math.max(0, c);
  const moveKey = (e, i) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(i); return; }
    const j = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: i - 2 * COLS, ArrowDown: i + 2 * COLS, Home: 0, End: S.N - 1 }[e.key];
    if (j == null || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault(); e.stopPropagation();
    const to = clamp(j, 0, S.N - 1);
    onPick(to);
    requestAnimationFrame(() => { const el = listRef.current && listRef.current.querySelector(`[data-ply="${to}"]`); if (el) el.focus({ preventScroll: true }); });
  };
  const cell = (i) => {
    if (i < 0) return <span key={i} style={{ color: C.dim }}>…</span>; // the White move before a game that starts on Black's
    if (i >= S.N) return <span key={i} />;
    // moves still to come (seen while paused) are dim rather than faded, so they stay readable
    const P = M.plies[i], cur = i === c, ahead = T < S.tp[i];
    const shown = cl01((T - S.tp[i]) / 0.15);
    return (
      <span key={i} className="mv" role="button" data-ply={i} tabIndex={i === focusPly ? 0 : -1} title={`Go to ${label(M, i)}`} onClick={(e) => { e.stopPropagation(); onPick(i); }}
        onKeyDown={(e) => moveKey(e, i)}
        style={{ opacity: paused ? 1 : shown, padding: '3px 8px', borderRadius: 4, justifySelf: 'start', cursor: 'pointer', boxShadow: cur ? `inset 0 0 0 2px ${C.last}` : 'none', color: ahead ? C.dim : P.cls === 'none' ? C.ink : clsColor(P.cls), fontWeight: cur ? 700 : 500 }}>{P.san}{P.mark || ''}</span>
    );
  };
  const pairs = Math.ceil((S.N + odd) / 2), rows = [], first = Math.floor(M.ply0 / 2);
  for (let r = 0; r * COLS < pairs; r++) {
    const cells = [];
    for (let q = r * COLS; q < Math.min(pairs, (r + 1) * COLS); q++) {
      cells.push(<span key={'n' + q} style={{ color: C.dim, opacity: T >= S.tp[Math.max(0, 2 * q - odd)] || paused ? 1 : 0 }}>{first + q + 1}.</span>, cell(2 * q - odd), cell(2 * q + 1 - odd));
    }
    rows.push(
      <div key={r} style={{ display: 'grid', gridTemplateColumns: COLS > 1 ? `repeat(${COLS}, ${NUM}px 1fr 1fr)` : `${NUM}px 1fr 1fr`, height: ROW, alignItems: 'center' }}>{cells}</div>
    );
  }
  return (
    <Panel box={L.moves} a={a} title="Moves">
      <div ref={listRef} className="moves-list" style={{ position: 'relative', height: VIS * ROW, overflowY: 'auto', overscrollBehavior: 'contain', scrollbarWidth: 'thin', font: `500 ${L.moves.font || 19}px ${MONO}` }}>
        <div>{rows}</div>
      </div>
    </Panel>
  );
}

function Commentary({ M, T, S, a, book, line }) {
  const c = lastPly(T, S);
  // the book name of this position while the game is in book (before the book loads: the game's opening, early on)
  const bookAt = line ? line.book : c < 0 ? null : book ? book[c] : c < 12 && M.opening ? { eco: M.eco, name: M.opening } : null;
  const txt = (c >= 0 ? M.plies[c].comment : M.intro) || '';
  const qtxt = (c >= 0 && M.plies[c].queenText) || '';
  const t0 = c >= 0 ? S.tp[c] + S.md[c] + 0.1 : S.tp[0] - 1.5;
  // one typewriter across the comment, then Queen's sentence
  const total = txt.length + qtxt.length;
  const avail = (c + 1 < S.N ? S.tp[c + 1] : t0 + 8) - t0;
  const n = total ? Math.floor(cl01((T - t0) / Math.max(0.4, Math.min(total / 60, avail * 0.45))) * total) : 0;
  const nh = Math.min(n, txt.length), nq = Math.max(0, n - txt.length);
  const size = Math.round((qtxt ? (txt.length > 90 ? 30 : 36) : txt.length > 140 ? 34 : 44) * L.comment.text);
  const qsize = qtxt.length > 200 ? 22 : 26;
  return (
    <Panel box={L.comment} a={a} title="Commentary" right={bookAt ? `${bookAt.eco} ${bookAt.name}` : null}>
      {total ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: L.comment.gap }}>
          {/* the Analysis panel names the move, unless the game has no analysis */}
          {c >= 0 && !M.hasEval && !M.plies.some((p) => p.best) && <span style={{ font: `600 18px ${MONO}`, color: M.plies[c].mark ? clsColor(M.plies[c].cls) : C.last }}>{label(M, c)}</span>}
          {txt && <span style={{ font: `400 ${size}px/1.14 ${SERIF}`, color: C.ink, textWrap: 'pretty' }}>{txt.slice(0, nh)}<span style={{ opacity: 0 }}>{txt.slice(nh)}</span></span>}
          {qtxt && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: nq > 0 || !txt ? 1 : 0 }}>
              <span style={{ font: `600 ${sm(Math.round(13 * (L.comment.label || 1)))}px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.queen }}>Queen · after {M.plies[c].san}{M.plies[c].mark || ''}</span>
              <span style={{ font: `italic 400 ${qsize}px/1.2 ${SERIF}`, color: C.ink, textWrap: 'pretty', paddingLeft: 12, borderLeft: `2px solid ${C.queen}` }}>{qtxt.slice(0, nq)}<span style={{ opacity: 0 }}>{qtxt.slice(nq)}</span></span>
            </div>
          )}
        </div>
      ) : (
        // a quiet line instead of an empty box: why there's nothing here
        <span style={{ ...NO_SELECT, font: `italic 400 30px/1.25 ${SERIF}`, color: C.dim }}>
          {!M.intro && !M.plies.some((p) => p.comment) ? (M.commentaryHidden ? 'Commentary is off.' : 'This game has no commentary.')
            : c < 0 ? 'Comments appear here as the game plays.' : `No comment on ${label(M, c)}.`}
        </span>
      )}
    </Panel>
  );
}

// tb: the endgame tablebase's answer for the position on the board (useTablebase); onTb plays one of its moves
function Analysis({ M, T, S, a, vline, onLine, paused, sf, own, onReply, deep, tb, onTb }) {
  const c = lastPly(T, S);
  // the Tablebase block goes under the lines; the panel scrolls to it where it doesn't fit
  const box = tb ? { ...L.analysis, scroll: true } : L.analysis;
  const tbEl = tb && <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.line}` }}><TablebaseBlock t={tb} onPlay={onTb} /></div>;
  // Go deeper's search of this move, once it has passed the analysis's (deep: useMoveEval's)
  const deeper = paused && deep && deep.after && !deep.after.stored ? deep.after : null;
  // this move's own search when the analysis recorded it, else the engine settings
  const depth = searchDepth(deeper || (c >= 0 ? M.plies[c].search : null));
  if (own && vline && vline.src === 'you' && vline.upto >= 0) {
    return (
      <AnalysisPanel box={box} a={a} paused={paused} depth={sf && (sf.status === 'unavailable' || sf.status === 'stopped') ? null : searchDepth(own.after)} deep={own}>
        <OwnMoveAnalysis M={M} vline={vline} own={own} status={sf ? sf.status : 'idle'} onReply={onReply} />
        {tbEl}
        <span style={{ display: 'block', marginTop: 8, font: `500 ${sm(15)}px ${MONO}`, color: C.dim }}>
          <span style={{ color: lineAccent('you') }}>Your moves: {vline.moves.slice(0, vline.upto + 1).map((m, j) => (j === 0 || (M.ply0 + vline.at + j) % 2 === 0 ? lineLabel(M, vline.at, j, m.san) : m.san)).join(' ')}</span> · ← → step · Esc returns to the game
        </span>
      </AnalysisPanel>
    );
  }
  if (!M.hasEval && !M.plies.some((p) => p.best)) {
    return <AnalysisPanel box={box} a={a} paused={paused} depth={depth}>{sf ? <EngineEmptyState M={M} sf={sf} paused={paused} /> : <span style={{ font: `400 26px ${SERIF}`, color: C.dim, fontStyle: 'italic' }}>No engine analysis loaded.</span>}{tbEl}</AnalysisPanel>;
  }
  if (c < 0) return (
    <AnalysisPanel box={box} a={a} paused={paused} depth={depth}>
      {paused && <span style={{ ...NO_SELECT, font: `500 ${L.hint || 17}px ${MONO}`, color: C.dim }}>Press play to watch the game, or drag a piece to try your own move.</span>}
      {sf && !M.hasAnalysis && (sf.run.state === 'running' || paused) && <div style={{ marginTop: 16 }}><EngineEmptyState M={M} sf={sf} paused={paused} compact /></div>}
      {tbEl}
    </AnalysisPanel>
  );
  const P = M.plies[c], cls = P.cls;
  const k = cl01((T - S.tp[c] - S.md[c]) / 0.25);
  const { cp } = evalNow(M, T, S);
  const col = cls === 'none' ? C.ink : clsColor(cls);
  const big = L.analysis.big || 38; // the move and eval headline
  // Queen's line from before this move (its scores are left out: often off, and they squeezed the move's labels onto more lines)
  const Qp = P.queen || {};
  // P.best: the engine preferred another move (a mistake, or an equally good move rated best with 0 cp lost)
  const sfLegal = P.best ? playLineCached(M, c, P.best.line.slice(0, 8)) : [];
  const agreeLegal = cls === 'best' && P.line && P.line.length ? playLineCached(M, c, P.line.slice(0, 8)) : [];
  // name the engine (the analysis may come from another one), and say where Queen stands once it has looked
  const engName = P.tbBefore ? 'The tablebase' : (M.engine || '').split(' · ')[0] || 'The engine';
  const qPick = Qp.before && Qp.before.best ? Qp.before : null;
  const agreeText = `${engName} agrees with the move played.` + (qPick ? (qPick.best === P.uci ? ' So does Queen.' : ` Queen preferred ${qPick.bestSan || qPick.best}.`) : '');
  const qLine = Qp.before && Qp.before.line ? Qp.before.line.split(/\s+/).filter((x) => x && !/^\d+\.+$/.test(x) && !/^\d+\.\.\.$/.test(x)).map((x) => x.replace(/^\d+\.+/, '')).filter(Boolean).slice(0, 6) : [];
  const qLegal = qLine.length ? playLineCached(M, c, qLine) : [];
  return (
    <AnalysisPanel box={box} a={a} paused={paused} depth={depth} deep={M.hasEval ? deep : null}>
      <div style={{ opacity: k, transform: `translateY(${(1 - k) * 8}px)` }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28 }}>
          <span style={{ font: `700 ${big}px ${MONO}`, color: col }}>{label(M, c)}</span>
          {M.hasEval && <span style={{ marginLeft: 'auto', font: `700 ${big}px ${MONO}`, color: C.ink }}>{deeper ? fmtSf(deeper.cp) : (P.mate != null || P.won) && k >= 1 ? fmtEval(P) : fmtEval({ cp })}</span>}
        </div>
        {/* the verdict spans the panel under the move and the eval; spaced parts rather than " · " separators, so a
            line too long for a narrow panel breaks between them */}
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', columnGap: 14, font: `600 16px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: col }}>
          {[P.checkmate ? 'Checkmate' : CLASS_LABEL[cls], P.loss > 0 && `−${P.loss} cp`, cls === 'best' && P.best && P.best.line[0] && `as good as ${P.best.line[0]}`].filter(Boolean).map((t) => <span key={t} style={{ whiteSpace: 'nowrap' }}>{t}</span>)}
        </div>
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, font: `500 18px ${MONO}`, color: C.dim, display: 'flex', flexDirection: 'column', gap: 8, opacity: k }}>
        {P.best && P.best.line.length ? (
          <LineChips name="Best line" nameColor={C.ink} accent={C.best} moves={P.best.line.slice(0, 8)} ply0={M.ply0} c={c} legal={sfLegal.length}
            sel={vline && vline.src === 'sf' ? vline.upto : null} onPick={(j) => onLine('sf', sfLegal, j)} />
        ) : cls === 'best' && agreeLegal.length ? (
          <LineChips name="Best line" nameColor={C.ink} accent={C.best} moves={P.line.slice(0, 8)} ply0={M.ply0} c={c} legal={agreeLegal.length}
            sel={vline && vline.src === 'sf' ? vline.upto : null} onPick={(j) => onLine('sf', agreeLegal, j)} />
        ) : cls === 'best' ? <span>{agreeText}</span> : <span />}
        {qLine.length > 0 && (
          <LineChips name="Queen line" nameColor={C.queen} accent={C.queen} moves={qLine} ply0={M.ply0} c={c} legal={qLegal.length}
            sel={vline && vline.src === 'queen' ? vline.upto : null} onPick={(j) => onLine('queen', qLegal, j)} />
        )}
        {P.advice && <span style={{ color: C.inaccuracy }}>{P.advice}</span>}
        {tb && <div style={{ paddingTop: 8, borderTop: `1px solid ${C.line}` }}><TablebaseBlock t={tb} onPlay={onTb} /></div>}
        {vline && (
          <span style={{ font: `500 ${sm(15)}px ${MONO}`, color: C.dim }}>
            <span style={{ color: lineAccent(vline.src) }}>
              {vline.src === 'you'
                ? (vline.upto < 0 ? 'Your moves: drag a piece to play' : `Your moves: ${vline.moves.slice(0, vline.upto + 1).map((m, j) => (j === 0 || (M.ply0 + vline.at + j) % 2 === 0 ? lineLabel(M, vline.at, j, m.san) : m.san)).join(' ')}`)
                : `On the board: ${vline.src === 'queen' ? 'Queen line' : 'best line'} to ${lineLabel(M, vline.at, vline.upto, vline.moves[vline.upto].san)} · drag a piece to branch off`}
            </span> · ← → step · Esc returns to the game
          </span>
        )}
        {sf && !M.hasAnalysis && (sf.run.state === 'running' || paused) && <EngineEmptyState M={M} sf={sf} paused={paused} compact />}
        {!vline && paused && M.hasEval && <FitOrHide style={{ ...NO_SELECT, font: `500 ${L.hint || 15}px ${MONO}`, color: C.dim }}>Tip: drag a piece on the board to try your own move.</FitOrHide>}
      </div>
    </AnalysisPanel>
  );
}

function EvalPlot({ M, T, S, a, paused, onPick }) {
  const { c, k } = evalNow(M, T, S);
  const PLOT = L.plot, W = PLOT.w / PLOT.k - 40, H = PLOT.h / PLOT.k - 30, mid = H / 2, N = S.N;
  const [hover, setHover] = React.useState(null);
  const down = React.useRef(false), fade = React.useRef(null);
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
    <div style={{ ...NO_SELECT, position: 'absolute', left: PLOT.x, top: PLOT.y, width: PLOT.w / PLOT.k, height: PLOT.h / PLOT.k, transform: `scale(${PLOT.k})`, transformOrigin: '0 0', boxSizing: 'border-box', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: '10px 20px', opacity: a }}>
      <svg width={W} height={H + 14} style={{ display: 'block', overflow: 'visible', cursor: 'pointer', touchAction: 'none' }}
        onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {} down.current = true; clearTimeout(fade.current); setHover(plyAt(e)); }}
        onPointerMove={(e) => { if (down.current || e.pointerType === 'mouse') setHover(plyAt(e)); }}
        onPointerUp={(e) => {
          if (!down.current) return;
          down.current = false; onPick(plyAt(e));
          if (e.pointerType !== 'mouse') fade.current = setTimeout(() => setHover(null), 1200); // let a finger see where it landed
        }}
        onPointerCancel={() => { down.current = false; setHover(null); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !down.current) setHover(null); }}>
        <title>Click to jump to a move</title>
        <rect x="0" y="0" width={W} height={H} fill="transparent" />
        <defs>
          <clipPath id="cp-up"><rect x="0" y="-10" width={W} height={mid + 10} /></clipPath>
          <clipPath id="cp-dn"><rect x="0" y={mid} width={W} height={mid + 10} /></clipPath>
        </defs>
        <line x1="0" x2={W} y1={mid} y2={mid} stroke={C.line} strokeWidth="2" />
        {ticks.map(({ m, at }) => (
          <g key={m}>
            <line x1={px(at)} x2={px(at)} y1="0" y2={H} stroke={C.line} strokeWidth="1" />
            <text x={px(at) + 6} y={H + 12} fill={C.dim} style={{ font: `500 ${sm(12)}px ${MONO}` }}>{m}</text>
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
          <text x={W / 2} y={mid + 5} textAnchor="middle" fill={C.dim} style={{ font: `500 ${sm(14)}px ${MONO}` }}>No evaluation data</text>
        )}
        {hover != null && (() => {
          const x = px(hover + 1), name = hover < 0 ? 'Start' : label(M, hover), w = name.length * 9 + 16;
          const bx = Math.min(Math.max(x - w / 2, 0), W - w);
          return (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={x} x2={x} y1="0" y2={H} stroke={C.last} strokeWidth="2" opacity="0.8" />
              <rect x={bx} y={-6} width={w} height={22} rx="4" fill={C.bg} stroke={C.last} strokeWidth="1" />
              <text x={bx + w / 2} y={10} textAnchor="middle" fill={C.ink} style={{ font: `600 ${sm(14)}px ${MONO}` }}>{name}</text>
            </g>
          );
        })()}
        <text x="4" y="12" fill={C.dim} style={{ font: `600 ${sm(11)}px ${MONO}`, letterSpacing: '0.1em' }}>WHITE</text>
        <text x="4" y={H - 4} fill={C.dim} style={{ font: `600 ${sm(11)}px ${MONO}`, letterSpacing: '0.1em' }}>BLACK</text>
      </svg>
    </div>
  );
}

// ---------- title & end cards ----------
function TitleCard({ M, T, CUES }) {
  const out = 1 - cl01((T - (CUES.Opening - 0.7)) / 0.6);
  if (out <= 0) return null;
  const st = (d) => { const k = MOTION.enter(cl01((T - d) / 0.8)); return { opacity: k, transform: `translateY(${(1 - k) * 22}px)` }; };
  const len = M.white.short.length + M.black.short.length;
  // side by side in the wide frame; one name per line in the portrait one
  const size = L.card.stack ? Math.min(120, Math.floor(1300 / Math.max(M.white.short.length, M.black.short.length, 6))) : Math.min(130, Math.floor(1560 / (len * 0.5 + 3)));
  const sub = (P) => [[P.title, P.elo].filter(Boolean).join(' '), P.team].filter(Boolean).join(' · ');
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.bg, opacity: out, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, transform: `scale(${(1 + T * 0.006) * L.card.k})`, maxWidth: L.card.w, textAlign: 'center' }}>
        <span style={{ ...st(0.3), font: `600 20px ${MONO}`, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.last }}>{[M.event, M.round && 'Round ' + M.round].filter(Boolean).join(' · ')}</span>
        <div style={{ display: 'flex', flexDirection: L.card.stack ? 'column' : 'row', alignItems: L.card.stack ? 'center' : 'baseline', gap: L.card.stack ? 12 : 40 }}>
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
  const bar = (P, d) => {
    const g = MOTION.move(cl01((T - CUES.Outro - d) / 1.2));
    return (
      <div style={{ ...st(d), display: 'grid', gridTemplateColumns: L.card.stack ? '190px 300px 100px' : '320px 520px 110px', alignItems: 'center', gap: 24 }}>
        <span style={{ font: `500 24px ${SANS}`, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{P.name}</span>
        <div style={{ height: 12, borderRadius: 6, background: C.off, overflow: 'hidden' }}><div style={{ width: `${P.acc * g}%`, height: '100%', background: C.best }} /></div>
        <span style={{ font: `700 24px ${MONO}`, color: C.ink, textAlign: 'right' }}>{(P.acc * g).toFixed(1)}%</span>
      </div>
    );
  };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: `rgba(${C.scrim},${0.86 * k})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
     <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, flex: 'none', transform: `scale(${L.card.k})` }}>
      <span style={{ ...st(0.3), font: `400 170px ${SERIF}`, color: C.ink, lineHeight: 1 }}>{res}</span>
      {verdict && <span style={{ ...st(0.6), font: `400 44px ${SERIF}`, color: C.ink }}>{verdict}</span>}
      {M.conclusion && <span style={{ ...st(0.8), font: `400 30px ${SERIF}`, color: C.dim, fontStyle: 'italic', maxWidth: Math.min(1100, L.card.w), textAlign: 'center' }}>{M.conclusion}</span>}
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
  const [drag, setDrag] = React.useState(null); // { from, x, y, x0, y0, moved } in board pixels
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
        onPick(); setSel(p.sq); setDrag({ from: p.sq, x: p.x, y: p.y, x0: p.x, y0: p.y, moved: false });
      } else { setSel(null); onMiss(); }
    },
    onMove: (e) => { if (!drag) return; const p = boardXY(e); setDrag((d) => d && { ...d, x: p.x, y: p.y, moved: d.moved || Math.hypot(p.x - d.x0, p.y - d.y0) > 14 }); },
    onUp: (e) => {
      if (!drag) return;
      const p = boardXY(e), d = drag;
      setDrag(null);
      if (!d.moved) return; // a tap keeps the piece selected; the next tap picks its square
      if (p.sq !== d.from && playMove(d.from, p.sq)) setSel(null); else { setSel(null); onMiss(); }
    },
    onCancel: () => setDrag(null),
  };
  const cancelPromo = () => setPromo(null);
  const clear = () => { setSel(null); setDrag(null); setPromo(null); };
  return { sel, drag, promo, targets, handlers, cancelPromo, clear };
}

function GameVideo({ M, tw, d, probe, queen, nav, scheme, sf, orient }) {
  const { T: T0, CUES, authoredTotal, playing: live } = useComposition();
  // the export steps through a paused player; its frames look like playback (no paused-only hints or buttons)
  const playing = live || !!tw.exporting;
  setLayout(useFrame()); // before the children render, which read the layout
  setOrient(orient);
  const S = useSchedule(M, CUES, d);
  // When the schedule changes (a Queen answer lengthens a move's hold, a commentary source is turned off), keep the
  // board on the same move. The time is moved in this render, not after it: the old time on the new schedule is
  // another move, which the board would draw (and slide its pieces back from) for a frame
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
  const T = sh ? sh.to : T0;
  React.useLayoutEffect(() => { if (sh && tl.setTime) tl.setTime(sh.to); }, [sh]);
  const [vline, setVline] = React.useState(null); // { c, src, moves, upto } while a line is shown on the board
  const cNow = lastPly(T, S);
  React.useEffect(() => { if (vline && (playing || cNow !== vline.c)) setVline(null); }, [playing, cNow]);
  useMoveSounds(M, T, S, tw, playing, vline);
  const onLine = (src, moves, j) => { if (j < moves.length) { tl.setPlaying(false); input.clear(); setVline({ c: cNow, at: cNow, src, moves, upto: j }); } };
  // a line steps back to its first move (the viewer's own line back to its starting position), then closes
  const stepLine = (d) => setVline((v) => {
    if (!v) return v;
    const u = v.upto + d, min = v.src === 'you' ? -1 : 0;
    return u < min ? null : { ...v, upto: Math.min(v.moves.length - 1, u) };
  });
  // ---- moves the viewer plays on the board ----
  const gamePos = (cc) => (cc < 0 ? M.start.pos : { ...window.ChessCore.posFromFen(M.plies[cc].fen), castle: M.plies[cc].castle, ep: M.plies[cc].ep });
  const curPos = () => (vline ? (vline.upto >= 0 ? vline.moves[vline.upto].pos : vline.base) : gamePos(cNow));
  const newLine = () => ({ c: cNow, at: cNow + 1, src: 'you', moves: [], upto: -1, base: gamePos(cNow) });
  const explore = () => { tl.setPlaying(false); if (!vline) setVline(newLine()); };
  const leaveIfEmpty = () => setVline((v) => (v && v.src === 'you' && v.upto < 0 ? null : v));
  const touchPos = curPos();
  const input = useBoardInput({
    pos: touchPos, onPick: explore, onMiss: leaveIfEmpty,
    onMove: (step) => playOwn(step),
  });
  const playOwn = (step) => setVline((v) => { const b = v || newLine(); const prefix = b.moves.slice(0, b.upto + 1); return { ...b, src: 'you', moves: [...prefix, step], upto: prefix.length }; });
  // the endgame tablebase for the position on the board, while paused (never in the video or its export)
  const shownFen = () => window.ChessCore.fenAfter(M.start.fen, (vline ? M.plies.slice(0, vline.at).concat(vline.moves.slice(0, vline.upto + 1)) : M.plies.slice(0, cNow + 1)).map((p) => p.san), touchPos);
  const tb = useTablebase(playing ? null : shownFen(), tw.tablebase !== false);
  const onTb = (uci) => { const step = window.ChessCore.stepFromUci(touchPos, uci); if (step) { tl.setPlaying(false); input.clear(); playOwn(step); } };
  React.useEffect(() => { if (!vline) input.clear(); }, [vline]);
  // Stockfish on the viewer's line: the positions before and after the move on the board, as move lists from the start
  const ownOn = !!(sf && vline && vline.src === 'you' && vline.upto >= 0);
  const ownBefore = ownOn ? M.plies.slice(0, vline.at).map((p) => p.uci).concat(vline.moves.slice(0, vline.upto).map((m) => m.uci)) : null;
  const ownAfter = ownOn ? ownBefore.concat([vline.moves[vline.upto].uci]) : null;
  const ownEval = useMoveEval(sf ? sf.engine : null, ownBefore, ownAfter, sf ? sf.own : window.AnalysisCore.engineSettings().own, M.start.fen);
  // Go deeper on a move of the loaded analysis, while paused on it: from its own search (else the game settings), the
  // eval it shows only (the ratings, graph and accuracy stay the analysis's). Not on a PGN's own evals, which have no
  // best lines for it to go with: those come from analysing the game
  // (not on a position the tablebase answered: its result is final)
  const gameOn = !!(sf && M.evalSource === 'analysis' && !playing && cNow >= 0 && !M.plies[cNow].tb && !(vline && vline.src === 'you'));
  const gameP = gameOn ? M.plies[cNow] : null, gameSettings = sf ? sf.game : window.AnalysisCore.ENGINE;
  // name: the engine running keys Go deeper's results, so lite and full ones never mix
  const gameBase = { name: gameSettings.name, depth: gameP && gameP.search ? gameP.search.depth : gameSettings.depth, time_limit: gameSettings.time_limit };
  const gameMoves = gameOn ? M.plies.slice(0, cNow + 1).map((p) => p.uci) : null;
  const gameEval = useMoveEval(sf ? sf.engine : null, gameMoves, gameMoves, gameBase, M.start.fen, gameOn ? { cp: cpOf(M, cNow), depth: gameBase.depth, pv: [], stored: true, src: M.engine } : null);
  let own = null;
  if (ownOn) {
    const posBefore = vline.upto > 0 ? vline.moves[vline.upto - 1].pos : vline.base || gamePos(vline.at - 1);
    const bm = ownEval.before && ownEval.before.best ? window.ChessCore.applyUci(posBefore, ownEval.before.best) : null;
    own = { ...ownEval, bestSan: bm ? bm.san : null };
  }
  const onReply = (steps) => setVline((v) => v && { ...v, moves: [...v.moves.slice(0, v.upto + 1), ...steps], upto: v.upto + steps.length });
  // the book name of the position on the board while a line is shown (it can reach openings the game never played)
  const lineKey = vline && vline.upto >= 0 ? M.plies.slice(0, vline.at).map((p) => p.uci).concat(vline.moves.slice(0, vline.upto + 1).map((m) => m.uci)).join(' ') : null;
  const lineBook = React.useMemo(() => {
    if (!lineKey || !window.Openings) return null;
    try { return window.Openings.book().byPly(lineKey.split(' '), M.start.fen).pop() || null; } catch (e) { return null; }
  }, [lineKey, M.start.fen]);
  const settled = (i) => (i < 0 ? S.tp[0] - 0.3 : i + 1 < S.N ? S.tp[i + 1] - 0.12 : Math.min(S.tp[i] + S.md[i] + 3, CUES.Outro - 0.1));
  const goTo = (i) => { setVline(null); tl.setPlaying(false); tl.setTime(settled(Math.max(-1, Math.min(S.N - 1, i)))); };
  // open on the starting position, paused, with every panel in place
  // (before the first paint, so the title card never flashes)
  React.useLayoutEffect(() => { if (tl.setStart) tl.setStart(settled(-1)); }, []);
  const navRef = React.useRef(null);
  navRef.current = { c: lastPly(T, S), goTo, vline, stepLine, setVline, promo: input.promo, cancelPromo: input.cancelPromo, leaveIfEmpty };
  if (nav) {
    const cc = navRef.current.c;
    nav.current = vline ? {
      label: vline.upto < 0 ? 'Your move' : (vline.src === 'you' ? 'You ' : 'Line ') + lineLabel(M, vline.at, vline.upto, vline.moves[vline.upto].san), color: lineAccent(vline.src),
      hasPrev: true, hasNext: vline.upto < vline.moves.length - 1, prev: () => stepLine(-1), next: () => stepLine(1),
      hasLast: true, last: () => goTo(S.N - 1),
    } : {
      label: cc < 0 ? 'Start' : label(M, cc), color: cc >= 0 && M.plies[cc].mark ? clsColor(M.plies[cc].cls) : C.last,
      hasPrev: cc >= 0, hasNext: cc < S.N - 1, prev: () => goTo(cc - 1), next: () => goTo(cc + 1),
      hasLast: cc < S.N - 1, last: () => goTo(S.N - 1),
    };
    // the position on the board as a FEN, for the menu's Copy FEN
    nav.current.fen = shownFen;
  }
  const navSig = nav && nav.current ? `${nav.current.label}|${nav.current.hasPrev}|${nav.current.hasNext}|${nav.current.hasLast}` : '';
  React.useEffect(() => { if (nav && nav.listen) nav.listen(); }, [navSig]);
  React.useEffect(() => {
    const onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const n = navRef.current;
      if (e.code === 'Escape' && n.promo) { e.preventDefault(); n.cancelPromo(); n.leaveIfEmpty(); return; }
      if (e.code === 'Escape' && n.vline) { e.preventDefault(); n.setVline(null); return; }
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight' && e.code !== 'End') return;
      e.preventDefault(); // claims the key before the stage's own scrub handler
      if (n.vline && e.code !== 'End') { n.stepLine(e.code === 'ArrowRight' ? 1 : -1); return; }
      const { c, goTo: go } = n;
      go(e.code === 'End' ? Infinity : e.code === 'ArrowRight' ? c + 1 : c - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const pieces = React.useMemo(() => simulate(M), [M]);
  const enter = (i) => MOTION.enter(cl01((T - (CUES.Opening - 0.5 + i * 0.12)) / 0.7));
  let f = 0;
  if (tw.cameraPush) S.blunders.forEach((i) => {
    const t0 = S.tp[i] - 0.3, t1 = Math.min(S.tp[i] + S.md[i] + 0.8, i + 1 < S.N ? S.tp[i + 1] - 0.5 : CUES.Outro);
    f = Math.max(f, MOTION.move(cl01((T - t0) / 0.7)) * (1 - MOTION.move(cl01((T - t1) / 0.7))));
  });
  const c = lastPly(T, S);
  if (probe) probe.current = { S, c };
  const flash = tw.blunderGlow !== false && c >= 0 && (M.plies[c].cls === 'blunder' || M.plies[c].checkmate) ? Math.max(0, 1 - Math.abs(T - S.tp[c] - S.md[c] - 0.25) / 0.6) : 0;
  const cx = BX + BW / 2, cy = BY + BW / 2, sc = 1 + 0.1 * f;
  const fade = 1 - cl01((T - (authoredTotal - 0.9)) / 0.8);
  return (
    <div data-screen-label={'t=' + Math.floor(T) + 's'} style={{ position: 'absolute', inset: 0, background: C.bg, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: fade }}>
        <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${cx}px,${cy}px) scale(${sc}) translate(${-cx}px,${-cy}px)` }}>
          <EvalBar M={M} T={T} S={S} a={enter(1)} tb={tbBar(tb)} />
          <PlayerBar M={M} T={T} S={S} side="b" a={enter(1)} pieces={pieces} />
          <Board M={M} T={T} S={S} a={enter(0)} arrows={tw.bestArrows} pieces={pieces} queen={queen} vline={vline} hide={input.drag && input.drag.moved ? input.drag.from : null} lines={tw.bestArrows && own ? lineArrows(own.after) : null} />
          <BoardTouch pos={touchPos} sel={input.sel} targets={input.targets} drag={input.drag} promo={input.promo} {...input.handlers} />
          <PlayerBar M={M} T={T} S={S} side="w" a={enter(1)} pieces={pieces} />
          {L.header && <Header M={M} a={enter(2)} />}
          <MoveList M={M} T={T} S={S} a={enter(3)} paused={!playing} onPick={goTo} />
          <Commentary M={M} T={T} S={S} a={enter(4)} book={sf ? sf.book : null} line={lineKey ? { book: lineBook } : null} />
          <Analysis M={M} T={T} S={S} a={enter(5)} vline={vline} onLine={onLine} paused={!playing} sf={sf} own={own} onReply={onReply} deep={gameEval} tb={tb} onTb={onTb} />
          {L.plot && <EvalPlot M={M} T={T} S={S} a={enter(6)} paused={!playing} onPick={goTo} />}
        </div>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: `inset 0 0 220px rgba(228,85,63,${0.55 * flash})` }} />
        <TitleCard M={M} T={T} CUES={CUES} />
        <EndCard M={M} T={T} CUES={CUES} />
      </div>
    </div>
  );
}
