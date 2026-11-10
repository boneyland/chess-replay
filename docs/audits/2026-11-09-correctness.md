# Audit 2026-11-09: correctness
Commit: 25f8a5f · Areas: 6 · Findings: 2/13/43 · Dropped on checking: 3 (1 moved; 1 duplicate merged)

## Summary
The chess rules are in good shape. The agent ran its checks on hand-made positions: castling through or out of check, rights after a rook capture, en passant with a pin, under-promotion SAN, the repetition key, the 50/75-move and three/fivefold rules, insufficient material and the UCI score signs all came out right. No pinned file has drifted. The two high findings are both in the replay view. First, a line picked from the Analysis panel has no starting position: branch off it with your own move, step back twice, and the page crashes to the Recover screen. Second, loading a new game keeps the old game's playhead and the old line shown on the board, so the board, Copy FEN and Stockfish's search mix two games' moves. Most mediums are races between long-running work (a game analysis search, a Queen answer, an export frame, a deploy's service worker) and something that replaced it. Then come a few rules gaps: SAN `O-O` played by a rook, `posFromFen` dropping the en passant square, and a dead-position proof from an earlier position being ignored. Known gaps that are correctness bugs are kept below, marked "known gap". All three of them still hold: the flag fall in a dead position, two tabs overwriting each other's My games, and the draw claim only in the position on the board.

## Fix plan
Started 2026-11-09: items 1–4 are PRs 210–212 and 219, merged. Each item is one PR on a `claude/<topic>` branch (they change the page; see CLAUDE.md's Workflow), in this order. Line numbers are at commit 25f8a5f: if they have moved, find the code by the quoted evidence. Tick an item here, with its PR, when it merges.

- [x] 1. **Replay: the two highs**: give `onLine`'s line a `base` (High 1); open a newly loaded game at its start and drop the old `vline`/`pv` (key `GameVideo` on the game, or reset on new moves) (High 2). Add a live test for each. Ride-alongs: the playhead left past a shorter schedule, and Home in the Moves list (Low, Replay). (PR 210; its ride-alongs didn't go in and moved to item 4)
- [x] 2. **Rules and records**: check that the piece moving in SAN castling is the king; `posFromFen` reads and checks the ep field; carry a per-side "proven unable to mate" through a game's positions into `flag`/`outcome` (Medium, Rules; this narrows known gap (b)). Ride-alongs: the cutechess-eval regex, `TimeControl`, `splitGames`, GamesCore overwriting an unreadable list (Low, Rules). Unit tests for each. (PR 211)
- [x] 3. **Play vs Stockfish and the free board**: `runAnalysis` keeps its search handle and cancels it on abort (Medium, Analysis); clear the board input when `still` turns on (Medium, Boards). Ride-alongs: the running clock's highlight, the 600 ms pause charged at +0, Try again leaving the move unrated, and the tweaks migration write in its own try (Low, Boards). (PR 212)
- [x] 4. **Long tasks against a replaced game**: Queen's arrow and `runTest` tied to the game they were asked for, and `loadFiles` closing Queen as the other loaders do (Medium, Replay); the replay's keys turned off during an export (Medium, Replay); search both positions at any tablebase-mate/search boundary (Medium, Analysis). Ride-alongs: `engine.status` read through a ref, 'unavailable' after a failed single-thread start, `pyParse` handling `nan`/`inf`, and `directCall`'s SSE timeout (Low, Analysis); from item 1, the playhead left past a shorter schedule (`engine.jsx`) and Home in the Moves list (Low, Replay). (PR 219)
- [ ] 5. **Vision and export**: flatten transparent pictures onto white in `tensor` and `visionGrid`; a size and pixel cap in the vision dialog's `take`; free `render()`'s canvas when `paint` throws (Medium, Export). Ride-alongs: KeptFiles honours Cancel during the check, a rejected `enc.cancel()` stops being shown as an error, the vision read race on a PNG failure, and the end-of-game sound at the clip start (Low, Export).
- [ ] 6. **Deploy and offline**: version the Worker URLs (`dead-worker.js`, `vision-worker.js`, the engine glue) from `VERSION`; un-ignore LAYOUT.md in test.yml's `paths-ignore` (Medium, Build). Ride-alongs: `VERSION` over every `put()` file, keep only `r.ok` responses, a timeout on `keep()`, CDN URLs read from attributes only, `rust-toolchain.toml`, LAYOUT.md's VISION_CACHE wording (Low, Build). LAYOUT.md and test.yml alone go straight to `main`.

The rest can ride along with the PR that touches the same file, or wait for the next audit.

## Since the last audit
[2026-11-05-debt.md](2026-11-05-debt.md): items 1–8 done (PRs 169–177). Items 9–11 are still open; spot-checked: no `app/pkce.js`, `upstream_error` still handled at [app/queen.jsx:15](../../app/queen.jsx#L15), no `ownLineText`. Item 12 was not re-checked: this audit had no debt or docs scope.

## Findings
### High
- [high] [bug] [app/game-video-core.jsx:1424](../../app/game-video-core.jsx#L1424) - A line picked from the Analysis panel (Best line, Better was, Queen) is shown with no `base`. Branching off it with your own move and then stepping back to before its first move crashes the page.
  evidence: `onLine` → `setVline({ c: cNow, at, src, moves, upto: j })` has no `base`. `playOwn` ([1298](../../app/game-video-core.jsx#L1298)) keeps `...b` and sets `src: 'you'`, so `stepLine` allows `upto` −1 ([1292](../../app/game-video-core.jsx#L1292)). Then `useShownLine` returns `pos: vline.base` (undefined, [1302](../../app/game-video-core.jsx#L1302)), and `LineBoard` reads `v.base.b` ([524](../../app/game-video-core.jsx#L524)). `useOwnLineEval` already guards with `vline.base || gamePos(vline.at - 1)` ([1327](../../app/game-video-core.jsx#L1327)).
  scenario: pause, click a Best line chip, drag a piece to branch off, press ← two or more times: a TypeError, then the Recover screen.
  fix: `base: gamePos(at - 1)` in `onLine`. confidence: sure (traced by reading; not run in a browser)
- [high] [bug] [app/game-app.jsx:695](../../app/game-app.jsx#L695) - Loading another game while the replay shows keeps `GameVideo` mounted. The new game opens at the old game's move number (still playing if it was), and keeps the old game's shown line.
  evidence: `<GameVideo M={MV} …>` has no `key`. `setStart(settled(-1))` runs only on mount ([game-video-core.jsx:1453](../../app/game-video-core.jsx#L1453)). `useHeldSchedule` ([1262](../../app/game-video-core.jsx#L1262)) sees a new schedule and keeps "the same move" (written for Queen or commentary schedule changes). `useShownLine` drops `vline` only when `playing`/`cNow` change ([1287](../../app/game-video-core.jsx#L1287)), and `cNow` stays the same.
  scenario: on game A, paused at move 30 with your own line shown, import game B: B opens at its ply 30, the board shows A's line, and `useOwnLineEval` asks Stockfish for B's first 30 moves followed by A's line moves (illegal). Copy FEN and Play from this position use the mixed moves. The same happens with My games › Replay and Back to sample (a Lichess `#ply` and Back to the loaded game override it).
  fix: key `GameVideo` on the game, or reset the time and the line when M's moves change. confidence: likely (read, not run)

### Medium
**Rules and records**
- [medium] [bug] [app/chess-core.js:111](../../app/chess-core.js#L111) - SAN `O-O`/`O-O-O` is accepted when the piece on e1/e8 isn't a king, and is played as that piece's slide, contrary to the 2026-10-30 decision ("checks castling … in full"). `k7/8/8/8/8/8/3K4/4R3 w - - 0 1` + `O-O` plays e1g1 (re-run while checking). fix: require the mover's king on `from`. confidence: sure
- [medium] [bug] [app/chess-core.js:776](../../app/chess-core.js#L776) - `posFromFen` always sets `ep: -1`. `LichessCore.cloudMoves` ([lichess-core.js:91](../../app/lichess-core.js#L91)) walks cloud lines from it, so a cloud line opening with an en passant capture comes back empty, and the cloud answer has no best move or line. This was re-run while checking (`…3pPp2… w KQkq f6` gives ep −1). Every other caller adds `ep` back by hand. confidence: sure
- [medium] [bug] [app/play-core.js:144](../../app/play-core.js#L144) - `outcome` and `flag` ([201](../../app/play-core.js#L201)) ask the prover only about the current position, though a side proven unable to mate stays unable after any legal move (the recheck comment at 222 says so, and `DeadCore.firstDead` uses it). After a proof at move N, a flag fall while the next position's search is pending, or has timed out to `undecided`, scores a loss where FIDE 6.9 gives a draw. fix: carry per-side "proven unable" through the game. confidence: likely

**Analysis and engines**
- [medium] [bug] [app/analysis-core.js:261](../../app/analysis-core.js#L261) - The game analysis throws away its search handle (`await engine.search({…}).promise`), so Stop, or a files change, only sets `signal.aborted`. The running search goes on for its full time limit (up to 60 s), and since SFEngine never interrupts a search, every later one (the live search, Stockfish's reply in a game) waits behind it. Stockfish's game clock runs meanwhile (`P.move(next, step, Date.now())`). fix: keep the handle, cancel on abort. confidence: sure (not cancelled); likely (the clock charge)
- [medium] [bug] [app/analysis-core.js:283](../../app/analysis-core.js#L283) - Only tablebase "won, no DTM" answers get a second search at a tablebase/search boundary. A tablebase mate with a DTM (`mateCp(ceil(dtm/2))`) next to a searched position goes through `mateAdvice`'s "lost the mate" rule. If the tablebase backs off (429) or fails partway through KBN v K, a move that keeps the win is rated a blunder ("Lost forced checkmate sequence"): Stockfish reads such positions as about +1.9 (decision 2026-10-25). confidence: likely

**Replay**
- [medium] [bug] [app/engine.jsx:150](../../app/engine.jsx#L150) - During a video export, Space, ←/→, End, `,`/`.`, 0 and Home still play or seek the stage (Stage's `useKeydown` is `{ on: !still }`, `useReplayNav`'s ([game-video-core.jsx:1395](../../app/game-video-core.jsx#L1395)) has no guard, and ExportOverlay doesn't take keys). The wheel and the F key are turned off. A key between the export's `seekStage` and its `await stage.draw` puts the wrong moment in the file. confidence: likely
- [medium] [bug] [app/game-app.jsx:737](../../app/game-app.jsx#L737) - Queen's arrow `{ at, best }` doesn't say which game it was asked for: `onOverlay={setQueenArrow}` takes an answer that arrives 20–33 s later, after `[M]` cleared it ([316](../../app/game-app.jsx#L316)). `loadFiles` ([493](../../app/game-app.jsx#L493)) doesn't close the Queen panel as the other loaders do. Drop game B while Queen is working on A, and A's arrow is drawn on B; a running `runTest` keeps seeking B to A's plies. confidence: likely

**Boards**
- [medium] [bug] [app/free-board.jsx:344](../../app/free-board.jsx#L344) - The board input is cleared only on a `boardKey` change. A game ending without a move (a flag fall, a late `P.recheck` answer) turns the handlers into `NO_INPUT` and leaves a drag ghost, a hidden piece or the promotion picker frozen on the board. fix: clear when `still` turns on. confidence: likely

**Export, vision, sound**
- [medium] [bug] [app/vision-worker.js:49](../../app/vision-worker.js#L49) - Transparent pixels are read as black: the worker's `alpha: false` canvas starts black, and `VisionGrid`'s `grey()` ([vision-grid.js:12](../../app/vision-grid.js#L12)) ignores alpha on a transparent OffscreenCanvas ([vision.jsx:21](../../app/vision.jsx#L21)). A PNG diagram with transparent light squares is read with black ones. fix: fill white before drawing. confidence: likely (how much it hurts reads is untested)
- [medium] [bug] [app/vision.jsx:163](../../app/vision.jsx#L163) - The vision dialog's `take` decodes any picked, dropped or pasted image with no byte or pixel cap. The 50 MB refusal (decision 2026-10-26) is only in `GameApp.loadFiles`. A 20000×20000 PNG decodes to about 1.6 GB, and the tab dies with no message. confidence: sure (no check)
- [medium] [bug] [app/export-draw.js:520](../../app/export-draw.js#L520) - `render()` doesn't `free()` its layer canvas when `paint` throws `Unsupported` (the fallback to html2canvas). Firefox for Android's GPU growth from such dropped canvases is the reason `free()` exists (comment at line 44). fix: try/catch with `free(cv)`. confidence: likely

**Build, deploy, offline**
- [medium] [race] [app/sw.js:62](../../app/sw.js#L62) - On the first visit after a deploy, the page comes from the network, but `dead-worker.js`, `vision-worker.js` and the engine glue come from the old deploy's cache (`cacheFirst`, unversioned URLs). After `skipWaiting`/`claim`, an old open page gets the new workers. A change to a worker's message shape breaks the prover or reader for returning viewers until the next reload. fix: version the Worker URLs from `VERSION`. confidence: sure (mechanism)
- [medium] [ci] [.github/workflows/test.yml:11](../../.github/workflows/test.yml#L11) - `paths-ignore: ['*.md']` skips CI for a LAYOUT.md-only push, but six tests read the pins from LAYOUT.md, and render.yaml's `buildFilter` doesn't list it. A wrong pin pushed to `main` fails the next unrelated PR and its deploy. fix: `'!LAYOUT.md'`. confidence: sure

### Low
**Rules and records**
- [app/play-core.js:196](../../app/play-core.js#L196) - **Known gap (b), still holds**: before chasolver answers (first move, offline before kept, a 5 s give-up), `flag` scores a loss against `canMate` material even in a dead position. The medium above widens this window. Reported by two areas.
- [app/games-core.js:34](../../app/games-core.js#L34) - **Known gap (c), still holds**: the same game in two tabs is one entry, and the last writer's moves replace the other tab's (data loss, narrow).
- [app/play-core.js:339](../../app/play-core.js#L339) - **Known gap (a), still holds**: a draw is claimable only in the position on the board, not by announcing the move that makes it (FIDE 9.2.1.1/9.3.1). In hot-seat play the claim is offered right after that move, so the cost is small.
- [app/chess-core.js:159](../../app/chess-core.js#L159) - The cutechess eval regex reads `{3/4 of players…}` as `cp 300` and marks the game as having PGN evals (re-run by the agent). Require the time part, or the end of the comment.
- [app/chess-core.js:499](../../app/chess-core.js#L499) - `TimeControl "40/7200:3600"` gives a 40 s starting clock (only the leading digits are read).
- [app/chess-core.js:135](../../app/chess-core.js#L135) - `splitGames` splits on a `[Tag "…"]` line inside a multi-line comment, and merges header-less games (`1. e4 e5 1-0\n\n1. d4 d5 0-1` loads as one game).
- [app/dead-core.js:67](../../app/dead-core.js#L67) - The 5 s timeout includes a fresh worker's wasm fetch and compile. A timeout is cached as `undecided` for good, and the worker is restarted with no back-off.
- [app/dead.jsx:45](../../app/dead.jsx#L45) - `useFirstDead` caches `null` even when the answers were `undecided` only because the worker was down.
- [app/games-core.js:14](../../app/games-core.js#L14) - An unreadable stored list reads as `[]`, and the next `keep` overwrites every other game.
- [app/dead-worker.js:16](../../app/dead-worker.js#L16) - A wasm trap in `X.solve` posts nothing; the client waits out the timeout (unchecked).

**Analysis and engines**
- [app/free-board.jsx:139](../../app/free-board.jsx#L139) - **Known gap, still holds**: Play vs Stockfish leaves moves unrated, silently, after a reload, before the "before" search reaches depth, and often on the asm.js engine. Recorded trade-off (decision 2026-11-02).
- [app/lichess-core.js:78](../../app/lichess-core.js#L78) - **Known gap, still holds**: a cursed win's moves are grouped under Draw (display only; the rating side is consistent with the fifty-move rule).
- [app/stockfish.jsx:306](../../app/stockfish.jsx#L306) - The catch reads `engine.status` from a stale closure, so "Analysis stopped" shows beside "Stockfish can't run here".
- [app/stockfish.jsx:120](../../app/stockfish.jsx#L120) - A single-thread engine failing to start ends 'stopped', not 'unavailable' (`onFail` runs before the rejection handler), so Try again never shows.
- [app/queen.jsx:55](../../app/queen.jsx#L55) - `directCall`'s SSE read has no timeout; a non-JSON body or an abort gives a raw error instead of the page's codes; a cut stream isn't retried.
- [app/queen-core.js:37](../../app/queen-core.js#L37) - `pyParse` throws on `nan`/`inf`, losing the whole answer; the `i` flag turns `TRUE` into NaN.
- [app/stockfish.jsx:202](../../app/stockfish.jsx#L202) - Stored partial runs are shape-checked only with `Array.isArray` (unchecked).
- [app/sf-engine.js:6](../../app/sf-engine.js#L6) - A stale header comment: the page's FENs do carry castling and en passant since Edit position.

**Replay**
- [app/game-app.jsx:434](../../app/game-app.jsx#L434) - **Known gap, still holds**: My games › Replay rebuilds from `PlayCore.pgn(b)` alone, so earlier analysis isn't reattached. Reported as medium; moved to low (a recorded limit).
- [app/engine.jsx:64](../../app/engine.jsx#L64) - A shorter schedule while paused near the end leaves the playhead past the duration (`pct` > 100); Play then wraps to mid-game.
- [app/game-video-core.jsx:900](../../app/game-video-core.jsx#L900) - For one render after a new game, Commentary looks up the old game's book. The book is rebuilt (about 0.25 s) whenever an analysis is committed.
- [app/game-video-core.jsx:390](../../app/game-video-core.jsx#L390) - `LINE_CACHE` grows without bound for the page's life.
- [app/game-video-core.jsx:852](../../app/game-video-core.jsx#L852) - ← and Home in the Moves list stop at ply 0; the starting position can't be reached from the list.

**Boards, layout, shell**
- [app/free-board.jsx:381](../../app/free-board.jsx#L381) - Stepped back in a clocked game, the "running" highlight follows the viewed position's side, not the clock that ticks.
- [app/free-board.jsx:154](../../app/free-board.jsx#L154) - Stockfish's 600 ms reply pause is charged to its clock, so it can lose on time at +0, contrary to `thinkMs`'s "never flags".
- [app/free-board.jsx:145](../../app/free-board.jsx#L145) - Try again during Stockfish's turn leaves the player's last move unrated (`before.current` is already null).
- [app/tweaks.jsx:10](../../app/tweaks.jsx#L10) - The migration's `setItem` shares the read's try: with full storage the viewer gets defaults, and their next change writes defaults over every stored setting.
- [app/tweaks.jsx:16](../../app/tweaks.jsx#L16) - Two tabs undo each other's settings changes (whole-object writes, no `storage` listener).
- [app/layout-core.js:191](../../app/layout-core.js#L191) - Below about 230 px of width, `compute` gives a negative board size (paused) or a board wider than the stage (video); 0×0 isn't guarded (re-run by the agent).

**Export, vision, sound**
- [app/kept-files.js:34](../../app/kept-files.js#L34) - **Known gap, still holds**: no resume, and about 2 × 99 MB is held at peak during the check (`digest` copies). Relevant on this laptop and on phones.
- [app/kept-files.js:79](../../app/kept-files.js#L79) - Cancel during the hash check or the cache puts is ignored, and the file is kept.
- [app/export.jsx:237](../../app/export.jsx#L237) - A rejected `enc.cancel()` reports the viewer's own Cancel as "Export failed".
- [app/vision.jsx:247](../../app/vision.jsx#L247) - If the PNG encode rejects mid-read, the dialog clears `reading` while `Vision` stays busy: the next read says "Already reading", and that bitmap leaks.
- [app/vision.js:48](../../app/vision.js#L48) - A read has no timeout if the Worker dies silently (unsure).
- [app/sfx-core.js:33](../../app/sfx-core.js#L33) - The end-of-game sound is dropped when the clip starts within 0.6 s after the last move.
- [app/sfx-core.js:143](../../app/sfx-core.js#L143) - Safari's `interrupted` AudioContext isn't resumed by a gesture (unsure).
- [app/export-draw.js:552](../../app/export-draw.js#L552) - A layer's cache key leaves out its position and inherited styles; nothing triggers it today (latent, unsure).

**Build, deploy, offline**
- [build.cjs:191](../../build.cjs#L191) - `VERSION` doesn't cover the files sw.js keeps as they're used (`pieces/*`, `boards/*`, `og-image.png`), so one changed in place is never fetched again.
- [app/sw.js:126](../../app/sw.js#L126) - `cacheFirst` keeps opaque `KEEP_HOSTS` responses whatever their status (a CDN 5xx can stick for the rest of the deploy).
- [app/sw.js:28](../../app/sw.js#L28) - The install's CDN `keep()` fetches have no timeout; a network that blackholes a font host can stop the install (unsure).
- [build.cjs:111](../../build.cjs#L111) - CDN URLs are taken from the whole file text, comments included, into `script-src` and `SW_REMOTE`; the comment at line 112 is stale.
- [tools/chasolver-wasm/build.sh:6](../../tools/chasolver-wasm/build.sh#L6) - No `rust-toolchain.toml`, so the pinned wasm can't be rebuilt reproducibly.
- [LAYOUT.md:31](../../LAYOUT.md#L31) - Says to bump `VISION_CACHE` in sw.js too, but build.cjs fills it from vision-core.js.

### Dropped on checking
- Known gap "Leaving a game in progress still asks" (reported by Rules and Boards, merged): a UX limit, not a correctness bug.
- Known gap "the player can resign while Stockfish thinks" (Analysis and Boards): checked harmless. The resign ends the game, the search is cancelled, and a late `bestmove` is dropped by `same(b)`.
- Known gap "no draw offers against Stockfish": a missing feature, not a bug.

## Coverage
| Area | Files | Read in full | Not covered |
|---|---|---|---|
| 1 Rules and records | chess-core, play-core, board-core, edit-core, dead-core, dead-worker, dead.jsx, games-core, import-core, openings-core, openings-data.cjs, src/game-data.js, src/sample-game.js, tools/chasolver-wasm/src/lib.rs | all | the `chess` crate and chasolver sources |
| 2 Analysis and engines | analysis-core, stockfish.jsx, sf-engine, sf-full, queen.jsx, queen-core, lichess-core, explorer.jsx, tablebase.jsx | all | — |
| 3a Replay | game-video-core.jsx, game-app.jsx, engine.jsx | all | — |
| 3b Boards, layout, shell | free-board.jsx, edit-board.jsx, layout-core, shell.html, tweaks.jsx, drag-scroll, board-themes, piece-sets, settings-tabs.jsx, share-dialog.jsx | all | — |
| 4 Export, vision, sound | export-draw, export.jsx, webp-core, vision-core, vision-grid, vision.js, vision.jsx, vision-worker, kept-files, kept-download.jsx, draw-core, sfx-core, sfx.jsx | all | — |
| 5 Build, deploy, offline | build.cjs, render.yaml, render-headers.cjs, sw.js, .github/workflows/test.yml, tools/chasolver-wasm/build.sh + Cargo.toml, tests/live/serve.cjs, .gitignore, .gitattributes, LAYOUT.md; sha256 of every pin | all | — |

Not in any area: `tests/` and `docs/` (not in scope; read only for cross-checks), the data and third-party files the skill leaves out, `.claude/`, CLAUDE.md, README.md.

## Not checked
- Nothing was run in a browser. The two highs and the replay, boards and export mediums are traced from the code, not reproduced. The rules findings marked sure were re-run with `node -e` on the cores (the castling and `posFromFen` ones again while checking).
- Known gaps that can't be judged by reading: iOS tap-tap/drag on a real iPhone, the asm.js engine on the SM-T510, the vision diagram's c4 bishop read as a pawn (model output; the reader code hasn't changed), phone reading speed.
- Commentary text cut short on the phone, and the Shift+right-click menu in Firefox, are display limits, not correctness bugs. They were left out.
