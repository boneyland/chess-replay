# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anyone with a chess game to look at: a PGN, a Lichess link, a FEN or a picture of a board. No single audience sets priorities. They come to replay and understand a game, try their own moves, play a game at one screen or against Stockfish, or turn a game into a video to share. They use it on desktop and on phones, held upright or sideways, sometimes at full screen or added to the home screen as an app.

## Product Purpose

A browser player for annotated chess games, at https://chess-replay.onrender.com/. It replays a game on an animated board with an eval bar and graph, a rating for every move, the best line, commentary and the opening name. It analyses games that come without evals with Stockfish 19 in the browser, and exports a game, or part of one, as an MP4, WebM or animated WebP. Around the replay it adds a free board (Explore, Edit position, Position from image), Play vs human, Play vs computer and My games.

Success: a viewer drops in any game and gets a clear, accurate replay and analysis right away, and a video of it that looks like the page, with no account, no install and nothing to pay.

## Positioning

- **A game as a video.** The replay plays like a narrated video (title and end cards, typewriter commentary, the camera push, the blunder glow) and exports as one. Review tools elsewhere show a board with a move list; this one shows a game you can watch and share.
- **Free and open.** GPL-3.0-or-later, no ads, no paywall, no sign-up.

## Operating Context

- Input: a PGN pasted or dropped (with a `[FEN]` start or Chess960 too), a lichess.org game, study or broadcast link, an analysis JSON from chess-animator (the Python/Manim renderer this was split from, checked out next to the repo), a FEN, or a screenshot or photo of a board.
- Watching: the video playing at full window, or paused and stepped through, with panels (Analysis, Moves, Commentary, Explorer) beside the board on a wide window and below it on a narrow one.
- Sharing: exported videos and WebPs go to other places (posts, chats); a video records the page as it looks, text size and layout included.
- One page, one route (`/chess-game-video.html`), static on Render; works offline once loaded.

## Capabilities and Constraints

- The principles in `docs/spec.md` are binding; the ones that shape design:
  - Nothing leaves the browser unless the viewer turns it on (one default exception: the endgame tablebase, FEN only, 7 pieces or fewer, never during a game). No accounts of our own.
  - The playing video stays clean: buttons, progress lines and engine controls belong to the paused page. Title and end cards, panel fade-ins, the blunder glow, the camera push and typewriter commentary play only while the video plays; stepping and paused viewing are a plain, still page.
  - Nothing heavy starts by itself (Full Stockfish 99 MB, board reader 56 MB, whole-game analysis: only on the viewer's click, with the cost stated).
  - No hints during a game but the ones asked for (3 per game against the computer).
  - Replay doesn't regress for free-board or game features.
  - Bad input explains itself, never a crash.
  - An app, not a document: no text selects but what's typed; a mouse drag scrolls what scrolls.
  - Offline works; online-only features degrade quietly.
- Layout is computed (`LayoutCore`, `app/layout-core.js`): one column or two, a Text size setting scales text, the board is a 768 px picture scaled into its box. Light or dark follows the system.
- Part names (Game info, Transport bar, Dock…) are in `docs/parts.md`; use them in design discussion.
- Strict Content-Security-Policy written by `build.cjs`: no inline scripts without hashes; every new host is declared.
- Licences limit what ships: several piece sets, the lisp sounds and the board reader model are non-commercial, and the page says so where it matters.
- The spec (`docs/spec.md`, `docs/spec/`), roadmap, known gaps and decisions log hold the detailed product record.

## Brand Commitments

- Name: Chess Replay.
- Voice (from `.claude/skills/ui-text`): plain explanation over cheerfulness, sentence case, no exclamation marks, the viewer is "you", problems read "problem: cause or way out", sizes and costs on the button ("Download board reader · 56 MB"), confirmations name both buttons by their action, never OK / Cancel.
- Credits and licence notices (README Credits, Settings › About, the board reader's PolyForm notice) must stay.

## Evidence on Hand

- The sample game the page opens with, with its analysis.
- `media/preview.webp` (the link preview), `media/demo.mp4` with `media/demo-game.pgn` (the README demo), `og-image.png`.
- No testimonials, user numbers, press or reviews: don't invent any.

## Product Principles

1. The game is the content: the board and the moves lead; controls step back, and vanish while the video plays.
2. Honest about cost and privacy: say what a click downloads, sends or takes before it happens.
3. Works for any game on any screen: any legal start, any length, phone or desktop, online or off.
4. Watchable and shareable: what you see is what the export records.
5. Free, with no strings: no account, no ads, no upsell.

## Accessibility & Inclusion

WCAG 2.2 AA is the bar for the page: contrast, keyboard operation, focus, screen-reader labels and announcements, target sizes (24 × 24 CSS px minimum, 44 px where the page already gives it on phones), and reduced motion that keeps state changes visible. Moves, FENs and player names are marked `translate="no"`.
