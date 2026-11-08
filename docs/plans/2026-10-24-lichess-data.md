# Lichess data and multi-threaded Stockfish (plan)

The plan of six PRs (Lines, the endgame tablebase and its use in game analysis, the cloud evaluation, the opening explorer, multi-threaded Stockfish), written 2026-10-23 and built 2026-10-24 to 2026-10-28; moved here from the spec's Roadmap on 2026-11-08, as written. What was built is in [Engine](../spec/engine.md) and [Lichess data](../spec/lichess.md).


Unverified facts are marked **verify**.

| # | PR | Depends on | Risk |
|---|----|-----------|------|
| 1 | `claude/multipv`: Lines setting, multi-line engine panel and arrows (built, see Lines (MultiPV)) | none | low |
| 2 | `claude/tablebase`: endgame tablebase (built, see Endgame tablebase) | none | low |
| 2b | `claude/tablebase-analysis`: the tablebase in game analysis and move ratings (built, see Endgame tablebase) | 2 | medium |
| 3 | `claude/cloud-eval`: Lichess cloud evaluation (built, see Lichess cloud evaluation) | 1 | low |
| 4 | `claude/lichess-explorer`: opening explorer and Lichess sign-in (built, see Lichess opening explorer) | none | medium |
| 5 | `claude/threads`: cross-origin isolation, multi-thread engine, Threads setting (built, see Multi-threaded Stockfish) | 1 | high |

Ship 1 to 3 first (2b right after 2); then 5, alone, since its headers affect every external load; 4 after it (reordered 2026-10-28).

**Shared groundwork** (built in PR 2, reused by 3 and 4):

- `app/lichess-core.js` (`window.LichessCore`, unit-tested in Node like `queen-core.js`): URL builders, parsers, a per-key LRU cache, a rate-limit gate (one request at a time per endpoint, 60 s back-off on HTTP 429 as Lichess asks), an `AbortController` per request, ~300 ms debounce after the last position change.
- Positions go as FEN built through `ChessCore` with real castling rights (the page's own FENs lack castling and en passant, see `sf-engine.js`), or as the `play` UCI list where an endpoint has one.
- Each panel has three quiet states: loading, "not available" (offline, 404, 429, blocked), data. A failed request never blocks the local engine or shows an error screen.
- `sw.js`: `lichess.org`, `explorer.lichess.ovh`, `tablebase.lichess.ovh` stay out of `KEEP_HOSTS` (live data, never served stale); check they pass through offline.
- Privacy: the player's positions leave the browser, so each feature is a toggle in Settings › **Online**. Explorer and cloud eval default **off**; tablebase may default on (it only fires at 7 pieces or fewer). README gets a "Lichess data" note (what is sent, endpoints).

**PR 1: Lines (MultiPV).** Built 2026-10-24 as below, except: the setting is "Your moves: lines"; clicking a line plays it, as the replies did.

- `analysis-core.js`: `LINES = [1..5]`, `sfLines` in `engineSettings(t)` for the live engine (`own`); batch analysis keeps `lines: 1`, its JSON unchanged (Python check stays green).
- `sf-engine.js`: `search({ lines })` sends `setoption name MultiPV value N` only on change, between searches in `pump()` (like `hashWant`/`hashSet`). Parse `multipv k` in `info` (`infoToScore`, `infoStats` get `multipv`, default 1); keep the last complete line per k; results gain `lines: [{ k, cp, depth, pv }]` while `cp`, `pv`, `best` stay line 1. `bestmove` is line 1.
- Analysis › ☰: "Lines" (1–5), `TWEAK_DEFAULTS.sfLines = 1`.
- Engine panel lists all lines (eval, first moves in SAN, depth); arrows: line 1 as now, others thinner and fainter; clicking a line plays or previews it; a note that more lines search slower. Never during Play vs Stockfish; the opponent always searches 1 line.
- Tests: fake-worker (option sent once on change, lines per k, stale depths dropped), parser and settings range, real Stockfish with 3 distinct first moves at the start, live test with Lines 3.

**PR 2: Endgame tablebase.** Built 2026-10-24, see Endgame tablebase; the plan as it was: `https://tablebase.lichess.ovh/standard?fen=<FEN>` (no auth, ≤ 7 pieces) **verify** fields (`category`, `dtz`, `dtm`, `moves[]` with `uci`, `san`, `category`, `dtz`).

- `LichessCore.tablebase(fen)` → `{ category, dtz, dtm, moves }` or `null`; never called above 7 pieces.
- Engine panel (replay and free board, not in a Stockfish game): a Tablebase block with the verdict in Lichess's words (win, draw, loss, cursed win, blessed loss), DTZ/DTM, moves ranked by result; winning moves may get their own arrow colour.
- The eval bar shows the tablebase result (win as mate-like, draw 0.00) with a "TB" tag; stored analysis untouched. Using it in game analysis is PR 2b.
- Tests: fixtures from real responses (`tests/fixtures/`), piece-count gate, cache hit, 429 back-off with a fake `fetch`.

**PR 2b: The tablebase in game analysis.** Built 2026-10-25, see Endgame tablebase › In game analysis; the plan as it was: Why: Stockfish in the browser has no Syzygy files (about 1 GB to 5 pieces, 150 GB to 6, 17 TB to 7), so its endgame evals can be wrong (a cursed win, a draw, read as +0.54) and a move that throws away a tablebase win can still be rated best. With the tablebase, endgame positions get the true result and the ratings follow win/draw/loss.

- "Analyse with Stockfish" (`AnalysisCore.runAnalysis`): with Settings › Online › Endgame tablebase on, each position of 7 pieces or fewer asks `LichessCore.tablebase` first (the same client: cache, one request at a time, 429 back-off). A certain answer replaces the search: the eval from `LichessCore.bar` (a win as a mate from DTM, a draw, cursed win or blessed loss as 0), the best move the tablebase's first, the best line its DTZ mainline (`/standard/mainline?fen=`, verified 2026-10-25: `{ mainline: [{ uci, san, dtz, precise_dtz }], winner, dtz }`, to mate where there is no capture or pawn move; asked for every tablebase position, a second request each, through the same client). An uncertain answer ("maybe", "unknown"), no answer (offline, an error, a back-off) or the setting off: Stockfish searches as now, so a run never fails or waits on Lichess. After the first failure in a run (an error, the 10 s timeout, a 429 back-off) it stops asking for the rest of that run, so Lichess being down costs one timeout at most. A position just inside 7 pieces after a Stockfish-searched one (a capture into the tablebase) is rated by the usual eval rules, the tablebase's eval after it.
- Ratings: a move is rated by what it does to the outcome for its side: keeping a win, a draw keeping a draw, or a loss staying a loss loses nothing; win → draw (a cursed win counts as a draw) or draw → loss is a blunder; win → loss too. A winning move much slower than the best (DTZ far longer, even nearing the fifty-move limit) loses nothing, as on Lichess (decided 2026-10-25); the mate rules ("delayed mate") don't apply between tablebase positions.
- Win without DTM (6 and 7 pieces): the eval graph and bar show it as won (±9990, `1-0`/`0-1`) rather than a mate count, as DTZ is not distance to mate.
- The analysis JSON marks each such position (built as `tb_before` / `tb_after`, `{ category, dtz, dtm }`, search depth 0) and the engine block records `tablebase: true`; `sfPartialKey` includes the setting, so a stopped run resumes only with the same one. The Analysis panel's header says "Tablebase" for those positions instead of a depth; Go deeper isn't offered on them.
- The time estimate counts tablebase positions as near-free once the run knows the piece counts (a game's moves give them before it starts).
- Python check (`tests/check_browser_json.py`): the Python pipeline has no tablebase, so it compares a run made with the tablebase off; a unit test covers a mixed JSON.
- Never in Play vs Stockfish (its opponent or critique: no tablebase during a game) and never for the free board's own-move ratings, which already show the Tablebase block. The viewer's own-move verdicts (free board, moves tried in the replay) don't follow the tablebase in this PR (decided 2026-10-25).
- Privacy: a game's endgame positions are sent one by one during the run; README's Lichess data note says so.
- Tests: fake client in `runAnalysis` (tablebase positions skip the engine, an uncertain or null answer searches, the setting off sends nothing), the rating table (win → draw a blunder, same outcome no loss, cursed counted as draw), JSON fields and the partial key, live: analysing a short KBN v K game makes no engine search for its positions and rates a drawing move a blunder.

**PR 3: Cloud evaluation.** Built 2026-10-27, see Lichess cloud evaluation; the plan as it was: `https://lichess.org/api/cloud-eval?fen=<FEN>&multiPv=<N>` (no auth, 404 when never analysed, rate limited) **verify** `variant`, `multiPv` limits and shape (`depth`, `knodes`, `pvs[{ moves, cp | mate }]`).

- `LichessCore.cloudEval(fen, lines)` returns the engine-result shape tagged `source: 'cloud'`; mates mapped to `±(10000 − 10·N)`.
- With the toggle on, each position asks the cloud (debounced) and runs the local search at the same time; whichever arrives first shows, the deeper replaces it, labelled "Lichess cloud, depth 40". "Prefer cloud" skips the local search when the cloud depth meets the local limit. A miss falls back silently.
- Never used for batch analysis, the Stockfish opponent or its critique.
- Tests: parser, mate mapping, 404 → null without retry loops, debounce, toggle off sends nothing.

**PR 4: Opening explorer.** Built 2026-10-28, see Lichess opening explorer; the plan as it was: `https://explorer.lichess.ovh/lichess?fen=<FEN>&moves=12&topGames=4&recentGames=0` (and `/masters`) **verify** whether a Bearer token is required.

- Sign-in: Lichess OAuth2 PKCE (no client registration, no scopes for public data **verify**), like the HF sign-in (`HF_OAUTH.redirect` in `queen.jsx`), with a pasted personal token as the fallback. The token is kept in its own localStorage key, sent only to Lichess hosts, cleared by Sign out, treated like the HF token by Clear saved data. Redirect URLs in README next to the HF note, plus a CLAUDE.md gotcha.
- `LichessCore.explorer(fen, { db, ratings, speeds })` → totals, `moves: [{ uci, san, white, draws, black, averageRating }]`, `topGames`, `opening`.
- An Explorer panel (replay and free board, not in games): moves with game counts and a white/draw/black bar, click to play on the free board; name and ECO from the response, the local book as fallback and as the default when off. Database (Lichess, Masters) and rating/speed filters in settings.
- Tests: parser, token header only when signed in, 401 → "Sign in to use the explorer", filters change the cache key.

**PR 5: Multi-threaded Stockfish.** Built 2026-10-28 (PR 81, plan `docs/plans/2026-10-28-threads.md`), see Multi-threaded Stockfish; the plan as it was: moved ahead of PR 4, which waits (decided 2026-10-28). Why: stronger evals for the same time limits, in game analysis's move ratings, the viewer's own-move evals and the Stockfish opponent, most of all in critical and hard positions. Searches end on time (no depth limit by default: 3 s a game position, 5 s an own move), so the extra threads search more positions within the same seconds. Measured 2026-10-28 (Node 22, this laptop, threaded lite, a 2 s search of a Sicilian Dragon middlegame): 1 thread 0.61 M nodes/s, depth 21; 2 threads 1.26 M, depth 20; 4 threads 2.39 M, depth 21; 6 threads 2.80 M, depth 19. The depth reached hardly moves (Stockfish's threads share one hash and search the same depths, a little apart), so "depth 21" at 4 threads covers about 4 times the positions; that is where the strength comes from.

- Files, verified on unpkg 2026-10-28: lite `stockfish-19-lite.js` (33,426 B) + `stockfish-19-lite.wasm` (1,697,617 B), vendored and pinned in LAYOUT.md like the single-thread pair, which stays as the fallback. Full `stockfish-19.js` (33,326 B) + `stockfish-19.wasm` (99,076,105 B) from unpkg, pinned in `sf-full.js` beside the single-thread pair and kept in the same cache, used when the page is isolated, the single-thread full engine the fallback. A viewer who already downloaded Full downloads the threaded file once more. Full starts from Blob URLs (the wasm URL in the worker's `#hash`): **verify** that the threaded glue's own workers (one per thread) start from that Blob URL too.
- `setoption name Threads value N` changes the thread count between searches with no worker restart (verified in Node 2026-10-28: 1 → 4 → 2 → 6 in one process, nodes/s following); check the same in Chromium and Firefox, where the thread workers are workers started inside the engine's worker. Sent only on change, between searches in `pump()`, like Hash and MultiPV.
- Cross-origin isolation: `render.yaml` headers on `/*`: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`. Audit of the page's outside loads (2026-10-28), none needs a change: cdnjs (React) and jsDelivr (html2canvas) scripts load with `crossorigin` and SRI; the Google Fonts stylesheet sends `Cross-Origin-Resource-Policy: cross-origin` (and CORS), its font files load in CORS mode; Lichess, unpkg and the Queen Space's Gradio API are `fetch`es (CORS already); the HF sign-in is a same-tab redirect (`location.href`), which COOP doesn't affect; piece images are page data. The embedded copy (an iframe in a page that isn't isolated) can't be isolated, so it stays single-threaded; its HF sign-in tab loses `window.opener` under COOP, which only its note text reads.
- Where threads work: Chrome and Edge, Firefox, Safari 15.2 and later on macOS and iOS (every iOS browser is WebKit), when the page is isolated. Lichess runs threaded Stockfish on iPhone and iPad too: its feature test (`sharedMemoryTest` in lila's `ui/lib/src/device.ts`) checks `Atomics`, `SharedArrayBuffer` and that a shared `WebAssembly.Memory` can be made, turns threads off for Safari 26.2 (a WebKit crash), and caps the hash at 32 MB on iOS and 64 MB on Android. The app does the same test and the same Safari 26.2 exception (`crossOriginIsolated` first); **verify** on an iPhone whether 64 MB of hash starts there or iOS needs the 32 MB cap.
- `stockfish.jsx` `sfFiles()` picks the threaded build when that test passes; any failure (the test, or the threaded engine not starting) falls back silently to single-thread, with Threads disabled and the reason shown under it.
- Analysis › ☰ (engine settings): **Threads**, 1 to `min(hardwareConcurrency − 1, 8)`, default half of `hardwareConcurrency`, at most 4 (`sfThreads`, `TWEAK_DEFAULTS.sfThreads = null` meaning that default): the user doesn't want the CPU near 100% (decided 2026-10-28; 4 on their 8-thread Ryzen 5 7520U, 4 cores × 2, so its four cores are busy during a search and the fans may still spin up in a whole-game analysis). One setting for every search: game analysis, own moves, Go deeper, the Stockfish opponent and its critique. Hash is shared by all threads.
- Batch JSON records threads; `sfPartialKey` includes them; the Python check runs with 1 thread (multi-thread results aren't reproducible: the same game analysed twice can differ slightly, now and then a rating on a borderline move). Pace estimates keyed by thread count. Check the Stockfish opponent's movetime and critique timing.
- Tests: fake-worker option order (Threads sent once on change), settings range and default, file choice and fallback; live: isolated page, Threads 4 + Lines 3 shows three lines and higher nodes/s, offline reload keeps the headers, fonts/React load, HF sign-in returns, Full threaded starts (run alone, under the memory watchdog). Manual: phone (Firefox Beta on Android), iPhone Safari if one is at hand, desktop Firefox.
- Rollback: delete the two header lines in `render.yaml`.

**Cross-cutting**: Settings › Online gains the toggles, sign-in and filters, and the Analysis panel's engine menu Threads, defaults conservative in `TWEAK_DEFAULTS`; README and CLAUDE.md updated (straight to `main`); screenshots per the repo rule; every feature degrades to "not available" offline.
