# Position from image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read a chess position from a picture (screenshot, diagram or photo) on the viewer's device and open it in Edit position, with the picture beside the board for checking.

**Architecture:** The model (ChessQ Lite V4, int8 ONNX) and onnxruntime-web 1.30.0 are committed in `vision/` and served next to the page, but downloaded only on the viewer's click into their own cache, which `sw.js` answers `vision/*` from (offline too) and never copies into its per-deploy cache. A module Worker (`app/vision-worker.js`) runs the model and returns raw logits; everything else that can be pure (logits → board, unsure squares, the 180° turn, crop maths, box dragging) lives in `VisionCore` (`app/vision-core.js`). A dialog (`VisionDialog`, `app/vision.jsx`) downloads, takes a picked or pasted image, shows the crop box and reads; `GameApp` opens Edit position with the result, and `EditBoard` shows the picture, Turn board 180°, the unsure outlines and Back to crop.

**Tech Stack:** plain-script units and JSX built by `build.cjs`; onnxruntime-web 1.30.0 (`ort.wasm.min.mjs`, `ort-wasm-simd-threaded.{mjs,wasm}`, MIT); node:test unit tests; Playwright live tests (`tests/live/site.test.cjs`).

**Spec:** `docs/spec.md` › Roadmap › Position from image (and the 2026-11-03 decisions-log entry). Read it first.

## Global Constraints

- Branch `claude/position-from-image`, small commits, pushed with a PR against `main` only when the user asks (CLAUDE.md › Workflow). The spec/plan doc changes go to `main` separately.
- Pinned files (sizes in bytes, SHA-256):
  - `vision/chessq-lite-v4-int8.onnx` 41370398 `89d75e343c5d98f235855a67588efb469a4e7cff1e003ee6b6ee0de67732ae1f` (from `https://media.githubusercontent.com/media/lichess-org/lila/master/public/lifat/vision/chessq-lite-v4-int8.onnx`)
  - `vision/ort.wasm.min.mjs` 50126 `219e6a1fc8a9938268d18efca3c91d310bd2f4a59bbd13744df5b2b7fc6cee3b`
  - `vision/ort-wasm-simd-threaded.mjs` 24381 `e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b`
  - `vision/ort-wasm-simd-threaded.wasm` 14239897 `3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2`
  - (the three ORT files from `https://unpkg.com/onnxruntime-web@1.30.0/dist/`). Total 55,684,802 bytes: the UI says **56 MB** (decimal MB, as Full Stockfish's 99 MB).
- Model I/O: input `image` float32 `[1,3,644,644]` RGB NCHW, `(v/255 − mean)/std`, mean `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]`; output `logits` `[1,64,13]`, squares a8…h8 … a1…h1 (= ChessCore board index 0…63), classes `.PNBRQKpnbrqk`, argmax, first index wins ties.
- Unsure: top-class softmax probability **< 0.8**. Crop handed to the Worker: longest side **≤ 2048 px**.
- Copy (exact): menu item **Position from image**; buttons **Download board reader · 56 MB**, **Remove the board reader · 56 MB**, **Choose image**, **Read board**, **Cancel**, **Turn board 180°**, **Back to crop**, **Hold to show picture**, **From image…**; help line "A photo: read it as it is. A diagram or screenshot: pull the edges in to the squares."; bad file "That file isn't an image this browser can open."; unsure line "N squares to check (outlined)" (1: "1 square to check (outlined)"), no line when N = 0.
- Nothing downloads before the viewer's click; the picture never leaves the device; the `vision/` files never enter `SW_LOCAL` or the `chess-replay-*` cache.
- Visual changes: desktop 1440×900 and phone 390×844 screenshots, Chromium and Firefox, shown to the user before committing (CLAUDE.md).
- Long lines: split only in code being changed.

## Review Focus

1. A phone photo with EXIF orientation (taken sideways) → the crop box and the read use the upright picture (`createImageBitmap(file, { imageOrientation: 'from-image' })`). Test: Task 8's live test reads `tests/fixtures/vision-exif6.jpg`.
2. A huge photo (8000×6000) → the crop sent is scaled to ≤ 2048 px on its longest side, aspect kept. Test: Task 3 `cropRect` cases.
3. The box dragged past the picture's edges or inside out → it stays inside the picture and at least 5% of its size. Test: Task 3 `dragBox` cases.
4. A pasted or picked non-image (text on the clipboard, a PGN file) → text paste ignored; a non-image file shows the bad-file message and the dialog stays. Test: Task 8 live steps.
5. Offline before the download, or the connection stalling mid-download → a plain message and Download offered again, nothing half-kept. Test: Task 1 (stall, incomplete file) and Task 8's live step with `navigator.onLine` overridden to false.

---

### Task 1: KeptFiles, the shared "download, check, keep" module

Extract the generic part of `app/sf-full.js` so the board reader's download behaves exactly like Full Stockfish's.

**Files:**
- Create: `app/kept-files.js`
- Modify: `app/sf-full.js` (use it; behaviour and `window.SFFull` API unchanged), `build.cjs` units (add `kept-files.js` before `sf-full.js`)
- Test: `tests/kept-files.test.cjs`; `tests/sf-full.test.cjs` must pass unchanged (except loading `kept-files.js` first)

**Interfaces:**
- Produces: `window.KeptFiles.make({ cache: string, base: string, files: [{ name, size, type, sha256 }], host: string, what: string })` → `{ files, cache, urlOf(f), total(), supported(), present(): Promise<boolean>, download({ onProgress(bytes, total), signal }): Promise<void>, remove(): Promise<boolean>, limits: { stallMs } }`. Messages: `` `${host} stopped sending ${name}` ``, `` `${host} answered ${status} for ${name}` ``, `${name} is bigger than expected`, `${name} arrived incomplete`, `${name} does not match its pinned checksum`, `This browser can’t keep the ${what}`, `Not enough storage space in this browser`, `The browser would not keep the ${what}`. Room check `total × 1.1`; `navigator.storage.persist()` after keeping.

- [ ] **Step 1:** Write `tests/kept-files.test.cjs` reusing `sf-full.test.cjs`'s fakes (Cache Storage, chunked fetch, storage estimate) with a two-file set under `base = 'https://site.test/vision/'`, `host = 'the site'`, `what = 'board reader'`: keeps both files when they match; keeps nothing when the second mismatches (`/does not match/`); `/the site stopped sending/` with `limits.stallMs = 50` and a stall; `/Not enough storage space/` with quota below `total × 1.1`; `present()` true only with both; `remove()` empties the cache.
- [ ] **Step 2:** Run `node --test tests/kept-files.test.cjs` → fails (`KeptFiles` undefined).
- [ ] **Step 3:** (`sf-full.test.cjs` swaps the pinned entries of `SFFull.FILES`/`BUILDS` in place for small stand-ins, so `KeptFiles` must read the `files` array it was given at call time, not copy it.) Move `fetchFile`, the room check, `download`'s keep-or-drop and `present` from `sf-full.js` into `KeptFiles.make`; `SFFull` builds one `KeptFiles` per build (`host: 'unpkg.com'`, `what: 'engine'`) and keeps its own `start`/`load` (Blob URLs) and the "keeping one build drops the other" rule.
- [ ] **Step 4:** `node --test --test-concurrency=1 tests/kept-files.test.cjs tests/sf-full.test.cjs` → all pass.
- [ ] **Step 5:** Commit `KeptFiles: Full Stockfish's download, check and keep, shared`.

### Task 2: The vision files, the build and the service worker

**Files:**
- Create: `vision/` (the four pinned files; `LICENSE` = PolyForm Noncommercial 1.0.0 text from `https://huggingface.co/joelseytre/chessq-lite/blob/main/LICENSE`; `NOTICE` crediting ChessQueries by Joël Seytre (arXiv 2608.30762, github.com/JSeytre/chessqueries) and Lichess's ONNX export; `ort.LICENSE` = onnxruntime's MIT licence)
- Modify: `build.cjs` (copy `vision/*` but the licence files to `out/site/vision/`; copy `app/vision-worker.js` to `out/site/` and add it to `SW_LOCAL`), `app/sw.js`, `LAYOUT.md` (a `vision/` entry with the four pins), `.gitattributes` if needed so git treats `*.onnx`/`*.wasm` as binary
- Test: `tests/build.test.cjs`, new `tests/sw.test.cjs`

**Interfaces:**
- Produces: served paths `vision/chessq-lite-v4-int8.onnx`, `vision/ort.wasm.min.mjs`, `vision/ort-wasm-simd-threaded.mjs`, `vision/ort-wasm-simd-threaded.wasm`, `vision-worker.js`; cache name `chess-vision-1` (in `sw.js` as `VISION_CACHE`, and in Task 3's `VisionCore.CACHE`, same string).

- [ ] **Step 1:** In `tests/build.test.cjs`: the built site has the four `vision/` files byte-identical to `vision/` and their SHA-256s equal the pins; the built `sw.js`'s LOCAL list contains `vision-worker.js` and nothing under `vision/`.
- [ ] **Step 2:** `tests/sw.test.cjs`: load the built `out/site/sw.js` in a `vm` context with fake `self`, `caches`, `fetch`; dispatch a fetch event for `/vision/ort.wasm.min.mjs`: answered from `chess-vision-1` when kept there (with the isolation headers), else from the network and **not** put in any cache; a fetch for `vision-worker.js` still goes through `cacheFirst`.
- [ ] **Step 3:** Run both → fail.
- [ ] **Step 4:** Add the files (download and check against the pins), the build copies, and in `sw.js`'s fetch handler, before the `here` branch: same-origin paths under `vision/` → `caches.open(VISION_CACHE)` match, else `fetch(req)`, through `isolated()`, never `cache.put`. Comment why (56 MB only for viewers who asked; deploys don't re-download it).
- [ ] **Step 5:** `node build.cjs && node --test --test-concurrency=1 tests/build.test.cjs tests/sw.test.cjs` → pass.
- [ ] **Step 6:** Commit `The board reader's files in vision/, served next to the page, kept only on request`.

### Task 3: VisionCore, the pure parts

**Files:**
- Create: `app/vision-core.js` (add to `build.cjs` units after `edit-core.js`)
- Test: `tests/vision-core.test.cjs`

**Interfaces:**
- Consumes: `ChessCore`, `EditCore` (`fromFen`, `toFen`, its castling rule via a setup round-trip).
- Produces `window.VisionCore`:
  - `FILES` (the four pinned files, as `KeptFiles` wants), `CACHE = 'chess-vision-1'`, `SIZE = 644`, `MAX_SIDE = 2048`, `UNSURE = 0.8`, `MB = 56`
  - `read(logits: Float32Array /* 832 */) → { b: (string|null)[64], conf: number[64] }` (softmax top probability per square)
  - `unsure(conf) → number[]` (squares with conf < 0.8, ascending)
  - `setupFrom(b) → setup` (White to move, castling every right whose king and rook are home, ep −1, half 0, full 1)
  - `turn(setup) → setup` (square i ↦ 63 − i; castling re-derived as `setupFrom` does; turn, half, full kept; ep −1) and `turnSquares(list) → list` (i ↦ 63 − i, ascending)
  - `cropRect(box, w, h) → { sx, sy, sw, sh, dw, dh }` (box in picture fractions `{ x0, y0, x1, y1 }`; source rect in pixels, rounded; `dw × dh` scaled so the longest side ≤ 2048, aspect kept, never upscaled)
  - `dragBox(box, handle, dx, dy) → box` (handle `'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'`, deltas in fractions; result inside `[0,1]`, each side ≥ 0.05; `'move'` keeps the size)
  - `WHOLE = { x0: 0, y0: 0, x1: 1, y1: 1 }`

- [ ] **Step 1:** Tests, with exact values:
  - `read`: logits built so square 0 is class 4 (`R`) at a big margin, square 63 class 12 (`k`) at a big margin, rest class 0 → `b[0] === 'R'`, `b[63] === 'k'`, `b[1] === null`; a tie between classes 0 and 3 → class 0 (empty); conf of a square with logits `[2, 1, 0…]` equals the softmax top value (≈ 0.69, `< 0.8`) and appears in `unsure`.
  - Round trip with the spec's tested position: logits from `R7/7q/8/8/1p6/1P2p3/p3P3/k1K1N3` → `EditCore.toFen(setupFrom(b)) === 'R7/7q/8/8/1p6/1P2p3/p3P3/k1K1N3 w - - 0 1'`; from the start placement → castling `KQkq`.
  - `turn` of that setup → `3N1K1k/3P3p/3p2P1/6p1/8/8/q7/7R w - - 0 1` (the model's 180° misread from the testing), and `turn(turn(s))` equals `s`; `turnSquares([0, 9]) → [54, 63]`.
  - `cropRect(WHOLE, 8000, 6000)` → `{ sx: 0, sy: 0, sw: 8000, sh: 6000, dw: 2048, dh: 1536 }`; `cropRect({ x0: .25, y0: .25, x1: .75, y1: .75 }, 1000, 600)` → `{ sx: 250, sy: 150, sw: 500, sh: 300, dw: 500, dh: 300 }`.
  - `dragBox(WHOLE, 'move', .2, 0)` → unchanged (no room); `dragBox({x0:.1,y0:.1,x1:.5,y1:.5}, 'se', .9, .9)` → `x1 = y1 = 1`; `dragBox(…, 'w', .6, 0)` on `{x0:.1,…,x1:.5}` → `x0 = .45` (5% minimum); `'nw'` past the corner clamps both.
- [ ] **Step 2:** `node --test tests/vision-core.test.cjs` → fails.
- [ ] **Step 3:** Implement. `read` softmax per square in float64.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `VisionCore: logits to a board, unsure squares, the 180° turn, crop and box maths`.

### Task 4: The Worker and the page's reader

**Files:**
- Create: `app/vision-worker.js` (module Worker, plain JS, no build step), `app/vision.js` (plain unit `window.Vision`, add to `build.cjs` units after `vision-core.js`)
- Test: live only (Task 8); keep `vision.js` free of DOM work beyond `Worker`/`OffscreenCanvas` so Task 8 covers it.

**Interfaces:**
- Worker messages, as lila's `editor.vision.worker.ts`: in `{ type: 'load', base, threads }` (`base`: the absolute URL of the page's `vision/` folder, `new URL('vision/', location.href).href`, the same prefix the kept cache's keys use, so `sw.js` matches them) → imports `base + 'ort.wasm.min.mjs'`, `env.wasm.wasmPaths = { wasm: base + 'ort-wasm-simd-threaded.wasm', mjs: base + 'ort-wasm-simd-threaded.mjs' }`, `numThreads = crossOriginIsolated ? threads : 1`, `proxy = false`, session from `base + 'chessq-lite-v4-int8.onnx'`, `executionProviders: ['wasm']`, `graphOptimizationLevel: 'all'` → out `{ type: 'ready' }`; in `{ type: 'image', image: ImageBitmap }` → squash to 644×644 on an `OffscreenCanvas` (`imageSmoothingQuality: 'high'`), normalise, run → out `{ type: 'logits', logits: Float32Array }` (transferred); any failure → `{ type: 'error', message }`. The image bitmap is closed after use.
- Produces `window.Vision`: `supported() → boolean` (`SFEngine.simdSupport()` and `KeptFiles` supported and `OffscreenCanvas` present), `kept` (the `KeptFiles.make({ cache: VisionCore.CACHE, base: new URL('vision/', location.href).href, files: VisionCore.FILES, host: 'the site', what: 'board reader' })`), `read(bitmap: ImageBitmap) → Promise<Float32Array>` (starts the Worker once per page, `new Worker('vision-worker.js', { type: 'module' })`, threads `Math.min(4, navigator.hardwareConcurrency || 1)`; one read at a time: a second call while one runs rejects with `'Already reading'`), `stop()` (terminates the Worker; called by `remove()`).

- [ ] **Step 1:** Write both files.
- [ ] **Step 2:** Smoke-check in Chromium against the preview server (`node tests/live/serve.cjs`, sandbox disabled): in the page's console, `await Vision.kept.download()`, then read `tests/fixtures/vision-lichess.png` (Task 8 adds it; use any Lichess `export/fen.gif` meanwhile) and pass the logits through `VisionCore.read` → the expected placement. Check the CSP shows no violation (the worker and its imports are `'self'`; `'wasm-unsafe-eval'` is already in `script-src`).
- [ ] **Step 3:** Commit `The board reader's Worker: onnxruntime-web runs ChessQ Lite on the device`.

### Task 5: Edit position's picture, unsure squares, Turn board 180° and Back to crop

**Files:**
- Modify: `app/edit-board.jsx`
- Test: Task 8's live test

**Interfaces:**
- Consumes: `VisionCore.turn`, `VisionCore.turnSquares`.
- Produces: `EditBoard` takes an optional `image={{ url: string /* object URL of the cropped picture */, unsure: number[] }}` and `onTurn()`, `onBackToCrop()`. With `image` set:
  - two-column layout: the picture (`<img>`, `object-fit: contain`, alt "The picture read") at the top of the panel, above the FEN field; under it **Turn board 180°**, **Back to crop** and the unsure line;
  - one-column layout (find the flag `LayoutCore`/`L` gives Edit position's tray-under-board case): no picture in the panel; a **Hold to show picture** button above the panel's buttons lays the picture over the board (absolutely positioned over `BoardSpace`'s box, `object-fit: contain` on `C.bg`) from pointerdown to pointerup/cancel/leave, and while Space is held with the button focused;
  - each unsure square gets a ring (the existing `ring(i, color, inset)`, color `C.blunder`, inset 3) under the drag layer.
- `GameApp` (Task 7) removes a square from `unsure` when `onChange` changes that square, and turns both setup and `unsure` on `onTurn`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Screenshots (desktop 1440×900 and phone 390×844, Chromium and Firefox) of Edit position opened with a fixture image, an unsure square and the held picture; show the user the PNG paths.
- [ ] **Step 3:** Commit `Edit position shows the picture it was read from, its unsure squares, Turn board 180° and Back to crop`.

### Task 6: VisionDialog

**Files:**
- Create: `app/vision.jsx` (add to the `game-video.jsx` concatenation in `build.cjs` before `game-app.jsx`)
- Test: Task 8's live test

**Interfaces:**
- Consumes: `Vision`, `VisionCore`, the dialog styles of `PgnDialog`/`PlayDialog` (`fen-box`, `twk-btn`, `role="dialog"`, `aria-modal`, Esc closes).
- Produces: `VisionDialog({ again /* { bitmap, box } | null */, onRead({ setup, unsure, url, bitmap, box }), onClose })`. States:
  - `need` (not `Vision.kept.present()`): what it is ("Reads a position from a screenshot, a diagram or a photo, on this device: the picture isn't sent anywhere."), **Download board reader · 56 MB**, progress by the megabyte with Cancel, errors from `KeptFiles` shown as they come; offline (`!navigator.onLine`) says "The board reader downloads once; you're offline." with the button disabled. A kept copy shows **Remove the board reader · 56 MB** (asks first: "Remove the board reader? You'd need to download 56 MB again to use it." **Remove** / **Keep**).
  - `pick`: **Choose image** (`<input type="file" accept="image/*">`), and a `paste` listener on `document` while the dialog is mounted taking the first `image/*` item of `clipboardData` (text ignored). Decoding with `createImageBitmap(file, { imageOrientation: 'from-image' })`; failure → "That file isn't an image this browser can open."
  - `crop`: the bitmap drawn to fit the dialog with an SVG overlay: dimmed outside the box, 8×8 grid inside, 8 handles + move area driven by `VisionCore.dragBox` with pointer events (`touch-action: none`, pointer capture); box starts at `again.box` or `VisionCore.WHOLE`; the help line; **Read board** (disabled while reading, then "Reading…") and **Cancel**. Enter reads, Esc cancels.
  - reading: `VisionCore.cropRect` → `createImageBitmap(bitmap, sx, sy, sw, sh, { resizeWidth: dw, resizeHeight: dh, resizeQuality: 'high' })` → `Vision.read` → `VisionCore.read` → `onRead({ setup: VisionCore.setupFrom(b), unsure: VisionCore.unsure(conf), url /* object URL of the crop as PNG via OffscreenCanvas.convertToBlob */, bitmap, box })`; a failure shows its message and stays in `crop`.
- `again` opens straight at `crop` with that picture and box.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Screenshots of `need`, `crop` (with `tests/fixtures/vision-diagram.png`) on desktop and phone, Chromium and Firefox; show the user.
- [ ] **Step 3:** Commit `Position from image: the dialog (download, choose or paste, crop, read)`.

### Task 7: GameApp wiring, the menu and the Play dialogs

**Files:**
- Modify: `app/game-app.jsx`, `app/free-board.jsx` (`PlayDialog`)
- Test: Task 8's live test

**Interfaces:**
- Consumes: `VisionDialog`, `EditBoard`'s `image`/`onTurn`/`onBackToCrop`.
- Produces:
  - `newGroups` Explore: **Position from image** after Edit position, only when `Vision.supported()`; same in the phone menu. Runs `guard(() => setVision({ play: null, again: null }))`.
  - `vision` state `{ play, again } | null` renders `VisionDialog`. Its `onRead(r)`: if `editing` is open (Back to crop), replace `editing.setup`/`text` with `r.setup` and `editing.image` with `{ url: r.url, unsure: r.unsure, bitmap: r.bitmap, box: r.box }` (revoking the old URL); else `openEditor(vision.play)` and set that `image` on the new `editing`. Its `onClose`: from Back to crop, back to the editor as it was; from a Play dialog, that dialog back as it was (`setPlayInit({ from: 'setup', tc, you })`, `setPlayOpen(mode)`); else nothing.
  - `editTo(setup)` drops from `editing.image.unsure` every square whose piece changed. `onTurn`: `editTo(VisionCore.turn(setup))` with `unsure` turned by `VisionCore.turnSquares` (not dropped). `onBackToCrop`: `setVision({ play: editing.play, again: { bitmap, box } })`.
  - `editDone`/`editCancel` and a new `editing` without an image revoke the object URL and close the bitmap.
  - `PlayDialog` gets `onFromImage({ tc, you })`; with Start from › Set-up position chosen it shows a **From image…** button beside the start button. `GameApp` passes `playFromImage = ({ tc, you }) => { const mode = playOpen; setPlayOpen(null); setVision({ play: { mode, tc, you }, again: null }); }`. The editor then opens with `play` set, so Done reads **Start game**.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `node build.cjs && node --test --test-concurrency=1 tests/*.test.cjs` → all pass.
- [ ] **Step 3:** Commit `Position from image in Play/Explore and the Play dialogs, opening Edit position`.

### Task 8: Live test, fixtures and docs

**Files:**
- Create: `tests/fixtures/vision-lichess.png` (Lichess `export/fen.gif?fen=2r3k1/pp3pp1/4p2p/3pP3/3P1P2/P1rB4/1P4PP/R4RK1&theme=brown&piece=cburnett` as PNG), `tests/fixtures/vision-exif6.jpg` (the same picture rotated 90° clockwise with EXIF Orientation 6 so it displays upright), `tests/fixtures/vision-diagram.png` (a framed diagram with labels, made locally, for screenshots)
- Modify: `tests/live/site.test.cjs`, `docs/spec.md` (move the section to Built, present tense; contents lines), `README.md` (credits: ChessQueries and onnxruntime-web; Licence: the `vision/` model is PolyForm Noncommercial, not GPL, like the lisp sounds), `CLAUDE.md` (a Gotchas line: `vision/`, its cache `chess-vision-1` answered by `sw.js`, Lichess's export, re-pin on update)
- Test: `tests/live/site.test.cjs`

- [ ] **Step 1:** Live test `Position from image: download, read a screenshot, fix in Edit position` (real `page.mouse` input): Play/Explore › Position from image → **Download board reader · 56 MB** → wait for **Choose image** (the real files from the local server) → `setInputFiles(vision-lichess.png)` → **Read board** → the FEN field reads `2r3k1/pp3pp1/4p2p/3pP3/3P1P2/P1rB4/1P4PP/R4RK1 w - - 0 1`, no unsure line; **Turn board 180°** → the FEN is the turned placement; **Back to crop** → **Read board** → the original FEN again; Done → the free board at that FEN. Same with `vision-exif6.jpg` → the same FEN. A `.pgn` picked → the bad-file message; a text `paste` event (`ClipboardEvent` with a `DataTransfer` holding `text/plain`) → still in `pick`. With `navigator.onLine` overridden to false before opening (a fresh context without the kept copy) → the offline note and a disabled Download. Play vs human › Set-up position › **From image…** → read → Done reads **Start game** → a game starts at that FEN. Finally **Remove the board reader** → Download offered again.
- [ ] **Step 2:** Run it in Chromium and Firefox (browser-tests skill; sandbox disabled), and the full JS suite.
- [ ] **Step 3:** Docs as listed; commit `Position from image: live test, fixtures and docs`.
- [ ] **Step 4:** Ask the user before pushing and opening the PR (with the screenshots on `pr-screenshots`, per the pr-screenshots skill).
