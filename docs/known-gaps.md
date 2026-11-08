# Known gaps

[Spec](spec.md) › what is built but falls short.


Deferred by the per-plan reviews; each was true when recorded and may since have been fixed.

**Drawing on the board** (2026-11-04): Firefox always opens its own context menu on Shift+right-click (the page gets no `contextmenu` event to cancel), so a red shape drawn with Shift there comes with the menu, as on Lichess; Ctrl draws red without it. Not tried with a Mac's Ctrl+click (a right click there).

**iOS Safari** (2026-11-02, the `ios` job: Safari 26.5 on an iPhone 17 Simulator)
- **Verify** on a real iPhone that tap-tap and drag moves work: in the Simulator, WebDriver's touch taps reach the board's handler and select e2 in its state, but the page never draws the selection and the second tap plays nothing; pointer events dispatched by the page's own script play the move. The job fails on this until it's settled.
- Safari 26.5 has element full screen on iPhone, and the Full screen item works there; the comment in `app/game-app.jsx` saying iPhone Safari has none is out of date.
- The service worker is slow to take over in the Simulator (often still installing after 60 s, its cache not yet opened); Playwright's WebKit runs the same worker, so this isn't asserted there.

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
- Dead positions need chasolver's worker: before its module loads (the first move of a game), offline before it was ever kept, or for a position it gives up on (5 s), only `PlayCore.canMate` and `lockedDead` end a game, and a flag fall against mating material is a loss.
- A flag fall in a dead position the check can't prove (see above) still loses: the flag rule looks at material only. Positions it proves dead have already ended the game.

**My games** (2026-10-20)
- A replayed game's Stockfish analysis, Queen answers and commentary stay with the loaded game: opening it from My games again starts without them.
- Leaving a game in progress still asks, though the game is kept.
- The same game open in two tabs is one entry; each tab's moves replace the other's.

**Play vs Stockfish** (2026-10-21)
- Playing Black, if the engine dies before Stockfish's first move there is nothing to take back: only Resign or a reload restarts it.
- A move played before the "before" search reaches depth 15 (just after the engine loads; depth 8 for a blunder of a piece or more), and the move before a reload, go unrated. On a slow engine (the asm.js one, a slow phone) the reply search often stops short of depth 15 in its 3 s, so smaller inaccuracies, mistakes and blunders go unflagged, silently.
- On the phone the Commentary box cuts the how-it-works text short (it scrolls).
- No draw offers against Stockfish; the player can resign while Stockfish thinks.

**Endgame tablebase** (2026-10-24)
- In the replay on the phone the Tablebase block sits below the engine lines, so the Analysis panel has to be scrolled to it (the free board shows it in the Commentary box).
- In the replay's Tablebase block a cursed win's moves are all listed as draws; which keep the cursed win shows only in a move's tooltip (on the free board too, where the moves are buttons alone).
- The live test asks the real service: a Lichess outage fails it.
- A game analysis that loses Lichess part-way leaves the rest of its endgame positions to Stockfish without saying so; only the Analysis panel's header ("Tablebase" or a depth) tells them apart.

**asm.js Stockfish** (2026-10-31)
- **Verify** on the SM-T510 itself: checked only with SIMD faked off in desktop Chromium and Firefox. How slow it is on the tablet, and whether its 30 s start timeout is enough there, is unknown.
- The WebP export's encoder (`webp_enc_simd`) needs WebAssembly SIMD too, so the export likely fails on such a browser; untouched.
- The line under the Analysis panel hides where it doesn't fit (a narrow phone panel), as the tip did; the engine menu's note always shows.
- Its pace estimate starts from the lite engine's model (factor 1), far too fast, until a run has timed enough positions.

**Position from image** (2026-11-03)
- `tests/fixtures/vision-diagram.png` (a book-style diagram drawn here) reads its c4 bishop as a pawn in both browsers, framed or cropped, though the 2026-11-03 tests found real diagrams exact once cropped; and its read rarely marks a square to check (only cropped, in Chromium at 1440×900). The live test asserts no read of it, and doesn't cover the outlines: an edit dropping one was checked by hand in Chromium, a typed FEN dropping one (the same rule, `sureOf` in `GameApp`) not in a browser.
- Reading speed on a phone is unmeasured.
- Board auto-crop: the rank labels are told apart by ink alone. A labelled diagram turned a quarter (its file letters down the side) came out at 1.21 against the 1.35 needed to count as "8" over "1", so an unusual font could still pass letters for digits and turn a good read without a word; reading the digits themselves (matching them against "1" and "8" drawn in the page's fonts, or the whole 1–8 sequence) would be safer. The tilted-board test picture's noise layer doesn't show in its screenshot (the tilt alone keeps it from being an upright grid); the picture with no board has noise.
- After the dialog closes, focus goes back to Menu, also after Back to crop › Cancel, where going back to Back to crop would be nicer.

**Full Stockfish download** (2026-10-24)
- The time estimate for Full starts from the lite engine's model until a run with Full has timed enough positions; the benchmarks behind the limits were not redone for Full.
- A cancelled or failed download starts over (no resume), and the whole 99 MB is held in memory while it is checked.
- The live suite downloads the 99 MB from unpkg in each browser on every run (a Playwright route can't answer with a body that big: Chromium drops the connection).
