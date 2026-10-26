// The page's boxes, from the window's size: where the board, eval bar, player bars and each panel go, in one column
// or two. Pure numbers in, plain boxes { x, y, w, h, scroll } out (null where a view or size has none), so the views
// only place what this says. columns() makes the one decision that depends on the size alone; compute() lays a view out.
(function () {
  const MARGIN = 12, GAP = 10, BAR_GAP = 4;
  const EVAL_W = 28, EVAL_GAP = 8, EVAL_TOTAL = EVAL_W + EVAL_GAP;
  const BOARD_MAX = 900, BOARD_MIN = 200, BOARD_OK = 360, BOARD_BACK = 380;
  const SIDEBAR_MIN = 320, MOVES_W = 230, COMMENT_MIN = 150;
  const HEADER_H = 64, PLOT_H = 110, PLOT_SIDE_H = 80, PLOT_BELOW_MIN_H = 700;
  const ONE_COL = { comment: 200, analysis: 260, moves: 240, panel: 260 }; // paused heights, times text
  const VIDEO_PREF = [96, 120, 96], PANEL_FLOOR = 48; // comment, analysis, moves under a video's board
  const MOVE_ROW = 38 * 0.8, MOVE_TITLE = 40;

  const TEXT_SIZES = { Small: 0.9, Default: 1, Large: 1.15, Larger: 1.3 };
  const textScale = (name) => (Object.prototype.hasOwnProperty.call(TEXT_SIZES, name) ? TEXT_SIZES[name] : 1);

  const barH = (text) => 40 * text * 0.8;
  const barsTotal = (text) => 2 * barH(text) + 2 * BAR_GAP;
  const box = (x, y, w, h) => ({ x, y, w: Math.max(0, w), h: Math.max(0, h), scroll: true });

  // 1 or 2 columns. One column when the window is tall for its width (switching at 1.2 wide, back at 1.1 wide) or the
  // board beside the sidebar would be under 360 px (380 to come back): by the room left, not by device. A window too
  // short for the one-column page (board, bars and three panels at their floors) keeps two columns.
  function columns({ w, h, text = 1, prevCols = null }) {
    const boardW = w - 2 * MARGIN - GAP - SIDEBAR_MIN * text - EVAL_TOTAL;
    const aspect = prevCols === 2 ? 1.2 : prevCols === 1 ? 1.1 : 1.15;
    const tall = prevCols === 1 ? h >= 1.1 * w : h > aspect * w;
    const narrow = boardW < (prevCols === 1 ? BOARD_BACK : BOARD_OK);
    const fits = h >= 2 * MARGIN + barsTotal(text) + BOARD_MIN + GAP + 3 * PANEL_FLOOR + 2 * GAP;
    return fits && (tall || narrow) ? 1 : 2;
  }

  // moves.cols / moves.rows: the list shows two columns of moves from 480 px wide; rows is how many fit in its height
  function withMoves(m, text) {
    if (!m) return m;
    m.cols = m.w >= 480 ? 2 : 1;
    m.rows = Math.max(0, Math.floor((m.h - MOVE_TITLE) / (MOVE_ROW * text)));
    return m;
  }

  function twoColumns({ w, h, text, view }) {
    const hasEval = view === 'replay' || view === 'free';
    const plotBelow = view === 'replay' && h >= PLOT_BELOW_MIN_H;
    const bar = barH(text);
    const hLimit = h - 2 * MARGIN - barsTotal(text) - (plotBelow ? GAP + PLOT_H : 0);
    const wLimit = w - 2 * MARGIN - GAP - SIDEBAR_MIN * text; // the left column: board plus its eval bar
    const size = Math.max(BOARD_MIN, Math.min(BOARD_MAX, hLimit, wLimit - EVAL_TOTAL));
    const left = size + EVAL_TOTAL; // same sidebar position whether or not the view draws an eval bar
    const boardX = hasEval ? MARGIN + EVAL_TOTAL : MARGIN + (left - size) / 2;
    const boardY = MARGIN + bar + BAR_GAP;
    const sx = MARGIN + left + GAP, sw = w - MARGIN - sx;
    const top = MARGIN;
    const plotY = h - MARGIN - PLOT_H;
    const bottom = plotBelow ? plotY - GAP : h - MARGIN;
    const L = {
      cols: 2, w, h,
      board: { x: boardX, y: boardY, size },
      eval: hasEval ? { x: MARGIN, w: EVAL_W } : null,
      bars: { h: bar, gap: BAR_GAP },
      header: null, moves: null, comment: null, analysis: null, plot: null, tray: null, panel: null,
    };
    if (view === 'edit') { L.panel = box(sx, top, sw, h - 2 * MARGIN); return L; }
    L.header = box(sx, top, sw, HEADER_H * text);
    let rest = bottom - top - L.header.h - GAP; // under the header
    let plotSide = false;
    if (view === 'replay' && !plotBelow && rest - GAP - PLOT_SIDE_H >= 190 * text) { plotSide = true; rest -= GAP + PLOT_SIDE_H; }
    const analysisH = Math.max(0, Math.round((rest - GAP) * 0.45));
    const rowH = Math.max(0, rest - GAP - analysisH);
    const rowY = top + L.header.h + GAP;
    const movesW = Math.max(0, Math.min(MOVES_W * text, sw - COMMENT_MIN * text - GAP));
    L.moves = withMoves(box(sx, rowY, movesW, rowH), text);
    L.comment = box(sx + movesW + GAP, rowY, sw - movesW - GAP, rowH);
    L.analysis = box(sx, rowY + rowH + GAP, sw, analysisH);
    if (plotBelow) L.plot = box(MARGIN, plotY, w - 2 * MARGIN, PLOT_H);
    else if (plotSide) L.plot = box(sx, L.analysis.y + analysisH + GAP, sw, PLOT_SIDE_H);
    return L;
  }

  function oneColumn({ w, h, text, view, video }) {
    const hasEval = view === 'replay' || view === 'free';
    const ev = hasEval ? EVAL_TOTAL : 0;
    const bar = barH(text), bars = barsTotal(text);
    const pw = Math.min(w - 2 * MARGIN, BOARD_MAX + ev); // panels' width; the board and eval bar sit centred in it
    const px = (w - pw) / 2;
    const natural = Math.min(BOARD_MAX, w - 2 * MARGIN - ev);
    // what goes under the board, top to bottom, with its paused height and, in a video, its preferred one
    let parts;
    if (view === 'edit') parts = [['tray'], ['panel', ONE_COL.panel * text, 120]];
    else {
      parts = [['comment', ONE_COL.comment * text, VIDEO_PREF[0]], ['analysis', ONE_COL.analysis * text, VIDEO_PREF[1]], ['moves', ONE_COL.moves * text, VIDEO_PREF[2]]];
      if (!video) parts.unshift(['header', HEADER_H * text]);
    }
    const cell = Math.min(56, Math.floor((pw - 5 * 4) / 6));
    const trayH = 2 * cell + 4;
    const sized = parts.filter((p) => p[0] !== 'tray');
    const fixed = parts.length > sized.length ? trayH + GAP : 0;
    const gaps = (parts.length - 1) * GAP;
    let size = natural, heights;
    if (!video) heights = sized.map((p) => p[1]);
    else {
      const prefs = sized.map((p) => p[2]);
      const sumPref = prefs.reduce((a, b) => a + b, 0);
      const room = (s) => h - 2 * MARGIN - bars - s - GAP - fixed - gaps; // for the panels, given a board of size s
      size = Math.max(BOARD_MIN, Math.min(natural, h - 2 * MARGIN - bars - GAP - fixed - gaps - sumPref));
      const avail = room(size), floor = PANEL_FLOOR * sized.length;
      if (avail >= sumPref) heights = prefs.map((p) => (p * avail) / sumPref);
      else {
        const t = Math.max(0, (avail - floor) / (sumPref - floor));
        heights = prefs.map((p) => PANEL_FLOOR + (p - PANEL_FLOOR) * t);
      }
    }
    const gx = (w - (size + ev)) / 2;
    const L = {
      cols: 1, w, h,
      board: { x: gx + ev, y: MARGIN + bar + BAR_GAP, size },
      eval: hasEval ? { x: gx, w: EVAL_W } : null,
      bars: { h: bar, gap: BAR_GAP },
      header: null, moves: null, comment: null, analysis: null, plot: null, tray: null, panel: null,
    };
    let y = MARGIN + bars + size + GAP;
    if (fixed) { L.tray = box(px, y, pw, trayH); y += trayH + GAP; }
    sized.forEach((p, i) => { L[p[0]] = box(px, y, pw, heights[i]); y += heights[i] + GAP; });
    withMoves(L.moves, text);
    if (!video) L.h = Math.max(h, y - GAP + MARGIN);
    return L;
  }

  // view: 'replay' | 'free' | 'game' | 'edit'. video: playing or recording, when the page must fit the screen exactly.
  // cols overrides columns()'s choice; otherwise prevCols gives it hysteresis.
  function compute({ w, h, text = 1, view = 'replay', video = false, prevCols = null, cols = null }) {
    const c = cols || columns({ w, h, text, prevCols });
    return (c === 1 ? oneColumn : twoColumns)({ w, h, text, view, video });
  }

  window.LayoutCore = { TEXT_SIZES, textScale, columns, compute };
})();
