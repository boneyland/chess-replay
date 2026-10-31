// A free board's state: a start position, the moves played from it and the move shown. Boards are plain
// objects { fen, start: { pos, ply0 }, steps, upto }, never mutated; steps are ChessCore line steps and
// upto is the index of the step shown (-1 for the start). Moves after upto stay until a new move replaces them.
(function () {
  const CC = () => window.ChessCore;
  const clamp = (b, upto) => Math.max(-1, Math.min(b.steps.length - 1, Math.floor(Number(upto)) || 0));

  function fromFen(fen) {
    const s = CC().parseFen(fen == null ? CC().START_FEN : fen);
    return { fen: s.fen, start: { pos: s.pos, ply0: s.ply0 }, steps: [], upto: -1 };
  }

  const pos = (b) => (b.upto >= 0 ? b.steps[b.upto].pos : b.start.pos);
  const ucis = (b, n = b.upto + 1) => b.steps.slice(0, Math.max(0, n)).map((s) => s.uci);
  const label = (b, j) => CC().moveNo(b.start.ply0 + j) + ' ' + b.steps[j].san;
  const play = (b, step) => ({ ...b, steps: [...b.steps.slice(0, b.upto + 1), step], upto: b.upto + 1 });
  const go = (b, upto) => ({ ...b, upto: clamp(b, upto) });
  // a game on the board (PlayCore) is kept with it
  const save = (b) => ({ fen: b.fen, moves: b.steps.map((s) => s.uci), upto: b.upto, ...(b.game ? { game: b.game } : {}) });

  // today as PGN's YYYY.MM.DD
  const today = () => { const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };

  // The board's whole line (not only up to the move shown) as a PGN ending in res: the tags, SetUp and FEN after them when
  // the start isn't the standard one, then `more`. A move number goes before White's moves, the first move, and Black's
  // moves where again(j) says (after a comment); after(j) is written after step j's move (its comment)
  function pgnOf(b, tags, res, { more = [], again = () => false, after = () => '' } = {}) {
    const all = tags.concat(b.fen !== CC().START_FEN ? [['SetUp', '1'], ['FEN', b.fen]] : [], more);
    const moves = b.steps.map((s, j) => {
      const ply = b.start.ply0 + j, n = Math.floor(ply / 2) + 1;
      return (ply % 2 === 0 ? `${n}. ` : j === 0 || again(j) ? `${n}... ` : '') + s.san + after(j);
    });
    return all.map(([k, v]) => `[${k} "${v}"]`).join('\n') + '\n\n' + moves.concat(res).join(' ') + '\n';
  }

  // The board's moves as a game for the replay. date: PGN's YYYY.MM.DD, today when omitted
  const pgn = (b, date) => pgnOf(b, [['Event', 'Free board'], ['Site', 'chess-replay'], ['Date', date || today()], ['White', 'White'], ['Black', 'Black'], ['Result', '*']], '*');

  // A stored board back: the legal prefix of its moves, upto clamped (a missing one shows the last move), its game resumed
  // (`now` given for a reload: PlayCore.resume); null when the FEN doesn't parse. Never throws, whatever localStorage held.
  function restore(saved, now) {
    try {
      if (!saved || typeof saved !== 'object' || typeof saved.fen !== 'string') return null;
      let b = fromFen(saved.fen);
      for (const u of Array.isArray(saved.moves) ? saved.moves : []) {
        let step = null;
        try { step = typeof u === 'string' ? CC().stepFromUci(pos(b), u) : null; } catch (e) {}
        if (!step) break;
        b = play(b, step);
      }
      b = go(b, typeof saved.upto === 'number' ? saved.upto : b.steps.length - 1);
      return saved.game && window.PlayCore ? window.PlayCore.resume(b, saved.game, now) : b;
    } catch (e) {
      return null;
    }
  }

  window.BoardCore = { fromFen, restore, save, play, go, pos, ucis, label, today, pgnOf, pgn };
})();
