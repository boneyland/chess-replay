// The page's boxes, from the window's size: where the board, eval bar, player bars and each panel go, in one column
// or two. Pure numbers in, plain boxes { x, y, w, h, scroll } out (null where a view or size has none), so the views
// only place what this says. columns() makes the one decision that depends on the size alone; compute() lays a view out.
(function () {
  // Device tiers, by the viewport's size (vw × vh, as the @media rules in shell.html judge it, with the same breakpoints;
  // never the stage's, which is narrower and shorter by the transport bar): a phone (under 600 px wide, or under 500 px
  // high when held sideways), a foldable or square-ish window (600–1180 wide, between 0.8 and 1.2 times as tall as
  // wide: an unfolded foldable), a tablet (600–1180 otherwise) and a desktop (1181 up). Smaller devices
  // are tighter, not just rearranged: thinner margins, gaps and panel padding, a thinner eval bar, and text a little
  // smaller (scale multiplies the viewer's text size). A foldable is spaced as a tablet; whether either keeps the sidebar
  // is columns()'s call, by the room
  const TIERS = {
    phone: { margin: 6, gap: 6, evalW: 14, evalGap: 4, pad: [10, 13], scale: 0.9 },
    foldable: { margin: 8, gap: 8, evalW: 20, evalGap: 8, pad: [12, 16], scale: 0.95 },
    tablet: { margin: 8, gap: 8, evalW: 20, evalGap: 8, pad: [12, 16], scale: 0.95 },
    desktop: { margin: 12, gap: 10, evalW: 24, evalGap: 8, pad: [16, 22], scale: 1 },
  };
  const DESKTOP_VW = 1181;
  const tierOf = (vw, vh) => (vw < 600 || vh < 500 ? 'phone' : vw >= DESKTOP_VW ? 'desktop' : vh >= 0.8 * vw && vh <= 1.2 * vw ? 'foldable' : 'tablet');
  let MARGIN = 12, GAP = 10, EVAL_W = 24, EVAL_GAP = 8, EVAL_TOTAL = 32, PAD = [16, 22];
  const BAR_GAP = 4;
  // the full-width eval graph's largest height: thinner in a viewport under PLOT_WIDE px wide (desktops included); by the
  // viewport's width (vw), as the viewer measures it, not the stage's
  const PLOT_WIDE = 1181;
  const plotMax = (vw) => (vw >= PLOT_WIDE ? 110 : 80);
  // the tier's spacing, for the layout being worked out (compute and columns are called one at a time)
  const useTier = (vw, vh) => {
    const t = TIERS[tierOf(vw, vh)];
    MARGIN = t.margin; GAP = t.gap; EVAL_W = t.evalW; EVAL_GAP = t.evalGap; EVAL_TOTAL = EVAL_W + EVAL_GAP; PAD = t.pad;
    return t;
  };
  const BOARD_MAX = 900, BOARD_MIN = 200, BOARD_OK = 360, BOARD_BACK = 380;
  // the board is never more than half the viewport's longer side (its height upright, its width held sideways), nor 900 px
  let boardMax = BOARD_MAX;
  // the sidebar: 320 px at least, and 380 px and a gap while the board keeps 360 px (the width that once held the moves
  // list and the commentary side by side, which Analysis's lines still use)
  const SIDEBAR_MIN = 320, SIDEBAR_W = 380;
  const HEADER_H = 76, PLOT_SIDE_H = 80, PLOT_BELOW_MIN_H = 700, PLOT_MIN_H = 670; // no eval graph under 670 px high
  // a square-ish two-column window (at least 0.77 times as tall as wide: a 760 px wide window from about 640 px high) has
  // the eval graph only where Analysis keeps ANALYSIS_PLOT_MIN (times text) over it: Analysis runs the full width
  // under the board, at least ANALYSIS_BELOW_MIN high (times text), and the sidebar keeps the header, Moves and Commentary
  const SQUARE = 0.77, ANALYSIS_BELOW_MIN = 160, ANALYSIS_PLOT_MIN = 240;
  // a short two-column window (a phone held sideways; Stage's call, as dock): the transport bar sits at the foot of the
  // sidebar rather than under the whole page, the header goes and the margins are slimmer, so the board gets the height.
  // DOCK_H is the bar's height (shell.html's .pbar-dock: 28 px buttons, 2 px padding and a border)
  const DOCK_H = 34, DOCK_MARGIN = 4;
  const ONE_COL = { comment: 200, analysis: 260, panel: 260 }; // paused heights, times text (Moves: its five lines)
  const VIDEO_PREF = [96, 120, 96], PANEL_FLOOR = 48; // comment, analysis, moves under a video's board, times text
  // MoveList's chrome as it draws it (game-video-core.jsx, whose tx() sizes are 0.8 × the text size): a move row, and
  // the panel's padding, title row and its margin and the borders around the rows. All but the borders grow with the text
  // Moves stands over Commentary in every layout, and is never taller than MOVE_LINES lines of moves (MOVE_LINES_ONE in
  // one column)
  const MOVE_ROW = 38, MOVE_BORDER = 2, MOVE_LINES = 5, MOVE_LINES_ONE = 3, TX = 0.8;
  const moveRow = (text) => MOVE_ROW * TX * text;
  // TIGHT: the panel's tighter padding (0.6 of it) and title gap (half) off the desktop in one column, and on a phone
  // (game-video-core.jsx's tightAn), set by compute()
  let TIGHT = false;
  const moveChrome = (text) => (2 * PAD[0] * (TIGHT ? 0.6 : 1) + 15 * 1.4 + (TIGHT ? 6 : 12)) * TX * text + MOVE_BORDER;
  const movesMax = (text, lines = MOVE_LINES) => moveChrome(text) + lines * moveRow(text);

  const TEXT_SIZES = { Small: 0.9, Default: 1, Large: 1.15, Larger: 1.3 };
  const textScale = (name) => (Object.prototype.hasOwnProperty.call(TEXT_SIZES, name) ? TEXT_SIZES[name] : 1);

  const barH = (text) => 40 * text * 0.8;
  const barsTotal = (text) => 2 * barH(text) + 2 * BAR_GAP;
  // the sidebar's width in two columns: 380 px and a gap while the board keeps 360 px; never under the minimum
  const sideW = (w, text) => Math.max(SIDEBAR_MIN * text, Math.min(SIDEBAR_W * text + GAP, w - 2 * MARGIN - GAP - EVAL_TOTAL - BOARD_OK));
  // what goes under a two-column board, and the height that leaves it. A square-ish window (not the editor, not with
  // the bar in the sidebar) has Analysis there. The replay's eval graph runs the full width under the board from 700 px
  // high, and from 670 px wherever that doesn't make the board smaller (it is held by the width), as short as the room
  // under it there (PLOT_SIDE_H at least): a graph in the sidebar beside a board with room under it looked lopsided.
  // cap: the board's largest size
  function under({ w, h, text, view, dock = false, cap, vw = w }) {
    const square = !dock && view !== 'edit' && h >= SQUARE * w;
    const bare = h - 2 * MARGIN - barsTotal(text);
    const byWidth = Math.min(cap, w - 2 * MARGIN - GAP - sideW(w, text) - EVAL_TOTAL);
    const plotBelow = view === 'replay' && !square && !dock && h >= PLOT_MIN_H && (h >= PLOT_BELOW_MIN_H || byWidth <= bare - GAP - PLOT_SIDE_H);
    const plotH = h >= PLOT_BELOW_MIN_H ? plotMax(vw) : Math.min(plotMax(vw), bare - GAP - byWidth);
    // a square-ish window's eval graph, under Analysis, where Analysis keeps ANALYSIS_PLOT_MIN over it at the board's
    // size by the width (twoColumns() places it by the room actually left); as short as the sidebar's (PLOT_SIDE_H),
    // in a window narrower than a desktop's
    const plotRoom = 2 * GAP + PLOT_SIDE_H + ANALYSIS_PLOT_MIN * text;
    const plotUnder = square && view === 'replay' && byWidth <= bare - plotRoom;
    return { square, plotBelow, plotH, byWidth, hLimit: bare - (plotBelow ? GAP + plotH : plotUnder ? plotRoom : square ? GAP + ANALYSIS_BELOW_MIN * text : 0) };
  }
  const box = (x, y, w, h) => ({ x, y, w: Math.max(0, w), h: Math.max(0, h), scroll: true });

  // 1 or 2 columns. One column when the window is tall for its width (over 1.25 times as tall as wide; 0.05 more to leave
  // two columns and 0.05 less to come back), or the board beside the sidebar would be under 360 px (380 to come back),
  // or it would be held small by the width and leave over 30% of the height empty under it (25% to come back: a
  // squarish window such as 772×965, where the board under the panels is the larger one). By the room left, not by device. A window too
  // short for the one-column layout (board, bars and three panels at their floors) keeps two columns where they still
  // fit a 200 px board beside the sidebar (a phone held sideways at Larger text), and always for a video, which must
  // fit; a paused page in a narrow short window (a phone with its keyboard up) takes one column, which scrolls.
  function columns({ w, h, text = 1, prevCols = null, video = false, vw = w, vh = h }) {
    const tier = useTier(vw, vh);
    text *= tier.scale;
    const boardW = w - 2 * MARGIN - GAP - SIDEBAR_MIN * text - EVAL_TOTAL;
    const aspect = 1.25 + (prevCols === 2 ? 0.05 : prevCols === 1 ? -0.05 : 0);
    const tall = prevCols === 1 ? h >= aspect * w : h > aspect * w;
    const narrow = boardW < (prevCols === 1 ? BOARD_BACK : BOARD_OK);
    // the two-column board as twoColumns() sizes it by the width (the sidebar's share), against the height it could have
    // under what twoColumns() puts below it (Analysis in a square-ish window, or the eval graph)
    const { byWidth, hLimit } = under({ w, h, text, view: 'replay', cap: BOARD_MAX, vw });
    const wasted = byWidth < BOARD_MAX && (hLimit - byWidth) / h > (prevCols === 1 ? 0.25 : 0.3);
    const short = h < 2 * MARGIN + barsTotal(text) + BOARD_MIN + GAP + 3 * PANEL_FLOOR + 2 * GAP;
    const keepTwo = short && (video || boardW >= BOARD_MIN);
    return !keepTwo && (tall || narrow || wasted) ? 1 : 2;
  }

  // moves.rows: how many lines of moves fit under the list's title
  function withMoves(m, text) {
    if (!m) return m;
    m.rows = Math.max(0, Math.floor((m.h - moveChrome(text)) / moveRow(text) + 1e-6));
    return m;
  }

  function twoColumns({ w, h, text, view, dock, vw }) {
    if (dock) MARGIN = DOCK_MARGIN;
    const hasEval = view === 'replay' || view === 'free';
    const { square, plotBelow, plotH, hLimit } = under({ w, h, text, view, dock, cap: boardMax, vw });
    const bar = barH(text);
    // the sidebar's share (sideW); the left column (board plus its eval bar) is what is left
    const wLimit = w - 2 * MARGIN - GAP - sideW(w, text);
    // 200 px at least by width; a window too short for that (a video in a phone held sideways at its smallest) shrinks the board to the height
    const size = Math.max(40, Math.min(Math.max(BOARD_MIN, Math.min(boardMax, wLimit - EVAL_TOTAL)), hLimit));
    const left = size + EVAL_TOTAL; // same sidebar position whether or not the view draws an eval bar
    const boardX = hasEval ? MARGIN + EVAL_TOTAL : MARGIN + (left - size) / 2;
    const boardY = MARGIN + bar + BAR_GAP;
    const sx = MARGIN + left + GAP, sw = w - MARGIN - sx;
    const top = MARGIN;
    const plotY = h - MARGIN - plotH;
    const analysisY = boardY + size + BAR_GAP + bar + GAP; // a square-ish window's Analysis, under the board
    const bottom = plotBelow ? plotY - GAP : square ? analysisY - GAP : dock ? h - MARGIN - DOCK_H - GAP : h - MARGIN;
    const L = {
      cols: 2, w, h,
      board: { x: boardX, y: boardY, size },
      eval: hasEval ? { x: MARGIN, w: EVAL_W } : null,
      bars: { h: bar, gap: BAR_GAP },
      header: null, moves: null, comment: null, analysis: null, plot: null, tray: null, panel: null,
      dock: dock ? box(sx, h - MARGIN - DOCK_H, sw, DOCK_H) : null,
    };
    if (view === 'edit') { L.panel = box(sx, top, sw, bottom - top); return L; }
    L.header = dock ? null : box(sx, top, sw, HEADER_H * text);
    let rest = L.header ? bottom - top - L.header.h - GAP : bottom - top; // under the header
    let plotSide = false;
    if (view === 'replay' && !plotBelow && !square && h >= PLOT_MIN_H && rest - GAP - PLOT_SIDE_H >= 190 * text) { plotSide = true; rest -= GAP + PLOT_SIDE_H; }
    // Moves (30% of the room, 40% where Analysis is under the board, between its title and one line and its five lines),
    // then Commentary and Analysis sharing what's left, 45:55 (Commentary all of it where Analysis is under the board)
    const avail = Math.max(0, rest - (square ? GAP : 2 * GAP));
    const movesShare = Math.min(avail, Math.max(moveChrome(text) + moveRow(text), Math.min(movesMax(text), avail * (square ? 0.4 : 0.3))));
    // rounded down to whole lines, so none shows cut off (Commentary takes the rest); a box too short for one line keeps its height
    const lines = Math.floor((movesShare - moveChrome(text)) / moveRow(text) + 1e-6);
    const movesH = lines >= 1 ? moveChrome(text) + lines * moveRow(text) : movesShare;
    const commentH = Math.max(0, square ? avail - movesH : Math.round((avail - movesH) * 0.45)), analysisH = Math.max(0, avail - movesH - commentH);
    const rowY = L.header ? top + L.header.h + GAP : top;
    L.moves = withMoves(box(sx, rowY, sw, movesH), text);
    L.comment = box(sx, rowY + movesH + GAP, sw, commentH);
    // a square-ish window's eval graph: at the bottom, under Analysis, where Analysis keeps its minimum
    const underH = h - MARGIN - analysisY, plotUnder = square && view === 'replay' && underH - GAP - PLOT_SIDE_H >= ANALYSIS_PLOT_MIN * text;
    L.analysis = square ? box(MARGIN, analysisY, w - 2 * MARGIN, plotUnder ? underH - GAP - PLOT_SIDE_H : underH) : box(sx, L.comment.y + commentH + GAP, sw, analysisH);
    if (plotBelow) L.plot = box(MARGIN, plotY, w - 2 * MARGIN, plotH);
    else if (plotUnder) L.plot = box(MARGIN, h - MARGIN - PLOT_SIDE_H, w - 2 * MARGIN, PLOT_SIDE_H);
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
      // Commentary last, at the bottom
      parts = [['moves', movesMax(text, MOVE_LINES_ONE), Math.min(movesMax(text, MOVE_LINES_ONE), Math.max(VIDEO_PREF[2] * text, movesMin)), movesMin],
        ['analysis', ONE_COL.analysis * text, VIDEO_PREF[1] * text, PANEL_FLOOR * text], ['comment', ONE_COL.comment * text, VIDEO_PREF[0] * text, PANEL_FLOOR * text]];
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
      if (avail >= sumPref) {
        // the room past the preferred heights goes to the panels in proportion, but Moves stops at its five lines
        const mi = sized.findIndex((p) => p[0] === 'moves');
        heights = prefs.map((p) => (p * avail) / sumPref);
        if (mi >= 0 && heights[mi] > movesMax(text, MOVE_LINES_ONE)) {
          const extra = heights[mi] - movesMax(text, MOVE_LINES_ONE), others = sumPref - prefs[mi];
          heights = heights.map((x, i) => (i === mi ? movesMax(text, MOVE_LINES_ONE) : x + (extra * prefs[i]) / others));
        }
      } else {
        const t = Math.max(0, (avail - floor) / (sumPref - floor));
        heights = prefs.map((p, i) => floors[i] + (p - floors[i]) * t);
      }
      // Moves rounded down to whole lines, as in two columns, so no part-line of empty room shows under its lines;
      // Analysis, under it, takes the rest. A box too short for one line keeps its height
      const mi = sized.findIndex((p) => p[0] === 'moves'), ai = sized.findIndex((p) => p[0] === 'analysis');
      const lines = mi >= 0 ? Math.floor((heights[mi] - moveChrome(text)) / moveRow(text) + 1e-6) : 0;
      if (lines >= 1 && ai >= 0) {
        const movesH = moveChrome(text) + lines * moveRow(text);
        heights[ai] += heights[mi] - movesH;
        heights[mi] = movesH;
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
    // MOVE_LINES_ONE lines, then it scrolls), and the page scrolls. The boxes keep their order and width; the heights here are
    // only the paused defaults, which the views don't use. L.flow says where the column starts
    if (!video) L.flow = { top: y, x: px, w: pw, gap: GAP, bottom: MARGIN };
    if (fixed) { L.tray = box(px, y, pw, trayH); y += trayH + GAP; }
    sized.forEach((p, i) => { L[p[0]] = box(px, y, pw, heights[i]); y += heights[i] + GAP; });
    withMoves(L.moves, text);
    if (L.flow) {
      parts.forEach((p, i) => { if (L[p[0]]) Object.assign(L[p[0]], { flow: true, order: i, scroll: false }); });
      if (L.moves) L.moves.maxRows = MOVE_LINES_ONE;
    }
    return L;
  }

  // view: 'replay' | 'free' | 'game' | 'edit'. video: playing or recording, when the page must fit the screen exactly.
  // cols overrides columns()'s choice; otherwise prevCols gives it hysteresis.
  // L.text is the text size the boxes were sized for (the viewer's, times the tier's scale); L.pad the panels' padding
  // at text 1 (the views scale it with their text).
  // vw, vh: the viewport's size (the stage area's when not given), which caps the board and sets the device tier.
  // dock: a short two-column window whose transport bar sits in the sidebar (L.dock is its box)
  function compute({ w, h, text = 1, view = 'replay', video = false, prevCols = null, cols = null, vw = w, vh = h, dock = false }) {
    const c = cols || columns({ w, h, text, prevCols, video, vw, vh });
    boardMax = Math.max(BOARD_MIN, Math.min(BOARD_MAX, 0.5 * Math.max(vw, vh)));
    const tier = useTier(vw, vh), t = text * tier.scale;
    TIGHT = tierOf(vw, vh) !== 'desktop' && (c === 1 || tierOf(vw, vh) === 'phone');
    return Object.assign((c === 1 ? oneColumn : twoColumns)({ w, h, text: t, view, video, dock: c === 2 && dock, vw }), { text: t, tier: tierOf(vw, vh), pad: PAD });
  }

  // The export's pixel scale for a w × h page: the screen's density, held so the longer side stays within 1920 px
  const exportScale = (w, h, dpr) => Math.min(dpr || 1, 1920 / Math.max(w, h, 1));
  // the export's canvas size on one side: the page's CSS size at that scale, rounded down to even (video wants even sides)
  const exportPx = (v, scale) => Math.max(2, 2 * Math.floor((v * scale) / 2));

  window.LayoutCore = { TEXT_SIZES, textScale, columns, compute, exportScale, exportPx };
})();
