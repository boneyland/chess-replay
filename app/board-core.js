// A free board's state: a start position, the moves played from it and the move shown. Boards are plain
// objects { fen, start: { pos, ply0 }, steps, upto }, never mutated; steps are ChessCore line steps and
// upto is the index of the step shown (-1 for the start). Moves after upto stay until a new move replaces them.
(function () {
  const CC = () => window.ChessCore;
  const clamp = (b, upto) => Math.max(-1, Math.min(b.steps.length - 1, Math.floor(Number(upto)) || 0));

  // chess960 is the Chess960 label (the position's number 0-959, or true when it isn't known) of a board that is one; it
  // only names the position, how it plays comes from pos.rooks
  const label960 = (v) => (v === true || (Number.isInteger(v) && v >= 0 && v <= 959) ? v : undefined);
  function fromFen(fen, { chess960 } = {}) {
    const s = CC().parseFen(fen == null ? CC().START_FEN : fen), c = label960(chess960);
    return { fen: s.fen, start: { pos: s.pos, ply0: s.ply0 }, steps: [], upto: -1, ...(c !== undefined ? { chess960: c } : {}) };
  }

  const pos = (b) => (b.upto >= 0 ? b.steps[b.upto].pos : b.start.pos);
  const ucis = (b, n = b.upto + 1) => b.steps.slice(0, Math.max(0, n)).map((s) => s.uci);
  const label = (b, j) => CC().moveNo(b.start.ply0 + j) + ' ' + b.steps[j].san;
  const play = (b, step) => ({ ...b, steps: [...b.steps.slice(0, b.upto + 1), step], upto: b.upto + 1 });
  const go = (b, upto) => ({ ...b, upto: clamp(b, upto) });
  // a game on the board (PlayCore) is kept with it, and engine lists the steps Stockfish's reply chips played (byEngine),
  // so they are still labelled as its replies after a reload
  const save = (b) => {
    const engine = b.steps.map((s, j) => (s.byEngine ? j : -1)).filter((j) => j >= 0);
    return { fen: b.fen, moves: b.steps.map((s) => s.uci), upto: b.upto, ...(label960(b.chess960) !== undefined ? { chess960: b.chess960 } : {}), ...(engine.length ? { engine } : {}), ...(b.game ? { game: b.game } : {}) };
  };

  // today as PGN's YYYY.MM.DD
  const today = () => { const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };

  // The board's whole line (not only up to the move shown) as a PGN ending in res (ChessCore.pgnText): the tags, SetUp and
  // Variant for a Chess960 board, FEN after them when the start isn't the standard one (or the board is a Chess960 one), then `more`; after(j) is the comment written after step j's move
  // ('' for none)
  function pgnOf(b, tags, res, { more = [], after = () => '' } = {}) {
    const c = label960(b.chess960) !== undefined;
    const all = tags.concat(c ? [['Variant', 'Chess960']] : [], c || b.fen !== CC().START_FEN ? [['SetUp', '1'], ['FEN', b.fen]] : [], more), toks = [];
    b.steps.forEach((s, j) => {
      toks.push(CC().pgnMoveNo(b.start.ply0 + j, j === 0 || CC().pgnReopens(toks[toks.length - 1])) + s.san);
      const c = after(j);
      if (c) toks.push(c);
    });
    return CC().pgnText(all, toks.concat(res));
  }

  // The board's moves as a game for the replay. date: PGN's YYYY.MM.DD, today when omitted
  const pgn = (b, date) => pgnOf(b, [['Event', 'Free board'], ['Site', 'chess-replay'], ['Date', date || today()], ['White', 'White'], ['Black', 'Black'], ['Result', '*']], '*');

  // A stored board back: the legal prefix of its moves, upto clamped (a missing one shows the last move), its game resumed
  // (`now` given for a reload: PlayCore.resume); null when the FEN doesn't parse. Never throws, whatever localStorage held.
  function restore(saved, now) {
    try {
      if (!saved || typeof saved !== 'object' || typeof saved.fen !== 'string') return null;
      let b = fromFen(saved.fen, { chess960: saved.chess960 });
      const engine = new Set(Array.isArray(saved.engine) ? saved.engine : []);
      for (const u of Array.isArray(saved.moves) ? saved.moves : []) {
        let step = null;
        try { step = typeof u === 'string' ? CC().stepFromUci(pos(b), u) : null; } catch (e) {}
        if (!step) break;
        b = play(b, engine.has(b.upto + 1) ? { ...step, byEngine: true } : step);
      }
      b = go(b, typeof saved.upto === 'number' ? saved.upto : b.steps.length - 1);
      return saved.game && window.PlayCore ? window.PlayCore.resume(b, saved.game, now) : b;
    } catch (e) {
      return null;
    }
  }

  // The mouse wheel over a board as move steps, as on Lichess (down the next move, up the previous): the first turn after
  // a pause steps at once; a stream of them (a trackpad, a fast wheel) adds its deltas, in pixels (lines and pages
  // scaled), to a step every WHEEL.px, and drops them for WHEEL.gap ms after a step, so it walks the moves rather than
  // skipping many; a turn the other way starts again. w is { acc, last, at } (wheelStart()); returns { w, d } (d ±1 or 0)
  const WHEEL = { px: 60, gap: 90, idle: 250 };
  const wheelStart = () => ({ acc: 0, last: -Infinity, at: -Infinity });
  function wheel(w, dy, mode, now) {
    const px = dy * (mode === 1 ? 40 : mode === 2 ? 800 : 1);
    if (!px) return { w, d: 0 };
    const fresh = now - w.last > WHEEL.idle;
    if (!fresh && now - w.at < WHEEL.gap) return { w: { ...w, acc: 0, last: now }, d: 0 };
    const acc = (fresh || Math.sign(px) !== Math.sign(w.acc) ? 0 : w.acc) + px;
    if (!fresh && Math.abs(acc) < WHEEL.px) return { w: { ...w, acc, last: now }, d: 0 };
    return { w: { acc: 0, last: now, at: now }, d: Math.sign(acc) };
  }

  window.BoardCore = { fromFen, restore, save, play, go, pos, ucis, label, today, pgnOf, pgn, WHEEL, wheelStart, wheel };
})();
