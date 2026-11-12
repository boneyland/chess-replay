# Roadmap

[Spec](spec.md) › planned features.

Planned, roughly in this order; each item gets its own PR(s) on a `claude/<topic>` branch. Items marked *needs design* have open questions to settle with the user before a plan.

## Background music

Music that plays under the page, chosen from a few bundled tracks or the viewer's own file. Added 2026-10-23.

Decided:

- **Plays on the replay page, playing or paused, and on the free board and in games** (Play vs human, Play vs computer).
- **Not in exported videos**: MP4 and WebM exports keep the move sounds only.
- **Sources**: a small set of bundled free tracks, and an audio file from the viewer's device.

Proposed (to confirm when designing):

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

## Square layouts and breakpoints (*needs design*)

The responsive layout's squarish windows (near 1:1, such as an unfolded foldable or a tablet-sized window around 772×965) get either a sidebar that holds the board small or one column that scrolls; neither is designed for that shape. Open: a layout of its own for square screens (the board with the panels in a band under or beside it, sized for both); whether the device tiers' breakpoints (phone under 600 px wide or 500 px high, tablet and foldable 600–1023, desktop from 1024) and the stacking rules hold up on real devices (iPhone Duo's viewports per WebKit: 382–951 wide, 368–902 high); whether a half-folded screen (`device-posture: folded`, viewport segments, in preview in Safari 27.1) puts the board and the panels on separate halves. Asked for 2026-10-27.

## Player names (*needs design*)

In Play vs human set White's and Black's names; in Play vs computer the player's (Stockfish is "Stockfish 19"). Open: asked in the Play dialog or set later; whether the last names are remembered; where they show (player bars, My games rows, the PGN's `White`/`Black`, where `PlayCore.pgn` writes "White"/"Black" today).

## Chess960

From a FEN with X-FEN or Shredder-FEN castling, using Stockfish's `UCI_Chess960`; today `buildGame` rejects it ("Chess960 positions aren't supported yet"). The only variant: three-check, King of the Hill, crazyhouse, atomic, horde, antichess and racing kings are out of scope (another rules engine and a variant Stockfish). Must also read Lichess 960 exports (`[Variant "Chess960"]`, `KQkq` with the king off e1) and reordered rights (`kqKQ`), which today get "Castling rights don't match the pieces".

## Typed commentary (*needs design*)

The user types their own comment on a move. Open: where (replay, free board, a game from My games, all); how it sits with PGN comments, the notes file and Queen in the Commentary box (each now a Settings toggle) and in the video; whether Save PGN writes it as `{ }`; where it is kept (with the loaded game, with a My games entry, which ties in with replayed games losing their analysis and commentary today).

## Maia3 (*needs design*)

Maia predicts human moves at a chosen rating, unlike Stockfish's best move. Open: what for (an opponent in Play vs Maia, "what a human would play" beside Stockfish, or both); whether it runs in the browser (weights, runtime, size, licence) or would need a server; which ratings.

## Peer-to-peer online play (*needs design*)

Play vs human between two devices: one player makes a game and shares a link or code, the other joins, and moves go directly between the browsers (WebRTC data channel), with no game server of ours. No accounts of our own. Known risks, to weigh in the design: each player's IP address is visible to the other (WebRTC connects them directly; a TURN relay hides it but is a third party); nothing stops either player consulting an engine, so it suits friends, not strangers, and there is no matchmaking; a modified page can send any move, clock time or result, so each side checks the other's moves with `PlayCore` and treats the clock as a matter of trust; joining by link means the link is the only key to the game. Open: signalling (a WebRTC connection needs an offer/answer exchanged somehow: copy-paste codes or a QR code, which needs no server, or a public signalling or TURN service, which puts a third party in the path and in the CSP); NAT traversal without TURN fails on some networks; who keeps the clock and how a dropped connection, a reload or a dispute (takebacks, draw offers, claims) is settled when neither side is trusted; whether the game lands in both players' My games; offline it is "not available".

## App walk-through (*needs design*)

A short guided tour for a first visit: steps that point at the dock, the transport bar, Analyse, Menu and Settings, each with a sentence and Next/Skip, on desktop and phone layouts. Open: shown once by itself (a flag in localStorage) or only from a menu item ("Take the tour"); whether it uses a demo game (e.g. `media/demo-game.pgn`) so there is something to point at; how it keeps up with the layout (steps keyed to elements, not coordinates); whether separate short tours cover the free board, Edit position and games.
