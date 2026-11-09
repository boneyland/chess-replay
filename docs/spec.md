# Chess Replay: spec

The one spec for the app: what it does now, what is planned, and the decisions behind both. This page holds its principles and contents; what is built is in `docs/spec/`, one file per area, beside the roadmap, the known gaps and the decisions log in `docs/`. Merged on 2026-10-23 from three specs (browser Stockfish, 2026-10-16; free board, 2026-10-19; Lichess data and threads, 2026-10-23), which are in git history under `docs/`; split into these files on 2026-11-08, when it had grown to 180 KB.

**Scope.** The Render site (https://chess-replay.onrender.com/) is the only target.

## Contents

- [Principles](#principles), below
- What is built:
  - [Replay](spec/replay.md): replay and browser analysis, opening names, custom starts and flip, piece sets, boards, drawing on the board
  - [Import](spec/import.md): import game, Lichess game import
  - [Position from image](spec/position-from-image.md)
  - [Free board and games](spec/free-board.md): free board and explorer, Edit position, Play vs human, My games, Play vs computer, dead positions with chasolver
  - [Engine](spec/engine.md): Full Stockfish download, lines (MultiPV), engine lines in analysis files, multi-threaded Stockfish, asm.js Stockfish (no WebAssembly SIMD)
  - [Lichess data](spec/lichess.md): endgame tablebase, Lichess cloud evaluation, Lichess opening explorer
  - [Share and export](spec/export.md): the dialog, video and WebP export
  - [Responsive layout](spec/layout.md)
- [Roadmap](roadmap.md): square layouts and breakpoints; player names; Chess960; typed commentary; Maia3; background music; peer-to-peer online play; app walk-through
- [Known gaps](known-gaps.md)
- [Decisions log](decisions.md)

Implementation plans of built features, kept as written, are in [plans/](plans/); dated audit reports in [audits/](audits/).

## Principles

These hold across every feature; a change that breaks one is a failure even if it works.

- **Nothing leaves the browser** unless the viewer turns it on (Ask Queen, and the planned Lichess features, each behind a toggle or button). No accounts of our own (online play, when built, is between two browsers with no account or game server of ours).
- **The playing video stays clean.** Buttons, progress lines and engine controls are for the paused page; a playing video looks like the page, without the paused page's controls (buttons, progress lines, engine controls); the title and end cards, the panels' fade-in, the blunder glow, the camera push and the typewriter commentary show only then, while stepping and paused viewing are a plain, still page.
- **Nothing heavy starts by itself.** The engine (1.8 MB) loads on first use; the full engine (99 MB) downloads only when the viewer asks; whole-game analysis runs only when asked.
- **No hints in a game, but the ones asked for.** During Play vs human or Play vs computer no eval bar, arrows, verdicts, book moves or engine lines show; against the computer the player may ask for 3 hints a game (Stockfish's best move).
- **Replay doesn't regress.** A loaded game's title card, timeline, export and own-move exploration are untouched by free-board and game features (which is why the free board is a separate view).
- **Bad input explains itself.** An illegal FEN or broken PGN gets a plain message, never a crash.
- **Numbers mean what the Python pipeline's mean.** The browser's analysis JSON uses chess-animator's sign convention, mate encoding, rating and accuracy formulas.
- **An app, not a document.** No text selects but what's typed in a field, and a mouse drag scrolls whatever scrolls (a list, a panel, a menu, a one-line strip), gliding on when let go, as a finger does.
- **Offline works.** The service worker keeps the page and all it loads; online-only features degrade quietly to "not available".
