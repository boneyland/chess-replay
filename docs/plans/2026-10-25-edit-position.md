# Edit Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play/Explore › Edit position… opens a position editor (empty board, piece tray, FEN field, Start/Empty, side to move, castling boxes, a status line saying what's wrong) whose Done opens the free board at that position; it replaces Paste FEN….

**Architecture:** A pure unit, `EditCore` (`app/edit-core.js`), holds the editor's state as a plain *setup* object and every rule: lenient FEN parsing, placing and moving pieces, castling boxes, and the checks with their messages. A React view, `EditBoard` (`app/edit-board.jsx`), draws it in the frame like `FreeBoard` (board left, editor in the panels' box; on the phone the tray right under the board) with its own pointer input. `GameApp` holds an `editing` state that replaces the view while it is set; Done commits a board through `commitBoard(BoardCore.fromFen(fen))`.

**Tech Stack:** Plain-script units (IIFEs assigning `window.*`), React via JSX concatenated by `build.cjs`, `node --test` unit tests, Playwright live tests.

**Spec:** `docs/spec.md` › Roadmap › Edit position (the section is the design; read it first).

## Global Constraints

- Changes to `app/` go on branch `claude/edit-position` as small commits, pushed with a PR against `main` only when the user asks (CLAUDE.md › Workflow).
- Long one-line statements are known debt: split only lines you change.
- Move numbers from `ply0` / `ChessCore.moveNo`, never `i % 2`; squares become pixels only through `view()` (the board can be flipped).
- Board input is tested with real `page.mouse` input, never `dispatchEvent`.
- Visual changes: screenshot desktop (1440×900) and phone (390×844), in Chromium and Firefox Developer Edition, and show the PNG paths before committing.
- Memory: one browser at a time in Playwright runs (global CLAUDE.md).
- Copy, verbatim from the spec: menu item `Edit position…`; buttons `Start`, `Empty`, `Cancel`, `Done`; select options `White to move` / `Black to move`; castling labels `O-O`, `O-O-O` under `White` and `Black`; empty-board hint `Drag pieces from the tray, or tap one and then tap squares.`

## Review Focus

1. **Dragging off the board in a flipped board or the zoomed game layout**: the piece is removed, never dropped on a clamped edge square (`useBoardInput.boardXY` clamps; the editor's input must not). Test in Task 4.
2. **A FEN with castling rights its pieces don't support pasted in** (`KQkq` on an endgame): loads, with those rights dropped, not refused. Test in Task 1.
3. **Typing a FEN character by character**: each intermediate string is malformed; the board stays put and the message shows, and never flickers to a half board. Test in Task 1 (`fromFen` refuses partial FENs) and Task 3 (typing live).
4. **Esc while the FEN field has focus, or while a tray piece is selected**: Esc deselects a selected tray piece first; otherwise cancels the editor. Test in Task 4 (it needs a held tray piece).
5. **Cancel after leaving a timed game in progress**: the game returns with the same time left as at entry. Test in Task 3.

---

### Task 1: `EditCore`, the editor's rules

**Files:**
- Create: `app/edit-core.js`
- Modify: `app/chess-core.js` (export `checkers`), `build.cjs:17` (add `['edit-core.js', …]` after `board-core.js`; check how `shell.html` / the build list loads units and follow it)
- Test: `tests/edit-core.test.cjs` (new), `tests/build.test.cjs` if it lists units

**Interfaces:**
- Produces, on `window.EditCore`:
  - A *setup* is `{ b, turn, castle, ep, half, full }`: `b` a 64-array as `ChessCore` boards (index 0 = a8, `'K'`/`'p'`… or `null`), `turn` `'w'|'b'`, `castle` a string of `KQkq` in that order (`''` for none), `ep` a square index or `-1`, `half`/`full` numbers. Never mutated.
  - `empty() -> setup` (no pieces, White, `''`, `-1`, 0, 1); `start() -> setup` (the standard position, `KQkq`).
  - `fromFen(text) -> { setup } | { error: string }`: unwraps `[FEN "…"]`, collapses spaces; needs the board field (8 ranks, each 8 wide, pieces `pnbrqkPNBRQK`) and accepts missing trailing fields (defaults `w - - 0 1`); refuses bad syntax with the same messages `ChessCore.parseFen` uses for syntax ("That isn't a FEN: …", "Chess960 positions aren't supported yet"). Accepts any piece placement (no king, two kings, back-rank pawns, the wrong side in check). Drops castling rights whose king or rook isn't home; drops an en passant square that doesn't match the pieces.
  - `toFen(s) -> string`, six fields.
  - `put(s, sq, piece|null) -> setup`; `move(s, from, to) -> setup` (the target's piece replaced); both drop `ep` and every castling right whose king or rook is no longer home. `half`/`full` kept.
  - `setTurn(s, turn) -> setup` (drops `ep`).
  - `canCastle(s, right) -> boolean` (`right` one of `'K'`,`'Q'`,`'k'`,`'q'`: king and that rook on e1/h1, e1/a1, e8/h8, e8/a8); `setCastle(s, right, on) -> setup` (no-op turning on when `!canCastle`).
  - `isEmpty(s) -> boolean`.
  - `problems(s) -> string[]`, in this order, all that apply:
    - per side, White first: `"White has no king."` / `"White has 2 kings."` (the count)
    - per pawn on rank 1 or 8, by square a8…h1, as `parseFen` words it: `"The pawn on a8 can't stand on the first or last rank."`
    - only when each side has exactly one king: the side not to move in check: `"Black is in check, but it's White's turn."`
    - only when each side has exactly one king: the side to move in impossible check: more than two checkers, or two checkers on one line through the king (chessops' `validCheckers` rule; skip its en passant subtleties): `"White is in check from 3 pieces, which no move can give."` / for two aligned: `"White is in check from two pieces in a line, which no move can give."`
  - `ok(s) -> boolean` = `problems(s).length === 0`.
- Produces, on `window.ChessCore`: `checkers(b, side) -> number[]`, the squares of the pieces giving check to `side`'s king (empty if no king), built on the existing `attacked`.

- [ ] **Step 1: Branch.** `git switch -c claude/edit-position`.
- [ ] **Step 2: Write the failing tests** in `tests/edit-core.test.cjs` (loader as in `tests/board-core.test.cjs`: `loadUnit('chess-core.js'); loadUnit('board-core.js'); loadUnit('edit-core.js')`):
  - `empty and start`: `toFen(E.empty()) === '8/8/8/8/8/8/8/8 w - - 0 1'`; `toFen(E.start()) === ChessCore.START_FEN`.
  - `fromFen loads an illegal but well-formed position`: `'8/8/8/8/8/8/8/8 b - - 0 1'`, `'P7/8/8/8/8/8/8/K6k w - - 0 1'`, `'4k3/8/8/8/8/8/8/K2KR3 w - - 0 1'` all give a `setup`; the last round-trips through `toFen`.
  - `fromFen refuses malformed text`: `''`, `'rnbqkbnr/pppppppp'`, `'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w'` (a rank 7 wide), `'8/8/8/8/8/8/8/8 x - - 0 1'` give `{ error }` (a string); a PGN tag `[FEN "4k3/8/8/8/8/8/8/4K3 b - - 0 40"]` loads with `turn === 'b'`, `full === 40`.
  - `unsupported castling is dropped, not refused`: `fromFen('4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1').setup.castle === ''`; `'r3k3/8/8/8/8/8/8/4K2R w KQkq - 0 1'` keeps `'Kq'`.
  - `put and move drop rights and en passant`: from `start()`, `put(s, 63, null)` (h1) leaves `'Qkq'`; `move(s, 60, 52)` (e1→e2) leaves `'kq'`; a setup from `'4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'` has `ep === 19` and any `put` gives `ep === -1`; `half`/`full` survive.
  - `castling boxes`: `canCastle(empty(), 'K') === false`; `setCastle(empty(), 'K', true).castle === ''`; on `start()`, `setCastle(s, 'Q', false).castle === 'Kkq'`, and back on gives `'KQkq'` (order kept).
  - `problems, each message`: `problems(empty())` deep-equals `['White has no king.', 'Black has no king.']`; `'kk6/8/8/8/8/8/8/K7 w - - 0 1'` → `['Black has 2 kings.']`; `'4k3/8/8/8/8/8/8/P3K3 w - - 0 1'` → `["The pawn on a1 can't stand on the first or last rank."]`; `'4k3/4R3/8/8/8/8/8/4K3 w - - 0 1'` (Black in check, White to move) → `["Black is in check, but it's White's turn."]`; `'4k3/8/8/8/8/8/8/4K3 w - - 0 1'` → `[]`.
  - `impossible checks` (Black king h8 in each, White to move): White king e1 checked by rook e8, bishop a5 and knight d3 → `["White is in check from 3 pieces, which no move can give."]`; king e1 checked by rooks a1 and h1 (collinear through the king) → `["White is in check from two pieces in a line, which no move can give."]`; a legal double check (rook e8 and knight f3 on king e1) → `[]`.
  - `ok means parseFen accepts it`: for each of `start()`, the legal double check, `'4k3/8/8/8/8/8/8/4K3 b - - 0 1'`: `ok(s)` and `ChessCore.parseFen(toFen(s))` doesn't throw.
  - `setups are never mutated`: `put`, `move`, `setTurn`, `setCastle` leave their input's `toFen` unchanged.
- [ ] **Step 3: Run, expect failures.** `node --test tests/edit-core.test.cjs` → fails (`EditCore` undefined).
- [ ] **Step 4: Implement** `app/edit-core.js` (IIFE, `window.EditCore = {…}`, header comment in the style of `board-core.js`) and `ChessCore.checkers`. Reuse `ChessCore`'s helpers for square names (`sqIndex`) and in-check tests; write the lenient board parse here rather than loosening `parseFen` (which keeps rejecting illegal positions for PGN starts).
- [ ] **Step 5: Run.** `node --test --test-concurrency=1 tests/*.test.cjs` → all pass.
- [ ] **Step 6: Commit** `app/edit-core.js app/chess-core.js build.cjs tests/edit-core.test.cjs`: "EditCore: the position editor's rules and checks".

### Task 2: `EditBoard`, the editor view (desktop and phone)

**Files:**
- Create: `app/edit-board.jsx`
- Modify: `build.cjs:31` (concatenate `edit-board.jsx` after `free-board.jsx`), `app/shell.html` (styles for the tray, castling boxes and status line, next to `.fen-*`)

**Interfaces:**
- Consumes: `EditCore` (Task 1); from `game-video-core.jsx`: `setLayout(useFrame())`, `L`, `BX`, `BY`, `BW`, `SQ`, `view()`, `idxXY`, `img(color, type)`, `Panel`, `C`, `BOARD`, `NO_SELECT`; from `free-board.jsx`: `boardLayout`, `boardSquares()`, `LineBoard` (fed `v={{ upto: -1, moves: [], base: { b: setup.b } }}`).
- Produces: `function EditBoard({ setup, onChange, onDone, onCancel, fenText, onFenText, fenMsg })`. `GameApp` owns `setup` and the field's text (so Task 3 wires state); `EditBoard` calls `onChange(setup)` for every edit.
  - Layout: board where `FreeBoard` draws it (no eval bar, no player bars); the editor `Panel` in the union box of `L.header`, `L.moves`, `L.comment`, `L.analysis` (whichever exist) with title `Edit position`. In the tall (phone) frame, `L.tall` or however `tallLayout` is detected in `game-video-core.jsx`: the tray (two rows of six) in a strip right under the board, then the panel with the rest.
  - Panel order: FEN field (`aria-label="FEN"`, message under it with `role="alert"`), `Start` `Empty` and a `<select aria-label="Side to move">`, castling checkboxes (`aria-label`s `White O-O`, `White O-O-O`, `Black O-O`, `Black O-O-O`; disabled when `!canCastle`), the tray (desktop only), status lines (`role="status"`; the hint when `isEmpty`, else each `problems()` line in `C.blunder`), `Cancel` and `Done` (`disabled={!EditCore.ok(setup)}`).
  - Tray pieces are `<button aria-label="White rook" aria-pressed>` with the piece image; the selected one highlighted (`BOARD.last` ring, as the board's selected square).

- [ ] **Step 1: Implement** `EditBoard` drawing only (input in Task 4): static board from `setup`, panel, tray, checkboxes wired to `setCastle`, `Start`/`Empty`/side select wired to `start()`/`empty()`/`setTurn`.
- [ ] **Step 2: Check it builds**: `node build.cjs` succeeds and `node --test tests/build.test.cjs` passes. (The view can't be reached until Task 3's menu item; its screenshots are Task 3 Step 5.)
- [ ] **Step 3: Commit** `app/edit-board.jsx build.cjs app/shell.html`: "EditBoard: the position editor's view".

### Task 3: `GameApp` wiring: the menu, Done, Cancel, the FEN field, Paste FEN removed

**Files:**
- Modify: `app/game-app.jsx:151, 269-301, 438, 498, 520` (menu, state, view switch, dialog), `app/free-board.jsx:482-532` (delete `FenDialog`), `app/shell.html` (drop now-unused `.fen-*` rules only if no other dialog uses them; `PgnDialog` and `DialogBox` do, so likely keep)
- Test: `tests/live/site.test.cjs` (replace the Paste FEN test at `:552` and its helper at `:79` if only it uses it)

**Interfaces:**
- Consumes: `EditBoard` (Task 2; its `useEditInput` comes in Task 4, so this task's tests that place pieces type FENs or use Start instead), `EditCore` (Task 1), `PlayCore.pause(b, now)`, `PlayCore.runClock(b, now)`, `PlayCore.inProgress(b)`, `guard`, `keepLeft`, `commitBoard`.
- Produces: in `GameApp`, `editing`: `null` or `{ setup, text, msg, resume }`, where `resume` is the paused board of a game in progress left on entry (else `null`). While `editing` is set, `EditBoard` renders in place of `FreeBoard`/`GameVideo` (so neither mounts: no searches, no clocks, no Stockfish reply); the dock's transport bar is in its `still` look; the Play/Explore menu still works (any item there first drops `editing`).
  - `editPosition()`: closes menus, then `guard(() => setEditing({ setup: EditCore.empty(), text: EditCore.toFen(empty), msg: '', resume: board in progress ? PlayCore.pause(board, Date.now()) : null }))`. Note `guard`'s Leave already calls `keepLeft`.
  - Field: `onFenText(text)` sets `text`; `EditCore.fromFen(text)` → on `setup`, set it and clear `msg`; on `error`, keep the setup and set `msg`. Every board edit sets `text` to `toFen(setup)` and clears `msg`.
  - Done: `setEditing(null); setQueenOpen(false); commitBoard(BoardCore.fromFen(EditCore.toFen(setup)))`.
  - Cancel / Esc: `setEditing(null)`, then if `resume`, `commitBoard(PlayCore.runClock(resume, Date.now()))`. Esc first clears a held tray piece (Review Focus 4); Esc inside the FEN field also cancels.
  - Menu: `{ label: 'Edit position…', run: editPosition }` right after `Starting position`; `Paste FEN…` removed (dock and phone menu share `newGroups`).

- [ ] **Step 1: Write the live tests** (replacing the Paste FEN test):
  - `desktop: Edit position sets up a pasted FEN, says what's wrong, and Done opens the free board`: open Edit position…; the status shows the hint `Drag pieces from the tray, or tap one and then tap squares.` and `Done` is disabled; type (keyboard, as the current Paste FEN test does) `4k3/4R3/8/8/8/8/8/4K3 w - - 0 1` → status shows `Black is in check, but it's White's turn.`, Done disabled; choose `Black to move` → status clear, Done enabled; type `nonsense` → a message under the field, the board unchanged; click Done → the free board shows, Copy FEN gives `4k3/4R3/8/8/8/8/8/4K3 b - - 0 1`.
  - `desktop: Edit position Start, Empty and castling boxes`: Start → FEN field `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1` and all four boxes checked; untick White O-O-O → `… w Kkq - 0 1`; drag the h8 rook off → Black O-O unticked and disabled; Empty → `8/8/8/8/8/8/8/8 w - - 0 1`.
  - `desktop: Cancel returns to a timed game with its time left`: start Play vs human with 5+3, play e4, read White's/Black's clock text; Edit position… → Leave; wait 2 s; Esc → the game is back, clocks show the same times as before entry (±0.1 s).
  - Phone (390×844): `phone: Edit position's tray sits under the board and tap-to-place works`: tray buttons' top is below the board's bottom and above the FEN field; type `4k3/8/8/8/8/8/8/4K3 w - - 0 1` into the FEN field → Done enabled; tap Done → the free board.
  - Update any test that clicks `Paste FEN…` (search `tests/live/`).
- [ ] **Step 2: Run, expect failures** (`Edit position…` button not found).
- [ ] **Step 3: Implement** the wiring above; delete `FenDialog`, `fenOpen`, `pasteFen`, `fenSet`, `closeFen` and their uses (`dialogOpen`, `fenWasOpen`).
- [ ] **Step 4: Run** the JS tests (`node --test --test-concurrency=1 tests/*.test.cjs`), then the live suite against a local build in Chromium and Firefox (`LIVE_URLS=local node --test tests/live/site.test.cjs`, sandbox disabled) → pass. Then `../chess-animator/.venv/bin/python -m unittest tests/check_browser_json.py` → pass.
- [ ] **Step 5: Screenshots** desktop 1440×900 and phone 390×844, Chromium and Firefox: an empty editor, Start, an illegal position with two problem lines. Show the user the paths before committing; adjust sizes as they ask.
- [ ] **Step 6: Commit** `app/game-app.jsx app/free-board.jsx app/shell.html tests/live/site.test.cjs`: "Play/Explore: Edit position… replaces Paste FEN…".

### Task 4: Editing input: tray drag, tap-to-place, drag on and off the board

**Files:**
- Modify: `app/edit-board.jsx`

**Interfaces:**
- Produces: `function useEditInput({ setup, onChange }) -> { held, drag, handlers, trayHandlers(piece), clear }`, where `held` is the tray piece selected for tap-to-place (`'R'`, `'p'`… or `null`) and `drag` `{ piece, from (square or null for the tray), x, y, moved }` in board pixels.
  - Board pointer down on a piece: start a drag (pointer capture). Up on a square: `move`; up outside the board's box: `put(from, null)`. Hit-testing uses the board element's `getBoundingClientRect()` without clamping, then `view()` for flipped boards.
  - Tray pointer down: start a drag with `from: null`, pointer captured on the tray button; up over the board: `put(sq, piece)`; elsewhere: nothing. A tray press that doesn't move (under 14 board px, as `useBoardInput`) toggles `held`.
  - With `held` set, a tap on a square: `put(sq, held)`, or `put(sq, null)` when that square holds the same piece. A tap on an empty square with nothing held does nothing.
  - The dragged piece follows the pointer over the panel too (draw it in a fixed overlay above the frame, not inside `BoardTouch`'s box).

- [ ] **Step 1: Write the live test** `desktop: Edit position places pieces by drag and by tap, removes them by dragging off` in `tests/live/site.test.cjs` next to Task 3's Edit position tests, using `boardBox`/`square` from `tests/live/board.cjs` and real `page.mouse`: open Edit position…; tap the tray's White king, tap e1; tap Black king, tap e8; drag the tray's White rook to a1; assert the FEN field reads `4k3/8/8/8/8/8/8/R3K3 w - - 0 1`; drag the rook from a1 to beyond the board's left edge; assert `4k3/8/8/8/8/8/8/4K3 w - - 0 1`. Esc with a tray piece held: still editing, the piece unselected; Esc again: the editor is gone (Review Focus 4). Then on a new page with Flip on (stored setting `flip: true` via `addInitScript`, as other tests set settings): tap the tray's White rook, tap the square drawn at the board's top-left (h1 when flipped) → `4k3/8/8/8/8/8/8/4K2R w - - 0 1`; drag it beyond the board's right edge → removed. And `phone: Edit position places pieces by tap` (390×844, taps as touch where `tests/live` already does, else mouse): tap the tray's White king, tap e1 → the FEN field reads `8/8/8/8/8/8/8/4K3 w - - 0 1`.
- [ ] **Step 2: Run, expect failure** (pieces don't move: no editing input yet).
- [ ] **Step 3: Implement** `useEditInput` and hook it to `EditBoard`.
- [ ] **Step 4: Run** `LIVE_URLS=local node --test tests/live/site.test.cjs --test-name-pattern "Edit position"` (sandbox disabled, `NODE_PATH` as in CLAUDE.md) in Chromium then Firefox → pass.
- [ ] **Step 5: Commit** `app/edit-board.jsx tests/live/site.test.cjs`: "Edit position: drag, tap and drag-off editing".

### Task 5: Docs

**Files:**
- Modify: `docs/spec.md` (move Edit position from Roadmap to Built, under Free board and explorer, rewriting it as what's built; drop the Paste FEN bullet and the menu list's `Paste FEN…`; Contents lines), `README.md:13` ("from the starting position or a pasted FEN" → "… or a position set up by hand or from a FEN"), `CLAUDE.md` › Gotchas (one line: the editor is `EditBoard` (`app/edit-board.jsx`), rules in `EditCore` (`app/edit-core.js`), a view `GameApp` swaps in for `FreeBoard`/`GameVideo` while `editing` is set)

- [ ] **Step 1: Edit** the three files.
- [ ] **Step 2: Commit** on the branch (the spec's Built section describes the app as served, so it lands with the PR): "Docs: Edit position built".
- [ ] **Step 3:** Ask the user whether to push and open the PR (with the screenshots on `pr-screenshots` as CLAUDE.md describes).
