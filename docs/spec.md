# Chess Replay: spec

The one spec for the app: what it does now, what is planned, and the decisions behind both. Merged on 2026-10-23 from three specs (browser Stockfish, 2026-10-16; free board, 2026-10-19; Lichess data and threads, 2026-10-23), which are in git history under `docs/`. Implementation plans for the built parts are in `docs/plans/`.

**Scope.** The Render site (https://chess-replay.onrender.com/) is the only target.

## Contents

- [Principles](#principles)
- [Built](#built): replay and browser analysis, opening names, custom starts and flip, free board and explorer, edit position, play vs human, My games, play vs Stockfish, full Stockfish download, lines (MultiPV), endgame tablebase (in game analysis too), responsive layout
- [Roadmap](#roadmap): square layouts and breakpoints, Lichess data and multi-threaded Stockfish, player names, Chess960, typed commentary, Maia3, dead positions, chasolver, background music, peer-to-peer online play, app walk-through
- [Known gaps](#known-gaps)
- [Decisions log](#decisions-log)

## Principles

These hold across every feature; a change that breaks one is a failure even if it works.

- **Nothing leaves the browser** unless the viewer turns it on (Ask Queen, and the planned Lichess features, each behind a toggle or button). No accounts of our own (online play, when built, is between two browsers with no account or game server of ours).
- **The playing video stays clean.** Buttons, progress lines and engine controls are for the paused page; a playing video looks like the page, without the paused page's controls (buttons, progress lines, engine controls); the title and end cards, the panels' fade-in, the blunder glow, the camera push and the typewriter commentary show only then, while stepping and paused viewing are a plain, still page.
- **Nothing heavy starts by itself.** The engine (1.8 MB) loads on first use; the full engine (99 MB) downloads only when the viewer asks; whole-game analysis runs only when asked.
- **No hints in a game.** During Play vs human or Play vs Stockfish no eval bar, arrows, verdicts, book moves or engine lines show.
- **Replay doesn't regress.** A loaded game's title card, timeline, export and own-move exploration are untouched by free-board and game features (which is why the free board is a separate view).
- **Bad input explains itself.** An illegal FEN or broken PGN gets a plain message, never a crash.
- **Numbers mean what the Python pipeline's mean.** The browser's analysis JSON uses chess-animator's sign convention, mate encoding, rating and accuracy formulas.
- **An app, not a document.** No text selects but what's typed in a field, and a mouse drag scrolls whatever scrolls (a list, a panel, a menu, a one-line strip), gliding on when let go, as a finger does.
- **Offline works.** The service worker keeps the page and all it loads; online-only features degrade quietly to "not available".

## Built

### Replay and browser analysis

The page replays a game (the sample, or a loaded PGN) as an animated video with an eval bar and graph, move ratings, best lines, commentary and the opening name. Stockfish runs in the browser for two things the precomputed data can't cover:

- **Own moves.** Drag a piece (or tap-tap) from any position. Stockfish evaluates the move as soon as it's dropped: the move in the "you" colour, the eval (streamed from ~0.5 s, final at the "Your moves" time limit, or its depth if one is set), "YOUR MOVE · −41 CP vs a4" with its rating colour, and a **Stockfish replies** row of up to 8 plies, clickable to play the line. Both sides of the comparison come from the browser engine (it searches the position before the move too, cached by position), so the lite engine's eval is never compared with the full engine's. Esc, a new move or stepping cancels a search.
- **Games without evals.** The empty Analysis panel offers **Analyse with Stockfish · about N min** (only while paused). While it runs the panel shows "Analysing 31 / 80 · about 1 min left", a progress bar and Stop (Stop discards the partial run: a half-rated game would mislead). When done, the game is rebuilt as if an `--analyze` JSON had been loaded. Games that already have evals (the sample, Lichess `[%eval]` PGNs) keep them; a game with PGN variations but no evals still offers Analyse.
- **Keeping it.** The result is stored with the loaded files (`files.analysis` in localStorage), so a reload keeps it, and **Save analysis** (in Settings) downloads it as `<White>-<Black>_analysis.json` in `--analyze` format.
- **Start state.** The page opens paused on the starting position with every panel visible; the empty Analysis panel says "Press play to watch the game, or drag a piece to try your own move". The first Play from that frame starts at 0:00 (title card). Reload opens on the starting position (the playhead isn't saved).
- **Analysis header** (the panel's title row): **Analysis** on the left; on the right Go deeper's green **+**, the depth the search behind the current eval reached ("depth 20", one number), the browser engine as a drop-down (**Stockfish 19 lite** / **Stockfish 19 full**; plain text where Full isn't offered, and while playing or exporting), which stays put while the + and the depth come and go, and last a **☰** that turns the whole panel into the engine settings (`AnalysisPanel`, `EngineMenuContext`). Time, nodes, lines and threads aren't shown, nor the engine summary of a loaded analysis or of PGN evals. The drop-down and ☰ show only while paused (and on the free board, not during a game).
- **Search progress**: while Stockfish searches for the Analysis panel (the viewer's move, the free board, Go deeper), a green line grows along the panel's top border, through the searches still to run (the positions after and before the move); each search's share is its time limit or its depth limit, whichever it nears first, a depth taken as about 1.5 times the one before (`useMoveEval`'s `progress`, `Panel`'s `progress`). It's gone when the search ends. A game's analysis keeps its own bar in the panel.
- **Board highlights**: last move in Lichess's green (`rgba(155,199,0,0.41)`); a rated move filled in its rating colour at 60%. Everything on the board uses the dark palette's colours in both themes.
- **Ask Queen** stays in the dock (landscape) and the phone menu, not the Analysis panel (no room on small screens).

**Parity with Python** (`chess_game_analyzer.py` in chess-animator: `analyze_game`, `_classify_move`, `mate_advice`, `_calculate_player_stats`, `winning_chances`, `_eval_to_cp`). Ported, not reinvented:

- Every position searched once (start, then after each ply: N+1 searches); the search after ply i is the "before" of ply i+1.
- Centipawns from White's point of view (UCI's side-to-move score negated for Black); mates as `±(10000 − 10·N)`.
- `eval_loss` with the mate-in-N adjustment, ≥ 0, zero when the played move is the engine's, capped at 1500 for accuracy.
- Ratings: `best` under 5 cp, else Lichess win-chance drops 0.10 / 0.20 / 0.30 (K = 0.00368208); mate rules override, with `mate_advice`/`mate_line` text.
- Accuracy per side `100·exp(−0.005·avg_loss)`; `best_line` up to `BEST_LINE_MAX_PLIES` in SAN, stopping at the first illegal move; the best move is `pv[0]`.
- JSON shape as `sample_game_analysis.json`; `engine` = `{name: "Stockfish 19 lite (browser)", depth, time_limit, lines: 1, threads: 1, hash_mb}`. Per move it adds `search_time_after_ms`, `search_nodes_after`, `search_maxdepth_after` (Python ignores them). Header fields come from the PGN (empty when absent); report-only fields may be empty but present. The engine label reads like Python's `describe_search`: "depth 22, max 3s per position".
- Checked by `tests/check_browser_json.py`.

**Engine plumbing.**

- nmrugg/stockfish.js **v19.0.1 `stockfish-19-lite-single`** (28 KB `.js` + 1.8 MB `.wasm`, GPL-3.0), vendored in `vendor/`, SHA-256 pinned in LAYOUT.md, with a GPL source link in the page. The site can also run the full engine the viewer downloads (see [Full Stockfish download](#full-stockfish-download)). The site serves it next to the page and starts `new Worker(...)` lazily.
- One engine for the page (`SFEngine`), Hash 64 MB set once, no `ucinewgame` within an analysis. Priorities: the Stockfish opponent's `play`, then own moves, then game analysis; a running search is never interrupted.
- Search limits are Settings sliders (Game analysis, Your moves), defaults in `TWEAK_DEFAULTS`.
- Robustness: 30 s start timeout, then the worker is terminated and "Try again" retries; a dead engine reports "Stockfish stopped · play a move to restart it" and is replaced on next use; the site checks the wasm exists first; a run is dropped only when the game changes, and results merge into the current files.
- Time estimate: ~1.3 s per position on a laptop; the ETA during a run comes from the measured rate; the worst case is the time cap × positions.

Benchmarks behind the limits (2026-10-16, Node 22 on this laptop, reference native Stockfish 19 full net 4 s × 7 threads; game 1 Byrne–Fischer, 83 positions, 6 native marks; game 2 a Lichess bullet game, 63 positions, 4 marks):

| Setting | Game 1 | Game 2 | Eval gap to native (g1 / g2) | Native marks matched (g1 / g2) |
|---|---|---|---|---|
| depth 20 / 3 s | 58 s | 76 s | 66 / 54 cp | 2/6 / 2/4 |
| depth 22 / 3 s | 106 s | 112 s | 48 / 49 cp | 2/6 / 1/4 |
| depth 24 / 5 s | 180 s | 189 s | 48 / 46 cp | 2/6 / 1/4 |
| depth 24, no cap | 243 s | 275 s | 44 / 46 cp | 4/6 / 2/4 |

Every setting flags all of game 2's blunders; none finds 30.Qf8?! or 35.Kg1?! (the lite net, not depth). Deeper search mostly narrows the eval gap; one-mark rating differences are run-to-run noise. Hash 16–128 MB made no difference at depth 20; at depth 24 uncapped 32 MB filled to 95%, hence 64 MB. Peak RSS ~210 MB.

Hash re-checked with no depth limit (2026-10-25, Node 22 on this laptop, one search per fresh engine, `go movetime`, hashfull as Stockfish reports it; two made-up middlegames, one roughly ±6, and KBN v K `7k/8/8/8/8/8/8/KBN5 w`):

| Search (middlegames) | Engine | 32 MB | 64 MB | 128 MB | 256 MB |
|---|---|---|---|---|---|
| 3 s (game analysis default) | lite | 30–36% | 16–18% | 9% | 4–5% |
| | full | 16–17% | 8% | 4% | 2% |
| 5 s (your moves default) | lite | 53–55% | 30% | 15–16% | 7–8% |
| | full | 27–29% | 12–15% | 7% | 3–4% |
| 20 s (Go deeper, 3rd press) | lite | 99% | 85% | 54% | 29% |
| | full | 83–85% | 52–57% | 27–29% | 14% |

Full searches about half the nodes a second of lite in a middlegame (0.25 M against 0.5 M), so it fills the hash half as fast. No size made a consistent difference to depth or eval. In KBN v K at 20 s both engines found mate in 30–33 only at 64 and 128 MB, not at 32 or 256 (single-threaded Stockfish is deterministic for one hash size, and the size changes the tree, so a deep mate turning up is luck of the size, not more memory). Peak RSS in Node, full: ~500 MB up to 64 MB of hash, ~640 MB at 128 MB, ~750 MB at 256 MB (above 64 MB each doubling adds its size). Hence 64 MB stays the default for both engines; the bigger sizes are in Settings for long searches on a desktop.

### Opening names

`openings/*.tsv` is a verbatim copy of Lichess's chess-openings tables (CC0), shared with chess-animator; updating it updates both. `openings-core.js` ports chess-animator's `OpeningBook`: positions keyed by EPD (so move orders and FEN starts both match), each named by the deepest named position on its line.

- A game whose PGN has no `Opening` header (or `?`/empty) gets its name and ECO from the book; the saved analysis JSON carries them.
- The book name of the current position sits right of the **Commentary** heading while in book, also for explored lines.
- The table is embedded in the page and built lazily on first need.

### Custom starts and flip

- `ChessCore.buildGame` accepts a `[FEN]` start: Black may move first, castling rights come from the FEN. Move numbers and sides come from `M.ply0` (`ChessCore.moveNo`), never `i % 2`.
- The engine sends `position fen <fen> moves …`; caches (`SF_EVAL_CACHE`, partial runs) key on the start FEN too.
- **Flip** turns the board, coordinates, player bars and eval bar, for loaded games and the free board; remembered like other settings. Squares become pixels only through `view()`.

### Free board and explorer

A plain board with Stockfish, separate from the replay (`app/free-board.jsx`, state in `BoardCore`), reached from the dock's **Play/Explore** menu (and the phone menu), in two labelled groups: Explore (Starting position, Edit position, Paste PGN, Copy FEN) and Play (Play vs human, Play vs Stockfish, My games).

- **Explore**: every move by either side gets Stockfish's verdict, as own moves do; the eval bar follows; Stockfish's eval and best line show before the first move too. Moves are numbered correctly from a FEN. Undo/redo with ← →.
- **Edit position** (below; it replaced Paste FEN on 2026-10-25).
- **Paste PGN**: a multi-line box; Load or Ctrl+Enter opens the text as a loaded game, as Load game does with a file (tags, comments, evals, a `[FEN]` start; the first game of several). A PGN that doesn't build gets ChessCore's message and changes nothing. Ctrl+V on the page doesn't load a PGN (decided: too easy to set off). Under Explore for now, though the result is a loaded game.
- **Copy FEN**: copies the six-field FEN of the position on the board, in the replay (a line being shown included) or on the free board; the half-move clock and move number count on from the start's. A note shows the FEN for 4 s; where the clipboard is refused it stays up, the FEN in a read-only field that selects it all with one click.
- **Opening explorer** in the Commentary box: the opening's name and the book moves that continue from the position (`openings-core.js` continuations), each clickable; a short note once out of book. No win rates or game counts (that is the Lichess explorer on the roadmap). At 7 pieces or fewer, with the tablebase setting on, the endgame tablebase takes its place (see Endgame tablebase).
- **Replay these moves as a game** (Settings) opens the board's moves as a loaded game for replay, analysis and MP4/WebP export, with "Back to the free board" to return.
- The board (start FEN, moves, position in the line) survives a reload: `{ board: { fen, moves, upto } }` in the stored files.

### Edit position

The viewer sees a position or puzzle somewhere (a book diagram, a screen, someone's game) and wants it on the board, to analyse it or play on from it. Modelled on en-croissant's editor; the view is `EditBoard` (`app/edit-board.jsx`), its rules `EditCore` (`app/edit-core.js`), and `GameApp` swaps it in for the free board or the loaded game while its `editing` state is set (neither stays mounted, so no search, Stockfish reply or clock runs meanwhile).

- **Entry**: Play/Explore › Explore › **Edit position**, under Starting position (the phone menu too). It opens on an **empty board**, White to move, no castling. From a game in progress it asks first (`guard`); the game is paused and kept in My games.
- **Layout**: the board where the free board draws it, centred where no eval bar stands beside it; the editor in the panels' room beside it in the two-column layout, with the piece tray in the panel. In the one-column layout the tray's two rows sit right under the board and the panel under them.
- **The panel**: a FEN field updated live, which sets up any well-formed FEN at once, legal or not (a `[FEN "…"]` tag too); only malformed text is refused, with a message under it, the board unchanged. **Start**, **Empty**, White/Black to move. Castling boxes (White and Black, O-O and O-O-O), each enabled only while its king and rook stand on their home squares; moving either off unticks it, and a pasted FEN's unsupported rights are dropped. The tray (White's six pieces, then Black's). A status line. **Cancel** and **Done**.
- **Editing**: drag a tray piece onto a square; or click/tap a tray piece to hold it (again, or Esc, lets it go) and tap squares to drop copies, a tap on the same piece taking it off. Drag a piece on the board to move it, or off the board to take it away. Squares through `view()`, so a flipped board works. Any edit drops en passant; the move number stays.
- **By keyboard**: the board is a Tab stop (`role="application"`). A tray piece picked with Enter or Space sends the focus to the board. There the arrows move a square outlined while it has the keyboard's focus (as the viewer sees the board, flipped too; it starts on e4); Enter or Space places the held piece (on the same piece takes it off), or with none held picks up the piece there and puts it down on the next square Enter is pressed on (Esc lets it go); Delete or Backspace takes the piece away; K Q R B N P place White pieces, k q r b n p Black ones. The keys are listed under the status line while the board has the keyboard's focus, and a screen reader hears the square and its piece.
- **Checks** (each a line in the status line, `EditCore.problems`): "White has no king." / "Black has 2 kings."; "The pawn on a8 can't stand on the first or last rank."; "Black is in check, but it's White's turn."; "White is in check from 3 pieces, which no move can give." / "… from two pieces in a line, …" (chessops' impossible-check rule, without its en passant cases). An empty board shows a hint instead ("Drag pieces from the tray, or tap one and then tap squares."). Done is disabled while any line shows; a setup with none is one `ChessCore.parseFen` accepts.
- **Done** opens the free board at the position (`commitBoard(BoardCore.fromFen(…))`). **Cancel** or Esc goes back to what showed before; a game left for the editor resumes, its clock running from then (the time spent editing isn't charged). A reload while editing drops the unfinished edit.
- Copy FEN copies the editor's FEN.
- **From the Play dialogs**: Play vs human and Play vs Stockfish always offer Start from (Starting position, Set-up position). With no position set up on the board, Set-up position turns Start game into **Set up position…**, which opens the editor keeping the dialog's choices (time control, side); there Done reads **Start game** and starts the game from the position, and Cancel brings the dialog back as it was.

### Play vs human

- Two players at one screen, from the starting position or a set-up position: the board's, or one set up in the editor from the dialog (Edit position). The board turns to the side to move after each move. No eval, arrows, verdicts, engine replies or book moves; Stockfish starts no search.
- Ends on checkmate, stalemate, insufficient material, a dead position behind locked pawns, resignation (asks first), a draw by agreement or a claimed draw, with the result in the Analysis box and Play again / Analyse there. As in FIDE's rules, a threefold repetition or fifty moves without a capture or pawn move let the side to move **Claim a draw** (the button replaces Offer a draw); a fivefold repetition or 75 moves end the game by themselves.
- **Take back** is a button by Resign; no limit, nothing recorded. Time already spent stays used (a takeback never buys time); the move's increment comes off.
- **Time control** (optional, off by default): 5+3, 10+0, 15+10, 30+0, shown in the player bars; a flag fall loses unless the opponent has no mating material (draw). A reload charges the running clock for the time away (a flag can fall meanwhile); a game left (for another board or by closing the page) is kept in My games with the side to move's time so far used, and resumed from there with its clock running from when it opens (the time away isn't charged).
- Rules and clocks live in `PlayCore` (`app/play-core.js`); the game record is `board.game`, stored with the board.
- Leaving a game in progress asks first (and says the game is kept).

### My games

- Every game (`board.game.id`) is kept from its first move under `chess-video.games.v1` (`GamesCore`), the 50 newest, written on each move, takeback or result.
- The My games list resumes a game in progress or opens a finished one as a loaded game from `PlayCore.pgn` (replay, own moves, Analyse, Queen, Save PGN, video export). Each can be deleted. The crash screen's Clear saved data leaves the list alone.
- PGN headers: players, date, result, `[FEN]`/`[SetUp]` for custom starts, `[TimeControl]` and `%clk` when clocked.

### Play vs Stockfish

- The player picks White, Black or random; the board is drawn from the player's side and never turns. Stockfish plays at full strength (no strength setting: "prepare to get crushed") at the engine's `play` priority, after a short pause; its think time is capped so its clock doesn't flag.
- Same ends, Take back (back to the player's previous turn, Stockfish's reply included) and time controls as vs human, minus draw offers and claims: threefold repetition and the fifty-move rule end the game by themselves.
- Stockfish quietly rates the player's moves (`critique`: `{ j, cls, best, text }`); an inaccuracy, mistake or blunder is flagged in the Commentary box with a short line, and the better move and evals show only after the game.

### Full Stockfish download

Some viewers want the strongest engine, as Lichess offers for local analysis. The Analysis panel's engine drop-down: **Stockfish 19 lite** (the default) or **Stockfish 19 full** (99 MB, said by its Download button).

- Full is stockfish.js v19.0.1 **`stockfish-19-single`** (28 KB `.js` + 99 MB `.wasm`, the big NNUE net inside), single-threaded: the multi-thread build needs cross-origin isolation (PR 5). Not committed to git (just under GitHub's 100 MB limit); fetched from `https://unpkg.com/stockfish@19.0.1/bin/` (CORS open), both files checked in the browser against SHA-256s pinned in `app/sf-full.js` (`SFFull`).
- Picking Full before it is downloaded opens the Analysis panel's engine menu (☰), which shows the size (behind the button's ⓘ), where it comes from and a **Download full Stockfish · 99 MB** button; nothing downloads before the click. Progress shows by the megabyte with Cancel. A connection that sends nothing for 30 s (before the answer or between chunks) is given up with "unpkg.com stopped sending …", so a stall can't hang the download; Download tries again. Before fetching, `navigator.storage.estimate()` must leave room for the files plus 10%. Nothing is kept unless both files arrive whole (no more, no less than the pinned size) and match.
- The files are kept in the cache `stockfish-full-19`, which `sw.js` never deletes (it clears only `chess-replay-*` caches on a deploy), and the page calls `navigator.storage.persist()` (Chrome decides by itself, Firefox asks). So it is a one-time download, offline afterwards, unless the browser evicts it, the viewer clears site data, or (Safari) the site goes unvisited for 7 days outside a home-screen app.
- Until the copy is kept, and whenever it goes missing, Lite runs. Starting Full trusts the copy checked at download: once per page it compares only the sizes (a missing or cut-short copy is deleted and the setting offers the download again with a note), never reading the 99 MB into the page or hashing it again, and starts the worker from the cache's Blobs as Blob URLs, the glue reading its wasm URL from the `#hash`.
- Switching engines quits the running engine (its searches answer null) and stops a running analysis. The engine wanted is known while rendering, so a panel searching again after the switch gets the new engine, never the one being quit; its partial run keeps its key, which includes the engine name, so it resumes only with the engine that made it.
- The engine name follows the engine that runs: "Stockfish 19 (browser)" for Full (`AnalysisCore.ENGINE_NAMES`, `engineSettings(t, kind)`), and the analysis JSON records it. The own-move eval cache (Go deeper on a stored move too) and the pace estimate (`chess-video.sf-pace.v1.full`) are kept per engine. Play vs Stockfish plays with whichever engine runs.
- A kept copy shows **Remove the full engine download · 99 MB** (with Lite selected too), which asks first: "Remove the full engine? You'd need to download 99 MB again to use it." with **Remove** and **Keep**.
- Tests: `tests/sf-full.test.cjs` (fake unpkg, Cache Storage and Worker: checksum, size, quota, a stalled connection, cancel, a kept copy trusted, a partial copy dropped, remove); the live suite downloads the real files from unpkg in each browser (one retry if the download fails, as unpkg is a third party: a CI run once had Chrome's download not finish in 240 s) while a move rated by Lite is shown, sees Full rate it again without another move, reloads without fetching again and removes the copy.

### Lines (MultiPV)

Analysis › ☰ › **Your moves: lines**, 1 to 5 (`sfLines`, default 1), for the searches of the viewer's own moves (the replay's own line and the free board).

- `SFEngine.search({ lines })` sends `setoption name MultiPV value N` between searches, only when it changes; every other search (the position before the viewer's move, which only rates it, so it goes as deep as one line can; a game's analysis; the Stockfish opponent and its "before" search; Go deeper on a stored move) asks for 1, so the analysis JSON is unchanged (`lines: 1`). Results gain `lines: [{ k, cp, depth, pv }]`, by rank; `cp`, `pv` and `best` stay line 1's. A line more than one depth behind line 1 has stopped being reported and is dropped.
- With more than one line the Analysis panel lists them, one row each (eval, a dim `d17` when a line is shallower than line 1, its first moves in SAN, wrapping under each other beside the eval column); a move plays the line on the board up to it, as Stockfish's replies did. The board shows an arrow per line's first move: line 1 as the best-move arrow, the others thinner and fainter (Settings › Best-move arrows turns them off). One line looks as before.
- The own-move eval cache keys a search of several lines apart from one of one line. A note in Settings says each line gets a share of the search, so goes less deep in the same time.
- On the phone a line's moves take two rows, and the Analysis panel scrolls to the later lines (a row cut off at the panel's edge hid moves there).
- Tests: fake worker (option sent once per change and before the position, lines by rank, a lagging line dropped, White's point of view), settings range, real Stockfish giving 3 different first moves at the start, live: Lines 3 on the free board shows three rows and three arrows.

### Endgame tablebase

Positions of 7 pieces or fewer get Lichess's Syzygy tablebase (`https://tablebase.lichess.ovh/standard?fen=<FEN>`, no auth): the result with best play, its distances and every move ranked by result.

- `LichessCore` (`app/lichess-core.js`): the URL, the parser (`category`, `dtz`, `dtm`, `checkmate`, `stalemate`, `insufficient_material`, `moves[]` with `uci`, `san`, `category`, `dtz`, `dtm`, `zeroing`, as verified against the service), Lichess's verdicts, the eval bar's value and the moves grouped by result. Its client caches 300 answers by FEN (without the move number), sends one request at a time, backs off 60 s after an HTTP 429 and gives up after 10 s; an error, a 429 or being offline answers null ("Not available"), never an error screen. The FEN is the one Copy FEN gives (`ChessCore.fenAfter`): real castling rights, en passant square and fifty-move count, which the service takes into account (KBN v K with DTZ 55 is a win with the count at 0, a cursed win at 60).
- `app/tablebase.jsx`: `useTablebase(pos, on)` asks 300 ms after the last position change (a cached position shows at once), only at 7 pieces or fewer.
- Where: the Analysis panel's **Tablebase** block, under the engine lines (the panel scrolls to it where it doesn't fit, as on the phone): the verdict in Lichess's words (White wins, Draw, Cursed win for White · drawn by the 50-move rule, Blessed loss…, the uncertain "maybe" ones too) with DTZ and DTM, then the moves in one line per result (Win, Draw, Loss), best first, each a button that plays it (in the replay as the viewer's own move, on the free board as a drag would) with its distances in its tooltip. On the free board it isn't in the Analysis panel but in the Commentary box, in place of the opening explorer (as on Lichess; `TablebaseExplorer`), titled **Endgame tablebase** with DTZ and DTM on the right: the verdict as the heading (a long one's reason as a note), then the moves grouped by result (Win, Draw, Loss), each group's moves wrapping in rows of SAN buttons with nothing else written beside them (their distances in their tooltips), so the losing ones, which can throw a draw away, show too; "Looking up…" while it's asked, "Not available" when Lichess can't be reached. Above 7 pieces or with the setting off the explorer is back. The eval bar shows the result instead of the eval, tagged TB: a win as a mate in DTM/2 moves (`TB M28`, `TB 1-0` without DTM), a draw, cursed win or blessed loss as `TB 0.00`; an uncertain result leaves the engine's eval.
- When: the replay while paused (never in playback or the video export), and the free board; never during a game (vs human or Stockfish). The stored analysis, ratings and graph are left alone.
- Settings › **Online** › **Endgame tablebase** (`TWEAK_DEFAULTS.tablebase = true`, as it fires only at 7 pieces or fewer); off sends nothing. `sw.js` never keeps its answers (live data, not in `KEEP_HOSTS`).
- Not done from the plan: no arrow colour for winning moves (the Stockfish arrow already points at a best move, and a second one crowded the board).
- Tests: `tests/lichess-core.test.cjs` (real answers in `tests/fixtures/tb-*.json`: a win, a draw, a cursed win, a mate; the piece-count gate, the cache, errors not cached, the 429 back-off, one request at a time), live: KBN v K on the free board shows the verdict and `TB M28`, a tablebase move plays, 8 pieces and the setting off send nothing.

**In game analysis** (PR 2b, built 2026-10-25): "Analyse with Stockfish" with the setting on asks the tablebase for each position of 7 pieces or fewer before searching it, through the page's one client (`TB` in `app/tablebase.jsx`: its cache, one request at a time, the 429 back-off).
- `AnalysisCore.runAnalysis({ tablebase })` (the client, or null with the setting off): a certain answer becomes the position's result, `{ cp, depth: 0, pv, best, tb: { category, dtz, dtm } }`: its eval `LichessCore.evalCp` (the eval bar's value: a win as a mate in DTM/2, ±9990 without DTM, a draw, cursed win or blessed loss 0; a checkmate ±10000, a stalemate 0), its best line the tablebase's best move alone (one request a position: the DTZ mainline, `/standard/mainline`, was built and dropped, see the decisions log). An uncertain answer ("maybe", "unknown") is searched. A run's requests go at least `AnalysisCore.TB_GAP_MS` (4 s) apart, an answer the client already has not waiting: Lichess publishes no limit for the tablebase, and it answered 429 to about 10 requests in a minute. During the client's 60 s back-off after a 429 the positions are searched, then it is asked again; the first request that fails otherwise (offline, an error, the 10 s timeout) ends the asking for that run, and Stockfish searches the rest. The setting turned off during a run ends the asking too (`runAnalysis({ tablebaseOn })`, checked again after the wait between requests), so nothing more is sent; the run goes on with Stockfish.
- Ratings: a move from one tablebase position to another is rated by `AnalysisCore.rateByOutcome`: keeping the win, the draw or the loss is `best` with no loss, however slow; win → draw (a cursed win counts as a draw), draw → loss or win → loss is a `blunder`, its eval loss as `rateMove`'s (capped at 1500), no mate advice. A move between a searched position and a tablebase one (a capture into the tablebase, an uncertain answer, the back-off) is rated by the usual rules; where the tablebase side is a win or loss with no DTM (6 and 7 pieces, `AnalysisCore.tbWonOnly`), its ±9990 means won, not mate in 1, so that position is searched too (kept as the result's `sf`) and the move is rated on the two searches, as without the tablebase. The eval shown stays the tablebase's. Positions with DTM keep their mate scores: a TB mate in 28 that Stockfish misses after the move is "Lost forced checkmate sequence", as with a Stockfish mate.
- JSON: a move gets `tb_before` / `tb_after` (`{ category, dtz, dtm }`, each for its side to move) for the positions the tablebase answered, their search depths 0; the engine block gets `tablebase: true` when any position was; `ChessCore.buildGame` turns these into `ply.tb`, `ply.tbBefore`, `ply.won` (a win with no DTM: the eval shows `1-0`/`0-1`, not a mate count) and `ply.search = { tablebase: true }`, which the Analysis panel's header shows as "Tablebase" in place of a depth; the engine summary ends "· Lichess tablebase"; a best move from the tablebase says "The tablebase agrees". Go deeper isn't offered on those positions.
- A stopped run's searches (`sfPartialKey`) are keyed with the setting when it is on, so it resumes only with the same setting; a key with it off is as before. The estimate counts the game's positions of 7 pieces or fewer at 4 s each (`SF_TB_SECONDS`, one request each). The run's pace counts only the engine's searches and their time: `onSearched(R, { searches, tbMs })` gives the searches made and the time spent on the tablebase (requests and the waits between them) since the last call, so an uncertain answer's search isn't timed with its request.
- Never in Play vs Stockfish (its opponent and critique don't use `runAnalysis`) or for the viewer's own-move ratings.
- Tests: `tests/tablebase-analysis.test.cjs` (fake client: no search for tablebase positions, fields, the outcome table, a cursed win, an uncertain or failed answer searched and the asking stopped, a 429 back-off searched through and asked again, the requests' pacing, the setting off and 8 pieces send nothing, the setting turned off mid-run, a win without DTM beside a searched position rated on two searches, the tablebase's time reported apart, a resumed run, `buildGame`); `tests/check_browser_json.py` also loads its JSON (`tests/out/tb_analysis.json`) in Python, which has no tablebase.

### Responsive layout

Built 2026-10-26 (designed the same day), replacing the fixed video frames (1920×1080, compact, square, sideways and 840-wide portrait, scaled as a whole to the window) with a normal responsive page. Text keeps one comfortable size whatever the window, extra room goes to the board and the panels together, and nothing is cut off at any size (the anti-goal; a live test sweeps nine sizes for overflow).

- **Where it lives**: `LayoutCore` (`app/layout-core.js`, pure numbers in, boxes `{ x, y, w, h, scroll }` out) says where the board, eval bar, player bars and each panel go for the window's size, the view (`replay`, `free`, `game`, `edit`) and the text size. `Stage` (`app/engine.jsx`) measures the window, picks the column count and gives the views a frame `{ w, h, text, cols, video }` (`useFrame()`). Views place only what `LayoutCore` says; the board is a fixed 768 px picture scaled into its box (`BoardSpace`, `app/game-video-core.jsx`), so pieces, arrows and badges stay in board pixels through `view()`. The fixed `LAYOUTS`/`tallLayout`/`COMPACT`/`SQUARE`/`SHORT` frames are gone.
- **Two columns**: the board (with its player bars, and an eval bar in the replay and free board only) on the left, up to 900 px; on the right the game info, then Moves, Commentary under it, then Analysis. Moves wraps the moves in lines, as the Analysis panel's lines do (a light chip for White's move, a dark one for Black's) and is never taller than five lines (a third of the sidebar's room under the game info, at least its title and one line), scrolling by whole lines, its height rounded down to whole lines so none shows cut off; Commentary and Analysis share the rest. The eval graph (replay only) runs full width at the bottom (110 px) from 700 px high, and from 670 px wherever the board, held by the width, keeps its size with it there; otherwise it sits in the sidebar under Analysis (80 px) while the sidebar has the room, else it is hidden; under 670 px high it is always hidden. A square-ish two-column window (at least 0.77 times as tall as wide, as a 760 px wide window from about 640 px high) puts Analysis the full width under the board (at least 160·text px; the board gives way for it), and the eval graph at the bottom under it, full width, 80 px high (as in the sidebar), where Analysis keeps 240·text px over it (at 758 px wide, from about 836 px high), and the sidebar keeps the game info, Moves (40% of the room under the game info, still five lines at most) and Commentary. The sidebar takes at least 320·text px, and up to (230+150)·text+10 px while the board stays at 360 px or more, the width that once held Moves and Commentary side by side.
- **One column**: the board across the width, then the game info (the paused page only: a video has none), Moves (three lines at most), Analysis and Commentary at the bottom, at fixed heights (times the text size), each scrolling inside itself; the page scrolls and the transport bar stays pinned at the bottom of the screen. No eval graph (the eval bar stays, where the view has one). Edit position shows only its tray and panel, the tray under the board and the panel under that.
- **Which one**: `LayoutCore.columns()` picks one column when the window is tall for its width (height over 1.25 times the width, with hysteresis: to one column at 1.3, back to two under 1.2) or when the board beside the sidebar would be under 360 px (380 to come back): by the room left, not by device, so 1024×768 keeps the sidebar, 758×929 keeps it square-ish and 768×1024 stacks. A window too short for the one-column layout keeps two columns where a 200 px board still fits beside the sidebar (a phone held sideways, even at Larger text), and always for a video; a paused page in a narrow, short window (a phone with its keyboard up) takes one column.
- **Text size**: Settings › Appearance › **Text size** (Small, Default, Large, Larger: 90, 100, 115, 130 %; `TWEAK_DEFAULTS.textSize`, persisted). It sets the root size (`--text`, so the dock, Settings, menus and dialogs follow, all in `rem`) and the panels' text through `tx()`; widths that hold text (the sidebar minimum, the one-column switch, the bars) grow with it, so a larger size stacks sooner. The board's pieces don't scale. The browser's own zoom works too.
- **A video is screen-sized**: while playing or exporting, the page fits the window exactly (the one-column panels shrink under the board, to a 48 px floor, the board never under 200 px) and the title and end cards draw over it, so the size never changes mid-video. Panels follow the current part (Moves the current move), so a long comment can be out of frame at that moment.
- **Exports record the page as it is**: the screen-sized page at `min(devicePixelRatio, 1920 / longer side)` (`LayoutCore.exportScale`), sides rounded down to even. Settings' WebP widths are full, the fixed widths below it, and half, and the exports use the text size chosen.
- **Video touches only while playing or exporting**: the title and end cards, the panels' fade-in, the blunder glow, the camera push and the commentary's typewriter. Stepping, clicking a move, exploring and analysing show a plain, still page, Commentary in whole (a long comment scrolls in its box). Pieces and arrows still slide to their squares, as normal app behaviour.
- **Every view**: the replay, the free board and explorer, Play vs human and Stockfish, and Edit position use the same layout. Overlays (dock, Settings, menus, dialogs) float over it as before, with their rules keyed on `.stage-one` in `app/shell.html`; `.stage-short` (a two-column window under 500 px tall) slims the transport bar.
- **Touch and drag**: the board's touch layer opts out of the page-wide drag-scroll (`data-no-drag-scroll`), so a mouse drag on the board moves a piece in the one-column page instead of scrolling it.
- **Tests**: `tests/layout-core.test.cjs` (boxes, the column rule, export scale) and the live layout sweep (`tests/live/site.test.cjs`: nine sizes from 320×568 to 2560×1080, both browsers, no text overflowing its box, the board's and panels' floors).

## Roadmap

Planned, roughly in this order; each item gets its own PR(s) on a `claude/<topic>` branch. Items marked *needs design* have open questions to settle with the user before a plan.

### Square layouts and breakpoints (*needs design*)

The responsive layout's squarish windows (near 1:1, such as an unfolded foldable or a tablet-sized window around 772×965) get either a sidebar that holds the board small or one column that scrolls; neither is designed for that shape. Open: a layout of its own for square screens (the board with the panels in a band under or beside it, sized for both); whether the device tiers' breakpoints (phone under 600 px wide or 500 px high, tablet and foldable 600–1023, desktop from 1024) and the stacking rules hold up on real devices (iPhone Duo's viewports per WebKit: 382–951 wide, 368–902 high); whether a half-folded screen (`device-posture: folded`, viewport segments, in preview in Safari 27.1) puts the board and the panels on separate halves. Asked for 2026-10-27.

### Lichess data and multi-threaded Stockfish

Unverified facts are marked **verify**.

| # | PR | Depends on | Risk |
|---|----|-----------|------|
| 1 | `claude/multipv`: Lines setting, multi-line engine panel and arrows (built, see Lines (MultiPV)) | none | low |
| 2 | `claude/tablebase`: endgame tablebase (built, see Endgame tablebase) | none | low |
| 2b | `claude/tablebase-analysis`: the tablebase in game analysis and move ratings (built, see Endgame tablebase) | 2 | medium |
| 3 | `claude/cloud-eval`: Lichess cloud evaluation | 1 | low |
| 4 | `claude/lichess-explorer`: opening explorer and Lichess sign-in | none | medium |
| 5 | `claude/threads`: cross-origin isolation, multi-thread engine, Threads setting | 1 | high |

Ship 1 to 4 first (2b right after 2); 5 last and alone, since its headers affect every external load.

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

**PR 3: Cloud evaluation.** `https://lichess.org/api/cloud-eval?fen=<FEN>&multiPv=<N>` (no auth, 404 when never analysed, rate limited) **verify** `variant`, `multiPv` limits and shape (`depth`, `knodes`, `pvs[{ moves, cp | mate }]`).

- `LichessCore.cloudEval(fen, lines)` returns the engine-result shape tagged `source: 'cloud'`; mates mapped to `±(10000 − 10·N)`.
- With the toggle on, each position asks the cloud (debounced) and runs the local search at the same time; whichever arrives first shows, the deeper replaces it, labelled "Lichess cloud, depth 40". "Prefer cloud" skips the local search when the cloud depth meets the local limit. A miss falls back silently.
- Never used for batch analysis, the Stockfish opponent or its critique.
- Tests: parser, mate mapping, 404 → null without retry loops, debounce, toggle off sends nothing.

**PR 4: Opening explorer.** `https://explorer.lichess.ovh/lichess?fen=<FEN>&moves=12&topGames=4&recentGames=0` (and `/masters`) **verify** whether a Bearer token is required.

- Sign-in: Lichess OAuth2 PKCE (no client registration, no scopes for public data **verify**), like the HF sign-in (`HF_OAUTH.redirect` in `queen.jsx`), with a pasted personal token as the fallback. The token is kept in its own localStorage key, sent only to Lichess hosts, cleared by Sign out, treated like the HF token by Clear saved data. Redirect URLs in README next to the HF note, plus a CLAUDE.md gotcha.
- `LichessCore.explorer(fen, { db, ratings, speeds })` → totals, `moves: [{ uci, san, white, draws, black, averageRating }]`, `topGames`, `opening`.
- An Explorer panel (replay and free board, not in games): moves with game counts and a white/draw/black bar, click to play on the free board; name and ECO from the response, the local book as fallback and as the default when off. Database (Lichess, Masters) and rating/speed filters in settings.
- Tests: parser, token header only when signed in, 401 → "Sign in to use the explorer", filters change the cache key.

**PR 5: Multi-threaded Stockfish lite.** stockfish.js v19.0.1 multi-thread lite **verify** file names and sizes; vendored and pinned as now. The single-thread files stay as the fallback.

- The full engine (built 2026-10-24, single-threaded) gains its threaded build the same way: `stockfish-19.js` + `stockfish-19.wasm` (99 MB) from unpkg, pinned in `sf-full.js`, used when the page is isolated, with the single-thread full engine as the fallback. A viewer who already downloaded Full downloads the threaded file once more.

- Cross-origin isolation: `render.yaml` headers on `/*`: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`. Then audit every cross-origin load (`grep https:// app/`): cdnjs/jsdelivr scripts (already `crossorigin` with SRI), Google Fonts (`crossorigin` on the links), Lichess `fetch` (CORS), the HF sign-in (must be a redirect, not a popup, under COOP), the Queen Space's Gradio API.
- `sw.js` re-serves responses with the isolation headers and keeps the new engine files; `tests/live/serve.cjs` sends the same headers and the live suite asserts `crossOriginIsolated`.
- `stockfish.jsx` `sfFiles()` picks the threaded build when `crossOriginIsolated && SharedArrayBuffer`; any failure falls back silently to single-thread, with Threads disabled and the reason shown.
- Analysis › ☰ (engine settings): **Threads** 1 to `min(hardwareConcurrency − 1, 8)`, default half the cores up to 4 (`sfThreads`); `setoption Threads` applied between searches like Hash/MultiPV, restarting the worker when idle if the build needs it **verify**. Hash is shared by all threads.
- Batch JSON records threads; `sfPartialKey` includes them; the Python check runs with 1 thread (multi-thread results aren't reproducible). Pace estimates keyed by thread count. Check the Stockfish opponent's movetime and critique timing.
- Tests: fake-worker option order and restart, settings, file choice; live: isolated page, Threads 4 + Lines 3 shows three lines and higher nps, offline reload keeps the headers, fonts/React load, HF sign-in returns. Manual: phone, iOS Safari (silent fallback), desktop Firefox.
- Rollback: delete the two header lines in `render.yaml`.

**Cross-cutting**: Settings › Online gains the toggles, sign-in and filters, and the Analysis panel's engine menu Threads, defaults conservative in `TWEAK_DEFAULTS`; README and CLAUDE.md updated (straight to `main`); screenshots per the repo rule; every feature degrades to "not available" offline.

### Player names (*needs design*)

In Play vs human set White's and Black's names; in Play vs Stockfish the player's (Stockfish is "Stockfish 19"). Open: asked in the Play dialog or set later; whether the last names are remembered; where they show (player bars, My games rows, the PGN's `White`/`Black`, where `PlayCore.pgn` writes "White"/"Black" today).

### Chess960

From a FEN with X-FEN or Shredder-FEN castling, using Stockfish's `UCI_Chess960`; today `buildGame` rejects it ("Chess960 positions aren't supported yet"). The only variant: three-check, King of the Hill, crazyhouse, atomic, horde, antichess and racing kings are out of scope (another rules engine and a variant Stockfish). Must also read Lichess 960 exports (`[Variant "Chess960"]`, `KQkq` with the king off e1) and reordered rights (`kqKQ`), which today get "Castling rights don't match the pieces".

### Typed commentary (*needs design*)

The user types their own comment on a move. Open: where (replay, free board, a game from My games, all); how it sits with PGN comments, the notes file and Queen in the Commentary box (each now a Settings toggle) and in the video; whether Save PGN writes it as `{ }`; where it is kept (with the loaded game, with a My games entry, which ties in with replayed games losing their analysis and commentary today).

### Maia3 (*needs design*)

Maia predicts human moves at a chosen rating, unlike Stockfish's best move. Open: what for (an opponent in Play vs Maia, "what a human would play" beside Stockfish, or both); whether it runs in the browser (weights, runtime, size, licence) or would need a server (which the principles rule out without the user's say); which ratings.

### Dead positions (*needs design*)

Games end by themselves in a dead position (no legal sequence of moves mates either side, FIDE 5.2.2), and a flag fall there is a draw (6.9). Today `PlayCore` proves only too little material (`canMate`) and pawns locked with kings and same-coloured bishops (`lockedDead`); a forced line into a dead position (the only legal move takes the last piece), or locks with knights or rooks, plays on, and the flag rule looks at material only. The fix is a helpmate search on the device (both sides cooperating, bounded in depth and nodes), as Miguel Ambrona's Chess Unwinnability Analyzer (CHA) does; Lichess uses a version of it for timeouts **verify**. The endgame tablebase can't help: its "draw" means drawn with best play (KR v KR is one, yet either side can blunder into mate), the same category as a dead position; a TB win only proves a position isn't dead. Open: the search's limits and cost per move (it runs on every move of a game), whether it also decides flag falls ("can the opponent mate by any legal sequence"), whether replays mark a dead position.

### chasolver (*needs design*)

[chasolver](https://github.com/miguel-ambrona/chasolver) (Miguel Ambrona, MIT, a Rust crate, v3.0.0 of 2026-06-22; site https://chasolver.org) is CHA's successor: given a position and an intended winner it finds a helpmate or proves none exists (`winnability`), and has been run on every timeout of Lichess's standard rated games. The candidate engine for Dead positions: built to WebAssembly and served next to the page like `vendor/`, loaded on a game's first move (or first flag fall), so `PlayCore` asks it rather than growing its own search. Open: its WebAssembly size and speed per move on a phone **verify**; whether it builds for `wasm32` without changes **verify**; whether it replaces `canMate`/`lockedDead` or backs them up when they can't prove a position; what a game shows while it is still loading (offline before it is kept, the flood fills alone).

### Background music

Music that plays under the page, chosen from a few bundled tracks or the viewer's own file. Added 2026-10-23.

Decided by the user:

- **Plays on the replay page, playing or paused, and on the free board and in games** (Play vs human, Play vs Stockfish).
- **Not in exported videos**: MP4 export keeps the move sounds only.
- **Sources**: a small set of bundled free tracks, and an audio file from the viewer's device.

Proposed (my calls, to confirm when designing):

- **Settings › Sound**, beside the move sounds: a **Music** select (Off, each bundled track, "Your file…") and its own volume slider. Defaults in `TWEAK_DEFAULTS`: `music: 'Off'`, `musicVolume` around 40, so existing viewers hear nothing new until they choose. The move-sound toggle doesn't touch music.
- **One player for the whole app**, so music carries on when switching between the replay and the free board, and isn't restarted by loading a game. The chosen track loops.
- **Autoplay rules**: browsers start audio only after a user gesture. Choosing a track in Settings starts it; after a reload it starts on the first click or key on the page. No "tap to play music" prompt.
- **Pauses while the tab is hidden** and resumes on return (battery on phones).
- **Bundled tracks**: 3 to 5 calm instrumental loops, licences that allow redistribution with a GPL-3.0 app (CC0 preferred; CC-BY credited in README and Settings), listed with source and licence in README like the Lichess sounds. MP3 or AAC (plays on iOS Safari), ~96–128 kbps, a few MB each, in `vendor/music/` and served next to the page, never inlined; a track downloads only when chosen. The service worker keeps a track once played, so it works offline after that; tracks aren't precached.
- **Viewer's file**: a file picker for `audio/*`, played locally and never uploaded. Kept in IndexedDB (too big for localStorage), one file at a time, with a size cap (e.g. 30 MB) and a plain message when it's over or won't decode. Clear saved data removes it.

Open questions:

1. Which mood or genre for the bundled tracks (piano, lo-fi, classical, ambient), and does the user have tracks in mind?
2. One track looped, or play the bundled tracks in turn (with shuffle)?
3. A quick mute in the dock or phone menu, or Settings only?
4. Should music duck (drop in volume) under move sounds, Queen, or a game's end?

### Peer-to-peer online play (*needs design*)

Play vs human between two devices: one player makes a game and shares a link or code, the other joins, and moves go directly between the browsers (WebRTC data channel), with no game server of ours. The user dropped "no online play" from the principles on 2026-10-26; still no accounts of our own. Known risks, to weigh in the design: each player's IP address is visible to the other (WebRTC connects them directly; a TURN relay hides it but is a third party); nothing stops either player consulting an engine, so it suits friends, not strangers, and there is no matchmaking; a modified page can send any move, clock time or result, so each side checks the other's moves with `PlayCore` and treats the clock as a matter of trust; joining by link means the link is the only key to the game. Open: signalling (a WebRTC connection needs an offer/answer exchanged somehow: copy-paste codes or a QR code, which needs no server, or a public signalling or TURN service, which puts a third party in the path and in the CSP); NAT traversal without TURN fails on some networks; who keeps the clock and how a dropped connection, a reload or a dispute (takebacks, draw offers, claims) is settled when neither side is trusted; whether the game lands in both players' My games; offline it is "not available".

### App walk-through (*needs design*)

A short guided tour for a first visit: steps that point at the dock, the transport bar, Analyse, Play/Explore and Settings, each with a sentence and Next/Skip, on desktop and phone layouts. Open: shown once by itself (a flag in localStorage) or only from a menu item ("Take the tour"); whether it uses a demo game (e.g. `media/demo-game.pgn`) so there is something to point at; how it keeps up with the layout (steps keyed to elements, not coordinates); whether separate short tours cover the free board, Edit position and games.

## Known gaps

Deferred by the per-plan reviews; each was true when recorded and may since have been fixed.

**Responsive layout** (2026-10-26)
- The Analysis panel hides the search depth when narrower than 440·text px (at 1024×768, for one).
- `tests/live/android.test.cjs` wasn't run locally for this change (no device); GitHub Actions' `android` job covers it.

**Custom starts and flip** (2026-10-19)
- The player bars' "+N" counts captures during the game only, so a FEN start with a material edge shows none.
- Untested by the live suite: the sideways phone layout flipped, flipped arrows and line board, a flipped or FEN-start video export, and the F key's guards.

**Free board** (2026-10-19)
- A Stockfish reply played from the reply chips is labelled "Your move" after a reload: the stored board keeps UCI moves only, not who played them.
- Desktop board mode leaves empty space under the board where the eval graph was.
- After Enter plays an explorer row, focus drops to the page; the next Tab lands on the new list's first row.
- Playwright's Firefox drops mouse drags when `hasTouch` is on, so the phone parts of the free-board live tests tap or check layout only.

**Play vs human** (2026-10-19)
- A draw can only be claimed in the position on the board, not by announcing the move that would make the repetition or the fiftieth move.
- Dead positions are found only behind locked pawns (an en-passant capture on offer counts as a pawn break), with kings, pawns and bishops all on one colour of square (`PlayCore.lockedDead`: every pawn blocked, no capture possible, neither king nor any bishop able to reach an enemy pawn it could take; a king a bishop can reach always has a square of the other colour to step to, and the kings never meet). Knights, rooks, queens, bishops on both colours, a pawn break either king could make, or a position dead for other reasons (a forced line) play on; finding those needs a helpmate search (CHA-style).
- A flag fall in a dead position the check can't prove (see above) still loses: the flag rule looks at material only. Positions it proves dead have already ended the game.

**My games** (2026-10-20)
- A replayed game's Stockfish analysis, Queen answers and commentary stay with the loaded game: opening it from My games again starts without them.
- Leaving a game in progress still asks, though the game is kept.
- The same game open in two tabs is one entry; each tab's moves replace the other's.

**Play vs Stockfish** (2026-10-21)
- Playing Black, if the engine dies before Stockfish's first move there is nothing to take back: only Resign or a reload restarts it.
- A move played before the "before" search reaches depth 15 (just after the engine loads), and the move before a reload, go unrated.
- On the phone the Commentary box cuts the how-it-works text short (it scrolls).
- No draw offers against Stockfish; the player can resign while Stockfish thinks.

**Endgame tablebase** (2026-10-24)
- In the replay on the phone the Tablebase block sits below the engine lines, so the Analysis panel has to be scrolled to it (the free board shows it in the Commentary box).
- In the replay's Tablebase block a cursed win's moves are all listed as draws; which keep the cursed win shows only in a move's tooltip (on the free board too, where the moves are buttons alone).
- The live test asks the real service: a Lichess outage fails it.
- A game analysis that loses Lichess part-way leaves the rest of its endgame positions to Stockfish without saying so; only the Analysis panel's header ("Tablebase" or a depth) tells them apart.

**Full Stockfish download** (2026-10-24)
- The time estimate for Full starts from the lite engine's model until a run with Full has timed enough positions; the benchmarks behind the limits were not redone for Full.
- A cancelled or failed download starts over (no resume), and the whole 99 MB is held in memory while it is checked.
- The live suite downloads the 99 MB from unpkg in each browser on every run (a Playwright route can't answer with a body that big: Chromium drops the connection).

## Decisions log

- 2026-10-16: browser Stockfish approved: lite single-thread v19.0.1 (not lichess-org/stockfish-web), depth 22 / 3 s for games and 24 / 3 s for own moves (later Settings sliders), Hash 64 MB; Analyse is a button in the empty Analysis panel, shown only while paused; start paused; keep results both in the browser and as a download; site for sure, artifact best effort. Lichess opening names added.
- 2026-10-16/17, after trying it: Ask Queen stays in the dock; header shows the real search stats; board highlight colours; book name by the Commentary heading; own moves after the first fixed (live checks use real mouse input from then on).
- 2026-10-18: the Render site is the only target; Netlify dropped.
- 2026-10-19: free board approved, including the "my call" items; separate view from the replay; clock presets under 5 minutes dropped; Chess960 the only variant; Stockfish at full strength.
- 2026-10-19, after the free-board PR preview: Stockfish's eval and line before the first move; Replay these moves as a game.
- 2026-10-19, after the vs-human PR: New board renamed Play/Explore; Take back a button by Resign; Resign asks first; draw by agreement added.
- 2026-10-20: Maia3, typed commentary and player names added to the roadmap.
- 2026-10-21, after the vs-Stockfish PR: the Clock row is Time control; 5+0 became 5+3 (a game stored at 5+0 keeps its clock).
- 2026-10-23: Lichess data and threads planned: explorer sign-in by Lichess OAuth (PKCE) with a pasted token fallback; cloud eval and explorer default off; Threads default half the cores up to 4; COEP `require-corp`.
- 2026-10-23: vs human, threefold repetition and the fifty-move rule are claimed (fivefold and 75 moves automatic); a reload charges the running clock; a game resumed from My games runs its clock from then. Against Stockfish they stay automatic. A takeback giving back the time spent was tried and dropped: it felt like cheating.
- 2026-10-23: dead positions behind locked pawns end the game (both modes), proven by flood fills, not a search: a position it can't prove plays on. Bishops of one colour count too (after a game reached one with a dark bishop walled in behind its own pawns).
- 2026-10-23: specs merged into this file. Background music added: plays on the replay (also paused), free board and games; not in exports; bundled tracks plus the viewer's own file.
- 2026-10-24: full Stockfish download approved: Lite stays the default; Full is the single-thread `stockfish-19-single` (the threaded build needs PR 5's isolation, so it would not start today), served by unpkg (not Render, to keep its bandwidth) and checked by SHA-256 in the browser, kept in its own cache; site only.
- 2026-10-24, after the Lines PR preview: Your moves' time limit defaults to 5 s (was 3 s); engine lines wrap on the phone rather than being cut off.
- 2026-10-24: the Engine time limit sliders run 1–20 s (were 0.5–10 s in half seconds): whole seconds to 10, then every 2 s; a saved value snaps to the nearest stop, one under 1 s falls back to the default.
- 2026-10-24, after reviewing PRs 37 and 38: the full engine is checked by SHA-256 only at download, then trusted (re-hashing 99 MB on every page load cost a few hundred MB of memory, too much for a phone); the position before the viewer's move searches one line whatever Lines says, as its lines are never shown and it is what the move is rated against.
- 2026-10-24: the claude.ai artifact dropped, with what only it used: Claude-written commentary (the `sample` capability), saving through `downloads`, Queen through the Hugging Face connector, the inline engine.
- 2026-10-24: tablebase draws never end a game: a tablebase "draw" is a draw with best play (KR v KR is one), not a dead position; dead positions stay `PlayCore`'s, a helpmate search being the open idea (Dead positions).
- 2026-10-25: no depth limit by default: every search (game analysis, your moves, the Stockfish opponent and its "before" search) runs for its time limit alone, `go movetime` without `depth`. A capped depth ended endgame searches in no time, short of deep mates (KBN v K: depth 24 read +1.91 after 1 s, depth 30 +1.89 after 2.6 s, no limit reached depth 44 and a winning score in 5 s). The depth sliders keep 16–30 below a top stop, No limit (`AnalysisCore.DEPTHS`, depth `null`); Go deeper then doubles only the time; a run with no limit leaves the pace estimate alone (every position takes its time limit). Viewers who changed any setting keep their stored depth until they move the slider.
- 2026-10-25: Edit position designed and built: Play/Explore › Edit position… under Starting position replaces Paste FEN…; starts empty; the tray in the side panel on desktop, under the board on the phone; an illegal position says what's wrong and disables Done but never blocks editing.
- 2026-10-25: the Play dialogs always offer Start from; Set-up position with nothing set up opens the editor, whose Done starts the game right away with the dialog's choices (not back to the dialog: one click fewer).
- 2026-10-25, an experiment: a page under 1050 px wide or 650 px high never gets the 16:9 landscape frame, which left a small window mostly empty; it takes the largest of the others, the square frame where its board is within 10% of the sideways one's (`SQUARE_OVER_SHORT`, `app/engine.jsx`: a page near 1050 × 800 gets square, which fills its height), else the sideways frame.
- 2026-10-25: a page under 1300 px wide gets the compact landscape frame (`LAYOUTS.compact`, `COMPACT` in `app/game-video-core.jsx`): the wide frame's panels at their sizes with the square frame's 20 px margins, 14 px gaps and panel padding, 1800×1040 instead of 1920×1080, so it shows ~4% larger; its stage padding is slimmer too (`.stage-compact`). An export from it is 1800×1040.
- 2026-10-25: PR 2b (the tablebase in game analysis): a slow winning move loses nothing, as on Lichess; own-move verdicts stay on Stockfish for now; the DTZ mainline is fetched for every tablebase position (dropped the same day, below); after a Lichess failure a run stops asking and lets Stockfish search the rest.
- 2026-10-25: a game analysis asks the tablebase once a position, 4 s apart, its best line the best move alone (the DTZ mainline, a second request a position, was dropped), and a 429 pauses the asking for the minute's back-off rather than ending it: Lichess publishes no limit, and it answered 429 to about 10 requests in a minute, so a long endgame of two requests a position, 1 s apart, ended up mostly searched.
- 2026-10-25: a move between a searched position and a tablebase win or loss with no DTM is rated on Stockfish searches of both (the tablebase position searched too): its ±9990 read as mate in 1 had rated such moves, a defender's capture into a lost 7-piece ending among them, as blunders with "Checkmate is now unavoidable" or "Lost forced checkmate sequence". Turning the tablebase setting off stops a running analysis asking, without stopping the run.
- 2026-10-26: on the free board the tablebase takes the opening explorer's place at 7 pieces or fewer (the book has nothing to say there; Lichess does the same), leaving the Analysis panel to Stockfish; the replay keeps it in the Analysis panel, its Commentary box being the game's notes.
- 2026-10-26, after a repo audit: the page gets a Content-Security-Policy (a `<meta>` with the inline scripts' hashes) and nosniff and Referrer-Policy headers; Mediabunny is served from the site (an `import()` can't be pinned by hash); Sign in with Hugging Face is hidden on PR previews; a picked or dropped file over 50 MB is refused before it's read.
- 2026-10-26: nothing on the page selects outside text fields (Copy FEN's note shows the FEN in a read-only field), and one page-wide handler (`app/drag-scroll.js`) scrolls any box under a mouse drag, both ways and scaled to the frame, replacing the per-panel hook of the Moves list, explorer, tablebase and game info.
- 2026-10-26: chasolver, peer-to-peer online play and an app walk-through added to the roadmap.
- 2026-10-26: the engine settings move from Settings › Engine into the Analysis panel (its ☰ menu turns the panel into them; the explanations behind ⓘ), the engine itself a drop-down in the panel's title row, Go deeper and the depth reached to its left (so the drop-down never moves); the Engine tab becomes **Online** (the tablebase toggle now, online features later).
- 2026-10-26: "no online play" dropped from the principles (no accounts of our own stays), for peer-to-peer play between two browsers.
- 2026-10-26: responsive layout designed and approved: a normal responsive page (board + sidebar, one column when narrow) replaces the scaled fixed frames, text at fixed sizes with a Text size setting, exports record the screen-sized page, video touches only while playing.
- 2026-10-26: responsive layout built as designed, with these calls: `LayoutCore` computes the boxes in JS (not CSS grid), the board is a 768 px picture scaled into its box; the column rule is a window tall for its width (over 1.15) or a board under 360 px beside the sidebar, and a short window keeps two columns where a 200 px board fits; the side graph is 80 px; the paused one-column panels take fixed heights (times text) with inner scroll rather than their natural height; Commentary shows whole (no typewriter) when not a video; the sidebar reserves room for Moves and Commentary side by side (a 564 px board at 1024×768); exports record the screen-sized page at min(dpr, 1920/longer side).
- 2026-10-27: the Moves list wraps its moves in lines of chips like the Analysis panel's lines (light for White, dark for Black, the move number before White's), replacing the grid of move-pair rows; a flagged move's chip is edged in its class colour, a best move's isn't (most moves are best).
- 2026-10-27: menu buttons drop their trailing ellipsis (Load game, Edit position, Paste PGN, Play vs human, Play vs Stockfish, My games).
- 2026-10-27: in two columns the Moves box is rounded down to whole lines (Commentary takes the rest).
- 2026-10-27: a square-ish window's Moves takes 40% of the sidebar's room under the game info (30% elsewhere), from Commentary.
- 2026-10-27: in one column Moves is at most three lines tall (five in two columns).
- 2026-10-28: square-ish two columns hold up to 1.25 times as tall as wide (was 1.15), the eval graph under Analysis where it keeps 240·text px: the viewer prefers that layout to one column at sizes like 758×929 (it showed there only when the window grew into it). Reverses the 2026-10-27 call that 772×905 stacks for its larger board.
- 2026-10-28: square-ish from 0.77 times as tall as wide (was 0.8), and the one-column check counts what goes under a two-column board as that layout has it (Analysis when square-ish): a 760 px wide window shrinking from 770 to 642 px high had flipped to one column part of the way. The eval graph goes full width under the board from 670 px high where that doesn't shrink the board (it sat in the sidebar beside a board with empty room under it).
- 2026-10-27: no eval graph under 670 px high; a square-ish two-column window puts Analysis full width under the board in place of the eval graph; one column puts Commentary at the bottom, under Analysis.
- 2026-10-27: Moves stands over Commentary in every layout (in two columns no longer beside it; in one column first under the board, Commentary under it, then Analysis), at most five lines tall; the sidebar keeps its width.
