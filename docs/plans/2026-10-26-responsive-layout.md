# Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scaled fixed-size frames with a page laid out at the window's real size: board + sidebar, or one column. Text stays at fixed sizes, with a Text size setting. Exports record the screen-sized page.

**Architecture:**
- A new pure module, `app/layout-core.js` (`window.LayoutCore`), computes every box in real CSS pixels from the stage area's size, the text scale, the view and whether a video is running. It is unit-tested in Node like the other `*-core.js` files.
- The components keep their absolute-positioned model. `L` becomes LayoutCore's output, read as now (`L.moves`, `L.comment`…), but without the `k` magnifiers or the stage's `scale()`.
- The board stays a 768 px (`SQ = 96`) graphic. One wrapper scales it to `L.board.size`; `useBoardInput` already maps pointers by `getBoundingClientRect`, so input follows.
- Text sizes written for the 1920 frame go through `tx(px)`, which multiplies them by `TX` = 0.8 × the Text size factor.

**Tech Stack:** React 18 (no build step, JSX via the page's loader), plain-script `*-core.js` units, `node --test`, Playwright live tests (Chromium flatpak + Firefox Developer Edition).

**Spec:** `docs/spec.md` › Roadmap › Responsive layout. Read it first: its Goals, Constraints and "My calls" are requirements here.

## Global Constraints

- Work on branch `claude/responsive-layout`, in small commits, as one PR against `main` (push and open the PR only when the user asks). Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Text sizes: body/panel text about 15–16 px, small labels about 12–13 px, the commentary's serif heading about 22–26 px, the same on phone and desktop. With `TX = 0.8` the frame's 19 px move list becomes 15.2 px. Tune `TX_BASE` only if the screenshots say so.
- Text size factors: `Small: 0.9, Default: 1, Large: 1.15, Larger: 1.3`. `TWEAK_DEFAULTS.textSize = 'Default'`.
- Sidebar minimum: `320 × text` px. Stack into one column when the board beside it would be under 360 px. The board grows to at most 900 px.
- Eval graph: 110 px high, full width at the bottom in the sidebar layout. Below a stage height of 700 px it sits in the sidebar under Analysis, or is `null` if under 90 px is left. In one column it is `null`.
- A video (playing, or exporting) is screen-sized: everything fits the stage area, with no page scroll. Paused in one column, the page scrolls.
- Video touches (title and end cards, `enter()` fades, blunder glow, camera push) only while playing or exporting. The camera push stays off in exports (`cameraPush: false` while `exporting`, as now).
- Export scale: `min(devicePixelRatio, 1920 / max(W, H))`, with output width and height rounded down to even numbers.
- Long one-line statements: split only the ones you are already changing (CLAUDE.md).
- Memory: one browser at a time in live tests and screenshots, with a `MemAvailable` watchdog for long runs (`~/.claude/CLAUDE.md`).

## Review Focus

1. **A window resized across the one-column switch, mid-game or mid-drag.** The layout flips without losing the selected piece, the promotion picker or the move list's scroll, and with no flicker loop at the boundary. Covered by Task 1's hysteresis test and Task 8's resize check.
2. **Larger text in a short landscape window (1280×600, 844×390).** Nothing is cut off: panels scroll inside themselves, and the graph moves or hides. Covered by Task 1's `Larger` cases and Task 8's sweep.
3. **Export started from a one-column phone page that is scrolled down.** The video is the screen-sized layout from the top, not the scrolled slice, and its size never changes mid-run. Covered by Task 7's test.
4. **The free board, a game, and Edit position at phone width.** The tray, the Game panel's buttons (Resign, Take back) and the explorer stay reachable. Covered by Task 8's sweep, which visits each view.
5. **A saved `textSize` from a future or older version** (an unknown string). It falls back to Default, never `NaN` sizes. Covered by Task 1's `textScale` test.

---

### Task 1: LayoutCore, the pure layout

**Files:**
- Create: `app/layout-core.js`
- Modify: `build.cjs` (add `['layout-core.js', …]` beside the other core units, before the JSX)
- Test: `tests/layout-core.test.cjs`

**Interfaces:**
- Produces `window.LayoutCore`:
  - `TEXT_SIZES = { Small: 0.9, Default: 1, Large: 1.15, Larger: 1.3 }`
  - `textScale(name: string) → number`: the factor, or 1 for an unknown name.
  - `compute({ w, h, text = 1, view = 'replay', video = false, prevCols = null }) → Layout`
    - `view` is one of `'replay' | 'free' | 'game' | 'edit'`.
    - `prevCols` gives hysteresis: switch at 360 px of board going down and 380 px going up.
  - `Layout = { cols: 1|2, w, h, board: {x, y, size}, eval: {x, w} | null, bars: {h, gap}, header, moves, comment, analysis, plot, tray, panel }`.
    - Each panel box is `{ x, y, w, h, scroll: true }`, or `null` where the view or size has none.
    - `h` is the content height: equal to the input `h` when `video`, and possibly larger when paused in one column (the page scrolls).
    - `moves.rows` is the number of 38×`text×0.8` px rows that fit (MoveList reads it, as now).
    - `eval` is `null` for `'game'` and `'edit'` (no eval bar): the board is centred in its column.
    - `tray` and `panel` are set only for `'edit'`. In two columns `panel` is the whole sidebar; in one column `tray` (two rows of 6 pieces) sits right under the board, with `panel` under it.
    - `'free'` and `'game'` have no `plot`. Its room goes to the panels.
- Layout rules (constants at the top of the file):
  - Margin 12 px, gap 10 px.
  - Player bar height `40 × text × 0.8`, gap 4.
  - Eval bar 28 px wide plus a 8 px gap.
  - Sidebar: header on top, Moves (fixed `230 × text` px wide) beside Commentary under it, Analysis under those.
  - One column, paused: the board is the width less margins (at most 900), then header, Commentary (`200 × text`), Analysis (`260 × text`) and Moves (`240 × text`).
  - One column, video: the same order with no header. The panels share what is left of `h` under the board, with minimums of 96/120/96 px. The board shrinks until those fit.

- [ ] **Step 1: Write the failing tests** in `tests/layout-core.test.cjs` (load with `loadUnit('layout-core.js')`). One `test()` each:
  - `two columns on a desktop`: `compute({ w: 1440, h: 818 })` gives `cols === 2`. The board size is ≤ 900 and ≥ 360. `moves.x >= board.x + board.size`. `plot.w` spans from margin to margin.
  - `boxes stay inside and never overlap`: for every `[w, h]` in `[[1920,1000],[1440,818],[1024,690],[1280,520],[768,950],[844,340],[390,770],[320,500],[2560,1000]]`, every `text` in `TEXT_SIZES`, every view and `video` in `[false, true]`: all non-null boxes lie within `[0, w] × [0, layout.h]`, no two overlap, and `board.size >= 200` (asserted with a message naming the case).
  - `stacking thresholds`: `[1024, 690]` gives 2 columns and `[768, 950]` gives 1. `[844, 340]` gives 2, with `plot` either inside the sidebar (`plot.x >= board.x + board.size`) or `null`.
  - `larger text stacks sooner`: there is a width where `text: 1` gives 2 columns and `text: 1.3` gives 1 (search 700–1100 at `h: 800`).
  - `board stops at 900`: `[2560, 1400]` gives `board.size === 900`, and the sidebar is wider than at `[1920, 1400]`.
  - `video fits the screen`: for `[390, 770, video: true]`, `layout.h === 770` and every box ends at or before 770. Paused, `layout.h > 770`.
  - `game and edit views`: `'game'` has `eval === null` and the board centred in the left column (within 1 px). `'edit'` in one column has `tray.y >= board.y + board.size` and `panel.y >= tray.y + tray.h`.
  - `hysteresis`: at the width where the board beside the sidebar is 370 px, `prevCols: 2` keeps 2 and `prevCols: 1` keeps 1.
  - `textScale`: `textScale('Larger') === 1.3`, and `textScale('Huge') === 1` and `textScale(undefined) === 1`.

- [ ] **Step 2: Run them to see them fail**
  Run: `node --test tests/layout-core.test.cjs`
  Expected: FAIL, `Cannot find module …layout-core.js`.

- [ ] **Step 3: Implement `app/layout-core.js`** as an IIFE assigning `window.LayoutCore`, in the style of `app/edit-core.js`: a header comment saying what it lays out, with plain functions inside. Compute the board size for two columns first, as `min(900, h − bars − plot − margins, w − sidebarMin − eval − margins)`. Use one column if it comes out under 360 (380 when `prevCols === 1`).

- [ ] **Step 4: Run them to see them pass**
  Run: `node --test tests/layout-core.test.cjs`, then `node --test --test-concurrency=1 tests/*.test.cjs`.
  Expected: all PASS (`build.test.cjs` still passes with the new unit in the page).

- [ ] **Step 5: Commit** `app/layout-core.js`, `build.cjs`, `tests/layout-core.test.cjs`: "LayoutCore: the page's boxes from the window's size".

### Task 2: Stage lays out at the area's size

**Files:**
- Modify: `app/engine.jsx` (`Stage`, `CompositionStage`, `FrameContext`, `SQUARE_OVER_SHORT`)
- Modify: `app/shell.html` (`.stage*` rules, lines ~53–131 and the `body:has(.stage…)` rules ~98–100 and ~245–254)
- Modify: `app/game-app.jsx:147-148, 581`

**Interfaces:**
- Consumes `LayoutCore.compute` and `LayoutCore.textScale` (Task 1).
- Produces:
  - `useFrame()` returns `{ w, h, cols, video, text, narrow }`, where `video = playing || forceVideo` and `narrow = w < 900`.
  - `Stage` props are `{ menu, top, onLayout, duration, background, playback, nav, still, forceVideo, text, children }`; the frame props (`width, height, compact, portrait, square, short`) are gone. `CompositionStage` passes the same.
  - `onLayout(phone: boolean, exportW: number)`: `phone` is true when `cols === 1 || narrow`. `exportW` is the export's pixel width: `even(W × min(devicePixelRatio, 1920 / max(W, H)))`.
  - Stage root classes are `stage`, plus `stage-one` in one column and `stage-narrow` under 900 px. These replace `stage-tall/-short/-square/-compact` in CSS, in the live tests' selectors, and in `game-app.jsx`.

- [ ] **Step 1: Replace the frame-picking `measure()`** with a ResizeObserver on `.stage-area` that stores `{ w: clientWidth, h: clientHeight }`. Keep it a `useLayoutEffect`, so a phone's first paint is already one column. The stage frame div gets `width: w`. Its height is `h` while `video`, else the layout's content height. It has no `transform: scale`. `.stage-area` scrolls vertically (`overflow-y: auto`) only when not `video`.
- [ ] **Step 2: Rewrite the stage CSS in `shell.html`** for the two classes. `.stage-one` keeps today's phone padding (safe-area insets, `padding-block: 2px 5px`) and the transport bar's phone sizes (`.pbtn` 30 px). The transport bar stays outside `.stage-area`, so it is pinned to the bottom. Move the Settings panel's `bottom`/`max-height` rules from `.stage-tall` to `.stage-one`.
- [ ] **Step 3: Update `game-app.jsx`.** Pass `forceVideo={video.busy}` and `text={LayoutCore.textScale(t.textSize)}` to `CompositionStage`, and drop `width/height/compact/portrait/square/short`. `onLayout` keeps setting `tall` (rename it `phone`) and `frameW` (now the export width).
- [ ] **Step 4: Check it loads.** Run `node build.cjs`, start `node tests/live/serve.cjs` (sandbox disabled), and open 1440×900 in Chromium. Expected: the page renders with no console errors. Panels may be misplaced until Task 3.
- [ ] **Step 5: Commit**: "Stage: lay out at the area's size, no scaled frame".

### Task 3: The replay view on the new layout

**Files:**
- Modify: `app/game-video-core.jsx`. Remove `LAYOUTS`, `COMPACT`, `PORTRAIT`, `tallLayout`, `SHORT`, `shortLayout`, `SQUARE`, `squareLayout` and `sm()`. Rewrite `setLayout` (lines 36–131). Also change `Panel` (206), `EvalBarView` (497), `PlayerBar` (525), `Header` (552), `MoveList` (599), `Commentary` (651), `Analysis` (691), `EvalPlot` (780), `TitleCard`/`EndCard` (857–916) and `GameVideo` (968–1121).
- Modify: `app/stockfish.jsx`, `app/tablebase.jsx`, `app/queen.jsx`. Their `px` font sizes inside panels go through `tx()`.

**Interfaces:**
- Consumes `useFrame()` (Task 2) and `LayoutCore.compute` (Task 1).
- Produces, in `game-video-core.jsx`:
  - `setLayout(frame, view = 'replay')`: sets the module's `L = LayoutCore.compute({ w: frame.w, h: frame.h, text: frame.text, view, video: frame.video, prevCols })`, and `TX = 0.8 × frame.text`.
  - `tx(px: number) → number`: `px × TX`, rounded to 0.1. Every font size, line height, icon and text-bearing padding inside panels and player bars uses it.
  - `BoardSpace({ children })`: an absolutely positioned 768×768 div at `L.board.x/y` with `transform: scale(L.board.size / BW)`, origin `0 0`. Board-space components (`Board`, `BoardTouch`, `LineBoard`, `Arrow`, badges) render inside it and position from 0,0. `BX`/`BY` go away.
  - `Panel` takes `box = { x, y, w, h, scroll }` (no `k`). The `translateY` entrance applies only while `a < 1`.

- [ ] **Step 1: Swap the layout plumbing.**
  - Rewrite `setLayout` and add `tx` and `BoardSpace`.
  - Delete the frame layouts and `sm()`. `sm(n)` becomes `tx(n)`, and `L.title`, `L.hint` and `L.pad` become fixed values through `tx` (15, 15, `${tx(16)}px ${tx(22)}px`).
  - `EvalBarView` sits at `L.eval.x`, at `L.board.y`, with height `L.board.size`. Its number uses `tx(22)`.
  - `PlayerBar` is placed from `L.board` and `L.bars`, with no `scale(L.bar.k)`.
  - `MoveList` row height is `tx(38)`, with columns `L.moves.cols || 1`. Two columns in one column whenever `L.moves.w ≥ 480`.
- [ ] **Step 2: Gate the video touches** in `GameVideo` on `const video = useFrame().video`:
  - `enter()` returns 1 when `!video`.
  - The camera push applies only when `video && tw.cameraPush`, centred on `L.board`.
  - The blunder glow `flash` and the final `fade` are 0 when `!video`.
  - `TitleCard` and `EndCard` render only when `video`. Their `card.k` and stack come from `tx` and `L.cols === 1`.
- [ ] **Step 3: Convert the panel contents.** Convert fonts in `stockfish.jsx`, `tablebase.jsx` and `queen.jsx` the same way (`font: \`500 ${tx(18)}px ${MONO}\``). Leave sizes that are in board space (badges, coordinates, arrows) alone: `BoardSpace` scales them with the board.
- [ ] **Step 4: Verify in both browsers.** Run `node build.cjs` and the server.
  - Screenshot the sample game, paused and mid-playback, at 1440×900 and 390×844 in Chromium, then Firefox, into `tests/out/live/`. Show the PNG paths.
  - Expected: board + sidebar on desktop and one column on the phone. No panel text is clipped without a scrollbar. Title card only while playing.
  - Then run `node --test --test-concurrency=1 tests/*.test.cjs`. Expected: PASS.
- [ ] **Step 5: Commit**: "Replay: real-size panels, scaled board, video touches only while playing".

### Task 4: Free board and games

**Files:**
- Modify: `app/free-board.jsx`. Remove `BOARD_LAYOUTS`/`boardLayout` (lines ~112–128) and `GAME_LAYOUTS`/`gameLayout` (~131–146). Change `FreeBar` (~18), `FreeBoard` (357–470), and every `px` font in `OpeningExplorer`, `StartAnalysis`, `GameInfo` and `GameStatus`.

**Interfaces:**
- Consumes `setLayout(frame, view)`, `tx`, `BoardSpace` and `Panel` (Task 3).
- `FreeBoard` calls `setLayout(useFrame(), board.game ? 'game' : 'free')`. The `L.zoom` wrapper goes; the game's bigger board comes from LayoutCore's `'game'` view.

- [ ] **Step 1: Make the replacements.** Remove the two layout derivations and the `L.zoom` wrapper. Put `LineBoard` and `BoardTouch` in `BoardSpace`. `FreeBar` gets placed as `PlayerBar` is. Convert fonts with `tx`. `z = L.comment.label || 1` and `L.comment.text` scale factors become 1.
- [ ] **Step 2: Verify.** Open the Starting position, a Play vs Stockfish game and a finished game at 1440×900 and 390×844, in Chromium then Firefox, and screenshot each.
  - Expected: no eval bar in a game, and the board centred in its column.
  - The Game panel's Resign and Take back are visible without page scroll on desktop, and reachable by scrolling on the phone.
  - Run `LIVE_URLS=local LIVE_ONLY='free board|game|Stockfish' node --test tests/live/site.test.cjs` (sandbox disabled) and note the failures that are layout assertions; Task 8 fixes those.
- [ ] **Step 3: Commit**: "Free board and games on the new layout".

### Task 5: Edit position

**Files:**
- Modify: `app/edit-board.jsx`. Remove `EDIT_LAYOUTS`/`editLayout` (lines ~22–34). Change `EditBoard` (~148–231), `Tray`, `editField` and `CastleBox` fonts.

**Interfaces:**
- Consumes `setLayout(frame, 'edit')`, which gives `L.tray` and `L.panel` (Task 1), plus `tx` and `BoardSpace` (Task 3).

- [ ] **Step 1: Make the replacements.**
  - `EditBoard` calls `setLayout(useFrame(), 'edit')`.
  - The tray piece size is `min(112, floor(L.tray.w / 6))` when `L.tray` is set; otherwise it is `min(84, floor((L.panel.w − 60) / 6))` inside the panel, as now without `k`.
  - The board goes in `BoardSpace`. `useEditInput` keeps working off `getBoundingClientRect`; check it does not read `BX`/`BY`, and if it does, read `L.board` instead.
- [ ] **Step 2: Verify.** Open Edit position at 1440×900, 390×844 and 844×390 in Chromium then Firefox, and drag a piece from the tray to the board and one off the board. Expected: both work, and the tray and FEN field are visible. Run `LIVE_URLS=local LIVE_ONLY='Edit position' node --test tests/live/site.test.cjs` and note the layout failures for Task 8.
- [ ] **Step 3: Commit**: "Edit position on the new layout".

### Task 6: Text size setting

**Files:**
- Modify: `app/shell.html`. Add `textSize: 'Default'` to `window.TWEAK_DEFAULTS` (line ~370). Set `html { font-size: calc(16px * var(--text, 1)); }`, and convert the overlay CSS's `px` font sizes (the dock, `.pbar`, `.twk-*` Settings, menus, dialogs, notes; about 56 rules) to `rem` (px / 16).
- Modify: `app/game-app.jsx` (Settings › Appearance, line ~634), and add an effect that sets `--text`.
- Test: `tests/live/site.test.cjs` (new subtest).

**Interfaces:**
- Consumes `LayoutCore.textScale` (Task 1), and `Stage`'s `text` prop (Task 2), already passed.
- `document.documentElement.style.setProperty('--text', LayoutCore.textScale(t.textSize))` runs on every change.

- [ ] **Step 1: Write the failing live subtest** `desktop: Text size Larger grows the text and keeps it in its boxes`.
  - At 1440×900, choose Settings › Appearance › Text size › Larger.
  - Assert the computed `font-size` of a `.mv` move is 1.3× (±0.2 px) what it was.
  - Assert the `.twk-panel`'s heading grew too.
  - Assert no element inside the stage has `scrollWidth > clientWidth + 1` with `overflow: hidden` (the overflow helper from Task 8, written here first).
- [ ] **Step 2: Run it to see it fail.**
  Run: `LIVE_URLS=local LIVE_ONLY='Text size' node --test tests/live/site.test.cjs` (sandbox disabled).
  Expected: FAIL, no `tw-text-size` radio.
- [ ] **Step 3: Add the setting.** Add `<TweakRadio id="tw-text-size" label="Text size" value={t.textSize || 'Default'} options={Object.keys(LayoutCore.TEXT_SIZES)} onChange={(v) => setTweak('textSize', v)} />` after Theme. Add the `--text` effect, and do the `rem` conversion.
- [ ] **Step 4: Run it to see it pass.** Same command. Expected: PASS in Chromium and Firefox.
- [ ] **Step 5: Commit**: "Settings: Text size".

### Task 7: Export at screen size

**Files:**
- Modify: `app/export.jsx:125-160` (`useVideoExport`), plus the `WEBP_WIDTHS` comment (line ~16).
- Modify: `app/game-app.jsx:420-427` (labels only, if the "(full)" width text needs it).
- Test: `tests/live/site.test.cjs` (the existing export subtests).

**Interfaces:**
- Consumes `forceVideo` (Task 2): `video.busy` is already true before the first frame, so the stage is in its screen-sized layout while the export measures it.
- The export draws `.stage-frame > div` at `W × H` CSS px, with html2canvas `scale: s`, where `s = min(devicePixelRatio, 1920 / max(W, H))`. The canvas is `even(W·s) × even(H·s)`. `webpEncoder` keeps taking a target width (`frameW` is now the export width, so Full/Half/fixed widths stay meaningful).

- [ ] **Step 1: Write the failing live subtests.**
  - `phone: an export is the screen-sized page`: at 390×844 with `deviceScaleFactor: 3`, scroll the page down 300 px, then export the first 2 moves as WebP at width Full.
    - Assert the saved file's width × height (parse the VP8X chunk; `webp-core.js` may already expose dimensions, so check `WebPAnim`) is `even(390·s) × even(stageH·s)`, where `s = min(3, 1920/stageH)` and `stageH` is the `.stage-area` height.
    - Assert every frame has that same size.
  - Update the desktop export subtest's expected size: it was 1920×1080, and is now `even(W·s) × even(H·s)` from the stage area.
- [ ] **Step 2: Run them to see them fail.**
  Run: `LIVE_URLS=local LIVE_ONLY='export' node --test tests/live/site.test.cjs`
  Expected: FAIL, wrong size.
- [ ] **Step 3: Implement.**
  - Wait one animation frame after `video.busy` turns true before measuring, so the screen-sized layout has rendered.
  - Scroll `.stage-area` to the top.
  - Pass `scale: s` to html2canvas and size the canvas as above.
  - Update the comments that say "1920×1080, or the portrait frame".
- [ ] **Step 4: Run them to see them pass.** Same command, Chromium then Firefox. Expected: PASS.
- [ ] **Step 5: Commit**: "Export: the screen-sized page at the screen's density".

### Task 8: Live layout sweep and the existing live tests

**Files:**
- Modify: `tests/live/site.test.cjs`. Replace the compact-frame subtest (lines ~472–495), update selectors `.stage-tall` → `.stage-one`, and fix any assertions that read frame coordinates.
- Modify: `tests/live/android.test.cjs` (the same selector and coordinate updates).
- Modify: `tests/live/board.cjs` (if its square-to-pixel helper assumes the frame's scale; it should read the touch layer's `getBoundingClientRect`).

**Interfaces:**
- Produces `overflowing(page) → string[]` in `site.test.cjs`. It lists a description of each element inside `.stage-frame` whose text is clipped: `overflow` hidden or clip, with `scrollWidth > clientWidth + 1` or `scrollHeight > clientHeight + 1`, excluding elements that scroll (`overflow-y: auto`) and `SideScroll` strips (`overflow-x: auto`). It also lists any panel box extending past the stage frame.

- [ ] **Step 1: Write the sweep subtest** `layout: nothing cut off at any size`.
  - Sizes: 1920×1080, 1440×900, 1280×600, 1024×768, 768×1024, 844×390, 390×844, 320×568 and 2560×1080.
  - For each size, at Text size Default and Larger, open the sample game paused at move 20. Then open the free board, then Edit position.
  - At each step assert `overflowing(page)` is empty, and that the transport bar's play button is inside the viewport.
  - Also resize 1100→700→1100 px wide while a piece is selected on the free board, and assert it is still selected (`.board-touch` selection square present).
  - Screenshots go to `tests/out/live/layout-<w>x<h>-<view>-<text>.png`.
- [ ] **Step 2: Run the whole live suite.** Run `LIVE_URLS=local node --test tests/live/site.test.cjs` (sandbox disabled, one browser at a time as the suite already does). Fix each failure: a layout bug goes in the app; a test that reads frame coordinates gets updated to read boxes. Expected at the end: PASS in Chromium and Firefox.
- [ ] **Step 3: Commit**: "Live tests: layout sweep at nine sizes, frame selectors updated".

### Task 9: Docs and the PR's screenshots

**Files:**
- Modify: `CLAUDE.md` (Gotchas: the `LAYOUTS.wide`/`tallLayout`/`.stage-tall` line becomes LayoutCore, `.stage-one`, `tx()`, `BoardSpace`; the Commands' "phone layout = 390×844" stays)
- Modify: `docs/spec.md`:
  - Move Responsive layout from Roadmap to Built, rewritten as built.
  - Rewrite the "playing video stays clean" principle as the spec says.
  - Update the Edit position "Layout" bullet, which names frames.
  - Drop the Known gaps that name frames (e.g. "scale with the frame on the phone").
  - Add a Decisions log line.
- Modify: `README.md`, if it describes the frame sizes or the export's 1920×1080.

- [ ] **Step 1: Make the doc edits** above (`grep -n "frame\|1920\|840\|tallLayout\|stage-tall" CLAUDE.md README.md docs/spec.md` to find them).
- [ ] **Step 2: Run the final checks.**
  - Run `node --test --test-concurrency=1 tests/*.test.cjs`, then `../chess-animator/.venv/bin/python -m unittest tests/check_browser_json.py`.
  - Expected: both PASS.
  - Show the user the desktop (1440×900) and phone (390×844) screenshots from Chromium and Firefox before the PR, per CLAUDE.md.
- [ ] **Step 3: Commit**: "Docs: responsive layout built". When the user asks for the PR, put the screenshots on `pr-screenshots` under `pr-<N>/` as CLAUDE.md describes, and embed them with captions.
