---
name: learn-taste
description: Turn the user's corrections in a chess-replay session (design, wording, layout, how to work) into written rules with their reason, in the place this repo keeps that kind of rule (ui-text, CLAUDE.md, docs/decisions.md, docs/spec/, a test). Proposes, then writes only what the user approves.
disable-model-invocation: true
---

# Learning taste

Adapted for chess-replay from Emil Kowalski's `learn-taste` skill (github.com/emilkowalski/skills, MIT, copied 2026-11-16). The original writes everything to a DESIGN.md. This repo already has a home for each kind of rule, so the rules go there.

Every correction the user makes is taste the agent didn't have. If it isn't written down, the next session makes the same mistake and the user corrects it again. This skill finds those corrections, turns each into a rule with its reason, and writes it where the next agent will read it.

It does ONE thing: write rules. It never changes the page's code, and it never adds a rule the user didn't express.

## Hard Rules

1. **Only the user's taste.** Every rule traces back to something the user said, edited or confirmed. Never add a rule because it seems like good practice: that's your taste, and your taste is what the user was correcting.
2. **Never invent a why.** If the user gave no reason, propose one marked *inferred* and get it confirmed before writing. A wrong why is worse than none: the next agent extends the reasoning to cases it doesn't fit.
3. **Propose, then stop.** Present every candidate and write only what the user approves.
4. **A test beats a sentence.** If a violation can be found by matching code (a banned value, a word the page must not use, a colour outside `app/theme.js`), propose a test. This repo has no linter; a test is a Node test in `tests/*.test.cjs`, or a step in `tests/live/` when only a browser can see it. A sentence in a long file gets skipped when the agent's context is full.
5. **Write for an agent that wasn't here.** No "like we discussed" or "the button from earlier". Name the part (by `docs/parts.md`'s names: Game info, Transport bar, Dock…), the value, the token in `app/theme.js`, the file.

## Workflow

### Phase 1: Collect corrections

Read the current conversation from the first turn. If the user names earlier sessions, read their transcripts too: they're the JSONL files in `~/.claude/projects/-home-yh-projects-chess-replay/`. Also read the review comments on the PRs the user names (`gh pr view <n> --comments`; `gh` needs the sandbox disabled here).

Explicit corrections are the minority. Look for all five signals:

| Signal | Example | What it tells you |
| --- | --- | --- |
| Explicit correction | "No, the eval bar goes on the left" | The rule, often with the why |
| Silent edit | The user changed a value in a file you wrote | Your default was wrong, and their value is the rule. Find these from notices that a file changed outside your edits, or by diffing against what you last wrote |
| Repeated nudge | "Smaller." → "Still too big." → "Ok" | Record where they landed, not the steps |
| Revert or rejection | "Undo that", closing a PR, picking option B | What not to do. The why is usually missing, so it goes to Phase 3's questions |
| Confirmed non-obvious choice | "Yes, keep Take back next to Resign" | Record it only if a fresh agent would plausibly do otherwise |

For each one, capture the user's exact words (or the diff), what you had done, what they wanted instead, and any reason they gave.

Skip what isn't taste: functional bugs, content specific to one string or screen, and corrections to your understanding of the task.

**Completion criterion:** every turn has been read, and every correction is listed with its source quote or diff.

### Phase 2: Filter

```
Would a fresh agent working on a DIFFERENT part of this page make the same mistake?
├── No (a one-off) → Skipped
└── Yes
    ├── Does an existing rule cover it? Check CLAUDE.md, .claude/skills/*, docs/decisions.md, docs/spec/.
    │   ├── Yes, and it says the same → the rule failed. Rewrite it stricter (a number, a name, "never")
    │   │   instead of adding a duplicate.
    │   ├── Yes, and it contradicts → Conflict. Show both; the user picks.
    │   └── No → continue
    ├── Can a violation be found by matching code? → Test candidate, plus a one-line rule so the why
    │   is recorded somewhere.
    └── Did the user say it applies to all their projects? → it goes in ~/.claude/CLAUDE.md; ask first.
        Otherwise it's a rule for this repo.
```

Rules for this repo go in the repo, not in the auto-memory folder: the repo is what other sessions, cloud machines and the user read.

**Completion criterion:** every correction ends as Skipped, Rewrite, Conflict, Test candidate, or a rule to place.

### Phase 3: Generalize and find the why

Pick the narrowest level that would have prevented the mistake on the next, different part:

| Level | Example | Verdict |
| --- | --- | --- |
| Instance | "Export video's button says Export, not Start" | Too narrow |
| Class | "A dialog's main button names its action (Export video, Read board), never Start / OK / Submit" | Write this |
| Universal | "Never use generic words" | Too broad |

If the same correction came up on two different parts, that's evidence for the class level. If two levels both seem right, ask.

Write the rule strictly: real values, part names and theme tokens, "always" or "never", no "prefer" or "try to". Use softer words only when the user framed it as a preference.

Then the why. Use the user's reason, in their words, when they gave one. Otherwise write your best candidate, mark it *inferred*, and put it in the questions.

**Self-test before proposing:** read only the rule and its why, then picture the original task. Would an agent that knows nothing else produce what the user wanted? If not, add the value, the name or the exception.

**Completion criterion:** every kept rule has a level and a why marked as the user's or *inferred*.

### Phase 4: Decide where it goes

| Kind of rule | Where |
| --- | --- |
| Words the page shows or announces: labels, messages, aria-labels, progress lines, confirmations | `.claude/skills/ui-text/SKILL.md`, under its matching section |
| How a change is checked: browsers, sizes, screenshots, input | `.claude/skills/verify/SKILL.md` |
| Phone and touch behaviour | `.claude/skills/mobile-native/SKILL.md`, its table or rules |
| How agents work in this repo: workflow, gotchas, commands | `CLAUDE.md`, under the matching heading |
| A product decision with its reason ("no Game info during a game") | A new entry at the end of `docs/decisions.md`, in its format (`- YYYY-MM-DD: …`, "(the user's decision)" where it was), and the area's file in `docs/spec/` if it changes what's built |
| Layout, sizes, spacing | `docs/spec/layout.md` (and `LayoutCore`'s constants if a value is a number) |
| Colours | `app/theme.js` is the source; a rule about using them goes in CLAUDE.md › Gotchas |
| Visual and motion taste with no home above (shadows, timings, borders) | Ask the user. If they want a DESIGN.md, create it at the repo root and add `Before changing how the page looks, read DESIGN.md.` to CLAUDE.md |
| A test candidate | `tests/<area>.test.cjs` (pure code) or `tests/live/site.test.cjs` (needs a browser), plus the one-line rule above |

Keep each entry in the style of the file it goes into: CLAUDE.md and the skills use bullet points with the reason in the same line, and the decisions log keeps one line per decision with its date.

### Phase 5: Report and stop

Present the report below, then stop.

### Phase 6: Write on approval

Write only the approved items, and show the diff. For a test, write it and run it (`node --test --test-concurrency=1 tests/<file>.test.cjs`). If it fails on existing code, report what it flags and ask whether to fix the code or loosen the test: never fix the page's code from this skill.

Skill, docs, CLAUDE.md and tests-only changes are committed straight to `main` (no branch or PR), and only when the user asks. `.claude/skills/` is write-protected in the Bash sandbox: write there with the Edit and Write tools, or copy from the scratchpad with the sandbox disabled.

## Required Output Format

### Rules to add

| # | You said | Rule | Why | Where |
| --- | --- | --- | --- | --- |
| 1 | "never OK / Cancel" | A confirmation's buttons name their actions (Remove / Keep) | So the viewer knows what each does without reading the question again | ui-text › The page's conventions |
| 2 | Changed the Moves panel's row height from 28 to 24 | Moves rows are 24 px | *inferred:* more moves fit on a phone | docs/spec/layout.md |

### Needs your answer

Each *inferred* why, each unclear level, each this-repo-or-all-projects question. One line each, with your recommendation.

### Conflicts

The existing rule, the new correction, and which one you'd keep.

### Make it a test

Each test candidate with its code, and what it would flag in the current code.

### Skipped

One line per skipped correction and why, so the user can override.

Close with: "Say `write all` or `write 1, 3`, and answer the questions above."

If the session had no corrections, say so in one line. That's a good result, not a failure.

## Invocation Variants

| Invocation | Behavior |
| --- | --- |
| `/learn-taste` | Current session, full workflow, stop at the report |
| `/learn-taste <sessions or PRs>` | Also read the named or most recent N transcripts, or the PRs' review comments |
| `write all` / `write 1, 3` | Write the approved items from the last report |
| `/learn-taste prune` | Read ui-text, verify, mobile-native and CLAUDE.md, and propose merges for duplicates, fixes for contradictions and stricter wording for vague rules. Same propose-then-stop rule |
