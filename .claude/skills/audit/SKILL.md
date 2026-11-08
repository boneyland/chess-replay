---
name: audit
description: How to audit the whole chess-replay repo (or a large part of it) the same thorough way every time - one subagent per area reading its files in full, every finding checked against the code before it's reported, a coverage table, and a dated report with a fix plan that later sessions resume from. Use whenever the user asks to audit, review or sweep the whole repo, the codebase, all of app/, or "everything" for bugs, security, tech debt, test gaps or docs drift, even if they don't say "audit". Not for reviewing one diff or PR (that's /code-review).
---

# Auditing chess-replay

An audit is read-only. It finds and reports; it fixes nothing. Fixes come afterwards, chosen by the user, as ordinary
changes (app changes on a `claude/<topic>` branch with a PR, per CLAUDE.md), following the report's Fix plan.

**Cost:** the 2026-11-05 debt audit (6 agents, ~10,000 lines of source) took about 1.1 million subagent tokens, 3-6
minutes per agent. An audit of all five kinds costs more than one kind; with the user's usage in mind, say so when the
scope is "everything" and offer one kind at a time.

## 1. Settle the scope
Kinds of audit (the user may name one or several; with none named, do all of them):
- **correctness**: bugs, wrong edge cases, races, unhandled failures, state that can go stale
- **security**: CSP and headers, OAuth (HF, Lichess PKCE), tokens and localStorage, pinned hashes, workers, `fetch` targets, file input
- **debt**: duplication (above all copies that have already drifted apart), dead code, overgrown functions, inconsistent patterns, hand-synced lists
- **tests**: behaviour in the cores and views that no test exercises
- **docs**: CLAUDE.md, the spec (`docs/spec.md`, `docs/spec/`, `docs/roadmap.md`, `docs/known-gaps.md`, `docs/decisions.md`), LAYOUT.md and README saying something the code no longer does

Say the scope in one line and go on; ask only when the request is genuinely unclear. Read the newest report in
`docs/audits/` first, if there is one: its open findings and Fix plan feed step 5's "Since the last audit".

## 2. Split the repo into areas
List the tracked files (`git ls-files`) with their line counts. Leave out data and third-party files, whose pins are
checked in area 5 instead: `vendor/`, `vision/`, `openings/`, `babel/`, `media/`, `tests/fixtures/`, `tests/out/`,
`app/icons/`, `app/og-image.png`, `app/sample-analysis.js`, `src/pieces.js`, `src/pieces/`, `Cargo.lock`, `LICENSE`.
Leave out `docs/` and `tests/` unless docs or tests are in scope (agents still read them for cross-checks).

Give **every remaining file to exactly one area**. The usual split, which new files join by what they do:

1. **Rules and records**: `chess-core`, `play-core`, `board-core`, `edit-core`, `dead-core` (+ `dead-worker.js`), `dead.jsx`, `games-core`, `import-core`, `openings-core`, `openings-data.cjs`, `src/game-data.js`, `src/sample-game.js`
2. **Analysis and engines**: `analysis-core`, `stockfish.jsx`, `sf-*`, `queen*`, `lichess-core`, `explorer.jsx`, `tablebase.jsx`
3. **Views**, in two parts, because together they are ~5,000 lines:
   - 3a **replay**: `game-video-core`, `game-app`, `engine.jsx`
   - 3b **boards, layout, shell**: `free-board`, `edit-board`, `layout-core`, `shell.html`, `tweaks`, `drag-scroll`, `board-themes`, `piece-sets`
4. **Export, vision, sound**: `export*`, `webp*`, `vision*`, `kept-files`, `draw-core`, `sfx-core`, `sfx.jsx`
5. **Build, deploy, offline**: `build.cjs`, `render.yaml`, `sw.js`, `.github/`, `tools/`, `tests/live/serve.cjs`, `.gitignore`, `.gitattributes`, the CSP, the pins in LAYOUT.md against the files
6. **Tests**: `tests/` itself, judged against areas 1-5 (only when tests are in scope)

Keep each area under about 3,000 lines: an agent reading more than that runs out of room and skims the end. Split a
larger area by what its files do, as 3 is split. Write the file-to-area table down before starting: it becomes the
report's coverage table.

## 3. One subagent per area, in parallel
Use `general-purpose` agents, not `Explore` (Explore reads excerpts, and bugs hide in the middle of long functions),
launched together in the background. Brief each one from [agent-brief.md](agent-brief.md): fill in the area, its files and
the kinds in scope, and add the area's key questions (the brief lists the ones that paid off before). The brief carries
the read-only rule, the context to read first (CLAUDE.md's Gotchas and Workflow, the spec's decisions log, so recorded
decisions aren't reported as faults) and the finding format.

Severity, the same for every kind:
- **high**: a viewer loses data, sees a wrong result or is exposed **now**, or copies have **already** drifted, or a
  common change is error-prone today. Something that caused a bug in the past but shows no drift now is medium
- **medium**: a real bug with a narrow trigger, or debt that already costs
- **low**: everything else worth knowing

## 4. Check, merge, and keep what's out of scope
As each agent reports, check its findings while the others run:
- **Check** every high and medium finding: open the cited lines (a `grep`/`sed` batch per agent is enough) and confirm
  the scenario happens: the guard isn't elsewhere, the caller can really pass that value. Drop what doesn't hold, move
  what's overstated to its proper severity, and count both. Low findings may go in unchecked, marked so.
- **Merge** findings that several areas reported (the same copied code seen from each copy's side): keep one, with the
  locations from all, and note "reported by N areas". Findings reported several times are usually the most important.
- **Keep bugs found by accident.** A debt audit that turns up a crash keeps it, labelled with its real kind
  (`[debt→bug]` or `[bug]`), usually high. Never drop a real defect for being out of scope.

If a quick check needs code to run (a unit-level `node -e` on a core), run it alone and bounded; never a browser.

## 5. Write the report
Path: `docs/audits/YYYY-MM-DD-<kinds>.md` (e.g. `2026-11-05-all.md`). Template:

```
# Audit YYYY-MM-DD: <kinds>
Commit: <short sha> · Areas: <n> · Findings: <high>/<medium>/<low> · Dropped on checking: <n> (<n> moved; <n> duplicates merged)

## Summary
Three to five sentences: the state of the code, the few things that matter most, any bugs found.

## Fix plan
Not started (date). Each item is one PR on a `claude/<topic>` branch (they change the page; see CLAUDE.md's Workflow),
in this order. Line numbers are at commit <sha>: find the code by the quoted evidence if they have moved. Tick an item
here, with its PR, when it merges.

- [ ] 1. **<bugs first>**: …
- [ ] 2. …
(4-7 items, each naming the findings it covers; the largest refactors last)

The rest can ride along with the PR that touches the same file, or wait for the next audit.

## Since the last audit
(only if an earlier report exists in docs/audits/) Its findings and Fix plan items: fixed / still open / no longer applies.

## Findings
### High
### Medium
### Low
(each in the finding format, its `file:line` as a link relative to docs/audits/, e.g.
[app/x.js:12](../../app/x.js#L12); mediums and lows grouped under the area names)

## Coverage
| Area | Files | Read in full | Not covered |

## Not checked
What this audit couldn't see: runtime behaviour, other browsers, anything skipped and why; which findings are read from
the code and not reproduced.
```

Commit the report straight to `main` only when the user asks (it's docs). Then, in chat: the summary, the high findings,
and the Fix plan's first item as the question of what to fix first.
