// ---------- dead positions (chasolver, app/dead-core.js) ----------
// Whether each side can still mate by any legal sequence of moves, proven by chasolver in a Worker. In a game it ends
// the game (PlayCore's prover, FreeBoard's recheck); on the paused replay and the free board it shows as DEAD on the
// eval bar, a block in the Analysis panel and a pill in the Moves list. Never in the playing video or its export.
// The worker and its module load on first use.
let DEAD = null;
const deadClient = () => {
  if (DEAD) return DEAD;
  DEAD = window.DeadCore.create({ makeWorker: () => new Worker('dead-worker.js') });
  window.PlayCore.setProver((pos, c) => { const v = DEAD.cached(deadFen(pos), c); return v === 'unwinnable' ? true : v === 'winnable' ? false : null; });
  return DEAD;
};

const DEAD_SQ = (i) => 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8));
// a position's FEN for chasolver: castling rights only where the king and rook are still at home (it refuses a FEN whose
// rights don't fit the pieces, as an edited start's might not); the move counters don't matter to it
function deadFen(pos) {
  const b = pos.b, home = { K: [60, 63, 'K', 'R'], Q: [60, 56, 'K', 'R'], k: [4, 7, 'k', 'r'], q: [4, 0, 'k', 'r'] };
  const castle = [...(pos.castle == null ? 'KQkq' : pos.castle)].filter((r) => home[r] && b[home[r][0]] === home[r][2] && b[home[r][1]] === home[r][3]).join('');
  return [window.ChessCore.toFen(pos), castle || '-', pos.ep >= 0 ? DEAD_SQ(pos.ep) : '-', '0 1'].join(' ');
}
// the position after a loaded game's ply (its FEN carries neither castling nor en passant: the ply has them)
const plyPos = (p) => ({ ...window.ChessCore.posFromFen(p.fen), castle: p.castle, ep: p.ep });

// chasolver's answers for the position (null asks nothing): { w, b }, each 'unwinnable', 'winnable', 'undecided' or
// undefined while it's asked
function useDead(pos) {
  const fen = pos ? deadFen(pos) : null, k = fen ? window.DeadCore.key(fen) : null;
  const [st, setSt] = React.useState({ k: null, v: null });
  const c = fen ? deadClient() : null;
  const hit = c ? { w: c.cached(fen, 'w'), b: c.cached(fen, 'b') } : null;
  const done = !!(hit && hit.w && hit.b);
  React.useEffect(() => {
    if (!k || done) return;
    const ctl = new AbortController();
    c.both(fen, { signal: ctl.signal }).then((v) => { if (!ctl.signal.aborted) setSt({ k, v }); });
    return () => ctl.abort();
  }, [k, done]);
  if (!fen) return null;
  return done ? hit : st.k === k ? st.v : hit;
}

// The ply after which a loaded game's position is first dead (later ones are too), or null; asked once per game
const FIRST_DEAD = new WeakMap();
function useFirstDead(M) {
  const [, redraw] = React.useState(0);
  React.useEffect(() => {
    if (!M.plies.length || FIRST_DEAD.has(M.plies)) return;
    const ctl = new AbortController();
    window.DeadCore.firstDead(M.plies.map((p) => deadFen(plyPos(p))), deadClient(), { signal: ctl.signal })
      .then((i) => { if (!ctl.signal.aborted) { FIRST_DEAD.set(M.plies, i); redraw((x) => x + 1); } });
    return () => ctl.abort();
  }, [M.plies]);
  const i = FIRST_DEAD.get(M.plies);
  return i == null ? null : i;
}

const isDead = (d) => !!(d && d.w === 'unwinnable' && d.b === 'unwinnable');
// what the eval bar shows for a dead position, in place of the eval or the tablebase's answer
const deadBar = (d) => (isDead(d) ? { cp: 0, txt: 'DEAD' } : null);

const SIDE = { w: 'White', b: 'Black' };
// the Analysis panel's words for the answers: the heading and the note under it, or null with nothing proven
function deadWords(d) {
  if (!d) return null;
  if (isDead(d)) return { head: 'Dead position · ½–½', note: 'Neither side can mate by any series of legal moves (FIDE 5.2.2)' };
  const lost = d.w === 'unwinnable' && d.b === 'winnable' ? 'w' : d.b === 'unwinnable' && d.w === 'winnable' ? 'b' : null;
  if (!lost) return null;
  const other = lost === 'w' ? 'b' : 'w';
  return { head: `${SIDE[lost]} can no longer win`, note: `No series of legal moves lets ${SIDE[lost]} mate. ${SIDE[other]} still can.` };
}

// The Analysis panel's block for a dead position, or a side that can no longer win; nothing otherwise
function DeadBlock({ d }) {
  const w = deadWords(d);
  if (!w) return null;
  return (
    <div className="dead-block" style={{ ...NO_SELECT, display: 'flex', flexDirection: 'column', gap: tx(4) }}>
      <span style={{ font: `600 ${tx(15)}px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.ink }}>{w.head}</span>
      <span style={{ font: `500 ${tx(14)}px ${MONO}`, color: C.dim }}>{w.note}</span>
    </div>
  );
}

// The Moves list's mark after the move that left the position dead
function DeadPill() {
  return (
    <span className="dead-pill" title="From here the position is dead: neither side can mate" style={{ ...NO_SELECT, flex: 'none', padding: `${tx(1)}px ${tx(6)}px`, borderRadius: tx(8), background: C.line, color: C.ink, font: `600 ${tx(11)}px ${MONO}`, letterSpacing: '0.06em' }}>DEAD</span>
  );
}
