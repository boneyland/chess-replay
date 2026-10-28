// ---------- the free board ----------
// A board without a game (Play/Explore → Starting position): the viewer plays both sides and Stockfish rates every move. A view of its own
// rather than a zero-ply GameVideo, so the replay's timeline never has to handle it; it shares the frame's layout,
// panels, board drawing and input. The board (BoardCore) lives in GameApp's files, so it is stored like a loaded game.
const FULL_SET = { q: 1, r: 2, b: 2, n: 2, p: 8 };

// A player bar for "White" or "Black" (or name: "You", "Stockfish 19"): the pieces taken and the material edge, counted from the pieces on the board
// against a full set (so a position set up with an edge shows it), and in a clocked game the clock ({ s, active })
function FreeBar({ pos, side, a, clock, name }) {
  const left = (col, t) => pos.b.filter((p) => p === (col === 'w' ? t.toUpperCase() : t)).length;
  const lost = (col, t) => Math.max(0, FULL_SET[t] - left(col, t));
  const worth = (col) => Object.keys(FULL_SET).reduce((s, t) => s + left(col, t) * VALUE[t], 0);
  const opp = side === 'w' ? 'b' : 'w', pts = worth(side) - worth(opp), shown = [];
  Object.keys(FULL_SET).forEach((t) => {
    for (let i = 0; i < lost(opp, t) - lost(side, t); i++) shown.push(<img key={t + i} src={img(opp, t)} alt="" style={{ width: tx(30), height: tx(30), flex: 'none', marginLeft: shown.length ? -tx(8) : 0, filter: opp === 'b' ? C.rim : 'none' }} />);
  });
  return (
    <div style={{ ...barPlace(side), gap: tx(14), opacity: a }}>
      <span style={{ width: tx(14), height: tx(14), borderRadius: 2, background: side === 'w' ? '#f1ebe1' : '#1c1613', border: `1.5px solid ${C.dim}`, flex: 'none' }} />
      <span style={{ font: `600 ${tx(20)}px ${SANS}`, color: C.ink, whiteSpace: 'nowrap' }}>{name || (side === 'w' ? 'White' : 'Black')}</span>
      <span style={{ display: 'flex', alignItems: 'center', marginLeft: tx(6) }}>{shown}</span>
      {pts > 0 && <span style={{ font: `600 ${tx(16)}px ${MONO}`, color: C.dim, marginLeft: tx(8) }}>+{pts}</span>}
      {clock && <span className="game-clock" style={{ marginLeft: 'auto', minWidth: tx(72), textAlign: 'center', padding: `${tx(1)}px ${tx(7)}px`, borderRadius: 3, font: `600 ${tx(17)}px ${MONO}`, background: clock.active ? (clock.s < 60 ? C.blunder : '#f1ebe1') : C.off, color: clock.active ? '#15100d' : C.dim, boxShadow: clock.active ? `0 0 0 1px ${C.line}` : 'none' }}>{fmtClock(clock.s)}</span>}
    </div>
  );
}

// a key's name drawn as a key: filled and bordered like a button, but only a label (no pointer, no clicks)
const KeyCap = ({ children }) => <span style={{ display: 'inline-block', padding: `0 ${tx(7)}px`, margin: `0 ${tx(1)}px`, borderRadius: 2, background: C.off, border: `1px solid ${C.line}`, boxShadow: `0 1px 0 ${C.line}`, color: C.ink, lineHeight: 1.45, pointerEvents: 'none', userSelect: 'none' }}>{children}</span>;

// the book's name for the position on the board (the last named one on the way there, the start included), or null
function boardOpening(board, book) {
  if (!book) return null;
  try { return book.name(window.BoardCore.ucis(board), board.fen); } catch (e) { return null; }
}
// the book moves from the position on the board, most book lines first
function bookMoves(board, book) {
  if (!book) return [];
  try { return book.continuations(window.BoardCore.ucis(board), board.fen); } catch (e) { return []; }
}

// the engine arrows plus the hovered explorer move's, drawn over them in the free board's colour
const hovArrows = (arrows, uci) => (uci ? [{ uci, k: 'hover', color: BOARD.last, a: 0.9 }, ...(arrows || [])] : arrows);

// The Commentary box on the free board: the position's name and the book moves from it, each a button that plays the
// move as a drag would (so Stockfish rates it). Out of the book it says so, with the last book position on the way.
function OpeningExplorer({ board, book, onPlay, onHover }) {
  const B = window.BoardCore, ucis = B.ucis(board), white = B.pos(board).turn === 'w';
  const named = boardOpening(board, book), next = bookMoves(board, book);
  let inBook = false;
  try { inBook = !!book && book.inBook(ucis, board.fen); } catch (e) {}
  const fromStart = board.fen === window.ChessCore.START_FEN;
  const heading = (txt, dim) => <span className="book-head" style={{ display: 'block', font: `400 ${tx(40)}px/1.14 ${SERIF}`, color: dim ? C.dim : C.ink, textWrap: 'pretty' }}>{txt}</span>;
  const note = (txt) => <span style={{ display: 'block', marginTop: tx(8), font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{txt}</span>;
  const play = (e, uci) => { e.preventDefault(); e.stopPropagation(); onPlay(uci); };
  // each position's list starts at its top, not where the last one was scrolled to (the panel's box stays the same node)
  const top = React.useRef(null), posKey = board.fen + '|' + ucis.join(' ');
  React.useLayoutEffect(() => { const box = top.current && top.current.parentElement; if (box) box.scrollTop = 0; }, [posKey]);
  let body;
  if (!book) body = <span style={{ font: `italic 400 ${tx(30)}px/1.25 ${SERIF}`, color: C.dim }}>Loading the opening book…</span>;
  else if (inBook) {
    body = (
      <React.Fragment>
        {heading(named ? named.name : ucis.length === 0 && fromStart ? 'Starting position' : 'In the book')}
        {next.length ? (
          <div className="book-moves" style={{ display: 'flex', flexDirection: 'column', gap: tx(2), marginTop: tx(12) }}>
            {next.map((m) => (
              // a name that doesn't fit beside its move goes under it
              <div key={m.uci} className="mv expl-row" role="button" tabIndex={0} title={`Play ${m.san}`} onClick={(e) => play(e, m.uci)}
                onMouseEnter={() => onHover(m.uci)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(m.uci)} onBlur={() => onHover(null)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') play(e, m.uci); }}
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: tx(14), rowGap: tx(2), minWidth: 0, padding: `${tx(3)}px ${tx(6)}px`, borderRadius: 2, cursor: 'pointer' }}>
                <span style={{ flex: 'none', minWidth: tx(58), boxSizing: 'border-box', textAlign: 'center', padding: `${tx(2)}px ${tx(8)}px`, borderRadius: 2, font: `600 ${tx(17)}px ${MONO}`, background: white ? '#f1ebe1' : '#2a2320', color: white ? '#15100d' : '#efe8de', border: `1px solid ${white ? 'rgba(60,40,20,0.22)' : 'rgba(255,236,214,0.22)'}` }}>{m.san}</span>
                <span style={{ minWidth: 0, maxWidth: '100%', font: `400 ${tx(17)}px ${SANS}`, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name || ''}</span>
              </div>
            ))}
          </div>
        ) : note('No book moves from here.')}
      </React.Fragment>
    );
  } else if (named || (fromStart && ucis.length)) {
    body = <React.Fragment>{heading('Out of book', true)}{named && note(`last book position: ${named.eco} ${named.name}`)}</React.Fragment>;
  } else body = <span style={{ font: `italic 400 ${tx(30)}px/1.25 ${SERIF}`, color: C.dim }}>This position isn’t in the opening book.</span>;
  return (
    <Panel box={{ ...L.comment, scroll: !L.comment.flow }} a={1} title="Opening explorer" right={named ? `${named.eco} ${named.name}` : null}>
      <div ref={top}>{body}</div>
    </Panel>
  );
}

// The Analysis panel before the first move: the start position's eval and Stockfish's best line, whose moves play
// on the board when picked (as its replies do after a move)
function StartAnalysis({ board, ev, status, onLine }) {
  const after = ev.after, down = status === 'unavailable' || status === 'stopped';
  const line = engineSteps(board.start.pos, after && after.pv);
  const turn = board.start.pos.turn === 'w' ? 'White' : 'Black';
  return (
    <React.Fragment>
      {/* a narrow panel puts the eval under Start, at the right */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: tx(28) }}>
        <span style={{ font: `700 ${headline()}px ${MONO}`, color: C.last }}>Start</span>
        <span style={{ marginLeft: 'auto', font: `700 ${headline()}px ${MONO}`, color: C.ink }}>{down && !(after && !after.partial) ? '—' : fmtSf(after && after.cp)}</span>
      </div>
      {/* under the move and the eval, spanning the panel, as in OwnMoveAnalysis */}
      <div style={{ marginTop: anGap(6), font: `600 ${tx(16)}px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.last }}>
        {turn} to move{down ? ` · ${status === 'unavailable' ? 'Stockfish can’t run here' : 'Stockfish stopped · play a move to restart it'}` : !after || after.partial ? ' · Thinking…' : ''}
      </div>
      <div style={{ marginTop: anGap(16), paddingTop: anGap(14), borderTop: `1px solid ${C.line}`, font: `500 ${tx(18)}px ${MONO}`, color: C.dim, display: 'flex', flexDirection: 'column', gap: anGap(8) }}>
        {after && after.lines && after.lines.length > 1 ? <EngineLines lines={after.lines} pos={board.start.pos} ply0={board.start.ply0} c={0} onPick={onLine} cloud={after.source === 'cloud'} />
          : line.length > 0
          ? <LineChips name={null} tip="stockfish’s best line" accent={C.best} moves={line.map((m) => m.san)} ply0={board.start.ply0} c={0} legal={line.length} sel={null} onPick={(j) => onLine(line.slice(0, j + 1))} />
          : <span> </span>}
        <span style={{ ...NO_SELECT, font: `500 ${tx(15)}px ${MONO}` }}>Drag a piece to play a move, for either side; Stockfish rates every move.</span>
      </div>
    </React.Fragment>
  );
}

// ---------- a game at the board (Play vs human, Play vs Stockfish) ----------
// the side to move in a game: after its last move (a game always shows its last move while it goes on)
const gameTurn = (board) => (board.steps.length ? board.steps[board.steps.length - 1].pos : board.start.pos).turn;
const sideName = (side) => (side === 'w' ? 'White' : 'Black');
// the names in a game's bars and header: "You" and "Stockfish 19" against Stockfish
const playerName = (G, side) => (G && G.mode === 'stockfish' ? (side === G.you ? 'You' : 'Stockfish 19') : sideName(side));

// Stockfish's reply lands no sooner than this after the player's move, so it reads as a reply rather than a jump
const REPLY_PAUSE_MS = 600;
// the search of the position the player is to move in, the "before" of their move: long enough to rate it, then it stops
// rather than run the CPU (a phone's battery) for as long as they think; their move stops it sooner. A move is rated
// only when both searches reached MIN_RATED_DEPTH. Neither it nor Stockfish's reply has a depth limit: a capped depth
// ends an endgame search at once, short of a deep mate
const BEFORE_SEARCH = { depth: null, movetimeMs: 5000 }, MIN_RATED_DEPTH = 15;
const FLAGGED = ['inaccuracy', 'mistake', 'blunder'];

// Stockfish's side of a game against it. While the player is to move it searches the position at 'own' priority (the
// engine is idle then); the player's move stops that search, and the new position is searched at 'play' priority for
// Stockfish's reply, played through PlayCore.move no sooner than REPLY_PAUSE_MS after the move. The player's move is rated
// from the two searches, and a flagged one joins the critique in the same change. A result lands only on the board it was
// searched for (the same game, the same moves, still going on): a takeback, a resign, a new game or leaving the board
// cancels the searches and drops what they find. Returns { down }: 'unavailable' or 'stopped' when Stockfish can't answer
// (a takeback tries again; a stopped engine restarts on the next engine.get())
function useEngineOpponent(board, onChange, sf) {
  const B = window.BoardCore, P = window.PlayCore, G = board.game;
  const active = !!G && G.mode === 'stockfish' && P.inProgress(board);
  const moves = B.ucis(board, board.steps.length), key = active ? G.id + '|' + moves.join(' ') : '';
  const latest = React.useRef(null);
  latest.current = { board, onChange };
  // the "before" search of the position the player last moved from: { key, promise } (its result, or null)
  const before = React.useRef(null);
  const [down, setDown] = React.useState(null);
  React.useEffect(() => {
    setDown(null);
    if (!active) { before.current = null; return; }
    const A = window.AnalysisCore, CC = window.ChessCore, id = G.id, you = G.you, fen = board.fen, n = moves.length, list = moves.join(' ');
    let live = true, handle = null, timer = null;
    const engine = async () => { try { return await sf.engine.get(); } catch (e) { if (live) setDown('unavailable'); return null; } };
    if (gameTurn(board) === you) {
      before.current = { key, promise: (async () => { const eng = await engine(); if (!live || !eng) return null; handle = eng.search({ moves, fen, ...BEFORE_SEARCH, priority: 'own' }); return handle.promise; })() };
      // the player's move (or a takeback) stops it; its last complete depth is what the move is rated against
      return () => { live = false; if (handle) handle.cancel(); };
    }
    const movedAt = Date.now(), prevKey = id + '|' + moves.slice(0, -1).join(' ');
    const prior = before.current && before.current.key === prevKey ? before.current.promise : null;
    before.current = null;
    const same = (b) => P.inProgress(b) && b.game.id === id && b.steps.length === n && B.ucis(b, n).join(' ') === list;
    (async () => {
      const eng = await engine();
      if (!live || !eng) return;
      handle = eng.search({ moves, fen, depth: null, movetimeMs: P.thinkMs(latest.current.board, Date.now()), priority: 'play' });
      const r = await handle.promise, bf = prior ? await prior : null;
      if (!live) return;
      if (!r || !r.best) { setDown('stopped'); return; }
      const wait = movedAt + REPLY_PAUSE_MS - Date.now();
      if (wait > 0) await new Promise((res) => { timer = setTimeout(res, wait); });
      const { board: b, onChange: set } = latest.current;
      if (!live || !same(b)) return;
      const step = CC.stepFromUci(n ? b.steps[n - 1].pos : b.start.pos, r.best);
      if (!step) { setDown('stopped'); return; }
      // the player's move, rated from the search before it and Stockfish's search after it (both White's point of view)
      let next = b;
      const j = n - 1, played = b.steps[j], best = bf && A.bestOf(bf);
      if (played && best && bf.cp != null && r.cp != null && bf.depth >= MIN_RATED_DEPTH && r.depth >= MIN_RATED_DEPTH) {
        const cls = A.rateMove({ bestEval: bf.cp, currentEval: r.cp, isWhite: you === 'w', playedIsBest: played.uci === best, isCheckmate: played.san.endsWith('#') }).classification;
        const mated = (you === 'w' ? r.cp : -r.cp) <= -(A.C.MATE_SCORE_CP - A.C.MATE_BAND_CP);
        if (FLAGGED.includes(cls)) next = P.addCritique(next, { j, cls, best, text: P.critiqueText(played.pos, r.pv, you, cls, mated) });
      }
      set(P.move(next, step, Date.now()));
    })();
    return () => { live = false; clearTimeout(timer); if (handle) handle.cancel(); };
  }, [key]);
  return { down: active ? down : null };
}

// The Commentary box in a game: how the game works, in place of the explorer (a hint, so hidden). Against Stockfish it
// also shows the critique: during the game the latest flagged move and why, without the better move; after it, every
// flagged move with the better one
function GameInfo({ board }) {
  const G = board.game, sfGame = G.mode === 'stockfish';
  const note = (txt) => <span style={{ display: 'block', marginTop: tx(10), font: `400 ${tx(19)}px/1.4 ${SANS}`, color: C.dim }}>{txt}</span>;
  const heading = (txt, col) => <span className="game-info-head" style={{ display: 'block', font: `400 ${tx(40)}px/1.14 ${SERIF}`, color: col || C.ink }}>{txt}</span>;
  const from = board.fen === window.ChessCore.START_FEN ? 'From the starting position' : 'From a set-up position';
  let body;
  if (!sfGame) {
    body = (
      <React.Fragment>
        {heading(from)}
        {note('Two players at one board. The board turns after each move, so the side to move plays from the bottom.')}
        {note('A threefold repetition or fifty moves without a capture or pawn move let the side to move claim a draw there; the game is drawn by itself at a fivefold repetition or after 75 such moves.')}
      </React.Fragment>
    );
  } else {
    const crit = [...(G.critique || [])].sort((x, y) => x.j - y.j), side = sideName(G.you);
    const named = (c) => `${CLASS_LABEL[c.cls]}: ${window.BoardCore.label(board, c.j)}`;
    const why = (c) => (c.text ? c.text[0].toUpperCase() + c.text.slice(1) + '.' : '');
    const bestSan = (c) => { const r = window.ChessCore.applyUci(c.j ? board.steps[c.j - 1].pos : board.start.pos, c.best); return r ? r.san : c.best; };
    const line = (txt, col) => <span style={{ display: 'block', marginTop: tx(6), font: `400 ${tx(22)}px/1.35 ${SANS}`, color: col || C.ink }}>{txt}</span>;
    if (G.result) {
      body = (
        <React.Fragment>
          {heading(crit.length ? `${crit.length} flagged move${crit.length === 1 ? '' : 's'}` : 'No moves flagged')}
          {crit.length ? (
            <div className="game-critique" style={{ display: 'flex', flexDirection: 'column', gap: tx(10), marginTop: tx(12) }}>
              {crit.map((c) => (
                <div key={c.j}>
                  <span style={{ display: 'block', font: `600 ${tx(20)}px ${MONO}`, color: clsColor(c.cls) }}>{named(c)}</span>
                  {line(`${why(c)} Better was ${bestSan(c)}.`.trim())}
                </div>
              ))}
            </div>
          ) : note('Stockfish found no inaccuracy, mistake or blunder in your moves.')}
          {note(`You played ${side}, ${from.toLowerCase()}. Analyse on the free board shows Stockfish’s eval of every move.`)}
        </React.Fragment>
      );
    } else {
      const c = crit.length ? crit[crit.length - 1] : null;
      body = (
        <React.Fragment>
          {c ? <div className="game-critique">{heading(named(c), clsColor(c.cls))}{line(why(c))}</div> : heading(`You play ${side}`)}
          {note('Stockfish 19 plays at full strength.')}
          {note('No hints: Stockfish only says when one of your moves is an inaccuracy, a mistake or a blunder.')}
        </React.Fragment>
      );
    }
  }
  return (
    <Panel box={{ ...L.comment, scroll: !L.comment.flow }} a={1} title={sfGame ? 'Play vs Stockfish' : 'Play vs human'} right={G.tc || 'No clock'}>
      <div>{body}</div>
    </Panel>
  );
}

// The Analysis box in a game: whose move it is, with Take back, Offer a draw and Resign (the last two asked twice: a draw is
// offered by the side to move and accepted by the other; against Stockfish there is no draw offer, and the player resigns),
// and Claim a draw when the side to move can (vs human: a threefold repetition or the fifty-move rule),
// or the result with Play again beside it and Analyse on the free board below. down: why Stockfish can't answer, if so
function GameStatus({ board, onChange, down }) {
  const P = window.PlayCore, G = board.game, last = board.steps.length ? board.steps[board.steps.length - 1] : null;
  const turn = (last ? last.pos : board.start.pos).turn, side = sideName(turn), sfGame = G.mode === 'stockfish';
  // the question waiting on an answer: 'resign' or 'draw'; another position or result drops it
  const [ask, setAsk] = React.useState(null);
  React.useEffect(() => { setAsk(null); }, [board.steps.length, !!G.result]);
  const big = (txt, col) => <span style={{ font: `700 ${headline()}px ${MONO}`, color: col }}>{txt}</span>;
  const small = (txt, col) => <span style={{ font: `600 ${tx(16)}px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: col }}>{txt}</span>;
  const hint = (txt) => <FitOrHide style={{ ...NO_SELECT, display: 'block', marginTop: tx(14), font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>{txt}</FitOrHide>;
  // the button rows can't be selected: quick clicks on the buttons would otherwise highlight their text and the question's
  const row = (children) => <div style={{ display: 'flex', gap: tx(12), marginTop: tx(18), flexWrap: 'wrap', alignItems: 'center', userSelect: 'none', WebkitUserSelect: 'none' }}>{children}</div>;
  if (G.result) {
    const r = P.resultText(G.result);
    const { game, ...free } = board;
    // Play again keeps the mode, the clock and the side played (a Random side stays the one it came out as)
    const again = () => onChange(P.start(window.BoardCore.fromFen(board.fen), G.tc, null, sfGame ? { mode: 'stockfish', you: G.you } : undefined));
    return (
      <React.Fragment>
        <div style={{ display: 'flex', alignItems: 'center', gap: tx(28) }}>
          <div className="game-result" style={{ display: 'flex', flexDirection: 'column', gap: tx(6) }}>{big(r.score, C.ink)}{small(r.why, C.last)}</div>
          <div style={{ marginLeft: 'auto' }}><FrameButton primary onClick={again}>Play again</FrameButton></div>
        </div>
        {row(<FrameButton primary color={C.last} onClick={() => onChange(free)}>Analyse on the free board</FrameButton>)}
        {hint('← → step through the game')}
      </React.Fragment>
    );
  }
  const check = last && last.checkSq;
  const now = () => Date.now();
  const clockNote = G.clock && !board.steps.length ? 'The clocks start with the first move' : ' ';
  if (sfGame) {
    const mine = turn === G.you;
    const trouble = down === 'unavailable' ? 'Stockfish can’t run here' : down === 'stopped' ? 'Stockfish stopped · Take back or Resign' : null;
    return (
      <React.Fragment>
        <div style={{ display: 'flex', flexDirection: 'column', gap: tx(6) }}>
          {big(mine ? 'Your move' : trouble ? 'Stockfish to move' : 'Stockfish is thinking…', C.last)}
          {small(check ? 'Check' : trouble || clockNote, check || trouble ? C.blunder : C.dim)}
        </div>
        {ask === 'resign' ? row(<React.Fragment>
          <span style={{ font: `600 ${tx(18)}px ${SANS}`, color: C.ink }}>Resign this game?</span>
          <FrameButton color={C.blunder} onClick={() => onChange(P.resign(board, now(), G.you))}>Resign</FrameButton>
          <FrameButton color={C.dim} onClick={() => setAsk(null)}>Keep playing</FrameButton>
        </React.Fragment>) : row(<React.Fragment>
          {P.canTakeback(board) && <FrameButton color={C.dim} onClick={() => onChange(P.takeback(board, now()))}>Take back</FrameButton>}
          <FrameButton color={C.dim} onClick={() => setAsk('resign')}>Resign</FrameButton>
        </React.Fragment>)}
      </React.Fragment>
    );
  }
  const claim = P.claimable(board);
  const claimNote = claim && `${claim === 'repetition' ? 'Threefold repetition' : 'Fifty moves'}: claim a draw`;
  return (
    <React.Fragment>
      <div style={{ display: 'flex', flexDirection: 'column', gap: tx(6) }}>
        {big(`${side} to move`, C.last)}
        {small(check ? 'Check' : claimNote || clockNote, check ? C.blunder : claim ? C.last : C.dim)}
      </div>
      {ask ? row(<React.Fragment>
        <span style={{ font: `600 ${tx(18)}px ${SANS}`, color: C.ink }}>{ask === 'resign' ? `Resign as ${side}?` : `${side} offers a draw. ${side === 'White' ? 'Black' : 'White'}, accept?`}</span>
        <FrameButton color={ask === 'resign' ? C.blunder : C.last} onClick={() => onChange(ask === 'resign' ? P.resign(board, now()) : P.agreeDraw(board, now()))}>{ask === 'resign' ? 'Resign' : 'Accept'}</FrameButton>
        <FrameButton color={C.dim} onClick={() => setAsk(null)}>{ask === 'resign' ? 'Keep playing' : 'Decline'}</FrameButton>
      </React.Fragment>) : row(<React.Fragment>
        {claim && <FrameButton color={C.last} onClick={() => onChange(P.claimDraw(board, now()))}>Claim a draw</FrameButton>}
        {board.steps.length > 0 && <FrameButton color={C.dim} onClick={() => onChange(P.takeback(board, now()))}>Take back</FrameButton>}
        {board.steps.length > 0 && !claim && <FrameButton color={C.dim} onClick={() => setAsk('draw')}>Offer a draw</FrameButton>}
        <FrameButton color={C.dim} onClick={() => setAsk('resign')}>Resign as {side}</FrameButton>
      </React.Fragment>)}
    </React.Fragment>
  );
}

function FreeBoard({ board, onChange, tw, sf, nav, orient, book }) {
  const frame = useFrame();
  setLayout(frame, board.game ? 'game' : 'free'); // before the children render, which read the layout
  // a paused one-column page is as tall as its panels; the stage scrolls it
  const flowRef = React.useRef(null);
  useFlowHeight(frame, flowRef);
  const B = window.BoardCore, P = window.PlayCore, pos = B.pos(board), { steps, upto } = board, last = steps.length - 1;
  // a game: no eval, no hints; vs human the board turned to the side to move in the game's last position, against
  // Stockfish drawn from the player's side, which Stockfish's moves never change (nor Flip)
  const G = board.game || null, live = P.inProgress(board), sfGame = !!G && G.mode === 'stockfish';
  setOrient(sfGame ? G.you : G ? gameTurn(board) : orient);
  const opponent = useEngineOpponent(board, onChange, sf);
  const go = (u) => onChange(B.go(board, u));
  const play = (step) => onChange(live ? P.move(board, step, Date.now()) : B.play(board, step));
  const input = useBoardInput({ pos, onPick: () => {}, onMiss: () => {}, onMove: play });
  // a finished game takes no moves (Analyse on the free board does), nor the board while Stockfish is to move
  const still = G && (!live || (sfGame && gameTurn(board) !== G.you)), NO_INPUT = { onDown: () => {}, onMove: () => {}, onUp: () => {}, onCancel: () => {} };
  const boardKey = board.fen + '|' + B.ucis(board).join(' ');
  // the explorer row under the pointer: its move is drawn as an arrow on the board
  const [hov, setHov] = React.useState(null);
  // another position (a step, a takeback) drops a half-made move: a selected piece, the promotion picker
  React.useEffect(() => { input.clear(); setHov(null); }, [boardKey]);
  // Stockfish rates the move on the board: the positions before and after it (before the first move, both the start); never in a game
  const ev = useMoveEval(sf.engine, G ? null : B.ucis(board, upto), G ? null : B.ucis(board), sf.own, board.fen, null, cloudSetting(tw));
  const posBefore = upto > 0 ? steps[upto - 1].pos : board.start.pos;
  const bm = upto >= 0 && ev.before && ev.before.best ? window.ChessCore.applyUci(posBefore, ev.before.best) : null;
  const own = { ...ev, bestSan: bm ? bm.san : null };
  // a book move from the explorer, or a tablebase move in its place, goes the way of a drag
  const onBook = (uci) => { const step = window.ChessCore.stepFromUci(pos, uci); if (step) onChange(B.play(board, step)); };
  const onReply = (replies) => { let b = board; for (const s of replies) b = B.play(b, s); onChange(b); };
  const down = sf.status === 'unavailable' || sf.status === 'stopped';
  const cp = ev.after && ev.after.cp != null ? ev.after.cp : null;
  // the endgame tablebase for the position on the board (never in a game): it takes the explorer's place, and its
  // result replaces the eval in the bar
  const boardFen = () => window.ChessCore.fenAfter(board.fen, steps.slice(0, upto + 1).map((s) => s.san), pos);
  const tb = useTablebase(G ? null : boardFen(), tw.tablebase !== false), tbv = tbBar(tb);
  // Lichess's opening explorer (Settings › Online), asked where the tablebase isn't, in place of the local book
  const xf = explorerFilters(tw), xl = useExplorer(G || tb ? null : boardFen(), tw.explorer === true, xf);
  // the running clock: redrawn ten times a second, and the game ends when it reaches zero
  const running = live && G.clock && G.clock.since != null;
  const [, tick] = React.useState(0);
  const latest = React.useRef(null);
  latest.current = { board, onChange };
  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const { board: b, onChange: set } = latest.current, f = P.flag(b, Date.now());
      if (f !== b) set(f); else tick((x) => x + 1);
    }, 100);
    return () => clearInterval(id);
  }, [running, G && G.clock && G.clock.since]);
  const now = Date.now();
  const clockOf = (side) => (G && G.clock ? { s: P.timeLeft(board, side, now) / 1000, active: running && pos.turn === side } : null);
  // a move lands with its sound, as a line's moves do in the replay
  const stepKey = upto >= 0 ? upto + ':' + steps[upto].uci : '';
  const prevStep = React.useRef(stepKey);
  React.useEffect(() => { sfxPlayer.prepare(tw.soundSet); }, [tw.soundSet]);
  React.useEffect(() => {
    const p = prevStep.current;
    prevStep.current = stepKey;
    if (stepKey && stepKey !== p && tw.sound !== false) sfxPlayer.play(tw.soundSet, window.Sfx.kinds(steps[upto].san), tw.soundVolume);
  }, [stepKey]);
  // the transport bar's buttons and label, and the keys: ← → step, Home the start, End the last move; none in a game
  // in progress (Take back is a button by Resign)
  if (nav) nav.current = live ? {
    label: upto < 0 ? 'Start' : B.label(board, upto), color: C.last,
    hasPrev: false, hasNext: false, hasLast: false, hasFirst: false,
    prev: () => {}, next: () => {}, last: () => {}, first: () => {},
  } : {
    label: upto < 0 ? 'Start' : B.label(board, upto), color: C.last,
    hasPrev: upto >= 0, hasNext: upto < last, hasLast: upto < last,
    prev: () => go(upto - 1), next: () => go(upto + 1), last: () => go(last), first: () => go(-1),
  };
  if (nav) nav.current.fen = boardFen;
  const navSig = nav && nav.current ? `${nav.current.label}|${upto}|${last}|${live}` : '';
  React.useEffect(() => { if (nav && nav.listen) nav.listen(); }, [navSig]);
  const keyRef = React.useRef(null);
  keyRef.current = { go, upto, last, live, promo: input.promo, cancelPromo: input.cancelPromo };
  React.useEffect(() => {
    const onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (e.defaultPrevented || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = keyRef.current;
      if (e.code === 'Escape' && k.promo) { e.preventDefault(); k.cancelPromo(); return; }
      if (k.live) return;
      const to = { ArrowLeft: k.upto - 1, ArrowRight: k.upto + 1, Home: -1, End: k.last }[e.code];
      if (to == null) return;
      e.preventDefault();
      if (to >= -1 && to <= k.last && to !== k.upto) k.go(to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // MoveList draws a game at time T: one second a move, with T just short of the next, so the move shown is current and later ones dim
  const MV = React.useMemo(() => ({ ply0: board.start.ply0, plies: steps.map((s) => ({ san: s.san, cls: 'none' })) }), [steps, board.start.ply0]);
  const S = React.useMemo(() => ({ N: steps.length, tp: steps.map((_, i) => i) }), [steps.length]);
  const named = boardOpening(board, book);
  const from = board.fen === window.ChessCore.START_FEN ? 'from the starting position' : 'from a set-up position';
  const HM = G ? { white: { name: playerName(G, 'w') }, black: { name: playerName(G, 'b') }, event: sfGame ? 'Play vs Stockfish' : 'Play vs human', site: `${G.tc || 'no clock'} · ${from}` }
    : { white: { name: 'White' }, black: { name: 'Black' }, event: 'Free board', site: from, eco: named && named.eco, opening: named && named.name };
  return (
    <div ref={flowRef} style={{ position: 'absolute', inset: 0, background: C.bg, overflow: 'hidden', ...flowStyle() }}>
      {!G && (tbv ? <EvalBarView cp={tbv.cp} txt={tbv.txt} a={1} /> : <EvalBarView cp={cp == null ? 0 : cp} txt={cp == null ? (down ? '' : '…') : fmtSf(cp)} a={1} />)}
      <FreeBar pos={pos} side="b" a={1} clock={clockOf('b')} name={G ? playerName(G, 'b') : null} />
      <BoardSpace>
        <LineBoard a={1} sq={boardSquares()} v={{ upto, moves: steps, base: board.start.pos, src: 'you' }} hide={input.drag && input.drag.moved ? input.drag.from : null} arrows={hovArrows(!G && tw.bestArrows !== false ? lineArrows(ev.after) : null, hov)} />
        <BoardTouch pos={pos} sel={input.sel} targets={input.targets} drag={input.drag} promo={input.promo} {...(still ? NO_INPUT : input.handlers)} />
      </BoardSpace>
      <FreeBar pos={pos} side="w" a={1} clock={clockOf('w')} name={G ? playerName(G, 'w') : null} />
      {L.header && <Header M={HM} a={1} />}
      <MoveList M={MV} T={upto + 0.999} S={S} a={1} paused onPick={live ? () => {} : go} />
      {G ? <GameInfo board={board} /> : tb ? <TablebaseExplorer t={tb} posKey={boardKey} onPlay={onBook} /> : xl ? <LichessExplorer x={xl} tw={tw} posKey={boardKey} onPlay={onBook} onHover={setHov} white={pos.turn === 'w'} fallback={<OpeningExplorer board={board} book={book} onPlay={onBook} onHover={setHov} />} /> : <OpeningExplorer board={board} book={book} onPlay={onBook} onHover={setHov} />}
      {G ? <Panel box={L.analysis} a={1} style={NO_SELECT} title="Game"><GameStatus board={board} onChange={onChange} down={opponent.down} /></Panel>
        : <AnalysisPanel box={L.analysis} a={1} paused depth={down ? null : searchDepth(ev.after)} deep={ev}>
        {upto < 0
          ? <React.Fragment>
            <StartAnalysis board={board} ev={ev} status={sf.status} onLine={onReply} />
          </React.Fragment>
          : <React.Fragment>
            <OwnMoveAnalysis M={MV} vline={{ at: 0, moves: steps, upto, src: 'you' }} own={own} status={sf.status} onReply={onReply} />
            <FitOrHide style={{ ...NO_SELECT, display: 'block', marginTop: tx(8), font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}>← → step · <KeyCap>Home</KeyCap> the start · <KeyCap>End</KeyCap> the last move</FitOrHide>
          </React.Fragment>}
      </AnalysisPanel>}
    </div>
  );
}

// Paste PGN: a box for a whole PGN, Ctrl+Enter (or Load) opens it as a loaded game, Esc cancels. A PGN that doesn't
// build gets ChessCore's message and changes nothing; Enter in the box is a new line, as in any text area
function PgnDialog({ onLoad, onClose }) {
  const [text, setText] = React.useState(''), [msg, setMsg] = React.useState('');
  const load = () => {
    if (!text.trim()) { setMsg('Paste a PGN first.'); return; }
    try { window.ChessCore.buildGame({ pgn: text }); } catch (e) { setMsg((e && e.message) || 'That isn’t a PGN this page can read.'); return; }
    onLoad(text);
  };
  const onKey = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); load(); } };
  return (
    <DialogBox label="Paste PGN" onClose={onClose}>
      <textarea className="twk-field fen-field pgn-field" aria-label="PGN" aria-describedby="pgn-msg" data-autofocus spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
        placeholder={'[Event "…"]\n\n1. e4 e5 2. Nf3 Nc6 …'} value={text} onKeyDown={onKey} onChange={(e) => { setText(e.target.value); setMsg(''); }} />
      <div className="fen-info">
        <div id="pgn-msg" className="fen-msg" role="alert">{msg}</div>
        {!msg && <div className="fen-note">Opens as a loaded game, as Load game does: tags, comments, evals and a [FEN] start are read. Ctrl+Enter loads it.</div>}
      </div>
      <div className="fen-btns">
        <button type="button" className="twk-btn secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="twk-btn" onClick={load}>Load</button>
      </div>
    </DialogBox>
  );
}

// A small dialog over a scrim: Esc or a press on the scrim closes it, Enter on `enter` runs onEnter,
// and Tab goes round its controls; keys stop here, so the board's keys never see them
function DialogBox({ label, onClose, children }) {
  const box = React.useRef(null);
  React.useEffect(() => { const first = box.current && box.current.querySelector('[data-autofocus]'); if (first) first.focus(); }, []);
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); } else if (e.key === 'Tab') {
      const stops = [...e.currentTarget.querySelectorAll('input, textarea, button')], i = stops.indexOf(document.activeElement);
      e.preventDefault();
      stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
    }
  };
  return (
    <div className="fen-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="fen-box" role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKey} onMouseDown={(e) => { if (!e.target.closest('input, textarea, button')) e.preventDefault(); }}>
        <div className="fen-title">{label}</div>
        {children}
      </div>
    </div>
  );
}
// a row of choices drawn as Settings' segmented control
function DialogChoice({ label, value, options, onChange }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value)), n = options.length;
  return (
    <div className="play-row">
      <span className="play-label">{label}</span>
      <div className="twk-seg" role="radiogroup" aria-label={label}>
        <div className="twk-seg-thumb" style={{ left: `calc(2px + ${idx} * (100% - 4px) / ${n})`, width: `calc((100% - 4px) / ${n})` }} />
        {options.map((o) => <button key={o.label} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
      </div>
    </div>
  );
}

// Play vs human or vs Stockfish (mode): where the game starts (the starting position, or the open board's set-up position
// when it has one), the clock, and against Stockfish the side the player takes (side: 'w', 'b' or 'random', resolved when
// the game starts). onStart({ fen, tc, you })
// Start from: the starting position, or a set-up one: the board's, or with none set up, one set up in the editor first
// (onSetUp, with the dialog's choices). initial: the choices to open with (back from the editor), else the defaults
function PlayDialog({ mode = 'human', setUpFen, clock, side, initial, onStart, onSetUp, onClose }) {
  const sfGame = mode === 'stockfish';
  const [from, setFrom] = React.useState(initial ? initial.from : setUpFen ? 'setup' : 'start');
  const [tc, setTc] = React.useState(initial ? initial.tc : window.PlayCore.TIME_CONTROLS.includes(clock) ? clock : null);
  const [you, setYou] = React.useState(initial ? initial.you : ['w', 'b', 'random'].includes(side) ? side : 'w');
  const editFirst = from === 'setup' && !setUpFen;
  const start = () => (editFirst ? onSetUp({ tc, you: sfGame ? you : null }) : onStart({ fen: from === 'setup' ? setUpFen : window.ChessCore.START_FEN, tc, you: sfGame ? you : null }));
  return (
    <DialogBox label={sfGame ? 'Play vs Stockfish' : 'Play vs human'} onClose={onClose}>
      <DialogChoice label="Start from" value={from} options={[{ label: 'Starting position', value: 'start' }, { label: 'Set-up position', value: 'setup' }]} onChange={setFrom} />
      {sfGame && <DialogChoice label="You play" value={you} options={[{ label: 'White', value: 'w' }, { label: 'Black', value: 'b' }, { label: 'Random', value: 'random' }]} onChange={setYou} />}
      <DialogChoice label="Time control" value={tc} options={[{ label: 'Off', value: null }].concat(window.PlayCore.TIME_CONTROLS.map((x) => ({ label: x, value: x })))} onChange={setTc} />
      <div className="fen-note">{sfGame
        ? 'Stockfish 19 plays at full strength and replies after a short pause; the board stays on your side. No hints during the game, but Stockfish says when one of your moves is an inaccuracy, a mistake or a blunder. Take back is a button by Resign.'
        : 'Two players at this screen. The board turns after each move, so the side to move plays from the bottom; Take back is a button by Resign. Stockfish stays off until the game ends.'}</div>
      <div className="fen-btns">
        <button type="button" className="twk-btn secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="twk-btn" data-autofocus onClick={start}>{editFirst ? 'Set up position…' : 'Start game'}</button>
      </div>
    </DialogBox>
  );
}

// Asks before something leaves a game in progress (it stays in My games)
function LeaveDialog({ onLeave, onStay }) {
  return (
    <DialogBox label="Leave this game?" onClose={onStay}>
      <div className="fen-note">It stays in My games, to resume later; its clocks pause until the next move.</div>
      <div className="fen-btns">
        <button type="button" className="twk-btn secondary" data-autofocus onClick={onStay}>Keep playing</button>
        <button type="button" className="twk-btn" onClick={onLeave}>Leave the game</button>
      </div>
    </DialogBox>
  );
}

// My games: the kept games (GamesCore), newest first. A finished game replays as a loaded game, one in progress resumes
// on the board (the one on the board now can't be resumed or deleted); Delete asks in its row
function MyGamesDialog({ games, current, onReplay, onResume, onDelete, onClose }) {
  const P = window.PlayCore, G = window.GamesCore;
  const [ask, setAsk] = React.useState(null);
  // the button pressed goes when its row changes, so focus moves on, to the row's Delete after Keep or to Close after
  // Delete, and stays inside the dialog, where Esc and Tab work
  const delBtns = React.useRef({}), closeBtn = React.useRef(null), [focus, setFocus] = React.useState(null);
  React.useEffect(() => {
    if (!focus) return;
    const el = (focus.id && delBtns.current[focus.id]) || closeBtn.current;
    if (el) el.focus();
    setFocus(null);
  }, [focus]);
  const rows = React.useMemo(() => games.map((e) => ({ e, b: G.playable(e) })).filter((r) => r.b), [games]);
  return (
    <DialogBox label="My games" onClose={onClose}>
      {rows.length ? (
        <ul className="games-list">
          {rows.map(({ e, b }) => {
            const g = b.game, n = b.steps.length, r = g.result && P.resultText(g.result), turn = b.steps[n - 1].pos.turn === 'w' ? 'White' : 'Black';
            const head = r ? `${r.score} · ${r.why}` : `In progress · ${turn} to move`;
            const meta = [g.mode === 'stockfish' && `vs Stockfish · you played ${sideName(g.you)}`, window.ChessCore.fmtDate(g.date), g.tc || 'no clock', `${n} move${n === 1 ? '' : 's'}`,
              b.fen === window.ChessCore.START_FEN ? 'from the starting position' : 'from a set-up position'].filter(Boolean).join(' · ');
            return (
              <li key={e.id} className="games-row">
                <div className="games-text"><span className="games-head">{head}</span><span className="games-meta">{meta}</span></div>
                {ask === e.id ? (
                  <div className="games-btns">
                    <span className="games-ask">Delete this game?</span>
                    <button type="button" className="twk-btn" onClick={() => { setAsk(null); onDelete(e.id); setFocus({}); }}>Delete</button>
                    <button type="button" className="twk-btn secondary" autoFocus onClick={() => { setAsk(null); setFocus({ id: e.id }); }}>Keep</button>
                  </div>
                ) : e.id === current ? <div className="games-btns"><span className="games-ask">Playing now</span></div> : (
                  <div className="games-btns">
                    <button type="button" className="twk-btn" onClick={() => (r ? onReplay(e) : onResume(e))}>{r ? 'Replay' : 'Resume'}</button>
                    <button type="button" className="twk-btn secondary" ref={(el) => { delBtns.current[e.id] = el; }} onClick={() => setAsk(e.id)}>Delete</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : <div className="fen-note">No games yet. A game of Play vs human or Play vs Stockfish is kept here from its first move.</div>}
      <div className="fen-note">A finished game replays like a loaded one: analyse it with Stockfish, ask Queen, save it as a PGN or export a video. The 50 most recent games are kept, in this browser only.</div>
      <div className="fen-btns">
        <button ref={closeBtn} type="button" className="twk-btn secondary" data-autofocus onClick={onClose}>Close</button>
      </div>
    </DialogBox>
  );
}
