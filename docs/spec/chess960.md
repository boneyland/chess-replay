# Chess960

[Spec](../spec.md) › what is built. Chess960 (Fischer random): reading 960 positions and games, starting one, castling on the board, and what the engine and the Lichess features do with it. Built 2026-11-13 (branch `claude/chess960`); the design is `docs/plans/2026-11-13-chess960-design.md`. It is the only variant the page supports (decisions log, 2026-10-19).

## What a 960 position is

No mode switch. A position is 960 when a castling right it holds isn't a king on e1/e8 with its rook on a/h (`pos.rooks` is set then: the rook square of each right, `ChessCore.is960`/`fenIs960`). A board or game also carries a **label**, `chess960` (the Scharnagl number 0–959, or `true` when it came from a 960 PGN without one), which is separate: it drives only the PGN tag and the "Chess960 #n" text, never the rules. A 960 start stays 960 for all its moves, so the buttons and the engine's mode don't flicker as rights are lost.

**Position 518 plays as standard chess** (the user's decision): typed by hand, or the start of a Lichess 960 game, it has standard rights, so the king castles by a two-square drag, no buttons, Stockfish without `UCI_Chess960`, the explorer and opening names on. Only its PGN tag and Game info say Chess960.

## Reading positions and games

- `ChessCore.readFen` reads X-FEN and Shredder-FEN rights (`HAha`, `KQkq` meaning the outermost rook, a file letter for an inner one) wherever a FEN comes in (Import game's paste box, Edit position, Start from). A right the pieces don't support is dropped, as before. `fullFen`/`setupFen` write X-FEN back (`KQkq` when the right's rook is the outermost, the file letter when an inner one is meant); a standard position's FEN is unchanged, so every cache key of a standard position is too, and a 960 position's key differs by its rook files.
- A PGN with `[Variant "Chess960"]` (Lichess's export: `[FEN]` with `KQkq` for the outermost rooks) imports and replays with analysis like a standard game, a Lichess link included; Lichess's round and study lists treat it as loadable. Other variants are still refused ("only standard chess and Chess960 open here", [Import](import.md)).
- Castles are `O-O` (h-side) and `O-O-O` (a-side) in the moves list, in both directions. In a 960 position a castle's UCI is king-takes-rook (`ChessCore.castleRookStep` gives the king's and rook's squares); the video and piece tracks move both pieces from wherever they stand, a king that stays put included.
- A FEN pasted in Import game that is exactly a numbered 960 start (its placement, all four rights, 960 rooks: `EditCore.number960`) opens with that number, so Game info says "Chess960 #n"; 518 and the other king-e, rooks-a/h starts get none.
- Chess960 numbers: `chess960Fen(n)`, `chess960Number(fen)` and `chess960Random()` (uniform over the 959 positions other than 518). 518 is RNBQKBNR, 0 is BBQNNRKR.

## Starting a 960 position

- **Play vs human, Play vs computer**: Start from gets **Chess960**, showing a **Random** checkbox (ticked) and a **Position number** field (0–959, disabled while Random is ticked; a bad entry says "Enter a number from 0 to 959." and disables Start). Random is drawn on Start, not when the dialog opens. The choice is remembered like the clock (`play960Random`, `play960No`).
- **Explore**: Menu › Explore › **Chess960 position** (part `part-chess960-dialog`) asks the same and opens a free board on it, both sides played by the viewer.
- **Edit position**: no 960 switch. A castling box is enabled while its king stands on its first rank with a rook of its colour on that side (the right means the outermost such rook); a right from a pasted inner-rook FEN is kept while the box isn't touched. A right stays only while its king and its rook stand where they did: moving either (or removing the rook) unticks it, so moving pieces never turns a standard setup into a 960 one; only ticking a box picks the outermost rook (`EditCore.settle`).
- Where the number shows: Game info (the free board and the replay: "Chess960 #722", a line before the opening), My games rows and a game's details panel ("From Chess960 #n"; a game has no Game info). Save PGN, My games and `PlayCore.pgn` write `[Variant "Chess960"]`, `[SetUp "1"]` and the `[FEN]` whenever the start has 960 castling rights, with or without a number (and for 518 when it has the label).

## Castling on the board

Standard positions keep today's drag (two squares) and have no buttons. In a 960 position (free board, a game, the replay's own lines):

- **Castle a-side / Castle h-side** buttons (part `part-castle-buttons`), each while that castle is legal and it is the viewer's move (never Stockfish's turn).
- A king dropped (or tap-tap moved) **on its own castling rook** castles at once, as on Lichess, a king already on its castling square included; so does one dropped on c/g **two or more squares away**.
- Dropped on c/g **one square away**, the board asks (**Castle a-side/h-side** or **Move the king to g1**, the second only when that king step is legal; a press elsewhere cancels and the piece goes back). A single drag never castles by accident.
- Where a king move is the only legal reading, it moves as usual. The buttons and the question never show in exports.

## Engine and Lichess features

- **Stockfish** (lite, Full, asm.js): `setoption name UCI_Chess960 value true|false` is sent before a search only when it changes (`SFEngine`, tracked like Hash and MultiPV). Stockfish's castles are king-takes-rook in 960 mode; the page converts at the engine boundary and a castle's best-move arrow points king to destination.
- **Lichess cloud evaluation**: used for 960 positions, with `variant=chess960` (checked 2026-11-13); its castles stay king-takes-rook rather than converted to e1g1.
- **Tablebase** stays (it never has castling rights). **Dead positions**: chasolver gets the position with castling rights removed (`DeadCore.fenFor`).
- **Off in 960 positions**: the Lichess opening explorer, the opening book and names, and Ask Queen (its Space reads standard chess only). A 960 free board keeps its Commentary slot, which shows "The opening book is for standard chess." in place of the explorer. The book is built for the start on show, so a standard board opened after a 960 game has it again.
- Repetition, the fifty-move rule, results, clocks, takebacks, hints, critique and My games work as for standard games.

## Not built

Other variants; a 960 opening explorer or names; different setups for White and Black (Chess960 double); the Python renderer knowing 960 (`tests/check_browser_json.py` checks standard games only); Position from image setting 960 rights.

## Tests

Node: `tests/chess-core.test.cjs` (numbering, FEN both formats, castling legality and refusals, SAN, `castleTarget`), `import-core`, `lichess-core`, `sf-engine`, `dead-core`, `board-core`, `play-core`, `games-core`, `edit-core`, `analysis-core`; the fixture `tests/fixtures/lichess-960.pgn` (Chess960 #722). Live (`tests/live/site.test.cjs`, real mouse): castling by buttons, the question and at once; starting from Chess960 in both dialogs on desktop and phone; no explorer on a 960 board.
