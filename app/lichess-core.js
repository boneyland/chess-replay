// Lichess's public data (window.LichessCore): URLs, parsers, and a client that caches answers, sends one request at a
// time per endpoint and backs off for a minute after an HTTP 429, as Lichess asks: the endgame tablebase and the cloud
// evaluation. No React here: the page's hooks (tablebase.jsx, stockfish.jsx) debounce position changes and draw the answers.
(function () {
  const TB_URL = 'https://tablebase.lichess.ovh/standard';
  const CLOUD_URL = 'https://lichess.org/api/cloud-eval';
  const EXPLORER_URL = 'https://explorer.lichess.ovh';
  const TB_MAX_PIECES = 7; // the Syzygy tables Lichess serves; never asked above this
  const BACKOFF_MS = 60000, TIMEOUT_MS = 10000, CACHE_SIZE = 300;

  // the pieces on a FEN's board, kings included
  const pieceCount = (fen) => (String(fen).split(' ')[0].match(/[pnbrqk]/gi) || []).length;
  // a ChessCore position as a full FEN: castling rights and en passant square from it (the tables need both) and half,
  // the plies since the last capture or pawn move, which the answer counts towards the fifty-move rule (a win with DTZ
  // 55 is a cursed win with 60 already gone)
  const fenOf = (pos, half = 0) => window.ChessCore.fullFen(pos, { counters: [half, 1] });
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
    const cp = window.ChessCore.mateCp((white ? 1 : -1) * (n || 1));
    return { cp, txt: n ? `TB ${white ? '' : '−'}M${n}` : `TB ${white ? '1-0' : '0-1'}` };
  }
  // A game analysis's eval for a certain answer, from White's point of view (as the eval bar's, a checkmate as
  // ±MATE_CP and a stalemate as 0, as Stockfish scores them), or null where the answer isn't certain
  function evalCp(t, turn) {
    if (t.checkmate) return (turn === 'w' ? -1 : 1) * window.ChessCore.MATE_CP;
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
  // ChessCore.mateCp), depth, pv, best, lines: [{ k, cp, depth, pv }], nodes, timeMs: null, source: 'cloud' }
  function parseCloud(j, fen) {
    if (!j || typeof j !== 'object' || typeof j.depth !== 'number' || !Array.isArray(j.pvs) || !j.pvs.length) throw new Error('Not a cloud evaluation');
    const lines = j.pvs.map((p, i) => {
      const cp = typeof p.mate === 'number' ? window.ChessCore.mateCp(p.mate) : typeof p.cp === 'number' ? p.cp : null;
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
  // the explorer gives castling as the king taking its rook (e1h1, as Lichess plays Chess960); the board plays e1g1
  const castleUci = (uci, san) => (/^O-O/.test(san || '') && /^e[18][ah][18]$/.test(uci || '') ? uci.slice(0, 2) + (/^O-O-O/.test(san) ? 'c' : 'g') + uci[3] : uci);
  function parseExplorer(j) {
    if (!j || !Array.isArray(j.moves)) throw new Error('not an explorer answer');
    const n = (x) => Math.max(0, Math.floor(+x || 0)); // not `| 0`: the start position has over 2^31 games
    const total = (o) => n(o.white) + n(o.draws) + n(o.black);
    const name = (p) => (p && p.name ? p.name + (p.rating ? ' (' + p.rating + ')' : '') : '?');
    return {
      total: total(j), white: n(j.white), draws: n(j.draws), black: n(j.black),
      moves: j.moves.map((m) => ({ uci: castleUci(m.uci, m.san), san: m.san, white: n(m.white), draws: n(m.draws), black: n(m.black), total: total(m), averageRating: m.averageRating == null ? null : n(m.averageRating) })),
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


  // ---------- game import (Import game's paste box, the explorer's games) ----------
  // A Lichess link to a game, a broadcast game or study chapter, or a broadcast round or study (lists), as the export URL
  // and how to open it: { kind: 'game' | 'list', id, url, side ('w', 'b' or null: as the link says), ply (#32, or null) },
  // or null for anything else. With or without https:// and www.; a player's 12-character game link is cut to its 8
  const LI_ID = /^[A-Za-z0-9]{8}$/;
  // a study's or round's export with its clocks, comments and side lines: a round leaves its variations (the
  // computer's best lines) out unless asked
  const PGN_Q = '?clocks=true&comments=true&variations=true';
  const NOT_IDS = new Set(['analysis', 'practice', 'training', 'streamer', 'tutorial', 'resource', 'feedback', 'research', 'insights', 'download', 'features', 'external']);
  function gameLink(text) {
    const t = String(text == null ? '' : text).trim();
    const m = /^(?:https?:\/\/)?(?:www\.)?lichess\.org(\/[^\s?#]*)?(\?[^\s#]*)?(#\d+)?$/i.exec(t);
    if (!m) return null;
    const parts = (m[1] || '').split('/').filter(Boolean), ply = m[3] ? parseInt(m[3].slice(1), 10) : null;
    const id8 = (p) => (p && /^[A-Za-z0-9]{8}([A-Za-z0-9]{4})?$/.test(p) && !NOT_IDS.has(p.toLowerCase()) ? p.slice(0, 8) : null);
    const sideOf = (p) => (p === 'black' ? 'b' : p === 'white' ? 'w' : null);
    const game = (id, side) => ({ kind: 'game', id, url: `https://lichess.org/game/export/${id}?clocks=true&evals=true`, side, ply });
    const chapter = (s, c) => ({ kind: 'game', id: c, url: `https://lichess.org/api/study/${s}/${c}.pgn${PGN_Q}`, side: null, ply });
    if (parts[0] === 'broadcast') {
      // /broadcast/<tour>/<round>/<roundId>[/<gameId>]; /broadcast/<roundId> alone is a round too
      const ids = parts.slice(1).filter((p) => LI_ID.test(p)), last = parts[parts.length - 1], prev = parts[parts.length - 2];
      if (parts.length >= 5 && LI_ID.test(last) && LI_ID.test(prev)) return chapter(prev, last);
      if (LI_ID.test(last) && ids.length) return { kind: 'list', id: last, url: `https://lichess.org/api/broadcast/round/${last}.pgn${PGN_Q}`, side: null, ply: null };
      return null;
    }
    if (parts[0] === 'study' && LI_ID.test(parts[1] || '')) {
      if (LI_ID.test(parts[2] || '')) return chapter(parts[1], parts[2]);
      return parts.length === 2 ? { kind: 'list', id: parts[1], url: `https://lichess.org/api/study/${parts[1]}.pgn${PGN_Q}`, side: null, ply: null } : null;
    }
    if (parts[0] === 'game' && parts[1] !== 'export') { const id = id8(parts[1]); return id && parts.length <= 3 ? game(id, sideOf(parts[2])) : null; }
    const id = id8(parts[0]);
    return id && parts.length <= 2 && (parts.length === 1 || sideOf(parts[1])) ? game(id, sideOf(parts[1])) : null;
  }
  // a PGN's tags (the first game's), as written
  const pgnTags = (pgn) => { const o = {}; String(pgn).replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, (_, k, v) => { if (!(k in o)) o[k] = v.replace(/\\(.)/g, '$1'); return ''; }); return o; };
  // the chess variant a PGN says it is (its Variant tag), or null for a game the page plays: no tag, Standard, Lichess's
  // From Position (a standard game from a set-up position) or Chess960. The page plays only those
  const variant = (pgn) => { const v = (pgnTags(pgn).Variant || '').trim(); return !v || /^(standard|from position|chess960)$/i.test(v) ? null : v; };
  const is960Pgn = (pgn) => /^chess960$/i.test((pgnTags(pgn).Variant || '').trim());
  // a result tag the game has ended with
  const finished = (pgn) => /^(1-0|0-1|1\/2-1\/2)$/.test(pgnTags(pgn).Result || '');
  // A round's or study's PGN as its games: { pgn, white, black, result ('1–0', '0–1', '½–½' or null: not finished), board,
  // variant (variant()) }.
  // A round not started yet holds a placeholder game with no players, left out
  const RESULT_TEXT = { '1-0': '1–0', '0-1': '0–1', '1/2-1/2': '½–½' };
  function listGames(text) {
    return window.ChessCore.splitGames(String(text)).filter((pgn) => { const g = pgnTags(pgn); return g.White || g.Black; }).map((pgn) => {
      const g = pgnTags(pgn), board = /^\d+\.(\d+)$/.exec(g.Round || '');
      return { pgn, white: g.White || '?', black: g.Black || '?', result: RESULT_TEXT[g.Result] || null, board: board ? +board[1] : null, variant: variant(pgn) };
    });
  }
  // Fetches a gameLink: { pgn } for a finished game, { list } for a round or study, or { error } saying what went
  // wrong (offline, not found, private, busy, not finished). fetchFn is the page's fetch (a test's fake in Node)
  async function fetchGame(link, { signal, fetchFn = (u, o) => fetch(u, o) } = {}) {
    let r;
    try { r = await fetchFn(link.url, { signal, headers: { Accept: 'application/x-chess-pgn' } }); } catch (e) {
      if (e && e.name === 'AbortError') return { aborted: true };
      return { error: 'Lichess can’t be reached: check that you’re online.' };
    }
    if (r.status === 404) return { error: link.kind === 'list' ? 'Lichess has nothing at that link.' : 'Lichess has no game at that link.' };
    if (r.status === 403 || r.status === 401) return { error: 'That study is private: Lichess won’t share it.' };
    if (r.status === 429) return { error: 'Lichess is busy: try again in a minute.' };
    if (!r.ok) return { error: `Lichess answered with an error (${r.status}). Try again later.` };
    let text;
    try { text = await r.text(); } catch (e) { return e && e.name === 'AbortError' ? { aborted: true } : { error: 'Lichess can’t be reached: check that you’re online.' }; }
    if (link.kind === 'list') {
      const list = listGames(text);
      if (!list.length) return { error: 'There are no games there yet: a broadcast round lists its games once it starts.' };
      return { list };
    }
    if (!/\S/.test(text)) return { error: 'Lichess has no game at that link.' };
    if (!finished(text)) return { error: 'This game is still being played: it can be opened once it ends.' };
    return { pgn: text };
  }

  window.LichessCore = { gameLink, pgnTags, variant, is960Pgn, finished, listGames, fetchGame, EXPLORER_URL, explorerUrl, explorerKey, parseExplorer, TB_URL, CLOUD_URL, TB_MAX_PIECES, BACKOFF_MS, pieceCount, fenOf, tbKey, tablebaseUrl, parseTablebase, flip, outcome, verdict, bar, evalCp, groups, cloudKey, cloudUrl, cloudMoves, parseCloud, create };
})();
