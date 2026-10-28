// Lichess's public data (window.LichessCore): URLs, parsers, and a client that caches answers, sends one request at a
// time per endpoint and backs off for a minute after an HTTP 429, as Lichess asks: the endgame tablebase and the cloud
// evaluation. No React here: the page's hooks (tablebase.jsx, stockfish.jsx) debounce position changes and draw the answers.
(function () {
  const TB_URL = 'https://tablebase.lichess.ovh/standard';
  const CLOUD_URL = 'https://lichess.org/api/cloud-eval';
  const EXPLORER_URL = 'https://explorer.lichess.ovh';
  const MATE_CP = 10000, MATE_STEP = 10; // AnalysisCore's mate scores: mate in N as ±(10000 − 10·N)
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

  // the cloud's key: the board, side, castling and en passant square (the clocks don't change its answer), and the lines
  const cloudKey = (fen, lines = 1) => String(fen).trim().split(/\s+/).slice(0, 4).join(' ') + '|' + lines;
  const cloudUrl = (fen, lines = 1) => CLOUD_URL + '?fen=' + encodeURIComponent(fen) + '&multiPv=' + lines;
  // A cloud line's moves as the page's UCI: Lichess writes castling as the king taking its rook (e1h1), the engine and
  // the board as the king's two steps (e1g1); walked from fen, stopping at the first move that isn't legal
  function cloudMoves(fen, moves) {
    const CC = window.ChessCore, out = [];
    let pos = CC.posFromFen(fen);
    for (let u of String(moves || '').trim().split(/\s+/).filter(Boolean)) {
      const from = CC.sqIndex(u.slice(0, 2)), to = CC.sqIndex(u.slice(2, 4)), k = pos.b[from], r = pos.b[to];
      if (k && r && k.toLowerCase() === 'k' && r === (k === 'K' ? 'R' : 'r')) u = u.slice(0, 2) + (to % 8 > from % 8 ? 'g' : 'c') + u[3];
      const a = CC.applyUci(pos, u);
      if (!a) break;
      out.push(u); pos = a.pos;
    }
    return out;
  }
  // A cloud answer as an engine search's result (sf-engine.js): { cp (White's side, as the API gives it; a mate as
  // ±(10000 − 10·N)), depth, pv, best, lines: [{ k, cp, depth, pv }], nodes, timeMs: null, source: 'cloud' }
  function parseCloud(j, fen) {
    if (!j || typeof j !== 'object' || typeof j.depth !== 'number' || !Array.isArray(j.pvs) || !j.pvs.length) throw new Error('Not a cloud evaluation');
    const lines = j.pvs.map((p, i) => {
      const cp = typeof p.mate === 'number' ? (p.mate > 0 ? 1 : -1) * (MATE_CP - MATE_STEP * Math.abs(p.mate)) : typeof p.cp === 'number' ? p.cp : null;
      return { k: i + 1, cp, depth: j.depth, pv: cloudMoves(fen, p.moves) };
    }).filter((l) => l.cp != null);
    if (!lines.length) throw new Error('Not a cloud evaluation');
    const top = lines[0];
    return { cp: top.cp, depth: j.depth, maxDepth: j.depth, pv: top.pv, best: top.pv[0] || null, lines, nodes: typeof j.knodes === 'number' ? j.knodes * 1000 : null, timeMs: null, source: 'cloud' };
  }

  // The opening explorer (needs a Lichess token: 401 without). db: 'lichess' or 'masters'; ratings (lichess only): the
  // rating groups to count, e.g. [1600, 1800, 2000, 2200, 2500]; speeds (lichess only): ['blitz', 'rapid', ...]; empty = all
  const explorerDb = (o) => (o && o.db === 'masters' ? 'masters' : 'lichess');
  const explorerQuery = (fen, o = {}) => {
    const q = new URLSearchParams({ fen, moves: '12', topGames: '4', recentGames: '0' });
    if (explorerDb(o) === 'lichess') {
      if (o.ratings && o.ratings.length) q.set('ratings', o.ratings.join(','));
      if (o.speeds && o.speeds.length) q.set('speeds', o.speeds.join(','));
    }
    return q.toString();
  };
  const explorerUrl = (fen, o) => EXPLORER_URL + '/' + explorerDb(o) + '?' + explorerQuery(fen, o);
  // the cache's key: the position (no move counters) and the filters, never the token
  const explorerKey = (fen, o = {}) => 'explorer ' + explorerDb(o) + ' ' + String(fen).trim().split(/\s+/).slice(0, 4).join(' ') + ' ' + (explorerDb(o) === 'lichess' ? [(o.ratings || []).join(','), (o.speeds || []).join(',')].join('|') : '');
  // { total, white, draws, black, moves: [{ uci, san, white, draws, black, total, averageRating }], games: [{ id, white, black,
  // winner, year }], opening: { eco, name } | null }; throws on an answer that isn't the explorer's
  function parseExplorer(j) {
    if (!j || !Array.isArray(j.moves)) throw new Error('not an explorer answer');
    const n = (x) => Math.max(0, Math.floor(+x || 0)); // not `| 0`: the start position has over 2^31 games
    const total = (o) => n(o.white) + n(o.draws) + n(o.black);
    const name = (p) => (p && p.name ? p.name + (p.rating ? ' (' + p.rating + ')' : '') : '?');
    return {
      total: total(j), white: n(j.white), draws: n(j.draws), black: n(j.black),
      moves: j.moves.map((m) => ({ uci: m.uci, san: m.san, white: n(m.white), draws: n(m.draws), black: n(m.black), total: total(m), averageRating: m.averageRating == null ? null : n(m.averageRating) })),
      games: (j.topGames || []).map((g) => ({ id: g.id, white: name(g.white), black: name(g.black), winner: g.winner || null, year: g.year || null })),
      opening: j.opening && j.opening.name ? { eco: j.opening.eco || '', name: j.opening.name } : null,
    };
  }

  // A client: fetchFn (window.fetch), now (Date.now). tablebase(fen, { signal }) → the parsed answer or null (more
  // than 7 pieces, offline, an error, a 429 back-off, or aborted); answers are cached by FEN, errors aren't
  function create({ fetchFn, now = Date.now } = {}) {
    const cache = new Map(), gates = {};
    const remember = (k, v) => { cache.delete(k); cache.set(k, v); if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value); };
    // one request at a time per endpoint, the next waiting for the last to settle; a 429 closes the gate for a minute
    const gate = (name) => gates[name] || (gates[name] = { busy: Promise.resolve(), until: 0 });
    // missing: an HTTP status meaning "no answer for this position" (the cloud's 404), cached as null so it isn't asked again
    async function get(name, key, url, parse, signal, missing, extra = {}) {
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
          const r = await (fetchFn || window.fetch)(url, { signal: ctl.signal, headers: { Accept: 'application/json', ...extra.headers } });
          if (r.status === 429) { g.until = now() + BACKOFF_MS; return null; }
          if (extra.special && extra.special[r.status]) return extra.special[r.status]; // answered, but not kept
          if (missing && r.status === missing) { remember(key, null); return null; }
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
      // fen's cloud evaluation of lines lines (the cloud may have fewer), or null: never analysed there (a 404, cached),
      // offline, an error, a 429 back-off, or aborted
      cloudEval: (fen, lines = 1, { signal } = {}) => get('cloud', 'cloud ' + cloudKey(fen, lines), cloudUrl(fen, lines), (j) => parseCloud(j, fen), signal, 404),
      // the cached answer (null: not in the cloud), or undefined when it hasn't been asked
      cloudCached: (fen, lines = 1) => cache.get('cloud ' + cloudKey(fen, lines)),
      // fen's explorer answer (see parseExplorer), { auth: true } when Lichess wants a token (none, or one it refuses; not
      // cached), or null: offline, an error, a 429 back-off, or aborted. Answers are cached whatever token asked
      explorer: (fen, o = {}, { signal, token } = {}) => get('explorer', explorerKey(fen, o), explorerUrl(fen, o), parseExplorer, signal, null,
        { headers: token ? { Authorization: 'Bearer ' + token } : {}, special: { 401: { auth: true } } }),
      explorerCached: (fen, o = {}) => cache.get(explorerKey(fen, o)),
      backedOff: (name) => now() < gate(name).until,
    };
  }

  window.LichessCore = { EXPLORER_URL, explorerUrl, explorerKey, parseExplorer, TB_URL, CLOUD_URL, TB_MAX_PIECES, BACKOFF_MS, pieceCount, fenOf, tbKey, tablebaseUrl, parseTablebase, flip, outcome, verdict, bar, evalCp, groups, cloudKey, cloudUrl, cloudMoves, parseCloud, create };
})();
