// A game on the free board (Play vs human or vs Stockfish): its clocks, takebacks, resignation, agreed draws, end and the
// critique of the player's moves. A game is a BoardCore board with a game record, board.game = { mode, id, tc, date, clock,
// result } for mode 'human', { mode: 'stockfish', you, id, tc, date, clock, result, critique } against Stockfish: id names it
// in My games (GamesCore), tc a time control ('10+0') or null, clock { left: { w, b } ms at `since`, since: when the side to
// move's clock started (null: stopped), clk: the mover's time left after each move }, result null while the game goes on,
// else { result, reason, side } (side: who resigned or whose flag fell; none for a draw by agreement); you the player's side
// ('w' or 'b'), critique the player's flagged moves [{ j, cls, best }] (j the step, cls inaccuracy, mistake or blunder,
// best Stockfish's move instead, in UCI). Like boards, games are never mutated; `now` is a time in ms.
(function () {
  const CC = () => window.ChessCore;
  const sqColor = (i) => ((i % 8) + Math.floor(i / 8)) % 2; // a8 (0) is light: 0 light, 1 dark
  const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');

  // Whether `color` has the material to mate at all: not with a lone king, nor a king and one minor piece against a lone
  // king, nor when the only pieces besides the kings are bishops all on squares of one colour
  function canMate(pos, color) {
    const own = [], all = [];
    pos.b.forEach((p, i) => { if (p && p.toLowerCase() !== 'k') { all.push({ t: p.toLowerCase(), i }); if (colorOf(p) === color) own.push(p.toLowerCase()); } });
    if (!own.length) return false;
    if (all.every((x) => x.t === 'b') && new Set(all.map((x) => sqColor(x.i))).size === 1) return false;
    return !(own.length === 1 && (own[0] === 'n' || own[0] === 'b') && all.length === 1);
  }

  // Whether a pawn of the side to move can take en passant now
  function epCapture(pos) {
    if (pos.ep < 0) return false;
    const pawn = pos.turn === 'w' ? 'P' : 'p';
    for (let i = 0; i < 64; i++) if (pos.b[i] === pawn && CC().legalTargets(pos, i).includes(pos.ep)) return true;
    return false;
  }

  // Whether the position is dead behind locked pawns: proven only for kings, pawns and bishops all on squares of one colour
  // (any other piece, or bishops on both colours, and it isn't), when no pawn can ever move or capture, no bishop can ever
  // reach an enemy pawn, and neither king can ever reach an enemy pawn to take it. Then the pawns never change and a king
  // can't step where a pawn would check it. A king's reach is a flood fill over the squares neither its own pawns hold nor
  // enemy pawns guard, a bishop's over diagonal steps the pawns don't block (other pieces could always step aside, so they
  // block nothing). A king no enemy bishop can reach is never checked; where one can, it's still no mate while the kings'
  // reaches never touch (one king can't cover the other's squares) and each such square has a neighbour of the other
  // colour in the king's reach, which no bishop, pawn or king can take from it. Positions this can't prove play on
  function lockedDead(pos) {
    const b = pos.b, pawns = [], bishops = { w: [], b: [] };
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) continue;
      const t = p.toLowerCase();
      if (t === 'p') pawns.push(i);
      else if (t === 'b') bishops[colorOf(p)].push(i);
      else if (t !== 'k') return false;
    }
    // the move just played may have been a double step past an enemy pawn, which can take it en passant
    if (!pawns.length || epCapture(pos)) return false;
    const shades = new Set(bishops.w.concat(bishops.b).map(sqColor));
    if (shades.size > 1) return false;
    const shade = shades.size ? [...shades][0] : null;
    // squares a pawn of each colour attacks: a8 is 0, so White's pawns take towards lower indexes
    const guard = { w: new Set(), b: new Set() };
    for (const i of pawns) {
      const c = colorOf(b[i]), f = i % 8, row = c === 'w' ? i - 8 : i + 8;
      // every pawn blocked by a pawn straight ahead (no pushes from here on, so no double step and no further en passant)
      if (row < 0 || row > 63 || !b[row] || b[row].toLowerCase() !== 'p') return false;
      for (const df of [-1, 1]) {
        if (f + df < 0 || f + df > 7) continue;
        const t = row + df, x = b[t];
        // a capture now: the pawn structure could change
        if (x && x.toLowerCase() === 'p' && colorOf(x) !== c) return false;
        guard[c].add(t);
      }
    }
    const near = (i) => {
      const out = [];
      for (let dr = -1; dr <= 1; dr++) for (let df = -1; df <= 1; df++) {
        const r = Math.floor(i / 8) + dr, f = (i % 8) + df;
        if ((dr || df) && r >= 0 && r <= 7 && f >= 0 && f <= 7) out.push(r * 8 + f);
      }
      return out;
    };
    const reach = {};
    for (const c of ['w', 'b']) {
      const king = b.indexOf(c === 'w' ? 'K' : 'k'), foe = other(c);
      if (king < 0) return false;
      const seen = new Set([king]), todo = [king];
      while (todo.length) {
        for (const j of near(todo.pop())) {
          if (seen.has(j) || guard[foe].has(j)) continue;
          const x = b[j];
          if (x && x.toLowerCase() === 'p') { if (colorOf(x) === c) continue; return false; } // an enemy pawn it could take
          seen.add(j); todo.push(j);
        }
      }
      reach[c] = seen;
    }
    if (shade == null) return true;
    // each side's bishops' squares; a diagonal step onto an enemy pawn is a capture that could change the pawns
    const sweep = {};
    for (const c of ['w', 'b']) {
      const seen = new Set(bishops[c]), todo = [...bishops[c]];
      while (todo.length) {
        const i = todo.pop();
        for (const j of near(i)) {
          if (j % 8 === i % 8 || Math.floor(j / 8) === Math.floor(i / 8) || seen.has(j)) continue;
          const x = b[j];
          if (x && x.toLowerCase() === 'p') { if (colorOf(x) === c) continue; return false; }
          seen.add(j); todo.push(j);
        }
      }
      sweep[c] = seen;
    }
    const checks = { w: [...reach.w].filter((i) => sweep.b.has(i)), b: [...reach.b].filter((i) => sweep.w.has(i)) };
    if (!checks.w.length && !checks.b.length) return true;
    for (const i of reach.w) if (reach.b.has(i) || near(i).some((j) => reach.b.has(j))) return false;
    for (const c of ['w', 'b']) for (const i of checks[c]) if (!near(i).some((j) => sqColor(j) !== shade && reach[c].has(j))) return false;
    return true;
  }

  // A position for repetition: the pieces, the side to move, the castling rights, and the en-passant square only when a
  // pawn of the side to move can take there
  function positionKey(pos) {
    return CC().toFen(pos) + ' ' + (pos.castle || '-') + ' ' + (epCapture(pos) ? String(pos.ep) : '-');
  }

  const lastPos = (board) => (board.steps.length ? board.steps[board.steps.length - 1].pos : board.start.pos);
  // In the position after the board's last move: half, the half-moves since a capture or pawn move (from the FEN's), and
  // seen, how often the position has stood on the board, counted from the start
  function drawCounts(board) {
    const steps = board.steps, pos = lastPos(board);
    let half = +board.fen.split(' ')[4] || 0;
    for (const s of steps) half = /^[a-h]/.test(s.san) || s.san.includes('x') ? 0 : half + 1;
    const key = positionKey(pos);
    let seen = positionKey(board.start.pos) === key ? 1 : 0;
    for (const s of steps) if (positionKey(s.pos) === key) seen++;
    return { half, seen };
  }

  // The end of the game in the position after the board's last move, or null while it goes on. With claim (vs human) a
  // threefold repetition and the fifty-move rule only let the side to move claim a draw (claimable); the game ends by
  // itself at a fivefold repetition or after 75 moves, as FIDE's rules have it. Without, the 3 and 50 end it
  function outcome(board, claim) {
    const pos = lastPos(board);
    if (!CC().hasLegal(pos)) {
      if (CC().inCheck(pos.b, pos.turn)) return { result: pos.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
      return { result: '1/2-1/2', reason: 'stalemate' };
    }
    const draw = (reason) => ({ result: '1/2-1/2', reason });
    if (!canMate(pos, 'w') && !canMate(pos, 'b')) return draw('material');
    if (lockedDead(pos)) return draw('dead');
    const { half, seen } = drawCounts(board);
    if (claim) return half >= 150 ? draw('seventyfive') : seen >= 5 ? draw('fivefold') : null;
    if (half >= 100) return draw('fifty');
    return seen >= 3 ? draw('repetition') : null;
  }

  const TIME_CONTROLS = ['5+3', '10+0', '15+10', '30+0'];
  // games stored before 5+0 became 5+3 keep their clock
  const RETIRED_TCS = ['5+0'];
  const parseTc = (tc) => { const m = /^(\d+)\+(\d+)$/.exec(tc || ''); return m ? { base: +m[1] * 60000, inc: +m[2] * 1000 } : null; };
  const B = () => window.BoardCore;
  const other = (side) => (side === 'w' ? 'b' : 'w');
  const inProgress = (b) => !!(b && b.game && !b.game.result);
  const withGame = (b, game) => ({ ...b, game: { ...b.game, ...game } });
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => B().today();

  const isSf = (b) => !!(b && b.game && b.game.mode === 'stockfish');
  const claims = (b) => !!(b && b.game && b.game.mode === 'human');
  // who played step j: the side to move before it, from the positions (a start may have Black to move)
  const moverOf = (b, j) => (j === 0 ? b.start.pos : b.steps[j - 1].pos).turn;
  const CLASSES = ['inaccuracy', 'mistake', 'blunder'];
  const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

  // A new game from the board's start: no moves yet, the clocks full and stopped (they start with the first move).
  // opts { mode: 'human' | 'stockfish', you: 'w' | 'b' } (vs human by default; you only against Stockfish)
  function start(board, tc, date, { mode = 'human', you = 'w' } = {}) {
    const t = parseTc(tc), b = { ...board, steps: [], upto: -1 };
    const clock = t ? { left: { w: t.base, b: t.base }, since: null, clk: [] } : null;
    const head = mode === 'stockfish' ? { mode, you: you === 'b' ? 'b' : 'w' } : { mode: 'human' };
    return { ...b, game: { ...head, id: newId(), tc: t ? tc : null, date: date || today(), clock, result: outcome(b, mode !== 'stockfish'), ...(head.you ? { critique: [] } : {}) } };
  }

  // the side to move's time left at `now`; null without clocks
  function timeLeft(b, side, now) {
    const c = b.game && b.game.clock;
    if (!c) return null;
    return c.left[side] - (c.since != null && side === B().pos(b).turn && !b.game.result ? now - c.since : 0);
  }
  // the clock with the side to move charged up to `now`, and stopped
  const charged = (b, now) => {
    const c = b.game.clock, side = B().pos(b).turn;
    return { ...c, left: { ...c.left, [side]: timeLeft(b, side, now) }, since: null };
  };

  // The side to move out of time: a loss, or a draw when the other side has no mating material. The board as it was otherwise
  function flag(b, now) {
    if (!inProgress(b) || !b.game.clock || b.game.clock.since == null) return b;
    const side = B().pos(b).turn;
    if (timeLeft(b, side, now) > 0) return b;
    const c = charged(b, now), opp = other(side);
    const result = canMate(B().pos(b), opp) ? (opp === 'w' ? '1-0' : '0-1') : '1/2-1/2';
    return withGame(b, { clock: { ...c, left: { ...c.left, [side]: 0 } }, result: { result, reason: 'time', side } });
  }

  // A move in the game, after its last move: the mover's clock is charged and gets the increment, the other side's starts
  function move(b, step, now) {
    if (!inProgress(b)) return b;
    const flagged = flag(b, now);
    if (flagged !== b) return flagged;
    const side = B().pos(b).turn, next = B().play(B().go(b, b.steps.length - 1), step);
    let clock = b.game.clock;
    if (clock) {
      const c = charged(b, now), left = c.left[side] + parseTc(b.game.tc).inc;
      clock = { left: { ...c.left, [side]: left }, since: now, clk: [...c.clk, left] };
    }
    const result = outcome(next, claims(b));
    if (result && clock) clock = { ...clock, since: null };
    return withGame(next, { clock, result });
  }

  // Whether a takeback can go: in a game in progress, with a move to take back (against Stockfish, one of the player's)
  function canTakeback(b) {
    if (!inProgress(b) || !b.steps.length) return false;
    return !isSf(b) || b.steps.some((s, j) => moverOf(b, j) === b.game.you);
  }

  // The last move taken back, while the game goes on: the time used stays used (a takeback never buys time), the move's
  // increment goes with it, and taking back every move stops the clocks again
  function takeOne(b, now) {
    const flagged = flag(b, now);
    if (flagged !== b) return flagged;
    const prev = { ...b, steps: b.steps.slice(0, -1), upto: b.steps.length - 2 };
    let clock = b.game.clock;
    if (clock) {
      const c = charged(b, now), mover = other(B().pos(b).turn);
      clock = { left: { ...c.left, [mover]: c.left[mover] - parseTc(b.game.tc).inc }, since: prev.steps.length ? now : null, clk: c.clk.slice(0, -1) };
    }
    return withGame(prev, { clock });
  }
  // Against Stockfish, moves go until one of the player's has (its reply and the player's move, or just the player's move
  // while it thinks), so it is the player's turn again; their critique goes with them. A flag fall on the way ends it there
  function takeback(b, now) {
    if (!canTakeback(b)) return b;
    if (!isSf(b)) return takeOne(b, now);
    let x = b;
    for (;;) {
      const mine = moverOf(x, x.steps.length - 1) === x.game.you, y = takeOne(x, now);
      if (y.game.result) return y;
      x = y;
      if (mine) break;
    }
    return withGame(x, { critique: x.game.critique.filter((c) => c.j < x.steps.length) });
  }

  // Stockfish's time for its move, which also rates the player's move before it: 3 s (at 2 s a borderline inaccuracy,
  // 7. Bc4 in a Four Knights, rated as fine), or with a clock a share of its time left (and half its increment) capped
  // there, so it never flags; at least 0.1 s
  const THINK_MS = 3000;
  function thinkMs(b, now) {
    const left = timeLeft(b, other(b.game.you), now);
    if (left == null) return THINK_MS;
    return Math.round(Math.max(100, Math.min(THINK_MS, left / 30 + parseTc(b.game.tc).inc / 2)));
  }

  // The board with a player's move flagged ({ j, cls, best, text }; text, critiqueText's line, is optional): only in a
  // Stockfish game, for a step still on the board that the player played, once per step; the board as it was otherwise.
  // A rating that lands after the end still counts
  const TEXT_MAX = 120, entry = (c) => ({ j: c.j, cls: c.cls, best: c.best, ...(typeof c.text === 'string' && c.text && c.text.length <= TEXT_MAX ? { text: c.text } : {}) });
  function addCritique(b, e) {
    if (!isSf(b) || !e || !Number.isInteger(e.j) || e.j < 0 || e.j >= b.steps.length || moverOf(b, e.j) !== b.game.you) return b;
    if (!CLASSES.includes(e.cls) || b.game.critique.some((c) => c.j === e.j)) return b;
    return withGame(b, { critique: [...b.game.critique, entry(e)] });
  }

  // A short line on why the player's move was bad, without the better move: pos the position after it, pv Stockfish's reply
  // line (UCI). When the line's first four plies win the player's material net, the most valuable piece taken is named;
  // else a mate against the player; else a line for the class
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const PIECE = { p: 'a pawn', n: 'the knight', b: 'the bishop', r: 'the rook', q: 'the queen' };
  function critiqueText(pos, pv, you, cls, mateAgainst) {
    let p = pos, lost = 0, won = 0, top = null;
    for (const u of (pv || []).slice(0, 4)) {
      const m = /^([a-h][1-8])([a-h][1-8])/.exec(u || ''), r = m && CC().applyUci(p, u);
      if (!r) break;
      const from = CC().sqIndex(m[1]), to = CC().sqIndex(m[2]), mover = p.b[from];
      // en passant: a pawn moving sideways onto an empty square
      const taken = p.b[to] || (mover.toLowerCase() === 'p' && from % 8 !== to % 8 ? (p.turn === 'w' ? 'p' : 'P') : null);
      if (taken) {
        const t = taken.toLowerCase(), v = VALUE[t] || 0;
        if (colorOf(taken) === you) { lost += v; if (!top || v > VALUE[top]) top = t; } else won += v;
      }
      p = r.pos;
    }
    if (lost > won && top) return 'that drops ' + PIECE[top];
    if (mateAgainst) return 'that allows mate';
    return { inaccuracy: 'there was a better move', mistake: 'that gives Stockfish the edge', blunder: 'that should lose' }[cls] || '';
  }

  // The side to move resigns, or `side` (against Stockfish the player can resign while it thinks)
  function resign(b, now, side = B().pos(b).turn) {
    if (!inProgress(b)) return b;
    return withGame(b, { clock: b.game.clock && charged(b, now), result: { result: side === 'w' ? '0-1' : '1-0', reason: 'resign', side } });
  }

  // A draw both players agree to
  function agreeDraw(b, now) {
    if (!inProgress(b)) return b;
    return withGame(b, { clock: b.game.clock && charged(b, now), result: { result: '1/2-1/2', reason: 'agreement' } });
  }

  // The draw the side to move can claim in a vs-human game in progress: 'repetition' (the position on the board three
  // times) or 'fifty' (fifty moves each without a capture or pawn move); null when there's none
  function claimable(b) {
    if (!inProgress(b) || !claims(b)) return null;
    const { half, seen } = drawCounts(b);
    return seen >= 3 ? 'repetition' : half >= 100 ? 'fifty' : null;
  }
  // The draw claimed; the board as it was when there's none to claim
  function claimDraw(b, now) {
    const reason = claimable(b);
    if (!reason) return b;
    return withGame(b, { clock: b.game.clock && charged(b, now), result: { result: '1/2-1/2', reason } });
  }

  // The result for people: the score and why
  const NAME = { w: 'White', b: 'Black' };
  function resultText(r) {
    const score = { '1-0': '1–0', '0-1': '0–1', '1/2-1/2': '½–½' }[r.result];
    const why = {
      checkmate: 'Checkmate', stalemate: 'Stalemate', repetition: 'Draw by threefold repetition', fifty: 'Draw by the fifty-move rule',
      fivefold: 'Draw by fivefold repetition', seventyfive: 'Draw by the 75-move rule',
      material: 'Draw: neither side can mate', dead: 'Draw: dead position, the pawns are locked', agreement: 'Draw by agreement', resign: `${NAME[r.side]} resigned`,
      time: r.result === '1/2-1/2' ? `${NAME[r.side]}’s flag fell, but ${NAME[other(r.side)]} can’t mate` : `${NAME[r.side]}’s flag fell`,
    }[r.reason];
    return { score, why };
  }

  // The game as it is left at `now` (for My games): the side to move charged up to then and its clock stopped, or its flag
  // fallen; the board as it was when no clock runs
  function pause(b, now) {
    if (!inProgress(b) || !b.game.clock || b.game.clock.since == null) return b;
    const flagged = flag(b, now);
    return flagged !== b ? flagged : withGame(b, { clock: charged(b, now) });
  }

  // The side to move's clock running from `now` (a game opened from My games), in a game in progress with moves whose
  // clocks are stopped; the board as it was otherwise
  function runClock(b, now) {
    const c = b && b.game && b.game.clock;
    if (!inProgress(b) || !c || c.since != null || !b.steps.length) return b;
    return withGame(b, { clock: { ...c, since: now } });
  }

  // A stored game back on its board (BoardCore.restore): whatever localStorage held, a game that plays on. Given `now` (a
  // reload) the side to move's clock runs on from its stored start, so the time away is charged (and its flag may have
  // fallen meanwhile), or from `now` when the stored start isn't one to trust; without, the clocks are stopped. clk
  // fits the moves, and the result comes from the moves unless it was a resignation, a flag fall, an agreed draw or a
  // claimed draw the moves still allow. A game stored without an id gets one
  function resume(board, g, now) {
    if (!g || typeof g !== 'object' || (g.mode !== 'human' && g.mode !== 'stockfish')) return board;
    const tc = TIME_CONTROLS.includes(g.tc) || RETIRED_TCS.includes(g.tc) ? g.tc : null, t = parseTc(tc), n = board.steps.length;
    let clock = null;
    if (t) {
      const c = g.clock || {}, ms = (x) => (Number.isFinite(x) ? Math.max(0, x) : t.base);
      const since = !Number.isFinite(now) || !n ? null : Number.isFinite(c.since) && c.since > 0 && c.since <= now ? c.since : now;
      clock = { left: { w: ms(c.left && c.left.w), b: ms(c.left && c.left.b) }, since, clk: (Array.isArray(c.clk) ? c.clk : []).filter(Number.isFinite).slice(0, n) };
    }
    const human = g.mode === 'human', claimed = human && { ...board, game: { mode: 'human' } };
    const r = g.result, kept = !r ? null : r.reason === 'agreement' && r.result === '1/2-1/2' ? { result: r.result, reason: r.reason }
      : human && r.result === '1/2-1/2' && r.reason === claimable(claimed) ? { result: r.result, reason: r.reason }
      : ['resign', 'time'].includes(r.reason) && ['1-0', '0-1', '1/2-1/2'].includes(r.result) && (r.side === 'w' || r.side === 'b') ? { result: r.result, reason: r.reason, side: r.side } : null;
    const result = kept || outcome(board, human);
    if (result && clock) clock = { ...clock, since: null };
    const b = result ? board : B().go(board, n - 1);
    const id = typeof g.id === 'string' && /^[\w-]{1,40}$/.test(g.id) ? g.id : newId();
    const date = typeof g.date === 'string' && /^\d{4}\.\d\d\.\d\d$/.test(g.date) ? g.date : today();
    if (g.mode === 'human') return { ...b, game: { mode: 'human', id, tc, date, clock, result } };
    // a flagged move must still be one of the player's on the board, once each
    const you = g.you === 'b' ? 'b' : 'w', seen = new Set();
    const critique = (Array.isArray(g.critique) ? g.critique : []).filter((c) => c && Number.isInteger(c.j) && c.j >= 0 && c.j < n && moverOf(board, c.j) === you
      && CLASSES.includes(c.cls) && typeof c.best === 'string' && UCI_RE.test(c.best) && !seen.has(c.j) && seen.add(c.j)).map(entry);
    return { ...b, game: { mode: 'stockfish', you, id, tc, date, clock, result, critique } };
  }

  // The game as a PGN (for saving, step 4 of the free-board design): the result, the start when it isn't the standard
  // one, the time control and each move's clock
  function pgn(b) {
    const g = b.game, t = parseTc(g.tc), res = g.result ? g.result.result : '*';
    const sf = g.mode === 'stockfish', name = (side) => (!sf ? NAME[side] : side === g.you ? 'You' : 'Stockfish 19');
    const tags = [['Event', sf ? 'Play vs Stockfish' : 'Play vs human'], ['Site', 'chess-replay'], ['Date', g.date], ['White', name('w')], ['Black', name('b')], ['Result', res]];
    const more = [];
    if (t) more.push(['TimeControl', `${t.base / 1000}+${t.inc / 1000}`]);
    if (g.result) more.push(['Termination', g.result.reason === 'time' ? 'time forfeit' : 'normal']);
    const clk = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    const has = (j) => !!t && g.clock.clk[j] != null;
    return B().pgnOf(b, tags, res, { more, again: (j) => has(j - 1), after: (j) => (has(j) ? ` { [%clk ${clk(g.clock.clk[j])}] }` : '') });
  }

  window.PlayCore = {
    canMate, lockedDead, positionKey, outcome, TIME_CONTROLS, parseTc, start, inProgress, move, canTakeback, takeback, thinkMs, addCritique, critiqueText,
    resign, agreeDraw, claimable, claimDraw, flag, pause, runClock, timeLeft, resultText, resume, pgn,
  };
})();
