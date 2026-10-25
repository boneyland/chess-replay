// Lichess's public data (window.LichessCore): URLs, parsers, and a client that caches answers, sends one request at a
// time per endpoint and backs off for a minute after an HTTP 429, as Lichess asks. Only the endgame tablebase so far
// (its answer for a position, and the DTZ mainline from it for a game's analysis).
// No React here: the page's hooks (tablebase.jsx) debounce position changes and draw the answers.
(function () {
  const TB_URL = 'https://tablebase.lichess.ovh/standard';
  const TB_MAX_PIECES = 7; // the Syzygy tables Lichess serves; never asked above this
  const BACKOFF_MS = 60000, TIMEOUT_MS = 10000, CACHE_SIZE = 300;

  // the pieces on a FEN's board, kings included
  const pieceCount = (fen) => (String(fen).split(' ')[0].match(/[pnbrqk]/gi) || []).length;
  // a ChessCore position as a full FEN: castling rights and en passant square from it (the tables need both) and half,
  // the plies since the last capture or pawn move, which the answer counts towards the fifty-move rule (a win with DTZ
  // 55 is a cursed win with 60 already gone)
  function fenOf(pos, half = 0) {
    const ep = pos.ep >= 0 ? String.fromCharCode(97 + (pos.ep % 8)) + (8 - Math.floor(pos.ep / 8)) : '-';
    const castle = pos.castle == null ? 'KQkq' : pos.castle || '-';
    return [window.ChessCore.toFen(pos), castle, ep, half, 1].join(' ');
  }
  // the cache's key: the FEN without the move number, which doesn't change the answer (the fifty-move count does)
  const tbKey = (fen) => String(fen).trim().split(/\s+/).slice(0, 5).join(' ');
  const tablebaseUrl = (fen) => TB_URL + '?fen=' + encodeURIComponent(fen);
  const mainlineUrl = (fen) => TB_URL + '/mainline?fen=' + encodeURIComponent(fen);

  // The answer for the side to move: { category, dtz, dtm, checkmate, stalemate, insufficient, moves }, each move
  // { uci, san, category, dtz, dtm, zeroing } as the API gives it (best first, its category from the opponent's side)
  function parseTablebase(j) {
    if (!j || typeof j !== 'object' || typeof j.category !== 'string' || !Array.isArray(j.moves)) throw new Error('Not a tablebase answer');
    const num = (v) => (typeof v === 'number' ? v : null);
    return {
      category: j.category, dtz: num(j.dtz), dtm: num(j.dtm), checkmate: !!j.checkmate, stalemate: !!j.stalemate, insufficient: !!j.insufficient_material,
      moves: j.moves.filter((m) => m && typeof m.uci === 'string' && typeof m.san === 'string')
        .map((m) => ({ uci: m.uci, san: m.san, category: String(m.category), dtz: num(m.dtz), dtm: num(m.dtm), zeroing: !!m.zeroing })),
    };
  }

  // The DTZ mainline (both sides' best moves, to mate or past the last capture): its moves' ucis, empty for a draw
  function parseMainline(j) {
    if (!j || typeof j !== 'object' || !Array.isArray(j.mainline)) throw new Error('Not a tablebase mainline');
    return j.mainline.filter((m) => m && typeof m.uci === 'string').map((m) => m.uci);
  }

  // a category seen from the other side (a move's category is the opponent's after it)
  const FLIP = { win: 'loss', loss: 'win', 'syzygy-win': 'syzygy-loss', 'syzygy-loss': 'syzygy-win', 'maybe-win': 'maybe-loss', 'maybe-loss': 'maybe-win', 'cursed-win': 'blessed-loss', 'blessed-loss': 'cursed-win', draw: 'draw', unknown: 'unknown' };
  const flip = (c) => FLIP[c] || 'unknown';
  // win, draw, loss or null (not known for sure): a cursed win and a blessed loss are draws (the fifty-move rule)
  const OUTCOME = { win: 'win', 'syzygy-win': 'win', loss: 'loss', 'syzygy-loss': 'loss', draw: 'draw', 'cursed-win': 'draw', 'blessed-loss': 'draw' };
  const outcome = (c) => OUTCOME[c] || null;
  const NAME = { w: 'White', b: 'Black' };
  // The verdict in Lichess's words, for turn the side to move
  function verdict(t, turn) {
    const me = NAME[turn], them = NAME[turn === 'w' ? 'b' : 'w'];
    if (t.checkmate) return `Checkmate · ${them} wins`;
    if (t.stalemate) return 'Stalemate';
    if (t.insufficient) return 'Draw · insufficient material';
    switch (t.category) {
      case 'win': case 'syzygy-win': return `${me} wins`;
      case 'loss': case 'syzygy-loss': return `${them} wins`;
      case 'draw': return 'Draw';
      case 'cursed-win': return `Cursed win for ${me} · drawn by the 50-move rule`;
      case 'blessed-loss': return `Blessed loss for ${me} · saved by the 50-move rule`;
      case 'maybe-win': return `${me} wins, or the 50-move rule draws`;
      case 'maybe-loss': return `${them} wins, or the 50-move rule draws`;
      default: return 'Unknown';
    }
  }
  // What the eval bar shows, from White's point of view: { cp, txt } (a win as a mate, a draw as 0.00), or null where
  // the bar keeps the engine's eval (the game is over, or the result isn't certain). DTM counts plies
  function bar(t, turn) {
    if (t.checkmate || t.stalemate) return null;
    const o = outcome(t.category);
    if (!o) return null;
    if (o === 'draw') return { cp: 0, txt: 'TB 0.00' };
    const white = (o === 'win') === (turn === 'w'), n = t.dtm != null && t.dtm !== 0 ? Math.ceil(Math.abs(t.dtm) / 2) : null;
    const cp = (white ? 1 : -1) * (10000 - 10 * (n || 1));
    return { cp, txt: n ? `TB ${white ? '' : '−'}M${n}` : `TB ${white ? '1-0' : '0-1'}` };
  }
  // A game analysis's eval for a certain answer, from White's point of view (as the eval bar's, a checkmate as
  // ±10000 and a stalemate as 0, as Stockfish scores them), or null where the answer isn't certain
  function evalCp(t, turn) {
    if (t.checkmate) return turn === 'w' ? -10000 : 10000;
    if (t.stalemate || t.insufficient) return 0;
    const b = bar(t, turn);
    return b ? b.cp : null;
  }
  // The moves grouped by what they get the side to move, best first: [{ outcome, moves }] (win, draw, loss, then
  // the uncertain ones as 'unknown'), empty groups left out
  function groups(t) {
    const by = { win: [], draw: [], loss: [], unknown: [] };
    for (const m of t.moves) by[outcome(flip(m.category)) || 'unknown'].push({ ...m, mine: flip(m.category) });
    return ['win', 'draw', 'loss', 'unknown'].filter((k) => by[k].length).map((k) => ({ outcome: k, moves: by[k] }));
  }

  // A client: fetchFn (window.fetch), now (Date.now). tablebase(fen, { signal }) → the parsed answer or null (more
  // than 7 pieces, offline, an error, a 429 back-off, or aborted); answers are cached by FEN, errors aren't
  function create({ fetchFn, now = Date.now } = {}) {
    const cache = new Map(), gates = {};
    const remember = (k, v) => { cache.delete(k); cache.set(k, v); if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value); };
    // one request at a time per endpoint, the next waiting for the last to settle; a 429 closes the gate for a minute
    const gate = (name) => gates[name] || (gates[name] = { busy: Promise.resolve(), until: 0 });
    async function get(name, key, url, parse, signal) {
      if (cache.has(key)) { const v = cache.get(key); remember(key, v); return v; }
      const g = gate(name);
      const prev = g.busy;
      let done;
      g.busy = new Promise((r) => { done = r; });
      try {
        await prev;
        if (signal && signal.aborted) return null;
        if (cache.has(key)) return cache.get(key); // the request before was the same position
        if (now() < g.until) return null;
        const ctl = new AbortController(), stop = () => ctl.abort();
        if (signal) signal.addEventListener('abort', stop);
        const timer = setTimeout(stop, TIMEOUT_MS);
        try {
          const r = await (fetchFn || window.fetch)(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
          if (r.status === 429) { g.until = now() + BACKOFF_MS; return null; }
          if (!r.ok) return null;
          const v = parse(await r.json());
          remember(key, v);
          return v;
        } catch (e) { return null; } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', stop); }
      } finally { done(); }
    }
    return {
      tablebase: (fen, { signal } = {}) => (pieceCount(fen) > TB_MAX_PIECES ? Promise.resolve(null) : get('tablebase', tbKey(fen), tablebaseUrl(fen), parseTablebase, signal)),
      // the cached answer, or undefined (so a position seen before shows at once, without the debounce)
      tablebaseCached: (fen) => cache.get(tbKey(fen)),
      // the moves of the DTZ mainline (parseMainline), or null as tablebase gives it; through the same gate
      mainline: (fen, { signal } = {}) => (pieceCount(fen) > TB_MAX_PIECES ? Promise.resolve(null) : get('tablebase', 'mainline ' + tbKey(fen), mainlineUrl(fen), parseMainline, signal)),
      backedOff: (name) => now() < gate(name).until,
    };
  }

  window.LichessCore = { TB_URL, TB_MAX_PIECES, BACKOFF_MS, pieceCount, fenOf, tbKey, tablebaseUrl, mainlineUrl, parseTablebase, parseMainline, flip, outcome, verdict, bar, evalCp, groups, create };
})();
