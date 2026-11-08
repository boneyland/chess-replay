# Roadmap

[Spec](spec.md) › planned features.

Planned, roughly in this order; each item gets its own PR(s) on a `claude/<topic>` branch. Items marked *needs design* have open questions to settle with the user before a plan.

## Engine lines in analysis files, and Go deeper's lines (*needs design*)

Asked for 2026-11-08: the other lines of each search (MultiPV) kept in the analysis file, the same format read and written by this page and by chess-animator, so each uses the other's files; shown in the Analysis panel and written in the annotated PGN; and Go deeper searching as many lines as the lines setting asks.

- **The format is chess-animator's** (`chess_game_analyzer.py`, its commit 89c41d3 of 2026-11-04). Each move gets `engine_lines`: every line Stockfish returned from the position *before* the move, best first, unfiltered, each `{ move, eval, depth, line }`: `move` the line's first move in SAN, `eval` in centipawns from White's side (a mate as ±(10000 − 10·N), as `eval_before`/`eval_after`), `depth` the depth that line reached, `line` its SAN moves from `move` on, up to 12 plies (`BEST_LINE_MAX_PLIES`). Beside it, as now: `search_lines` (how many lines that search returned), `alternative_moves` (`[[SAN, cp]]`: the lines after the first whose move isn't the one played, within 50 cp of the best (`PLAYABLE_THRESHOLD`), for its report), `best_line` (line 1, the same moves), and the engine block's `lines` (the MultiPV asked for: 3 by default for its report, 1 for its video). The position after the last move has `pv_line` alone (line 1, no other lines).
- **Each reads the other's files**: chess-animator's `AnalysisData.from_json_file` (`MoveData.from_dict`) ignores fields it doesn't know, so the browser's files load there today (`tests/check_browser_json.py`; it doesn't use `engine_lines` yet), and `ChessCore.buildGame` reads chess-animator's (`tests/fixtures/byrne-fischer_analysis.json`). New here: `buildGame` reads `engine_lines` (a file without them reads as now, line 1 from `best_line`), and the browser's analysis (`AnalysisCore`, `MOVE_DEFAULTS`) writes `engine_lines`, `search_lines` and `alternative_moves` as `chess_game_analyzer.py` does (the same shape, eval convention, 12-ply cap and 50 cp threshold), so a browser file is a chess-animator file with its lines. Tests: a fixture from `chess_game_analyzer.py` with `--lines 3` (a short game) read by `buildGame` (lines, evals, depths); `check_browser_json.py` loads a browser file with several lines in `AnalysisData` and checks `engine_lines` matches the analyzer's shape field for field. Showing the lines in chess-animator's video or report is that repo's work.
- **In the Analysis panel**, on a loaded analysis's move: the lines of the position after it, which are the next move's `engine_lines` (as the Best line is the next move's `best_line`), listed as Lines (MultiPV) lists an own move's (eval, a dim depth when shallower than line 1, first moves; a move plays the line on the board) with line 1 as the Best line, and an arrow each (Best-move arrows). After the last move only the Best line, as now.
- **In the annotated PGN**: where the engine's line is written (a move the analysis didn't rate best, Go deeper's in place of the analysis's), the other lines follow it as further variations, by rank, each from the position before the move (that move's `engine_lines`), leaving out a line starting with the move played (the game is that line). *Open*: lines 2 and up on a move rated best too (line 1 is the move played, the others real alternatives), or not, to keep the PGN short; and whether each variation carries its eval (`{[%eval …]}` after its first move).
- **Go deeper follows the lines setting**: Go deeper on a stored move searches as many lines as Analysis › ☰ › Your moves: lines (`sfLines`), which is renamed to say it covers Go deeper (*open*: the label, e.g. **Lines**); its result's `lines` replace the analysis's for that position, in the panel and (through `withDeeper`) in the annotated PGN, line 1 as its Best line already does. `useMoveEval`'s keys already part a search of several lines from one of one. Settings' note that each line gets a share of the search, so goes less deep in the same time, covers it.
- *Open*: **the browser's own game analysis**: one line, as now (its file then has one engine line a move), or as many as the lines setting, as chess-animator's report searches 3: at a set depth 3 lines took about 4.5 times as long as 1 there, and MultiPV weakens Stockfish's multi-threaded search badly (`ANALYSIS_LINES`, `VIDEO_LINES` notes in `chess_game_analyzer.py`).
- *Open*: **a PGN's variations as lines**: they reach the annotated PGN as written today, but the panel shows only the first (as the better line, and only without an analysis); list the others there too (no evals), or leave them to the export.

## Square layouts and breakpoints (*needs design*)

The responsive layout's squarish windows (near 1:1, such as an unfolded foldable or a tablet-sized window around 772×965) get either a sidebar that holds the board small or one column that scrolls; neither is designed for that shape. Open: a layout of its own for square screens (the board with the panels in a band under or beside it, sized for both); whether the device tiers' breakpoints (phone under 600 px wide or 500 px high, tablet and foldable 600–1023, desktop from 1024) and the stacking rules hold up on real devices (iPhone Duo's viewports per WebKit: 382–951 wide, 368–902 high); whether a half-folded screen (`device-posture: folded`, viewport segments, in preview in Safari 27.1) puts the board and the panels on separate halves. Asked for 2026-10-27.

## Player names (*needs design*)

In Play vs human set White's and Black's names; in Play vs Stockfish the player's (Stockfish is "Stockfish 19"). Open: asked in the Play dialog or set later; whether the last names are remembered; where they show (player bars, My games rows, the PGN's `White`/`Black`, where `PlayCore.pgn` writes "White"/"Black" today).

## Chess960

From a FEN with X-FEN or Shredder-FEN castling, using Stockfish's `UCI_Chess960`; today `buildGame` rejects it ("Chess960 positions aren't supported yet"). The only variant: three-check, King of the Hill, crazyhouse, atomic, horde, antichess and racing kings are out of scope (another rules engine and a variant Stockfish). Must also read Lichess 960 exports (`[Variant "Chess960"]`, `KQkq` with the king off e1) and reordered rights (`kqKQ`), which today get "Castling rights don't match the pieces".

## Typed commentary (*needs design*)

The user types their own comment on a move. Open: where (replay, free board, a game from My games, all); how it sits with PGN comments, the notes file and Queen in the Commentary box (each now a Settings toggle) and in the video; whether Save PGN writes it as `{ }`; where it is kept (with the loaded game, with a My games entry, which ties in with replayed games losing their analysis and commentary today).

## Maia3 (*needs design*)

Maia predicts human moves at a chosen rating, unlike Stockfish's best move. Open: what for (an opponent in Play vs Maia, "what a human would play" beside Stockfish, or both); whether it runs in the browser (weights, runtime, size, licence) or would need a server (which the principles rule out without the user's say); which ratings.

## Background music

Music that plays under the page, chosen from a few bundled tracks or the viewer's own file. Added 2026-10-23.

Decided by the user:

- **Plays on the replay page, playing or paused, and on the free board and in games** (Play vs human, Play vs Stockfish).
- **Not in exported videos**: MP4 and WebM exports keep the move sounds only.
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

## Peer-to-peer online play (*needs design*)

Play vs human between two devices: one player makes a game and shares a link or code, the other joins, and moves go directly between the browsers (WebRTC data channel), with no game server of ours. The user dropped "no online play" from the principles on 2026-10-26; still no accounts of our own. Known risks, to weigh in the design: each player's IP address is visible to the other (WebRTC connects them directly; a TURN relay hides it but is a third party); nothing stops either player consulting an engine, so it suits friends, not strangers, and there is no matchmaking; a modified page can send any move, clock time or result, so each side checks the other's moves with `PlayCore` and treats the clock as a matter of trust; joining by link means the link is the only key to the game. Open: signalling (a WebRTC connection needs an offer/answer exchanged somehow: copy-paste codes or a QR code, which needs no server, or a public signalling or TURN service, which puts a third party in the path and in the CSP); NAT traversal without TURN fails on some networks; who keeps the clock and how a dropped connection, a reload or a dispute (takebacks, draw offers, claims) is settled when neither side is trusted; whether the game lands in both players' My games; offline it is "not available".

## App walk-through (*needs design*)

A short guided tour for a first visit: steps that point at the dock, the transport bar, Analyse, Play/Explore and Settings, each with a sentence and Next/Skip, on desktop and phone layouts. Open: shown once by itself (a flag in localStorage) or only from a menu item ("Take the tour"); whether it uses a demo game (e.g. `media/demo-game.pgn`) so there is something to point at; how it keeps up with the layout (steps keyed to elements, not coordinates); whether separate short tours cover the free board, Edit position and games.
