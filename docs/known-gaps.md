# Known gaps

[Spec](spec.md) › what is built but falls short.


Deferred by the per-plan reviews; each was true when recorded and may since have been fixed.

**Drawing on the board** (2026-11-04): Firefox always opens its own context menu on Shift+right-click (the page gets no `contextmenu` event to cancel), so a red shape drawn with Shift there comes with the menu, as on Lichess; Ctrl draws red without it. Not tried with a Mac's Ctrl+click (a right click there).

**iOS Safari** (2026-11-02, the `ios` job: Safari 26.5 on an iPhone 17 Simulator)
- **Verify** on a real iPhone that tap-tap and drag moves work: in the Simulator, WebDriver's touch taps reach the board's handler and select e2 in its state, but the page never draws the selection and the second tap plays nothing; pointer events dispatched by the page's own script play the move. The job fails on this until it's settled.
- The service worker is slow to take over in the Simulator (often still installing after 60 s, its cache not yet opened); Playwright's WebKit runs the same worker, so this isn't asserted there.

**Free board** (2026-10-19)
- Playwright's Firefox drops mouse drags when `hasTouch` is on, so the phone parts of the free-board live tests tap or check layout only.

**Play vs human** (2026-10-19)
- A draw can only be claimed in the position on the board, not by announcing the move that would make the repetition or the fiftieth move.
- Dead positions need chasolver's worker: before its module loads (the first move of a game), offline before it was ever kept, or for a position it gives up on (5 s), only `PlayCore.canMate` and `lockedDead` end a game, and a flag fall against mating material is a loss (the flag rule asks the prover's cache about every position of the game so far, as a side unable to mate stays so: a proof from an earlier move draws though the position now has no answer).

**My games** (2026-10-20)
- A replayed game's Stockfish analysis, Queen answers and commentary stay with the loaded game: opening it from My games again starts without them.
- Leaving a game in progress still asks, though the game is kept.
- The same game open in two tabs is one entry; each tab's moves replace the other's.

**Play vs computer** (2026-10-21)
- A move played before the "before" search reaches depth 15 (just after the engine loads; depth 8 for a blunder of a piece or more), and the move before a reload, go unrated. On a slow engine (the asm.js one, a slow phone) the reply search often stops short of depth 15 in its 3 s, so smaller inaccuracies, mistakes and blunders go unflagged, silently.
- On the phone the Commentary box cuts the how-it-works text short (it scrolls).
- No draw offers against Stockfish; the player can resign while Stockfish thinks.

**Endgame tablebase** (2026-10-24)
- In the replay's Tablebase block a cursed win's moves are all listed as draws; which keep the cursed win shows only in a move's tooltip (on the free board too, where the moves are buttons alone).

**asm.js Stockfish** (2026-10-31)
- **Verify** on the SM-T510 itself: checked only with SIMD faked off in desktop Chromium and Firefox. How slow it is on the tablet, and whether its 120 s start timeout (since 2026-11-01) is always enough there, is unknown.

**Position from image** (2026-11-03)
- `tests/fixtures/vision-diagram.png` (a book-style diagram drawn here) reads its c4 bishop as a pawn in both browsers, framed or cropped, though the 2026-11-03 tests found real diagrams exact once cropped; and its read rarely marks a square to check (only cropped, in Chromium at 1440×900). The live test asserts no read of it, and doesn't cover the outlines: an edit dropping one was checked by hand in Chromium, a typed FEN dropping one (the same rule, `sureOf` in `GameApp`) not in a browser.
- Reading speed on a phone is unmeasured.
- Board auto-crop: the tilted-board test picture's noise layer doesn't show in its screenshot (the tilt alone keeps it from being an upright grid); the picture with no board has noise.

**Full Stockfish download** (2026-10-24)
- The benchmarks behind the limits were not redone for Full, and the starting pace factors (asm.js 8, Full 1.3: `AnalysisCore.paceStart`) come from one laptop in Chromium, three positions to depth 16 (2026-11-09).
- The tablebase live tests answer from `tests/fixtures/tb-live.json`: a change in Lichess's answers isn't noticed until `tests/fixtures/fetch-tb-live.cjs` is run again.
- A cancelled or failed download starts over (no resume), and the whole 99 MB is held in memory while it is checked.
- The live suite downloads the 99 MB from unpkg in each browser on every run (a Playwright route can't answer with a body that big: Chromium drops the connection).

**Chess960** (2026-11-13)
- A sloppy standard FEN with stale rights (e.g. `R3K1R1 w KQkq`, the h-rook moved to g1) now reads as a 960 position, allowing a castle standard chess wouldn't.
- In the replay the Castle buttons appear only under the viewer's own line, not at a paused game move (a drag or tap still castles there).
- The castle-or-move question's buttons are small on a phone (about 28 px tall: sized in board pixels like the promotion picker).
- The 17 starts with the king on e and the rooks on a and h (414, 430, 446, 454, 460, 461, 502, 508, 509, 524, 525, 532, 533, 548, 549, 692, 693) play as standard chess, like 518: no Castle buttons, the opening explorer on, Stockfish without `UCI_Chess960` (castling ends the same either way). A FEN pasted for one of them gets no "Chess960 #n" label.
- Game info can need four lines for a "Chess960 #518" game with an opening name, and then clips.
