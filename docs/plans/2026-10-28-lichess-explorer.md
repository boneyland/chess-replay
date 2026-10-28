# Lichess opening explorer Implementation Plan

**Goal:** An Explorer panel with Lichess's game counts per move (Lichess or Masters database), behind a Settings › Online toggle and a Lichess sign-in.

**Spec:** `docs/spec.md` › Roadmap › PR 4. Branch `claude/lichess-explorer`, small commits, PR against `main` only when asked.

**Verified 2026-10-28:** `https://explorer.lichess.ovh/{lichess,masters}?fen=…` answers **401 without a token** (CORS allows `Authorization`, `GET`), so sign-in is required, not optional. Response shape below is from Lichess's documentation, not a live answer (no token here): `{ white, draws, black, moves: [{ uci, san, white, draws, black, averageRating }], topGames: [{ id, winner, white: { name, rating }, black: {…}, year, month }], opening: { eco, name } | null }`. **verify** with a signed-in answer.

## Tasks

1. **`LichessCore`**: `explorerUrl(fen, { db, ratings, speeds })`, `explorerKey`, `parseExplorer`, `explorer(fen, opts, { signal, token })` on the shared client (own gate `explorer`, cache keyed by position and filters, not by token). A 401 → `{ auth: true }` (not cached); a 429 backs off as the others. Token sent as `Authorization: Bearer`. Tests with a fake fetch and a fixture: parse, token header only when given, 401, filters change the key, 429.
2. **Sign-in** (`app/explorer.jsx`): `useLichessAuth()`: OAuth2 code + PKCE against `https://lichess.org/oauth` and `https://lichess.org/api/token` (client id `chess-replay`, no scope, redirect = the page's folder); pasted personal token fallback; token in localStorage `chess-video.lichess-auth.v1` (kept by Clear saved data like the HF one); state prefixed `lichess.` so the HF handler ignores it; Sign out; hidden/disabled sign-in on iframes as HF's.
3. **Panel**: `useExplorer(boardFen, settings)` (debounced, like `useTablebase`) and `LichessExplorer` in the Commentary box on the free board (replay view stays on the local book), at more than 7 pieces or tablebase off; moves with game counts and a white/draw/black bar, click plays; name and ECO from the answer, local book as fallback and default when off; states: loading, sign in, not available.
4. **Settings › Online**: Lichess opening explorer toggle (default off), Database (Lichess, Masters), Rating (all, 1600+, 2000+, 2200+), Speed (all, rapid and slower, blitz and slower), sign-in / Sign out / paste token. `TWEAK_DEFAULTS`: `explorer: false`, `explorerDb: 'Lichess'`, `explorerRating: 'All'`, `explorerSpeed: 'All'`.
5. **Plumbing**: `explorer.lichess.ovh` in the CSP `connect-src` (`build.cjs`), not in `sw.js`'s `KEEP_HOSTS`, README "Lichess data" note, redirect URL note in README, CLAUDE.md gotcha, spec Built section, live test with a Playwright route faking the explorer and the token endpoint.
