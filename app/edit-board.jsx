// ---------- position editor ----------
// Play/Explore › Edit position: a board to set up by hand, its rules in EditCore (app/edit-core.js). A view of its own,
// as the free board is: the board where the free board draws it, the editor in the panels' room beside it (on the
// portrait frame under it, the piece tray right under the board). GameApp holds the setup and the FEN field's text.

const TRAY = ['P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'];
const trayLabel = pieceLabel; // PIECE_NAME, squareName, squareSay, cursorStep and SR_ONLY are game-video-core.jsx's
const EDIT_HINT = 'Drag pieces from the tray, or tap one and then tap squares.';
const EDIT_KEYS =
  'Arrows move the square; Enter places the tray piece, or picks up a piece and puts it down; Delete takes it away; K, Q, R, B, N, P place White pieces, k, q, r, b, n, p Black ones.';

function TrayPiece({ p, size, held, handlers }) {
  return (
    <button
      type="button"
      className="tray-piece"
      data-no-drag-scroll
      aria-label={trayLabel(p)}
      aria-pressed={held === p}
      {...handlers}
      onDragStart={(e) => e.preventDefault()}
      style={{
        ...NO_SELECT,
        width: size,
        height: size,
        padding: 0,
        border: 'none',
        borderRadius: 4,
        cursor: 'grab',
        touchAction: 'none',
        background: held === p ? 'rgba(255,255,255,0.12)' : 'transparent',
        boxShadow: held === p ? `inset 0 0 0 4px ${BOARD.last}` : 'none',
      }}
    >
      <img
        src={img(p === p.toUpperCase() ? 'w' : 'b', p.toLowerCase())}
        alt=""
        draggable={false}
        style={{
          width: size * 0.9,
          height: size * 0.9,
          display: 'block',
          margin: 'auto',
          pointerEvents: 'none',
          filter: p === p.toLowerCase() ? C.rim : 'none',
        }}
      />
    </button>
  );
}

function Tray({ size, held, trayHandlers, style }) {
  return (
    <div
      className="part-piece-tray"
      role="group"
      aria-label="Pieces"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(6, ${size}px)`,
        justifyContent: 'space-between',
        rowGap: tx(4),
        ...style,
      }}
    >
      {TRAY.map((p) => (
        <TrayPiece key={p} p={p} size={size} held={held} handlers={trayHandlers ? trayHandlers(p) : {}} />
      ))}
    </div>
  );
}

// a function: C follows the theme, which can change after load
const editField = () => ({
  boxSizing: 'border-box',
  width: '100%',
  font: `500 ${tx(17)}px ${MONO}`,
  padding: `${tx(8)}px ${tx(10)}px`,
  borderRadius: 3,
  border: `1px solid ${C.line}`,
  background: C.bg,
  color: C.ink,
});

function CastleBox({ setup, right, label, onChange }) {
  const E = window.EditCore,
    can = E.canCastle(setup, right);
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        whiteSpace: 'nowrap',
        font: `500 ${tx(15)}px ${MONO}`,
        color: can ? C.ink : C.dim,
        cursor: can ? 'pointer' : 'default',
      }}
    >
      <input
        type="checkbox"
        aria-label={label}
        checked={setup.castle.includes(right)}
        disabled={!can}
        onChange={(e) => onChange(E.setCastle(setup, right, e.target.checked))}
        style={{ width: tx(18), height: tx(18), margin: 0, accentColor: C.last }}
      />
      {label.split(' ')[1]}
    </label>
  );
}

// A FEN counter (half-move clock, move number) typed as text. The field shows what's typed (text; null for the setup's
// value), and the setup takes it once it is a whole number in range (EditCore.count); text it can't take is outlined
// in red, the setup (and so the FEN field and Done) keeping the old value, and EditBoard says so under the row
function CountField({ value, label, min, text, onText, msgId, set, setup, onChange }) {
  const bad = text != null && window.EditCore.count(text, min) == null;
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      aria-invalid={bad}
      aria-describedby={bad ? msgId : undefined}
      spellCheck={false}
      autoComplete="off"
      value={text == null ? String(value) : text}
      onBlur={() => onText(null)}
      onChange={(e) => {
        onText(e.target.value);
        const next = set(setup, e.target.value);
        if (next !== setup) onChange(next);
      }}
      style={{
        ...editField(),
        width: tx(96),
        // the whole shorthand, not borderColor: React re-applies editField's border when the theme changes it, which
        // would reset a borderColor it sees as unchanged
        ...(bad && { border: `1px solid ${C.blunder}`, boxShadow: `inset 0 0 0 1px ${C.blunder}` }),
      }}
    />
  );
}

// Editing by pointer: a tray piece dragged onto a square, or tapped (held) and then squares tapped to drop copies (a tap
// on the same piece takes it off); a piece on the board dragged to another square, or off the board to take it away.
// Pointer positions are board pixels, not clamped to the board: past its edge is off it. view() turns them into squares.
// By keyboard (the board focused): the arrows move a square around it, Enter or Space places the held tray piece there (on
// the same piece takes it off), else picks up the piece there and puts it down on the next square Enter is pressed on,
// Delete or Backspace takes the piece away, and a piece letter (K, q…) places that piece
function useEditInput({ setup, onChange }) {
  const [held, setHeld] = React.useState(null); // the tray piece placed by taps ('R', 'p'…)
  const [cursor, setCursor] = React.useState(36); // the keyboard's square (a board index), e4 to begin with
  const [carry, setCarry] = React.useState(null); // the square of the piece picked up by keyboard, to put down
  const carrying = carry != null && setup.b[carry] ? carry : null; // (gone if the piece was moved some other way)
  // { piece, from (a square, or null from the tray), x, y, x0, y0, ox, oy (grabOffset), moved, id (the pointer dragging
  // it: another finger's moves and lifts are not this drag's, nor does a second finger's press take it over) }
  const [drag, setDrag] = React.useState(null);
  const boardEl = React.useRef(null),
    dragged = React.useRef(false);
  const at = (e) => boardPoint(boardEl.current, e, false); // off the board is sq -1
  const start = (e, piece, from) => {
    const p = at(e);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}
    // a piece picked up from the board is held where it was grabbed; one from the tray by its centre
    setDrag({
      piece,
      from,
      x: p.x,
      y: p.y,
      x0: p.x,
      y0: p.y,
      ...(from != null ? grabOffset(from, p) : null),
      moved: false,
      id: e.pointerId,
    });
  };
  const ours = (e) => drag && e.pointerId === drag.id;
  const moved = dragMoved;
  const follow = (e) => {
    if (!ours(e)) return;
    const p = at(e);
    setDrag((d) => d && { ...d, x: p.x, y: p.y, moved: moved(d, p) });
  };
  const E = window.EditCore;
  const handlers = {
    onDown: (e) => {
      if (drag && e.pointerId !== drag.id) return; // a second finger doesn't take over the drag
      const p = at(e);
      if (p.sq < 0) return;
      if (held) {
        onChange(E.put(setup, p.sq, setup.b[p.sq] === held ? null : held));
        return;
      }
      if (setup.b[p.sq]) start(e, setup.b[p.sq], p.sq);
    },
    onMove: follow,
    onUp: (e) => {
      if (!ours(e)) return;
      const d = drag,
        p = liftPoint(e, d, at, false);
      setDrag(null);
      const to = dropSquare(d, p, false);
      if (moved(d, p)) onChange(to < 0 ? E.put(setup, d.from, null) : E.move(setup, d.from, to));
    },
    onCancel: (e) => setDrag((d) => (d && e.pointerId === d.id ? null : d)),
  };
  // a tray press that doesn't move is a click (as Enter or Space on the button is): it holds the piece, or lets it go
  const trayHandlers = (piece) => ({
    onPointerDown: (e) => {
      if (drag && e.pointerId !== drag.id) return;
      dragged.current = false;
      start(e, piece, null);
    },
    onPointerMove: follow,
    onPointerUp: (e) => {
      if (!ours(e)) return;
      const d = drag,
        p = liftPoint(e, d, at, false);
      setDrag(null);
      if (!moved(d, p)) return;
      dragged.current = true;
      if (p.sq >= 0) onChange(E.put(setup, p.sq, piece));
    },
    onPointerCancel: (e) => setDrag((d) => (d && e.pointerId === d.id ? null : d)),
    // picked by keyboard (a click with no pointer: detail 0), the board takes the focus to place it
    onClick: (e) => {
      if (dragged.current) {
        dragged.current = false;
        return;
      }
      setCarry(null);
      setHeld(held === piece ? null : piece);
      if (e.detail === 0 && held !== piece && boardEl.current) boardEl.current.focus();
    },
  });
  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const to = cursorStep(cursor, e.key);
    if (to != null) setCursor(to);
    else if (e.key === 'Enter' || e.key === ' ') {
      if (held) onChange(E.put(setup, cursor, setup.b[cursor] === held ? null : held));
      else if (carrying != null) {
        onChange(E.move(setup, carrying, cursor));
        setCarry(null);
      } else if (setup.b[cursor]) setCarry(cursor);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      onChange(E.put(setup, cursor, null));
      setCarry(null);
    } else if (e.key === 'Escape' && carrying != null) setCarry(null);
    else if (/^[pnbrqk]$/i.test(e.key)) onChange(E.put(setup, cursor, e.key));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return { held, drag, boardEl, handlers, trayHandlers, dropHeld: () => setHeld(null), cursor, carrying, onKeyDown };
}

// The button that lays the picture over the board for as long as it is held (pointer down, or Space with it focused)
function HoldButton({ onHold }) {
  const on = () => onHold(true),
    off = () => onHold(false);
  // unmounted while held (the layout going to two columns), it lets go, or the picture would cover the board when it's back
  React.useEffect(() => () => onHold(false), [onHold]);
  return (
    <button
      type="button"
      className="frame-btn"
      onPointerDown={(e) => {
        e.stopPropagation();
        on();
      }}
      onPointerUp={off}
      onPointerCancel={off}
      onPointerLeave={off}
      onBlur={off}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault();
          on();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ') off();
      }}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        ...NO_SELECT,
        alignSelf: 'flex-start',
        touchAction: 'none',
        whiteSpace: 'nowrap',
        font: `600 ${tx(15)}px ${MONO}`,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: `${tx(5)}px ${tx(12)}px`,
        borderRadius: 4,
        cursor: 'pointer',
        border: `1.5px solid ${C.ink}`,
        background: 'transparent',
        color: C.ink,
      }}
    >
      Hold to show picture
    </button>
  );
}

// Edit position opened from a picture (image = { url, unsure }): the picture, the squares the reader was unsure of
// (outlined; GameApp drops one once it is edited) and the buttons to turn the board round or go back to the crop
function EditBoard({
  setup,
  onChange,
  onDone,
  onCancel,
  fenText,
  onFenText,
  fenMsg,
  doneLabel = 'Done',
  orient,
  nav,
  overlay,
  image,
  onTurn,
  onBackToCrop,
}) {
  const frame = useFrame();
  setLayout(frame, 'edit'); // before the children render, which read the layout
  // a paused one-column page is as tall as its panels; the stage scrolls it
  const flowRef = React.useRef(null);
  useFlowHeight(frame, flowRef);
  setOrient(orient);
  const E = window.EditCore,
    problems = E.problems(setup),
    empty = E.isEmpty(setup),
    P = L.panel,
    epList = E.epSquares(setup);
  // the transport bar has no moves to step through; Copy FEN copies the setup's FEN
  if (nav)
    nav.current = {
      label: 'Edit position',
      color: C.last,
      hasPrev: false,
      hasNext: false,
      hasLast: false,
      hasFirst: false,
      prev: () => {},
      next: () => {},
      last: () => {},
      first: () => {},
      fen: () => E.toFen(setup),
    };
  React.useEffect(() => {
    if (nav && nav.listen) nav.listen();
  }, [nav]);
  const input = useEditInput({ setup, onChange }),
    { held, drag } = input;
  // Esc lets a held tray piece go, else cancels (from the FEN field too); not while something is open over the editor
  // (overlay: Settings, a menu, Queen's panel, whose Esc claims the key first; or a dialog)
  useKeydown(
    (e) => {
      if (e.key !== 'Escape' || overlay || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (held) input.dropHeld();
      else onCancel();
    },
    { fields: true },
  );
  const trayHandlers = input.trayHandlers,
    H = input.handlers;
  // the keyboard's square shows while the board has the focus from the keyboard
  const kf = useKbFocus(),
    kbFocus = kf.kb;
  const ring = (i, color, inset) => {
    const [x, y] = idxXY(i);
    return (
      <div
        style={{
          position: 'absolute',
          left: x * SQ,
          top: y * SQ,
          width: SQ,
          height: SQ,
          boxShadow: `inset 0 0 0 ${inset}px ${color}`,
          pointerEvents: 'none',
        }}
      />
    );
  };
  // the counters' typed text (null: the setup's value shows), cleared when the field is left; a value changed from
  // elsewhere (Start, Back to crop, the en passant choice) replaces text that doesn't stand for it
  const [typed, setTyped] = React.useState({ half: null, full: null });
  const typedFor = (k) => (t) => setTyped((d) => ({ ...d, [k]: t }));
  React.useEffect(() => {
    setTyped((d) => {
      const keep = (k, min, v) => (d[k] != null && E.count(d[k], min) !== v ? null : d[k]);
      const n = { half: keep('half', 0, setup.half), full: keep('full', 1, setup.full) };
      return n.half === d.half && n.full === d.full ? d : n;
    });
  }, [E, setup.half, setup.full]);
  const badCount = [
    ['half', 0, 'the clock'],
    ['full', 1, 'the move'],
  ].find(([k, min]) => typed[k] != null && E.count(typed[k], min) == null);
  const [showPic, setShowPic] = React.useState(false);
  const unsure = image ? image.unsure || [] : [];
  const oneCol = !!L.tray; // the tray under the board is the portrait frame's layout
  const phone = L.tier === 'phone' && !oneCol; // a phone held sideways: the tray's pieces no bigger than the board's, the buttons compact
  const pic = (style) => (
    <img
      src={image.url}
      alt="The picture read"
      draggable={false}
      style={{ objectFit: 'contain', display: 'block', ...style }}
    />
  );
  // beside the board, the picture's box is reserved before it decodes (no jump) and is what gives way when the panel's
  // contents outgrow it (the unsure line, problems, a FEN message), so Cancel and Done stay in the panel
  const side = image && !oneCol ? Math.round(P.h * 0.35) : 0,
    fill = side ? { display: 'flex', flexDirection: 'column' } : null;
  // a span, not a div: it also heads the fields inside a <label>, which may hold only phrasing content
  const label = (t) => (
    <span
      style={{
        display: 'block',
        font: `600 ${tx(14)}px ${MONO}`,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: C.dim,
        marginBottom: tx(6),
      }}
    >
      {t}
    </span>
  );
  return (
    <div
      className="stage-view"
      ref={flowRef}
      style={{ position: 'absolute', inset: 0, background: C.bg, ...flowStyle() }}
    >
      <BoardSpace>
        <LineBoard
          a={1}
          sq={boardSquares()}
          v={{ upto: -1, moves: [], base: { b: setup.b }, src: 'you' }}
          hide={drag && drag.moved && drag.from != null ? drag.from : null}
          arrows={null}
        />
        <div
          ref={input.boardEl}
          data-no-drag-scroll
          onPointerDown={(e) => {
            kf.press();
            H.onDown(e);
          }}
          onPointerMove={H.onMove}
          onPointerUp={(e) => {
            kf.press();
            H.onUp(e);
          }}
          onPointerCancel={(e) => {
            kf.press();
            H.onCancel(e);
          }}
          onDragStart={(e) => e.preventDefault()}
          tabIndex={0}
          role="application"
          aria-label={`Board${held ? `, placing ${trayLabel(held).toLowerCase()}` : ''}`}
          aria-describedby="edit-board-keys"
          onKeyDown={(e) => {
            input.onKeyDown(e);
            if (e.defaultPrevented) kf.setKb(true);
          }}
          onFocus={kf.focus}
          onBlur={kf.blur}
          title={held ? 'Tap squares to place the piece' : 'Drag a piece to move it, or off the board to take it away'}
          style={{
            ...NO_SELECT,
            position: 'absolute',
            left: 0,
            top: 0,
            width: BW,
            height: BW,
            cursor: held ? 'copy' : drag && drag.moved ? 'grabbing' : 'grab',
            touchAction: 'none',
            outline: 'none',
          }}
        >
          {unsure.map((i) => (
            <React.Fragment key={i}>{ring(i, C.blunder, 3)}</React.Fragment>
          ))}
          {input.carrying != null && ring(input.carrying, BOARD.last, 6)}
          {kbFocus && ring(input.cursor, C.ink, 5)}
          <span id="edit-board-keys" style={SR_ONLY}>
            {EDIT_KEYS}
          </span>
          <span aria-live="polite" style={SR_ONLY}>
            {kbFocus
              ? squareSay(setup.b, input.cursor) +
                (input.carrying != null ? `, carrying ${trayLabel(setup.b[input.carrying]).toLowerCase()}` : '')
              : ''}
          </span>
        </div>
        {drag && drag.moved && (
          <DragGhost el={input.boardEl.current} piece={drag.piece} x={drag.x} y={drag.y} ox={drag.ox} oy={drag.oy} />
        )}
        {image && oneCol && showPic && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: BW,
              height: BW,
              background: C.bg,
              pointerEvents: 'none',
            }}
          >
            {pic({ width: '100%', height: '100%' })}
          </div>
        )}
      </BoardSpace>
      {L.tray && (
        <Tray
          size={Math.min(112, Math.floor((L.tray.w - 20) / 6), Math.floor((L.tray.h - 4) / 2))}
          held={held}
          trayHandlers={trayHandlers}
          style={
            L.tray.flow
              ? { order: L.tray.order, flex: 'none', height: L.tray.h }
              : { position: 'absolute', left: L.tray.x, top: L.tray.y, width: L.tray.w }
          }
        />
      )}
      <Panel box={P} part="edit-position" a={1} title="Edit position" style={fill}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: tx(16),
            ...(side && { flex: '1 1 auto', minHeight: 0 }),
          }}
        >
          {side > 0 && (
            <div style={{ position: 'relative', flex: '0 1 auto', height: side, minHeight: Math.min(side, tx(96)) }}>
              {pic({ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' })}
            </div>
          )}
          {image && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: tx(8) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: tx(10), flexWrap: 'wrap' }}>
                {oneCol && <HoldButton onHold={setShowPic} />}
                <FrameButton color={C.ink} onClick={() => onTurn && onTurn()}>
                  Turn board 180°
                </FrameButton>
                <FrameButton className="edit-back-to-crop" color={C.ink} onClick={() => onBackToCrop && onBackToCrop()}>
                  Back to crop
                </FrameButton>
              </div>
              {unsure.length > 0 && (
                <div style={{ font: `500 ${tx(15)}px ${MONO}`, color: C.blunder }}>
                  {unsure.length === 1
                    ? '1 square to check (outlined)'
                    : `${unsure.length} squares to check (outlined)`}
                </div>
              )}
            </div>
          )}
          <div>
            <input
              type="text"
              aria-label="FEN"
              aria-describedby="edit-dlg-msg"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              value={fenText}
              onChange={(e) => onFenText(e.target.value)}
              style={editField()}
            />
            <div
              id="edit-dlg-msg"
              role="alert"
              style={{ font: `500 ${tx(14)}px ${MONO}`, color: C.blunder, marginTop: fenMsg ? tx(6) : 0 }}
            >
              {fenMsg}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: tx(10), flexWrap: 'wrap' }}>
            <FrameButton color={C.ink} onClick={() => onChange(E.start())}>
              Start
            </FrameButton>
            <FrameButton color={C.ink} onClick={() => onChange(E.empty())}>
              Empty
            </FrameButton>
            <select
              className="frame-select"
              aria-label="Side to move"
              value={setup.turn}
              onChange={(e) => onChange(E.setTurn(setup, e.target.value))}
              style={{ ...editField(), width: 'auto', flex: 1, minWidth: tx(180) }}
            >
              <option value="w">White to move</option>
              <option value="b">Black to move</option>
            </select>
          </div>
          {/* a narrow panel puts Black's boxes under White's */}
          <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: tx(40), rowGap: tx(10) }}>
            {[
              ['w', 'White', 'K', 'Q'],
              ['b', 'Black', 'k', 'q'],
            ].map(([side, name, k, q]) => (
              <div key={side} role="group" aria-label={`${name} castling`}>
                {label(name)}
                <div style={{ display: 'flex', gap: tx(18) }}>
                  <CastleBox setup={setup} right={k} label={`${name} O-O`} onChange={onChange} />
                  <CastleBox setup={setup} right={q} label={`${name} O-O-O`} onChange={onChange} />
                </div>
              </div>
            ))}
          </div>
          {/* the FEN's last three fields: the en passant square (only those the pieces allow), the half-move clock, the move number */}
          <div
            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: tx(24), rowGap: tx(10) }}
          >
            <label style={{ display: 'block' }}>
              {label('En passant')}
              <select
                className="frame-select"
                aria-label="En passant square"
                value={setup.ep}
                disabled={!epList.length}
                onChange={(e) => onChange(E.setEp(setup, +e.target.value))}
                title={
                  epList.length
                    ? 'Setting a square sets the half-move clock to 0'
                    : 'No pawn of the other side could just have moved two'
                }
                style={{ ...editField(), width: 'auto', minWidth: tx(110), color: epList.length ? C.ink : C.dim }}
              >
                <option value={-1}>None</option>
                {epList.map((i) => (
                  <option key={i} value={i}>
                    {squareName(i)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              {label('Half-moves')}
              <CountField
                value={setup.half}
                label="Half-move clock"
                min={0}
                text={typed.half}
                onText={typedFor('half')}
                msgId="edit-count-msg"
                set={E.setHalf}
                setup={setup}
                onChange={onChange}
              />
            </label>
            <label style={{ display: 'block' }}>
              {label('Move')}
              <CountField
                value={setup.full}
                label="Move number"
                min={1}
                text={typed.full}
                onText={typedFor('full')}
                msgId="edit-count-msg"
                set={E.setFull}
                setup={setup}
                onChange={onChange}
              />
            </label>
          </div>
          {badCount && (
            <div
              id="edit-count-msg"
              role="alert"
              style={{ marginTop: tx(-6), font: `500 ${tx(14)}px ${MONO}`, color: C.blunder }}
            >
              {`Type a whole number from ${badCount[1]} to ${E.MAX_COUNT}: ${badCount[2]} stays ${setup[badCount[0]]} until then.`}
            </div>
          )}
          {!L.tray && (
            <Tray
              size={Math.min(84, Math.floor((P.w - 60) / 6), phone ? Math.floor(L.board.size / 8) : Infinity)}
              held={held}
              trayHandlers={trayHandlers}
              style={{ borderTop: `1px solid ${C.line}`, paddingTop: tx(14) }}
            />
          )}
          <div
            role="status"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              font: `500 ${tx(15)}px ${MONO}`,
              minHeight: tx(22),
            }}
          >
            {empty ? (
              <span style={{ color: C.dim }}>{EDIT_HINT}</span>
            ) : (
              problems.map((t) => (
                <span key={t} style={{ color: C.blunder }}>
                  {t}
                </span>
              ))
            )}
            {kbFocus && <span style={{ color: C.dim }}>{EDIT_KEYS}</span>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: tx(12) }}>
            <FrameButton compact={phone} color={C.dim} onClick={onCancel}>
              Cancel
            </FrameButton>
            <FrameButton compact={phone} primary color={C.last} disabled={problems.length > 0} onClick={onDone}>
              {doneLabel}
            </FrameButton>
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ---------- Edit position and Position from image: the flow between them ----------
// GameApp's state for the editor (editing) and the picture's dialog (vision), and the steps between them, the Play
// dialog and Import game: which one opens what, and what Cancel goes back to. The editor shows in place of the board or
// the loaded game while editing is set; GameApp's commit clears it.
// boardRef, nav, commitBoard, focusBack: GameApp's; closeQueen, openImport(text), reopenPlay(mode, init) and
// startGame(mode, choice) do those steps in GameApp
function useEditorFlow({ boardRef, nav, commitBoard, focusBack, closeQueen, openImport, reopenPlay, startGame }) {
  // Edit position: { setup, text, msg, resume, play, image } while the editor shows in place of the board or the loaded
  // game; text is the FEN field's, msg why it doesn't parse, resume the paused game in progress left to open it (Cancel
  // goes back to it), image the picture it was read from ({ url, unsure, bitmap, box }, or null)
  const [editing, setEditing] = React.useState(null);
  // Position from image's dialog while it is open: { play, again, back }, play the Play dialog's choices it came from (or null),
  // again the picture, box, greyscale copy and found squares for Back to crop (or null), back true when Import game opened it
  const [vision, setVision] = React.useState(null);
  // the editor opens on the position on the board (empty when there is none); a game in progress is paused for it (and
  // kept, when it has moves, by guard's Leave). play: the Play dialog's { mode, tc, you } when its Set-up position opened
  // the editor, whose Done starts that game
  // read: Position from image's { setup, image }, the editor opening on it with the picture, or Import game's
  // { setup, image: null, back }, an illegal pasted FEN, back the paste box's text for Cancel to restore
  const openEditor = (play, read) => {
    // the board as it is now: Stockfish may have replied, or a flag fallen, while the Leave dialog was up
    const E = window.EditCore,
      P = window.PlayCore,
      b = boardRef.current,
      fen = nav.current && nav.current.fen && nav.current.fen();
    const s = (fen && E.fromFen(fen).setup) || E.empty();
    const resume = editing ? editing.resume : b && P.inProgress(b) ? P.pause(b, Date.now()) : null;
    if (resume && !editing) commitBoard(resume);
    const setup = read ? read.setup : s;
    closeQueen();
    setEditing({
      setup,
      text: E.toFen(setup),
      msg: '',
      resume,
      play: play || null,
      image: read ? read.image : null,
      back: read && read.back != null ? read.back : null,
    });
  };
  // a square the reader was unsure of stops being outlined once its piece changes, however it was edited
  const sureOf = (e, setup) => {
    const im = e.image;
    if (!im || !im.unsure.some((i) => e.setup.b[i] !== setup.b[i])) return im;
    return { ...im, unsure: im.unsure.filter((i) => e.setup.b[i] === setup.b[i]) };
  };
  const editTo = (setup) =>
    setEditing((e) => e && { ...e, setup, text: window.EditCore.toFen(setup), msg: '', image: sureOf(e, setup) });
  // a typed FEN sets up the board as soon as it is well-formed, legal or not; until then the board stays as it was
  const editText = (text) =>
    setEditing((e) => {
      if (!e) return e;
      const r = window.EditCore.fromFen(text);
      return r.setup
        ? { ...e, setup: r.setup, text, msg: '', image: sureOf(e, r.setup) }
        : { ...e, text, msg: r.error };
    });
  // Turn board 180° turns the board as it stands, edits included, and the outlines still showing with it
  const editTurn = () =>
    setEditing((e) => {
      if (!e) return e;
      const V = window.VisionCore,
        setup = V.turn(e.setup);
      return {
        ...e,
        setup,
        text: window.EditCore.toFen(setup),
        msg: '',
        image: e.image && { ...e.image, unsure: V.turnSquares(e.image.unsure) },
      };
    });
  const backToCrop = () => {
    if (editing && editing.image) {
      const { bitmap, box, grey, found } = editing.image;
      setVision({ play: editing.play, again: { bitmap, box, grey, found } });
    }
  };
  // The picture's object URL and bitmap are GameApp's while the editor shows it: one the editor no longer holds (Done,
  // Cancel, a new editor, another read) is let go here, whichever way it went, but never one the next state still holds
  // (Back to crop's read may keep the bitmap and replace the URL)
  const heldPic = React.useRef(null),
    editPic = editing && editing.image;
  React.useEffect(() => {
    const was = heldPic.current;
    heldPic.current = editPic || null;
    if (!was) return;
    if (!editPic || editPic.url !== was.url) URL.revokeObjectURL(was.url);
    if (!editPic || editPic.bitmap !== was.bitmap) was.bitmap.close();
  }, [editPic]);
  // Import game's Position from image tile, where the reader can run
  const visionOk = React.useMemo(() => !!window.Vision && window.Vision.supported(), []);
  // Read board: from Back to crop it replaces the editor's board, edits and marks with the new read; else the editor opens
  // on it (in the Play dialog's mode when that is where it came from, so Done starts the game)
  const visionRead = ({ setup, unsure, url, bitmap, box, grey, found }) => {
    const v = vision,
      image = { url, unsure, bitmap, box, grey, found };
    setVision(null);
    if (v && v.again && editing)
      setEditing((e) => e && { ...e, setup, text: window.EditCore.toFen(setup), msg: '', image });
    else openEditor(v && v.play, { setup, image });
  };
  // Cancel goes back to what showed before: the editor as it was (Back to crop), else the Play dialog as it was, or Import game
  const visionClose = () => {
    const v = vision;
    setVision(null);
    if (v && v.again) focusBack.current = '.edit-back-to-crop'; // Back to crop › Cancel: back on the button that opened it
    if (v && v.back) openImport('');
    if (v && !v.again && v.play) reopenPlay(v.play.mode, { from: 'image', tc: v.play.tc, you: v.play.you });
  };
  const editDone = () => {
    const fen = window.EditCore.toFen(editing.setup),
      play = editing.play,
      chess960 = window.EditCore.number960(editing.setup);
    if (play) startGame(play.mode, { fen, chess960, tc: play.tc, you: play.you });
    else {
      commitBoard(window.BoardCore.fromFen(fen, { chess960 }));
    }
  };
  // Cancel goes back to what showed before: a game left for the editor resumes, its clock running from now, and the Play
  // dialog or Import game that opened it comes back as it was
  const editCancel = () => {
    const { resume: r, play, image, back } = editing || {};
    setEditing(null);
    if (back != null) openImport(back);
    if (r) commitBoard(window.PlayCore.runClock(r, Date.now()));
    if (play) reopenPlay(play.mode, { from: image ? 'image' : 'setup', tc: play.tc, you: play.you });
  };
  return {
    editing,
    setEditing,
    vision,
    setVision,
    visionOk,
    openEditor,
    editTo,
    editText,
    editTurn,
    backToCrop,
    visionRead,
    visionClose,
    editDone,
    editCancel,
  };
}
