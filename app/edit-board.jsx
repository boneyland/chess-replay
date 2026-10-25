// ---------- position editor ----------
// Play/Explore › Edit position…: a board to set up by hand, its rules in EditCore (app/edit-core.js). A view of its own,
// as the free board is: the board where the free board draws it, the editor in the panels' room beside it (on the
// portrait frame under it, the piece tray right under the board). GameApp holds the setup and the FEN field's text.

const TRAY = ['P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'];
const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const trayLabel = (p) => `${p === p.toUpperCase() ? 'White' : 'Black'} ${PIECE_NAME[p.toLowerCase()]}`;
const EDIT_HINT = 'Drag pieces from the tray, or tap one and then tap squares.';

// Where the editor goes: the room the panels take beside the board, or on the portrait frame (nothing beside the
// board) the room under it, the tray first. The board is centred there, as in a game, as no eval bar stands beside it
const EDIT_LAYOUTS = new WeakMap();
function editLayout(base) {
  if (!EDIT_LAYOUTS.has(base)) {
    const boxes = [base.header, base.moves, base.comment, base.analysis].filter(Boolean);
    const union = (bs) => { const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y)); return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y }; };
    const beside = boxes.filter((b) => b.x >= base.bx + BW);
    if (beside.length) EDIT_LAYOUTS.set(base, { ...base, panel: { ...union(beside), k: beside[0].k, scroll: true }, tray: null });
    else {
      const bx = (PORTRAIT.width - BW) / 2, ty = base.by + BW + 14, th = 2 * 112, below = union(boxes);
      EDIT_LAYOUTS.set(base, { ...base, bx, tray: { x: bx, y: ty, w: BW, h: th }, panel: { x: below.x, y: ty + th + 14, w: below.w, h: below.y + below.h - (ty + th + 14), k: 1.5, scroll: true } });
    }
  }
  return EDIT_LAYOUTS.get(base);
}

function TrayPiece({ p, size, held, handlers }) {
  return (
    <button type="button" aria-label={trayLabel(p)} aria-pressed={held === p} {...handlers}
      onDragStart={(e) => e.preventDefault()}
      style={{ ...NO_SELECT, width: size, height: size, padding: 0, border: 'none', borderRadius: 8, cursor: 'grab', touchAction: 'none', background: held === p ? 'rgba(255,255,255,0.12)' : 'transparent', boxShadow: held === p ? `inset 0 0 0 4px ${BOARD.last}` : 'none' }}>
      <img src={img(p === p.toUpperCase() ? 'w' : 'b', p.toLowerCase())} alt="" draggable={false} style={{ width: size * 0.9, height: size * 0.9, display: 'block', margin: 'auto', pointerEvents: 'none', filter: p === p.toLowerCase() ? C.rim : 'none' }} />
    </button>
  );
}

function Tray({ size, held, trayHandlers, style }) {
  return (
    <div role="group" aria-label="Pieces" style={{ display: 'grid', gridTemplateColumns: `repeat(6, ${size}px)`, justifyContent: 'space-between', rowGap: 4, ...style }}>
      {TRAY.map((p) => <TrayPiece key={p} p={p} size={size} held={held} handlers={trayHandlers ? trayHandlers(p) : {}} />)}
    </div>
  );
}

// a function: C follows the theme, which can change after load
const editField = () => ({ boxSizing: 'border-box', width: '100%', font: `500 17px ${MONO}`, padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.line}`, background: C.bg, color: C.ink });

function CastleBox({ setup, right, label, onChange }) {
  const E = window.EditCore, can = E.canCastle(setup, right);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: `500 ${sm(15)}px ${MONO}`, color: can ? C.ink : C.dim, cursor: can ? 'pointer' : 'default' }}>
      <input type="checkbox" aria-label={label} checked={setup.castle.includes(right)} disabled={!can} onChange={(e) => onChange(E.setCastle(setup, right, e.target.checked))}
        style={{ width: 18, height: 18, margin: 0, accentColor: C.last }} />
      {label.split(' ')[1]}
    </label>
  );
}

// Editing by pointer: a tray piece dragged onto a square, or tapped (held) and then squares tapped to drop copies (a tap
// on the same piece takes it off); a piece on the board dragged to another square, or off the board to take it away.
// Pointer positions are board pixels, not clamped to the board: past its edge is off it. view() turns them into squares
function useEditInput({ setup, onChange }) {
  const [held, setHeld] = React.useState(null); // the tray piece placed by taps ('R', 'p'…)
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
    onClick: () => { if (dragged.current) { dragged.current = false; return; } setHeld((h) => (h === piece ? null : piece)); },
  });
  return { held, drag, boardEl, handlers, trayHandlers, dropHeld: () => setHeld(null) };
}

function EditBoard({ setup, onChange, onDone, onCancel, fenText, onFenText, fenMsg, doneLabel = 'Done', orient, nav, overlay }) {
  setLayout(useFrame()); // before the children render, which read the layout
  L = editLayout(boardLayout(L)); BX = L.bx; BY = L.by;
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
  const label = (t) => <div style={{ font: `600 ${sm(13)}px ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.dim, marginBottom: 6 }}>{t}</div>;
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.bg, overflow: 'hidden' }}>
      <LineBoard a={1} sq={boardSquares()} v={{ upto: -1, moves: [], base: { b: setup.b }, src: 'you' }} hide={drag && drag.moved && drag.from != null ? drag.from : null} arrows={null} />
      <div ref={input.boardEl} onPointerDown={H.onDown} onPointerMove={H.onMove} onPointerUp={H.onUp} onPointerCancel={H.onCancel} onDragStart={(e) => e.preventDefault()}
        title={held ? 'Tap squares to place the piece' : 'Drag a piece to move it, or off the board to take it away'}
        style={{ ...NO_SELECT, position: 'absolute', left: BX, top: BY, width: BW, height: BW, cursor: held ? 'copy' : drag && drag.moved ? 'grabbing' : 'grab', touchAction: 'none' }} />
      {drag && drag.moved && (
        <img src={img(drag.piece === drag.piece.toUpperCase() ? 'w' : 'b', drag.piece.toLowerCase())} alt=""
          style={{ position: 'absolute', left: BX + drag.x - SQ * 0.55, top: BY + drag.y - SQ * 0.55, width: SQ * 1.1, height: SQ * 1.1, pointerEvents: 'none', filter: 'drop-shadow(0 10px 12px rgba(0,0,0,0.45))', zIndex: 10 }} />
      )}
      {L.tray && <Tray size={112} held={held} trayHandlers={trayHandlers} style={{ position: 'absolute', left: L.tray.x, top: L.tray.y, width: L.tray.w }} />}
      <Panel box={P} a={1} title="Edit position">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <input type="text" aria-label="FEN" aria-describedby="edit-fen-msg" spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
              value={fenText} onChange={(e) => onFenText(e.target.value)} style={editField()} />
            <div id="edit-fen-msg" role="alert" style={{ font: `500 ${sm(14)}px ${MONO}`, color: C.blunder, marginTop: fenMsg ? 6 : 0 }}>{fenMsg}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <FrameButton color={C.ink} onClick={() => onChange(E.start())}>Start</FrameButton>
            <FrameButton color={C.ink} onClick={() => onChange(E.empty())}>Empty</FrameButton>
            <select aria-label="Side to move" value={setup.turn} onChange={(e) => onChange(E.setTurn(setup, e.target.value))} style={{ ...editField(), width: 'auto', flex: 1, minWidth: 180 }}>
              <option value="w">White to move</option>
              <option value="b">Black to move</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 40 }}>
            {[['w', 'White', 'K', 'Q'], ['b', 'Black', 'k', 'q']].map(([side, name, k, q]) => (
              <div key={side} role="group" aria-label={`${name} castling`}>
                {label(name)}
                <div style={{ display: 'flex', gap: 18 }}>
                  <CastleBox setup={setup} right={k} label={`${name} O-O`} onChange={onChange} />
                  <CastleBox setup={setup} right={q} label={`${name} O-O-O`} onChange={onChange} />
                </div>
              </div>
            ))}
          </div>
          {!L.tray && <Tray size={Math.min(84, Math.floor((P.w / P.k - 60) / 6))} held={held} trayHandlers={trayHandlers} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14 }} />}
          <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4, font: `500 ${sm(15)}px ${MONO}`, minHeight: 22 }}>
            {empty ? <span style={{ color: C.dim }}>{EDIT_HINT}</span> : problems.map((t) => <span key={t} style={{ color: C.blunder }}>{t}</span>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <FrameButton color={C.dim} onClick={onCancel}>Cancel</FrameButton>
            <FrameButton primary color={C.last} disabled={problems.length > 0} onClick={onDone}>{doneLabel}</FrameButton>
          </div>
        </div>
      </Panel>
    </div>
  );
}
