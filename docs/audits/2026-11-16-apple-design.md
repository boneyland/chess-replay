# Audit 2026-11-16: Apple design approach
Commit: cc50550 · Areas: 1 (motion, input, materials, type in `app/shell.html`, `engine.jsx`, `drag-scroll.js`, board input) · Findings: 0/6/3

Scope: a quick read of the code against the `apple-design` skill (Apple's WWDC *Designing Fluid Interfaces* and related talks, on the web). The page was not run; findings 3 and 4 need a check in the browser before anyone builds on them.

## Summary
The input side is already close to Apple's approach: pointer capture on the board, seek bar and drag-scroll; an exponential-decay glide on mouse drag-scroll; `touch-action` set; hover kept off touch screens. The gaps are in feedback and motion polish. Reduced motion is covered in two places only. Pressed states exist only on the Transport bar. Menus and dialogs appear with no motion. Piece motion runs on fixed-timeline easing, not a spring. Materials are flat, and type leans on wide-tracked uppercase mono.

## Fix plan
Items 1–3 are one PR (`claude/apple-motion-basics`), small commits. They touch `app/shell.html` (and small hooks in `.jsx`), not the replay engine or export. Items 4–7 are separate PRs and need a decision or a browser check first. Tick an item when it lands, with its PR.

- [x] 1. **Global reduced motion** (High): one `@media (prefers-reduced-motion: reduce)` block in `app/shell.html` turning slides, scales and transitions into short cross-fades; the piece animation and the `drag-scroll.js` glide skip overshoot and run short or off when the setting is on. Export and recording stay unaffected (they read the timeline, not the media query). (branch `claude/apple-motion-basics`, no PR yet)
- [x] 2. **Press states** (High): an instant `:active` / `[data-press]` look (about 0.97 scale or a darker fill, no delay) on dock buttons, menu items, dialog buttons and tiles, separate from `:hover` so touch gets feedback. Respect the existing `data-mouse` / `data-press` handling on the Transport bar. (branch `claude/apple-motion-basics`, no PR yet)
- [x] 3. **Menu and dialog motion** (Medium): menus and popovers scale and fade from their trigger (`transform-origin` at the button, about 150 ms in and 100 ms out, same path both ways), dialogs fade and rise. Reversible, with reduced motion falling back to a fade. (branch `claude/apple-motion-basics`, no PR yet)
- [ ] 4. **Springs for piece motion** (Medium): replace `MOTION` easing (`game-video-core.jsx:1`) with a critically damped spring for user-driven moves (damping 1.0, response 0.3–0.4), with a little bounce only after a drop. Must keep the video export and the demo recording deterministic; check both before merging.
- [ ] 5. **Drag details** (Medium): check the grab offset is kept; an illegal drop springs back from where it was released; the seek bar's knob gets soft resistance at its ends.
- [ ] 6. **Materials** (Low): translucent blur and saturate on menus, dialogs and the dock over the board, with `prefers-reduced-transparency` and `prefers-contrast` fallbacks. Firefox screenshots don't draw backdrop blur; judge in Chromium.
- [ ] 7. **Type and haptics** (Low): section titles in the system sans with size-specific tracking and sentence case, keeping mono for FEN and move text; check px paddings against the Text size setting; `navigator.vibrate` on Android for snap, capture and illegal move, on the same frame as the sound.

## Findings
### High
- [high] [motion] [app/shell.html:594](../../app/shell.html#L594) - Reduced motion is handled for `.q-dot` and the settings toggles only (`:594`, `:625`). The piece animation, the seek bar and menu transitions, and the drag-scroll glide ignore it.
  scenario: a viewer with the setting on still gets every slide, scale and overshoot.
  fix: item 1. confidence: sure (grep)
- [high] [feedback] [app/shell.html:70](../../app/shell.html#L70) - Pressed feedback exists only as `data-press` on the Transport bar (`:77–80`, `:185`). Elsewhere feedback is `:hover`, which touch screens don't fire.
  scenario: a tap on a menu item or dialog button shows nothing until the action lands.
  fix: item 2. confidence: sure (grep; no `:active` rule in the file)

### Medium
- [medium] [motion] [app/shell.html:229](../../app/shell.html#L229) - Menus switch with `display` (`.pmenu-open .dock-items`) and have no enter or exit motion or origin. The only `transition` rules are the seek bar (`:102–103`), the export bar (`:399`), the toggles (`:501`) and the settings thumb.
  fix: item 3. confidence: sure (grep)
- [medium] [motion] [app/game-video-core.jsx:1](../../app/game-video-core.jsx#L1) - `MOTION` uses `easeOutCubic`, `easeInOutCubic` and `easeOutBack` on a fixed timeline. A new move or a scrub during a piece animation can't redirect it from its current position and velocity.
  fix: item 4, after checking export determinism. confidence: likely (not run)
- [medium] [input] [app/game-video-core.jsx:3107](../../app/game-video-core.jsx#L3107) - Piece drag keeps `{ from, x, y, x0, y0 }` in board pixels, which suggests the grab offset is kept, but whether an illegal drop springs back, and whether the seek bar resists at its ends, was not checked.
  fix: item 5. confidence: unverified
- [medium] [feedback] [app/drag-scroll.js:5](../../app/drag-scroll.js#L5) - The glide runs on `requestAnimationFrame` and ignores reduced motion. (Covered by item 1.) confidence: sure (read)

### Low
- [low] [materials] [app/shell.html:214](../../app/shell.html#L214) - The only `backdrop-filter` blurs are 2 px (`:214`) and 10 px (`:394`); no `prefers-reduced-transparency` or `prefers-contrast` rule exists. fix: item 6.
- [low] [type] [app/shell.html:274](../../app/shell.html#L274) - Section titles use `600 0.8125rem var(--mono)` at `letter-spacing: 0.12–0.14em`, uppercase, in at least six places (`:274`, `:281`, `:355`, `:413`, `:423`, `:560`). fix: item 7.
- [low] [feedback] [app/sfx-core.js](../../app/sfx-core.js) - Sound exists but no haptics (`vibrate` has no hits). fix: item 7.

## Since the last audit
[2026-11-12-docs.md](2026-11-12-docs.md) covered the docs only; nothing here overlaps it.
