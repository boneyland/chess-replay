// The position editor's state and rules. A setup is a plain object { b, turn, castle, ep, half, full }, never
// mutated: b is a ChessCore board (64 squares, 0 = a8), castle the rights in KQkq order ('' for none), ep a square
// index or -1. Any piece placement is a setup (no king, two kings, a pawn on the back rank); problems() says what
// stops it being a position, and a setup with none is one ChessCore.parseFen accepts.
(function () {
  const CC = () => window.ChessCore;
  const FILES = 'abcdefgh';
  const idxSq = (i) => FILES[i % 8] + (8 - Math.floor(i / 8));
  const NAME = { w: 'White', b: 'Black' };
  // each right's king and rook squares: e1/h1, e1/a1, e8/h8, e8/a8
  const HOME = { K: [60, 63, 'K', 'R'], Q: [60, 56, 'K', 'R'], k: [4, 7, 'k', 'r'], q: [4, 0, 'k', 'r'] };

  const empty = () => ({ b: new Array(64).fill(null), turn: 'w', castle: '', ep: -1, half: 0, full: 1 });
  const start = () => fromFen(CC().START_FEN).setup;

  const canCastle = (s, r) => { const [k, rk, K, R] = HOME[r]; return s.b[k] === K && s.b[rk] === R; };
  const keepRights = (s, rights) => 'KQkq'.split('').filter((r) => rights.includes(r) && canCastle(s, r)).join('');
  // after any change to the pieces: rights whose king or rook left home go, and so does en passant
  const settle = (s) => ({ ...s, castle: keepRights(s, s.castle), ep: -1 });

  // the en passant square stands if the pawn that just moved two is in front of it and the squares it crossed are empty
  function epFits(b, turn, ep) {
    const dir = turn === 'w' ? 1 : -1;
    return Math.floor(ep / 8) === (turn === 'w' ? 2 : 5) && !b[ep] && !b[ep - 8 * dir] && b[ep + 8 * dir] === (turn === 'w' ? 'p' : 'P');
  }

  // Pasted text as a setup: a PGN tag [FEN "…"] unwrapped, runs of spaces collapsed, the fields after the board
  // optional. Only malformed text is refused; castling rights or an en passant square the pieces don't support are dropped
  function fromFen(text) {
    let t = String(text == null ? '' : text).trim();
    const tag = /^\[\s*FEN\s+"([^"]*)"\s*\]$/i.exec(t);
    if (tag) t = tag[1].trim();
    t = t.replace(/\s+/g, ' ');
    if (!t) return { error: 'Paste a FEN first' };
    const f = t.split(' '), bad = { error: `That isn't a FEN: ${t.slice(0, 80)}` };
    const ranks = f[0].split('/'), width = (r) => [...r].reduce((n, c) => n + (/\d/.test(c) ? +c : 1), 0);
    if (f.length > 6 || ranks.length !== 8 || !ranks.every((r) => /^[pnbrqkPNBRQK1-8]+$/.test(r) && width(r) === 8)) return bad;
    const turn = f[1] || 'w', castle = f[2] || '-', ep = f[3] || '-', half = f[4] || '0', full = f[5] || '1';
    if (!/^[wb]$/.test(turn) || !/^\d+$/.test(half) || !/^\d+$/.test(full) || !/^(-|[a-h][1-8])$/.test(ep)) return bad;
    if (/[A-Ha-h]/.test(castle)) return { error: "Chess960 positions aren't supported yet" };
    if (castle !== '-' && !/^[KQkq]{1,4}$/.test(castle)) return bad;
    const b = CC().posFromFen(f[0]).b, epIdx = ep === '-' ? -1 : CC().sqIndex(ep);
    const s = { b, turn, castle: '', ep: epIdx >= 0 && epFits(b, turn, epIdx) ? epIdx : -1, half: +half, full: Math.max(1, +full) };
    return { setup: { ...s, castle: keepRights(s, castle === '-' ? '' : castle) } };
  }

  function toFen(s) {
    return [CC().toFen({ b: s.b, turn: s.turn }), s.castle || '-', s.ep >= 0 ? idxSq(s.ep) : '-', s.half, s.full].join(' ');
  }

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

  // two pieces on one rank, file or diagonal with the king: no single move gives both checks
  function inLine(a, c, k) {
    const dx = (k % 8) - (a % 8), dy = Math.floor(k / 8) - Math.floor(a / 8), ex = (c % 8) - (a % 8), ey = Math.floor(c / 8) - Math.floor(a / 8);
    const line = ex === 0 || ey === 0 || Math.abs(ex) === Math.abs(ey);
    return line && dx * ey === dy * ex;
  }

  // What stops the setup being a position, in plain words, each a sentence; [] when it is one
  function problems(s) {
    const out = [], count = (p) => s.b.filter((x) => x === p).length;
    for (const [side, K] of [['w', 'K'], ['b', 'k']]) {
      const n = count(K);
      if (n === 0) out.push(`${NAME[side]} has no king.`); else if (n > 1) out.push(`${NAME[side]} has ${n} kings.`);
    }
    s.b.forEach((p, i) => { if ((p === 'P' || p === 'p') && (i < 8 || i > 55)) out.push(`The pawn on ${idxSq(i)} can't stand on the first or last rank.`); });
    if (count('K') !== 1 || count('k') !== 1) return out;
    const other = s.turn === 'w' ? 'b' : 'w';
    if (CC().inCheck(s.b, other)) out.push(`${NAME[other]} is in check, but it's ${NAME[s.turn]}'s turn.`);
    const ch = CC().checkers(s.b, s.turn), k = s.b.indexOf(s.turn === 'w' ? 'K' : 'k');
    if (ch.length > 2) out.push(`${NAME[s.turn]} is in check from ${ch.length} pieces, which no move can give.`);
    else if (ch.length === 2 && inLine(ch[0], ch[1], k)) out.push(`${NAME[s.turn]} is in check from two pieces in a line, which no move can give.`);
    return out;
  }
  const ok = (s) => problems(s).length === 0;

  window.EditCore = { empty, start, fromFen, toFen, put, move, setTurn, canCastle, setCastle, isEmpty, problems, ok };
})();
