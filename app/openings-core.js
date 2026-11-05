// Opening names from Lichess's chess-openings data (window.OPENINGS_TSV), ported from chess_openings.py.
// Positions are matched rather than move orders, so a game that transposes into a named line still gets
// its name; a position that isn't named itself takes the deepest named position before it on its line.
(function () {
  const CC = () => window.ChessCore;
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';

  // A line of moves from the start, with each position's key: placement, side to move, castling rights
  // and the en-passant square only when a capture there is legal (python-chess's epd(); ChessCore.fullFen)
  function tracker(startFen) {
    let pos = startFen ? CC().parseFen(startFen).pos : CC().posFromFen(START);
    const key = () => CC().fullFen(pos, { ep: 'legal' });
    const t = {
      key, lastUci: null,
      san(s) { const r = CC().applySan(pos, s); pos = r.pos; t.lastUci = r.uci; return key(); },
      uci(u) { const r = CC().applyUci(pos, u); if (!r) return null; pos = r.pos; return key(); },
    };
    return t;
  }

  function build() {
    // edges: position key → (uci → { uci, san, next, n }), n counting the book lines through the move
    const lines = [], named = new Map(), edges = new Map(), startKey = tracker().key();
    for (const row of (window.OPENINGS_TSV || '').split('\n')) {
      if (!row) continue;
      const [eco, name, pgn] = row.split('\t'), t = tracker(), line = [];
      let prev = startKey;
      for (const tok of pgn.split(/\s+/)) {
        if (!tok || /^\d/.test(tok)) continue;
        const next = t.san(tok);
        let out = edges.get(prev);
        if (!out) edges.set(prev, out = new Map());
        const e = out.get(t.lastUci);
        if (e) e.n++; else out.set(t.lastUci, { uci: t.lastUci, san: tok, next, n: 1 });
        line.push(prev = next);
      }
      lines.push(line);
      named.set(line[line.length - 1], { eco, name });
    }
    const deepest = new Map();
    for (const line of lines) {
      let last = null;
      line.forEach((k, i) => {
        if (named.has(k)) last = [i + 1, named.get(k)];
        if (last && (!deepest.has(k) || last[0] > deepest.get(k)[0])) deepest.set(k, last);
      });
    }
    const table = new Map([...deepest].map(([k, v]) => [k, v[1]]));
    const byPly = (ucis, startFen) => {
      const t = tracker(startFen), out = [];
      let ok = true;
      for (const u of ucis) {
        const k = ok ? t.uci(u) : null;
        if (k === null) ok = false;
        out.push(k !== null && table.has(k) ? table.get(k) : null);
      }
      return out;
    };
    // The book moves from the position after ucis, most book lines first, each with the opening it reaches
    const continuations = (ucis, startFen) => {
      const t = tracker(startFen);
      let k = t.key();
      for (const u of ucis) if ((k = t.uci(u)) === null) return [];
      return [...(edges.get(k) || new Map()).values()].sort((a, b) => b.n - a.n || (a.san < b.san ? -1 : a.san > b.san ? 1 : 0))
        .map(({ uci, san, next }) => { const o = table.get(next); return { uci, san, eco: o ? o.eco : null, name: o ? o.name : null }; });
    };
    // The keys of the start position and of each position after it, up to an illegal move
    const keysAlong = (ucis, startFen) => {
      const t = tracker(startFen), keys = [t.key()];
      for (const u of ucis) { const k = t.uci(u); if (k === null) break; keys.push(k); }
      return keys;
    };
    // The name of the position after ucis, or the last named one on the way there; unlike identify, the start
    // position counts, so a pasted FEN that is a book position is named before any move
    const name = (ucis, startFen) => keysAlong(ucis, startFen).map((k) => table.get(k)).filter(Boolean).pop() || null;
    // Whether the position after ucis is on a book line (named or with book moves from it)
    const inBook = (ucis, startFen) => {
      const keys = keysAlong(ucis, startFen), k = keys[keys.length - 1];
      return keys.length === ucis.length + 1 && (table.has(k) || edges.has(k));
    };
    return { byPly, identify: (ucis, startFen) => byPly(ucis, startFen).filter(Boolean).pop() || null, name, inBook, continuations, size: table.size };
  }

  let cached = null;
  // The book, built on first use and kept for the session; { fresh: true } rebuilds it (for timing)
  function book(opts) { if (!cached || (opts && opts.fresh)) cached = build(); return cached; }

  // The book key of the position after these moves (for tests): python-chess epd() fields
  function positionKey(ucis) { const t = tracker(); let k = t.key(); for (const u of ucis) k = t.uci(u); return k; }

  window.Openings = { book, positionKey };
})();
