// ---------- the dock's dialogs ----------
// The dialogs the dock opens (Import game, Play vs human and vs computer, Chess960, Leave the game, My games, Keyboard
// shortcuts) and the box they all sit in (DialogBox, used by the other views' dialogs too). GameApp owns their state.

// Import game (the dock's Import game): a tile that opens the file picker (or takes a drop: the page's own drop
// overlay shows over the dialog), one that opens Position from image, and a paste box that tells a PGN from a FEN or a
// Lichess link (ImportCore). A link is fetched here (LichessCore.fetchGame; Cancel or Esc stops it): a game opens, a
// broadcast round or study lists its games in the box's place. Ctrl+Enter (or Open) opens the text; what can't be
// opened gets a message under the box and changes nothing. auto: fetch text (a link) at once, as the explorer asks
function ImportDialog({ text: text0, auto, onChoose, onPgn, onFen, onImage, onClose }) {
  const [text, setText] = React.useState(text0 || ''),
    [msg, setMsg] = React.useState('');
  const [busy, setBusy] = React.useState(false),
    [list, setList] = React.useState(null); // list: { games, link }
  const ctl = React.useRef(null),
    body = React.useRef(null),
    shown = React.useRef(false);
  React.useEffect(() => () => ctl.current && ctl.current.abort(), []);
  // the list takes focus on its first game that can open; Back gives it back to the box
  React.useEffect(() => {
    if (!shown.current) {
      shown.current = true;
      return;
    }
    const el =
      body.current &&
      body.current
        .closest('[role="dialog"]')
        .querySelector(list ? '.import-game:not(:disabled), .import-list ~ .dlg-btns button' : 'textarea');
    if (el) el.focus();
  }, [list]);
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); // a touch screen: nothing to drag from
  const fetchLink = async (link) => {
    const c = new AbortController();
    ctl.current = c;
    setBusy(true);
    setMsg('');
    const r = await window.LichessCore.fetchGame(link, { signal: c.signal });
    if (r.aborted || ctl.current !== c) return;
    ctl.current = null;
    setBusy(false);
    if (r.error) setMsg(r.error);
    else if (r.list) setList({ games: r.list, link });
    else pick(r.pgn, link);
  };
  // a fetched game opens only once it is known to be standard chess or Chess960 and to build: else the message, the dialog kept
  const pick = (pgn, link) => {
    const c = window.ImportCore.pgn(pgn);
    if (c.error) setMsg(c.error);
    else onPgn(pgn, link);
  };
  const open = (t = text) => {
    if (busy) return;
    const r = window.ImportCore.read(t);
    if (r.error) setMsg(r.error);
    else if (r.link) fetchLink(r.link);
    else if (r.setup) onFen(r.setup, t);
    else onPgn(r.pgn, null);
  };
  React.useEffect(() => {
    if (auto) open(text0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opens what the dialog was given once, when it opens
  }, []);
  const close = () => {
    if (ctl.current) ctl.current.abort();
    onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      open();
    }
  };
  const back = () => {
    setList(null);
    setMsg('');
  };
  // a listed game opens when it has ended and is standard chess or Chess960; the others are greyed, saying why
  const can = (g) => !!g.result && !g.variant;
  const done = list && list.games.filter(can).length,
    playing = list && list.games.some((g) => !g.result),
    odd = list && list.games.some((g) => g.result && g.variant);
  const greyed =
    playing && odd
      ? 'are still being played or aren’t standard chess or Chess960'
      : playing
        ? 'are still being played'
        : 'aren’t standard chess or Chess960';
  return (
    <DialogBox label="Import game" part="import-game" className="import-box" onClose={close}>
      {list ? (
        <>
          <div ref={body} className="dlg-note">
            {done
              ? `${list.games.length} game${list.games.length === 1 ? '' : 's'}; pick one to open${done < list.games.length ? ` (the greyed ones ${greyed})` : ''}.`
              : odd
                ? `None of these games can be opened here: they ${greyed}.`
                : 'No game here has finished yet: they can be opened once they end.'}
          </div>
          <div className="import-list">
            {list.games.map((g, i) => (
              <button
                key={i}
                type="button"
                className="import-game"
                disabled={!can(g)}
                onClick={() =>
                  pick(g.pgn, { ...list.link, kind: 'game', id: list.link.id + '-' + (i + 1), side: null, ply: null })
                }
              >
                {g.board != null && <span className="import-board">{g.board}</span>}
                <span className="import-players">
                  {g.white} – {g.black}
                </span>
                <span className="import-result">{g.result ? g.variant || g.result : 'playing'}</span>
              </button>
            ))}
          </div>
          <div className="dlg-msg" role="alert">
            {msg}
          </div>
          <div className="dlg-btns">
            <button type="button" className="twk-btn secondary" onClick={back}>
              Back
            </button>
            <button type="button" className="twk-btn secondary" onClick={close}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div ref={body} className={onImage ? 'vision-tiles' : 'vision-tiles import-one'}>
            <button
              type="button"
              className="vision-tile vision-tile-drop"
              aria-label="Choose a file, or drop one here"
              onClick={onChoose}
            >
              <VisionUpIcon />
              <span>
                {coarse ? (
                  <u>Choose a file</u>
                ) : (
                  <>
                    Drop a PGN or <u>choose a file</u>
                  </>
                )}
              </span>
              <small>with this page’s analysis or notes files too, if you have them</small>
            </button>
            {onImage && (
              <button type="button" className="vision-tile" onClick={onImage}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
                  <path d="M3.5 16l5-5 4 4 2.5-2.5 5.5 5.5" />
                  <circle cx="15.5" cy="9" r="1.5" />
                </svg>
                <span>Position from image</span>
                <small>a screenshot, diagram or photo of a board</small>
              </button>
            )}
          </div>
          <textarea
            className="twk-field dlg-field pgn-field"
            aria-label="PGN, FEN or Lichess link"
            aria-describedby="import-msg"
            data-autofocus
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={'Or paste a PGN, a FEN or a Lichess link\n\n1. e4 e5 2. Nf3 Nc6 …\nhttps://lichess.org/…'}
            value={text}
            readOnly={busy}
            onKeyDown={onKey}
            onChange={(e) => {
              setText(e.target.value);
              setMsg('');
            }}
          />
          <div className="dlg-info">
            <div id="import-msg" className="dlg-msg" role="alert">
              {msg}
            </div>
            {busy ? (
              <div className="dlg-note" role="status">
                Fetching from Lichess…
              </div>
            ) : (
              !msg && (
                <div className="dlg-note">
                  A PGN opens as a loaded game (tags, comments, evals and a [FEN] start are read; the first game of
                  several), a FEN on the free board, or in Edit position when it isn’t legal. A Lichess link (a finished
                  game, a broadcast or a study) is fetched from Lichess. Ctrl+Enter opens it.
                </div>
              )
            )}
          </div>
          <div className="dlg-btns">
            <button type="button" className="twk-btn secondary" onClick={close}>
              Cancel
            </button>
            <button type="button" className="twk-btn" disabled={busy} onClick={() => open()}>
              Open
            </button>
          </div>
        </>
      )}
    </DialogBox>
  );
}

// A small dialog over a scrim: Esc or a press on the scrim closes it, Enter on `enter` runs onEnter,
// and Tab goes round its controls; keys stop here, so the board's keys never see them
// part: the dialog's name, as the class part-<part>-dialog (docs/parts.md)
function DialogBox({ label, part, className, onClose, children }) {
  const box = React.useRef(null);
  React.useEffect(() => {
    const first = box.current && box.current.querySelector('[data-autofocus]');
    if (first) first.focus();
  }, []);
  const onKey = (e, root = e.currentTarget) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // a hidden file input and disabled buttons take no focus, so they are skipped; a focusable box (the crop box) is a stop
      const stops = [...root.querySelectorAll('input, textarea, select, button, a[href], [tabindex="0"]')].filter(
          (el) => !el.disabled && el.getClientRects().length,
        ),
        i = stops.indexOf(document.activeElement);
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
      if (!el || el.contains(document.activeElement) || [...document.querySelectorAll('[role="dialog"]')].pop() !== el)
        return;
      onKeyRef.current(e, el);
    };
    window.addEventListener('keydown', away, true);
    return () => window.removeEventListener('keydown', away, true);
  }, []);
  return (
    <div
      className="dlg-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        className={['dlg-box', className, part && `part-${part}-dialog`].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKey}
        onMouseDown={(e) => {
          if (!e.target.closest('input, textarea, select, button')) e.preventDefault();
        }}
      >
        <ReturnFocus modal />
        <div className="dlg-title">{label}</div>
        {children}
      </div>
    </div>
  );
}
// a row of choices drawn as Settings' segmented control
function DialogChoice({ label, value, options, onChange }) {
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div className="play-row">
      <span className="play-label">{label}</span>
      <div className="twk-seg" role="radiogroup" aria-label={label} style={{ '--n': options.length, '--i': idx }}>
        <div className="twk-seg-thumb" />
        {options.map((o, k) => (
          <button
            key={o.label}
            type="button"
            style={{ gridColumn: k + 1 }}
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Chess960's start: Random (a position other than the standard one, 518, drawn on Start) or the position number typed,
// as { random, no: the field's text }. Settings remember it (play960Random, play960No); a viewer's stored settings may
// lack either, so pick960Of reads them leniently
const pick960Of = (t) => ({
  random: t.play960Random !== false,
  no: typeof t.play960No === 'string' ? t.play960No : '',
});
// the typed number when it is a whole number from 0 to 959, else null
const no960 = (text) => (/^\s*\d{1,3}\s*$/.test(text) && +text <= 959 ? +text : null);
// what Start opens: the number (random drawn now) and its FEN, or null while the typed number isn't one
function start960(pick) {
  const n = pick.random ? window.ChessCore.chess960Random() : no960(pick.no);
  return n == null ? null : { fen: window.ChessCore.chess960Fen(n), chess960: n };
}
// The Random box and the Position number field (disabled while Random is ticked), and under them what's wrong with the
// number, else what the choice does. Used by the Play dialogs' Start from › Chess960 and by Explore › Chess960 position.
// focus: the number field takes the dialog's first focus (when the dialog opens with Start disabled)
function Chess960Pick({ random, no, onChange, focus }) {
  const bad = !random && no960(no) == null,
    id = React.useId();
  return (
    <div className="play-row pick-960">
      <div className="pick-960-row">
        <label className="pick-960-random">
          <input type="checkbox" checked={random} onChange={(e) => onChange({ random: e.target.checked, no })} />
          Random
        </label>
        <label className="pick-960-no">
          <span>Position number</span>
          <input
            type="text"
            inputMode="numeric"
            className="twk-field dlg-field"
            placeholder="0–959"
            maxLength={4}
            spellCheck={false}
            autoComplete="off"
            disabled={random}
            value={no}
            data-autofocus={focus ? '' : undefined}
            aria-invalid={bad}
            aria-describedby={bad ? id : undefined}
            onChange={(e) => onChange({ random, no: e.target.value })}
          />
        </label>
      </div>
      {bad ? (
        <div id={id} className="dlg-msg" role="alert">
          Enter a number from 0 to 959.
        </div>
      ) : (
        <div className="dlg-note">
          {random
            ? 'A position other than the standard setup (number 518) is picked at random each time.'
            : 'Numbered as on Lichess and Wikipedia; 518 is the standard setup.'}
        </div>
      )}
    </div>
  );
}

// Menu › Explore › Chess960 position: the free board on a Chess960 position, random or by number. pick: the choice to
// open with (Settings'); onOpen({ fen, chess960, pick })
function Chess960Dialog({ pick, onOpen, onClose }) {
  const [c, setC] = React.useState(pick),
    at = !c.random && no960(c.no) == null ? null : c;
  // opened with Random off and no number: Open starts disabled, so the number field takes the focus
  const [focusNo] = React.useState(!at);
  return (
    <DialogBox label="Chess960 position" part="chess960" onClose={onClose}>
      <Chess960Pick random={c.random} no={c.no} onChange={setC} focus={focusNo} />
      <div className="dlg-note">It opens on the free board, where you play both sides.</div>
      <div className="dlg-btns">
        <button type="button" className="twk-btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="twk-btn"
          data-autofocus={focusNo ? undefined : ''}
          disabled={!at}
          onClick={() => {
            const s = start960(c);
            if (s) onOpen({ ...s, pick: c });
          }}
        >
          Open
        </button>
      </div>
    </DialogBox>
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
// pick960: Start from › Chess960's Random / number choice to open with (Settings'); that start is
// onStart({ fen, chess960, pick960, tc, you }), the number drawn or typed, and pick960 the choice to remember
function PlayDialog({
  mode = 'human',
  setUpFen,
  here,
  clock,
  side,
  initial,
  pick960,
  onStart,
  onSetUp,
  onFromImage,
  onClose,
}) {
  const sfGame = mode === 'stockfish';
  const at =
    here && (here.moves.length || (here.fen !== window.ChessCore.START_FEN && here.fen !== setUpFen)) ? here : null;
  const [from, setFrom] = React.useState(initial ? initial.from : at ? 'here' : setUpFen ? 'setup' : 'start');
  const [tc, setTc] = React.useState(
    initial ? initial.tc : window.PlayCore.TIME_CONTROLS.includes(clock) ? clock : null,
  );
  const [you, setYou] = React.useState(initial ? initial.you : ['w', 'b', 'random'].includes(side) ? side : 'w');
  const [c960, setC960] = React.useState(pick960 || { random: true, no: '' });
  const editFirst = from === 'setup' && !setUpFen,
    image = from === 'image' && !!onFromImage,
    is960 = from === '960';
  const bad960 = is960 && !c960.random && no960(c960.no) == null;
  const [focusNo] = React.useState(bad960);
  const choices = { tc, you: sfGame ? you : null };
  const start = () => {
    if (image) return onFromImage(choices);
    if (editFirst) return onSetUp(choices);
    if (is960) {
      const s = start960(c960);
      return s && onStart({ ...s, pick960: c960, ...choices });
    }
    return from === 'here' && at
      ? onStart({ here: at, ...choices })
      : onStart({ fen: from === 'setup' ? setUpFen : window.ChessCore.START_FEN, ...choices });
  };
  const froms = (at ? [{ label: 'This position', value: 'here' }] : []).concat(
    [
      { label: 'Starting position', value: 'start' },
      { label: 'Set-up position', value: 'setup' },
    ],
    onFromImage ? [{ label: 'From image', value: 'image' }] : [],
    [{ label: 'Chess960', value: '960' }],
  );
  const n = at ? at.moves.length : 0;
  return (
    <DialogBox label={sfGame ? 'Play vs computer' : 'Play vs human'} part="play" onClose={onClose}>
      <DialogChoice label="Start from" value={from} options={froms} onChange={setFrom} />
      {is960 && <Chess960Pick random={c960.random} no={c960.no} onChange={setC960} focus={focusNo} />}
      {sfGame && (
        <DialogChoice
          label="You play"
          value={you}
          options={[
            { label: 'White', value: 'w' },
            { label: 'Black', value: 'b' },
            { label: 'Random', value: 'random' },
          ]}
          onChange={setYou}
        />
      )}
      <DialogChoice
        label="Time control"
        value={tc}
        options={[{ label: 'Off', value: null }].concat(
          window.PlayCore.TIME_CONTROLS.map((x) => ({ label: x, value: x })),
        )}
        onChange={setTc}
      />
      {from === 'here' && at && (
        <div className="dlg-note play-here-note">
          {n
            ? `The game goes on from the position on the board, keeping the ${n} move${n === 1 ? '' : 's'} before it; Take back stops there.`
            : 'The game starts from the position on the board.'}
        </div>
      )}
      <div className="dlg-note">
        {sfGame
          ? `The computer, Stockfish 19 (a chess engine), plays at full strength and replies after a short pause; the board stays on your side. It says when one of your moves is an inaccuracy, a mistake or a blunder, and Hint shows its best move, ${window.PlayCore.HINTS} times a game. Take back is a button by Resign.`
          : 'Two players at this screen. The board turns after each move, so the side to move plays from the bottom; Take back is a button by Resign. Stockfish stays off until the game ends.'}
      </div>
      <div className="dlg-btns">
        <button type="button" className="twk-btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="twk-btn"
          data-autofocus={focusNo ? undefined : ''}
          disabled={bad960}
          onClick={start}
        >
          {image ? 'Choose image…' : editFirst ? 'Set up position…' : 'Start game'}
        </button>
      </div>
    </DialogBox>
  );
}

// Asks before something leaves a game in progress (it stays in My games)
function LeaveDialog({ onLeave, onStay }) {
  return (
    <DialogBox label="Leave this game?" part="leave-game" onClose={onStay}>
      <div className="dlg-note">It stays in My games, its clocks stopped until you resume it there.</div>
      <div className="dlg-btns">
        <button type="button" className="twk-btn secondary" data-autofocus onClick={onStay}>
          Keep playing
        </button>
        <button type="button" className="twk-btn" onClick={onLeave}>
          Leave the game
        </button>
      </div>
    </DialogBox>
  );
}

// My games: the kept games (GamesCore), newest first. A finished game replays as a loaded game, one in progress resumes
// on the board (the one on the board now can't be resumed or deleted); Delete asks in its row
function MyGamesDialog({ games, current, onReplay, onResume, onDelete, onClose }) {
  const P = window.PlayCore,
    G = window.GamesCore;
  const [ask, setAsk] = React.useState(null);
  // the button pressed goes when its row changes, so focus moves on, to the row's Delete after Keep or to Close after
  // Delete, and stays inside the dialog, where Esc and Tab work
  const delBtns = React.useRef({}),
    closeBtn = React.useRef(null),
    [focus, setFocus] = React.useState(null);
  React.useEffect(() => {
    if (!focus) return;
    const el = (focus.id && delBtns.current[focus.id]) || closeBtn.current;
    if (el) el.focus();
    setFocus(null);
  }, [focus]);
  const rows = React.useMemo(() => games.map((e) => ({ e, b: G.playable(e) })).filter((r) => r.b), [G, games]);
  return (
    <DialogBox label="My games" part="my-games" onClose={onClose}>
      {rows.length ? (
        <ul className="games-list">
          {rows.map(({ e, b }) => {
            const g = b.game,
              own = P.played(b),
              r = g.result && P.resultText(g.result),
              turn = gameTurn(b) === 'w' ? 'White' : 'Black';
            const head = r ? `${r.score} · ${r.why}` : `In progress · ${turn} to move`;
            const meta = [
              g.mode === 'stockfish' && `vs computer · you played ${sideName(g.you)}`,
              window.ChessCore.fmtDate(g.date),
              g.tc || 'no clock',
              `${own} move${own === 1 ? '' : 's'}`,
              window.PlayCore.fromText(b),
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={e.id} className="games-row">
                <div className="games-text">
                  <span className="games-head">{head}</span>
                  <span className="games-meta">{meta}</span>
                </div>
                {ask === e.id ? (
                  <div className="games-btns">
                    <span className="games-ask">Delete this game?</span>
                    <button
                      type="button"
                      className="twk-btn"
                      onClick={() => {
                        setAsk(null);
                        onDelete(e.id);
                        setFocus({});
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="twk-btn secondary"
                      autoFocus
                      onClick={() => {
                        setAsk(null);
                        setFocus({ id: e.id });
                      }}
                    >
                      Keep
                    </button>
                  </div>
                ) : e.id === current ? (
                  <div className="games-btns">
                    <span className="games-ask">Playing now</span>
                  </div>
                ) : (
                  <div className="games-btns">
                    <button type="button" className="twk-btn" onClick={() => (r ? onReplay(e) : onResume(e))}>
                      {r ? 'Replay' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      className="twk-btn secondary"
                      ref={(el) => {
                        delBtns.current[e.id] = el;
                      }}
                      onClick={() => setAsk(e.id)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="dlg-note">
          No games yet. A game of Play vs human or Play vs computer is kept here from its first move.
        </div>
      )}
      <div className="dlg-note">
        A finished game replays like a loaded one: analyse it with Stockfish, ask Queen, save it as a PGN or export a
        video. The 50 most recent games are kept, in this browser only.
      </div>
      <div className="dlg-btns">
        <button ref={closeBtn} type="button" className="twk-btn secondary" data-autofocus onClick={onClose}>
          Close
        </button>
      </div>
    </DialogBox>
  );
}

// Menu › Keyboard shortcuts: what the keys do, in the groups the code handles them in (Stage in engine.jsx, GameVideo and
// FreeBoard, the move list, EditBoard, the dialogs). A key listed here is a key a handler reads: change one, change the other
const SHORTCUTS = [
  {
    title: 'Replay',
    rows: [
      ['Space', 'Play or pause'],
      ['← →', 'Pause and step to the previous or next move (in a previewed line, step the line)'],
      ['End', 'Pause and jump to the last move'],
      ['Home  0', 'Back to the start'],
      ['Shift + ← →', 'Seek 1 s'],
      [',  .', 'Pause and step one frame back or forward (at the export frame rate)'],
      ['Esc', 'Leave a previewed line, or cancel a promotion'],
      ['F', 'Flip the board'],
    ],
  },
  {
    title: 'Free board and games',
    rows: [
      ['← →', 'Previous or next move'],
      ['Home  End', 'First position, last position'],
      ['Esc', 'Cancel a promotion'],
      ['F', 'Flip the board (not in a game)'],
    ],
  },
  {
    title: 'On the board',
    rows: [
      ['Tab', 'Reach the board (not while the video plays)'],
      ['Arrows', 'Move the square'],
      ['Enter  Space', 'Pick up a piece, then play it on the square you choose (the replay pauses to try it)'],
      ['Esc', 'Put the piece down'],
      ['Q R B N', 'Choose the promotion piece'],
    ],
  },
  {
    title: 'Seek bar and move list',
    rows: [
      ['← →  ↓ ↑', 'Seek bar: 1 s back or forward (Shift 5 s)'],
      ['PageUp  PageDown', 'Seek bar: 10 s'],
      ['Home  End', 'Seek bar: start, end'],
      ['← →  ↑ ↓', 'Move list: previous or next move, previous or next line'],
      ['Enter  Space', 'Move list: go to the move'],
    ],
  },
  {
    title: 'Edit position',
    rows: [
      ['Arrows', 'Move the square on the board'],
      ['Enter  Space', 'Place the tray piece, or pick up a piece and put it down'],
      ['P N B R Q K', 'Place a piece (capitals White, lower case Black)'],
      ['Delete  Backspace', 'Take the piece away'],
      ['Esc', 'Put down a held piece, then leave the editor'],
    ],
  },
  {
    title: 'Menus and dialogs',
    rows: [
      ['Esc', 'Close the menu, Settings, Ask Queen or a dialog'],
      ['Tab', 'Go round a dialog\u2019s controls'],
      ['Ctrl/Cmd + Enter', 'Import game: open the pasted text'],
      ['← → Home End', 'Settings: switch tab'],
    ],
  },
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
                  <dt>
                    {k.split('  ').map((c) => (
                      <kbd key={c}>{c}</kbd>
                    ))}
                  </dt>
                  <dd>{d}</dd>
                </React.Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="dlg-btns">
        <button type="button" className="twk-btn secondary" data-autofocus onClick={onClose}>
          Close
        </button>
      </div>
    </DialogBox>
  );
}
