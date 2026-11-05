// The position editor's state and rules. A setup is a plain object { b, turn, castle, ep, half, full }, never
// mutated: b is a ChessCore board (64 squares, 0 = a8), castle the rights in KQkq order ('' for none), ep a square
// index or -1. Any piece placement is a setup (no king, two kings, a pawn on the back rank); problems() says what
// stops it being a position, and a setup with none is one ChessCore.parseFen accepts. The FEN rules
// themselves (reading, castling homes, problems) are ChessCore's.
(function () {
  const CC = () => window.ChessCore;
  const empty = () => ({ b: new Array(64).fill(null), turn: 'w', castle: '', ep: -1, half: 0, full: 1 });
  const start = () => fromFen(CC().START_FEN).setup;

  const canCastle = (s, r) => CC().canCastle(s.b, r);
  const keepRights = (s, rights) => 'KQkq'.split('').filter((r) => rights.includes(r) && canCastle(s, r)).join('');
  // after any change to the pieces: rights whose king or rook left home go, and so does en passant
  const settle = (s) => ({ ...s, castle: keepRights(s, s.castle), ep: -1 });

  // Pasted text as a setup: a PGN tag [FEN "…"] unwrapped, the fields after the board optional. Only malformed text is
  // refused; castling rights or an en passant square the pieces don't support are dropped (ChessCore.readFen)
  function fromFen(text) {
    let t = String(text == null ? '' : text).trim();
    const tag = /^\[\s*FEN\s+"([^"]*)"\s*\]$/i.exec(t);
    if (tag) t = tag[1].trim();
    if (!t) return { error: 'Paste a FEN first' };
    const r = CC().readFen(t);
    return r.error ? { error: r.error } : { setup: r.setup };
  }

  const toFen = (s) => CC().setupFen(s);

  function put(s, sq, piece) { const b = s.b.slice(); b[sq] = piece || null; return settle({ ...s, b }); }
  function move(s, from, to) {
    if (from === to) return s;
    const b = s.b.slice(); b[to] = b[from]; b[from] = null;
    return settle({ ...s, b });
  }
  const setTurn = (s, turn) => ({ ...s, turn, ep: -1 });
  function setCastle(s, r, on) {
    if (on && !canCastle(s, r)) return s;
    return { ...s, castle: 'KQkq'.split('').filter((c) => (c === r ? on : s.castle.includes(c))).join('') };
  }
  const isEmpty = (s) => s.b.every((p) => !p);

  // What stops the setup being a position, in plain words, each a sentence; [] when it is one
  const problems = (s) => CC().setupProblems(s);
  const ok = (s) => problems(s).length === 0;

  window.EditCore = { empty, start, fromFen, toFen, put, move, setTurn, canCastle, setCastle, isEmpty, problems, ok };
})();
