---
name: audit
description: How to audit the whole chess-replay repo (or a large part of it) the same thorough way every time - one subagent per area reading its files in full, every finding checked against the code before it's reported, a coverage table, and a dated report comparable with earlier audits. Use whenever the user asks to audit, review or sweep the whole repo, the codebase, all of app/, or "everything" for bugs, security, tech debt, test gaps or docs drift, even if they don't say "audit". Not for reviewing one diff or PR (that's /code-review).
---

# Auditing chess-replay

An audit is read-only. It finds and reports; it fixes nothing. Fixes come afterwards, chosen by the user, as ordinary
changes (app changes on a `claude/<topic>` branch with a PR, per CLAUDE.md).

## 1. Settle the scope
Kinds of audit (the user may name one or several; with none named, do all of them):
- **correctness**: bugs, wrong edge cases, races, unhandled failures, state that can go stale
- **security**: CSP and headers, OAuth (HF, Lichess PKCE), tokens and localStorage, pinned hashes, workers, `fetch` targets, file input
- **debt**: duplication, dead code, overgrown functions, inconsistent patterns
- **tests**: behaviour in the cores and views that no test exercises
- **docs**: CLAUDE.md, `docs/spec.md`, LAYOUT.md and README saying something the code no longer does

Say the scope in one line and go on; ask only when the request is genuinely unclear.

## 2. Split the repo into areas
List the tracked files (`git ls-files`), leave out `vendor/`, `vision/`, `openings/`, `tests/fixtures/`, `media/` and
`tests/out/` (data and third-party code: only check their pins), and give **every remaining file to exactly one area**.
The usual split, which new files join by what they do:

1. **Rules and records**: `chess-core`, `play-core`, `board-core`, `edit-core`, `dead-core` (+ `dead-worker.js`), `games-core`, `import-core`, openings code
2. **Analysis and engines**: `analysis-core`, `stockfish.jsx`, `sf-*`, `queen*`, `lichess-core`, `explorer.jsx`, tablebase code
3. **Views and layout**: `game-app`, `game-video-core`, `free-board`, `edit-board`, `engine.jsx`, `layout-core`, `shell.html`, settings and menus
4. **Export and vision**: `export*`, `webp*`, `vision*`, `kept-files`, `draw-core`, `sfx-core`
5. **Build, deploy, offline**: `build.cjs`, `render.yaml`, `sw.js`, `.github/`, `tools/`, the CSP, the pins in LAYOUT.md against the files
6. **Tests**: `tests/` itself, judged against areas 1-5 (only when tests are in scope)

Write the file-to-area table down before starting: it becomes the report's coverage table.

## 3. One subagent per area, in parallel
Use `general-purpose` agents, not `Explore` (Explore reads excerpts, and bugs hide in the middle of long functions).
Give each agent:
- its file list, to be **read in full**, and the audit kinds in scope
- the "Gotchas" and "Workflow" sections of CLAUDE.md and the decisions log at the end of `docs/spec.md`, because they
  record deliberate choices that look like bugs out of context (no `'unsafe-inline'`, the long one-line statements, `ios`
  failing on purpose, Lichess's explorer shape being unverified). A finding against a recorded decision is reported only
  when the code contradicts the decision, not because the decision seems odd
- the rule to stay read-only: no edits, no browsers, no live tests, no builds. This laptop freezes under memory pressure
  (see the global CLAUDE.md); reading files is safe, launching things in parallel is not
- the answer format below, and the instruction to list any file it could not read in full

Each finding comes back as:
```
- [severity: high|medium|low] [kind] file:line - one-sentence defect
  evidence: the code (quoted, a few lines) and why it's wrong
  scenario: concrete input or state -> wrong result
  fix: one line, optional
  confidence: sure | likely | unsure
```
High = a viewer loses data, sees a wrong result, or is exposed; medium = a real bug with a narrow trigger, or debt that
already costs; low = everything else worth knowing.

## 4. Check every finding before it's reported
Agents overreport. For each high and medium finding, open the cited lines yourself (or give a batch to one verifier
agent) and confirm the scenario actually happens: the guard isn't elsewhere, the caller can really pass that value.
Drop what doesn't hold, and say how many were dropped. Low findings may go in unchecked, marked so.

If a quick check needs code to run (a unit-level `node -e` on a core), run it alone and bounded; never a browser.

## 5. Write the report
Path: `docs/audits/YYYY-MM-DD-<kinds>.md` (e.g. `2026-11-05-all.md`). Template:

```
# Audit YYYY-MM-DD: <kinds>
Commit: <short sha> · Areas: <n> · Findings: <high>/<medium>/<low> · Dropped on checking: <n>

## Summary
Three to five sentences: the state of the code, the few things that matter most.

## Since the last audit
(only if an earlier report exists in docs/audits/) Its findings: fixed / still open / no longer applies.

## Findings
### High
### Medium
### Low
(each in the finding format above, `file:line` as links)

## Coverage
| Area | Files | Read in full | Not covered |

## Not checked
What this audit couldn't see: runtime behaviour, other browsers, anything skipped and why.
```

Commit the report straight to `main` only when the user asks (it's docs). Then, in chat: the summary, the high findings,
and a question about which to fix first, grouped into fixes that would each make one PR.
