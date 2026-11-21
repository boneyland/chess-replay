# Audit 2026-11-19: correctness and debt
Commit: ba6a515 · Areas: 10 · Findings: 4/22/81 · Dropped on checking: 0 (2 moved; 4 duplicates merged)

## Summary
The rules engine is still sound. Move generation, repetition, the 50/75-move rules, clocks and the GamesCore shape all came out right on hand-made positions. Every pin in LAYOUT.md matches its file, and all twelve items of the last correctness plan are merged. Four highs were found. Two of them crash or derail the replay:
- `simulate()` mistakes any diagonal move by a promoted piece for en passant. The piece beside it vanishes, and when that piece moves later the page crashes, and keeps crashing after every reload, because the game is stored.
- Lowering Seconds per move while paused near the end makes the board jump back to mid-game. This is a side effect of the playhead clamp that fixed the last audit's low.

The other two:
- Queen's call log outlives the game it was written for and crashes the panel on a shorter game.
- The annotated PGN writer and the board PGN writer have drifted on Chess960 tags, against the 2026-11-13 decision.

Most mediums sit where the page is still live during long work: an export (keys and buttons behind a non-modal overlay, Edit position over the game, memory on long clips), a deploy (the service worker), and a game against Stockfish (a game-ending move left unrated, 960 critique text). On the debt side:
- `GameApp` has grown back to about 1,480 lines.
- `free-board.jsx` carries about 730 lines of dock dialogs unrelated to the board.
- The Transport bar's CSS has layers of overridden rules and hand-added offsets, and one of those offsets has already drifted.

Hot spots (last 300 commits): `app/game-video-core.jsx` 68, `app/shell.html` 56, `app/free-board.jsx` 37, `app/game-app.jsx` 35, `app/stockfish.jsx` 31.

## Fix plan
Done: item 1 merged 2026-11-19 (its open part 2026-11-20), items 2 to 4 on 2026-11-20, items 5 to 7 on 2026-11-21; the straight-to-`main` note below is done too. Each item is one PR on a `claude/<topic>` branch (they change the page; see CLAUDE.md's Workflow), in this order. Line numbers are at commit ba6a515: if they have moved, find the code by the quoted evidence. Tick an item here, with its PR, when it merges.

**First, straight to `main` (tooling and tests, no PR):** done 2026-11-19.
- [x] Put back the `HEAVY_TESTS` alternative `desktop: the Lichess explorer lists` in test.yml. That test had run in WebKit's main part, near its 30-minute limit, since PR 254 renamed it. (70e5f4c)
- [x] Add a node test that checks each `HEAVY_TESTS`/`ENGINE_TESTS` alternative matches a live subtest name: `tests/ci-patterns.test.cjs`. Two alternatives match two subtests each on purpose, so it asks for at least one, not exactly one. It fails on the old pattern.
- [x] Fix test.yml's stale "ESLint's warnings don't fail" comment. (70e5f4c)
- [x] Make `sw.test.cjs` read the vision cache name (`VisionCore.CACHE`, and the one before it) instead of hard-coding `chess-vision-1`. It passes with the name bumped to `chess-vision-2`.
- [x] Add `espree@10.4.0` (eslint 9.39.1's own range, `^10.4.0`) to both lint install lines, test.yml and CLAUDE.md.

(Medium and Low, Build.)

- [x] 1. **Replay crashes and jumps** (the three view highs): PR #274 (2f855e8).
  - `simulate` skips its en passant guess for a promoted piece (`!p.promo`). Add a node test for it: lift `simulate` into a core if that is what testing it takes.
  - `useHeldSchedule` finds the old ply from the unclamped `tl.time`.
  - `useQueen` clears `log`/`err`/`msg` when the game changes, or stores each entry's label when it is written.

  Add a live test for the schedule jump.

  Ride-alongs: Commentary's one render with the old book, `LINE_CACHE` unbounded, `useFlowHeight` rebuilding its observer every render, `GameVideo`'s unused `scheme` (Low, Replay).

  Done as planned: `simulate` became `ChessCore.pieceTracks`, with node tests. Queen stores each entry's label, and clears its error and note when another game loads, except the note for answers dropped with that game's PGN. All the ride-alongs are done except `useFlowHeight`.
  - [x] `useFlowHeight`: PR #276 (450a03c). Observing only resizes and added or removed panels was tried and backed out. It missed panels that move without resizing, and WebKit's layout test found the page 18–25 px taller than its frame at 320×568 and 390×400. So the observer is now made once per flowing view, but the page is still measured after every render.
  - [x] Follow-up from the ultrareview of #274: Queen answers dropped with a PGN are counted against that game, and their note goes with the next game loaded. PR #275 (0446874).
- [x] 2. **Game records and PGN**: PR #277 (93a3870).
  - One Chess960 tag builder shared by `annotatedPgn` and `BoardCore.pgnOf` (High).
  - `PlayCore.pgn` writes a Termination that `ending` reads back.
  - `playLine` gives standard SAN.
  - `boardAsGame` uses `boardPgn()`.
  - Back to the free board doesn't keep the game in My games again (Medium, Rules and App).

  Unit tests for each round trip.

  Ride-alongs: a NAG glued to a move, `%` lines, header-less games on one line, bare-fraction cutechess comments, one half-move-clock helper, the end order written twice (Low, Rules).

  Done as planned, ride-alongs included: `ChessCore.setupTags` for both writers, `ChessCore.halfMoves`, PlayCore's `posEnd`. `PlayCore.pgn`'s Termination is now `ending()`'s words (`Black resigned`, `Fivefold repetition`…; a flag fall stays `time forfeit`), free text where Lichess writes `Normal`.
- [x] 3. **Play vs Stockfish and board input**: PR #278 (2a47feb).
  - `critiqueText` skips a 960 castle's own rook.
  - A player's move that ends the game is rated from the before search.
  - Both board inputs ignore non-primary pointers and keep the drag's `pointerId`.
  - One keyboard-focus rule for BoardTouch and EditBoard (Medium, Boards and Replay).

  Ride-alongs: the free board's `useBoardFacts` without `known`; Hint's "ask again" reusing a null promise; the late dead-position recheck listening to the viewed position; BoardGroup's settle stuck after a swallowed release (Low).

  Done as planned, ride-alongs included: `PlayCore.drawnByYou` (a drawing move is rated from the search before it against 0, and says how it drew), `useKbFocus` (a focus within 300 ms of a pointer going down or up on the board is the press's; decisions log). A press is ignored only while another pointer drags on the board: `isPrimary` was tried first and dropped in review, as a finger resting elsewhere on the page blocked taps on the board. New live tests for each part, each failing on the code before.
- [x] 4. **Export while the page is live**: PR #279 (78ca7cd).
  - The export overlay modal (`DialogBox`, or `inert` on the stage and bar while `video.busy`). This covers the Transport bar's buttons, seek bar and Moves chips (reported by two areas; the unfinished half of 2026-11-09 item 4).
  - No Export or Ask Queen while Edit position covers a game.
  - No file drops during an export or under open dialogs.
  - Sound encoded with backpressure, and the file target not copied twice (Medium, Export and App).

  Ride-alongs: free the canvases outside `free()`'s reach, a double Export while a board picture renders, the stale export.jsx header, the dead `depth`/`dev` parameters (Low, Export).

  Done as planned, ride-alongs included: the overlay is modal by `useModal` in `app/export.jsx` (the rest of the page `inert`, Tab kept in it, Esc closes "Export failed", focus back to Share and export); Share and export says to close Edit position first; drops are refused during an export and under any dialog but Import game; the soundtrack is rendered 30 s at a time (`Sfx.renderTrack`'s `chunks()`) and fed on the encoder's `dequeue`. Only `depth` was dead (`dev` is used, so kept). The memory saving was not measured on a device. New live tests for each part, each failing on the code before.
- [x] 5. **Offline after a deploy**: PR #281 (1aa8bb7).
  - `cacheFirst` falls back to the kept copy when another version's fetch fails.
  - Handle a page older than its worker: drop `skipWaiting`/`claim`, keep the previous cache while a client uses it, or reload on `controllerchange` (the unfinished half of 2026-11-09 item 6).

  Ride-alongs: the "never a comment's" CDN-URL overclaim, `VENDOR` derived from vendor/, ESLint's worker globals, the page name and `/` rewrite written in four places (Low, Build).

  Done as planned, ride-alongs included. `skipWaiting`/`claim` stay; another deploy's `?v=` is answered from that deploy's cache (`chess-replay-<v>`), then the network, then (offline) this deploy's plain copy; older caches are kept while a window shows a page this worker didn't serve, the two newest at most, and never deleted while a newer worker installs or waits (decisions log, 2026-11-21). The page's name and rewrite are `render-headers.cjs`'s `page()`, read from render.yaml. Unit tests only for the worker (`tests/sw.test.cjs`); the two-tab case wasn't run in a browser.
- [x] 6. **Panel messages and the Transport bar CSS**: PR #283 (dd65ce8).
  - The tablebase-lost note survives the run's commit.
  - Queen's 4xx answers say what happened.
  - The explorer and tablebase re-ask after a back-off or coming back online (Medium, Engines and Online).
  - In `shell.html`, one `--pbar-total` that every panel offset reads. This fixes Settings covering the bar at 1181+ px wide and 500–560 px tall.
  - Delete the overridden Transport bar declarations (Medium, Layout). Screenshot Chromium and Firefox at each tier, as CLAUDE.md asks for layout changes.

  Ride-alongs: `EngineEmptyState` without its reason, the stored partial-run shape check, Queen's POST timeout and HF token expiry, one `.sr-only`, the dead `.q-evalsf`, the theme-colour copies in `.q-tag` and the check glow (Low).

  Done as planned, ride-alongs included. The retry is `useLichessRetry` (on `online`, when a 429 back-off ends, else 30 s doubling to 5 min). `--pbar-total` is set on `body` per layout and the bar's `--pbar-pb` is worked out from it; the bar's box was measured unchanged at six sizes in Chromium and Firefox. Also in the PR, at the user's request: the sideways phone's slim folded menu starts under 400 px tall (it was 350). New live tests for the three message fixes and the Settings overlap, each failing on the code before.
- [x] 7. **Split the big views** (the largest; last): PR #282 (12032e8).
  - `GameApp`: the dock into a component, the editor and vision flow into a hook, close Queen once on a `gameKey`/`onBoard` change.
  - The dock dialogs out of `free-board.jsx` into a joined `dialogs.jsx`, added to `build.cjs`'s list.
  - `FrameButton` out of `stockfish.jsx`.

  (Medium, App and Boards; Low, Engines.) No behaviour change: the live tests stay unedited as the proof.

  Done as planned: `Dock` (`app/dock.jsx`), `useEditorFlow` (`app/edit-board.jsx`), `app/dialogs.jsx`, `FrameButton` in game-video-core.jsx's shared UI; Queen's panel closes in the render a new game or the board arrives (a Queen file with its PGN keeps it open). game-app.jsx 1957 → 1681 lines, free-board.jsx 1869 → 1137. The live suite passed unedited (277/277, Chromium and Firefox, locally).

  CI on these PRs met an old WebKit flake (2026-11-20 on `main` too): the page's own HTML never arrived in 30 s from the live tests' server. Fixed on `main` in ca5a779 (the server keeps idle keep-alive connections open); likely, not proven.

The rest can ride along with the PR that touches the same file, or wait for the next audit.

## Since the last audit
[2026-11-16-apple-design.md](2026-11-16-apple-design.md): items 1–7 are done. Item 8 (touch targets of 44 px on a coarse pointer) is still open. Tonight's BoardGroup settle and drag-scroll findings are new and were not in that report.

[2026-11-12-docs.md](2026-11-12-docs.md): items 1–8 are done.

[2026-11-09-correctness.md](2026-11-09-correctness.md): items 1–6 are ticked, but two are only half done:
- **Item 4**, keys during an export: Stage and `useReplayNav` are guarded. The Transport bar's seek bar, Play and step buttons and the Moves chips still act. Now Medium, merged into this plan's item 4.
- **Item 6**, Worker URLs versioned: a page newer than its worker is handled; a page older than its worker, after `skipWaiting`/`claim`, is not. Now Medium, this plan's item 5.

The playhead-past-the-duration low was fixed by Stage's clamp, and that clamp is what exposes the new `useHeldSchedule` high.

Its lows:

| Status | Lows |
|---|---|
| Fixed | the stale `engine.status` closure; 'unavailable' after a single-thread failure; `pyParse` nan/inf; the SSE timeout, raw errors and retry; KeptFiles Cancel; the tweaks migration's try; the end-of-game sound at the clip start; Safari's interrupted AudioContext; the cutechess "3/4 of players" text; TimeControl `40/7200:3600`; `splitGames` on a tag inside a comment and header-less games on separate lines; GamesCore's unreadable list (set aside once); `enc.cancel()` reported as a failure; the PNG encode race; VERSION coverage; opaque CDN responses; `keep()` timeout; rust-toolchain.toml; LAYOUT.md's VISION_CACHE wording; Home and ← in the Moves list; the running clock's highlight; Try again unrated |
| No longer applies | the 600 ms pause charged to Stockfish (now intended, and commented); the `i` flag in `pyParse` |
| Still holds | `LINE_CACHE` unbounded; Commentary's one render with the old book; stored partial runs checked only with `Array.isArray` (worse than reported: a malformed entry makes every Start throw until Clear saved data); sf-engine.js's stale header; the dead-core timeout, its cache and no back-off; `useFirstDead` caching null; a wasm trap posting nothing; two tabs' settings; the layer cache key (latent); a read with no timeout after a one-thread load; the negative board size (only under about 30 px wide); CDN URLs in comments (partly fixed) |
| Known gaps, still hold | kept files' resume and peak; cursed wins under Draw; My games › Replay without the analysis; Play vs Stockfish unrated moves; the flag fall in a dead position; two tabs' My games; draw claims only on the board; `R3K1R1 … KQ` read as 960; Chess960 Castle buttons only in the own-line branch; CastleAsk sized in board pixels |

## Findings
### High
- [high] [bug] [app/game-video-core.jsx:638](../../app/game-video-core.jsx#L638) - `simulate()` treats any diagonal move by a promoted piece onto an empty square as en passant, and deletes the piece standing beside the from-square on the target file.
  evidence: `if (p.type === 'p' && f[0] !== t[0] && !board[t]) { const epSq = t[0] + f[1]; if (board[epSq]) { … delete board[epSq]; } }`. A promotion sets only `p.promo` (line 656), so `p.type` stays `'p'`.
  scenario: `2r4k/1P6/8/8/8/8/8/K7 w - - 0 1`, `1. b8=Q Kg7 2. Qc7+ Kg6`: the rook on c8 vanishes from the replay board, and the material count is wrong from then on. With `2... Rxc7` the view's `useMemo` throws (`reading 'type'`) and the page goes to the crash screen. The game passes `buildGame`, so it is stored and the crash comes back after a reload until Clear saved data. Both were run in node on a copy of `simulate`.
  fix: `p.type === 'p' && !p.promo && …`, with a node test. confidence: sure
- [high] [bug] [app/game-video-core.jsx:4096](../../app/game-video-core.jsx#L4096) - When the schedule gets shorter while paused late in the game, the board jumps back to a mid-game move.
  evidence: `CompositionClock` passes `T = Math.min(tl.time, derived.total)`, already clamped to the new total ([engine.jsx:861](../../app/engine.jsx#L861)). `useHeldSchedule` then finds the old ply with `lastPly(T0, p)` from that clamped time and moves the playhead there in a layout effect. Stage's clamp ([engine.jsx:267](../../app/engine.jsx#L267)) runs later and finds nothing to do.
  scenario: a 40-ply game at 1.6 s per move (about 79 s). Pause on the last move and set 0.8 s per move: the board, Moves list and Analysis show about move 11. Turning Commentary off does the same, and that is the very case the function's comment says it handles.
  fix: find the old ply and offset from the unclamped `tl.time`. confidence: likely (read, not run)
- [high] [bug] [app/queen.jsx:883](../../app/queen.jsx#L883) - Queen's call log belongs to the visit, not the game, and is labelled against the game loaded now. An entry past the new game's end crashes the page.
  evidence: `useQueen` runs once in GameApp ([game-app.jsx:477](../../app/game-app.jsx#L477)), and `log`/`err`/`msg` are never reset (only `note()` calls `setLog`). Only `QueenPanel` is keyed by `gameKey`. The log renders `posLabel(M, x.at)` → `sanOf(M, at - 1)` → `M.plies[at-1].san`, which throws past the end. React renders the `<pre>` even inside a closed `<details>`.
  scenario: Ask Queen at move 40, load a 25-move game, open Ask Queen again: the crash screen. With a longer game there is no crash, but the old entries are named after the new game's moves.
  fix: clear them when the game changes, or store each entry's label. confidence: likely (read)
- [high] [debt→bug] [app/chess-core.js:1449](../../app/chess-core.js#L1449) - The annotated PGN writer and the board writer ([board-core.js:52](../../app/board-core.js#L52)) have drifted on Chess960. Only `pgnOf` follows the 2026-11-13 decision ("tagged `[Variant "Chess960"]` whenever its start has 960 castling rights").
  evidence: `annotatedPgn` only does `if (M.start && M.start.fen !== START_FEN) { H.SetUp = '1'; H.FEN = … }` and never checks `is960`. `pgnOf` writes Variant when `label960(…) !== undefined || is960(b.start.pos)`, and SetUp/FEN whenever 960.
  scenario: a 960 game loaded without a Variant tag (or from an analysis file with a 960 `start_fen`) is saved as an annotated PGN with a `KQkq` FEN and no Variant, so other tools read its `O-O` as standard and illegal. Position 518 with Variant loses SetUp/FEN in one writer but not the other. Run in node.
  fix: one tag builder for both writers. confidence: sure (output); how Lichess reads it: likely

### Medium
**Rules and records**
- [medium] [bug] [app/play-core.js:732](../../app/play-core.js#L732) - `PlayCore.pgn` writes `Termination "normal"` for every end except time, and `ending()` can only read the reason back from it. A resigned game reopened from My games says "Black wins", not "White resigned". Agreed draws, claims, fivefold and 75-move all come back as "Draw". The round trip was run. confidence: sure
- [medium] [bug] [app/chess-core.js:1577](../../app/chess-core.js#L1577) - `playLine` pushes each variation token as written (`e2-e4`, `0-0`, figurines), not standard SAN (decision 2026-10-30). A PGN-only game's Better line shows them. `fenAfter` counts the half-move clock from SAN text, so a figurine pawn move (`♙e6`) is miscounted. Run. fix: `sanOf(pos, …)` as `replay`'s `canon` does. confidence: sure (narrow trigger)

**Engines and online services**
- [medium] [bug] [app/stockfish.jsx:480](../../app/stockfish.jsx#L480) - The "tablebase stopped answering" note is wiped as soon as a finished run commits. The run's own `commit` changes `files.analysis`, which is in the effect's deps, and the cleanup does `setSt(SF_RUN_IDLE)`. spec/lichess.md:18 says the note stays until the next run starts, so a completed run never tells the viewer its endgames are Stockfish's. confidence: sure
- [medium] [bug] [app/queen.jsx:81](../../app/queen.jsx#L81) - Every non-2xx answer apart from 401/403 is `server_unavailable`, and `queenError` ([:18](../../app/queen.jsx#L18)) shows "It may be busy, waking up or out of ZeroGPU quota. Try again in a minute" without reading the status. A renamed endpoint (404/422) is reported as busy forever. confidence: sure
- [medium] [bug] [app/tablebase.jsx:17](../../app/tablebase.jsx#L17), [app/explorer.jsx:141](../../app/explorer.jsx#L141) - A `null` answer (offline, a 429 back-off, a timeout) is never asked again for the position on the board. The effects are keyed only on the position (`[tbKey]`, `[key, token]`). The Tablebase box keeps "Not available" until the viewer steps away and back. confidence: sure

**Replay**
- [medium] [bug] [app/export.jsx:474](../../app/export.jsx#L474), [app/engine.jsx:666](../../app/engine.jsx#L666) - During an export, the controls behind the overlay still work.
  evidence: the overlay is a hand-made `role="dialog"`, not modal, with no `inert`, contrary to the 2026-11-16 dialogs decision. Closing Share returns focus to the Share button behind it. The seek bar's `onKeyDown`, Play, the step buttons (Enter) and the Moves chips' `moveKey` ([game-video-core.jsx:2844](../../app/game-video-core.jsx#L2844)) still seek or play, and Settings can change the layout under a canvas sized at the start.
  scenario: a keyboard user Tabs to Next move mid-export and presses Enter: a frame from the wrong moment goes into the file. Reported by two areas (Replay, Export). The unfinished half of 2026-11-09 item 4. confidence: likely
- [medium] [bug] [app/game-video-core.jsx:3934](../../app/game-video-core.jsx#L3934), [app/edit-board.jsx:159](../../app/edit-board.jsx#L159) - Neither board input checks `isPrimary` or a pointer id (grep: no `isPrimary` in app/).
  scenario: a finger holding a piece plus a second finger on a target plays the move. In Edit position, a second finger takes over the drag.
  confidence: likely (read, not run on a device)
- [medium] [debt→bug] [app/game-video-core.jsx:1932](../../app/game-video-core.jsx#L1932) - Keyboard focus is decided two ways: BoardTouch uses `performance.now() - pressedAt > 50`, EditBoard ([edit-board.jsx:459](../../app/edit-board.jsx#L459)) uses `:focus-visible`. No decision records either.
  scenario: on a touch screen the tap focuses at the compatibility mousedown, after the finger lifts, so a tap held over 50 ms reads as keyboard focus. The cursor ring shows and the live region speaks. Edit position has the Firefox Tab problem that BoardTouch's comment describes.
  confidence: likely (not run on a device)

**App**
- [medium] [bug] [app/game-app.jsx:883](../../app/game-app.jsx#L883) - `boardAsGame` uses `BoardCore.pgn`, while `boardPgn` ([:1073](../../app/game-app.jsx#L1073)) and My games › Replay use `PlayCore.pgn` for a game. Replay these moves as a game on a finished game drops the names, result, TimeControl, Termination and clocks. Copies drifted. confidence: sure
- [medium] [bug] [app/game-app.jsx:1810](../../app/game-app.jsx#L1810) - Back to the free board calls `commitBoard(b)` with `prev = board` null. That passes the "game changed" test ([:229](../../app/game-app.jsx#L229)) and keeps the game in My games again, so a game deleted meanwhile comes back at the top. This breaks the rule in the comment at 222. confidence: sure
- [medium] [bug] [app/game-app.jsx:1534](../../app/game-app.jsx#L1534) - While Edit position covers a loaded game, Share still offers Export video (`board` is null; Share is reachable, see `editing ? null` at [:745](../../app/game-app.jsx#L745)). The export captures `.stage-frame > div`, which is now the editor. `askable` also keeps Ask Queen, whose arrows have no board. confidence: likely
- [medium] [debt] [app/game-app.jsx:371](../../app/game-app.jsx#L371) - `GameApp` is about 1,480 lines again. It was 740 after the PR 174 split.
  Its jobs:
  - about 14 dialogs' state
  - the editor and vision flow (~130 lines)
  - the loaders (~200)
  - `startGame` (~60)
  - the engine menu (~100)
  - the dock JSX (~240)
  - save, export and copy

  "Close Queen on load" is written by hand in 12 places. confidence: sure

**Boards**
- [medium] [bug] [app/play-core.js:448](../../app/play-core.js#L448) - In Chess960, `critiqueText` reads a king-takes-rook castle in Stockfish's line as a capture of the castler's own rook. `rk5r/…/RK5R b KQkq -`, you = w, pv `a7a6 b1a1` → "that drops the rook" (run). confidence: sure
- [medium] [bug] [app/free-board.jsx:266](../../app/free-board.jsx#L266) - A player's move that ends the game against Stockfish is never rated: stalemate, threefold, fifty moves, insufficient material or a dead position. The effect returns when `!active` and cancels the before search, and only the reply branch rates. Stalemating a won K+Q v K says "No moves flagged". Not among the known gaps. confidence: sure
- [medium] [debt] [app/free-board.jsx:1092](../../app/free-board.jsx#L1092) - About 730 lines (40%) of the third most-changed file are dock dialogs unrelated to the board:
  - `DialogBox` (used by five files)
  - Import, Play, Leave, My games, Chess960 and Keyboard shortcuts

  `SHORTCUTS` is a hand mirror of five files' key handlers and of `BOARD_KEYS` ([game-video-core.jsx:1814](../../app/game-video-core.jsx#L1814), whose comment wrongly says the dialog reads it). There is no drift today. Reported by two areas. confidence: sure

**Export**
- [medium] [bug] [app/export.jsx:143](../../app/export.jsx#L143) - A long MP4/WebM export holds several whole-clip copies at once:
  - the soundtrack as one Float32 `AudioBuffer` ([sfx-core.js:160](../../app/sfx-core.js#L160), ~230 MB for 10 minutes);
  - every `AudioData` queued with no `encodeQueueSize` backpressure;
  - the `BufferTarget` copied into `new Blob([output.target.buffer])` while still held ([:254](../../app/export.jsx#L254)).

  On a phone that can reload the tab mid-export. confidence: likely (not measured)

**Layout and shell**
- [medium] [bug] [app/shell.html:494](../../app/shell.html#L494) - At 1181+ px wide and 500–560 px tall, the Settings panel's `bottom: calc(52px …)` sits 8 px into the 60 px bar (`--pbar-h` 48 + `--pbar-pb` 12). The 76 px override at :508 needs `min-height: 561px`. Example: a 1440×540 window with Settings open. confidence: likely (cascade read, not screenshotted)
- [medium] [debt] [app/shell.html:144](../../app/shell.html#L144) - Every overlay's `bottom` is a literal sum of the bar's per-tier heights (70, 51, 52, 76, 44, 45, 42, 41, 4 px), with the arithmetic only in comments. One has already drifted (the finding above). fix: `--pbar-total`. confidence: sure
- [medium] [debt] [app/shell.html:164](../../app/shell.html#L164) - The Transport bar's older rules are overridden by the full-height bar block (229–267). Checked pairs:
  - :164 `.stage-one .pbar` padding, gap and margin lose to :236, :254 and :255;
  - :211 and :213 (`.stage-short` button heights) lose to :238 (same specificity, later);
  - also :79–82, :136–137, :203, :210, :221 and :222.

  Editing them changes nothing. confidence: sure for the pairs checked, likely for the rest

**Build, deploy, offline**
- [medium] [ci] [.github/workflows/test.yml:71](../../.github/workflows/test.yml#L71) - `HEAVY_TESTS`'s `desktop: the Lichess explorer asks` matches no subtest (grep: 0) since PR 254 renamed it. WebKit's main part, which test.yml says keeps hitting its 30-minute limit, carries it again. Nothing catches a rename. confidence: sure
  *Fixed 2026-11-19 (70e5f4c), and `tests/ci-patterns.test.cjs` now catches a rename.*
- [medium] [offline] [app/sw.js:165](../../app/sw.js#L165) - Offline after a half-installed deploy, the page's engine, prover and export files fail.
  evidence: `page()` ([:109](../../app/sw.js#L109)) stores a new deploy's page in the old worker's cache. `cacheFirst` sends another version's `?v=` straight to the network with no fallback.
  scenario: the viewer goes offline before the new worker installs. The next visit loads the new page from the old cache, and every `?v=N+1` request fails, though plain-URL copies sit in that cache.
  confidence: likely
- [medium] [race] [app/sw.js:62](../../app/sw.js#L62) - A page older than its worker gets the new deploy's Worker files.
  evidence: after `skipWaiting`/`claim` and the old caches deleted (:73), the old tab's `?v=old` requests go to the network, which serves the current deploy. Nothing listens for `controllerchange`.
  scenario: a deploy that changes `dead-worker.js`'s messages, the engine glue or Mediabunny breaks that tab's prover, engine restart or export. The comment at :154 covers only the newer-page direction. The unfinished half of 2026-11-09 item 6.
  confidence: sure (mechanism)

### Low
Unchecked unless marked. Grouped by area.

**Rules and records**
- [app/chess-core.js:780](../../app/chess-core.js#L780) - The half-move clock is counted from SAN text twice (also [play-core.js:148](../../app/play-core.js#L148)), so it is right only while every SAN is standard.
- [app/play-core.js:175](../../app/play-core.js#L175) - The end order (mate, stalemate, insufficient, dead) is written twice, in `outcome` and in `ending` (:583).
- [app/chess-core.js:1406](../../app/chess-core.js#L1406) - The move number is computed as `Math.floor((ply0+i)/2)+1` outside `ChessCore.moveNo` in seven places: chess-core ×4, settings-tabs:188, stockfish:759, share-dialog:153. They agree today.
- [app/chess-core.js:1605](../../app/chess-core.js#L1605) - Three FEN readers; `posFromFen` keeps an unknown castling field as raw text.
- [app/chess-core.js:502](../../app/chess-core.js#L502) - Two `canCastle` with different meanings (ChessCore: standard homes; EditCore: 960-aware). Dead exports: `CASTLE_HOME`, and PlayCore's `MIN_RATED_DEPTH`, `SHALLOW_DEPTH` and `BIG_LOSS_CP`.
- [app/chess-core.js:1151](../../app/chess-core.js#L1151) - chess-core.js (1,930 lines) carries the ~210-line video timeline (`plan` … `lineStep`). `sansOfPv` repeats the PV walk above it.
- [app/chess-core.js:287](../../app/chess-core.js#L287) - A NAG glued to a move (`e4$1`) throws; a `%` escape line throws; header-less games on one line merge (all run).
- [app/chess-core.js:356](../../app/chess-core.js#L356) - The cutechess regex still reads bare fractions (`{1/2}`, `{2/3 0.5s}`) as evals (run).
- [app/game-app.jsx:205](../../app/game-app.jsx#L205) - An unreadable My games list is set aside only once; a second one is overwritten.

**Engines and analysis**
- [app/stockfish.jsx:376](../../app/stockfish.jsx#L376) - A stored partial run is checked only with `Array.isArray`. A malformed entry makes every Start throw, and the catch never clears it (from 2026-11-09, worse than reported; checked).
- [app/stockfish.jsx:312](../../app/stockfish.jsx#L312) - "Full's threaded build didn't run here" shows when Lite's threads failed, and Remove hides while the 99 MB copy stays.
- [app/stockfish.jsx:740](../../app/stockfish.jsx#L740) - `EngineEmptyState` says "Stockfish can't run here." without the reason (spec/replay.md:51), and uses a straight apostrophe.
- [app/stockfish.jsx:165](../../app/stockfish.jsx#L165) - An engine dropped while starting runs on until its start ends, and can turn threads off page-wide.
- [app/stockfish.jsx:275](../../app/stockfish.jsx#L275) - The asm.js engine starts 1.5 s after every load even with the Stockfish switch off (unsure: may be intended).
- [app/stockfish.jsx:1](../../app/stockfish.jsx#L1) - 1,057 lines and about 12 jobs, including `FrameButton` (shared UI), so UI commits churn the engine file. `fmtSf`/`fmtEval` are two formatters.
- [app/analysis-core.js:623](../../app/analysis-core.js#L623) - Dead exports `winningChances`, `tbDecided`, `engineLines` and `SFEngine.HANG_MS`.
- [app/analysis-core.js:303](../../app/analysis-core.js#L303) - The `PACE_START` comment says single-thread Full, but the factor serves threaded Full too. [app/sf-engine.js:6](../../app/sf-engine.js#L6)'s header is still stale.

**Online services**
- [app/tablebase.jsx:14](../../app/tablebase.jsx#L14) - The effect is keyed by `tbKey`, the answer matched by full FEN. A FEN differing only in the move number stays "Looking up…".
- [app/lichess-core.js:332](../../app/lichess-core.js#L332) - After a 401, the token retry fails CORS and is shown as "offline, or busy" (wording only).
- [app/queen.jsx:69](../../app/queen.jsx#L69) - The first POST has no timeout of its own.
- [app/queen.jsx:118](../../app/queen.jsx#L118) - The HF token's expiry is checked only at load.
- [app/tablebase.jsx:156](../../app/tablebase.jsx#L156) - Tablebase rows don't use `useRowFocus`, so focus falls to `body` after Enter (moved from medium: keyboard only).
- [app/explorer.jsx:210](../../app/explorer.jsx#L210) - `ResultBar` hard-codes the chip colours (`#15100d` against `#efe8de`). The explorer row and the book row ([free-board.jsx:85](../../app/free-board.jsx#L85)) are two copies, already drifted (`tx(10)` vs `tx(14)`, aria-label).
- [app/tablebase.jsx:96](../../app/tablebase.jsx#L96) - The uppercase mono label is written out in eight places; "Not available" heading plus note ×2.
- [app/lichess-core.js:196](../../app/lichess-core.js#L196) - Stale comments: "needs a Lichess token"; "Settings › Online data" ×3; `merge`'s "newest entries" (queen-core:314).

**Replay**
- [app/game-video-core.jsx:1222](../../app/game-video-core.jsx#L1222) - `LINE_CACHE` is unbounded (from 2026-11-09).
- [app/game-app.jsx:1105](../../app/game-app.jsx#L1105) - Commentary reads the old game's book for one render (from 2026-11-09).
- [app/game-video-core.jsx:336](../../app/game-video-core.jsx#L336) - BoardGroup's settle sets `button` for any button and clears it only on `pointerup`. After a right-click menu swallows the release, scrolls stop settling, contrary to the 2026-11-19 decision.
- [app/game-video-core.jsx:4449](../../app/game-video-core.jsx#L4449) - "Position changed" is keyed three ways (here, [free-board.jsx:738](../../app/free-board.jsx#L738) `fen|ucis` ×3, module `posKey` at 1224, which the local shadows). Reported by two areas.
- [app/game-video-core.jsx:174](../../app/game-video-core.jsx#L174) - `useFlowHeight`'s effect has no deps: the ResizeObserver is rebuilt and the page measured on every render.
- [app/game-video-core.jsx:222](../../app/game-video-core.jsx#L222) - `PIN_STEPS = 10` must match the 11 hand-written keyframe stops in shell.html:198. The eval number size is written twice.
- [app/game-video-core.jsx:1104](../../app/game-video-core.jsx#L1104) - Duplicates:
  - the check glow `rgba(228,85,63,…)` ×3 next to `BOARD.blunder` (reported by two areas);
  - the last-move highlight ×2;
  - the progress line ×2;
  - the promotion name map repeats `PIECE_NAME`.
- [app/game-video-core.jsx:2040](../../app/game-video-core.jsx#L2040) - The promotion picker's squares are `role="button"` that can't be activated.
- [app/game-video-core.jsx:553](../../app/game-video-core.jsx#L553) - `coordInk` reads `MORE_MQ` with no change listener.
- [app/game-video-core.jsx:4381](../../app/game-video-core.jsx#L4381) - Reduced motion is read four ways, and `CALM` is set only by GameVideo's render.
- [app/game-video-core.jsx:4315](../../app/game-video-core.jsx#L4315) - `nav.current` has three writers, already drifted (`hasFirst`/`first`/`line`). In the replay, Back to start is enabled by `hasPrev` but `seek(0)` does nothing with an own line from the start.
- [app/game-video-core.jsx:4397](../../app/game-video-core.jsx#L4397) - Overgrown: GameVideo (~354 lines) and Analysis (~322, two near-copied OwnMoveAnalysis branches); BoardGroup (~180), AnalysisPanel (~207), BoardTouch (~165).
- [app/game-video-core.jsx:4181](../../app/game-video-core.jsx#L4181) - The three `useMoveEval` wrappers' no-engine fallbacks have drifted, and the `bestSan` code is ×2. Harmless today.
- [app/game-video-core.jsx:4397](../../app/game-video-core.jsx#L4397) - GameVideo's `scheme` prop is unused.
- [app/game-video-core.jsx:969](../../app/game-video-core.jsx#L969) - Stale comments (two "thin:" lines, `nextLinesOf` above `nextArrows`). Arrow's locals `L`/`tx` shadow the module's.

**App, settings and sharing**
- [app/game-app.jsx:1026](../../app/game-app.jsx#L1026) - A file dropped on the window loads under any dialog but Import and vision, and during an export.
- [app/game-app.jsx:984](../../app/game-app.jsx#L984) - A Queen file that doesn't apply (no answers; free board; 960) gives no message.
- [app/game-app.jsx:423](../../app/game-app.jsx#L423) - Import › Position from image loses the paste text, and the editor's Cancel doesn't come back to Import (the comment says it does).
- [app/game-app.jsx:166](../../app/game-app.jsx#L166) - Every board move rewrites `lastGame` (the whole loaded game) to storage. When it fails, Back to the loaded game is dropped silently.
- [app/game-app.jsx:173](../../app/game-app.jsx#L173) - Two "is this the plain sample" tests disagree (173 vs 183), so a re-analysed sample is lost on leaving it.
- [app/share-dialog.jsx:129](../../app/share-dialog.jsx#L129) - The export clip resets on any change of `M` (an analysis landing), not only a new game.
- [app/game-app.jsx:435](../../app/game-app.jsx#L435) - `fenNote`'s success path is dead; stale comments (`webpSize` "once, when the dialog opens").
- [app/settings-tabs.jsx:538](../../app/settings-tabs.jsx#L538) - The board colour defaults are written three times (Reset colours hard-codes them). The slider mapping is ×3, `sayFrom` ×2.
- [app/share-dialog.jsx:97](../../app/share-dialog.jsx#L97) - The `webpSize` migration is in a component effect, not `useTweaks`' `carry`.

**Boards and dead positions**
- [app/free-board.jsx:822](../../app/free-board.jsx#L822) - The free board passes no `known` to `useBoardFacts`, while the replay passes `pastDead`. Drifted.
- [app/free-board.jsx:368](../../app/free-board.jsx#L368) - Hint's "ask again" awaits the same null promise.
- [app/free-board.jsx:833](../../app/free-board.jsx#L833) - The late-answer recheck listens to the viewed position's dead flags, not the last one's.
- [app/free-board.jsx:747](../../app/free-board.jsx#L747) - `askHint` reads a `latest` ref declared 80 lines below it; RuleBlock and CastleButtons JSX ×2.
- [app/free-board.jsx:487](../../app/free-board.jsx#L487) - GameStatus (~220 lines) is two near-copies for computer and human, already worded differently.
- [app/edit-core.js:125](../../app/edit-core.js#L125) - No piece-count limit: a 33+ piece setup goes to Stockfish (unsure).
- [app/dead-core.js:67](../../app/dead-core.js#L67) - The 5 s timeout includes the wasm compile, a timeout is cached as `undecided` for good, and there is no back-off (from 2026-11-09). [app/dead.jsx:66](../../app/dead.jsx#L66) caches null when the worker was down. [app/dead-worker.js:16](../../app/dead-worker.js#L16): a trap posts nothing.

**Export and vision**
- [app/vision.jsx:83](../../app/vision.jsx#L83) - A transparent picture is shown on the panel colour in the crop step and in Edit position, while the reader sees it on white.
- [app/export.jsx:210](../../app/export.jsx#L210) - Canvases outside `free()`'s reach: `cv`, `hold`, the WebP `out`, the warm-up capture, and `next` on a throw.
- [app/export.jsx:2](../../app/export.jsx#L2) - The header is stale (the painter draws most layers now). "0.2 s a frame" vs Share's 0.04. The interface comment sits above the sound code.
- [app/export-draw.js:192](../../app/export-draw.js#L192) - `depth` and `dev` are dead parameters.
- [app/export.jsx:341](../../app/export.jsx#L341) - A second Export while a board picture renders starts a second run.
- [app/export.jsx:400](../../app/export.jsx#L400) - An error thrown after Cancel and before the loop sees it still says "Export failed".
- [app/vision.js:62](../../app/vision.js#L62) - A synchronous Worker throw leaks the Blob URLs. The Worker and model stay for the visit (unsure if intended). A one-thread load and `read` have no timeout.
- [app/draw-core.js:6](../../app/draw-core.js#L6) - `BRUSHES` is test-only, and `DrawCore.sqName` is a third wrapper.
- [app/export-draw.js:783](../../app/export-draw.js#L783) - The layer cache key leaves out position and styles (latent, from 2026-11-09).
- [tests/live/site.test.cjs:7802](../../tests/live/site.test.cjs#L7802) - export.jsx's `skip`/`keep` is copied five times in the live tests.

**Layout, shell, settings, sound**
- [app/shell.html:60](../../app/shell.html#L60) - The visually-hidden rule exists four times in two forms; `.q-sr` lacks `nowrap` (moved from medium: nothing broken).
- [app/shell.html:640](../../app/shell.html#L640) - `.q-tag` hard-codes the dark theme's ok/warn colours in both themes.
- [app/shell.html:657](../../app/shell.html#L657) - `.q-evalsf` is dead.
- [app/tweaks.jsx:24](../../app/tweaks.jsx#L24) - Two tabs undo each other's settings (from 2026-11-09).
- [app/tweaks.jsx:134](../../app/tweaks.jsx#L134) - InfoTip uses `window.innerWidth` (wrong on Firefox for Android after a rotation; unsure).
- [app/drag-scroll.js:76](../../app/drag-scroll.js#L76) - A lost pointerup keeps scrolling on button-less moves, and the cursor stays `grabbing`. The glide divides by a possibly zero dt (:143; unsure).
- [app/layout-core.js:111](../../app/layout-core.js#L111) - Comments say Moves has five lines (it's `MOVE_LINES_ONE` = 3). The `foldable` tier equals `tablet` and is read only by a test. `DESKTOP_VW`/`PLOT_WIDE` are both 1181, by hand.
- [app/layout-core.js:345](../../app/layout-core.js#L345) - A negative board size below about 30 px wide (from 2026-11-09, narrower than reported).

**Build, deploy, offline**
- [tests/sw.test.cjs:80](../../tests/sw.test.cjs#L80) - Hard-codes `chess-vision-1` five times, though LAYOUT.md says the name lives in one place; a cache bump fails it. *Fixed 2026-11-19.*
- [.github/workflows/test.yml:33](../../.github/workflows/test.yml#L33) - Stale: "ESLint's warnings don't fail the job" (exhaustive-deps is an error). *Fixed 2026-11-19 (70e5f4c).*
- [build.cjs:116](../../build.cjs#L116) - `VENDOR` is a hand list; nothing checks a pinned vendor file is served.
- [build.cjs:196](../../build.cjs#L196) - "Never a comment's" overclaims: a commented-out CDN URL still matches.
- [eslint.config.mjs:10](../../eslint.config.mjs#L10) - `espree` is in neither install line. *Fixed 2026-11-19.*
- [eslint.config.mjs:117](../../eslint.config.mjs#L117) - sw.js and the Workers get browser and page globals.
- [tests/live/serve.cjs:8](../../tests/live/serve.cjs#L8) - The page name and `/` rewrite are written in four places (build.cjs, sw.js, serve.cjs, render.yaml).

### Moved on checking
- `.sr-only` ×4 (Layout): medium → low, nothing broken yet.
- Tablebase rows without `useRowFocus` (Online): medium → low, keyboard only.

### Merged
- Export keys and buttons (Replay, Export).
- `SHORTCUTS`/`BOARD_KEYS` (Replay, Boards).
- The check glow colour (Replay, Layout).
- The position keys (Replay, Boards).

## Coverage
| Area | Files | Read in full | Not covered |
|---|---|---|---|
| 1 Rules and records | chess-core, play-core, games-core, import-core, openings-core, openings-data.cjs, src/game-data.js, src/sample-game.js | all | — |
| 2a Engines and analysis | analysis-core, move-eval, stockfish.jsx, sf-engine, sf-full, kept-files, kept-download.jsx | all | — |
| 2b Online services | queen.jsx, queen-core, pkce, lichess-core, explorer.jsx, tablebase.jsx | all | — |
| 3a Replay, first half | game-video-core.jsx 1–2400 | all | — |
| 3b Replay, second half and Stage | game-video-core.jsx 2400–4750, engine.jsx | all | — |
| 3c App, settings, sharing | game-app.jsx, settings-tabs.jsx, share-dialog.jsx | all | — |
| 3d Boards and dead positions | free-board.jsx, edit-board.jsx, board-core, edit-core, dead-core, dead-worker, dead.jsx | all | — |
| 3e Layout, shell, themes, sound | layout-core, shell.html, tweaks.jsx, drag-scroll, board-themes, piece-sets, theme.js, sfx-core, sfx.jsx | all | — |
| 4 Export and vision | export-draw, export.jsx, webp-core, draw-core, vision-core, vision-grid, vision.js, vision.jsx, vision-worker | all | — |
| 5 Build, deploy, offline | build.cjs, build-js.cjs, render.yaml, render-headers.cjs, sw.js, test.yml, eslint.config.mjs, tools/chasolver-wasm (build.sh, Cargo.toml, rust-toolchain.toml, src/lib.rs), tests/live/serve.cjs, .gitignore, .gitattributes, .prettierignore, LAYOUT.md; sha256 of every pin | all | Cargo.lock |

Not in any area: `tests/` and `docs/` (out of scope; read only for cross-checks), the data and third-party files the skill leaves out, `.claude/`, `.impeccable/design.json`, CLAUDE.md and README.md.

## Not checked
- Nothing was run in a browser. The highs and mediums marked likely were traced from the code:
  - the schedule jump;
  - the Queen log crash;
  - export during Edit position;
  - the two service worker cases;
  - the touch focus and multi-touch findings;
  - the Settings panel overlap.

  Before fixing the export memory finding, measure its cost on a device.
- These were run in node on the cores, by the agents and again while checking: the `simulate` crash (on a copy of the function), the 960 PGN tags, the Termination round trip, `playLine`'s SAN, the 960 critique text, and the PGN import oddities.
- Two items need the network: whether GitHub honours `!LAYOUT.md` in `paths-ignore`, and whether the "main branch protection" ruleset's required checks still match test.yml's jobs.
- Not judged by reading: iOS and Android touch behaviour on real devices, Firefox's cascade for the overridden Transport bar rules (Chromium specificity was read by hand), and the vision model's reads.
