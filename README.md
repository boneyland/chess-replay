# Chess Replay

![The sample chess game playing: move rating, best line, commentary and eval graph](media/preview.webp)

A browser app for replaying and playing chess games, at https://chess-replay.onrender.com/. Everything runs in the browser, Stockfish included, and keeps working offline; only Ask Queen and the endgame tablebase go online.

## Features

- **Replay a game**: load a PGN (a `[FEN]` start position too; Chess960 not yet) and step through it on an animated board, with an evaluation graph, a rating for every move, the best line and the opening name
- **Analysis in the browser**: Stockfish 19 analyses games that come without evals; drag a piece to try your own move from any position. The 1.8 MB lite engine runs by default; the engine drop-down in the Analysis panel offers the full engine (99 MB, downloaded once and kept in the browser)
- **Opening explorer**: the book moves from each position (Lichess's opening tables)
- **Endgame tablebase**: with 7 pieces or fewer, the result with best play and every move ranked by it, from Lichess's tablebase; a game's analysis takes those positions from it too, rating each move by whether it keeps the win or the draw (needs a connection; Settings › Online turns it off)
- **Play/Explore**: a board from the starting position or a position set up by hand (or from a FEN) in Edit position, where Stockfish rates every move
- **Play vs human**: a game for two at one screen, from the starting position or a pasted one. The board turns to the side to move, moves can be taken back, and the game ends on mate, a draw by the rules or by agreement, or resignation, with optional clocks. Stockfish stays off until it ends
- **Play vs Stockfish**: a game against Stockfish at full strength, as White, Black or a random side, with Take back and optional clocks. Nothing hints at a move; Stockfish quietly flags inaccuracies, mistakes and blunders, and the better move shows once the game is over
- **My games**: every game is kept in the browser from its first move; the 50 most recent are listed, to resume one in progress or replay a finished one like a loaded game (analysis, PGN and video export included)
- **Ask Queen**: a commentary on the position from queen-pawn-8, a chess language model on a Hugging Face Space (needs a connection)
- **Export**: any game, or a stretch of it, as an MP4 video or an animated WebP
- **Layouts for every screen**: one responsive page, a board with a sidebar on a wide window and one column on a narrow one, with a Text size setting; full screen where the browser allows it, and Add to Home Screen opens it as an app
- **Move sounds**: a synthesized Wood set and four of Lichess's sets
- **Offline**: a service worker keeps the page, the engine and everything they load

https://github.com/user-attachments/assets/d15445d0-b356-4954-b791-e700a717ab14

## Lichess data

With Settings › Online › Endgame tablebase on (the default), the position on the board, as a FEN and nothing else (no account, no game), goes to Lichess's tablebase at `https://tablebase.lichess.ovh/standard` whenever it has 7 pieces or fewer: while a replay is paused, and on the free board, never during a game. "Analyse with Stockfish" sends the game's positions of 7 pieces or fewer one by one as the run reaches them, to `/standard`, 4 s apart. With Settings › Online › Lichess cloud evaluation on (off by default), the positions Stockfish searches for your own moves (the free board, moves you try in the replay) go to `https://lichess.org/api/cloud-eval` as FENs, one at a time, 300 ms after the board last changed; never a game's analysis or a game against Stockfish. Answers are kept in memory for the page's lifetime only.

## Build

Needs Node 22 or later; nothing to install (Babel and Stockfish are in the repo) and no network.

1. `git clone https://github.com/boneyland/chess-replay && cd chess-replay`
2. `node build.cjs`, which writes `out/site/` (Render builds it from this repo, `render.yaml`, and serves it at https://chess-replay.onrender.com/): `chess-game-video.html`, plus the Stockfish and WebP encoder files (`.js` and `.wasm`, loaded from next to the page), the service worker `sw.js`, a web app manifest with its icons (from `app/icons/`), so Add to Home Screen opens it without the browser's bars, and the link-preview image `og-image.png`
3. Serve `out/site/` over HTTP, e.g. `python3 -m http.server 8765 --directory out/site`, and open http://localhost:8765/chess-game-video.html (don't open the file directly: browsers won't load the engine from a `file://` page)

Hosting `out/site/` anywhere static works the same. Ask Queen's Hugging Face sign-in only returns to URLs registered with an OAuth app, so on your own host it calls Queen without signing in, unless you register an app and put its client ID in `HF_OAUTH` (`app/queen.jsx`); a static Hugging Face Space with `hf_oauth: true` in its README supplies its own.

## Tests

- `node --test --test-concurrency=1 tests/*.test.cjs`: the JS tests (GitHub Actions runs them on every push, and the Render build before building)
- `../chess-animator/.venv/bin/python -m unittest tests/check_browser_json.py` (from the repo root, after the JS tests): checks the browser's analysis against the Python pipeline. It imports chess-animator, which must be checked out next to this repo; `make_rating_expected.py` and `make_openings_expected.py` regenerate the fixtures from the Python code. Building doesn't need chess-animator
- `node --test tests/live/site.test.cjs`: smoke tests of the live site (or `LIVE_URLS=local`, a local build) in Chromium and Firefox with Playwright; GitHub Actions runs them on each push against that commit's build, in WebKit too (iPhone Safari's engine); `node --test tests/live/android.test.cjs`: a few phone checks in Chrome on an Android device over adb, which GitHub Actions runs on an emulator

## Layout

What each file and folder is, the vendored files' sources and their SHA-256 checksums: see [LAYOUT.md](LAYOUT.md).

## Credits

Built into the page or served with it:
- [Stockfish](https://stockfishchess.org/) 19, as [stockfish.js](https://github.com/nmrugg/stockfish.js) by Nathan Rugg (GPL-3.0)
- Colin M.L. Burnett's chess pieces, the `cburnett` set as on Lichess (GPL-2.0-or-later)
- Lichess's [chess-openings](https://github.com/lichess-org/chess-openings) tables (CC0)
- The futuristic, nes, piano and sfx move sounds by [Enigmahack](https://github.com/Enigmahack), from [Lichess's source](https://github.com/lichess-org/lila) (AGPL-3.0-or-later)
- [libwebp](https://chromium.googlesource.com/webm/libwebp) (BSD-3-Clause), built to WebAssembly by [Squoosh](https://github.com/GoogleChromeLabs/squoosh) and packaged by [jSquash](https://github.com/jamsinclair/jSquash) (Apache-2.0), for the WebP export
- [Mediabunny](https://github.com/Vanilagy/mediabunny) 1.61.0 by Vanilagy (MPL-2.0), for the MP4 export

Loaded from CDNs when the page runs:
- [React](https://react.dev/) 18.3.1 (MIT)
- [html2canvas-pro](https://github.com/yorickshan/html2canvas-pro) 2.5.0 by yorickshan (MIT), which draws each frame of an export
- IBM Plex Sans, Instrument Serif, JetBrains Mono and Noto Sans Symbols 2, from Google Fonts (SIL Open Font License)

Used to build it: [@babel/standalone](https://babeljs.io/docs/babel-standalone) 7.29.0 (MIT), which compiles the JSX.

## Licence

GPL-3.0-or-later (`LICENSE`), the same as the bundled Stockfish. The Lichess sound files keep their own licence, the AGPL-3.0-or-later, which GPL-3.0 section 13 allows them to be combined with. The WebP encoder keeps libwebp's BSD-3-Clause and the Squoosh glue's Apache-2.0 licences, both compatible with the GPL-3.0.
