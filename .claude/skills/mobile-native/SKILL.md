---
name: mobile-native
description: How to make the chess-replay page feel right on a phone or tablet, and how to check it - hover tints that stick after a tap, tap flashes, page height under the address bar, safe areas, input zoom, laggy taps, overscroll, long-press selection, touch-action on the board and seek bar, theme-color - with what the page already does about each and why. Use when changing or reviewing anything a phone or tablet shows or that takes touch (layout at phone sizes, the Transport bar, Dock, dialogs, board input), or when something "works on desktop but feels wrong on my phone".
---

# Feeling native on a phone

Adapted for chess-replay from Emil Kowalski's `mobile-native` skill (github.com/emilkowalski/skills, MIT, copied 2026-11-16). The original is a list of one-line CSS fixes for a typical web app. This page already has most of them, often in a form that differs on purpose. So each item below says what the page does now, why, and what to check. Read the comment next to the CSS before changing anything it explains: many of these lines record a bug found on a real phone.

The "now" notes were checked on 2026-11-16. Grep before relying on one.

## Posture

- **The phone is the source of truth.** Sticky hover, the tap flash, the address bar's effect on height, input zoom, overscroll and safe areas don't reproduce in Chromium's phone profile, and Playwright's Firefox has no phone emulation at all. Say which checks ran on a real phone and which only in emulation.
- **CSS or a meta tag before JavaScript**, but this page does gate some things in JavaScript when CSS can't tell (see the `data-mouse` item below). Follow what's there.
- **Touch and mouse together.** Tablets with trackpads and laptops with touch screens exist. Gate by what the pointer can do, never by user agent or width alone. The page's device tiers (`LayoutCore`, and the matching breakpoints in `app/shell.html`) are about room, not about touch.

## Where things stand

| Problem | What the page does now | Where | Open |
| --- | --- | --- | --- |
| Hover tint stuck after a tap | Transport bar and Dock: tint only while `data-mouse` is set (the last pointer over the bar was a mouse), set by `PlaybackBar` in `app/engine.jsx`. Settings, dialogs, Queen: inside `@media (hover: hover)`. | `app/shell.html` (search `data-mouse`, `(hover: hover)`) | About a dozen `:hover` rules are still ungated, e.g. `.mv:hover` (Moves), `.expl-row:hover`, `.piece-tile:hover`, `.board-tile:hover`, `.twk-x:hover`. Gate each in `(hover: hover)` unless it's meant to show on touch. |
| Press feedback | `data-press` on Transport bar buttons while any pointer presses (Firefox for Android can leave `:active` on a tapped button) | `app/engine.jsx`, `app/shell.html` | New buttons in the bar use `data-press`, not `:active`. |
| Tap flash | Nothing sets `-webkit-tap-highlight-color` | — | Set it to `transparent` on `html` only together with a press state for every control that lacks one. |
| Page height | The root is `100%` high; every Firefox gets its own rules (`@supports (-moz-appearance: none)`) that let the root scroll by the address bar's height, so Firefox for Android draws the strip it uncovers. Dialogs and menus cap at `100dvh`. | `app/shell.html` top of the CSS (long comment), `LayoutCore` | Don't swap in `100vh` or `100dvh` for the root without reading that comment and `docs/known-gaps.md`. |
| Notch and gesture bar | `viewport-fit=cover`, `env(safe-area-inset-*)`, and `--safe-b` for the bottom (Firefox for Android reports the gesture bar as an inset it never draws under) | `build.cjs` (viewport meta and comment), `app/shell.html` | Use `--safe-b`, not `env(safe-area-inset-bottom)`, for anything at the bottom. |
| Zoom | **Off on purpose**: `maximum-scale=1, user-scalable=no` (browsers that ignore it still allow a pinch). This goes against the original skill's "never disable zoom". | `build.cjs` viewport meta | Never change it as a "fix". Raise it with the user, and log what they decide in `docs/decisions.md`. |
| Input zoom on iPhone | Text fields are 16px under `(pointer: coarse)`: `.dlg-field`, `.xfer-field` | `app/shell.html` | Any new text field gets the same, or iPhone Safari zooms in on focus and stays zoomed. |
| Laggy taps | `* { touch-action: manipulation }` | `app/shell.html` | The board's input and the seek bar (`.ptrack`, `touch-action: none`) set their own. Never put `none` on something the page needs to scroll past, such as the paused one-column page. |
| Pull-to-refresh, scroll chaining | No `overscroll-behavior` anywhere | — | Scrolling panels (Moves, Settings, Commentary, dialogs) chain to the page. `overscroll-behavior: contain` on them is a candidate; check it doesn't break the Firefox root scroll above. |
| Long-press selects text | `body` is `user-select: none` (an app, not a document); inputs and editable fields turn it back on | `app/shell.html` | The original skill says never on `body`. Here it's the design, but text a viewer may want to copy (a FEN, a PGN, an error message) must turn selection back on. |
| Status bar colour | `theme-color` per system scheme, the manifest's `theme_color` = light `--bg` | `build.cjs` (from `app/theme.js`) | The page's own Dark setting doesn't update `theme-color`: a dark page under a light system keeps a light bar. |
| Device has no drag | `(pointer: coarse)` checks skip "drag here" hints | `app/free-board.jsx`, `app/vision.jsx` | |

## Rules

1. **Every fix ships with its reason**, in a CSS or code comment next to it, as the page's comments do: what broke, on which browser and device, and when it was found.
2. **Media queries over device sniffing**: `(hover: hover)`, `(pointer: coarse)`, `env()`, `dvh`. The exceptions are the page's own (`data-mouse` from the pointer's `pointerType`, the Firefox `@supports`), each with a comment saying why CSS couldn't.
3. **Height and safe areas belong to `LayoutCore`** (`app/layout-core.js`) as well as CSS. A box that LayoutCore positions must not be resized by CSS alone, or the two disagree.
4. **Text fields are 16px on touch screens.**
5. **Never `touchmove` + `preventDefault()`** to stop scrolling: use `touch-action` or `overscroll-behavior`.

## Checking it

- **Real phone:** the user's Android phone runs Firefox Beta, reached over adb with `adb reverse` and screencaps (see the `android-phone-adb-testing` memory). Use it for anything in the "Open" column.
- **Emulation here:** Chromium's phone profile (`isMobile`, `hasTouch`) at 390×844 upright and 844×390 sideways. It shows layout and `(pointer: coarse)`. It doesn't show sticky hover, the address bar or the gesture bar.
- **Elsewhere:** Android Chrome (`android` job) and iOS Safari (`ios` job) run only in GitHub Actions. See the `browser-tests` skill.
- **Firefox for desktop** for the layout too (CLAUDE.md), knowing it can't emulate a phone.
- Screenshot desktop (1440×900) and phone (390×844) and show the paths. A change to the page goes on a `claude/<topic>` branch with a PR (CLAUDE.md › Workflow).

## Output

Apply the fixes the user asked for. Then, in a few lines:

- **What was wrong**: the symptom and the one-line reason.
- **What changed**: file and declaration, one line each.
- **What needs a phone**: which fixes were checked in code or emulation, and which the user must confirm on a real device.

When the honest answer is "I can't check this without a phone", say that instead of calling it fixed.
