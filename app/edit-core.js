// The position editor's state and rules. A setup is a plain object { b, turn, castle, ep, half, full, rooks? }, never
// mutated: b is a ChessCore board (64 squares, 0 = a8), castle the rights in KQkq order ('' for none), rooks each
// right's rook square where any right isn't the standard home pair (Chess960; absent otherwise), ep a square
// index or -1. Any piece placement is a setup (no king, two kings, a pawn on the back rank); problems() says what
// stops it being a position, and a setup with none is one ChessCore.parseFen accepts. The FEN rules
// themselves (reading, castling homes, problems) are ChessCore's.
(function () {
  const CC = () => window.ChessCore;
  const empty = () => ({ b: new Array(64).fill(null), turn: 'w', castle: '', ep: -1, half: 0, full: 1 });
  const start = () => fromFen(CC().START_FEN).setup;

  // a right stands where its king is on its first rank with a rook of its colour on that side (any file: Chess960)
  const canCastle = (s, r) => CC().castleRook(s.b, r, s.rooks) >= 0;
  const keepRights = (s, rights) => 'KQkq'.split('').filter((r) => rights.includes(r) && canCastle(s, r)).join('');
  const kingAt = (b, r) => b.indexOf(r < 'a' ? 'K' : 'k');
  // the setup with these rights and rook squares; rooks goes entirely when every right is the standard home pair
  // (ChessCore.CASTLE_HOME)
  function withRooks(s, castle, rooks) {
    const H = CC().CASTLE_HOME;
    const std = castle.split('').every((r) => rooks[r] === H[r][1] && s.b[H[r][0]] === (r < 'a' ? 'K' : 'k'));
    const { rooks: _, ...rest } = s;
    return std ? { ...rest, castle } : { ...rest, castle, rooks };
  }
  // an explicit choice of rights (a box ticked or cleared): each kept right stays on its previous rook while that rook
  // stands there, else takes the outermost
  function withRights(s, rights) {
    const castle = keepRights(s, rights), rooks = {};
    for (const r of castle) rooks[r] = CC().castleRook(s.b, r, s.rooks);
    return withRooks(s, castle, rooks);
  }
  // the en passant squares the pieces allow for the side to move: behind a pawn of the other side's that could just
  // have moved two (ChessCore.epFits), in file order
  function epSquares(s) {
    const r = s.turn === 'w' ? 2 : 5, out = [];
    for (let i = r * 8; i < r * 8 + 8; i++) if (CC().epFits(s.b, s.turn, i)) out.push(i);
    return out;
  }
  const keepEp = (s) => (s.ep >= 0 && CC().epFits(s.b, s.turn, s.ep) ? s : { ...s, ep: -1 });
  // after a change to the pieces (old → s): a right stays only while its king and its rook stand on the squares they
  // had in old (so moving a king or rook never turns a right into a 960 one), and an en passant square the pieces no
  // longer allow goes
  function settle(old, s) {
    const rooks = {};
    const castle = s.castle.split('').filter((r) => {
      const rk = CC().castleRook(old.b, r, old.rooks);
      if (rk < 0 || kingAt(s.b, r) !== kingAt(old.b, r) || CC().castleRook(s.b, r, { [r]: rk }) !== rk) return false;
      rooks[r] = rk; return true;
    }).join('');
    return keepEp(withRooks(s, castle, rooks));
  }

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

  function put(s, sq, piece) { const b = s.b.slice(); b[sq] = piece || null; return settle(s, { ...s, b }); }
  function move(s, from, to) {
    if (from === to) return s;
    const b = s.b.slice(); b[to] = b[from]; b[from] = null;
    return settle(s, { ...s, b });
  }
  const setTurn = (s, turn) => keepEp({ ...s, turn });
  // A double pawn push resets the half-move clock, so an en passant square comes with a clock of 0: setting a square
  // zeroes the clock, and a clock above 0 drops the square
  function setEp(s, ep) {
    if (ep < 0) return { ...s, ep: -1 };
    return CC().epFits(s.b, s.turn, ep) ? { ...s, ep, half: 0 } : s;
  }
  // a counter as typed: a whole number from min up to MAX_COUNT, else null (and the setter keeps the old value)
  const MAX_COUNT = 9999;
  function count(v, min) {
    const n = typeof v === 'number' ? v : /^\s*\d+\s*$/.test(String(v)) ? +v : NaN;
    return Number.isInteger(n) && n >= min && n <= MAX_COUNT ? n : null;
  }
  const setHalf = (s, v) => { const n = count(v, 0); return n == null ? s : { ...s, half: n, ep: n > 0 ? -1 : s.ep }; };
  const setFull = (s, v) => { const n = count(v, 1); return n == null ? s : { ...s, full: n }; };
  function setCastle(s, r, on) {
    if (on && !canCastle(s, r)) return s;
    return withRights(s, 'KQkq'.split('').filter((c) => (c === r ? on : s.castle.includes(c))).join(''));
  }
  const isEmpty = (s) => s.b.every((p) => !p);

  // What stops the setup being a position, in plain words, each a sentence; [] when it is one
  const problems = (s) => CC().setupProblems(s);
  const ok = (s) => problems(s).length === 0;

  window.EditCore = { empty, start, fromFen, toFen, put, move, setTurn, epSquares, setEp, setHalf, setFull, count, MAX_COUNT, canCastle, setCastle, isEmpty, problems, ok };
})();
