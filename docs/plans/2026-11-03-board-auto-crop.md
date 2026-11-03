# Board Auto-crop and Orientation from Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Position from image's crop box opens on the board's 64 squares in computer-made and printed pictures, and a read whose orientation disagrees with the picture's rank labels is turned 180° before Edit position opens.

**Architecture:** A new pure unit `app/vision-grid.js` (`window.VisionGrid`) works on a greyscale copy of the picture: `findBoard` finds a clean upright 8×8 grid, `labelSide` reads which side the rank labels put at the bottom, `occupied`/`modelSide` work out which side the model assumed, and `shouldTurn` combines them. `VisionDialog` (`app/vision.jsx`) makes the greyscale copy when it takes a picture, opens the box on the found grid, and turns the read when `shouldTurn` says so. Nothing touches the Worker, the model, the network or the service worker.

**Tech Stack:** plain-script units built by `build.cjs`; node:test (`tests/*.test.cjs`, no npm packages); Playwright live tests (`tests/live/site.test.cjs`, the `browser-tests` skill).

**Spec:** `docs/spec.md` › Roadmap › Board auto-crop and orientation from labels (and Built › Position from image for the dialog it changes). Read both first.

## Global Constraints

- Branch `claude/vision-auto-crop`, small commits; push and open a PR against `main` only when the user asks (CLAUDE.md › Workflow). This plan and the spec stay on `main`.
- Greyscale copy: the picture scaled so its longest side is at most **1024 px** (`VisionGrid.SIDE = 1024`), never enlarged; one byte per pixel, `{ g: Uint8Array, w, h }`, luma `(77 R + 150 G + 29 B) >> 8`.
- Boxes are fractions of the picture `{ x0, y0, x1, y1 }`, as `VisionCore.WHOLE` and the crop box use.
- Help line copy (exact): grid found → "The box is on the board’s squares; drag its edges if it’s off." (typographic apostrophes, as the dialog's other copy); otherwise today's `VISION_HELP`.
- No message, button or setting for either feature. A failed detection opens the box on `VisionCore.WHOLE`; orientation runs only when the box is a grid (found, or moved off `WHOLE`).
- The picture shown beside the board is never turned.
- Test pictures: no copyrighted picture is committed; every new fixture is drawn by the generator script in Task 1.
- Visual changes (the box's starting place, the help line): desktop 1440×900 and phone 390×844 screenshots in Chromium and Firefox, shown to the user before committing, and put in the PR description (`pr-screenshots` skill).
- Long lines: split only in code being changed.

## Review Focus

1. A small board on a big page (a scanned book page, board ~1/5 of its width) → the box is found on it. Test: Task 2 `small-on-page`.
2. A screenshot with last-move highlights and an arrow over the squares → still found (the checkerboard check survives a few odd squares). Test: Task 2 `highlights`.
3. A page with two diagrams side by side → one box on one board or `null`, never a box spanning both. Test: Task 2 `two-boards`.
4. A bare endgame (two kings) with labels → the side is still worked out unless the placement is symmetric under a 180° turn. Test: Task 4 `modelSide` cases.
5. A diagram turned a quarter (file letters running down the side) → `labelSide` is `null`, so "a"/"h" never pass for "1"/"8" and turn a good read. Test: Task 3 `sideways`.

---

### Task 1: Test pictures and a PGM reader

**Files:**
- Create: `tests/fixtures/make-vision-grid.cjs`
- Create (generated, committed): `tests/fixtures/vision-grid/*.pgm`, `tests/fixtures/vision-grid/cases.json`, `tests/fixtures/vision-black-labels.png`, `tests/fixtures/vision-noboard.png`
- Modify: `tests/load.cjs` (add `readPgm`)

**Interfaces:**
- Produces: `readPgm(name) → { g: Uint8Array, w, h }` exported from `tests/load.cjs` (binary P5, maxval 255, reading `tests/fixtures/vision-grid/<name>.pgm`). `cases.json`: `{ "<name>": { "box": {x0,y0,x1,y1} | null, "side": "w" | "b" | null, "fen": "<placement>" | null } }`, `box` in fractions of the picture, `side` what the labels say, `fen` the placement drawn (a8…h1 as a real board, whatever side is at the bottom).

- [ ] **Step 1: Write the generator.** A Node script that launches one Chromium (the flatpak, per `~/.claude/CLAUDE.md` › Playwright; sandbox disabled), renders each case as an HTML/CSS board in a page, screenshots it, then in the page draws the PNG onto a canvas scaled to longest side ≤ 1024 and reads its luma (the Global Constraints formula), writing PGM. It writes each case's `box`, `side` and `fen` from what it drew (the grid's pixel edges ÷ the picture's size). Pieces are Unicode chess glyphs in a serif font; labels in the fonts named per case. It also converts the existing `vision-lichess.png` and `vision-diagram.png` to PGM (their `box` and `side` (`null` where they have no rank labels) read by eye once and written into the script as constants, `fen` from the live test's known placements). Cases:
  - `lichess`, `diagram`: the existing fixtures.
  - `framed-white`, `framed-black`: a book-style diagram with a 6 px frame, file letters under and rank numbers left of it outside the frame (serif font), White and Black at the bottom; same placement as `vision-lichess.png`'s FEN.
  - `inside-white`, `inside-black`: Chess.com style, no frame, ranks small in the top-left corner of the left file's squares, files in the bottom-right of the bottom rank's (sans font).
  - `nolabels`: a plain board, no coordinates.
  - `highlights`: `nolabels` with two squares tinted yellow and a translucent arrow across four squares.
  - `small-on-page`: a 1600×2200 white page with a few lines of text and a 300 px `framed-white` board in it.
  - `two-boards`: two different boards side by side on one page.
  - `sideways`: `framed-white` rotated 90° clockwise.
  - `onecolour`: an 8×8 grid of lines on a single-colour board with pieces (no checkerboard): `box` `null`.
  - `noboard`: a page of text and a photo-like noise gradient: `box` `null`.
  - `photo`: `nolabels` under a CSS 3D perspective tilt (rotateX 35°) with noise over it: `box` `null`.
  - Also save `framed-black` and `noboard` as the PNGs `tests/fixtures/vision-black-labels.png` and `vision-noboard.png` for the live test.
- [ ] **Step 2: Run it** with the sandbox disabled: `node tests/fixtures/make-vision-grid.cjs`. Expected: 14 `.pgm` files and `cases.json` under `tests/fixtures/vision-grid/`, `vision-black-labels.png` and `vision-noboard.png` in `tests/fixtures/`, total under 10 MB. Look at the PNG screenshots it keeps in `$TMPDIR` by eye.
- [ ] **Step 3: Add `readPgm`** to `tests/load.cjs` and a smoke test in `tests/vision-grid.test.cjs`: `readPgm('lichess')` has `w * h === g.length` and `Math.max(w, h) <= 1024`.
- [ ] **Step 4: Run** `node --test tests/vision-grid.test.cjs`. Expected: PASS.
- [ ] **Step 5: Commit** "Test pictures for the board auto-crop".

### Task 2: `VisionGrid.findBoard`

**Files:**
- Create: `app/vision-grid.js`
- Modify: `build.cjs:20` (add `['vision-grid.js', …]` after `vision-core.js`); `LAYOUT.md` where it lists `app/` units
- Test: `tests/vision-grid.test.cjs`

**Interfaces:**
- Consumes: `readPgm`, `cases.json` (Task 1).
- Produces: `window.VisionGrid = { SIDE, grey, findBoard, labelSide, occupied, modelSide, shouldTurn }` (the last four filled by Tasks 3–4). `VisionGrid.grey(rgba: Uint8ClampedArray, w, h) → { g, w, h }` (luma per pixel, the caller has already scaled). `VisionGrid.findBoard({ g, w, h }) → { x0, y0, x1, y1 } | null`.

- [ ] **Step 1: Write the failing tests.**

```js
const cases = require('./fixtures/vision-grid/cases.json');
const near = (got, want, im) => { // within 2 px of the scaled picture on every edge
  for (const [k, n] of [['x0', im.w], ['x1', im.w], ['y0', im.h], ['y1', im.h]]) assert.ok(Math.abs(got[k] - want[k]) * n <= 2, `${k}: ${got[k]} vs ${want[k]}`);
};
for (const name of Object.keys(cases)) test(`findBoard: ${name}`, () => {
  const im = readPgm(name), got = VG.findBoard(im), want = cases[name].box;
  if (name === 'two-boards') { if (got) assert.ok(got.x1 - got.x0 < 0.55, 'spans both boards'); return; }
  if (want === null) assert.equal(got, null); else near(got, want, im);
});
test('grey: luma', () => assert.deepEqual([...VG.grey(new Uint8ClampedArray([255, 255, 255, 255, 255, 0, 0, 255]), 2, 1).g], [255, 76]));
```

- [ ] **Step 2: Run** `node --test tests/vision-grid.test.cjs`. Expected: FAIL (`VisionGrid` undefined).
- [ ] **Step 3: Implement `findBoard`.** The approach (the spec's anti-goal is a wrong box, so every check errs towards `null`):
  1. Per column `x`, sum over rows the positive and negative parts of `g[y][x+1] − g[y][x]` separately (`P[x]`, `N[x]`); the column's score is `sqrt(P[x] · N[x])`. Inside a checkerboard a square edge goes light→dark in some rows and dark→light in others, so both are large; a frame edge, a label or text runs one way and scores low. Same for rows.
  2. Find the 7 evenly spaced inner lines: for every spacing `s` from 8 px to `min(w, h) / 8` and start `a`, sum the best score within ±1 px of `a + k·s`, k = 0…6; keep the best. The outer edges are the first line − `s` and the last + `s` (the outermost squares often have no edge against the background).
  3. Reject (`null`) unless: the weakest of the 7 peaks is at least 0.35 × their median; their median is at least 4 × the median score of the whole axis; the x and y spacings are within 8% of each other; the outer edges lie inside the picture (1 px slack, then clamped).
  4. Checkerboard check: per square, the median of four small patches in its corners (inner 20%, away from a centred piece); split the 64 medians at their midpoint into light and dark; at least 56 of 64 must fit the alternating pattern (either parity). Else `null`.
  The thresholds are starting points: tune them on the fixtures, never loosen one so far that `photo`, `noboard` or `onecolour` pass.
- [ ] **Step 4: Run** `node --test tests/vision-grid.test.cjs`. Expected: PASS for every case.
- [ ] **Step 5: Run** the whole suite `node --test --test-concurrency=1 tests/*.test.cjs` (build test included). Expected: PASS.
- [ ] **Step 6: Commit** "VisionGrid.findBoard: find a clean 8×8 grid".

### Task 3: `VisionGrid.labelSide`

**Files:**
- Modify: `app/vision-grid.js`
- Test: `tests/vision-grid.test.cjs`

**Interfaces:**
- Produces: `VisionGrid.labelSide({ g, w, h }, box) → 'w' | 'b' | null`, `box` in fractions (a found or dragged one).

- [ ] **Step 1: Write the failing tests.** For every case with a non-null `box`: `assert.equal(VG.labelSide(readPgm(name), cases[name].box), cases[name].side)` (so `framed-white` → `'w'`, `framed-black` → `'b'`, `inside-*` likewise, `nolabels`, `highlights`, `lichess` → `null`). `sideways`: `labelSide(readPgm('sideways'), box)` is `null`, with `box` the sideways board's squares from `cases.json` (store it there though `findBoard` may also find it).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** With the square size `s` (box width ÷ 8 in pixels), look at four candidate label columns: outside left `[x0 − 0.7s, x0 − 0.05s]`, outside right `[x1 + 0.05s, x1 + 0.7s]` (the frame's own band skipped: drop columns whose pixels are almost all dark), and inside, the left and right edge files' squares' top and bottom corner patches (0.3s × 0.3s, each of the four corners). In each column, cut 8 cells, one per rank, and count a cell's ink: pixels more than 60 levels from the cell's median. A column is a label column only if all 8 cells have ink and no cell's ink exceeds 3 × the column's median (a piece corner or text would). Its answer: top-cell ink ÷ bottom-cell ink ≥ 1.5 → `'w'` (the "8" is on top), ≤ 1 / 1.5 → `'b'`, else nothing. Return the answer of the label column with the largest |log ratio|, `null` if none or if two columns disagree. File labels are not read (the plan's call: rank labels suffice).
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** "VisionGrid.labelSide: which side the rank labels put at the bottom".

### Task 4: `occupied`, `modelSide`, `shouldTurn`

**Files:**
- Modify: `app/vision-grid.js`
- Test: `tests/vision-grid.test.cjs`

**Interfaces:**
- Consumes: `labelSide` (Task 3); a read placement `b` (64 entries, a8…h1, piece letter or `null`, from `VisionCore.read`).
- Produces: `VisionGrid.occupied({ g, w, h }, box) → boolean[64]` in picture order (index 0 = the top-left square as seen). `VisionGrid.modelSide(occ, b) → 'w' | 'b' | null`. `VisionGrid.shouldTurn(grey, box, b) → boolean`: true only when `labelSide` and `modelSide` both answer and differ; it calls both through `window.VisionGrid` (not local names), so the live test can replace `modelSide`.

- [ ] **Step 1: Write the failing tests.**

```js
const board = (fen) => window.ChessCore.posFromFen(fen).b;
test('occupied: the drawn placement, as seen', () => {
  for (const name of ['framed-white', 'framed-black', 'inside-white', 'nolabels']) {
    const b = board(cases[name].fen), seen = cases[name].side === 'b' ? b.slice().reverse() : b;
    assert.deepEqual(VG.occupied(readPgm(name), cases[name].box), seen.map(Boolean), name);
  }
});
test('modelSide', () => {
  const b = board('4k3/8/8/8/8/8/8/R3K3'), occ = b.map(Boolean);
  assert.equal(VG.modelSide(occ, b), 'w');
  assert.equal(VG.modelSide(occ.slice().reverse(), b), 'b');
  const kk = board('4k3/8/8/8/8/8/8/2K5');                 // two kings, not symmetric under 180°
  assert.equal(VG.modelSide(kk.map(Boolean), kk), 'w');
  const sym = board('3k4/8/8/8/8/8/8/4K3');                // d8 and e1 swap places under 180°
  assert.equal(VG.modelSide(sym.map(Boolean), sym), null);
});
test('shouldTurn', () => {
  const fb = board(cases['framed-black'].fen), im = readPgm('framed-black'), box = cases['framed-black'].box;
  assert.equal(VG.shouldTurn(im, box, fb), false);                  // the model read it the right way round
  assert.equal(VG.shouldTurn(im, box, fb.slice().reverse()), true); // read from White's side: turn it
  assert.equal(VG.shouldTurn(readPgm('nolabels'), cases.nolabels.box, board(cases.nolabels.fen).reverse()), false);
});
```

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `occupied`: a square is occupied when the standard deviation of its middle 50% (corners left out, where inside labels sit) is over 14 levels (tune on the fixtures; highlights and the arrow are flat or faint). `modelSide`: `w` = squares where `occ[i] === !!b[i]`, `bl` = squares where `occ[i] === !!b[63 − i]`; `'w'` if `w − bl ≥ 2`, `'b'` if `bl − w ≥ 2`, else `null`.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** "VisionGrid: work out the model's side and when to turn the read".

### Task 5: The dialog: box on the grid, read turned by the labels

**Files:**
- Modify: `app/vision.jsx` (`VISION_HELP` and a new `VISION_FOUND`, `take`, the `again` path, `read`)
- Test: `tests/live/site.test.cjs` (the `desktop: Position from image…` test)

**Interfaces:**
- Consumes: `VisionGrid.SIDE`, `grey`, `findBoard`, `shouldTurn`; `VisionCore.turn`, `turnSquares`, `setupFrom`, `WHOLE`.
- Produces: `pic` state `{ bitmap, grey, found }` (`found` = `findBoard`'s box or `null`). `onRead`'s argument and `GameApp` unchanged (the box already goes to Back to crop).

- [ ] **Step 1: Write the failing live checks** in the existing test (Chromium and Firefox, real mouse input; the `browser-tests` skill has how to run it):
  - After taking `vision-lichess.png`, the help line reads the found copy, and the box (the accent `rect` in the dialog's SVG) is within 3 px of its `cases.json` box scaled to the on-screen picture.
  - Taking `vision-black-labels.png`: the box opens on its squares; Read board gives the `framed-black` FEN in the FEN field.
  - Then force the model's side the wrong way round: `await p.evaluate(() => { const G = window.VisionGrid, real = G.modelSide; window.__realModelSide = real; G.modelSide = (o, b) => ({ w: 'b', b: 'w' })[real(o, b)] || null; })`; Back to crop › Read board: the FEN field shows the same placement turned 180° (`VisionCore.turn`'s placement), proving the turn is wired. Restore `window.__realModelSide`.
  - Taking `vision-noboard.png`: the box is around the whole picture and the help line is today's.
- [ ] **Step 2: Run** the test. Expected: FAIL on the new checks.
- [ ] **Step 3: Implement.**
  - `take(f)`: after decoding, draw the bitmap onto an `OffscreenCanvas` scaled to longest side ≤ `VisionGrid.SIDE`, `getImageData`, `VisionGrid.grey`, `findBoard`; `setPic({ bitmap, grey, found })`, `setBox(found || VC.WHOLE)`. The canvas is dropped at once (no full-resolution copy).
  - `again`: compute `grey` and `found` the same way from `again.bitmap` on mount; the box stays `again.box`.
  - Help line: `pic.found ? VISION_FOUND : VISION_HELP`.
  - `read()`: after `VC.read(logits)`, if the box is a grid (`pic.found` or the box differs from `VC.WHOLE`) and `VisionGrid.shouldTurn(pic.grey, box, b)`, pass `setup: VC.turn(VC.setupFrom(b))` and `unsure: VC.turnSquares(VC.unsure(conf))`; the PNG of the crop is not turned. No message.
- [ ] **Step 4: Run** the live test in both browsers. Expected: PASS. Run the node suite. Expected: PASS.
- [ ] **Step 5: Screenshots** of the crop step with `vision-black-labels.png` (box on the squares, the found help line): desktop 1440×900 and phone 390×844, Chromium and Firefox. Show the PNG paths to the user and wait for their go-ahead before committing.
- [ ] **Step 6: Commit** "Position from image: open the box on the board's squares and follow the rank labels".

### Task 6: Spec and docs

**Files:**
- Modify: `docs/spec.md`, `CLAUDE.md` (Gotchas › Position from image: one clause naming `app/vision-grid.js`)

- [ ] **Step 1:** Move the spec's Roadmap section into Built › Position from image as built (the crop box step now opens on a found grid; a Reading step clause for the turn; Tests listing `tests/vision-grid.test.cjs`, the generator and the live checks), remove it from Contents' Roadmap list, and add a decisions-log "built" line with the thresholds that shipped. Any fixture that didn't come out as planned goes in Known gaps.
- [ ] **Step 2:** Run `node --test --test-concurrency=1 tests/*.test.cjs`. Expected: PASS.
- [ ] **Step 3: Commit** on the branch "Spec: board auto-crop built". Push and open the PR only when the user asks; its description carries the Task 5 screenshots.
