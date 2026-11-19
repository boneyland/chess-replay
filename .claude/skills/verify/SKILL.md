---
name: verify
description: How to verify a chess-replay change at its real surface (the built page in Chromium and Firefox, driven by Playwright with real mouse input), for /verify runs. Use with the browser-tests skill, which has the launch details.
---

# Verifying a change in the running page

Surface: the built page (`out/site`) served by `tests/live/serve.cjs`, driven through the UI. Don't rerun the test suites
as evidence; read `tests/live/site.test.cjs` only to learn flows and helpers.

## Setup

- `node build.cjs`, then a driver script in the scratchpad that `require`s `tests/live/serve.cjs` (`serve(dir)` → `{ url, close }`)
  and `tests/live/board.cjs` (`loadedOn`, `settled`, `square`); 1440×900 for desktop, 390×844 for the phone layout
- Launch the browsers the way `LAUNCH` and `open()` in `tests/live/site.test.cjs` do (copy them): they pick this laptop's
  browsers when present and Playwright's own otherwise, and handle a cloud machine's proxy. One browser at a time
- Find Playwright with `require('playwright')`, falling back to `npm root -g` (as site.test.cjs does)

### On the user's laptop

- Playwright via `NODE_PATH=$(dirname ~/.npm/_npx/*/node_modules/playwright)`, run with the sandbox disabled. Chromium is the
  ungoogled-chromium flatpak, Firefox the Developer Edition (`channel: 'moz-firefox'`)
- Wrap each run in a watchdog (poll `MemAvailable`, SIGKILL the process group under ~2200 MB): the machine freezes otherwise

### On a Claude Code cloud machine (`CCR_AGENT_PROXY_ENABLED` is set)

- No flatpak or Developer Edition: Playwright's own Chromium, and its own Firefox (`FIREFOX_PATH=playwright` in the live
  tests' terms); install them with `npx playwright install chromium firefox` if they're missing
- Firefox's contexts need `ignoreHTTPSErrors: true` (Playwright's Firefox doesn't trust the proxy's CA); Chromium's don't
- Where cdnjs is blocked the page never renders: serve React from npm packages with a route, as `LIVE_CDN_DIR` does in `open()`
- Firefox's offline/service-worker checks fail there (`NS_ERROR_OFFLINE`): note it rather than counting it against the change
- No phone or adb, no Epiphany: say which checks were left for the laptop or GitHub Actions

## Driving

- Menu: `getByRole('button', { name: 'Menu', exact: true })`, then the item by name (Starting position, Edit position,
  Chess960 position, Play vs human, Play vs computer, My games…). Import game is its own Dock button; its box is
  `getByRole('textbox', { name: 'PGN, FEN or Lichess link' })`, and a file goes in with `setInputFiles('#game-files', { name, mimeType, buffer })`.
  Edit position's FEN box: `getByRole('textbox', { name: 'FEN' })`, then Done
- Board squares: the box of `[title="Drag a piece to try your own move"]` / 8, through `square(box, 'e2', flipped)`; drag with
  `page.mouse` down/move (steps)/up. Vs human turns the board to the side to move (flipped when Black is to move)
- A loaded game's Moves chips are `[data-ply="i"]`; Home + `Play (space)` plays the video, `Pause…` stops it
- Instrument by wrapping `window.Worker` (or `fetch`) in `ctx.addInitScript` to count what the page starts

## What to check besides the change itself

Run through the items that the change touches, not all of them every time. Report each as checked, not applicable, or left
for a real device.

- **Keyboard**: every new control is reached by Tab in a sensible order and works with Enter or Space; a dialog takes the focus
  when it opens, Esc closes it, and the focus goes back to the button that opened it. Drive it with `page.keyboard`
- **Focus ring**: a focused control shows a ring (`:focus-visible`), and nothing sets `outline: none` without another visible
  mark in its place. A bar or panel (Transport bar, Dock) never covers the focused element: screenshot with the focus on it
- **Touch and pointer**: anything shown on hover is also reachable by tap; anything done by dragging (a move, the seek bar) also
  works by click and by keyboard. In Chromium's phone profile, check no hover tint stays on after a tap (`mobile-native` skill)
- **Reduced motion**: if the change animates, open a context with `reducedMotion: 'reduce'` and check the motion stops or is
  cut to a fade, and that nothing waits on an animation that no longer runs
- **Animation**: transitions name their properties (never `transition: all`) and move `transform` or `opacity`, not `top`,
  `width` or `height`; a transition that a click can interrupt (a panel opening) follows the click
- **Dark theme**: screenshot under the page's Dark setting and under the system's (`colorScheme: 'dark'` on the context): no
  hard-coded colours (they come from `app/theme.js`), borders and icons still visible, native `<select>` and inputs readable
- **Text size**: Settings' Text size at its largest, at 1440×900 and 390×844: nothing clipped by a fixed height
- **Long and odd content**: if the change shows game data (names, events, comments, openings), load a game with long and
  missing values; the `break-ui` skill has fixtures and values
- **Screen reader text**: new status or progress text sits in `role="status"`, a new error in `role="alert"`, icon buttons have
  an `aria-label` (the `ui-text` skill has the wording rules). Check with role queries rather than by eye:
  `getByRole('status')`, `getByRole('alert')`, `getByRole('button', { name })`
- **Console**: no errors, no CSP violation (the live tests turn `securitypolicyviolation` into a console error; listen for it
  the same way), no React key or state warnings
- **Long lists**: a change to Moves, Commentary or My games stays smooth on a long game (150+ moves): step through it with the
  keyboard and watch for lag, and look for layout reads (`getBoundingClientRect`, `offsetHeight`) added inside render

These come from Vercel's Web Interface Guidelines (github.com/vercel-labs/web-interface-guidelines, read 2026-11-16), keeping
what applies to this page and its tools.

## Gotchas

- The game dialogs remember the free board: once the board holds a set-up position there is no "Set up position…" button,
  and Start game uses the board as it is. Set the position first with Edit position for a known start
- `innerText` applies CSS `text-transform` (result lines read upper case): match case-insensitively
- In Firefox, `ctx.route` sometimes lets one request through (a 404 route once served the real worker on the 32nd try): check
  the request log before blaming the page
- A failing Worker load is a page error in Firefox but silent in Chromium
- Screenshots go to the scratchpad; send them with SendUserFile and give full absolute paths