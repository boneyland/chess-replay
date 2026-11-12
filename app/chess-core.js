// PGN / analysis / notes → normalized game model for game-video.jsx
(function () {
  const FILES = 'abcdefgh';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const START_FEN = START + ' w KQkq - 0 1';
  const sqIdx = (s) => (8 - +s[1]) * 8 + (s.charCodeAt(0) - 97);
  const idxSq = (i) => FILES[i % 8] + (8 - Math.floor(i / 8));
  const fx = (i) => i % 8, fy = (i) => Math.floor(i / 8);
  const at = (x, y) => (x >= 0 && x < 8 && y >= 0 && y < 8 ? y * 8 + x : -1);
  const colorOf = (p) => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null);

  function fromFen(f) {
    const b = new Array(64).fill(null); let i = 0;
    for (const ch of f.split(' ')[0]) { if (ch === '/') continue; if (/\d/.test(ch)) { i += +ch; continue; } b[i++] = ch; }
    return b;
  }
  function geo(b, from, to, type) {
    const dx = fx(to) - fx(from), dy = fy(to) - fy(from), ax = Math.abs(dx), ay = Math.abs(dy);
    if (type === 'n') return (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
    if (type === 'k') return Math.max(ax, ay) === 1;
    if (type === 'r' && dx && dy) return false;
    if (type === 'b' && ax !== ay) return false;
    if (type === 'q' && !(dx === 0 || dy === 0 || ax === ay)) return false;
    if (!dx && !dy) return false;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    let x = fx(from) + sx, y = fy(from) + sy;
    while (x !== fx(to) || y !== fy(to)) { if (b[at(x, y)]) return false; x += sx; y += sy; }
    return true;
  }
  function canReach(b, from, to, type, color, ep) {
    const target = b[to];
    if (target && colorOf(target) === color) return false;
    if (type === 'p') {
      const dir = color === 'w' ? -1 : 1, dx = fx(to) - fx(from), dy = fy(to) - fy(from);
      if (dx === 0 && !target) {
        if (dy === dir) return true;
        return fy(from) === (color === 'w' ? 6 : 1) && dy === 2 * dir && !b[at(fx(from), fy(from) + dir)];
      }
      return Math.abs(dx) === 1 && dy === dir && (!!target || to === ep);
    }
    return geo(b, from, to, type);
  }
  function attacked(b, sq, by) {
    for (let i = 0; i < 64; i++) {
      const p = b[i]; if (!p || colorOf(p) !== by) continue;
      const t = p.toLowerCase();
      if (t === 'p') { if (fy(sq) - fy(i) === (by === 'w' ? -1 : 1) && Math.abs(fx(sq) - fx(i)) === 1) return true; continue; }
      if (geo(b, i, sq, t)) return true;
    }
    return false;
  }
  // Each castling right's king and rook squares (e1/h1, e1/a1, e8/h8, e8/a8), the one place they are written; CASTLE_LOSS:
  // the rights a move from or to each of those squares takes away
  const CASTLE_HOME = { K: [60, 63], Q: [60, 56], k: [4, 7], q: [4, 0] };
  const CASTLE_LOSS = {};
  for (const [r, sqs] of Object.entries(CASTLE_HOME)) for (const sq of sqs) CASTLE_LOSS[sq] = (CASTLE_LOSS[sq] || '') + r;
  function applyMove(pos, from, to, promo) {
    const b = pos.b.slice(), p = b[from], t = p.toLowerCase(), color = colorOf(p);
    let ep = -1, epCap = -1;
    if (t === 'p' && to === pos.ep && !b[to]) { epCap = at(fx(to), fy(from)); b[epCap] = null; }
    if (t === 'p' && Math.abs(fy(to) - fy(from)) === 2) ep = at(fx(from), (fy(from) + fy(to)) / 2);
    if (t === 'k' && Math.abs(fx(to) - fx(from)) === 2) {
      const y = fy(from);
      if (fx(to) === 6) { b[at(5, y)] = b[at(7, y)]; b[at(7, y)] = null; } else { b[at(3, y)] = b[at(0, y)]; b[at(0, y)] = null; }
    }
    b[to] = promo ? (color === 'w' ? promo.toUpperCase() : promo.toLowerCase()) : p; b[from] = null;
    // castling rights go when the king or a rook leaves its square, or a rook is taken there
    let castle = pos.castle == null ? 'KQkq' : pos.castle;
    for (const sq of [from, to]) if (CASTLE_LOSS[sq]) castle = castle.replace(new RegExp(`[${CASTLE_LOSS[sq]}]`, 'g'), '');
    return { b, ep, epCap, turn: color === 'w' ? 'b' : 'w', castle };
  }
  function toFen(pos) {
    const rows = [];
    for (let y = 0; y < 8; y++) { let s = '', e = 0; for (let x = 0; x < 8; x++) { const p = pos.b[y * 8 + x]; if (p) { if (e) { s += e; e = 0; } s += p; } else e++; } if (e) s += e; rows.push(s); }
    return rows.join('/') + ' ' + pos.turn;
  }
  const kingIdx = (b, color) => b.findIndex((p) => p === (color === 'w' ? 'K' : 'k'));
  const inCheck = (b, color) => { const k = kingIdx(b, color); return k >= 0 && attacked(b, k, color === 'w' ? 'b' : 'w'); };
  // the squares of the pieces giving check to color's king (none without a king)
  function checkers(b, color) {
    const k = kingIdx(b, color), by = color === 'w' ? 'b' : 'w', out = [];
    if (k < 0) return out;
    for (let i = 0; i < 64; i++) {
      const p = b[i]; if (!p || colorOf(p) !== by) continue;
      const t = p.toLowerCase();
      if (t === 'p' ? fy(k) - fy(i) === (by === 'w' ? -1 : 1) && Math.abs(fx(k) - fx(i)) === 1 : geo(b, i, k, t)) out.push(i);
    }
    return out;
  }
  function hasLegal(pos) {
    for (let i = 0; i < 64; i++) {
      const p = pos.b[i]; if (!p || colorOf(p) !== pos.turn) continue;
      for (let j = 0; j < 64; j++) {
        if (!canReach(pos.b, i, j, p.toLowerCase(), pos.turn, pos.ep)) continue;
        if (!inCheck(applyMove(pos, i, j, null).b, pos.turn)) return true;
      }
    }
    return false;
  }
  const tOf = (p) => p.toLowerCase();

  const FIGURINE = { '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♙': '', '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N', '♟': '' };
  function sanToMove(pos, san) {
    if (/^(--|Z0|0000|@@@@)$/.test(san)) throw new Error(`The game has a null move ("${san}"), which this player can't show`);
    // besides plain SAN: figurines (♘f3), an e.p. suffix, long algebraic (e2-e4, Ng1-f3) and castling with zeros
    let s = san.replace(/[♔-♟]/g, (c) => FIGURINE[c]).replace(/[+#!?]+$/, '').replace(/e\.p\.$/, '').replace(/[+#]+$/, '');
    s = s.replace(/^([NBRQK]?[a-h][1-8])-([a-h][1-8])/, '$1$2');
    if (/^0-0/.test(s)) s = s.replace(/0/g, 'O');
    const color = pos.turn;
    // castling is checked in full (rights, rook, empty squares, no check on the king's path): a PGN's O-O isn't trusted
    if (/^O-O(-O)?$/.test(s)) {
      const y = color === 'w' ? 7 : 0, from = at(4, y), to = at(s.length > 3 ? 2 : 6, y);
      if (pos.b[from] !== (color === 'w' ? 'K' : 'k') || !legalMove(pos, from, to)) throw new Error(`"${san}" is not a legal move here`);
      return { from, to, promo: null };
    }
    const m = s.match(/^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQnbrq]))?$/);
    if (!m) throw new Error(`Can't read the move "${san}"`);
    const type = (m[1] || 'P').toLowerCase(), to = sqIdx(m[4]), promo = m[5] ? m[5].toLowerCase() : null;
    // a promotion piece only on a pawn reaching the last rank, and there always one
    if (promo ? type !== 'p' || (fy(to) !== 0 && fy(to) !== 7) : type === 'p' && (fy(to) === 0 || fy(to) === 7)) throw new Error(`"${san}" is not a legal move here`);
    const cands = [];
    for (let i = 0; i < 64; i++) {
      const p = pos.b[i];
      if (!p || colorOf(p) !== color || p.toLowerCase() !== type) continue;
      if (m[2] && FILES[fx(i)] !== m[2]) continue;
      if (m[3] && String(8 - fy(i)) !== m[3]) continue;
      if (!canReach(pos.b, i, to, type, color, pos.ep)) continue;
      if (inCheck(applyMove(pos, i, to, promo).b, color)) continue;
      cands.push(i);
    }
    if (cands.length !== 1) throw new Error(`"${san}" is not a legal move here`);
    return { from: cands[0], to, promo };
  }

  // Games split at a tag line that follows moves, or at the next text after a game's result. A tag line inside a
  // {comment} stays text, and a result inside a comment or a variation ends nothing
  function splitGames(text) {
    const games = []; let cur = [], inMoves = false, ended = false, inComment = false, depth = 0;
    const flush = () => { games.push(cur.join('\n')); cur = []; inMoves = false; ended = false; };
    text.replace(/\r/g, '').split('\n').forEach((line) => {
      const hdr = !inComment && /^\s*\[\w+\s+".*"\]\s*$/.test(line);
      let outside = '';
      if (!hdr) {
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inComment) { if (ch === '}') inComment = false; continue; }
          if (ch === '{') { inComment = true; outside += ' '; continue; }
          if (ch === ';') break;
          if (ch === '(') depth++;
          else if (ch === ')') depth = Math.max(0, depth - 1);
          else if (depth === 0) outside += ch;
        }
      }
      if ((hdr && inMoves) || (ended && outside.trim())) flush();
      if (outside.trim()) inMoves = true;
      if (depth === 0 && /(?:^|\s)(?:1-0|0-1|1\/2-1\/2|\*)\s*$/.test(outside)) ended = true;
      cur.push(line);
    });
    if (cur.join('').trim()) games.push(cur.join('\n'));
    return games.filter((g) => /\S/.test(g));
  }
  const NAG = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };
  function parsePGN(text) {
    const headers = {};
    // a comment ({…} or ; to the end of the line) is passed over whole, so a tag written inside one stays its text
    const body = text.replace(/\{[^}]*\}?|;[^\n]*|\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]/g, (m, k, v) => { if (!k) return m; headers[k] = v.replace(/\\(["\\])/g, '$1'); return ' '; });
    // a [FEN] start with Black to move: the first ply is Black's (cutechess evals below are the mover's)
    const black0 = (headers.FEN || '').trim().split(/\s+/)[1] === 'b';
    const plies = []; let intro = '', depth = 0, varPly = -1, varSans = null, varAt = 0, i = 0;
    const addComment = (raw) => {
      if (depth > 0) return;
      const ev = raw.match(/\[%eval\s+([^\]\s]+)/), ck = raw.match(/\[%clk\s+([\d:.]+)/);
      // cutechess engine comments: {+0.25/20 1.2s}, {+M5/30 0.8s} (M counts plies), {book}; cutechess
      // stores them for the side that just moved (its whitepov option only fixes engines that report White's view)
      const ae = ev ? null : raw.match(/^\s*([+-]?)(?:(\d+(?:\.\d+)?)|M(\d+))\/\d+(?:\s+[\d.]+s\b|\s*$)/);
      const txt = (ae ? raw.slice(ae[0].length) : raw).replace(/\[%[^\]]*\]/g, '').replace(/^\s*book\s*$/, '').replace(/\s+/g, ' ').trim();
      const t = plies[plies.length - 1];
      if (!t) { if (txt) intro = (intro + ' ' + txt).trim(); return; }
      if (ev) { if (ev[1][0] === '#') t.mate = parseInt(ev[1].slice(1), 10); else t.cp = Math.round(parseFloat(ev[1]) * 100); }
      if (ae) {
        const sign = (ae[1] === '-' ? -1 : 1) * ((plies.length - 1 + (black0 ? 1 : 0)) % 2 ? -1 : 1);
        if (ae[3]) t.mate = sign * Math.ceil(parseInt(ae[3], 10) / 2); else t.cp = sign * Math.round(parseFloat(ae[2]) * 100);
      }
      if (ck) t.clk = ck[1].split(':').map(Number).reduce((a, x) => a * 60 + x, 0);
      if (txt) t.comment = (t.comment ? t.comment + ' ' : '') + txt;
    };
    while (i < body.length) {
      const ch = body[i];
      if (ch === '{') { const j = body.indexOf('}', i); addComment(body.slice(i + 1, j < 0 ? body.length : j)); i = j < 0 ? body.length : j + 1; continue; }
      if (ch === ';') { const j = body.indexOf('\n', i); i = j < 0 ? body.length : j + 1; continue; }
      if (ch === '(') { depth++; if (depth === 1) { varPly = plies.length - 1; varSans = []; varAt = i; } i++; continue; }
      if (ch === ')') {
        if (depth === 1 && varPly >= 0) {
          const P = plies[varPly];
          if (!P.variation) P.variation = varSans;
          // every variation as written, nested ones and comments included, so an annotated PGN keeps them
          (P.vars = P.vars || []).push(body.slice(varAt, i + 1));
        }
        depth = Math.max(0, depth - 1); i++; continue;
      }
      if (/\s/.test(ch)) { i++; continue; }
      let j = i; while (j < body.length && !/[\s{}();]/.test(body[j])) j++;
      // a stray } (a comment with a { inside it) has no token: skip it, or the loop never moves on
      if (j === i) { i++; continue; }
      let tok = body.slice(i, j); i = j;
      if (/^\$\d+$/.test(tok)) {
        const P = depth === 0 && plies[plies.length - 1], n = +tok.slice(1);
        // $1–$6 are the move's mark; the rest ($14 White is slightly better, …) are kept as they are
        if (P) { if (NAG[n]) P.mark = NAG[n]; else (P.nags = P.nags || []).push(n); }
        continue;
      }
      tok = tok.replace(/^\d+\.+/, '');
      if (!tok || /^(1-0|0-1|1\/2-1\/2|\*|e\.p\.[+#]?)$/.test(tok)) continue;
      const mm = tok.match(/^(.*?)([!?]{1,2})?$/);
      if (depth === 0) plies.push({ san: mm[1], mark: mm[2] || null });
      else if (depth === 1) varSans.push(mm[1]);
    }
    return { headers, plies, intro };
  }
  function parseNotes(text) {
    const out = { plies: {} }, re = /^\s*\[(\d+|INTRO|RESULT|CONCLUSION)\]/gim, keys = []; let m;
    while ((m = re.exec(text))) keys.push({ k: m[1].toUpperCase(), s: m.index, e: m.index + m[0].length });
    keys.forEach((k, i) => {
      const txt = text.slice(k.e, i + 1 < keys.length ? keys[i + 1].s : text.length).replace(/\s+/g, ' ').trim();
      if (/^\d+$/.test(k.k)) out.plies[+k.k] = txt; else out[k.k.toLowerCase()] = txt;
    });
    return out;
  }

  const MARK_CLASS = { '?!': 'inaccuracy', '?': 'mistake', '??': 'blunder', '!': 'good', '!!': 'brilliant', '!?': 'interesting' };
  const ENGINE_MARK = { inaccuracy: '?!', mistake: '?', blunder: '??' };
  const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  const fmtDate = (d) => { const m = (d || '').match(/^(\d{4})\.(\d{2})\.(\d{2})$/); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : (d || '').replace(/\.\?\?/g, ''); };
  const surname = (n) => (n || '').split(',')[0].trim();
  const clean = (v) => (v && v !== '?' && v !== '-' ? v : '');

  function classifyFile(name, text) {
    try { const j = JSON.parse(text); if (j && j.format === 'queen-answers') return 'queen'; if (j && Array.isArray(j.moves)) return 'analysis'; } catch (e) {}
    if (/_notes\.txt$/i.test(name) || (/^\s*\[(\d+|INTRO|RESULT|CONCLUSION)\]/im.test(text) && !/^\s*\[\w+\s+"/m.test(text))) return 'notes';
    return 'pgn';
  }

  // "12." for White's ply, "12…" for Black's; absPly counts half-moves from the standard start (Black's first move is 1)
  const moveNo = (absPly) => Math.floor(absPly / 2) + 1 + (absPly % 2 ? '…' : '.');

  // ---------- FEN and setups ----------
  // A setup is { b, turn, castle, ep, half, full }: b a board (64 squares, 0 = a8), castle the rights in KQkq order ('' for
  // none), ep a square index or -1. Any placement is a setup; setupProblems says what stops it being a position.
  const canCastle = (b, r) => { const [k, rk] = CASTLE_HOME[r], w = r < 'a'; return b[k] === (w ? 'K' : 'k') && b[rk] === (w ? 'R' : 'r'); };
  // the en passant square stands if the pawn that just moved two is in front of it and the squares it crossed are empty
  function epFits(b, turn, ep) {
    const dir = turn === 'w' ? 1 : -1;
    return Math.floor(ep / 8) === (turn === 'w' ? 2 : 5) && !b[ep] && !b[ep - 8 * dir] && b[ep + 8 * dir] === (turn === 'w' ? 'p' : 'P');
  }

  // A FEN's text as a setup: the fields after the board optional, rights in any order. Only malformed text is an error
  // ({ error }); castling rights or an en passant square the pieces don't support are left out of the setup and named in
  // dropped: { castle: the rights left out, ep: whether the square was }
  function readFen(text) {
    const t = String(text == null ? '' : text).trim(), f = t.split(/\s+/), bad = { error: `That isn't a FEN: ${t.replace(/\s+/g, ' ').slice(0, 80)}` };
    const ranks = f[0].split('/'), width = (r) => [...r].reduce((n, c) => n + (/\d/.test(c) ? +c : 1), 0);
    if (f.length > 6 || ranks.length !== 8 || !ranks.every((r) => /^[pnbrqkPNBRQK1-8]+$/.test(r) && width(r) === 8)) return bad;
    const turn = f[1] || 'w', castle = f[2] || '-', ep = f[3] || '-', half = f[4] || '0', full = f[5] || '1';
    if (!/^[wb]$/.test(turn) || !/^\d+$/.test(half) || !/^\d+$/.test(full) || !/^(-|[a-h][1-8])$/.test(ep)) return bad;
    if (/[A-Ha-h]/.test(castle)) return { error: "Chess960 positions aren't supported yet" };
    if (castle !== '-' && !/^[KQkq]{1,4}$/.test(castle)) return bad;
    const b = fromFen(f[0]), asked = castle === '-' ? '' : castle, epIdx = ep === '-' ? -1 : sqIdx(ep);
    const rights = 'KQkq'.split('').filter((r) => asked.includes(r));
    const kept = rights.filter((r) => canCastle(b, r)).join(''), epOk = epIdx >= 0 && epFits(b, turn, epIdx);
    return {
      setup: { b, turn, castle: kept, ep: epOk ? epIdx : -1, half: +half, full: Math.max(1, +full) },
      dropped: { castle: rights.filter((r) => !kept.includes(r)).join(''), ep: epIdx >= 0 && !epOk },
    };
  }

  // two pieces on one rank, file or diagonal with the king: no single move gives both checks
  function inLine(a, c, k) {
    const dx = (k % 8) - (a % 8), dy = Math.floor(k / 8) - Math.floor(a / 8), ex = (c % 8) - (a % 8), ey = Math.floor(c / 8) - Math.floor(a / 8);
    const line = ex === 0 || ey === 0 || Math.abs(ex) === Math.abs(ey);
    return line && dx * ey === dy * ex;
  }
  const SIDE_NAME = { w: 'White', b: 'Black' };
  // What stops the setup being a position, in plain words, each a sentence; [] when it is one
  function setupProblems(s) {
    const out = [], count = (p) => s.b.filter((x) => x === p).length;
    for (const [side, K] of [['w', 'K'], ['b', 'k']]) {
      const n = count(K);
      if (n === 0) out.push(`${SIDE_NAME[side]} has no king.`); else if (n > 1) out.push(`${SIDE_NAME[side]} has ${n} kings.`);
    }
    s.b.forEach((p, i) => { if ((p === 'P' || p === 'p') && (i < 8 || i > 55)) out.push(`The pawn on ${idxSq(i)} can't stand on the first or last rank.`); });
    if (count('K') !== 1 || count('k') !== 1) return out;
    const other = s.turn === 'w' ? 'b' : 'w';
    if (inCheck(s.b, other)) out.push(`${SIDE_NAME[other]} is in check, but it's ${SIDE_NAME[s.turn]}'s turn.`);
    const ch = checkers(s.b, s.turn), k = s.b.indexOf(s.turn === 'w' ? 'K' : 'k');
    if (ch.length > 2) out.push(`${SIDE_NAME[s.turn]} is in check from ${ch.length} pieces, which no move can give.`);
    else if (ch.length === 2 && inLine(ch[0], ch[1], k)) out.push(`${SIDE_NAME[s.turn]} is in check from two pieces in a line, which no move can give.`);
    return out;
  }
  // ---------- evals ----------
  // Evals are centipawns from White's point of view. A mate in N is ±(MATE_CP − MATE_STEP·N), as in Python's _eval_to_cp
  // (a checkmate on the board ±MATE_CP); any eval at least MATE_MIN from zero is a mate score (Python calls MATE_CP − MATE_MIN its MATE_BAND_CP)
  const MATE_CP = 10000, MATE_STEP = 10, MATE_MIN = 9000;
  const mateCp = (n) => (n > 0 ? 1 : -1) * (MATE_CP - MATE_STEP * Math.abs(n)); // n > 0: White mates
  const isMateCp = (cp) => Math.abs(cp) >= MATE_MIN;
  const mateIn = (cp) => Math.round((MATE_CP - Math.abs(cp)) / MATE_STEP); // the N of a mate score (0 for a checkmate)
  // Lichess's win chances (−1 to 1) and the drops in them, for the mover, that make a move ?!, ? or ??
  const WIN_K = 0.00368208, WIN_DROP = { inaccuracy: 0.10, mistake: 0.20, blunder: 0.30 };
  const winChance = (cp) => 2 / (1 + Math.exp(-WIN_K * cp)) - 1;

  // Can the side to move take en passant (a legal capture on pos.ep)? Only then does a position's key name the square
  // (FIDE's repetition rule, python-chess's epd())
  function epCapturable(pos) {
    if (pos.ep < 0) return false;
    // only a pawn beside the one that moved two, one rank behind the square, can take there
    const pawn = pos.turn === 'w' ? 'P' : 'p', row = pos.turn === 'w' ? 8 : -8, x = pos.ep % 8;
    for (const dx of [-1, 1]) {
      const from = pos.ep + row + dx;
      if (x + dx >= 0 && x + dx < 8 && pos.b[from] === pawn && legalTargets(pos, from).includes(pos.ep)) return true;
    }
    return false;
  }
  // A position's FEN: castling rights only where the king and rook are still at home ('KQkq' asked where pos records
  // none), the en passant square pos records (ep: 'legal', only where a capture there is legal), then `counters`
  // ([half, full]; none gives the four-field form a position's key uses)
  function fullFen(pos, { ep = 'any', counters = [] } = {}) {
    const asked = pos.castle == null ? 'KQkq' : pos.castle;
    const castle = 'KQkq'.split('').filter((r) => asked.includes(r) && canCastle(pos.b, r)).join('') || '-';
    const e = pos.ep >= 0 && (ep !== 'legal' || epCapturable(pos)) ? idxSq(pos.ep) : '-';
    return [toFen(pos), castle, e, ...counters].join(' ');
  }
  // a setup's six-field FEN
  const setupFen = (s) => [toFen({ b: s.b, turn: s.turn }), s.castle || '-', s.ep >= 0 ? idxSq(s.ep) : '-', s.half, s.full].join(' ');

  // A FEN → { pos, ply0, fen }: fen is the six-field form, ply0 the half-moves before the position (so the move
  // number of the next move is moveNo(ply0)). Throws an Error a reader can act on: unlike readFen, rights or an en
  // passant square the pieces don't support are refused, not dropped
  function parseFen(fen) {
    const r = readFen(fen);
    if (r.error) throw new Error(r.error);
    const s = r.setup, problems = setupProblems(s);
    if (problems.length) throw new Error(problems[0]);
    if (r.dropped.castle) throw new Error("Castling rights don't match the pieces");
    if (r.dropped.ep) throw new Error("The en passant square doesn't match the pieces");
    return {
      pos: { b: s.b, ep: s.ep, turn: s.turn, castle: s.castle },
      ply0: (s.full - 1) * 2 + (s.turn === 'b' ? 1 : 0),
      fen: setupFen(s),
    };
  }

  // The six-field FEN of the position reached by playing `sans` from `startFen`: pos is that position (castling rights
  // and en passant square from it), the half-move clock counted on from the start's, the move number from its ply0
  function fenAfter(startFen, sans, pos) {
    const s = parseFen(startFen);
    let half = +s.fen.split(' ')[4];
    for (const san of sans) half = /^[a-h]/.test(san) || san.includes('x') ? 0 : half + 1;
    return fullFen(pos, { counters: [half, Math.floor((s.ply0 + sans.length) / 2) + 1] });
  }

  const ends = (N) => ({ intro: (N && N.intro) || '', conclusion: (N && (N.conclusion || N.result)) || '' });
  const SAY_ORDER = ['notes', 'pgn']; // a notes file wins over the PGN's comments

  // the sources of commentary this game has
  const commentarySources = (M) => SAY_ORDER.filter((k) => M.says && (M.says[k].intro || M.says[k].conclusion || M.plies.some((p) => p.says && p.says[k])));

  // M with only the commentary of the sources show leaves on ({ pgn, notes }; a missing key is on)
  function withCommentary(M, show) {
    if (!M.says || SAY_ORDER.every((k) => show[k] !== false)) return M;
    const on = SAY_ORDER.filter((k) => show[k] !== false);
    const first = (f) => { for (const k of on) { const v = f(k); if (v) return v; } return ''; };
    return {
      ...M, intro: first((k) => M.says[k].intro), conclusion: first((k) => M.says[k].conclusion),
      plies: M.plies.map((p) => ({ ...p, comment: p.says ? first((k) => p.says[k]) : p.comment })),
    };
  }

  // text without the words an annotated PGN added after it (annotatedPgn writes the PGN's words, then the note's): the
  // same words alone stay unless whole (the conclusion after the last move, which no PGN comment matches by chance)
  function unsaid(text, added, whole = false) {
    if (!text || !added) return text;
    for (const t of new Set([added, pgnEsc(added)])) {
      if (whole && text === t) return '';
      if (text.endsWith(' ' + t)) return text.slice(0, -t.length - 1);
    }
    return text;
  }

  // chess-animator's engine_lines of an analysis move: [{ move, eval, depth, line }], best first; [] where the file has none
  const engineLinesOf = (am) => (am && Array.isArray(am.engine_lines) ? am.engine_lines.filter((l) => l && Array.isArray(l.line) && l.line.length) : []);
  const engineLinesSan = (am) => engineLinesOf(am).map((l) => l.line);
  // those lines from pos as { k, cp, depth, pv: uci moves }, each cut at its first illegal move; a line that doesn't start legally is left out
  function linesFromSan(pos, ls) {
    const out = [];
    ls.forEach((l) => {
      const pv = []; let p = pos;
      for (const san of l.line) { try { const mv = sanToMove(p, san); pv.push(idxSq(mv.from) + idxSq(mv.to) + (mv.promo || '')); p = applyMove(p, mv.from, mv.to, mv.promo); } catch (e) { break; } }
      if (pv.length) out.push({ k: out.length + 1, cp: l.eval, depth: l.depth, pv });
    });
    return out;
  }

  function buildGame(files) {
    const { pgn, analysis, notes } = files;
    const gameIndex = files.gameIndex || 0;
    let P = null, gameCount = 1;
    if (pgn) { const games = splitGames(pgn); if (!games.length) throw new Error('The PGN has no games'); gameCount = games.length; P = parsePGN(games[Math.min(gameIndex, games.length - 1)]); }
    const A = analysis ? (typeof analysis === 'string' ? JSON.parse(analysis) : analysis) : null;
    // commentary layers, lowest priority first: bundled sample notes, user's notes file; each source is
    // kept apart too (ply.says, M.says), so withCommentary can show some of them
    const merge = (ls) => (ls.length ? ls.reduce((acc, n) => ({ ...acc, ...n, plies: { ...acc.plies, ...n.plies } }), { plies: {} }) : null);
    const NT = merge([files.sampleNotes, notes].filter(Boolean).map(parseNotes));
    const pgnHasEval = !!P && P.plies.some((p) => p.cp != null || p.mate != null);
    const useA = !!A && !(files.evalSource === 'pgn' && pgnHasEval);
    const H = P ? P.headers : {};
    // a PGN's [FEN] header, else the analysis file's start; both are normalised, so equal starts compare equal
    const start = parseFen(H.FEN || (!P && A && A.start_fen) || START_FEN);
    const ply0 = start.ply0, stdStart = start.fen === START_FEN;
    const sans = P ? P.plies.map((p) => p.san) : A ? A.moves.map((m) => m.move_san) : [];
    if (!sans.length) throw new Error('No moves found');
    // moves are compared as written and as standard SAN (a PGN's 0-0 or e2-e4 is the analysis file's O-O or e4)
    const bare = (x) => x.replace(/[+#]/g, '');
    const canon = (p, mv) => sanOf(p, { ...mv, after: applyMove(p, mv.from, mv.to, mv.promo) });
    const firstStd = () => { try { return canon(start.pos, sanToMove(start.pos, sans[0])); } catch (e) { return sans[0]; } };
    if (A && P && A.moves.length && bare(A.moves[0].move_san) !== bare(sans[0]) && bare(A.moves[0].move_san) !== bare(firstStd())) throw new Error("The analysis file doesn't match this PGN");
    // chess-animator's analysis JSON never has start_fen (its moves come from the PGN's [FEN] board): then the per-ply SAN match and the side to move decide
    if (A && P && A.start_fen && parseFen(A.start_fen).fen !== start.fen) throw new Error("The analysis file doesn't match this PGN");
    if (A && P && A.moves.length && typeof A.moves[0].is_white_move === 'boolean' && A.moves[0].is_white_move !== (start.pos.turn === 'w')) throw new Error("The analysis file doesn't match this PGN");

    let pos = start.pos;
    const plies = [];
    sans.forEach((san, i) => {
      const am = useA && A.moves[i];
      let mv;
      try { mv = sanToMove(pos, san); } catch (e) { throw new Error(`${e.message} (move ${moveNo(ply0 + i)})`); }
      const before = pos, std = canon(pos, mv);
      if (A && P && am && bare(am.move_san) !== bare(san) && bare(am.move_san) !== bare(std)) throw new Error(`The analysis file doesn't match this PGN at ply ${i + 1}`);
      pos = applyMove(pos, mv.from, mv.to, mv.promo);
      const pp = P ? P.plies[i] : {};
      const check = inCheck(pos.b, pos.turn);
      const ply = { san: std, uci: idxSq(mv.from) + idxSq(mv.to) + (mv.promo || ''), side: (ply0 + i) % 2 ? 'b' : 'w' };
      ply.checkmate = ply.san.endsWith('#');
      if (check) ply.checkSq = idxSq(kingIdx(pos.b, pos.turn));
      ply.fen = toFen(pos);
      ply.castle = pos.castle;
      ply.ep = pos.ep; // the FEN carries neither, so positions rebuilt from it need both
      ply.capture = !!before.b[mv.to] || pos.epCap >= 0;
      // analysis files encode mate in N as a mate score (mateCp), White's point of view
      // the position after it from the tablebase: a win with no distance to mate (6 and 7 pieces) is won, not a mate count
      if (am && am.tb_after) ply.tb = am.tb_after;
      if (am && am.tb_before) ply.tbBefore = am.tb_before; // its best move and line came from the tablebase
      if (am && typeof am.eval_after === 'number' && ply.tb && !ply.tb.dtm && isMateCp(am.eval_after) && Math.abs(am.eval_after) < MATE_CP) { ply.cp = am.eval_after; ply.won = am.eval_after > 0 ? 'w' : 'b'; }
      else if (am && typeof am.eval_after === 'number') { if (isMateCp(am.eval_after)) ply.mate = Math.sign(am.eval_after) * Math.max(1, mateIn(am.eval_after)); else ply.cp = am.eval_after; }
      else if (pp.cp != null) ply.cp = pp.cp;
      else if (pp.mate != null) ply.mate = pp.mate;
      if (ply.checkmate) { ply.mate = ply.side === 'w' ? 0.5 : -0.5; delete ply.cp; }
      const eng = am ? am.classification || '' : '';
      ply.mark = pp.mark || ENGINE_MARK[eng] || null;
      ply.cls = ply.mark ? MARK_CLASS[ply.mark] : eng === 'best' ? 'best' : 'none';
      if (am && am.eval_loss) ply.loss = Math.round(am.eval_loss);
      if (am && am.best_move_uci && am.best_move_uci !== ply.uci) {
        ply.best = { uci: am.best_move_uci, line: am.best_line || [] };
        // the search's other lines (chess-animator's engine_lines, line 1 the best line), each from the position before the move, none starting with the move played
        const more = engineLinesSan(am).slice(1).filter((l) => bare(l[0]) !== bare(san) && bare(l[0]) !== bare(std));
        if (more.length) ply.best.more = more;
      }
      else if (!useA && pp.variation && pp.variation.length) {
        try { const bm = sanToMove(before, pp.variation[0]); ply.best = { uci: idxSq(bm.from) + idxSq(bm.to) + (bm.promo || ''), line: pp.variation }; } catch (e) {}
      }
      // the engine's line from the position after the move, as Lichess shows it: the next move's best line (one search a
      // position, so the same search), or after the last move its short pv_line
      if (am) { const an = A.moves[i + 1], next = an ? an.best_line : am.pv_line; if (next && next.length) ply.next = next; }
      // the search's several lines from the position after the move (the next move's engine_lines), as { k, cp, depth, pv: uci }, none when it has one
      if (am && A.moves[i + 1]) { const ls = linesFromSan(pos, engineLinesOf(A.moves[i + 1])); if (ls.length > 1) ply.nextLines = ls; }
      if (am && am.mate_advice) ply.advice = am.mate_advice;
      // the search of the position after the move, as it actually ran
      if (ply.tb) ply.search = { tablebase: true };
      else if (am && am.search_depth_after) ply.search = { depth: am.search_depth_after, maxDepth: am.search_maxdepth_after || am.search_depth_after, timeMs: am.search_time_after_ms == null ? null : am.search_time_after_ms, nodes: am.search_nodes_after == null ? null : am.search_nodes_after };
      if (pp.clk != null) ply.clk = pp.clk;
      const note = (NT && NT.plies[i + 1]) || '';
      if (pp.vars) ply.pgnVars = pp.vars;
      if (pp.nags) ply.nags = pp.nags;
      // an annotated PGN imported with its notes file: the note (and after the last move the conclusion) it wrote into
      // the PGN's comment is the notes file's, not the PGN's
      const own = unsaid(i === sans.length - 1 ? unsaid(pp.comment || '', NT && ends(NT).conclusion, true) : pp.comment || '', note);
      ply.pgnComment = own;
      ply.comment = note || own;
      ply.says = { pgn: own, notes: note };
      plies.push(ply);
    });
    // PGN-only evals: rate unmarked moves by win-chance drop (Lichess thresholds)
    if (!useA) {
      const known = (p) => p && (p.cp != null || (p.mate != null && !p.checkmate));
      const cpv = (p) => (p.mate != null ? Math.sign(p.mate) * MATE_CP : p.cp);
      plies.forEach((p, i) => {
        const prev = i ? plies[i - 1] : stdStart ? { cp: 20 } : null; // no known eval before a custom start's first move
        if (p.mark || !known(p) || !known(prev) || p.mate != null || prev.mate != null) return;
        const sgn = p.side === 'w' ? 1 : -1;
        const drop = sgn * (winChance(cpv(prev)) - winChance(cpv(p)));
        const mk = drop >= WIN_DROP.blunder ? '??' : drop >= WIN_DROP.mistake ? '?' : drop >= WIN_DROP.inaccuracy ? '?!' : null;
        if (mk) { p.mark = mk; p.cls = MARK_CLASS[mk]; }
        const loss = Math.round(sgn * (cpv(prev) - cpv(p)));
        if (loss > 0) p.loss = loss;
      });
    }
    // carry evals forward so the plot has no gaps
    const aStart = useA && A.moves[0] && typeof A.moves[0].eval_before === 'number';
    const first = plies.find((p) => p.cp != null || (p.mate != null && !p.checkmate));
    // the +0.20 first-move edge is the standard start's; a custom start has only its first known eval
    let lastCp = aStart ? A.moves[0].eval_before : stdStart ? 20 : first ? (first.mate != null ? Math.sign(first.mate) * MATE_CP : first.cp) : 20;
    const evalStart = lastCp, evalStartKnown = aStart || stdStart;
    plies.forEach((p) => { if (p.cp == null && p.mate == null) p.cpFill = lastCp; else lastCp = p.mate != null ? Math.sign(p.mate) * MATE_CP : p.cp; });
    // the checkmate on the last move is a fact of the game, not an engine eval
    const hasEval = plies.some((p) => p.cp != null || (p.mate != null && !p.checkmate));
    const hasClock = plies.some((p) => p.clk != null);
    // the first period's seconds: 300+2, 40/7200:3600 (40 moves in 7200 s), not a sandclock (*60)
    const tc = (H.TimeControl || '').match(/^(?:\d+\/)?(\d+)/);
    const clockStart = tc ? +tc[1] : hasClock ? Math.ceil(Math.max(plies[0].clk || 0, (plies[1] && plies[1].clk) || 0) / 60) * 60 : 0;
    const eng = useA && A.engine;
    // search as Python's describe_search; one line and one thread (the browser engine) go unsaid
    const search = eng && (eng.depth && eng.time_limit ? `depth ${eng.depth}, max ${eng.time_limit}s per position` : eng.time_limit ? `${eng.time_limit}s per position` : eng.depth ? `depth ${eng.depth}` : '');
    const single = eng && eng.lines === 1 && eng.threads === 1;
    const engine = eng ? [eng.name, search, !single && eng.lines ? `${eng.lines} line${eng.lines > 1 ? 's' : ''}` : '', !single && eng.threads ? `${eng.threads} thread${eng.threads > 1 ? 's' : ''}` : '', eng.tablebase ? 'Lichess tablebase' : ''].filter(Boolean).join(' · ') : pgnHasEval ? 'Evaluations from the PGN' : '';
    const player = (side) => {
      const S = side === 'w' ? 'White' : 'Black', s = side === 'w' ? 'white' : 'black';
      const name = clean(H[S]) || (A && A[s]) || S;
      return { name, named: name !== S, short: surname(name), title: clean(H[S + 'Title']), elo: clean(H[S + 'Elo']) || (A && clean(A[s + '_elo'])) || '', team: clean(H[S + 'Team']), acc: useA && A[s + '_stats'] && A[s + '_stats'].accuracy };
    };
    const result = clean(H.Result) || (A && A.result) || '*';
    // the PGN's opening, else the analysis file's, else Lichess's opening book (as AnalysisData.name_opening)
    const known = (n) => clean(n) && n !== 'Unknown';
    let opening = known(H.Opening) ? { eco: clean(H.ECO), name: H.Opening } : A && known(A.opening_name) ? { eco: A.opening_eco || '', name: A.opening_name } : null;
    if (!opening && window.Openings) { try { opening = window.Openings.book().identify(plies.map((p) => p.uci), start.fen); } catch (e) {} }
    if (!opening) opening = { eco: clean(H.ECO), name: '' };
    const round = clean(H.Round) || (A && clean(A.round_num)) || '';
    const pgnIntro = unsaid((P && P.intro) || '', NT && NT.intro);
    return {
      white: player('w'), black: player('b'),
      event: clean(H.Event) || (A && A.event) || '', round, site: clean(H.Site) || (A && A.site) || '', date: fmtDate(clean(H.Date) || (A && A.date)), pgnDate: clean(H.Date) || (A && clean(A.date)) || '',
      eco: opening.eco, opening: opening.name,
      result, intro: (NT && NT.intro) || pgnIntro, conclusion: ends(NT).conclusion,
      says: { pgn: { intro: pgnIntro, conclusion: '' }, notes: ends(NT) },
      engine, engineName: eng ? eng.name || '' : '', start: { fen: start.fen, pos: start.pos }, ply0, plies, evalStart, evalStartKnown, hasEval, hasClock, clockStart, gameCount, hasAnalysis: !!A, hasNotes: !!notes, headers: H, evalSource: useA ? 'analysis' : pgnHasEval ? 'pgn' : 'none', canChooseSource: !!A && pgnHasEval,
    };
  }

  const plyCp = (p) => (p.mate != null ? Math.sign(p.mate) * MATE_CP : p.cp != null ? p.cp : p.cpFill);

  // Split plies across the timeline sections: opening / middlegame / critical window around the biggest swing / endgame
  function plan(M) {
    const N = M.plies.length;
    let crit = -1;
    if (M.hasEval) {
      let best = 0;
      M.plies.forEach((p, i) => { const d = Math.abs(winChance(plyCp(p)) - winChance(i ? plyCp(M.plies[i - 1]) : M.evalStart)); if (d > best) { best = d; crit = i; } });
    }
    if (crit < 0) { crit = M.plies.findIndex((p) => p.cls === 'blunder' || p.cls === 'brilliant'); if (crit < 0) crit = Math.floor(N * 0.65); }
    let cs = Math.max(0, crit - 3), ce = Math.min(N - 1, crit + 5);
    const oe = Math.round(cs * 0.45) - 1;
    return [['Opening', 0, oe], ['Middlegame', oe + 1, cs - 1], ['Critical', cs, ce], ['Endgame', ce + 1, N - 1]];
  }

  // Per-ply hold times and the resulting scene list. The only padding is LEAD before the first move (the title card
  // fading out) and TAIL after the last; sections follow one another with no gap, so no move holds longer for ending one.
  const KEY_CLS = ['blunder', 'mistake', 'inaccuracy', 'brilliant', 'good', 'interesting'];
  const MAX_TOTAL = 300, TITLE = 5, OUTRO = 7, READ_CAP = 6, LEAD = 1.2, TAIL = 2.6;
  function timing(M, o) {
    const spm = o.secondsPerMove || 1.6, hold = o.keyHold == null ? 1.5 : o.keyHold, read = o.readSpeed || 22; // characters a second
    const ranges = plan(M);
    let d = M.plies.map((p) => {
      // reading time for the comment and Queen's sentence together, at most READ_CAP s; on a marked move it stands in
      // for the extra hold, which only a marked move with nothing to read gets
      const chars = (p.comment || '').length + (p.queenText || '').length;
      if (chars) return Math.max(spm, Math.min(READ_CAP, chars / read));
      return KEY_CLS.includes(p.cls) || p.checkmate ? spm + hold * (p.cls === 'blunder' || p.checkmate ? 1.3 : 1) : spm;
    });
    if (o.fastOpening) { const [, a, b] = ranges[0]; for (let i = a; i <= b; i++) if (!M.plies[i].comment && !M.plies[i].mark) d[i] *= 0.55; }
    const live = ranges.filter((r) => r[2] >= r[1]);
    const lt = (name) => { const gi = live.findIndex((r) => r[0] === name); return gi < 0 ? 0 : (gi === 0 ? LEAD : 0) + (gi === live.length - 1 ? TAIL : 0); };
    const fixed = TITLE + OUTRO + ranges.reduce((s, r) => s + (r[2] >= r[1] ? lt(r[0]) : 0.1), 0);
    const sum = d.reduce((s, x) => s + x, 0);
    const capped = fixed + sum > MAX_TOTAL;
    if (capped) { const k = (MAX_TOTAL - fixed - 0.5) / sum; d = d.map((x) => x * k); }
    const mv = (i) => Math.floor(((M.ply0 || 0) + i) / 2) + 1;
    const DESC = { Opening: 'The opening moves', Middlegame: 'Middlegame moves leading up to the critical moment', Critical: 'The biggest eval swing and the moves around it, with camera push', Endgame: 'The rest of the game to the final move' };
    const scenes = [{ name: 'Title', dur: TITLE, desc: 'Title card from the PGN headers: players, event, opening' }];
    ranges.forEach(([name, a, b]) => {
      let dur = 0.1;
      if (b >= a) { dur = lt(name); for (let i = a; i <= b; i++) dur += d[i]; }
      scenes.push({ name, dur: Math.round(dur * 10) / 10, desc: b >= a ? `${DESC[name]} (moves ${mv(a)}–${mv(b)})` : 'Empty for this game' });
    });
    scenes.push({ name: 'Outro', dur: OUTRO, desc: 'End card: result, accuracy, engine settings, fade out' });
    return { d, scenes, capped, total: scenes.reduce((s, x) => s + x.dur, 0) };
  }

  // When each ply plays on the timeline (tp) and how long its move animates (md). CUES is each scene's start time.
  const AFTER = { Opening: 'Middlegame', Middlegame: 'Critical', Critical: 'Endgame', Endgame: 'Outro' };
  function schedule(M, CUES, d) {
    const N = M.plies.length, tp = new Array(N), groups = [];
    let pendingStart = null;
    plan(M).forEach(([name, a, b]) => {
      if (b >= a) { groups.push({ a, b, start: pendingStart != null ? pendingStart : CUES[name], end: CUES[AFTER[name]] }); pendingStart = null; }
      else if (groups.length) groups[groups.length - 1].end = CUES[AFTER[name]];
      else if (pendingStart == null) pendingStart = CUES[name];
    });
    groups.forEach((g, gi) => {
      const lead = gi === 0 ? LEAD : 0, tail = gi === groups.length - 1 ? TAIL : 0;
      let tot = 0; for (let i = g.a; i <= g.b; i++) tot += d[i];
      const span = g.end - g.start - lead - tail; let acc = 0;
      for (let i = g.a; i <= g.b; i++) { tp[i] = g.start + lead + (acc / tot) * span; acc += d[i]; }
    });
    const md = tp.map((t, i) => Math.min(0.5, 0.6 * ((i + 1 < N ? tp[i + 1] : t + 1) - t)));
    const blunders = M.plies.map((p, i) => i).filter((i) => M.plies[i].cls === 'blunder');
    return { tp, md, N, blunders };
  }
  // the scene start times the stage derives from timing()'s scenes (deriveCues in engine.jsx)
  function cues(scenes) {
    let start = 0; const table = {};
    scenes.forEach((s) => { if (!(s.name in table)) table[s.name] = Math.round(start * 1000) / 1000; start += s.dur; });
    return table;
  }
  // The time at which ply i has settled on the board (its highlight and badge in place, before the next move starts): what
  // a jump to a move shows. i = -1 is the starting position, just before the first move; the last move holds no later than
  // just before the end card. S: schedule(), CUES: cues()
  const settledAt = (S, CUES, i) => (i < 0 ? S.tp[0] - 0.3 : i + 1 < S.N ? S.tp[i + 1] - 0.12 : Math.min(S.tp[i] + S.md[i] + 3, CUES.Outro - 0.1));
  // Seconds of the video to export for plies from..to: from -1 starts on the title card, to N ends after the end card.
  // A move's clip starts just before it is played and ends once it has settled, as the player shows it on a jump.
  // Returns a function of (from, to), so that the schedule is worked out once.
  function clipRange(M, TM) {
    const CUES = cues(TM.scenes), S = schedule(M, CUES, TM.d), N = S.N;
    return (from, to) => {
      const start = from < 0 ? 0 : Math.max(0, S.tp[from] - 0.3);
      const end = to >= N ? TM.total : settledAt(S, CUES, to);
      return { start, end: Math.max(start, end) };
    };
  }

  // ---------- annotated PGN ----------
  const NB = '\u00a0';
  const NAG_OF = Object.fromEntries(Object.entries(NAG).map(([n, m]) => [m, +n]));
  const pgnEsc = (t) => String(t).replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\s+/g, ' ').trim();
  // a variation as written, on one line: ; comments become { } ones, whitespace collapses (also inside comments)
  function flatVar(raw) {
    let out = '', i = 0;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '{') { const j = raw.indexOf('}', i); const e = j < 0 ? raw.length : j; out += '{' + pgnEsc(raw.slice(i + 1, e)) + '}'; i = e + 1; continue; }
      if (ch === ';') { const j = raw.indexOf('\n', i); const e = j < 0 ? raw.length : j; out += ' {' + pgnEsc(raw.slice(i + 1, e)) + '} '; i = e + 1; continue; }
      out += /\s/.test(ch) ? ' ' : ch; i++;
    }
    return out.replace(/ +/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  }
  // a length as m:ss (the video's, a clip's, an export's), whole seconds floored: 119.6 s is 1:59, never 1:60
  const fmtLen = (x) => { const s = Math.max(0, Math.floor(x)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  // clock as h:mm:ss, keeping tenths (Lichess writes them under 10 s)
  const pgnClk = (s) => {
    const t = Math.round(s * 10) / 10, sec = t % 60;
    return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${Number.isInteger(t) ? String(sec).padStart(2, '0') : sec.toFixed(1).padStart(4, '0')}`;
  };
  // PGN's move number before a move's SAN, the two kept on one line (NB becomes a space once wrapped): "12." before White's
  // move, "12..." before Black's where one is needed (the first move of a line, after a comment or a variation), else ''
  const pgnMoveNo = (abs, needed) => (abs % 2 === 0 ? Math.floor(abs / 2) + 1 + '.' + NB : needed ? Math.floor(abs / 2) + 1 + '...' + NB : '');
  // does Black's move after this token need its number again (it closes a comment or a variation)?
  const pgnReopens = (tok) => /[})]$/.test(tok || '');
  // PGN text from tags ([[name, value]]) and movetext tokens (moves, comments, the result): values escaped, the moves
  // wrapped at 80 columns, breaking on spaces, comments included; a line never starts with % (in column 1 it makes an
  // escape line)
  function pgnText(tags, toks) {
    const head = tags.map(([k, v]) => `[${k} "${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('\n');
    const lines = []; let cur = '';
    toks.join(' ').split(' ').forEach((w) => {
      if (cur && cur.length + 1 + w.length > 80 && w[0] !== '%') { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) lines.push(cur);
    return head + '\n\n' + lines.join('\n').replace(/\u00a0/g, ' ') + '\n';
  }
  // the game as PGN: marks after the moves and the source's other NAGs, evals and clocks as [%eval]/[%clk], the PGN's comments and a
  // notes file's (and Queen's sentence) as comments, the source's variations as written, and with an analysis's evals
  // its line on every move it didn't rate best in place of the source's first variation there; wrapped at 80 columns.
  // raw: the tags and the moves alone (no comments, NAGs, evals, clocks or variations)
  function annotatedPgn(M, { raw = false } = {}) {
    const H = { ...(M.headers || {}) };
    const set = (k, v) => { if (!H[k] && v) H[k] = v; };
    set('Event', M.event || '?'); set('Site', M.site || '?'); set('Date', String(M.pgnDate || '').replace(/-/g, '.') || '????.??.??'); set('Round', M.round || '?');
    set('White', M.white.named ? M.white.name : '?'); set('Black', M.black.named ? M.black.name : '?');
    set('WhiteElo', M.white.elo); set('BlackElo', M.black.elo); set('ECO', M.eco); set('Opening', M.opening);
    H.Result = M.result || '*';
    delete H.SetUp; delete H.FEN;
    if (M.start && M.start.fen !== START_FEN) { H.SetUp = '1'; H.FEN = M.start.fen; }
    const order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
    const keys = order.filter((k) => H[k] != null).concat(Object.keys(H).filter((k) => !order.includes(k)));
    const toks = [];
    // the PGN's own words and a notes file's, the PGN's first (the same words once): a note sits beside the PGN's
    // comment, never in its place
    const both = (pgn, notes, fallback) => (M.says ? [...new Set([pgn, notes].filter(Boolean))] : [fallback].filter(Boolean)).map(pgnEsc);
    const intro = both(M.says && M.says.pgn.intro, M.says && M.says.notes.intro, M.intro);
    if (intro.length && !raw) toks.push(`{${intro.join(' ')}}`);
    M.plies.forEach((p, i) => {
      const abs = (M.ply0 || 0) + i;
      // the mark after the move as it reads (Qb7?!), as Lichess and chess books write it; the other NAGs as $n
      toks.push(pgnMoveNo(abs, !i || pgnReopens(toks[toks.length - 1])) + p.san + (raw || !NAG_OF[p.mark] ? '' : p.mark));
      if (raw) return;
      (p.nags || []).forEach((g) => toks.push('$' + g));
      const tags = [];
      if (!p.checkmate && p.mate != null) tags.push(`[%eval #${p.mate}]`);
      else if (!p.checkmate && p.cp != null) tags.push(`[%eval ${(p.cp / 100).toFixed(2)}]`);
      if (p.clk != null) tags.push(`[%clk ${pgnClk(p.clk)}]`);
      const said = p.says ? both(p.says.pgn, p.says.notes) : both(null, null, p.comment);
      const words = tags.concat(said, p.queenText ? [pgnEsc('Queen: ' + p.queenText)] : []);
      if (words.length) toks.push(`{${words.join(' ')}}`);
      // the PGN's own variations as written, and with the analysis's evals (Game › Evaluations from) the engine's line on
      // every move it didn't rate best (the Analysis panel's Best line after the move before), first, in place of the
      // PGN's first variation there (the PGN's better line), so a move never carries two
      let vars = p.pgnVars || [];
      if (M.evalSource === 'analysis' && p.best && p.best.line && p.best.line.length && p.cls !== 'best') {
        const before = i ? M.plies[i - 1] : null;
        const line = playLine(before ? before.fen : M.start.fen, p.best.line, before ? before.castle : M.start.pos.castle, before ? before.ep : M.start.pos.ep);
        const v = line.map((m, j) => pgnMoveNo(abs + j, j === 0) + m.san);
        if (v.length) {
          toks.push('(' + v.join(' ') + ')'); vars = vars.slice(1);
          // the search's other lines follow, by rank
          (p.best.more || []).forEach((sans) => {
            const o = playLine(before ? before.fen : M.start.fen, sans, before ? before.castle : M.start.pos.castle, before ? before.ep : M.start.pos.ep);
            if (o.length) toks.push('(' + o.map((m, j) => pgnMoveNo(abs + j, j === 0) + m.san).join(' ') + ')');
          });
        }
      }
      vars.forEach((v) => toks.push(flatVar(v)));
    });
    if (M.conclusion && !raw) toks.push(`{${pgnEsc(M.conclusion)}}`);
    toks.push(H.Result);
    return pgnText(keys.map((k) => [k, H[k]]), toks);
  }

  // M with deeper searches of its positions in place of the analysis's (Go deeper): at(i) is the search of the position
  // after ply i ({ cp, pv: UCI moves }, or null). Its eval goes on ply i; its line on ply i + 1 as the engine's better
  // line there (what the annotated PGN writes), up to 12 plies, none where it starts with the move played (the search
  // agrees with the game). The marks and everything rated from the evals stay the analysis's
  function withSearches(M, at) {
    let any = false;
    const plies = M.plies.slice();
    M.plies.forEach((p, i) => {
      const d = at(i);
      if (!d) return;
      any = true;
      plies[i] = { ...plies[i], cp: d.cp, mate: isMateCp(d.cp) ? Math.sign(d.cp) * mateIn(d.cp) : null };
      // several lines (Go deeper with Lines above one) replace the analysis's lines of this position
      if (d.lines && d.lines.length > 1) plies[i].nextLines = d.lines; else delete plies[i].nextLines;
      const next = M.plies[i + 1];
      if (!next || !d.pv || !d.pv.length) return;
      if (d.pv[0] === next.uci) { plies[i + 1] = { ...plies[i + 1], best: null }; return; }
      let pos = { ...posFromFen(p.fen), castle: p.castle, ep: p.ep };
      const line = [];
      for (const u of d.pv.slice(0, 12)) { const s = stepFromUci(pos, u); if (!s) break; line.push(s.san); pos = s.pos; }
      if (!line.length) return;
      const best = { uci: d.pv[0], line };
      const sansOfPv = (pv) => { let q = { ...posFromFen(p.fen), castle: p.castle, ep: p.ep }; const out = []; for (const u of pv.slice(0, 12)) { const s = stepFromUci(q, u); if (!s) break; out.push(s.san); q = s.pos; } return out; };
      const more = (d.lines || []).slice(1).filter((l) => l.pv && l.pv[0] && l.pv[0] !== next.uci).map((l) => sansOfPv(l.pv)).filter((l) => l.length);
      if (more.length) best.more = more;
      plies[i + 1] = { ...plies[i + 1], best };
    });
    return any ? { ...M, plies } : M;
  }

  // a game's notes (a notes file's, and the sample's own) as a notes file that parseNotes reads back: [INTRO], [n] for
  // the note after ply n, [CONCLUSION], each with its text on its line (a note is one line), so a note that starts like a
  // key ([RESULT], [12]) is never read as one; '' when the game has none
  function notesText(M) {
    const N = (M.says && M.says.notes) || {}, out = [];
    if (N.intro) out.push(`[INTRO] ${N.intro}`);
    M.plies.forEach((p, i) => { if (p.says && p.says.notes) out.push(`[${i + 1}] ${p.says.notes}`); });
    if (N.conclusion) out.push(`[CONCLUSION] ${N.conclusion}`);
    return out.length ? out.join('\n\n') + '\n' : '';
  }

  // castle: the castling rights before the line (the page's FENs don't carry them); omitted = all
  function playLine(fen, sans, castle, ep) {
    let pos = { b: fromFen(fen), ep: ep == null ? -1 : ep, turn: fen.split(' ')[1] || 'w', castle: castle == null ? 'KQkq' : castle };
    const out = [];
    for (const raw of sans) {
      const san = String(raw).replace(/^\d+\.+/, '');
      if (!san) continue;
      let mv;
      try { mv = sanToMove(pos, san); } catch (e) { break; }
      pos = applyMove(pos, mv.from, mv.to, mv.promo);
      const check = inCheck(pos.b, pos.turn);
      out.push({ san, uci: idxSq(mv.from) + idxSq(mv.to) + (mv.promo || ''), board: pos.b.slice(), checkSq: check ? idxSq(kingIdx(pos.b, pos.turn)) : null, pos });
    }
    return out;
  }

  // ---------- moves the viewer plays on the board ----------
  // castling rights from the FEN's third field; a FEN without one (the page's own) allows every castle. The en passant
  // field is kept only where a pawn just moved two squares past it (epFits)
  const posFromFen = (fen) => {
    const f = fen.split(' '), b = fromFen(fen), turn = f[1] || 'w', ep = /^[a-h][1-8]$/.test(f[3] || '') ? sqIdx(f[3]) : -1;
    return { b, ep: ep >= 0 && epFits(b, turn, ep) ? ep : -1, turn, castle: f[2] == null ? 'KQkq' : f[2].replace('-', '') };
  };
  // A legal move from `from` to `to` (square indices, 0 = a8), or null. A pawn reaching the last rank becomes `promo`
  // (q, r, b or n; a queen by default).
  function legalMove(pos, from, to, promo = 'q') {
    const p = pos.b[from];
    if (!p || colorOf(p) !== pos.turn || from === to) return null;
    const t = tOf(p), color = pos.turn, opp = color === 'w' ? 'b' : 'w';
    if (t === 'k' && fy(from) === fy(to) && Math.abs(fx(to) - fx(from)) === 2) {
      const y = color === 'w' ? 7 : 0, king = fx(to) === 6;
      if (fy(from) !== y || fx(from) !== 4 || pos.b[at(king ? 7 : 0, y)] !== (color === 'w' ? 'R' : 'r')) return null;
      const right = color === 'w' ? (king ? 'K' : 'Q') : (king ? 'k' : 'q');
      if (pos.castle != null && !pos.castle.includes(right)) return null;
      if ((king ? [5, 6] : [1, 2, 3]).some((x) => pos.b[at(x, y)])) return null;
      if ([4, king ? 5 : 3, king ? 6 : 2].some((x) => attacked(pos.b, at(x, y), opp))) return null;
    } else if (!canReach(pos.b, from, to, t, color, pos.ep)) return null;
    const pr = t === 'p' && (fy(to) === 0 || fy(to) === 7) ? promo : null;
    if (pr && !'qrbn'.includes(pr)) return null;
    const after = applyMove(pos, from, to, pr);
    return inCheck(after.b, color) ? null : { from, to, promo: pr, after };
  }
  const legalTargets = (pos, from) => { const out = []; for (let to = 0; to < 64; to++) if (legalMove(pos, from, to)) out.push(to); return out; };
  function sanOf(pos, mv) {
    const p = pos.b[mv.from], t = tOf(p), cap = !!pos.b[mv.to] || (t === 'p' && mv.to === pos.ep);
    let san;
    if (t === 'k' && Math.abs(fx(mv.to) - fx(mv.from)) === 2) san = fx(mv.to) === 6 ? 'O-O' : 'O-O-O';
    else if (t === 'p') san = (cap ? FILES[fx(mv.from)] + 'x' : '') + idxSq(mv.to) + (mv.promo ? '=' + mv.promo.toUpperCase() : '');
    else {
      const others = [];
      for (let i = 0; i < 64; i++) if (i !== mv.from && pos.b[i] === p && legalMove(pos, i, mv.to)) others.push(i);
      const dis = !others.length ? '' : !others.some((i) => fx(i) === fx(mv.from)) ? FILES[fx(mv.from)] : !others.some((i) => fy(i) === fy(mv.from)) ? String(8 - fy(mv.from)) : idxSq(mv.from);
      san = t.toUpperCase() + dis + (cap ? 'x' : '') + idxSq(mv.to);
    }
    if (inCheck(mv.after.b, mv.after.turn)) san += hasLegal(mv.after) ? '+' : '#';
    return san;
  }
  // whether the move from `from` to `to` is legal and promotes, so the viewer picks the piece
  const isPromotion = (pos, from, to) => { const mv = legalMove(pos, from, to); return !!(mv && mv.promo); };
  // The viewer's move as a line step (same shape as playLine's), or null when it isn't legal; promo as legalMove's
  function userMove(pos, from, to, promo) {
    const mv = legalMove(pos, from, to, promo);
    if (!mv) return null;
    const check = inCheck(mv.after.b, mv.after.turn);
    return { san: sanOf(pos, mv), uci: idxSq(from) + idxSq(to) + (mv.promo || ''), board: mv.after.b.slice(), checkSq: check ? idxSq(kingIdx(mv.after.b, mv.after.turn)) : null, pos: mv.after };
  }

  // A SAN move → { pos after it, uci }; throws when it isn't legal
  function applySan(pos, san) {
    const mv = sanToMove(pos, san);
    return { pos: applyMove(pos, mv.from, mv.to, mv.promo), uci: idxSq(mv.from) + idxSq(mv.to) + (mv.promo || '') };
  }
  // A UCI move (e2e4, e7e8n) → { pos after it, san }, or null when it isn't legal
  function applyUci(pos, uci) {
    const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci || '');
    if (!m) return null;
    const from = sqIdx(m[1]), to = sqIdx(m[2]), mv = legalMove(pos, from, to);
    if (!mv) return null;
    const promo = mv.promo ? m[3] || 'q' : null;
    const full = promo === mv.promo ? mv : { from, to, promo, after: applyMove(pos, from, to, promo) };
    return { pos: full.after, san: sanOf(pos, full) };
  }

  // A UCI move as a line step (same shape as userMove's), or null when it isn't legal
  function stepFromUci(pos, uci) {
    const r = applyUci(pos, uci);
    if (!r) return null;
    const check = inCheck(r.pos.b, r.pos.turn);
    return { san: r.san, uci, board: r.pos.b.slice(), checkSq: check ? idxSq(kingIdx(r.pos.b, r.pos.turn)) : null, pos: r.pos };
  }

  // move-number gridlines for the eval plot: multiples of `step` among the absolute move numbers, at their offset in plies from the first move
  function evalTicks(ply0, N) {
    const step = N > 120 ? 20 : 10, ticks = [];
    for (let m = step; 2 * m - ply0 <= N; m += step) if (2 * (m - 1) - ply0 >= 0) ticks.push({ m, at: 2 * (m - 1) - ply0 });
    return ticks;
  }
  // A header line cut into text and web links: [{ text, url }], url only on an http(s) address (Lichess and Chess.com put
  // the game's page in Site). Trailing punctuation (.,;:!?) and an unmatched closing bracket stay text
  const links = (text) => {
    const out = [], re = /https?:\/\/[^\s<>"']+/gi;
    let at = 0, m;
    while ((m = re.exec(text))) {
      let u = m[0];
      for (;;) {
        const t = u.slice(-1);
        if (/[.,;:!?]/.test(t)) u = u.slice(0, -1);
        else if (t === ')' && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1);
        else break;
      }
      if (u.length <= u.indexOf('//') + 2) continue;
      if (m.index > at) out.push({ text: text.slice(at, m.index) });
      out.push({ text: u, url: u });
      at = m.index + u.length; re.lastIndex = at;
    }
    if (at < text.length) out.push({ text: text.slice(at) });
    return out;
  };
  window.ChessCore = { START_FEN, links, splitGames, fmtDate, fmtLen, hasLegal, inCheck, checkers, evalTicks, sqName: idxSq, CASTLE_HOME, canCastle, readFen, epFits, setupProblems, setupFen, epCapturable, fullFen, parseFen, fenAfter, moveNo, sqIndex: sqIdx, applySan, applyUci, stepFromUci, toFen, playLine, posFromFen, legalTargets, isPromotion, userMove, buildGame, withCommentary, commentarySources, classifyFile, plan, timing, schedule, cues, settledAt, clipRange, MATE_CP, MATE_STEP, MATE_MIN, mateCp, isMateCp, mateIn, WIN_K, WIN_DROP, winChance, plyCp, MARK_CLASS, pgnClk, pgnMoveNo, pgnReopens, pgnText, annotatedPgn, withSearches, notesText };
})();
