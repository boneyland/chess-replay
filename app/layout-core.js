// The page's boxes, from the window's size: where the board, eval bar, player bars and each panel go, in one column
// or two. Pure numbers in, plain boxes { x, y, w, h, scroll } out (null where a view or size has none), so the views
// only place what this says. columns() makes the one decision that depends on the size alone; compute() lays a view out.
(function () {
  // Device tiers, by the window's size (the @media rules in shell.html use the same breakpoints): a phone (under 600 px
  // wide, or under 500 px high when held sideways), a foldable or square-ish window (600–1023 wide, between 0.8 and 1.2
  // times as tall as wide: an unfolded foldable), a tablet (600–1023 otherwise) and a desktop (1024 up). Smaller devices
  // are tighter, not just rearranged: thinner margins, gaps and panel padding, a thinner eval bar, and text a little
  // smaller (scale multiplies the viewer's text size). A foldable is spaced as a tablet; whether either keeps the sidebar
  // is columns()'s call, by the room
  const TIERS = {
    phone: { margin: 6, gap: 6, evalW: 14, evalGap: 4, pad: [10, 13], scale: 0.9 },
    foldable: { margin: 8, gap: 8, evalW: 16, evalGap: 6, pad: [12, 16], scale: 0.95 },
    tablet: { margin: 8, gap: 8, evalW: 16, evalGap: 6, pad: [12, 16], scale: 0.95 },
    desktop: { margin: 12, gap: 10, evalW: 20, evalGap: 8, pad: [16, 22], scale: 1 },
  };
  const tierOf = (w, h) => (w < 600 || h < 500 ? 'phone' : w >= 1024 ? 'desktop' : h >= 0.8 * w && h <= 1.2 * w ? 'foldable' : 'tablet');
  let MARGIN = 12, GAP = 10, EVAL_W = 20, EVAL_GAP = 8, EVAL_TOTAL = 28, PAD = [16, 22];
  const BAR_GAP = 4;
  // the tier's spacing, for the layout being worked out (compute and columns are called one at a time)
  const useTier = (w, h) => {
    const t = TIERS[tierOf(w, h)];
    MARGIN = t.margin; GAP = t.gap; EVAL_W = t.evalW; EVAL_GAP = t.evalGap; EVAL_TOTAL = EVAL_W + EVAL_GAP; PAD = t.pad;
    return t;
  };
  const BOARD_MAX = 900, BOARD_MIN = 200, BOARD_OK = 360, BOARD_BACK = 380;
  // the board is never more than half the viewport's longer side (its height upright, its width held sideways), nor 900 px
  let boardMax = BOARD_MAX;
  const SIDEBAR_MIN = 320, MOVES_W = 230, COMMENT_MIN = 150;
  const HEADER_H = 76, PLOT_H = 110, PLOT_SIDE_H = 80, PLOT_BELOW_MIN_H = 700, PLOT_MIN_H = 500; // no eval graph under 500 px high
  const ONE_COL = { comment: 200, analysis: 260, moves: 240, panel: 260 }; // paused heights, times text
  const VIDEO_PREF = [96, 120, 96], PANEL_FLOOR = 48; // comment, analysis, moves under a video's board, times text
  // MoveList's chrome as it draws it (game-video-core.jsx, whose tx() sizes are 0.8 × the text size): a move row, and
  // the panel's padding, title row and its margin and the borders around the rows. All but the borders grow with the text
  const MOVE_ROW = 38, MOVE_BORDER = 2, FLOW_ROWS = 10, TX = 0.8;
  const moveRow = (text) => MOVE_ROW * TX * text;
  const moveChrome = (text) => (2 * PAD[0] + 15 * 1.4 + 12) * TX * text + MOVE_BORDER;

  const TEXT_SIZES = { Small: 0.9, Default: 1, Large: 1.15, Larger: 1.3 };
  const textScale = (name) => (Object.prototype.hasOwnProperty.call(TEXT_SIZES, name) ? TEXT_SIZES[name] : 1);

  const barH = (text) => 40 * text * 0.8;
  const barsTotal = (text) => 2 * barH(text) + 2 * BAR_GAP;
  const box = (x, y, w, h) => ({ x, y, w: Math.max(0, w), h: Math.max(0, h), scroll: true });

  // 1 or 2 columns. One column when the window is tall for its width (over 1.15 times as tall as wide; 0.05 more to leave
  // two columns and 0.05 less to come back), or the board beside the sidebar would be under 360 px (380 to come back),
  // or it would be held small by the width and leave over 30% of the height empty under it (25% to come back: a
  // squarish window such as 772×965, where the board under the panels is the larger one). By the room left, not by device. A window too
  // short for the one-column layout (board, bars and three panels at their floors) keeps two columns where they still
  // fit a 200 px board beside the sidebar (a phone held sideways at Larger text), and always for a video, which must
  // fit; a paused page in a narrow short window (a phone with its keyboard up) takes one column, which scrolls.
  function columns({ w, h, text = 1, prevCols = null, video = false }) {
    const tier = useTier(w, h);
    text *= tier.scale;
    const boardW = w - 2 * MARGIN - GAP - SIDEBAR_MIN * text - EVAL_TOTAL;
    const aspect = 1.15 + (prevCols === 2 ? 0.05 : prevCols === 1 ? -0.05 : 0);
    const tall = prevCols === 1 ? h >= aspect * w : h > aspect * w;
    const narrow = boardW < (prevCols === 1 ? BOARD_BACK : BOARD_OK);
    // the two-column board as twoColumns() sizes it by the width (the sidebar's share), against the height it could have
    const side = Math.max(SIDEBAR_MIN * text, Math.min((MOVES_W + COMMENT_MIN) * text + GAP, w - 2 * MARGIN - GAP - EVAL_TOTAL - BOARD_OK));
    const byWidth = Math.min(BOARD_MAX, w - 2 * MARGIN - GAP - side - EVAL_TOTAL);
    const hLimit = h - 2 * MARGIN - barsTotal(text) - (h >= PLOT_BELOW_MIN_H ? GAP + PLOT_H : 0);
    const wasted = byWidth < BOARD_MAX && (hLimit - byWidth) / h > (prevCols === 1 ? 0.25 : 0.3);
    const short = h < 2 * MARGIN + barsTotal(text) + BOARD_MIN + GAP + 3 * PANEL_FLOOR + 2 * GAP;
    const keepTwo = short && (video || boardW >= BOARD_MIN);
    return !keepTwo && (tall || narrow || wasted) ? 1 : 2;
  }

  // moves.cols / moves.rows: the list shows two columns of moves from 480 px wide; rows is how many fit under its title
  function withMoves(m, text) {
    if (!m) return m;
    m.cols = m.w >= 480 ? 2 : 1;
    m.rows = Math.max(0, Math.floor((m.h - moveChrome(text)) / moveRow(text) + 1e-6));
    return m;
  }

  function twoColumns({ w, h, text, view }) {
    const hasEval = view === 'replay' || view === 'free';
    const plotBelow = view === 'replay' && h >= PLOT_BELOW_MIN_H;
    const bar = barH(text);
    const hLimit = h - 2 * MARGIN - barsTotal(text) - (plotBelow ? GAP + PLOT_H : 0);
    // the sidebar's share: room for the moves list and a commentary beside it, as long as the board keeps 360 px; never
    // under the minimum. The left column (board plus its eval bar) is what is left
    const side = Math.max(SIDEBAR_MIN * text, Math.min((MOVES_W + COMMENT_MIN) * text + GAP, w - 2 * MARGIN - GAP - EVAL_TOTAL - BOARD_OK));
    const wLimit = w - 2 * MARGIN - GAP - side;
    // 200 px at least by width; a window too short for that (a video in a phone held sideways at its smallest) shrinks the board to the height
    const size = Math.max(40, Math.min(Math.max(BOARD_MIN, Math.min(boardMax, wLimit - EVAL_TOTAL)), hLimit));
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
    if (view === 'replay' && !plotBelow && h >= PLOT_MIN_H && rest - GAP - PLOT_SIDE_H >= 190 * text) { plotSide = true; rest -= GAP + PLOT_SIDE_H; }
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
    const natural = Math.min(boardMax, w - 2 * MARGIN - ev);
    // what goes under the board, top to bottom, with its paused height and, in a video, its preferred one
    let parts;
    // [name, paused height, preferred in a video, floor in a video]; the Moves box never gets less than its title and one row
    const movesMin = moveChrome(text) + moveRow(text);
    if (view === 'edit') parts = [['tray'], ['panel', ONE_COL.panel * text, 120 * text, PANEL_FLOOR * text]];
    else {
      parts = [['comment', ONE_COL.comment * text, VIDEO_PREF[0] * text, PANEL_FLOOR * text], ['analysis', ONE_COL.analysis * text, VIDEO_PREF[1] * text, PANEL_FLOOR * text],
        ['moves', ONE_COL.moves * text, Math.max(VIDEO_PREF[2] * text, movesMin), movesMin]];
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
      const avail = room(size), sum = (a) => a.reduce((x, y) => x + y, 0);
      // a window too small for those floors at the 200 px board gives up the Moves minimum, then the text scaling, before the board shrinks (R5)
      const tiers = [sized.map((p) => p[3]), sized.map(() => PANEL_FLOOR * text), sized.map(() => PANEL_FLOOR)];
      const floors = tiers.find((f) => avail >= sum(f)) || tiers[2];
      const floor = sum(floors);
      if (avail >= sumPref) heights = prefs.map((p) => (p * avail) / sumPref);
      else {
        const t = Math.max(0, (avail - floor) / (sumPref - floor));
        heights = prefs.map((p, i) => floors[i] + (p - floors[i]) * t);
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
    // A paused page flows: the panels stack under the board in a column, each as tall as its contents (Moves up to
    // FLOW_ROWS rows, then it scrolls), and the page scrolls. The boxes keep their order and width; the heights here are
    // only the paused defaults, which the views don't use. L.flow says where the column starts
    if (!video) L.flow = { top: y, x: px, w: pw, gap: GAP, bottom: MARGIN };
    if (fixed) { L.tray = box(px, y, pw, trayH); y += trayH + GAP; }
    sized.forEach((p, i) => { L[p[0]] = box(px, y, pw, heights[i]); y += heights[i] + GAP; });
    withMoves(L.moves, text);
    if (L.flow) {
      parts.forEach((p, i) => { if (L[p[0]]) Object.assign(L[p[0]], { flow: true, order: i, scroll: false }); });
      if (L.moves) L.moves.maxRows = FLOW_ROWS;
    }
    return L;
  }

  // view: 'replay' | 'free' | 'game' | 'edit'. video: playing or recording, when the page must fit the screen exactly.
  // cols overrides columns()'s choice; otherwise prevCols gives it hysteresis.
  // L.text is the text size the boxes were sized for (the viewer's, times the tier's scale); L.pad the panels' padding
  // at text 1 (the views scale it with their text).
  // vw, vh: the viewport's size (the stage area's when not given), which caps the board
  function compute({ w, h, text = 1, view = 'replay', video = false, prevCols = null, cols = null, vw = w, vh = h }) {
    const c = cols || columns({ w, h, text, prevCols, video });
    boardMax = Math.max(BOARD_MIN, Math.min(BOARD_MAX, 0.5 * Math.max(vw, vh)));
    const tier = useTier(w, h), t = text * tier.scale;
    return Object.assign((c === 1 ? oneColumn : twoColumns)({ w, h, text: t, view, video }), { text: t, tier: tierOf(w, h), pad: PAD });
  }

  // The export's pixel scale for a w × h page: the screen's density, held so the longer side stays within 1920 px
  const exportScale = (w, h, dpr) => Math.min(dpr || 1, 1920 / Math.max(w, h, 1));
  // the export's canvas size on one side: the page's CSS size at that scale, rounded down to even (video wants even sides)
  const exportPx = (v, scale) => Math.max(2, 2 * Math.floor((v * scale) / 2));

  window.LayoutCore = { TEXT_SIZES, textScale, columns, compute, exportScale, exportPx };
})();
