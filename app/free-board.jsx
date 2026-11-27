// ---------- the free board ----------
// A board without a game (Play/Explore → Starting position): the viewer plays both sides and Stockfish rates every move. A view of its own
// rather than a zero-ply GameVideo, so the replay's timeline never has to handle it; it shares the frame's layout,
// panels, board drawing and input. The board (BoardCore) lives in GameApp's files, so it is stored like a loaded game.

// A player bar for "White" or "Black" (or name: "You", "Stockfish 19"): the pieces taken and the material edge, counted from
// the pieces on the board (materialOf), and in a clocked game the clock ({ s, active })
function FreeBar({ pos, side, a, clock, name, strip }) {
  const { taken, pts } = materialOf(
    side,
    (col, t) => pos.b.filter((p) => p === (col === 'w' ? t.toUpperCase() : t)).length,
  );
  return (
    <SideBar
      side={side}
      a={a}
      name={name || (side === 'w' ? 'White' : 'Black')}
      taken={taken}
      pts={pts}
      clock={clock}
      strip={strip}
    />
  );
}

// the book's name for the position on the board (the last named one on the way there, the start included), or null
function boardOpening(board, book) {
  if (!book) return null;
  try {
    return book.name(window.BoardCore.ucis(board), board.fen);
  } catch (e) {
    return null;
  }
}
// the book moves from the position on the board, most book lines first
function bookMoves(board, book) {
  if (!book) return [];
  try {
    return book.continuations(window.BoardCore.ucis(board), board.fen);
  } catch (e) {
    return [];
  }
}

// the engine arrows plus the hovered explorer move's, drawn over them in the free board's colour
const hovArrows = (arrows, uci) => (uci ? [{ uci, k: 'hover', color: BOARD.last, a: 0.9 }, ...(arrows || [])] : arrows);

// The Commentary box on the free board: the position's name and the book moves from it, each a button that plays the
// move as a drag would (so Stockfish rates it). Out of the book it says so, with the last book position on the way.
function OpeningExplorer({ board, book, onPlay, onHover, std = true }) {
  const B = window.BoardCore,
    ucis = B.ucis(board),
    white = B.pos(board).turn === 'w';
  const named = std ? boardOpening(board, book) : null,
    next = std ? bookMoves(board, book) : [];
  let inBook = false;
  try {
    inBook = std && !!book && book.inBook(ucis, board.fen);
  } catch (e) {}
  const fromStart = board.fen === window.ChessCore.START_FEN;
  const heading = (txt, dim) => commentHead('book-head', txt, dim),
    note = commentNote;
  const play = (e, uci) => {
    e.preventDefault();
    e.stopPropagation();
    onPlay(uci);
  };
  const posKey = board.fen + '|' + ucis.join(' '),
    top = useScrollTop(posKey),
    rowKey = useRowFocus(top);
  let body;
  if (!std)
    body = (
      <span style={{ font: `italic 400 ${tx(30)}px/1.25 ${SERIF}`, color: C.dim }}>
        The opening book is for standard chess.
      </span>
    );
  else if (!book)
    body = (
      <span style={{ font: `italic 400 ${tx(30)}px/1.25 ${SERIF}`, color: C.dim }}>Loading the opening book…</span>
    );
  else if (inBook) {
    body = (
      <React.Fragment>
        {next.length ? (
          <div className="book-moves" style={{ display: 'flex', flexDirection: 'column', gap: tx(2) }}>
            {next.map((m) => (
              // the name stays beside its move, cut short with an ellipsis when it doesn't fit
              <div
                key={m.uci}
                className="mv expl-row"
                role="button"
                tabIndex={0}
                title={`Play ${m.san}`}
                onClick={(e) => play(e, m.uci)}
                onMouseEnter={() => onHover(m.uci)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(m.uci)}
                onBlur={() => onHover(null)}
                onKeyDown={rowKey(play, m.uci)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: tx(14),
                  minWidth: 0,
                  padding: `${tx(3)}px ${tx(6)}px`,
                  borderRadius: 2,
                  cursor: 'pointer',
                }}
              >
                <span style={rowChip(white)}>{m.san}</span>
                <span
                  style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    font: `400 ${tx(17)}px ${SANS}`,
                    color: C.dim,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {m.name || ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          note('No book moves from here.')
        )}
      </React.Fragment>
    );
  } else if (named || (fromStart && ucis.length)) {
    body = (
      <React.Fragment>
        {heading('Out of book', true)}
        {named && note(`last book position: ${named.eco} ${named.name}`)}
      </React.Fragment>
    );
  } else
    body = (
      <span style={{ font: `italic 400 ${tx(30)}px/1.25 ${SERIF}`, color: C.dim }}>
        This position isn’t in the opening book.
      </span>
    );
  return (
    <Panel
      box={{ ...L.comment, scroll: !L.comment.flow }}
      a={1}
      part="opening-explorer"
      title="Opening explorer"
      right={named ? `${named.eco} ${named.name}` : null}
    >
      <div ref={top}>{body}</div>
    </Panel>
  );
}

// The Analysis panel before the first move: the start position's eval and Stockfish's best line, whose moves play
// on the board when picked (as its replies do after a move)
function StartAnalysis({ board, ev, status, why, onLine, onHover }) {
  const after = ev.after,
    down = status === 'unavailable' || status === 'stopped' || status === 'off' || status === 'busy';
  const line = engineSteps(board.start.pos, after && after.pv);
  const turn = board.start.pos.turn === 'w' ? 'White' : 'Black';
  return (
    <React.Fragment>
      {/* a narrow panel puts the eval under Start, at the right */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: tx(28) }}>
        <span style={{ font: `700 ${headline()}px ${MONO}`, color: C.last }}>Start</span>
        <EvalWithStat>
          {down && !(after && !after.partial) ? '—' : fmtSf(after && after.cp, after && after.tb)}
        </EvalWithStat>
      </div>
      {/* under the move and the eval, spanning the panel, as in OwnMoveAnalysis */}
      <div
        style={{
          marginTop: anGap(6),
          font: `600 ${tx(16)}px ${MONO}`,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: C.last,
        }}
      >
        {turn} to move{down ? ` · ${sfDownText(status, why)}` : !after || after.partial ? ' · Thinking…' : ''}
      </div>
      <div
        style={{
          marginTop: anGap(16),
          paddingTop: anGap(14),
          borderTop: `1px solid ${C.line}`,
          font: `500 ${tx(18)}px ${MONO}`,
          color: C.dim,
          display: 'flex',
          flexDirection: 'column',
          gap: anGap(8),
        }}
      >
        {after && after.lines && after.lines.length > 1 ? (
          <EngineLines
            lines={after.lines}
            pos={board.start.pos}
            ply0={board.start.ply0}
            c={0}
            onPick={onLine}
            onHover={onHover}
            cloud={after.source === 'cloud'}
          />
        ) : line.length > 0 ? (
          <LineChips
            name={null}
            tip="stockfish’s best line"
            accent={C.best}
            moves={line.map((m) => m.san)}
            ply0={board.start.ply0}
            c={0}
            legal={line.length}
            sel={null}
            onPick={(j) => onLine(line.slice(0, j + 1))}
            onHover={(j) => onHover(j == null ? null : line.slice(0, j + 1))}
          />
        ) : (
          <span> </span>
        )}
      </div>
    </React.Fragment>
  );
}

// ---------- a game at the board (Play vs human, Play vs computer) ----------
// the side to move in a game: after its last move (a game always shows its last move while it goes on)
const gameTurn = (board) => (board.steps.length ? board.steps[board.steps.length - 1].pos : board.start.pos).turn;
const sideName = (side) => (side === 'w' ? 'White' : 'Black');

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
  const B = window.BoardCore,
    P = window.PlayCore,
    G = board.game;
  const active = !!G && G.mode === 'stockfish' && P.inProgress(board);
  const moves = B.ucis(board, board.steps.length),
    key = active ? G.id + '|' + moves.join(' ') : '';
  const latest = React.useRef(null);
  latest.current = { board, onChange };
  // the "before" search of the position the player last moved from: { key, promise } (its result, or null)
  const before = React.useRef(null);
  const [down, setDown] = React.useState(null),
    [tries, setTries] = React.useState(0);
  React.useEffect(() => {
    setDown(null);
    if (!active) {
      // a player's move that drew the game (stalemate, repetition…) gets no reply search: it is rated from the search before
      // it, which the move stopped, against the draw's 0
      const c = before.current,
        drawn = P.drawnByYou(board),
        n = moves.length,
        list = moves.join(' ');
      before.current = null;
      if (!drawn || !c || c.key !== G.id + '|' + moves.slice(0, -1).join(' ')) return;
      let live = true;
      (async () => {
        const bf = await c.promise;
        const { board: b, onChange: set } = latest.current;
        if (!live || !bf || !b.game || b.game.id !== G.id || b.steps.length !== n || B.ucis(b, n).join(' ') !== list)
          return;
        const j = n - 1,
          played = b.steps[j],
          best = window.AnalysisCore.bestOf(bf);
        const cls =
          best &&
          P.rateMove({
            before: bf,
            after: { cp: 0, depth: bf.depth },
            you: G.you,
            playedIsBest: played.uci === best,
            isCheckmate: false,
          });
        if (FLAGGED.includes(cls))
          set(P.addCritique(b, { j, cls, best, text: P.critiqueText(played.pos, [], G.you, cls, false, drawn) }));
      })();
      return () => {
        live = false;
      };
    }
    const A = window.AnalysisCore,
      CC = window.ChessCore,
      id = G.id,
      you = G.you,
      fen = board.fen,
      n = moves.length,
      list = moves.join(' ');
    let live = true,
      handle = null,
      timer = null;
    const engine = async () => {
      try {
        return await sf.engine.get();
      } catch (e) {
        if (live) setDown('unavailable');
        return null;
      }
    };
    if (gameTurn(board) === you) {
      const search = async () => {
        const eng = await engine();
        if (!live || !eng) return null;
        handle = eng.search({ moves, fen, ...BEFORE_SEARCH, priority: 'own' });
        return handle.promise;
      };
      // again(): a new search in its place (Hint asked after one that found no move), stopped by the move as the first is
      const c = { key, promise: search() };
      c.again = () => (c.promise = search());
      before.current = c;
      // the player's move (or a takeback) stops it; its last complete depth is what the move is rated against
      return () => {
        live = false;
        if (handle) handle.cancel();
      };
    }
    const movedAt = Date.now(),
      prevKey = id + '|' + moves.slice(0, -1).join(' ');
    // kept (not cleared) for a run again on the same moves, Try again's, which would otherwise leave the move unrated
    const prior = before.current && before.current.key === prevKey ? before.current.promise : null;
    const same = (b) => P.inProgress(b) && b.game.id === id && b.steps.length === n && B.ucis(b, n).join(' ') === list;
    (async () => {
      const eng = await engine();
      if (!live || !eng) return;
      const startAt = Date.now(),
        think = P.thinkMs(latest.current.board, startAt);
      handle = eng.search({ moves, fen, depth: null, movetimeMs: think, priority: 'play' });
      const r = await handle.promise,
        bf = prior ? await prior : null;
      if (!live) return;
      if (!r || !r.best) {
        setDown('stopped');
        return;
      }
      // the pause runs on Stockfish's clock, so it ends by the think time's end: with a clock low (+0) none at all
      const wait = Math.min(movedAt + REPLY_PAUSE_MS, startAt + think) - Date.now();
      if (wait > 0)
        await new Promise((res) => {
          timer = setTimeout(res, wait);
        });
      const { board: b, onChange: set } = latest.current;
      if (!live || !same(b)) return;
      const step = CC.stepFromUci(n ? b.steps[n - 1].pos : b.start.pos, r.best);
      if (!step) {
        setDown('stopped');
        return;
      }
      // the player's move, rated from the search before it and Stockfish's search after it (both White's point of view)
      let next = b;
      const j = n - 1,
        played = b.steps[j],
        best = bf && A.bestOf(bf);
      const cls =
        played && best
          ? P.rateMove({
              before: bf,
              after: r,
              you,
              playedIsBest: played.uci === best,
              isCheckmate: played.san.endsWith('#'),
            })
          : null;
      if (cls) {
        const mated = (you === 'w' ? r.cp : -r.cp) <= -window.ChessCore.MATE_MIN;
        if (FLAGGED.includes(cls))
          next = P.addCritique(next, { j, cls, best, text: P.critiqueText(played.pos, r.pv, you, cls, mated) });
      }
      set(P.move(next, step, Date.now()));
    })();
    return () => {
      live = false;
      clearTimeout(timer);
      if (handle) handle.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new game or move list (key) or Try again searches again; later reads go through latest
  }, [key, tries]);
  // hint(): Stockfish's best move in the position the player is to move in, from that "before" search (it ends within
  // BEFORE_SEARCH's 5 s), or from a new one when it found none (Stockfish was down: Ask again asks afresh), or null when
  // there is none (not the player's turn, Stockfish down)
  const hint = async () => {
    const c = before.current;
    if (!active || !c || c.key !== key) return null;
    const best = window.AnalysisCore.bestOf(await c.promise);
    if (best || before.current !== c) return best;
    const again = window.AnalysisCore.bestOf(await c.again());
    // Stockfish answered after all: its "can't run" note goes
    if (again && before.current === c) setDown(null);
    return again;
  };
  return { down: active ? down : null, retry: () => setTries((n) => n + 1), hint };
}

// The Commentary box in a game: how the game works, in place of the explorer (a hint, so hidden). Against Stockfish it
// also shows the critique: during the game the latest flagged move and why, without the better move; after it, every
// flagged move with the better one
function GameInfo({ board }) {
  const G = board.game,
    sfGame = G.mode === 'stockfish';
  const note = (txt) => (
    <span style={{ display: 'block', marginTop: tx(10), font: `400 ${tx(19)}px/1.4 ${SANS}`, color: C.dim }}>
      {txt}
    </span>
  );
  const heading = (txt, col) => (
    <span
      className="game-info-head"
      style={{ display: 'block', font: `400 ${tx(40)}px/1.14 ${SERIF}`, color: col || C.ink }}
    >
      {txt}
    </span>
  );
  const from = window.PlayCore.fromText(board, { long: true });
  let body;
  if (!sfGame) {
    body = (
      <React.Fragment>
        {heading(from)}
        {note('Two players at one board. The board turns after each move, so the side to move plays from the bottom.')}
        {note(
          'A threefold repetition or fifty moves without a capture or pawn move let the side to move claim a draw there; the game is drawn by itself at a fivefold repetition or after 75 such moves.',
        )}
      </React.Fragment>
    );
  } else {
    const crit = [...(G.critique || [])].sort((x, y) => x.j - y.j),
      side = sideName(G.you),
      hintsUsed = (G.hints || []).length;
    const named = (c) => `${CLASS_LABEL[c.cls]}: ${window.BoardCore.label(board, c.j)}`;
    const why = (c) => (c.text ? c.text[0].toUpperCase() + c.text.slice(1) + '.' : '');
    const bestSan = (c) => {
      const r = window.ChessCore.applyUci(c.j ? board.steps[c.j - 1].pos : board.start.pos, c.best);
      return r ? r.san : c.best;
    };
    const line = (txt, col) => (
      <span style={{ display: 'block', marginTop: tx(6), font: `400 ${tx(22)}px/1.35 ${SANS}`, color: col || C.ink }}>
        {txt}
      </span>
    );
    if (G.result) {
      body = (
        <React.Fragment>
          {heading(crit.length ? `${crit.length} flagged move${crit.length === 1 ? '' : 's'}` : 'No moves flagged')}
          {crit.length ? (
            <div
              className="game-critique"
              style={{ display: 'flex', flexDirection: 'column', gap: tx(10), marginTop: tx(12) }}
            >
              {crit.map((c) => (
                <div key={c.j}>
                  <span style={{ display: 'block', font: `600 ${tx(20)}px ${MONO}`, color: clsColor(c.cls) }}>
                    {named(c)}
                  </span>
                  {line(`${why(c)} Better was ${bestSan(c)}.`.trim())}
                </div>
              ))}
            </div>
          ) : (
            note('Stockfish found no inaccuracy, mistake or blunder in your moves.')
          )}
          {note(
            `You played ${side}, ${from.charAt(0).toLowerCase() + from.slice(1)}${hintsUsed ? `, with ${hintsUsed} hint${hintsUsed === 1 ? '' : 's'}` : ''}. Analyse on the free board shows Stockfish’s eval of every move.`,
          )}
        </React.Fragment>
      );
    } else {
      const c = crit.length ? crit[crit.length - 1] : null;
      body = (
        <React.Fragment>
          {c ? (
            <div className="game-critique">
              {heading(named(c), clsColor(c.cls))}
              {line(why(c))}
            </div>
          ) : (
            heading(`You play ${side}`)
          )}
          {board.chess960 != null && note(`${from}.`)}
          {note(
            `Stockfish says when one of your moves is an inaccuracy, a mistake or a blunder. Hint shows its best move, ${window.PlayCore.HINTS} times a game.`,
          )}
        </React.Fragment>
      );
    }
  }
  return (
    <Panel
      box={{ ...L.comment, scroll: !L.comment.flow }}
      a={1}
      part="game-details"
      title={sfGame ? 'Play vs computer' : 'Play vs human'}
      right={G.tc || 'No clock'}
    >
      <div>{body}</div>
    </Panel>
  );
}

// The Analysis box in a game: whose move it is, with Take back, Offer a draw and Resign (the last two asked twice: a draw is
// offered by the side to move and accepted by the other; against Stockfish there is no draw offer, and the player resigns),
// and Claim a draw when the side to move can (vs human: a threefold repetition or the fifty-move rule),
// or the result with Play again beside it and Analyse on the free board below. down: why Stockfish can't answer, if so,
// and retry asks it again (Try again). tip: against Stockfish, the hint's state { san, left, wait, failed, ask } (FreeBoard's hintInfo)
// onMove(step) plays a move as the board does: a Chess960 game's Castle buttons, shown on the viewer's turn at the game's last move
function GameStatus({ board, onChange, down, why, retry, tip, onMove }) {
  const P = window.PlayCore,
    G = board.game,
    last = board.steps.length ? board.steps[board.steps.length - 1] : null;
  const turn = (last ? last.pos : board.start.pos).turn,
    side = sideName(turn),
    sfGame = G.mode === 'stockfish';
  // the question waiting on an answer: 'resign' or 'draw'; another position or result drops it
  const [ask, setAsk] = React.useState(null);
  const ended = !!G.result;
  React.useEffect(() => {
    setAsk(null);
  }, [board.steps.length, ended]);
  const big = (txt, col) => <span style={{ font: `700 ${headline()}px ${MONO}`, color: col }}>{txt}</span>;
  const small = (txt, col) => (
    <span style={{ font: `600 ${tx(16)}px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: col }}>
      {txt}
    </span>
  );
  const hint = (txt) => (
    <FitOrHide
      style={{ ...NO_SELECT, display: 'block', marginTop: tx(14), font: `500 ${tx(15)}px ${MONO}`, color: C.dim }}
    >
      {txt}
    </FitOrHide>
  );
  // the button rows can't be selected: quick clicks on the buttons would otherwise highlight their text and the question's
  const row = (children) => (
    <div
      style={{
        display: 'flex',
        gap: tx(12),
        marginTop: tx(18),
        flexWrap: 'wrap',
        alignItems: 'center',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {children}
    </div>
  );
  if (G.result) {
    const r = P.resultText(G.result);
    const { game, ...free } = board;
    // Play again keeps the mode, the clock and the side played (a Random side stays the one it came out as), and starts
    // where this game did: a game from a position again after the moves before it
    const from = G.from || 0,
      mode = sfGame ? { mode: 'stockfish', you: G.you } : {};
    const again = () => onChange(P.start(window.BoardCore.go(free, from - 1), G.tc, null, { ...mode, keep: from > 0 }));
    return (
      <React.Fragment>
        <div className="game-result" style={{ display: 'flex', flexDirection: 'column', gap: tx(6) }}>
          {big(r.score, C.ink)}
          {small(r.why, C.last)}
        </div>
        {row(
          <React.Fragment>
            <FrameButton app primary onClick={again}>
              Play again
            </FrameButton>
            <FrameButton app onClick={() => onChange(free)}>
              Analyse on the free board
            </FrameButton>
          </React.Fragment>,
        )}
      </React.Fragment>
    );
  }
  const check = last && last.checkSq;
  const now = () => Date.now();
  const clockNote = G.clock && !P.begun(board) ? 'The clocks start with the first move' : ' ';
  // stepped back to an earlier move: the game waits at its last move, where End or a press on the board goes
  const behind = board.upto < board.steps.length - 1;
  const backNote =
    behind &&
    hint(
      `Looking at ${board.upto < 0 ? 'the start' : window.BoardCore.label(board, board.upto)} · End or a press on the board goes back to the game`,
    );
  if (sfGame) {
    const mine = turn === G.you;
    const trouble = down
      ? sfDownText(down, why, P.canTakeback(board) ? 'Try again, Take back or Resign' : 'Try again or Resign')
      : null;
    return (
      <React.Fragment>
        <div style={{ display: 'flex', flexDirection: 'column', gap: tx(6) }}>
          {big(mine ? 'Your move' : trouble ? 'Stockfish to move' : 'Stockfish is thinking…', C.last)}
          {small(check ? 'Check' : trouble || clockNote, check || trouble ? C.blunder : C.dim)}
        </div>
        {mine && !behind && !ask && <CastleButtons pos={last ? last.pos : board.start.pos} onMove={onMove} />}
        {ask === 'resign'
          ? row(
              <React.Fragment>
                <span style={{ font: `600 ${tx(18)}px ${SANS}`, color: C.ink }}>Resign this game?</span>
                <FrameButton app danger onClick={() => onChange(P.resign(board, now(), G.you))}>
                  Resign
                </FrameButton>
                <FrameButton app color={C.dim} onClick={() => setAsk(null)}>
                  Keep playing
                </FrameButton>
              </React.Fragment>,
            )
          : row(
              <React.Fragment>
                {trouble && retry && (
                  <FrameButton app primary color={C.last} onClick={retry}>
                    Try again
                  </FrameButton>
                )}
                {mine &&
                  !behind &&
                  !trouble &&
                  tip &&
                  !tip.san &&
                  (tip.left > 0 ? (
                    <FrameButton app color={C.best} disabled={tip.wait} onClick={tip.ask}>
                      Hint · {tip.left} left
                    </FrameButton>
                  ) : (
                    <span
                      style={{
                        font: `600 ${tx(15)}px ${MONO}`,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: C.dim,
                      }}
                    >
                      No hints left
                    </span>
                  ))}
                {P.canTakeback(board) && (
                  <FrameButton app color={C.dim} onClick={() => onChange(P.takeback(board, now()))}>
                    Take back
                  </FrameButton>
                )}
                <FrameButton app color={C.dim} onClick={() => setAsk('resign')}>
                  Resign
                </FrameButton>
              </React.Fragment>,
            )}
        {mine && !behind && tip && (tip.san || tip.wait || tip.failed) && (
          <span
            className="game-hint"
            role="status"
            style={{
              display: 'block',
              marginTop: tx(14),
              font: `600 ${tx(18)}px ${SANS}`,
              color: tip.failed ? C.blunder : C.best,
            }}
          >
            {tip.san
              ? `Hint: ${tip.san} · ${tip.left} left`
              : tip.wait
                ? 'Stockfish is looking for a move…'
                : 'Stockfish found no move: ask again'}
          </span>
        )}
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
      {!behind && !ask && <CastleButtons pos={last ? last.pos : board.start.pos} onMove={onMove} />}
      {ask
        ? row(
            <React.Fragment>
              <span style={{ font: `600 ${tx(18)}px ${SANS}`, color: C.ink }}>
                {ask === 'resign'
                  ? `Resign as ${side}?`
                  : `${side} offers a draw. ${side === 'White' ? 'Black' : 'White'}, accept?`}
              </span>
              <FrameButton
                app
                danger={ask === 'resign'}
                primary={ask !== 'resign'}
                onClick={() => onChange(ask === 'resign' ? P.resign(board, now()) : P.agreeDraw(board, now()))}
              >
                {ask === 'resign' ? 'Resign' : 'Accept'}
              </FrameButton>
              <FrameButton app color={C.dim} onClick={() => setAsk(null)}>
                {ask === 'resign' ? 'Keep playing' : 'Decline'}
              </FrameButton>
            </React.Fragment>,
          )
        : row(
            <React.Fragment>
              {claim && (
                <FrameButton app color={C.last} onClick={() => onChange(P.claimDraw(board, now()))}>
                  Claim a draw
                </FrameButton>
              )}
              {P.canTakeback(board) && (
                <FrameButton app color={C.dim} onClick={() => onChange(P.takeback(board, now()))}>
                  Take back
                </FrameButton>
              )}
              {P.played(board) > 0 && !claim && (
                <FrameButton app color={C.dim} onClick={() => setAsk('draw')}>
                  Offer a draw
                </FrameButton>
              )}
              <FrameButton app color={C.dim} onClick={() => setAsk('resign')}>
                Resign as {side}
              </FrameButton>
            </React.Fragment>,
          )}
      {backNote}
    </React.Fragment>
  );
}

function FreeBoard({ board, onChange, tw, setTweak, onLichess, sf, nav, orient, book }) {
  const reduced = useReducedMotion();
  const frame = useFrame();
  // a Chess960 board (its start, whatever the rights are now) has no opening names or explorer content (standard chess
  // only); its Commentary box stays, with the tablebase where it applies
  const std = !window.ChessCore.is960(board.start.pos);
  setLayout(frame, board.game ? 'game' : 'free'); // before the children render, which read the layout
  // a paused one-column page is as tall as its panels; the stage scrolls it
  const flowRef = React.useRef(null);
  useFlowHeight(frame, flowRef);
  const B = window.BoardCore,
    P = window.PlayCore,
    pos = B.pos(board),
    { steps, upto } = board,
    last = steps.length - 1;
  // a game: no eval, no hints; vs human the board turned to the side to move in the game's last position, against
  // Stockfish drawn from the player's side, which Stockfish's moves never change (nor Flip)
  const G = board.game || null,
    live = P.inProgress(board),
    sfGame = !!G && G.mode === 'stockfish';
  setOrient(sfGame ? G.you : G ? gameTurn(board) : orient);
  const opponent = useEngineOpponent(board, onChange, sf);
  const go = (u) => onChange(B.go(board, u));
  const play = (step) => onChange(live ? P.move(board, step, Date.now()) : B.play(board, step));
  const input = useBoardInput({ pos, onPick: () => {}, onMiss: () => {}, onMove: play });
  // a finished game takes no moves (Analyse on the free board does), nor the board while Stockfish is to move; a game in
  // progress stepped back to an earlier move takes none either, and a press on the board goes back to its last move
  const behind = live && upto < last;
  const still = G && (!live || behind || (sfGame && gameTurn(board) !== G.you)),
    NO_INPUT = { onDown: () => {}, onMove: () => {}, onUp: () => {}, onCancel: () => {} };
  const stillInput = behind ? { ...NO_INPUT, onDown: () => go(last) } : NO_INPUT;
  const boardKey = board.fen + '|' + B.ucis(board).join(' ');
  // the viewer's circles and arrows, until another position
  const draw = useBoardDraw(boardKey);
  // a hint against Stockfish: the one had for the position, drawn as an arrow and named in the Game box while the game
  // waits at it; hintAt: the game and position a hint is being looked for in ({ key, failed })
  const myTurn = sfGame && live && !behind && gameTurn(board) === G.you,
    had = myTurn ? P.hintFor(board) : null;
  const [hintAt, setHintAt] = React.useState(null);
  const hintKey = (b) => (b.game ? b.game.id : '') + '|' + b.fen + '|' + B.ucis(b).join(' ');
  const hintNow = hintAt && hintAt.key === hintKey(board) ? hintAt : null;
  const askHint = async () => {
    const k = hintKey(board);
    setHintAt({ key: k });
    const best = await opponent.hint();
    const { board: b, onChange: set } = latest.current;
    // the position (or the game: Play again) changed while it looked: the hint is dropped, and Hint can be asked again
    // back there
    if (hintKey(b) !== k) {
      setHintAt((h) => (h && h.key === k ? null : h));
      return;
    }
    const nb = best ? P.addHint(b, b.steps.length, best) : b;
    setHintAt(nb !== b ? null : { key: k, failed: true });
    if (nb !== b) set(nb);
  };
  const hintMove = had ? window.ChessCore.applyUci(pos, had.best) : null;
  const hintInfo =
    sfGame && live
      ? {
          san: hintMove ? hintMove.san : null,
          left: P.hintsLeft(board),
          wait: !!hintNow && !hintNow.failed,
          failed: !!hintNow && !!hintNow.failed,
          ask: askHint,
        }
      : null;
  // the explorer row under the pointer: its move is drawn as an arrow on the board
  const [hov, setHov] = React.useState(null);
  // the Analysis line under the mouse, as the steps it would play: shown on the board until the mouse leaves
  const [pv, setPv] = React.useState(null);
  // another position (a step, a takeback) drops a half-made move: a selected piece, the promotion picker
  React.useEffect(() => {
    input.clear();
    setHov(null);
    setPv(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only another position drops a half-made move; input is a new object every render
  }, [boardKey]);
  // a board that stops taking moves (a flag fall, a late dead-position answer, Stockfish's turn) drops one half made:
  // its handlers no longer answer, so a drag ghost, a hidden piece or the promotion picker would stay
  const isStill = !!still;
  React.useEffect(() => {
    if (isStill) input.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the board ceasing to take moves drops a half-made move; input is a new object every render
  }, [isStill]);
  // Stockfish rates the move on the board: the positions before and after it (before the first move, both the start); never in a game
  const ev = useMoveEval({
    engine: sf.engine,
    before: G ? null : B.ucis(board, upto),
    after: G ? null : B.ucis(board),
    settings: sf.own,
    fen: board.fen,
    stored: null,
    cloud: cloudSetting(tw),
    off: sf.off,
  });
  const posBefore = upto > 0 ? steps[upto - 1].pos : board.start.pos;
  const bm = upto >= 0 && ev.before && ev.before.best ? window.ChessCore.applyUci(posBefore, ev.before.best) : null;
  const own = { ...ev, bestSan: bm ? bm.san : null };
  // a book move from the explorer, or a tablebase move in its place, goes the way of a drag
  const onBook = (uci) => {
    const step = window.ChessCore.stepFromUci(pos, uci);
    if (step) onChange(B.play(board, step));
  };
  const onReply = (replies) => {
    let b = board;
    for (const s of replies) b = B.play(b, s);
    onChange(b);
  };
  const down = sf.off || sf.status === 'unavailable' || sf.status === 'stopped',
    sfStatus = sf.busy ? 'busy' : sf.off ? 'off' : sf.status;
  const cp = ev.after && ev.after.cp != null ? ev.after.cp : null;
  // the endgame tablebase for the position on the board (never in a game): it takes the explorer's place, and its
  // result replaces the eval in the bar. chasolver on it: in a game it ends the game (the answer may come after the
  // move: PlayCore's recheck), and nothing shows; elsewhere DEAD on the eval bar and the Analysis panel's block
  const boardFen = () =>
    window.ChessCore.fenAfter(
      board.fen,
      steps.slice(0, upto + 1).map((s) => s.san),
      pos,
    );
  // MoveList draws a game at time T: one second a move, with T just short of the next, so the move shown is current and later ones dim
  const MV = React.useMemo(
    () => ({ ply0: board.start.ply0, plies: steps.map((s) => ({ san: s.san, cls: 'none', pos: s.pos })) }),
    [steps, board.start.ply0],
  );
  // the move after which the position is first dead, marked with a pill on the Moves list; as in the
  // replay, a position after it is known dead without asking (dead stays dead)
  const deadAt = useFirstDead(MV);
  const { tb, dead, fifty, fen } = useBoardFacts({
    pos,
    fen: boardFen,
    tbOn: !G,
    tablebase: tw.tablebase !== false,
    known: deadAt != null && upto >= deadAt,
  });
  const tbv = tbBar(tb),
    deadv = G ? null : deadBar(dead);
  // Lichess's opening explorer (Settings › Online), asked where the tablebase isn't, in place of the local book
  const xf = explorerFilters(tw),
    xl = useExplorer(G || tb || !std ? null : fen, tw.explorer === true, xf);
  // the running clock: redrawn ten times a second, and the game ends when it reaches zero
  const running = live && G.clock && G.clock.since != null;
  const [, tick] = React.useState(0);
  const latest = React.useRef(null);
  latest.current = { board, onChange };
  // the game's last position decides its end (PlayCore.recheck), not the one stepped back to
  const lastDead = useDead(behind ? steps[last].pos : null),
    deadNow = behind ? lastDead : dead;
  const deadW = deadNow && deadNow.w,
    deadB = deadNow && deadNow.b;
  React.useEffect(() => {
    const { board: b, onChange: set } = latest.current,
      r = P.recheck(b, Date.now());
    if (r !== b) set(r);
  }, [P, live, boardKey, deadW, deadB]);
  const clockSince = G && G.clock && G.clock.since;
  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const { board: b, onChange: set } = latest.current,
        f = P.flag(b, Date.now());
      if (f !== b) set(f);
      else tick((x) => x + 1);
    }, 100);
    return () => clearInterval(id);
  }, [P, running, clockSince]);
  const now = Date.now();
  const clockOf = (side) =>
    G && G.clock ? { s: P.timeLeft(board, side, now) / 1000, active: running && gameTurn(board) === side } : null;
  // a move lands with its sound, as a line's moves do in the replay
  const stepKey = upto >= 0 ? upto + ':' + steps[upto].uci : '';
  const prevStep = React.useRef(stepKey);
  React.useEffect(() => {
    sfxPlayer.prepare(tw.soundSet);
  }, [tw.soundSet]);
  React.useEffect(() => {
    const p = prevStep.current;
    prevStep.current = stepKey;
    if (stepKey && stepKey !== p && tw.sound !== false)
      sfxPlayer.play(tw.soundSet, window.Sfx.kinds(steps[upto].san), tw.soundVolume);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a sound only when the step shown changes; the sound settings are read as they are then
  }, [stepKey]);
  // the transport bar's buttons and label, and the keys: ← → step, Home the start, End the last move, in a game in
  // progress too (Take back is a button by Resign), where only the last move takes a move
  if (nav)
    nav.current = {
      label: upto < 0 ? 'Start' : B.label(board, upto),
      color: C.last,
      hasPrev: upto >= 0,
      hasNext: upto < last,
      hasLast: upto < last,
      prev: () => go(upto - 1),
      next: () => go(upto + 1),
      last: () => go(last),
      first: () => go(-1),
    };
  if (nav) nav.current.fen = boardFen;
  // the moves to the one shown, for the Play dialogs' This position
  if (nav) nav.current.line = () => ({ fen: board.fen, moves: B.ucis(board) });
  const navSig = nav && nav.current ? `${nav.current.label}|${upto}|${last}|${live}` : '';
  React.useEffect(() => {
    if (nav && nav.listen) nav.listen();
  }, [nav, navSig]);
  // to a move (-1: the start), where there is one and it isn't the one shown: the keys and the wheel over the board
  const goIf = (to) => {
    if (to >= -1 && to <= last && to !== upto) go(to);
  };
  useKeydown((e) => {
    if (e.shiftKey || hasModifier(e)) return;
    if (e.code === 'Escape' && (input.promo || input.castle)) {
      e.preventDefault();
      input.cancelPromo();
      return;
    }
    const to = { ArrowLeft: upto - 1, ArrowRight: upto + 1, Home: -1, End: last }[e.code];
    if (to == null) return;
    e.preventDefault();
    goIf(to);
  });
  // a dead position's block, else the fifty-move rule's for the position on the board
  const rule = deadWords(dead) || fifty;
  // the result after the last move: a game's, else the last position's own end (checkmate, stalemate, a dead position)
  const end = G
    ? G.result
      ? P.ending({ r: G.result })
      : null
    : steps.length
      ? P.ending({ pos: steps[last].pos, dead: deadAt != null })
      : null;
  const N = steps.length,
    S = React.useMemo(() => ({ N, tp: Array.from({ length: N }, (_, i) => i) }), [N]);
  const named = std ? boardOpening(board, book) : null;
  const from = window.PlayCore.fromText(board);
  // the free board's Game info (a game's layout has none)
  const HM = {
    white: { name: 'White' },
    black: { name: 'Black' },
    event: 'Free board',
    site: from,
    eco: named && named.eco,
    opening: named && named.name,
  };
  return (
    <div
      className="stage-view"
      ref={flowRef}
      style={{ position: 'absolute', inset: 0, background: C.bg, ...flowStyle() }}
    >
      <BoardGroup
        overlay={
          pinMorph() && (
            <>
              <FreeBar
                pos={pos}
                side="b"
                a={1}
                clock={clockOf('b')}
                name={G ? window.PlayCore.playerName(G, 'b') : null}
                strip={L.flow.strip}
              />
              <FreeBar
                pos={pos}
                side="w"
                a={1}
                clock={clockOf('w')}
                name={G ? window.PlayCore.playerName(G, 'w') : null}
                strip={L.flow.strip}
              />
            </>
          )
        }
      >
        {!G &&
          (deadv || tbv ? (
            <EvalBarView cp={(deadv || tbv).cp} txt={(deadv || tbv).txt} a={1} />
          ) : (
            <EvalBarView cp={cp == null ? 0 : cp} txt={cp == null ? (down ? '' : '…') : fmtSf(cp)} a={1} />
          ))}
        <FreeBar pos={pos} side="b" a={1} clock={clockOf('b')} name={G ? window.PlayCore.playerName(G, 'b') : null} />
        <BoardSpace onStep={!steps.length ? null : (d) => goIf(upto + d)}>
          <LineBoard
            a={1}
            sq={boardSquares()}
            v={
              pv && pv.length
                ? {
                    upto: upto + pv.length,
                    moves: [...steps.slice(0, upto + 1), ...pv],
                    base: board.start.pos,
                    src: 'you',
                  }
                : { upto, moves: steps, base: board.start.pos, src: 'you' }
            }
            hide={input.drag && input.drag.moved ? input.drag.from : null}
            glide={!reduced}
            preview={!!(pv && pv.length)}
            arrows={
              hintMove
                ? [{ uci: had.best, k: 1 }]
                : hovArrows(!G && !(pv && pv.length) && tw.bestArrows !== false ? lineArrows(ev.after) : null, hov)
            }
            sel={input.sel}
          />
          <BoardDraw draw={draw} hidden={!!(pv && pv.length)}>
            <BoardTouch
              pos={pos}
              targets={input.targets}
              drag={input.drag}
              promo={input.promo}
              castle={input.castle}
              onCastle={input.pickCastle}
              {...(still ? stillInput : input.handlers)}
              // a piece springing back lands even if the board went still meanwhile (a step back in a game)
              onBack={input.handlers.onBack}
              keys={still ? input.stillKeys : input.keys}
            />
          </BoardDraw>
        </BoardSpace>
        <FreeBar pos={pos} side="w" a={1} clock={clockOf('w')} name={G ? window.PlayCore.playerName(G, 'w') : null} />
      </BoardGroup>
      {L.header && <Header M={HM} a={1} />}
      <MoveList
        M={MV}
        T={upto + 0.999}
        S={S}
        a={1}
        paused
        onPick={go}
        deadAt={deadAt}
        end={end}
        startAt={G && G.from}
      />
      {G ? (
        <GameInfo board={board} />
      ) : tb ? (
        <TablebaseExplorer t={tb} posKey={boardKey} onPlay={onBook} />
      ) : xl ? (
        <LichessExplorer
          x={xl}
          tw={tw}
          setTweak={setTweak}
          onGame={onLichess}
          posKey={boardKey}
          onPlay={onBook}
          onHover={setHov}
          white={pos.turn === 'w'}
          fallback={<OpeningExplorer board={board} book={book} onPlay={onBook} onHover={setHov} />}
        />
      ) : (
        <OpeningExplorer board={board} book={book} onPlay={onBook} onHover={setHov} std={std} />
      )}
      {G ? (
        <Panel box={L.analysis} part="game" a={1} style={NO_SELECT} title="Game">
          <GameStatus
            board={board}
            onChange={onChange}
            down={opponent.down}
            why={sf.why}
            retry={opponent.retry}
            tip={hintInfo}
            onMove={play}
          />
        </Panel>
      ) : (
        <AnalysisPanel box={L.analysis} a={1} paused depth={down && !sf.off ? null : searchDepth(ev.after)} deep={ev}>
          {upto < 0 ? (
            <React.Fragment>
              <StartAnalysis board={board} ev={ev} status={sfStatus} why={sf.why} onLine={onReply} onHover={setPv} />
              <CastleButtons pos={pos} onMove={play} />
              {rule && (
                <div style={{ marginTop: tx(12), paddingTop: tx(12), borderTop: `1px solid ${C.line}` }}>
                  <RuleBlock w={rule} />
                </div>
              )}
            </React.Fragment>
          ) : (
            <React.Fragment>
              <OwnMoveAnalysis
                M={MV}
                vline={{ at: 0, moves: steps, upto, src: 'you' }}
                own={own}
                status={sfStatus}
                why={sf.why}
                onReply={onReply}
                onHover={setPv}
              />
              <CastleButtons pos={pos} onMove={play} />
              {rule && (
                <div style={{ marginTop: tx(12), paddingTop: tx(12), borderTop: `1px solid ${C.line}` }}>
                  <RuleBlock w={rule} />
                </div>
              )}
            </React.Fragment>
          )}
        </AnalysisPanel>
      )}
    </div>
  );
}
