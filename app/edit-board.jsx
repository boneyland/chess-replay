// ---------- position editor ----------
// Play/Explore › Edit position…: a board to set up by hand, its rules in EditCore (app/edit-core.js). A view of its own,
// as the free board is: the board where the free board draws it, the editor in the panels' room beside it (on the
// portrait frame under it, the piece tray right under the board). GameApp holds the setup and the FEN field's text.

const TRAY = ['P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'];
const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const trayLabel = (p) => `${p === p.toUpperCase() ? 'White' : 'Black'} ${PIECE_NAME[p.toLowerCase()]}`;
const EDIT_HINT = 'Drag pieces from the tray, or tap one and then tap squares.';
const EDIT_KEYS = 'Arrows move the square; Enter places the tray piece, or picks up a piece and puts it down; Delete takes it away; K, Q, R, B, N, P place White pieces, k, q, r, b, n, p Black ones.';
const squareName = (i) => 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8));
// the text a screen reader says for the keyboard's square
const squareSay = (b, i) => `${squareName(i)}, ${b[i] ? trayLabel(b[i]).toLowerCase() : 'empty'}`;
// the text a screen reader can read without showing it
const SR_ONLY = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

function TrayPiece({ p, size, held, handlers }) {
  return (
    <button type="button" data-no-drag-scroll aria-label={trayLabel(p)} aria-pressed={held === p} {...handlers}
      onDragStart={(e) => e.preventDefault()}
      style={{ ...NO_SELECT, width: size, height: size, padding: 0, border: 'none', borderRadius: 8, cursor: 'grab', touchAction: 'none', background: held === p ? 'rgba(255,255,255,0.12)' : 'transparent', boxShadow: held === p ? `inset 0 0 0 4px ${BOARD.last}` : 'none' }}>
      <img src={img(p === p.toUpperCase() ? 'w' : 'b', p.toLowerCase())} alt="" draggable={false} style={{ width: size * 0.9, height: size * 0.9, display: 'block', margin: 'auto', pointerEvents: 'none', filter: p === p.toLowerCase() ? C.rim : 'none' }} />
    </button>
  );
}

function Tray({ size, held, trayHandlers, style }) {
  return (
    <div role="group" aria-label="Pieces" style={{ display: 'grid', gridTemplateColumns: `repeat(6, ${size}px)`, justifyContent: 'space-between', rowGap: tx(4), ...style }}>
      {TRAY.map((p) => <TrayPiece key={p} p={p} size={size} held={held} handlers={trayHandlers ? trayHandlers(p) : {}} />)}
    </div>
  );
}

// a function: C follows the theme, which can change after load
const editField = () => ({ boxSizing: 'border-box', width: '100%', font: `500 ${tx(17)}px ${MONO}`, padding: `${tx(8)}px ${tx(10)}px`, borderRadius: 6, border: `1px solid ${C.line}`, background: C.bg, color: C.ink });

function CastleBox({ setup, right, label, onChange }) {
  const E = window.EditCore, can = E.canCastle(setup, right);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: `500 ${tx(15)}px ${MONO}`, color: can ? C.ink : C.dim, cursor: can ? 'pointer' : 'default' }}>
      <input type="checkbox" aria-label={label} checked={setup.castle.includes(right)} disabled={!can} onChange={(e) => onChange(E.setCastle(setup, right, e.target.checked))}
        style={{ width: tx(18), height: tx(18), margin: 0, accentColor: C.last }} />
      {label.split(' ')[1]}
    </label>
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
  const [drag, setDrag] = React.useState(null); // { piece, from (a square, or null from the tray), x, y, x0, y0, moved }
  const boardEl = React.useRef(null), dragged = React.useRef(false);
  const at = (e) => {
    const r = boardEl.current.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * BW, y = ((e.clientY - r.top) / r.height) * BW;
    const on = x >= 0 && x < BW && y >= 0 && y < BW, [vx, vy] = on ? view(Math.floor(x / SQ), Math.floor(y / SQ)) : [0, 0];
    return { x, y, sq: on ? vy * 8 + vx : -1 };
  };
  const start = (e, piece, from) => {
    const p = at(e);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    setDrag({ piece, from, x: p.x, y: p.y, x0: p.x, y0: p.y, moved: false });
  };
  const follow = (e) => { if (!drag) return; const p = at(e); setDrag((d) => d && { ...d, x: p.x, y: p.y, moved: d.moved || Math.hypot(p.x - d.x0, p.y - d.y0) > 14 }); };
  const E = window.EditCore;
  const handlers = {
    onDown: (e) => {
      const p = at(e);
      if (p.sq < 0) return;
      if (held) { onChange(E.put(setup, p.sq, setup.b[p.sq] === held ? null : held)); return; }
      if (setup.b[p.sq]) start(e, setup.b[p.sq], p.sq);
    },
    onMove: follow,
    onUp: (e) => {
      if (!drag) return;
      const p = at(e), d = drag;
      setDrag(null);
      if (d.moved) onChange(p.sq < 0 ? E.put(setup, d.from, null) : E.move(setup, d.from, p.sq));
    },
    onCancel: () => setDrag(null),
  };
  // a tray press that doesn't move is a click (as Enter or Space on the button is): it holds the piece, or lets it go
  const trayHandlers = (piece) => ({
    onPointerDown: (e) => { dragged.current = false; start(e, piece, null); },
    onPointerMove: follow,
    onPointerUp: (e) => {
      if (!drag) return;
      const p = at(e), d = drag;
      setDrag(null);
      if (!d.moved) return;
      dragged.current = true;
      if (p.sq >= 0) onChange(E.put(setup, p.sq, piece));
    },
    onPointerCancel: () => setDrag(null),
    // picked by keyboard (a click with no pointer: detail 0), the board takes the focus to place it
    onClick: (e) => {
      if (dragged.current) { dragged.current = false; return; }
      setCarry(null);
      setHeld(held === piece ? null : piece);
      if (e.detail === 0 && held !== piece && boardEl.current) boardEl.current.focus();
    },
  });
  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (step) {
      const [x, y] = idxXY(cursor), [fx, fy] = view(Math.min(7, Math.max(0, x + step[0])), Math.min(7, Math.max(0, y + step[1])));
      setCursor(fy * 8 + fx);
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (held) onChange(E.put(setup, cursor, setup.b[cursor] === held ? null : held));
      else if (carrying != null) { onChange(E.move(setup, carrying, cursor)); setCarry(null); }
      else if (setup.b[cursor]) setCarry(cursor);
    } else if (e.key === 'Delete' || e.key === 'Backspace') { onChange(E.put(setup, cursor, null)); setCarry(null); }
    else if (e.key === 'Escape' && carrying != null) setCarry(null);
    else if (/^[pnbrqk]$/i.test(e.key)) onChange(E.put(setup, cursor, e.key));
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  return { held, drag, boardEl, handlers, trayHandlers, dropHeld: () => setHeld(null), cursor, carrying, onKeyDown };
}

function EditBoard({ setup, onChange, onDone, onCancel, fenText, onFenText, fenMsg, doneLabel = 'Done', orient, nav, overlay }) {
  const frame = useFrame();
  setLayout(frame, 'edit'); // before the children render, which read the layout
  // a paused one-column page is as tall as its panels; the stage scrolls it
  React.useLayoutEffect(() => { frame.setContentH(L.h); }, [L.h]);
  setOrient(orient);
  const E = window.EditCore, problems = E.problems(setup), empty = E.isEmpty(setup), P = L.panel;
  // the transport bar has no moves to step through; Copy FEN copies the setup's FEN
  if (nav) nav.current = { label: 'Edit position', color: C.last, hasPrev: false, hasNext: false, hasLast: false, hasFirst: false, prev: () => {}, next: () => {}, last: () => {}, first: () => {}, fen: () => E.toFen(setup) };
  React.useEffect(() => { if (nav && nav.listen) nav.listen(); }, []);
  const input = useEditInput({ setup, onChange }), { held, drag } = input;
  // Esc lets a held tray piece go, else cancels (from the FEN field too); not while it closes something over the editor
  // (overlay: Settings, a menu, Queen's panel), whose own handlers may run before or after this one
  const keyRef = React.useRef(null);
  keyRef.current = { onCancel, held, dropHeld: input.dropHeld, overlay };
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || keyRef.current.overlay || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (keyRef.current.held) keyRef.current.dropHeld(); else keyRef.current.onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const trayHandlers = input.trayHandlers, H = input.handlers;
  // the keyboard's square shows while the board has the focus from the keyboard
  const [kbFocus, setKbFocus] = React.useState(false);
  const ring = (i, color, inset) => { const [x, y] = idxXY(i); return <div style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, boxShadow: `inset 0 0 0 ${inset}px ${color}`, pointerEvents: 'none' }} />; };
  const label = (t) => <div style={{ font: `600 ${tx(13)}px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.dim, marginBottom: tx(6) }}>{t}</div>;
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.bg, overflow: 'hidden' }}>
      <BoardSpace lift={!!(drag && drag.moved)}>
      <LineBoard a={1} sq={boardSquares()} v={{ upto: -1, moves: [], base: { b: setup.b }, src: 'you' }} hide={drag && drag.moved && drag.from != null ? drag.from : null} arrows={null} />
      <div ref={input.boardEl} data-no-drag-scroll onPointerDown={H.onDown} onPointerMove={H.onMove} onPointerUp={H.onUp} onPointerCancel={H.onCancel} onDragStart={(e) => e.preventDefault()}
        tabIndex={0} role="application" aria-label={`Board${held ? `, placing ${trayLabel(held).toLowerCase()}` : ''}`} aria-describedby="edit-board-keys" onKeyDown={(e) => { input.onKeyDown(e); if (e.defaultPrevented) setKbFocus(true); }}
        onFocus={(e) => setKbFocus(e.currentTarget.matches(':focus-visible'))} onBlur={() => setKbFocus(false)}
        title={held ? 'Tap squares to place the piece' : 'Drag a piece to move it, or off the board to take it away'}
        style={{ ...NO_SELECT, position: 'absolute', left: 0, top: 0, width: BW, height: BW, cursor: held ? 'copy' : drag && drag.moved ? 'grabbing' : 'grab', touchAction: 'none', outline: 'none' }}>
        {input.carrying != null && ring(input.carrying, BOARD.last, 6)}
        {kbFocus && ring(input.cursor, C.ink, 5)}
        <span id="edit-board-keys" style={SR_ONLY}>{EDIT_KEYS}</span>
        <span aria-live="polite" style={SR_ONLY}>{kbFocus ? squareSay(setup.b, input.cursor) + (input.carrying != null ? `, carrying ${trayLabel(setup.b[input.carrying]).toLowerCase()}` : '') : ''}</span>
      </div>
      {drag && drag.moved && (
        <img src={img(drag.piece === drag.piece.toUpperCase() ? 'w' : 'b', drag.piece.toLowerCase())} alt=""
          style={{ position: 'absolute', left: drag.x - SQ * 0.55, top: drag.y - SQ * 0.55, width: SQ * 1.1, height: SQ * 1.1, pointerEvents: 'none', filter: 'drop-shadow(0 10px 12px rgba(0,0,0,0.45))', zIndex: 10 }} />
      )}
      </BoardSpace>
      {L.tray && <Tray size={Math.min(112, Math.floor((L.tray.w - 20) / 6), Math.floor((L.tray.h - 4) / 2))} held={held} trayHandlers={trayHandlers} style={{ position: 'absolute', left: L.tray.x, top: L.tray.y, width: L.tray.w }} />}
      <Panel box={P} a={1} title="Edit position">
        <div style={{ display: 'flex', flexDirection: 'column', gap: tx(16) }}>
          <div>
            <input type="text" aria-label="FEN" aria-describedby="edit-fen-msg" spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
              value={fenText} onChange={(e) => onFenText(e.target.value)} style={editField()} />
            <div id="edit-fen-msg" role="alert" style={{ font: `500 ${tx(14)}px ${MONO}`, color: C.blunder, marginTop: fenMsg ? tx(6) : 0 }}>{fenMsg}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: tx(10), flexWrap: 'wrap' }}>
            <FrameButton color={C.ink} onClick={() => onChange(E.start())}>Start</FrameButton>
            <FrameButton color={C.ink} onClick={() => onChange(E.empty())}>Empty</FrameButton>
            <select aria-label="Side to move" value={setup.turn} onChange={(e) => onChange(E.setTurn(setup, e.target.value))} style={{ ...editField(), width: 'auto', flex: 1, minWidth: tx(180) }}>
              <option value="w">White to move</option>
              <option value="b">Black to move</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: tx(40) }}>
            {[['w', 'White', 'K', 'Q'], ['b', 'Black', 'k', 'q']].map(([side, name, k, q]) => (
              <div key={side} role="group" aria-label={`${name} castling`}>
                {label(name)}
                <div style={{ display: 'flex', gap: tx(18) }}>
                  <CastleBox setup={setup} right={k} label={`${name} O-O`} onChange={onChange} />
                  <CastleBox setup={setup} right={q} label={`${name} O-O-O`} onChange={onChange} />
                </div>
              </div>
            ))}
          </div>
          {!L.tray && <Tray size={Math.min(84, Math.floor((P.w - 60) / 6))} held={held} trayHandlers={trayHandlers} style={{ borderTop: `1px solid ${C.line}`, paddingTop: tx(14) }} />}
          <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4, font: `500 ${tx(15)}px ${MONO}`, minHeight: tx(22) }}>
            {empty ? <span style={{ color: C.dim }}>{EDIT_HINT}</span> : problems.map((t) => <span key={t} style={{ color: C.blunder }}>{t}</span>)}
            {kbFocus && <span style={{ color: C.dim }}>{EDIT_KEYS}</span>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: tx(12) }}>
            <FrameButton color={C.dim} onClick={onCancel}>Cancel</FrameButton>
            <FrameButton primary color={C.last} disabled={problems.length > 0} onClick={onDone}>{doneLabel}</FrameButton>
          </div>
        </div>
      </Panel>
    </div>
  );
}
