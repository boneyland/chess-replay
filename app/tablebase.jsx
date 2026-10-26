// ---------- the endgame tablebase (Settings › Online data) ----------
// Lichess's Syzygy tables for positions of 7 pieces or fewer: the result with best play, its distances and every move
// ranked by result. Shown in the eval bar, in the replay's Analysis panel while it is paused and in the free board's
// Commentary box (in place of the opening explorer), never during a game; the stored analysis is left alone.
const TB = window.LichessCore ? window.LichessCore.create() : null;
const TB_DEBOUNCE_MS = 300; // after the last position change (stepping through moves sends nothing for the ones passed)

// The tablebase's answer for the position on the board, or null when it isn't asked (off, more than 7 pieces):
// { state: 'loading' | 'none' (offline, an error, a back-off) | 'ready', tb, turn }. fen: its full FEN (ChessCore.fenAfter),
// whose fifty-move count the answer takes into account; null asks nothing
function useTablebase(boardFen, on) {
  const LC = window.LichessCore;
  const fen = on && TB && boardFen && LC.pieceCount(boardFen) <= LC.TB_MAX_PIECES ? boardFen : null;
  const [st, setSt] = React.useState({ fen: null, tb: null });
  const hit = fen ? TB.tablebaseCached(fen) : undefined;
  React.useEffect(() => {
    if (!fen || hit) return;
    const ctl = new AbortController();
    const id = setTimeout(() => TB.tablebase(fen, { signal: ctl.signal }).then((tb) => { if (!ctl.signal.aborted) setSt({ fen, tb }); }), TB_DEBOUNCE_MS);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [fen && LC.tbKey(fen)]);
  if (!fen) return null;
  const tb = hit || (st.fen === fen ? st.tb : undefined);
  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  return tb ? { state: 'ready', tb, turn } : { state: tb === null ? 'none' : 'loading', tb: null, turn };
}

// what the eval bar shows for the answer ({ cp, txt } from White's side, txt tagged "TB"), or null to keep the engine's
const tbBar = (t) => (t && t.state === 'ready' ? window.LichessCore.bar(t.tb, t.turn) : null);

const TB_GROUP = { win: 'Win', draw: 'Draw', loss: 'Loss', unknown: '?' };
const tbColor = (o) => (o === 'win' ? C.best : o === 'loss' ? C.blunder : C.dim);
// a move's distances for its tooltip, from the mover's side (the API gives them from the opponent's)
const tbDist = (m) => [m.dtz != null && m.dtz !== 0 && `DTZ ${-m.dtz}`, m.dtm != null && m.dtm !== 0 && `DTM ${-m.dtm}`].filter(Boolean).join(' · ');

// The Analysis panel's Tablebase block: the verdict and distances, then the moves by result (each group one line that
// scrolls sideways), best first; a move plays it on the board. t: useTablebase's answer
function TablebaseBlock({ t, onPlay }) {
  if (!t) return null;
  const LC = window.LichessCore;
  const head = (txt, color) => (
    <div style={{ ...NO_SELECT, display: 'flex', alignItems: 'baseline', gap: tx(10), font: `600 ${tx(15)}px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
      <span style={{ flex: 'none', color: C.dim }}>Tablebase</span><span style={{ minWidth: 0, color }}>{txt}</span>
    </div>
  );
  if (t.state !== 'ready') return <div className="tb-block">{head(t.state === 'loading' ? 'Looking up…' : 'Not available', C.dim)}</div>;
  const tb = t.tb, white = t.turn === 'w';
  // distances where a side is winning (a cursed win too: its DTZ says how far past the fifty moves the win lies)
  const decided = !tb.checkmate && (['win', 'loss'].includes(LC.outcome(tb.category)) || tb.category === 'cursed-win' || tb.category === 'blessed-loss');
  const dist = decided ? [tb.dtz != null && `DTZ ${Math.abs(tb.dtz)}`, tb.dtm ? `DTM ${Math.abs(tb.dtm)}` : null].filter(Boolean) : [];
  return (
    <div className="tb-block" style={{ display: 'flex', flexDirection: 'column', gap: tx(6) }}>
      {head([LC.verdict(tb, t.turn), ...dist].join(' · '), C.ink)}
      {LC.groups(tb).map((g) => (
        <div key={g.outcome} style={{ display: 'flex', alignItems: 'center', gap: tx(10), minWidth: 0 }}>
          <span style={{ ...NO_SELECT, flex: 'none', width: tx(52), font: `600 ${tx(14)}px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tbColor(g.outcome) }}>{TB_GROUP[g.outcome]}</span>
          <SideScroll style={{ display: 'flex', gap: tx(6), minWidth: 0, flex: 1 }}>
            {g.moves.map((m) => {
              const tip = `Play ${m.san}: ${LC.verdict({ category: m.mine, moves: [] }, t.turn)}${tbDist(m) ? ' · ' + tbDist(m) : ''}`;
              return (
                <span key={m.uci} className="mv tb-move" role="button" tabIndex={0} title={tip} aria-label={tip}
                  onClick={(e) => { e.stopPropagation(); onPlay(m.uci); }} onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPlay(m.uci); } }}
                  style={{ flex: 'none', cursor: 'pointer', padding: `${tx(2)}px ${tx(8)}px`, borderRadius: 4, font: `600 ${tx(16)}px ${MONO}`, background: white ? '#f1ebe1' : '#2a2320', color: white ? '#15100d' : '#efe8de', border: `1px solid ${g.outcome === 'win' || g.outcome === 'loss' ? tbColor(g.outcome) : white ? 'rgba(60,40,20,0.22)' : 'rgba(255,236,214,0.22)'}` }}>{m.san}</span>
              );
            })}
          </SideScroll>
        </div>
      ))}
    </div>
  );
}

// The Commentary box on the free board at 7 pieces or fewer, in place of the opening explorer (as on Lichess): the
// verdict, then every move by result, best first, the moves of a result wrapping in rows (their distances in their
// tooltips); a move plays as a drag would. t: useTablebase's answer
function TablebaseExplorer({ t, posKey, onPlay }) {
  const LC = window.LichessCore;
  const heading = (txt, dim) => <span className="tb-head" style={{ display: 'block', font: `400 ${tx(30)}px/1.14 ${SERIF}`, color: dim ? C.dim : C.ink, textWrap: 'pretty' }}>{txt}</span>;
  const note = (txt) => <span style={{ display: 'block', marginTop: tx(8), font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{txt}</span>;
  const play = (e, uci) => { e.preventDefault(); e.stopPropagation(); onPlay(uci); };
  // each position's list starts at its top, as the explorer's does
  const top = React.useRef(null);
  React.useLayoutEffect(() => { const box = top.current && top.current.parentElement; if (box) box.scrollTop = 0; }, [posKey]);
  let body, right = null;
  if (t.state === 'loading') body = heading('Looking up…', true);
  else if (t.state === 'none') body = <React.Fragment>{heading('Not available', true)}{note('Lichess can’t be reached: offline, or busy for a minute.')}</React.Fragment>;
  else {
    const tb = t.tb, white = t.turn === 'w';
    // distances where a side is winning (a cursed win too: its DTZ says how far past the fifty moves the win lies)
    const decided = !tb.checkmate && (['win', 'loss'].includes(LC.outcome(tb.category)) || tb.category === 'cursed-win' || tb.category === 'blessed-loss');
    right = decided ? [tb.dtz != null && `DTZ ${Math.abs(tb.dtz)}`, tb.dtm ? `DTM ${Math.abs(tb.dtm)}` : null].filter(Boolean).join(' · ') : null;
    // a long verdict ("Cursed win for White · drawn by the 50-move rule") is a heading and a note
    const [say, ...why] = LC.verdict(tb, t.turn).split(' · ');
    body = (
      <React.Fragment>
        {heading(say)}
        {why.length > 0 && note(why.join(' · '))}
        {LC.groups(tb).map((g) => (
          <div key={g.outcome} className="tb-group" style={{ marginTop: tx(14) }}>
            <span style={{ ...NO_SELECT, display: 'block', marginBottom: tx(4), font: `600 ${tx(14)}px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tbColor(g.outcome) }}>{TB_GROUP[g.outcome]}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: tx(6) }}>
              {g.moves.map((m) => {
                const tip = `Play ${m.san}: ${LC.verdict({ category: m.mine, moves: [] }, t.turn)}${tbDist(m) ? ' · ' + tbDist(m) : ''}`;
                return (
                  <span key={m.uci} className="mv tb-move" role="button" tabIndex={0} title={tip} aria-label={tip} onClick={(e) => play(e, m.uci)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') play(e, m.uci); }}
                    style={{ flex: 'none', minWidth: tx(58), boxSizing: 'border-box', textAlign: 'center', cursor: 'pointer', padding: `${tx(2)}px ${tx(8)}px`, borderRadius: 4, font: `600 ${tx(17)}px ${MONO}`, background: white ? '#f1ebe1' : '#2a2320', color: white ? '#15100d' : '#efe8de', border: `1px solid ${g.outcome === 'win' || g.outcome === 'loss' ? tbColor(g.outcome) : white ? 'rgba(60,40,20,0.22)' : 'rgba(255,236,214,0.22)'}` }}>{m.san}</span>
                );
              })}
            </div>
          </div>
        ))}
        {!tb.moves.length && note('No moves from here.')}
      </React.Fragment>
    );
  }
  return (
    <Panel box={{ ...L.comment, scroll: !L.comment.flow }} a={1} title="Endgame tablebase" right={right}>
      <div ref={top}>{body}</div>
    </Panel>
  );
}
