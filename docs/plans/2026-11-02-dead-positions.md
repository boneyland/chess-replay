# Dead Positions with chasolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove dead positions with chasolver (Rust → WebAssembly, in a Worker): a game ends as a draw when neither side can mate, a flag fall is a draw when the opponent can't, and loaded games and the free board point dead positions out.

**Architecture:** A tiny C-ABI wrapper crate builds `vendor/chasolver.wasm` (committed, SHA-256 pinned). `app/dead-worker.js` runs it off the main thread; `DeadCore` (`app/dead-core.js`, pure) keys and caches answers and drives the worker with a timeout and a memory-based restart. `PlayCore` gets a synchronous *prover* hook (`setProver`) that reads that cache, so `outcome` and `flag` stay pure and synchronous; when an answer lands late, `PlayCore.recheck` ends the game. `app/dead.jsx` holds the React hooks and the UI pieces (DEAD eval-bar tag, the Analysis block, the Moves pill).

**Tech Stack:** Rust 1.99.1 + `wasm32-unknown-unknown`, chasolver 3.0.0 (MIT), plain JS units + JSX precompiled by `build.cjs`, `node --test`, Playwright live tests.

**Spec:** `docs/spec.md` › Roadmap › "Dead positions with chasolver (designed 2026-11-02)"

## Global Constraints

- chasolver pinned `=3.0.0`, `Cargo.lock` committed; profile `lto = true`, `panic = "abort"`, `strip = true`, `opt-level = 3`, `codegen-units = 1`; no wasm-bindgen, no imports.
- `vendor/chasolver.wasm` committed, sha256 in LAYOUT.md with build command and Rust version; Render's build never runs Rust.
- Answers: `unwinnable`, `winnable`, `undecided`. Undecided (or no answer) never ends, shows or marks anything.
- `canMate`/`lockedDead` stay as the instant first check.
- Search timeout 5 s → Worker terminated, answer `undecided`. Worker restarted after an answer with memory past 64 MB.
- Never during the playing video or its export; nothing shown during a game until it ends.
- Copy, exact: block heading `Dead position · ½–½`, its note `Neither side can mate by any series of legal moves (FIDE 5.2.2)`; one side `White can no longer win` / note `No series of legal moves lets White mate. Black still can.` (Black mirrored); eval tag `DEAD`; Moves pill `DEAD`; game end `Draw: dead position, neither side can mate`.
- Module loads on first use (a game's first move, a game loaded in the replay, the free board's position), never at page load.
- Changes to the app go on branch `claude/dead-positions`, small commits, PR against `main`.

## Review Focus

1. A FEN the `chess` crate refuses (odd en passant square, an Edit-position setup with too many pieces): expect `undecided`, never a crash or a hang — test in Task 1 and Task 2.
2. The player moves (or Stockfish replies) before the answer for the previous position arrives: the game still ends dead on the current position — test in Task 3 (`recheck` after a later move).
3. Offline before the wasm was ever kept, or the Worker failing to start: the game plays on with `canMate`/`lockedDead`, no error screen — test in Task 2 (client with a failing worker answers `undecided`).
4. A stored game resumed from My games whose last position is dead but was saved before this feature: ends as soon as the answer arrives — covered by Task 5's live recheck on resume (`runClock` path calls the same effect).
5. Stepping fast through a long loaded game: one search at a time, stale answers dropped, no queue build-up — test in Task 2 (the client cancels queued asks for positions no longer wanted via `ask(..., { signal })`).

---

### Task 1: The wasm module

**Files:**
- Create: `tools/chasolver-wasm/Cargo.toml`, `tools/chasolver-wasm/Cargo.lock`, `tools/chasolver-wasm/src/lib.rs`, `tools/chasolver-wasm/build.sh`
- Create: `vendor/chasolver.wasm`, `vendor/chasolver.LICENSE` (chasolver's MIT text)
- Modify: `LAYOUT.md` (vendor list), `README.md` (licences), `.gitignore` (`tools/chasolver-wasm/target/`)
- Test: `tests/chasolver.test.cjs`

**Interfaces:**
- Produces (wasm exports): `memory`; `buf() -> *mut u8` (256-byte FEN buffer); `solve(len: u32, winner: u32 /*0 white, 1 black*/) -> u32` with `0` unwinnable, `1` winnable, `2` undecided, `3` FEN refused.

- [ ] **Step 1:** Write `tests/chasolver.test.cjs`: instantiate `vendor/chasolver.wasm` with `{}` imports; helper `solve(fen, side)`; assert:
  - `8/8/8/8/8/8/8/K1k5 w - - 0 1` both sides → 0
  - start position both sides → 1
  - `-- 2b1k3/8/8/1p1p1p1p/1P1P1P1P/8/8/2B1K3 w - -` both → 0; `W- Bb1k1b2/bKp1p1p1/1pP1P1P1/pP6/6P1/P7/8/8 w - -` white → 1, black → 0 (from chasolver's `tests/positions.txt`)
  - a KN v KP position, the knight side → 0, the pawn side → 1 (e.g. `8/8/8/4k3/8/8/4p3/4K1N1 w - - 0 1`: confirm with the analyzer example before pinning)
  - `"garbage"` → 3; a 300-char string → 3 (length over the buffer)
  - sha256 of `vendor/chasolver.wasm` equals the one in LAYOUT.md (regex on the `chasolver.wasm` line)
- [ ] **Step 2:** Run `node --test tests/chasolver.test.cjs` → FAIL (file missing).
- [ ] **Step 3:** Write the crate: `#[no_mangle] extern "C"` `buf`/`solve`; parse with `chess::Board::from_str` (error → 3), `chasolver::winnability` (`None` → 2). `build.sh`: `cargo build --release --target wasm32-unknown-unknown` with `CARGO_HOME` overridable, copy to `vendor/chasolver.wasm`, print sha256. Build, then write LAYOUT.md's entry (size, sha256, `rustc --version`, the command) and README's licence line.
- [ ] **Step 4:** Run the test → PASS. Also run the whole of chasolver's `tests/lichess.txt` once through a scratch script (not committed) to confirm agreement, as on 2026-11-02.
- [ ] **Step 5:** Commit `Vendor chasolver 3.0.0 built to WebAssembly`.

### Task 2: Worker and DeadCore

**Files:**
- Create: `app/dead-worker.js`, `app/dead-core.js`
- Modify: `build.cjs` (`dead-core.js` unit after `play-core.js`; `chasolver.wasm` in `VENDOR`; copy `app/dead-worker.js` to the site and add it to `SW_LOCAL`)
- Test: `tests/dead-core.test.cjs`, `tests/build.test.cjs` (worker and wasm in `out/site`)

**Interfaces:**
- Worker protocol: in `{ id, fen, side }` (`side` `'w'|'b'`); out `{ id, verdict: 'unwinnable'|'winnable'|'undecided', mb }` (`mb` the module's memory in MB). It fetches `chasolver.wasm` from its own folder on first message.
- `DeadCore.key(fen) -> string`: board, side to move, castling, en passant (first four FEN fields).
- `DeadCore.create({ makeWorker, timeoutMs = 5000, memLimitMb = 64 }) -> client` with
  - `client.ask(fen, side, { signal } = {}) -> Promise<verdict>` (one search at a time, FIFO; an aborted queued ask resolves `undecided` without being sent; a cached answer resolves at once; worker error or timeout → `undecided`, worker terminated and recreated on the next ask)
  - `client.cached(fen, side) -> verdict | undefined` (synchronous)
  - `client.both(fen, opts) -> Promise<{ w, b }>`
- `DeadCore.firstDead(fens, client, { signal }) -> Promise<number | null>`: index of the first FEN with both sides `unwinnable`, asking in order, stopping there.

- [ ] **Step 1:** Write tests with a fake worker (a function returning an object whose `postMessage` answers from a table, optionally after a delay or never): key ignores the move counters; cache hit sends nothing; FIFO one at a time; a never-answering worker gives `undecided` after `timeoutMs` (use 50 ms) and is terminated; `mb: 65` terminates after answering; aborted queued ask sends nothing; `makeWorker` throwing → `undecided`; `firstDead` stops at the first dead index and returns null when none. One integration test runs `app/dead-worker.js` under `worker_threads` with a `self`/`fetch` shim reading `vendor/chasolver.wasm`, and checks K v K → `unwinnable`.
- [ ] **Step 2:** Run `node --test tests/dead-core.test.cjs` → FAIL.
- [ ] **Step 3:** Implement both files and the `build.cjs` changes. The worker writes the FEN's UTF-8 bytes into `buf()`, answers code 3 as `undecided`.
- [ ] **Step 4:** Run `node --test --test-concurrency=1 tests/*.test.cjs` → all PASS.
- [ ] **Step 5:** Commit `DeadCore and the chasolver worker`.

### Task 3: PlayCore asks the prover

**Files:**
- Modify: `app/play-core.js` (`outcome`, `flag`, `resultText`, new `setProver`, `recheck`)
- Test: `tests/play-core.test.cjs`

**Interfaces:**
- `PlayCore.setProver(fn | null)`; `fn(pos, color) -> true (unwinnable) | false | null (unknown)`, synchronous.
- `outcome`: after the `canMate`/`lockedDead` checks, `draw('dead')` when the prover says `true` for both colours.
- `flag(b, now)`: the draw when `!canMate(pos, opp) || prover(pos, opp) === true`.
- `PlayCore.recheck(b, now) -> board`: in a game in progress, when `outcome(b, claims(b))` gives a result, the game ends with it and its clock charged to `now` and stopped; else `b` unchanged.
- `resultText` for `dead`: `Draw: dead position, neither side can mate`.

- [ ] **Step 1:** Tests (prover a stub keyed by FEN): a knights-and-pawns lock the stub calls dead ends the move that reaches it with reason `dead`; prover `null` plays on; prover dead for one side only plays on; flag with opponent `true` → `1/2-1/2`, with `false`/`null` and mating material → loss; `recheck` ends a game whose last position became dead after a later move; `recheck` leaves a finished game and a live game with no proof alone; `setProver(null)` restores today's behaviour; the new `resultText`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run all JS tests → PASS.
- [ ] **Step 5:** Commit `PlayCore: dead positions and flag falls from a prover`.

### Task 4: The page hooks and UI pieces

**Files:**
- Create: `app/dead.jsx`
- Modify: `build.cjs` (concatenate `dead.jsx` after `tablebase.jsx` in the `game-video.jsx` unit)

**Interfaces:**
- `DEAD`: the page's one client, `DeadCore.create({ makeWorker: () => new Worker('dead-worker.js') })`, created lazily on first use; it installs `PlayCore.setProver((pos, c) => verdict === 'unwinnable' ? true : verdict === 'winnable' ? false : null)` from `cached(ChessCore.toFen(pos), c)`.
- `useDead(fen) -> null | { w, b }` (verdicts so far; null when `fen` is null). Asks both sides, aborting on change.
- `useFirstDead(M, on) -> number | null`: the ply index after which the game's position is first dead (FENs from `ChessCore.fenAfter` per ply), cached per game.
- `deadBar(d) -> null | { cp: 0, txt: 'DEAD' }` (both unwinnable).
- `DeadBlock({ d })`: renders the dead block, the one-side block, or nothing; styled like `TablebaseBlock`'s heading row (`MONO`, uppercase, `C.dim` label).
- `DeadPill()`: the Moves list pill.

- [ ] **Step 1:** Implement; `node build.cjs` builds with no Babel error.
- [ ] **Step 2:** Commit `Dead positions: hooks, eval tag, block and pill`.

### Task 5: Wire it into games, the free board and the replay

**Files:**
- Modify: `app/free-board.jsx` (in a game: `useDead` on the last position, `onChange(P.recheck(board, Date.now()))` when an answer changes it; outside a game: `deadBar` before `tbv`, `DeadBlock` in its Analysis panel)
- Modify: `app/game-video-core.jsx` (`EvalBar` takes `dead` before `tb`; `Analysis` renders `DeadBlock` above the Tablebase block; `MoveList` takes `deadAt` and puts the pill after that ply's chip; `GameVideo` calls `useDead(playing ? null : shownFen())` and `useFirstDead(M, true)`)
- Modify: `docs/spec.md` (move the section to Built), `CLAUDE.md` (a Gotchas line)
- Test: `tests/live/site.test.cjs`

- [ ] **Step 1:** Live tests (read the `browser-tests` skill first):
  - a Play vs human game from a setup (Edit position) one capture from a dead lock that only chasolver proves (pick from chasolver's `positions.txt`, `--` class, with knights or rooks): after the capture the result text reads `Draw: dead position, neither side can mate`;
  - a loaded PGN reaching a dead position: the Moves list shows a `DEAD` pill on that move; stepped there and paused, the eval bar reads `DEAD` and the Analysis panel `Dead position · ½–½`;
  - free board with KN v KP: `White can no longer win` (or Black, per the setup);
  - playing the replay: no `DEAD` tag or block while it plays.
- [ ] **Step 2:** Run them (sandbox disabled, `node tests/live/serve.cjs` serving) → FAIL. **Step 3:** Wire it. **Step 4:** Run JS tests and the live tests → PASS.
- [ ] **Step 5:** Screenshots desktop 1440×900 and phone 390×844 (Chromium and Firefox) of the block, tag and pill; show the paths.
- [ ] **Step 6:** Commit, push `claude/dead-positions`, open the PR with the screenshots (`pr-screenshots` skill) — push and PR only on the user's go-ahead.
