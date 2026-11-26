# Audit 2026-11-27: correctness and security
Commit: 04db4ed · Areas: 11 · Findings: 0/14/44 · Dropped on checking: 0 (0 moved; 0 duplicates merged)

## Summary
No high findings. The security surface held up everywhere it was probed:
- the CSP hashes every inline script and allows only `'wasm-unsafe-eval'`;
- every pin in LAYOUT.md matches its file;
- both OAuth flows use crypto-random single-use `state` and PKCE verifiers and clear `?code` before any other step;
- each token goes only to its own hosts;
- no untrusted text reaches an HTML sink, and the Game info Link from PR 284 links only http(s) addresses;
- the CI workflow pins its actions by SHA with read-only permissions.

What matters most:
- **Hostile PGN input.** Three ways a pasted or stored PGN can freeze the tab: a huge move number in a FEN (`evalTicks`), a Site tag with thousands of trailing `)` (`links()`), and no cap on a game's length (~1.1 KB of heap per ply).
- **Stored state that comes back wrong after a reload.** A failed storage write leaves the previous game stored. A game ended by chasolver (a dead position) comes back as a game in progress.
- **The service worker keeps CDN copies without their integrity hashes.** One bad copy leaves the page blank until the next deploy.

The rest are mostly narrow lifecycle bugs: a stuck Hint, a threaded-engine restart with one try, an audio-encoder error hidden by a second one, the eval graph seeking after a swallowed right-click release.

Hot spots (last 300 commits): `app/game-video-core.jsx` 72, `app/shell.html` 50, `app/game-app.jsx` 39, `app/free-board.jsx` 37, `app/stockfish.jsx` 32.

## Fix plan
Not started (2026-11-27). Each item is one PR on a `claude/<topic>` branch (they change the page; see CLAUDE.md's Workflow), in this order. Line numbers are at commit 04db4ed: find the code by the quoted evidence if they have moved. Tick an item here, with its PR, when it merges.

- [ ] 1. **Hostile PGN input** (Medium ×3, Rules): `evalTicks` starts at the game's first move, and `readFen` caps the full-move field. `links()` counts its brackets once. Games over a ply cap (e.g. 5000) are refused with a message. Each gets a node test with the input that freezes it today.
  Ride-alongs (Low, Rules): `/^\s*\[/m` → `^[ \t]*\[`, NaN `[%eval]`/`[%clk]` dropped, `½-½` read as a result, an unclosed `(` is an error, a tag with an inner quote falls back to a line-anchored read, a one-line PGN starting with `[FEN` isn't taken for a FEN.
- [ ] 2. **Stored state after a reload** (Medium ×2, App and Rules):
  - `commit` removes `STORE` when the write fails.
  - `PlayCore.resume` keeps a stored `reason: 'dead'` draw.

  Node tests for `resume`.

  Ride-alongs (Low): `commit`'s false split into "not built" and "not stored", `resign`/`agreeDraw`/`claimDraw` check the flag first, `resume` checks a result against its reason, `timing` coerces stored numbers (an invalid scene list kills the dock), `loadFiles` reads the latest files after its awaits.
- [ ] 3. **Offline copies and tokens** (Medium ×2, Build and Online):
  - `sw.js` fetches CDN scripts with their `integrity`, and keeps only what passes (`build.cjs` passes the hashes for `REMOTE`).
  - Queen reads the HF token at call time (a ref), so Sign out stops a running test.

  Ride-alongs (Low): prune only older `chess-vision-N`, `pyParse` on `Object.create(null)`, `parseExplorer` checks field types, `readSse` takes CRLF, Queen retries automatically only before the event id, `persist-credentials: false` in test.yml. The docs drift (LAYOUT.md and CLAUDE.md: when the old vision cache is deleted) goes straight to `main`.
- [ ] 4. **Play vs computer and the engine** (Medium ×2, Boards and Engines):
  - `askHint` clears `hintAt` on a mismatch.
  - A replacement worker after a hang gets the same three start tries, and a run whose threads were forced off can resume its partial.

  Ride-alongs (Low): the game id in the hint key; `hint()` returning a stale search's null; `thinkMs` capped below the time left; `MoveEval`'s session maps bounded; no tablebase ask with castling rights (check what Lichess answers first).
- [ ] 5. **Export and saving** (Medium ×2, Export):
  - The audio encoder's real error survives (`close()` only when not closed, `err` re-checked before `encode`).
  - `saveFile` keeps a Blob URL for 60 s.

  Ride-alongs (Low): Cancel in the 'load' phase, the Export failed box keeps keys from the page, `fileStem` keeps non-Latin letters and is capped, a note when no audio codec encodes, `radiusOf` inside the try, `CopyButton` calls `text()` inside its try, `toBlob` null in `BoardThemes.render`, the page made inert from the Export click.
- [ ] 6. **Replay and phone input** (Medium ×4, Replay and Layout):
  - The eval graph takes only the primary button and drops `down` without buttons.
  - `DEEPER_SHOWN` never replaces a deeper eval with a shallower one.
  - The phone-tier Settings panel's `top` respects `env(safe-area-inset-top)`, as do `.dlg-scrim` and Queen's panel.

  Screenshot Chromium and Firefox for the CSS part, as CLAUDE.md asks for layout changes.

  Ride-alongs (Low): Queen panel's max-height minus `--safe-b`, `vline` worked out in render, the eval bar's text side from the move's eval, Piece cancels a glide on a jump, `materialOf` without the full-set clamp, drag-scroll's dt = 0, `useEditInput` clears its drag on `lostpointercapture`, the tooltip closes only on its own scroll, Commentary's book blink.

The rest can ride along with the PR that touches the same file, or wait for the next audit.

## Since the last audit
[2026-11-19-correctness-debt.md](2026-11-19-correctness-debt.md): items 1–7 and the straight-to-`main` items are all merged, and the agents found each fix still in place: `pieceTracks`, `useHeldSchedule` from the unclamped time, Queen's per-entry labels, the shared Chess960 tag builder, `boardAsGame`, Back to the free board not re-keeping, the export overlay modal, chunked sound, `drawnByYou`, `useKbFocus`, the tablebase note, `--pbar-total`.

Its open lows:

| Status | Lows |
|---|---|
| Fixed | `LINE_CACHE` unbounded (now an LRU of 500); stored partial runs checked only with `Array.isArray` (`readSfPartial` checks the shape); Commentary's one render with the old book (now only a 50 ms blink on the same game, Low here); a NAG glued to a move and `%` lines |
| Worse | drag-scroll's let-go speed (dt = 0 gives NaN, and the glide never stops; Low here) |
| Still holds | sf-engine.js's stale header; the dead-core timeout, its cache and no back-off; `useFirstDead` caching null; a wasm trap posting nothing; two tabs' settings and My games; the negative board size under ~30 px; `useFullEngine`'s "threaded build didn't run" message; the asm early start with the switch off |

[2026-11-16-apple-design.md](2026-11-16-apple-design.md) item 8 (44 px touch targets on a coarse pointer) was not in this audit's scope.

## Findings
### High
None.

### Medium
**Rules and parsing**
- [medium] [bug/DoS] [app/chess-core.js:1940](../../app/chess-core.js#L1940) - `evalTicks` counts up from move 10 to the game's first move, so a huge full-move number in a FEN freezes the tab on every eval-graph render.
  evidence: `for (let m = step; 2 * m - ply0 <= N; m += step)`; `readFen` accepts any digit string as the full-move field ([:634](../../app/chess-core.js#L634)).
  scenario: `[FEN "… w KQkq - 0 100000000"]` costs 19 ms per render. At 1e12 one call takes minutes, and at 1e15 it never finishes. The game is stored, so the hang comes back on reload. Run in node.
  fix: start at the first multiple of `step` at or after the game's first move, and cap the full-move field. confidence: sure
- [medium] [bug/DoS] [app/chess-core.js:1949](../../app/chess-core.js#L1949) - `links()` is quadratic in trailing `)`: each stripped character recounts every bracket, on every Game info render.
  scenario: `[Site "http://a)))…"]`: 5k `)` take 0.55 s, 20k take 9.6 s per render (run). fix: count once and decrement. confidence: sure
- [medium] [bug/DoS] [app/chess-core.js:899](../../app/chess-core.js#L899) - Nothing limits a game's length; each ply costs ~1.1 KB of heap (measured at 4000 plies), and `ImportCore.pgn` ([import-core.js:33](../../app/import-core.js#L33)) builds the game twice.
  scenario: a legal knight shuffle is ~6 bytes per ply, so a 5 MB paste is ~0.9 GB of heap and the 50 MB file cap allows several GB. The full-size case was extrapolated, not run. fix: refuse games over a ply cap with a message. confidence: likely

**Games and boards**
- [medium] [bug] [app/play-core.js:690](../../app/play-core.js#L690) - `resume` drops a result that came from chasolver, so a game that ended as a dead position comes back from storage as a game in progress.
  evidence: `kept` keeps only `agreement`, a claim the moves allow, `resign` and `time`; everything else is `outcome(board, human)`, which reads the dead-position prover's in-memory cache, empty after a reload.
  scenario: run in node with a fake prover: `{result:'1/2-1/2', reason:'dead'}` → save → `restore` gives `result: null`, a running clock, `[Result "*"]`. My games lists it as "In progress" with Resume, Replay loads `*`, and a reload restarts the clock. Offline (chasolver not kept), a drawn game plays on and can be lost on time.
  fix: keep `reason: 'dead'` in `kept`. confidence: sure
- [medium] [bug] [app/free-board.jsx:789](../../app/free-board.jsx#L789) - A hint whose position changed while it was looked for is dropped, but `hintAt` stays `{ key }`, so back in that position the Hint button is stuck on "Stockfish is looking for a move…", disabled.
  evidence: `if (b.fen + '|' + B.ucis(b).join(' ') !== k) return;` before any `setHintAt`.
  scenario: Play vs computer: press Hint, press ← then End within the search. Or press Hint, move anyway, then Take back after the reply. fix: clear `hintAt` for `k` before returning. confidence: sure

**App**
- [medium] [bug] [app/game-app.jsx:191](../../app/game-app.jsx#L191) - When the storage write fails, `commit` has already shown the new files but leaves the old `STORE` value, so a reload restores what was stored before.
  evidence: `setFiles(withLast); onCommit(keep); try { … localStorage.setItem(STORE, …) } catch (e) { setErr(…); return false; }` with no `removeItem`.
  scenario: Leave a vs-human game, then load a PGN too big for the storage left. On the next visit the abandoned game is back, its running clock charged for the time away, and its next commit can replace the paused My games copy. fix: `removeItem(STORE)` on a failed write. confidence: likely

**Engines and online services**
- [medium] [bug] [app/sf-engine.js:288](../../app/sf-engine.js#L288) - After a hang, the replacement worker gets a single boot try (`runBoot`'s probe timer → `fail`), not the three a first start gets ([stockfish.jsx:243](../../app/stockfish.jsx#L243)). A boot hang (about 1 load in 4 in Firefox, by the code's own comment) ends the engine and turns threads off. Because `sfPartialKey` includes the thread count, the stopped run can't resume.
  scenario: Firefox, 4 threads, a 120-ply analysis at ply 80: one hang, then a hung restart, gives "Analysis stopped". The panel then offers to analyse from move 1, and the 80 searches are lost.
  fix: the same start tries for a replacement (or count the boot hang toward `hangs`), and resume a partial stored under the run's original thread count. confidence: likely (traced, not run)
- [medium] [security] [app/queen.jsx:280](../../app/queen.jsx#L280) - A Queen call reads the HF token through the `hf` closure of the render that started it ([:187](../../app/queen.jsx#L187)), so Sign out during "Test Queen on N marked moves" doesn't stop the old token being sent.
  scenario: start a test of 12 marked moves (~8 min), then press Sign out. The panel says signed out, but every remaining call, retries included, still sends `Authorization: Bearer <old token>` and uses that account's ZeroGPU quota. A sign-in mid-run likewise stays anonymous.
  fix: keep auth in a ref read by `token()`. confidence: sure

**Build and offline**
- [medium] [security/offline] [app/sw.js:37](../../app/sw.js#L37), [app/sw.js:217](../../app/sw.js#L217) - CDN files (React, html2canvas-pro, fonts) are cached with no integrity check and then always served from the copy first.
  evidence: `fetch(url, { mode: 'cors' })` → `cache.put`; `cacheFirst` drops `req.integrity`.
  scenario: a TLS-intercepting proxy or a CDN edge serves a wrong 200 once. The page's SRI refuses it and the page is blank, on every later visit and any network, until a deploy changes `VERSION`. html2canvas likewise: every export fails.
  fix: fetch with `integrity`, keep only what passes; `build.cjs` passes the hashes for `REMOTE`. confidence: likely

**Export**
- [medium] [bug] [app/export.jsx:202](../../app/export.jsx#L202) - When the audio encoder fails, the error is replaced by an `InvalidStateError` from closing a codec that is already closed.
  evidence: WebCodecs closes the codec before the error callback. Here `if (!err) await enc.flush(); enc.close(); if (err) throw err;` throws at `close()`. If `err` arrives during `await room()`, `enc.encode(ad)` also runs on the closed codec.
  scenario: an AAC or Opus encoder error says "Export failed: InvalidStateError … closed codec". fix: `if (enc.state !== 'closed') enc.close()`, and re-check `err` before `encode`. confidence: likely (code and spec; not run)
- [medium] [bug] [app/game-app.jsx:998](../../app/game-app.jsx#L998) - `saveFile` revokes the Blob URL 1 s after `a.click()`. iOS Safari asks "Download …?" before it fetches the blob.
  scenario: a minutes-long iPhone export ends and the prompt shows. The viewer taps Download after more than 1 s: nothing is saved, and the encoded video is gone. FileSaver.js waits 40 s for this reason. fix: revoke after 60 s. confidence: unsure (not checked on a device)

**Replay**
- [medium] [bug] [app/game-video-core.jsx:3558](../../app/game-video-core.jsx#L3558) - The eval graph takes a press from any mouse button, and only pointerup/cancel clear `down`; a mouse move with `down` set seeks.
  scenario: in desktop Firefox on Linux, a right-click on the graph seeks, and the context menu swallows the release. From then on, moving the mouse over the graph with no button held jumps to every move it passes.
  fix: `e.button !== 0` returns; clear `down` when a mouse has `!(e.buttons & 1)`. confidence: likely (Firefox's release handling not run)
- [medium] [bug] [app/game-video-core.jsx:4348](../../app/game-video-core.jsx#L4348) - `DEEPER_SHOWN` lets any multi-line result replace a single-line one whatever its depth, against the 2026-11-08 decision ("the deepest finished result").
  scenario: Go deeper reaches depth 30. The viewer sets Lines to 3, and the automatic depth-24 search replaces it. The annotated PGN then writes the depth-24 `[%eval]`.
  fix: keep the deeper eval; take lines only from a result at least as deep. confidence: likely

**Layout and shell**
- [medium] [bug] [app/shell.html:520](../../app/shell.html#L520) - On the phone tier, Settings is pinned at `top: 4px` (`position: fixed`), ignoring `env(safe-area-inset-top)`. The other edges and `.signin-note`/`.net-note` respect their insets.
  scenario: an iPhone home-screen app (`black-translucent`, ~59 px inset) or Android full screen: the Settings title, ✕ and tabs sit under the status bar or cut-out.
  fix: `top: max(4px, env(safe-area-inset-top, 0px))`, and the same for `.dlg-scrim` and Queen's panel. confidence: likely (cascade read, not seen on a device)

### Low
Unchecked against the code unless noted; each is from its area agent's full read.

**Rules and parsing**
- [low] [bug/DoS] [app/chess-core.js:527](../../app/chess-core.js#L527), [:487](../../app/chess-core.js#L487) - `/^\s*\[…\]/m` in `classifyFile` (every dropped file) and `parseNotes` is quadratic on a run of blank lines. Measured ×4 per doubling, 8000 newlines = 56 ms; a 200 KB file of blank lines is ~35 s by extrapolation. fix: `^[ \t]*\[`.
- [low] [bug] [app/chess-core.js:372](../../app/chess-core.js#L372) - A tag value with an inner unescaped quote or a trailing backslash isn't read as a tag, while `splitGames` (:319) counts it as a header; the game is refused with `Can't read the move "[Event"` (run).
- [low] [bug] [app/import-core.js:6](../../app/import-core.js#L6) - A one-line PGN starting with its `[FEN …]` tag goes down the FEN path and is refused (run).
- [low] [bug] [app/chess-core.js:388](../../app/chess-core.js#L388) - A non-numeric `[%eval]` gives `cp`/`mate` NaN, which is carried forward and written back as `[%eval NaN]` (run). `[%clk]` accepts `.` too.
- [low] [bug] [app/chess-core.js:432](../../app/chess-core.js#L432) - An unclosed `(` silently drops the rest of the main line; the game loads with 1 ply (run).
- [low] [bug] [app/chess-core.js:478](../../app/chess-core.js#L478), [:300](../../app/chess-core.js#L300) - `½-½` isn't read as a result by either reader (run).

**Games and boards**
- [low] [bug] [app/play-core.js:502](../../app/play-core.js#L502) - `resign`, `agreeDraw` and `claimDraw` don't call `flag()` first, so a draw claimed after the time ran out (before the 100 ms flag interval) is a draw, not a loss, and the clock is stored negative.
- [low] [bug] [app/play-core.js:346](../../app/play-core.js#L346) - `thinkMs`'s 100 ms floor can exceed the time Stockfish has left, contrary to its "never flags" comment. This bites only after ~170 moves at 10+0.
- [low] [robustness] [app/play-core.js:690](../../app/play-core.js#L690) - `resume` keeps a stored result whose score contradicts its reason (tampered storage; display only).
- [low] [bug] [app/free-board.jsx:789](../../app/free-board.jsx#L789) - The hint key has no game id, so a hint landing after Resign → Play again at the first position goes to the new game and uses one of its 3 hints.
- [low] [race] [app/free-board.jsx:404](../../app/free-board.jsx#L404) - `hint()` can return a replaced search's null, so the panel says "found no move: ask again" while the fresh search runs.
- [low] [bug] [app/edit-board.jsx:190](../../app/edit-board.jsx#L190), [:213](../../app/edit-board.jsx#L213) - `useEditInput` doesn't clear its drag on `lostpointercapture`, so after a lost release every touch (a new pointerId) is ignored. A tray drag released on the board runs `E.move(setup, null, to)` and blanks the square. confidence: unsure.
- [low] [bug] [app/drag-scroll.js:145](../../app/drag-scroll.js#L145) - The let-go speed divides by `b.t - a.t`, which can be 0. A NaN speed never drops under `GLIDE_MIN`, so the glide spins and BoardGroup's settle never runs; on a moving axis it gives a full-speed fling. Worse than the last audit's open low.

**App and stage**
- [low] [bug] [app/game-app.jsx:789](../../app/game-app.jsx#L789), [:825](../../app/game-app.jsx#L825), [:947](../../app/game-app.jsx#L947) - `commit` returns false for both "not built" and "not stored", so with full storage the seek refs are cleared (Back to the loaded game opens at 0:00, a link's `#32` at the start) and a dropped Queen file merges without its game.
- [low] [race] [app/game-app.jsx:892](../../app/game-app.jsx#L892) - `loadFiles` takes `files`/`board` from its render after `await f.text()`. Of two overlapping loads, the last to finish wins, and an analysis committed during the read is overwritten.
- [low] [bug] [app/engine.jsx:901](../../app/engine.jsx#L901) - An invalid scene list replaces the Stage and the dock with a message, with no Clear saved data. A stored non-number `secondsPerMove` (`timing`'s `||` doesn't coerce) makes every reload dead.
- [low] [bug] [app/game-app.jsx:494](../../app/game-app.jsx#L494), [app/engine.jsx:414](../../app/engine.jsx#L414) - The Export failed box is `aria-modal` but lets F, the arrows, `,` `.` and Home through to the page (`video.busy` is false in the error phase).
- [low] [bug] [app/engine.jsx:276](../../app/engine.jsx#L276) - The column hysteresis memory `off` is rebuilt whenever the effect re-runs, and `video` is in its deps, so Play/Pause forgets it. confidence: unsure.

**Engines and online services**
- [low] [bug] [app/move-eval.js:54](../../app/move-eval.js#L54) - `finishedSearches`, `presses` and `autoRan` grow without limit for the session.
- [low] [bug] [app/tablebase.jsx:34](../../app/tablebase.jsx#L34), [app/analysis-core.js:450](../../app/analysis-core.js#L450) - A position with 7 pieces or fewer that still has castling rights is sent to the tablebase. If Lichess refuses it, a game analysis reports "Lichess's tablebase stopped answering". confidence: unsure (Lichess's answer not checked).
- [low] [cost] [app/queen.jsx:106](../../app/queen.jsx#L106), [:320](../../app/queen.jsx#L320) - The stream limit is a wall-clock cap, not the idle limit its comment describes, and every failure after the event id is retried automatically. A slow or cut stream costs a second ZeroGPU call.
- [low] [security] [app/queen-core.js:23](../../app/queen-core.js#L23) - `pyParse` builds dicts on `{}`, so a `'__proto__'` key replaces that object's prototype and `queenPayload`'s `in` check passes (run; no global pollution; `queenAnswer` re-types the fields).
- [low] [bug] [app/lichess-core.js:233](../../app/lichess-core.js#L233) - `parseExplorer` checks no field types, so a non-string `san` reaches React as a child and crashes the render. Game links stay on lichess.org.
- [low] [bug] [app/queen-core.js:138](../../app/queen-core.js#L138) - `readSse` splits on `\n\n` only; a CRLF stream reads as cut short (and is retried). confidence: unsure (Gradio writes LF).

**Export, share and sound**
- [low] [bug] [app/export.jsx:395](../../app/export.jsx#L395) - The 'load' phase has no Cancel. It covers the html2canvas load, rAF (which never fires in a hidden tab) and the whole soundtrack's encode, and the modal overlay leaves no way out but a reload.
- [low] [bug] [app/export-draw.js:743](../../app/export-draw.js#L743) - `radiusOf(s)` sits outside the `Unsupported` try, so a percentage or per-corner radius on a shadowed fallback layer fails the export (latent: no such layer today).
- [low] [bug] [app/share-dialog.jsx:164](../../app/share-dialog.jsx#L164), [app/game-app.jsx:1114](../../app/game-app.jsx#L1114) - While `BoardThemes.render` runs, before the overlay is modal, the page takes keys and `editing` isn't checked again.
- [low] [bug] [app/export.jsx:255](../../app/export.jsx#L255) - Where no AAC or Opus encoder exists, the file is silent with no word. Sound files never cached, offline, likewise.
- [low] [bug] [app/game-app.jsx:1007](../../app/game-app.jsx#L1007) - `fileStem` keeps only ASCII `\w` (Cyrillic and CJK names give `___.mp4`) and has no length cap. It is safe against path characters.
- [low] [bug] [app/share-dialog.jsx:15](../../app/share-dialog.jsx#L15) - `CopyButton` calls `text()` outside its try, so a throwing PGN builder fails silently.
- [low] [bug] [app/board-themes.js:242](../../app/board-themes.js#L242) - `toBlob` can call back with null; `createObjectURL(null)` then throws a TypeError instead of a clear failure.

**Replay**
- [low] [bug] [app/game-video-core.jsx:2346](../../app/game-video-core.jsx#L2346) - Since PR 286 the eval bar's number shows the new eval at once, but its side and colour still follow the gliding old eval. For ~0.5 s, "+1.20" sits at Black's end.
- [low] [bug] [app/game-video-core.jsx:934](../../app/game-video-core.jsx#L934) - Piece doesn't cancel a running step glide when the next change is a jump, so the piece slides in from a wrong offset.
- [low] [bug] [app/game-video-core.jsx:2343](../../app/game-video-core.jsx#L2343) - While a line is previewed, the eval bar shows the position behind it (PR 287 fixed only the arrows). It may be intended; it isn't recorded.
- [low] [bug] [app/game-video-core.jsx:2488](../../app/game-video-core.jsx#L2488) - `materialOf` clamps against the full set. After a promotion with the queen still on, the promoter shows no extra queen and the opponent shows a "taken" pawn (`pts` is right).
- [low] [bug] [app/game-video-core.jsx:4202](../../app/game-video-core.jsx#L4202) - A shown line is dropped in a passive effect, so for one frame after a seek-bar drag or Play the board shows the line against the new move.
- [low] [bug] [app/game-app.jsx:1050](../../app/game-app.jsx#L1050) - The book name blinks off for 50 ms when M is rebuilt for the same game (an analysis lands), the side effect of the last audit's old-book fix.

**Layout and shell**
- [low] [bug] [app/shell.html:151](../../app/shell.html#L151), [:516](../../app/shell.html#L516) - Queen panel's `max-height` leaves out `--safe-b` while its `bottom` adds it. On an iPhone home-screen app its header starts above the screen. Settings' rules subtract it, so the copies have drifted.
- [low] [bug] [app/tweaks.jsx:149](../../app/tweaks.jsx#L149) - An ⓘ tooltip closes on any scroll in the page (window capture), so during playback the Moves list's scroll closes it on every move.

**Build, offline, vision, CI**
- [low] [offline] [app/sw.js:94](../../app/sw.js#L94) - `prune()` deletes any `chess-vision-*` cache that isn't its own, a newer one included. If a new worker's install fails, the 56 MB download repeats on every visit.
- [low] [bug] [app/vision-grid.js:167](../../app/vision-grid.js#L167) - `findBoard` passes `checkered` one averaged square size, so a non-square box at the picture's edge reads past the integral image (NaN), and the real grid is rejected.
- [low] [race] [app/vision.jsx:270](../../app/vision.jsx#L270) - Of two quick picks or pastes, the last to decode wins, not the last chosen.
- [low] [ci/security] [.github/workflows/test.yml:27](../../.github/workflows/test.yml#L27) - checkout keeps `persist-credentials: true` while `npm install` runs unlocked transitive install scripts. The token is `contents: read` only.
- [low] [docs] [LAYOUT.md:207](../../LAYOUT.md#L207), CLAUDE.md (Position from image) - Both say activate deletes the older `chess-vision-*`. Since 2026-11-21 a later prune does.

## Coverage
| Area | Files | Read in full | Not covered |
|---|---|---|---|
| 1a Rules: chess-core and parsing | chess-core.js, import-core.js, openings-core.js, openings-data.cjs, src/game-data.js, src/sample-game.js | all | — |
| 1b Games, boards, dead positions | play-core.js, board-core.js, edit-core.js, dead-core.js, dead-worker.js, dead.jsx, games-core.js, tools/chasolver-wasm/{src/lib.rs, build.sh, Cargo.toml, rust-toolchain.toml} | all | — |
| 2a Analysis and engines | analysis-core.js, stockfish.jsx, sf-engine.js, sf-full.js, move-eval.js, tablebase.jsx | all (+ kept-files.js) | — |
| 2b Online services and sign-in | queen.jsx, queen-core.js, lichess-core.js, explorer.jsx, pkce.js | all | — |
| 3a1 Replay, first half | game-video-core.jsx 1–2541 | all | — |
| 3a2 Replay, second half | game-video-core.jsx 2441–4835 | all | — |
| 3b Free board, Edit position, dialogs | free-board.jsx, edit-board.jsx, dialogs.jsx, drag-scroll.js | all | — |
| 3c App, stage, dock | game-app.jsx, engine.jsx, dock.jsx | all | — |
| 3d Layout, shell, settings | layout-core.js, shell.html, tweaks.jsx, settings-tabs.jsx, board-themes.js, piece-sets.js, theme.js | all | — |
| 4a Export, share, sound | export.jsx, export-draw.js, webp-core.js, share-dialog.jsx, sfx-core.js, sfx.jsx, draw-core.js | all | — |
| 5 Build, deploy, offline, kept files, vision | build.cjs, build-js.cjs, render.yaml, render-headers.cjs, sw.js, test.yml, tests/live/serve.cjs, eslint.config.mjs, .gitignore, .gitattributes, LAYOUT.md, kept-files.js, kept-download.jsx, vision.jsx, vision.js, vision-core.js, vision-grid.js, vision-worker.js | all | — |

Left out, as the skill says: `vendor/`, `vision/`, `openings/`, `babel/`, `media/`, `tests/` (read only for cross-checks), `docs/`, pieces and icons, `app/sample-analysis.js`. Also left out: `.claude/skills/` (tooling, including the third-party impeccable scripts), `.impeccable/`, DESIGN.md, PRODUCT.md, README.md. Pinned files were checked with `sha256sum` in area 5: all match.

## Not checked
- Nothing was run in a browser or on a device. The phone findings are read from the CSS cascade and the code: safe areas, the iOS download prompt, touch drags in Edit position. So are Firefox's right-click release on the eval graph and the threaded-engine restart.
- Run in node on the cores, with small bounded inputs: the five parsing findings, the `evalTicks`/`links()` timings, the bytes per ply (the multi-GB case extrapolated), `resume` dropping a dead result, `pyParse`'s `__proto__`, `readSse` on CRLF.
- Lichess's answer to a tablebase request with castling rights wasn't checked (no network).
- Whether Gradio cancels an abandoned Queen job wasn't checked.
- The two-tab service-worker case is still not run in a browser.
