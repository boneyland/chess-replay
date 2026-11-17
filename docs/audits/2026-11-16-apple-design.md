# Audit 2026-11-16: Apple design approach
Commit: cc50550 · Areas: 1 (motion, input, materials, type in `app/shell.html`, `engine.jsx`, `drag-scroll.js`, board input) · Findings: 2/4/3 (header said 0/6/3 until the 2026-11-17 check); 2026-11-17 check at c3e1621: 0/5/1 more, 3 corrected

Scope: a quick read of the code against the `apple-design` skill (Apple's WWDC *Designing Fluid Interfaces* and related talks, on the web). The page was not run; findings 3 and 4 need a check in the browser before anyone builds on them.

Checked 2026-11-17, against the code at cc50550 and at c3e1621 (after PR 252), by reading it; the page was not run. Every cited line and grep claim held. The premises of items 4 and 5 were wrong and are rewritten below; item 1 was ticked with part of it not built; five findings were missed (marked *added 2026-11-17*).

## Summary
The input side is already close to Apple's approach: pointer capture on the board, seek bar and drag-scroll; an exponential-decay glide on mouse drag-scroll; `touch-action` set. Hover is kept off touch screens only in part: about a dozen `:hover` rules aren't gated by `@media (hover: hover)` and stick after a tap. The gaps are in feedback and motion polish. Reduced motion is covered in two places only. Pressed states exist only on the Transport bar. Menus and dialogs appear with no motion. Pieces animate only in timeline playback: stepping, the free board and the computer's replies snap, and a seek or pause can leave a piece drawn half-way between squares. Materials are flat, type leans on wide-tracked uppercase mono, and several controls are well under a 44 pt touch target.

## Fix plan
Items 1–3 are one PR (`claude/apple-motion-basics`), small commits. They touch `app/shell.html` (and small hooks in `.jsx`), not the replay engine or export. Items 4–7 are separate PRs and need a decision or a browser check first. Tick an item when it lands, with its PR.

- [x] 1. **Global reduced motion** (High): one `@media (prefers-reduced-motion: reduce)` block in `app/shell.html` turning slides, scales and transitions into short cross-fades; the piece animation and the `drag-scroll.js` glide skip overshoot and run short or off when the setting is on. Export and recording stay unaffected (they read the timeline, not the media query). (branch `claude/apple-motion-basics`, PR 252)
  *2026-11-17:* only the CSS and the glide landed; PR 252 touched no `.jsx`. The piece part moved to item 1b.
- [x] 1b. **Reduced motion in the replay** (High, *added 2026-11-17*): with the setting on and not exporting, `MOTION.pop` (easeOutBack, `game-video-core.jsx:806`) doesn't overshoot, piece slides run short, and the camera push and blunder glow are off. Read the media query in the view, never in the timeline the export reads. (branch `claude/apple-motion-followups`, PR 253)
- [x] 2. **Press states** (High): an instant `:active` / `[data-press]` look (about 0.97 scale or a darker fill, no delay) on dock buttons, menu items, dialog buttons and tiles, separate from `:hover` so touch gets feedback. Respect the existing `data-mouse` / `data-press` handling on the Transport bar. (branch `claude/apple-motion-basics`, PR 252)
- [x] 2b. **Press states, the rest, and sticky hover** (Medium, *added 2026-11-17*): give a pressed look to the controls PR 252 left out (segmented buttons, Settings tabs, toggles, `.twk-x`, `.twk-info`, `.mv`, `.expl-row`, `.q-stop`, `.q-mini`, `.tray-piece`, `.dock-queen`), and move the ungated `:hover` rules (see the finding) into `@media (hover: hover)`. Read the `mobile-native` skill first: some may be kept on purpose. (branch `claude/apple-motion-followups`, PR 253)
- [x] 3. **Menu and dialog motion** (Medium): menus and popovers scale and fade from their trigger (`transform-origin` at the button, about 150 ms in and 100 ms out, same path both ways), dialogs fade and rise. Reversible, with reduced motion falling back to a fade. (branch `claude/apple-motion-basics`, PR 252)
  *2026-11-17:* only the Menu (`.pmenu .dock-items`) got it, and its close is instant (a closing fade held the folded dock buttons on screen). `.dock-pop` and the Settings panel still appear with no motion: item 3b.
- [x] 3b. **The other popovers** (Low, *added 2026-11-17*): `.dock-pop` and `.twk-panel` grow and fade from their button like the Menu, with the same reduced-motion fade. (branch `claude/apple-motion-followups`, PR 253)
- [x] 4. **Piece motion where it snaps or stalls** (Medium, *rewritten 2026-11-17*): the old premise (a scrub can't redirect a piece mid-animation) was wrong: in playback a piece's place is a pure function of the playhead `T`, so there is nothing to redirect. The real gaps:
  - a seek bar drag let go, a keyboard seek (1 s) or a pause during playback leaves `T` inside a move, and the paused page shows the piece between squares, the last-move highlight already on (seen in a screenshot, 2026-11-17). On release or pause while not playing, settle `T` to the nearest move's settled time (`ChessCore.settledAt`), gliding there;
  - stepping (`goTo`, `game-video-core.jsx:3665`, jumps to `settled(i)`), the free board and Play vs computer (`LineBoard`, `:1254`, draws pieces in place) never animate a move: a drop or the engine's reply appears at once. Add a short glide there, ideally a critically damped spring (damping 1.0, response 0.3–0.4), a little bounce only after a drop.
  
  Neither touches the export or the demo recording as long as `MOTION` and the timeline stay as they are; check both before merging.
  *2026-11-17:* built in PR 256 (branch `claude/piece-glides`). The settle glides `T` (eased out, ≤ 0.3 s, `ChessCore.settleTo`); steps and line boards glide the pieces' images instead of `T` (a spring, response 0.25 s), so `c` and the nav never lag. No bounce after a drop: a dropped piece doesn't glide at all (item 5's spring-back is separate).
- [x] 5. **Drag details** (Medium, *rewritten 2026-11-17*, settled from the code): the grab offset is not kept: `DragGhost` (`game-video-core.jsx:1355`) centres the piece on the pointer, and `x0/y0` only feed the `DRAG_PX` threshold; many chess sites centre on purpose, so this is a decision, not a bug. An illegal drop clears `drag` (`:3193`) and the piece reappears on its square at once: spring it back from where it was let go. The seek bar is a hard `clamp` (`engine.jsx:489`): soft resistance at its ends is optional polish.
  *2026-11-17:* the spring-back is built (branch `claude/drag-spring-back`): the drag stays, `back` set, while `DragGhost` springs from the drop point to the square (the line glide's spring, ≤ 0.28 s), and the miss runs when it lands, since a miss closes the replay's empty line and the game board doesn't hide the square. Then, on the user's word, the grab offset is kept (the piece lands by its centre) and the seek bar rubber-bands at its ends (where the time beside it can move along; the phone layout's buttons leave no room). (PR 257)
- [ ] 6. **Materials** (Low): translucent blur and saturate on menus, dialogs and the dock over the board, with `prefers-reduced-transparency` and `prefers-contrast` fallbacks. Firefox screenshots don't draw backdrop blur; judge in Chromium.
- [ ] 7. **Type and haptics** (Low): section titles in the system sans with size-specific tracking and sentence case, keeping mono for FEN and move text; check px paddings against the Text size setting; `navigator.vibrate` on Android for snap, capture and illegal move, on the same frame as the sound.
  *2026-11-17, on the user's phone:* Chrome 156 for Android has `navigator.vibrate`, but a call only works once the page has had a tap: a hold timer's call returned `false` before any interaction and `true` after one. Firefox Beta 161 for Android has no `navigator.vibrate` at all, so these haptics reach Chrome only, and a haptic on a hold (as Chrome's own long-press tick) can't be added for Firefox: it has no web API for one. Feature-test (`'vibrate' in navigator`), never sniff the browser.
- [ ] 8. **Touch targets** (Medium, *added 2026-11-17*): at least 44 px hit areas on a coarse pointer (a larger box or a padded `::after`, not a bigger look): `.twk-info` 18 px, `.twk-seg` buttons 24 px, `.twk-x` 26 px, `.twk-tabs` 28 px, `.twk-toggle` 34×20, `.pbtn` 28–30 px in the short and one-column layouts. Check the phone layout doesn't overflow; px sizes here also ignore the Text size setting (item 7).

## Findings
### High
- [high] [motion] [app/shell.html:594](../../app/shell.html#L594) - Reduced motion is handled for `.q-dot` and the settings toggles only (`:594`, `:625`). The piece animation, the seek bar and menu transitions, and the drag-scroll glide ignore it.
  scenario: a viewer with the setting on still gets every slide, scale and overshoot.
  fix: item 1. confidence: sure (grep)
  *2026-11-17:* the CSS and glide parts are fixed (PR 252); the replay's overshoot, slides, camera push and blunder glow still ignore it: item 1b.
- [high] [feedback] [app/shell.html:70](../../app/shell.html#L70) - Pressed feedback exists only as `data-press` on the Transport bar (`:77–80`, `:185`). Elsewhere feedback is `:hover`, which touch screens don't fire.
  scenario: a tap on a menu item or dialog button shows nothing until the action lands.
  fix: item 2. confidence: sure (grep; no `:active` rule in the file)
  *2026-11-17:* touch screens do fire `:hover` on a tap; the trouble is that it sticks afterwards (next section's finding).

### Medium
- [medium] [motion] [app/shell.html:229](../../app/shell.html#L229) - Menus switch with `display` (`.pmenu-open .dock-items`) and have no enter or exit motion or origin. The only `transition` rules are the seek bar (`:102–103`), the export bar (`:399`), the toggles (`:501`) and the settings thumb.
  fix: item 3. confidence: sure (grep)
- [medium] [motion] [app/engine.jsx:641](../../app/engine.jsx#L641) - *Rewritten 2026-11-17.* Was: `MOTION` on a fixed timeline can't redirect a piece mid-animation; wrong, as a piece's place is a pure function of `T`. Now: letting go of the seek bar, a 1 s keyboard seek, or a pause during playback leaves `T` inside a move, and nothing settles it. Separately, stepping (`game-video-core.jsx:3665`), the free board and Play vs computer (`LineBoard`, `:1254`) never animate a move.
  scenario: a scrub let go mid-move shows a queen between squares with its last-move squares already lit; a computer reply appears without travelling.
  fix: item 4. confidence: sure (read; the mid-move frame seen in a screenshot)
- [medium] [input] [app/game-video-core.jsx:1355](../../app/game-video-core.jsx#L1355) - *Rewritten 2026-11-17.* Was: "suggests the grab offset is kept", unverified. Now: `DragGhost` centres the piece on the pointer, so the grab offset is not kept; an illegal drop clears `drag` (`:3193`) and the piece reappears on its square at once; the seek bar clamps hard at its ends (`engine.jsx:489`).
  fix: item 5. confidence: sure (read)
- [medium] [feedback] [app/drag-scroll.js:5](../../app/drag-scroll.js#L5) - The glide runs on `requestAnimationFrame` and ignores reduced motion. (Covered by item 1; fixed in PR 252.) confidence: sure (read)
- [medium] [feedback] [app/shell.html:415](../../app/shell.html#L415) - *Added 2026-11-17.* `:hover` rules not gated by `@media (hover: hover)`, so a touch screen keeps the tint after a tap: `.twk-x` (`:415`), `.twk-tabs button` (`:429`), `.piece-tile` (`:484`), `.board-tile` (`:490`), `.expl-row` (`:509`), `.mv` (`:514`), `.dock-queen` (`:517`), `.twk-info` (`:544`), `.q-table tr` (`:592`); the Menu's and `.dock-pop`'s `.dock-btn`s keep `:70`'s hover, since `:75` excludes them from the Transport bar's reset.
  scenario: a tapped move in the move list or a tapped Settings tab stays outlined or tinted until the next tap elsewhere.
  fix: item 2b. confidence: likely (read; not run on a phone)
- [medium] [feedback] [app/shell.html:627](../../app/shell.html#L627) - *Added 2026-11-17.* PR 252's pressed look covers boxed buttons only; segmented buttons, Settings tabs, toggles, `.twk-x`, `.twk-info`, `.mv`, `.expl-row`, `.q-stop`, `.q-mini`, `.tray-piece` and `.dock-queen` still show nothing on a tap. fix: item 2b. confidence: sure (grep)
- [medium] [input] [app/shell.html:496](../../app/shell.html#L496) - *Added 2026-11-17.* Touch targets well under 44 pt: `.twk-info` 18 px (`:543`), `.twk-seg button` 24 px (`:496`), `.twk-x` 26 px (`:414`), `.twk-tabs button` 28 px (`:428`), `.twk-toggle` 34×20 (`:499`), `.pbtn` 28–30 px in the short and one-column layouts (`:145`, `:153`, `:168`). fix: item 8. confidence: sure (read)

### Low
- [low] [materials] [app/shell.html:214](../../app/shell.html#L214) - The only `backdrop-filter` blurs are 2 px (`:214`) and 10 px (`:394`); no `prefers-reduced-transparency` or `prefers-contrast` rule exists. fix: item 6.
- [low] [type] [app/shell.html:274](../../app/shell.html#L274) - Section titles use `600 0.8125rem var(--mono)` at `letter-spacing: 0.1–0.14em` (`.q-pos` is 0.1em; corrected 2026-11-17), uppercase, in at least six places (`:274`, `:281`, `:355`, `:413`, `:423`, `:560`). fix: item 7.
- [low] [feedback] [app/sfx-core.js](../../app/sfx-core.js) - Sound exists but no haptics (`vibrate` has no hits). fix: item 7.
- [low] [motion] [app/shell.html:263](../../app/shell.html#L263) - *Added 2026-11-17.* `.dock-pop` and the Settings panel (`.twk-panel`, `:406`) appear with no motion; PR 252 animated the Menu only. Also a nit: `.piece-tile:active` is listed twice in the reduced-motion block (`:661–662`). fix: item 3b.

Not counted: the `.an-spin` spinner keeps turning under reduced motion; the CSS says so on purpose (`:656`).

## Since the last audit
[2026-11-12-docs.md](2026-11-12-docs.md) covered the docs only; nothing here overlaps it.
