# Part names

The names to use when talking about the page's parts. Each part's outer element has the class `part-<name>`, so the
browser's inspector shows it (Firefox's element picker shows it in its hover tooltip, e.g. `div.part-game-info`). Parts
with a title on the page take that title; the others got a name here. The code name is what the source calls it, where
that differs (`L.*` boxes in `app/layout-core.js`, components in `app/*.jsx`).

A new main part gets a class here too: `part` on a `Panel`, `part` on a `DialogBox` (which adds `-dialog`), or the
class by hand on anything else.

## Board area

| Class | Name | What and where | Code name |
| --- | --- | --- | --- |
| `part-board` | Board | The board and its pieces, arrows and highlights, in every view | `BoardSpace`, `L.board` |
| `part-eval-bar` | Eval bar | The tall white/black bar left of the board (replay and free board) | `EvalBarView`, `L.eval` |
| `part-player-bar top` / `bottom` | Player bar | The strips above and below the board: side mark, name, rating, captures, clock. `bottom` is the side the board is drawn from | `SideBar` (`PlayerBar`, `FreeBar`), `L.bars` |
| `part-piece-tray` | Piece tray | Edit position's twelve pieces to place | `Tray` (`app/edit-board.jsx`), `L.tray` |

## Panels

| Class | Name | What and where | Code name |
| --- | --- | --- | --- |
| `part-game-info` | Game info | Event, round, teams, place, date and opening, in up to three lines: under White's player bar in one column, top of the sidebar in two | `Header`, `L.header` |
| `part-moves` | Moves | The move list | `MoveList`, `L.moves` |
| `part-commentary` | Commentary | The notes and the book name (replay) | `Commentary`, `L.comment` |
| `part-opening-explorer` | Opening explorer | Book moves, or Lichess's explorer when it's on (free board, in Commentary's place) | `OpeningExplorer`, `LichessExplorer` |
| `part-tablebase` | Endgame tablebase | Tablebase answers (in Commentary's place) | `app/tablebase.jsx` |
| `part-game-details` | Game details | The panel titled Play vs human / Play vs computer during a game: where it started, the clock, the critique | `GameInfo` (`app/free-board.jsx`) |
| `part-analysis` | Analysis | Stockfish's lines, depth and engine options button | `AnalysisPanel`, `L.analysis` |
| `part-engine-menu` | Engine menu | Analysis's engine options, opened from its ☰ button, inside Analysis | `.an-engine` |
| `part-game` | Game | The panel titled Game during a game: whose move or the result, and Take back, Offer a draw, Resign (in Analysis's place) | `GameStatus` |
| `part-eval-graph` | Eval graph | The evaluation over the game (replay, where there's room) | `EvalPlot`, `L.plot` |
| `part-edit-position` | Edit position | Edit position's panel: side to move, castling, FEN, Done | `EditBoard`, `L.panel` |

## Controls

| Class | Name | What and where | Code name |
| --- | --- | --- | --- |
| `part-transport-bar` | Transport bar | Back to start, step, play/pause, the seek bar and times, the move label | `PlaybackBar`, `.pbar` |
| `part-dock` | Dock | The app's buttons: Import game, Play/Explore, Share and export, Settings, Full screen (in the folded menu on a phone) | `.dock-items` |
| `part-play-explore-menu` | Play/Explore menu | The pop-up of the dock's Play/Explore button (desktop; on a phone its items are in the menu) | `.dock-pop` |
| `part-menu` | Menu | The phone's ☰ button and the folded menu it opens | `.pmenu` |
| `part-settings` | Settings | The Settings panel and its tabs | `TweaksPanel` |
| `part-ask-queen` | Ask Queen | Queen's panel | `app/queen.jsx` |

## Dialogs

Each is `part-<name>-dialog`, on the dialog box itself.

| Class | Dialog |
| --- | --- |
| `part-import-game-dialog` | Import game |
| `part-position-from-image-dialog` | Position from image |
| `part-play-dialog` | Play vs human / Play vs computer |
| `part-leave-game-dialog` | Leave this game? |
| `part-my-games-dialog` | My games |
| `part-shortcuts-dialog` | Keyboard shortcuts |
| `part-share-dialog` | Share and export |
| `part-reset-settings-dialog` | Reset all settings |
| `part-game-analysis-dialog` | Analyse the game |
| `part-exporting-dialog` | Exporting (the export's progress) |
| `part-export-failed-dialog` | Export failed |
