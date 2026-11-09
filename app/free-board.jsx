// ---------- the free board ----------
// A board without a game (Play/Explore → Starting position): the viewer plays both sides and Stockfish rates every move. A view of its own
// rather than a zero-ply GameVideo, so the replay's timeline never has to handle it; it shares the frame's layout,
// panels, board drawing and input. The board (BoardCore) lives in GameApp's files, so it is stored like a loaded game.

// A player bar for "White" or "Black" (or name: "You", "Stockfish 19"): the pieces taken and the material edge, counted from
// the pieces on the board (materialOf), and in a clocked game the clock ({ s, active })
function FreeBar({ pos, side, a, clock, name }) {
  const { taken, pts } = materialOf(side, (col, t) => pos.b.filter((p) => p === (col === 'w' ? t.toUpperCase() : t)).length);
  return <SideBar side={side} a={a} name={name || (side === 'w' ? 'White' : 'Black')} taken={taken} pts={pts} clock={clock} />;
}

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
  const top = React.useRef(null), posKey = board.fen + '|' + ucis.join(' '), rowKey = useRowFocus(top);
  React.useLayoutEffect(() => { const box = top.current && top.current.parentElement; if (box) box.scrollTop = 0; }, [posKey]);
  let body;
  if (!book) body = <span style={{ font: `italic 400 ${tx(30)}px/1.25 ${SERIF}`, color: C.dim }}>Loading the opening book…</span>;
  else if (inBook) {
    body = (
      <React.Fragment>
        {next.length ? (
          <div className="book-moves" style={{ display: 'flex', flexDirection: 'column', gap: tx(2) }}>
            {next.map((m) => (
              // the name stays beside its move, cut short with an ellipsis when it doesn't fit
              <div key={m.uci} className="mv expl-row" role="button" tabIndex={0} title={`Play ${m.san}`} onClick={(e) => play(e, m.uci)}
                onMouseEnter={() => onHover(m.uci)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(m.uci)} onBlur={() => onHover(null)}
                onKeyDown={rowKey(play, m.uci)}
                style={{ display: 'flex', alignItems: 'center', gap: tx(14), minWidth: 0, padding: `${tx(3)}px ${tx(6)}px`, borderRadius: 2, cursor: 'pointer' }}>
                <span style={rowChip(white)}>{m.san}</span>
                <span style={{ flex: '1 1 auto', minWidth: 0, font: `400 ${tx(17)}px ${SANS}`, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name || ''}</span>
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
    <Panel box={{ ...L.comment, scroll: !L.comment.flow }} a={1} part="opening-explorer" title="Opening explorer" right={named ? `${named.eco} ${named.name}` : null}>
      <div ref={top}>{body}</div>
    </Panel>
  );
}

// The Analysis panel before the first move: the start position's eval and Stockfish's best line, whose moves play
// on the board when picked (as its replies do after a move)
function StartAnalysis({ board, ev, status, why, onLine, onHover }) {
  const after = ev.after, down = status === 'unavailable' || status === 'stopped' || status === 'off' || status === 'busy';
  const line = engineSteps(board.start.pos, after && after.pv);
  const turn = board.start.pos.turn === 'w' ? 'White' : 'Black';
  return (
    <React.Fragment>
      {/* a narrow panel puts the eval under Start, at the right */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: tx(28) }}>
        <span style={{ font: `700 ${headline()}px ${MONO}`, color: C.last }}>Start</span>
        <EvalWithStat>{down && !(after && !after.partial) ? '—' : fmtSf(after && after.cp)}</EvalWithStat>
      </div>
      {/* under the move and the eval, spanning the panel, as in OwnMoveAnalysis */}
      <div style={{ marginTop: anGap(6), font: `600 ${tx(16)}px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.last }}>
        {turn} to move{down ? ` · ${sfDownText(status, why)}` : !after || after.partial ? ' · Thinking…' : ''}
      </div>
      <div style={{ marginTop: anGap(16), paddingTop: anGap(14), borderTop: `1px solid ${C.line}`, font: `500 ${tx(18)}px ${MONO}`, color: C.dim, display: 'flex', flexDirection: 'column', gap: anGap(8) }}>
        {after && after.lines && after.lines.length > 1 ? <EngineLines lines={after.lines} pos={board.start.pos} ply0={board.start.ply0} c={0} onPick={onLine} onHover={onHover} cloud={after.source === 'cloud'} />
          : line.length > 0
          ? <LineChips name={null} tip="stockfish’s best line" accent={C.best} moves={line.map((m) => m.san)} ply0={board.start.ply0} c={0} legal={line.length} sel={null} onPick={(j) => onLine(line.slice(0, j + 1))} onHover={(j) => onHover(j == null ? null : line.slice(0, j + 1))} />
          : <span> </span>}
      </div>
    </React.Fragment>
  );
}

// ---------- a game at the board (Play vs human, Play vs computer) ----------
// the side to move in a game: after its last move (a game always shows its last move while it goes on)
const gameTurn = (board) => (board.steps.length ? board.steps[board.steps.length - 1].pos : board.start.pos).turn;
const sideName = (side) => (side === 'w' ? 'White' : 'Black');
// the names in a game's bars and header: "You" and "Stockfish 19" against Stockfish
const playerName = (G, side) => (G && G.mode === 'stockfish' ? (side === G.you ? 'You' : 'Stockfish 19') : sideName(side));

// Stockfish's reply lands no sooner than this after the player's move, so it reads as a reply rather than a jump
// (within its think time, which the pause shares as it runs on Stockfish's clock: a low clock skips it)
const REPLY_PAUSE_MS = 600;
// the search of the position the player is to move in, the "before" of their move: long enough to rate it, then it stops
// rather than run the CPU (a phone's battery) for as long as they think; their move stops it sooner. Whether the two
// searches are deep enough to rate the move is PlayCore.rateMove's call. Neither it nor Stockfish's reply has a depth
// limit: a capped depth ends an endgame search at once, short of a deep mate
const BEFORE_SEARCH = { depth: null, movetimeMs: 5000 };
const FLAGGED = ['inaccuracy', 'mistake', 'blunder'];

// Stockfish's side of a game against it. While the player is to move it searches the position at 'own' priority (the
// engine is idle then); the player's move stops that search, and the new position is searched at 'play' priority for
// Stockfish's reply, played through PlayCore.move no sooner than REPLY_PAUSE_MS after the move. The player's move is rated
// from the two searches, and a flagged one joins the critique in the same change. A result lands only on the board it was
// searched for (the same game, the same moves, still going on): a takeback, a resign, a new game or leaving the board
// cancels the searches and drops what they find. Returns { down, retry }: down 'unavailable' or 'stopped' when Stockfish
// can't answer; retry() (Try again) or a takeback asks it again (a stopped engine restarts on the next engine.get()), so
// a player whose Stockfish dies before its first move, with nothing to take back, needn't resign
function useEngineOpponent(board, onChange, sf) {
  const B = window.BoardCore, P = window.PlayCore, G = board.game;
  const active = !!G && G.mode === 'stockfish' && P.inProgress(board);
  const moves = B.ucis(board, board.steps.length), key = active ? G.id + '|' + moves.join(' ') : '';
  const latest = React.useRef(null);
  latest.current = { board, onChange };
  // the "before" search of the position the player last moved from: { key, promise } (its result, or null)
  const before = React.useRef(null);
  const [down, setDown] = React.useState(null), [tries, setTries] = React.useState(0);
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
    // kept (not cleared) for a run again on the same moves, Try again's, which would otherwise leave the move unrated
    const prior = before.current && before.current.key === prevKey ? before.current.promise : null;
    const same = (b) => P.inProgress(b) && b.game.id === id && b.steps.length === n && B.ucis(b, n).join(' ') === list;
    (async () => {
      const eng = await engine();
      if (!live || !eng) return;
      const startAt = Date.now(), think = P.thinkMs(latest.current.board, startAt);
      handle = eng.search({ moves, fen, depth: null, movetimeMs: think, priority: 'play' });
      const r = await handle.promise, bf = prior ? await prior : null;
      if (!live) return;
      if (!r || !r.best) { setDown('stopped'); return; }
      // the pause runs on Stockfish's clock, so it ends by the think time's end: with a clock low (+0) none at all
      const wait = Math.min(movedAt + REPLY_PAUSE_MS, startAt + think) - Date.now();
      if (wait > 0) await new Promise((res) => { timer = setTimeout(res, wait); });
      const { board: b, onChange: set } = latest.current;
      if (!live || !same(b)) return;
      const step = CC.stepFromUci(n ? b.steps[n - 1].pos : b.start.pos, r.best);
      if (!step) { setDown('stopped'); return; }
      // the player's move, rated from the search before it and Stockfish's search after it (both White's point of view)
      let next = b;
      const j = n - 1, played = b.steps[j], best = bf && A.bestOf(bf);
      const cls = played && best ? P.rateMove({ before: bf, after: r, you, playedIsBest: played.uci === best, isCheckmate: played.san.endsWith('#') }) : null;
      if (cls) {
        const mated = (you === 'w' ? r.cp : -r.cp) <= -window.ChessCore.MATE_MIN;
        if (FLAGGED.includes(cls)) next = P.addCritique(next, { j, cls, best, text: P.critiqueText(played.pos, r.pv, you, cls, mated) });
      }
      set(P.move(next, step, Date.now()));
    })();
    return () => { live = false; clearTimeout(timer); if (handle) handle.cancel(); };
  }, [key, tries]);
  // hint(): Stockfish's best move in the position the player is to move in, from that "before" search (it ends within
  // BEFORE_SEARCH's 5 s), or null when there is none (not the player's turn, Stockfish down)
  const hint = async () => {
    const c = before.current;
    if (!active || !c || c.key !== key) return null;
    return window.AnalysisCore.bestOf(await c.promise);
  };
  return { down: active ? down : null, retry: () => setTries((n) => n + 1), hint };
}

// The Commentary box in a game: how the game works, in place of the explorer (a hint, so hidden). Against Stockfish it
// also shows the critique: during the game the latest flagged move and why, without the better move; after it, every
// flagged move with the better one
function GameInfo({ board }) {
  const G = board.game, sfGame = G.mode === 'stockfish';
  const note = (txt) => <span style={{ display: 'block', marginTop: tx(10), font: `400 ${tx(19)}px/1.4 ${SANS}`, color: C.dim }}>{txt}</span>;
  const heading = (txt, col) => <span className="game-info-head" style={{ display: 'block', font: `400 ${tx(40)}px/1.14 ${SERIF}`, color: col || C.ink }}>{txt}</span>;
  const from = G.from ? `From the position after ${window.BoardCore.label(board, G.from - 1)}` : board.fen === window.ChessCore.START_FEN ? 'From the starting position' : 'From a set-up position';
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
    const crit = [...(G.critique || [])].sort((x, y) => x.j - y.j), side = sideName(G.you), hintsUsed = (G.hints || []).length;
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
          {note(`You played ${side}, ${from.toLowerCase()}${hintsUsed ? `, with ${hintsUsed} hint${hintsUsed === 1 ? '' : 's'}` : ''}. Analyse on the free board shows Stockfish’s eval of every move.`)}
        </React.Fragment>
      );
    } else {
      const c = crit.length ? crit[crit.length - 1] : null;
      body = (
        <React.Fragment>
          {c ? <div className="game-critique">{heading(named(c), clsColor(c.cls))}{line(why(c))}</div> : heading(`You play ${side}`)}
          {note(`Stockfish says when one of your moves is an inaccuracy, a mistake or a blunder. Hint shows its best move, ${window.PlayCore.HINTS} times a game.`)}
        </React.Fragment>
      );
    }
  }
  return (
    <Panel box={{ ...L.comment, scroll: !L.comment.flow }} a={1} part="game-details" title={sfGame ? 'Play vs computer' : 'Play vs human'} right={G.tc || 'No clock'}>
      <div>{body}</div>
    </Panel>
  );
}

// The Analysis box in a game: whose move it is, with Take back, Offer a draw and Resign (the last two asked twice: a draw is
// offered by the side to move and accepted by the other; against Stockfish there is no draw offer, and the player resigns),
// and Claim a draw when the side to move can (vs human: a threefold repetition or the fifty-move rule),
// or the result with Play again beside it and Analyse on the free board below. down: why Stockfish can't answer, if so,
// and retry asks it again (Try again). tip: against Stockfish, the hint's state { san, left, wait, failed, ask } (FreeBoard's hintInfo)
function GameStatus({ board, onChange, down, why, retry, tip }) {
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
    // Play again keeps the mode, the clock and the side played (a Random side stays the one it came out as), and starts
    // where this game did: a game from a position again after the moves before it
    const from = G.from || 0, mode = sfGame ? { mode: 'stockfish', you: G.you } : {};
    const again = () => onChange(P.start(window.BoardCore.go(free, from - 1), G.tc, null, { ...mode, keep: from > 0 }));
    return (
      <React.Fragment>
        <div style={{ display: 'flex', alignItems: 'center', gap: tx(28) }}>
          <div className="game-result" style={{ display: 'flex', flexDirection: 'column', gap: tx(6) }}>{big(r.score, C.ink)}{small(r.why, C.last)}</div>
          <div style={{ marginLeft: 'auto' }}><FrameButton primary onClick={again}>Play again</FrameButton></div>
        </div>
        {row(<FrameButton primary color={C.last} onClick={() => onChange(free)}>Analyse on the free board</FrameButton>)}
      </React.Fragment>
    );
  }
  const check = last && last.checkSq;
  const now = () => Date.now();
  const clockNote = G.clock && !P.begun(board) ? 'The clocks start with the first move' : ' ';
  // stepped back to an earlier move: the game waits at its last move, where End or a press on the board goes
  const behind = board.upto < board.steps.length - 1;
  const backNote = behind && hint(`Looking at ${board.upto < 0 ? 'the start' : window.BoardCore.label(board, board.upto)} · End or a press on the board goes back to the game`);
  if (sfGame) {
    const mine = turn === G.you;
    const trouble = down ? sfDownText(down, why, P.canTakeback(board) ? 'Try again, Take back or Resign' : 'Try again or Resign') : null;
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
          {trouble && retry && <FrameButton primary color={C.last} onClick={retry}>Try again</FrameButton>}
          {mine && !behind && !trouble && tip && !tip.san && (tip.left > 0
            ? <FrameButton color={C.best} disabled={tip.wait} onClick={tip.ask}>Hint · {tip.left} left</FrameButton>
            : <span style={{ font: `600 ${tx(15)}px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.dim }}>No hints left</span>)}
          {P.canTakeback(board) && <FrameButton color={C.dim} onClick={() => onChange(P.takeback(board, now()))}>Take back</FrameButton>}
          <FrameButton color={C.dim} onClick={() => setAsk('resign')}>Resign</FrameButton>
        </React.Fragment>)}
        {mine && !behind && tip && (tip.san || tip.wait || tip.failed) && <span className="game-hint" role="status" style={{ display: 'block', marginTop: tx(14), font: `600 ${tx(18)}px ${SANS}`, color: tip.failed ? C.blunder : C.best }}>
          {tip.san ? `Hint: ${tip.san} · ${tip.left} left` : tip.wait ? 'Stockfish is looking for a move…' : 'Stockfish found no move: ask again'}
        </span>}
        {backNote}
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
        {P.canTakeback(board) && <FrameButton color={C.dim} onClick={() => onChange(P.takeback(board, now()))}>Take back</FrameButton>}
        {P.played(board) > 0 && !claim && <FrameButton color={C.dim} onClick={() => setAsk('draw')}>Offer a draw</FrameButton>}
        <FrameButton color={C.dim} onClick={() => setAsk('resign')}>Resign as {side}</FrameButton>
      </React.Fragment>)}
      {backNote}
    </React.Fragment>
  );
}

function FreeBoard({ board, onChange, tw, setTweak, onLichess, sf, nav, orient, book }) {
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
  // a finished game takes no moves (Analyse on the free board does), nor the board while Stockfish is to move; a game in
  // progress stepped back to an earlier move takes none either, and a press on the board goes back to its last move
  const behind = live && upto < last;
  const still = G && (!live || behind || (sfGame && gameTurn(board) !== G.you)), NO_INPUT = { onDown: () => {}, onMove: () => {}, onUp: () => {}, onCancel: () => {} };
  const stillInput = behind ? { ...NO_INPUT, onDown: () => go(last) } : NO_INPUT;
  const boardKey = board.fen + '|' + B.ucis(board).join(' ');
  // the viewer's circles and arrows, until another position
  const draw = useBoardDraw(boardKey);
  // a hint against Stockfish: the one had for the position, drawn as an arrow and named in the Game box while the game
  // waits at it; hintAt: the position a hint is being looked for in ({ key, failed })
  const myTurn = sfGame && live && !behind && gameTurn(board) === G.you, had = myTurn ? P.hintFor(board) : null;
  const [hintAt, setHintAt] = React.useState(null);
  const hintNow = hintAt && hintAt.key === boardKey ? hintAt : null;
  const askHint = async () => {
    const k = boardKey;
    setHintAt({ key: k });
    const best = await opponent.hint();
    const { board: b, onChange: set } = latest.current;
    if (b.fen + '|' + B.ucis(b).join(' ') !== k) return;
    const nb = best ? P.addHint(b, b.steps.length, best) : b;
    setHintAt(nb !== b ? null : { key: k, failed: true });
    if (nb !== b) set(nb);
  };
  const hintMove = had ? window.ChessCore.applyUci(pos, had.best) : null;
  const hintInfo = sfGame && live ? { san: hintMove ? hintMove.san : null, left: P.hintsLeft(board), wait: !!hintNow && !hintNow.failed, failed: !!hintNow && !!hintNow.failed, ask: askHint } : null;
  // the explorer row under the pointer: its move is drawn as an arrow on the board
  const [hov, setHov] = React.useState(null);
  // the Analysis line under the mouse, as the steps it would play: shown on the board until the mouse leaves
  const [pv, setPv] = React.useState(null);
  // another position (a step, a takeback) drops a half-made move: a selected piece, the promotion picker
  React.useEffect(() => { input.clear(); setHov(null); setPv(null); }, [boardKey]);
  // a board that stops taking moves (a flag fall, a late dead-position answer, Stockfish's turn) drops one half made:
  // its handlers no longer answer, so a drag ghost, a hidden piece or the promotion picker would stay
  React.useEffect(() => { if (still) input.clear(); }, [!!still]);
  // Stockfish rates the move on the board: the positions before and after it (before the first move, both the start); never in a game
  const ev = useMoveEval(sf.engine, G ? null : B.ucis(board, upto), G ? null : B.ucis(board), sf.own, board.fen, null, cloudSetting(tw), sf.off);
  const posBefore = upto > 0 ? steps[upto - 1].pos : board.start.pos;
  const bm = upto >= 0 && ev.before && ev.before.best ? window.ChessCore.applyUci(posBefore, ev.before.best) : null;
  const own = { ...ev, bestSan: bm ? bm.san : null };
  // a book move from the explorer, or a tablebase move in its place, goes the way of a drag
  const onBook = (uci) => { const step = window.ChessCore.stepFromUci(pos, uci); if (step) onChange(B.play(board, step)); };
  const onReply = (replies) => { let b = board; for (const s of replies) b = B.play(b, s); onChange(b); };
  const down = sf.off || sf.status === 'unavailable' || sf.status === 'stopped', sfStatus = sf.busy ? 'busy' : sf.off ? 'off' : sf.status;
  const cp = ev.after && ev.after.cp != null ? ev.after.cp : null;
  // the endgame tablebase for the position on the board (never in a game): it takes the explorer's place, and its
  // result replaces the eval in the bar. chasolver on it: in a game it ends the game (the answer may come after the
  // move: PlayCore's recheck), and nothing shows; elsewhere DEAD on the eval bar and the Analysis panel's block
  const boardFen = () => window.ChessCore.fenAfter(board.fen, steps.slice(0, upto + 1).map((s) => s.san), pos);
  const { tb, dead, fifty, fen } = useBoardFacts({ pos, fen: boardFen, tbOn: !G, tablebase: tw.tablebase !== false });
  const tbv = tbBar(tb), deadv = G ? null : deadBar(dead);
  // Lichess's opening explorer (Settings › Online), asked where the tablebase isn't, in place of the local book
  const xf = explorerFilters(tw), xl = useExplorer(G || tb ? null : fen, tw.explorer === true, xf);
  // the running clock: redrawn ten times a second, and the game ends when it reaches zero
  const running = live && G.clock && G.clock.since != null;
  const [, tick] = React.useState(0);
  const latest = React.useRef(null);
  latest.current = { board, onChange };
  React.useEffect(() => {
    const { board: b, onChange: set } = latest.current, r = P.recheck(b, Date.now());
    if (r !== b) set(r);
  }, [live, boardKey, dead && dead.w, dead && dead.b]);
  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const { board: b, onChange: set } = latest.current, f = P.flag(b, Date.now());
      if (f !== b) set(f); else tick((x) => x + 1);
    }, 100);
    return () => clearInterval(id);
  }, [running, G && G.clock && G.clock.since]);
  const now = Date.now();
  const clockOf = (side) => (G && G.clock ? { s: P.timeLeft(board, side, now) / 1000, active: running && gameTurn(board) === side } : null);
  // a move lands with its sound, as a line's moves do in the replay
  const stepKey = upto >= 0 ? upto + ':' + steps[upto].uci : '';
  const prevStep = React.useRef(stepKey);
  React.useEffect(() => { sfxPlayer.prepare(tw.soundSet); }, [tw.soundSet]);
  React.useEffect(() => {
    const p = prevStep.current;
    prevStep.current = stepKey;
    if (stepKey && stepKey !== p && tw.sound !== false) sfxPlayer.play(tw.soundSet, window.Sfx.kinds(steps[upto].san), tw.soundVolume);
  }, [stepKey]);
  // the transport bar's buttons and label, and the keys: ← → step, Home the start, End the last move, in a game in
  // progress too (Take back is a button by Resign), where only the last move takes a move
  if (nav) nav.current = {
    label: upto < 0 ? 'Start' : B.label(board, upto), color: C.last,
    hasPrev: upto >= 0, hasNext: upto < last, hasLast: upto < last,
    prev: () => go(upto - 1), next: () => go(upto + 1), last: () => go(last), first: () => go(-1),
  };
  if (nav) nav.current.fen = boardFen;
  // the moves to the one shown, for the Play dialogs' This position
  if (nav) nav.current.line = () => ({ fen: board.fen, moves: B.ucis(board) });
  const navSig = nav && nav.current ? `${nav.current.label}|${upto}|${last}|${live}` : '';
  React.useEffect(() => { if (nav && nav.listen) nav.listen(); }, [navSig]);
  // to a move (-1: the start), where there is one and it isn't the one shown: the keys and the wheel over the board
  const goIf = (to) => { if (to >= -1 && to <= last && to !== upto) go(to); };
  useKeydown((e) => {
    if (e.shiftKey || hasModifier(e)) return;
    if (e.code === 'Escape' && input.promo) { e.preventDefault(); input.cancelPromo(); return; }
    const to = { ArrowLeft: upto - 1, ArrowRight: upto + 1, Home: -1, End: last }[e.code];
    if (to == null) return;
    e.preventDefault();
    goIf(to);
  });
  // MoveList draws a game at time T: one second a move, with T just short of the next, so the move shown is current and later ones dim
  const MV = React.useMemo(() => ({ ply0: board.start.ply0, plies: steps.map((s) => ({ san: s.san, cls: 'none', pos: s.pos })) }), [steps, board.start.ply0]);
  // the move after which the position is first dead, marked with a pill on the Moves list
  const deadAt = useFirstDead(MV, (p) => p.pos);
  // a dead position's block, else the fifty-move rule's for the position on the board
  const rule = deadWords(dead) || fifty;
  // the result after the last move: a game's, else the last position's own end (checkmate, stalemate, a dead position)
  const end = G ? (G.result ? P.ending({ r: G.result }) : null) : steps.length ? P.ending({ pos: steps[last].pos, dead: deadAt != null }) : null;
  const S = React.useMemo(() => ({ N: steps.length, tp: steps.map((_, i) => i) }), [steps.length]);
  const named = boardOpening(board, book);
  const from = board.fen === window.ChessCore.START_FEN ? 'from the starting position' : 'from a set-up position';
  // the free board's Game info (a game's layout has none)
  const HM = { white: { name: 'White' }, black: { name: 'Black' }, event: 'Free board', site: from, eco: named && named.eco, opening: named && named.name };
  // an upright phone (one column in the phone tier; a tablet held upright keeps them) drops the free board's info box
  const upright = L.cols === 1 && L.tier === 'phone';
  return (
    <div ref={flowRef} style={{ position: 'absolute', inset: 0, background: C.bg, overflow: 'hidden', ...flowStyle() }}>
      {!G && (deadv || tbv ? <EvalBarView cp={(deadv || tbv).cp} txt={(deadv || tbv).txt} a={1} /> : <EvalBarView cp={cp == null ? 0 : cp} txt={cp == null ? (down ? '' : '…') : fmtSf(cp)} a={1} />)}
      <FreeBar pos={pos} side="b" a={1} clock={clockOf('b')} name={G ? playerName(G, 'b') : null} />
      <BoardSpace onStep={!steps.length ? null : (d) => goIf(upto + d)}>
        <LineBoard a={1} sq={boardSquares()} v={pv && pv.length ? { upto: upto + pv.length, moves: [...steps.slice(0, upto + 1), ...pv], base: board.start.pos, src: 'you' } : { upto, moves: steps, base: board.start.pos, src: 'you' }} hide={input.drag && input.drag.moved ? input.drag.from : null} arrows={hintMove ? [{ uci: had.best, k: 1 }] : hovArrows(!G && tw.bestArrows !== false ? lineArrows(ev.after) : null, hov)} sel={input.sel} />
        <BoardDraw draw={draw} hidden={!!(pv && pv.length)}>
          <BoardTouch pos={pos} targets={input.targets} drag={input.drag} promo={input.promo} {...(still ? stillInput : input.handlers)} />
        </BoardDraw>
      </BoardSpace>
      <FreeBar pos={pos} side="w" a={1} clock={clockOf('w')} name={G ? playerName(G, 'w') : null} />
      {L.header && !upright && <Header M={HM} a={1} />}
      <MoveList M={MV} T={upto + 0.999} S={S} a={1} paused onPick={go} deadAt={deadAt} end={end} startAt={G && G.from} />
      {G ? <GameInfo board={board} /> : tb ? <TablebaseExplorer t={tb} posKey={boardKey} onPlay={onBook} /> : xl ? <LichessExplorer x={xl} tw={tw} setTweak={setTweak} onGame={onLichess} posKey={boardKey} onPlay={onBook} onHover={setHov} white={pos.turn === 'w'} fallback={<OpeningExplorer board={board} book={book} onPlay={onBook} onHover={setHov} />} /> : <OpeningExplorer board={board} book={book} onPlay={onBook} onHover={setHov} />}
      {G ? <Panel box={L.analysis} part="game" a={1} style={NO_SELECT} title="Game"><GameStatus board={board} onChange={onChange} down={opponent.down} why={sf.why} retry={opponent.retry} tip={hintInfo} /></Panel>
        : <AnalysisPanel box={L.analysis} a={1} paused depth={down && !sf.off ? null : searchDepth(ev.after)} deep={ev}>
        {upto < 0
          ? <React.Fragment>
            <StartAnalysis board={board} ev={ev} status={sfStatus} why={sf.why} onLine={onReply} onHover={setPv} />
            {rule && <div style={{ marginTop: tx(12), paddingTop: tx(12), borderTop: `1px solid ${C.line}` }}><RuleBlock w={rule} /></div>}
          </React.Fragment>
          : <React.Fragment>
            <OwnMoveAnalysis M={MV} vline={{ at: 0, moves: steps, upto, src: 'you' }} own={own} status={sfStatus} why={sf.why} onReply={onReply} onHover={setPv} />
            {rule && <div style={{ marginTop: tx(12), paddingTop: tx(12), borderTop: `1px solid ${C.line}` }}><RuleBlock w={rule} /></div>}
          </React.Fragment>}
      </AnalysisPanel>}
    </div>
  );
}

// Import game (the dock's Import game): a tile that opens the file picker (or takes a drop: the page's own drop
// overlay shows over the dialog), one that opens Position from image, and a paste box that tells a PGN from a FEN or a
// Lichess link (ImportCore). A link is fetched here (LichessCore.fetchGame; Cancel or Esc stops it): a game opens, a
// broadcast round or study lists its games in the box's place. Ctrl+Enter (or Open) opens the text; what can't be
// opened gets a message under the box and changes nothing. auto: fetch text (a link) at once, as the explorer asks
function ImportDialog({ text: text0, auto, onChoose, onPgn, onFen, onImage, onClose }) {
  const [text, setText] = React.useState(text0 || ''), [msg, setMsg] = React.useState('');
  const [busy, setBusy] = React.useState(false), [list, setList] = React.useState(null); // list: { games, link }
  const ctl = React.useRef(null), body = React.useRef(null), shown = React.useRef(false);
  React.useEffect(() => () => ctl.current && ctl.current.abort(), []);
  // the list takes focus on its first game that can open; Back gives it back to the box
  React.useEffect(() => {
    if (!shown.current) { shown.current = true; return; }
    const el = body.current && body.current.closest('[role="dialog"]').querySelector(list ? '.import-game:not(:disabled), .import-list ~ .fen-btns button' : 'textarea');
    if (el) el.focus();
  }, [list]);
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); // a touch screen: nothing to drag from
  const fetchLink = async (link) => {
    const c = new AbortController();
    ctl.current = c; setBusy(true); setMsg('');
    const r = await window.LichessCore.fetchGame(link, { signal: c.signal });
    if (r.aborted || ctl.current !== c) return;
    ctl.current = null; setBusy(false);
    if (r.error) setMsg(r.error); else if (r.list) setList({ games: r.list, link }); else onPgn(r.pgn, link);
  };
  const open = (t = text) => {
    if (busy) return;
    const r = window.ImportCore.read(t);
    if (r.error) setMsg(r.error); else if (r.link) fetchLink(r.link); else if (r.setup) onFen(r.setup, t); else onPgn(r.pgn, null);
  };
  React.useEffect(() => { if (auto) open(text0); }, []);
  const close = () => { if (ctl.current) ctl.current.abort(); onClose(); };
  const onKey = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); open(); } };
  const back = () => { setList(null); setMsg(''); };
  const done = list && list.games.filter((g) => g.result).length;
  return (
    <DialogBox label="Import game" part="import-game" className="import-box" onClose={close}>
      {list ? <>
        <div ref={body} className="fen-note">{done ? `${list.games.length} game${list.games.length === 1 ? '' : 's'}; pick one to open${done < list.games.length ? ' (the greyed ones are still being played)' : ''}.` : 'No game here has finished yet: they can be opened once they end.'}</div>
        <div className="import-list">
          {list.games.map((g, i) => (
            <button key={i} type="button" className="import-game" disabled={!g.result}
              onClick={() => onPgn(g.pgn, { ...list.link, kind: 'game', id: list.link.id + '-' + (i + 1), side: null, ply: null })}>
              {g.board != null && <span className="import-board">{g.board}</span>}
              <span className="import-players">{g.white} – {g.black}</span>
              <span className="import-result">{g.result || 'playing'}</span>
            </button>
          ))}
        </div>
        <div className="fen-btns">
          <button type="button" className="twk-btn secondary" onClick={back}>Back</button>
          <button type="button" className="twk-btn secondary" onClick={close}>Cancel</button>
        </div>
      </> : <>
        <div ref={body} className={onImage ? 'vision-tiles' : 'vision-tiles import-one'}>
          <button type="button" className="vision-tile vision-tile-drop" aria-label="Choose a file, or drop one here" onClick={onChoose}>
            <VisionUpIcon />
            <span>{coarse ? <u>Choose a file</u> : <>Drop a PGN or <u>choose a file</u></>}</span>
            <small>with this page’s analysis or notes files too, if you have them</small>
          </button>
          {onImage && <button type="button" className="vision-tile" onClick={onImage}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 16l5-5 4 4 2.5-2.5 5.5 5.5" /><circle cx="15.5" cy="9" r="1.5" /></svg>
            <span>Position from image</span>
            <small>a screenshot, diagram or photo of a board</small>
          </button>}
        </div>
        <textarea className="twk-field fen-field pgn-field" aria-label="PGN, FEN or Lichess link" aria-describedby="import-msg" data-autofocus spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
          placeholder={'Or paste a PGN, a FEN or a Lichess link\n\n1. e4 e5 2. Nf3 Nc6 …\nhttps://lichess.org/…'} value={text} readOnly={busy} onKeyDown={onKey} onChange={(e) => { setText(e.target.value); setMsg(''); }} />
        <div className="fen-info">
          <div id="import-msg" className="fen-msg" role="alert">{msg}</div>
          {busy ? <div className="fen-note" role="status">Fetching from Lichess…</div>
            : !msg && <div className="fen-note">A PGN opens as a loaded game (tags, comments, evals and a [FEN] start are read; the first game of several), a FEN on the free board, or in Edit position when it isn’t legal. A Lichess link (a finished game, a broadcast or a study) is fetched from Lichess. Ctrl+Enter opens it.</div>}
        </div>
        <div className="fen-btns">
          <button type="button" className="twk-btn secondary" onClick={close}>Cancel</button>
          <button type="button" className="twk-btn" disabled={busy} onClick={() => open()}>Open</button>
        </div>
      </>}
    </DialogBox>
  );
}

// A small dialog over a scrim: Esc or a press on the scrim closes it, Enter on `enter` runs onEnter,
// and Tab goes round its controls; keys stop here, so the board's keys never see them
// part: the dialog's name, as the class part-<part>-dialog (docs/parts.md)
function DialogBox({ label, part, className, onClose, children }) {
  const box = React.useRef(null);
  React.useEffect(() => { const first = box.current && box.current.querySelector('[data-autofocus]'); if (first) first.focus(); }, []);
  const onKey = (e, root = e.currentTarget) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); } else if (e.key === 'Tab') {
      // a hidden file input and disabled buttons take no focus, so they are skipped; a focusable box (the crop box) is a stop
      const stops = [...root.querySelectorAll('input, textarea, select, button, a[href], [tabindex="0"]')].filter((el) => !el.disabled && el.getClientRects().length), i = stops.indexOf(document.activeElement);
      e.preventDefault();
      if (stops.length) stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
    }
  };
  // focus outside the dialog (Safari focuses no button on a click, so a click on one leaves the focus on the page; a
  // button disabled while it works drops it too): the topmost dialog still takes the keys, before anything else hears them
  const onKeyRef = React.useRef(onKey);
  onKeyRef.current = onKey;
  React.useEffect(() => {
    const away = (e) => {
      const el = box.current;
      if (!el || el.contains(document.activeElement) || [...document.querySelectorAll('[role="dialog"]')].pop() !== el) return;
      onKeyRef.current(e, el);
    };
    window.addEventListener('keydown', away, true);
    return () => window.removeEventListener('keydown', away, true);
  }, []);
  return (
    <div className="fen-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={['fen-box', className, part && `part-${part}-dialog`].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKey} onMouseDown={(e) => { if (!e.target.closest('input, textarea, select, button')) e.preventDefault(); }}>
        <div className="fen-title">{label}</div>
        {children}
      </div>
    </div>
  );
}
// a row of choices drawn as Settings' segmented control
function DialogChoice({ label, value, options, onChange }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="play-row">
      <span className="play-label">{label}</span>
      <div className="twk-seg" role="radiogroup" aria-label={label} style={{ '--n': options.length, '--i': idx }}>
        <div className="twk-seg-thumb" />
        {options.map((o, k) => <button key={o.label} type="button" style={{ gridColumn: k + 1 }} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
      </div>
    </div>
  );
}

// Play vs human or vs computer (mode): where the game starts (the starting position, or the open board's set-up position
// when it has one), the clock, and against Stockfish the side the player takes (side: 'w', 'b' or 'random', resolved when
// the game starts). onStart({ fen, tc, you })
// Start from: the starting position, or a set-up one: the board's, or with none set up, one set up in the editor first
// (onSetUp, with the dialog's choices). initial: the choices to open with (back from the editor), else the defaults
// onFromImage (or null where the board reader can't run): Start from's third choice, From image, whose button reads the
// position from a picture (with the dialog's choices)
// here: the position on the board when the dialog opened, as its start and the moves to it ({ fen, moves }, the view's
// nav line), or null; Start from's This position (first, and chosen, when it is more than the starting or set-up
// position) plays on from it with those moves: onStart({ here, tc, you })
function PlayDialog({ mode = 'human', setUpFen, here, clock, side, initial, onStart, onSetUp, onFromImage, onClose }) {
  const sfGame = mode === 'stockfish';
  const at = here && (here.moves.length || (here.fen !== window.ChessCore.START_FEN && here.fen !== setUpFen)) ? here : null;
  const [from, setFrom] = React.useState(initial ? initial.from : at ? 'here' : setUpFen ? 'setup' : 'start');
  const [tc, setTc] = React.useState(initial ? initial.tc : window.PlayCore.TIME_CONTROLS.includes(clock) ? clock : null);
  const [you, setYou] = React.useState(initial ? initial.you : ['w', 'b', 'random'].includes(side) ? side : 'w');
  const editFirst = from === 'setup' && !setUpFen, image = from === 'image' && !!onFromImage;
  const choices = { tc, you: sfGame ? you : null };
  const start = () => (image ? onFromImage(choices) : editFirst ? onSetUp(choices) : from === 'here' && at ? onStart({ here: at, ...choices }) : onStart({ fen: from === 'setup' ? setUpFen : window.ChessCore.START_FEN, ...choices }));
  const froms = (at ? [{ label: 'This position', value: 'here' }] : []).concat([{ label: 'Starting position', value: 'start' }, { label: 'Set-up position', value: 'setup' }], onFromImage ? [{ label: 'From image', value: 'image' }] : []);
  const n = at ? at.moves.length : 0;
  return (
    <DialogBox label={sfGame ? 'Play vs computer' : 'Play vs human'} part="play" onClose={onClose}>
      <DialogChoice label="Start from" value={from} options={froms} onChange={setFrom} />
      {sfGame && <DialogChoice label="You play" value={you} options={[{ label: 'White', value: 'w' }, { label: 'Black', value: 'b' }, { label: 'Random', value: 'random' }]} onChange={setYou} />}
      <DialogChoice label="Time control" value={tc} options={[{ label: 'Off', value: null }].concat(window.PlayCore.TIME_CONTROLS.map((x) => ({ label: x, value: x })))} onChange={setTc} />
      {from === 'here' && at && <div className="fen-note play-here-note">{n ? `The game goes on from the position on the board, keeping the ${n} move${n === 1 ? '' : 's'} before it; Take back stops there.` : 'The game starts from the position on the board.'}</div>}
      <div className="fen-note">{sfGame
        ? `The computer, Stockfish 19 (a chess engine), plays at full strength and replies after a short pause; the board stays on your side. It says when one of your moves is an inaccuracy, a mistake or a blunder, and Hint shows its best move, ${window.PlayCore.HINTS} times a game. Take back is a button by Resign.`
        : 'Two players at this screen. The board turns after each move, so the side to move plays from the bottom; Take back is a button by Resign. Stockfish stays off until the game ends.'}</div>
      <div className="fen-btns">
        <button type="button" className="twk-btn secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="twk-btn" data-autofocus onClick={start}>{image ? 'Choose image…' : editFirst ? 'Set up position…' : 'Start game'}</button>
      </div>
    </DialogBox>
  );
}

// Asks before something leaves a game in progress (it stays in My games)
function LeaveDialog({ onLeave, onStay }) {
  return (
    <DialogBox label="Leave this game?" part="leave-game" onClose={onStay}>
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
    <DialogBox label="My games" part="my-games" onClose={onClose}>
      {rows.length ? (
        <ul className="games-list">
          {rows.map(({ e, b }) => {
            const g = b.game, own = P.played(b), r = g.result && P.resultText(g.result), turn = gameTurn(b) === 'w' ? 'White' : 'Black';
            const head = r ? `${r.score} · ${r.why}` : `In progress · ${turn} to move`;
            const meta = [g.mode === 'stockfish' && `vs computer · you played ${sideName(g.you)}`, window.ChessCore.fmtDate(g.date), g.tc || 'no clock', `${own} move${own === 1 ? '' : 's'}`,
              g.from ? `from after ${window.BoardCore.label(b, g.from - 1)}` : b.fen === window.ChessCore.START_FEN ? 'from the starting position' : 'from a set-up position'].filter(Boolean).join(' · ');
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
      ) : <div className="fen-note">No games yet. A game of Play vs human or Play vs computer is kept here from its first move.</div>}
      <div className="fen-note">A finished game replays like a loaded one: analyse it with Stockfish, ask Queen, save it as a PGN or export a video. The 50 most recent games are kept, in this browser only.</div>
      <div className="fen-btns">
        <button ref={closeBtn} type="button" className="twk-btn secondary" data-autofocus onClick={onClose}>Close</button>
      </div>
    </DialogBox>
  );
}

// Menu › Keyboard shortcuts: what the keys do, in the groups the code handles them in (Stage in engine.jsx, GameVideo and
// FreeBoard, the move list, EditBoard, the dialogs). A key listed here is a key a handler reads: change one, change the other
const SHORTCUTS = [
  { title: 'Replay', rows: [
    ['Space', 'Play or pause'],
    ['← →', 'Pause and step to the previous or next move (in a previewed line, step the line)'],
    ['End', 'Pause and jump to the last move'],
    ['Home  0', 'Back to the start'],
    ['Shift + ← →', 'Seek 1 s'],
    [',  .', 'Pause and step one frame back or forward (at the export frame rate)'],
    ['Esc', 'Leave a previewed line, or cancel a promotion'],
    ['F', 'Flip the board'],
  ] },
  { title: 'Free board and games', rows: [
    ['← →', 'Previous or next move'],
    ['Home  End', 'First position, last position'],
    ['Esc', 'Cancel a promotion'],
    ['F', 'Flip the board (not in a game)'],
  ] },
  { title: 'Seek bar and move list', rows: [
    ['← →  ↓ ↑', 'Seek bar: 1 s back or forward (Shift 5 s)'],
    ['PageUp  PageDown', 'Seek bar: 10 s'],
    ['Home  End', 'Seek bar: start, end'],
    ['← →  ↑ ↓', 'Move list: previous or next move, previous or next line'],
    ['Enter  Space', 'Move list: go to the move'],
  ] },
  { title: 'Edit position', rows: [
    ['Arrows', 'Move the square on the board'],
    ['Enter  Space', 'Place the tray piece, or pick up a piece and put it down'],
    ['P N B R Q K', 'Place a piece (capitals White, lower case Black)'],
    ['Delete  Backspace', 'Take the piece away'],
    ['Esc', 'Put down a held piece, then leave the editor'],
  ] },
  { title: 'Menus and dialogs', rows: [
    ['Esc', 'Close the menu, Settings, Ask Queen or a dialog'],
    ['Tab', 'Go round a dialog\u2019s controls'],
    ['Ctrl/Cmd + Enter', 'Import game: open the pasted text'],
    ['← → Home End', 'Settings: switch tab'],
  ] },
];
function ShortcutsDialog({ onClose }) {
  return (
    <DialogBox label="Keyboard shortcuts" part="shortcuts" onClose={onClose}>
      <div className="keys-body">
        {SHORTCUTS.map((g) => (
          <section key={g.title} className="keys-group" aria-label={g.title}>
            <h3 className="keys-title">{g.title}</h3>
            <dl className="keys-list">
              {g.rows.map(([k, d]) => (
                <React.Fragment key={k + d}>
                  <dt>{k.split('  ').map((c) => <kbd key={c}>{c}</kbd>)}</dt>
                  <dd>{d}</dd>
                </React.Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="fen-btns">
        <button type="button" className="twk-btn secondary" data-autofocus onClick={onClose}>Close</button>
      </div>
    </DialogBox>
  );
}
