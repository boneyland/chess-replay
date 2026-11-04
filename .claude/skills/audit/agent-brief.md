# Agent brief

Fill in the `<…>` parts and add the area's key questions. Everything else stays as written.

```
You are one of <n> agents doing a read-only <KINDS> audit of the chess-replay repo at /home/yh/projects/chess-replay (a
browser chess replay app; plain JS/JSX loaded by Babel in the page, no bundler, React from a CDN).

Your area: "<area name>". Read EACH of these files IN FULL, every line (read long files in chunks with offset/limit),
and note any part you could not read:
<file list>

First read for context: the "Workflow" and "Gotchas" sections of /home/yh/projects/chess-replay/CLAUDE.md, and the
"## Decisions log" section of /home/yh/projects/chess-replay/docs/spec.md to its end. Read them with the Read tool,
not grep or sed: some entries are longer than a shell output line and get cut. They record deliberate choices. Don't
report a recorded decision as a fault; report only where the code contradicts it (that contradiction is worth
reporting). The long one-line statements (some over 200 characters) are known, recorded debt: don't list them one by
one; mention them at most once.

What to look for (<KINDS>):
<for debt:> duplication within your files AND against the rest of app/ (grep app/ to check), above all copies that have
already drifted apart; dead code (grep the whole repo, tests/ and app/shell.html included, before claiming something is
unused); overgrown functions or components (say which jobs and roughly how many lines); state held in two places;
inconsistent patterns (the same thing done two ways); lists or constants kept in step by hand; stale compatibility
code and stale comments.
<for correctness / security / tests / docs: the matching line from the skill's step 1>
If you find a real bug outside these kinds, report it anyway, labelled with its real kind.

Key questions for your area:
<area questions>

Rules: READ-ONLY. No edits, no builds, no browsers, no test runs, no installs, no network. This laptop freezes under
memory pressure; reading, grepping and sha256sum are fine, launching things is not.

Return ONLY a findings list, most important first, each as:
- [severity: high|medium|low] [kind] file:line - one-sentence defect
  evidence: the code (quoted, a few lines) and why it's wrong
  scenario: concrete input or state -> wrong result, or what it costs (e.g. "a change must be made in X and Y; they
  already differ in Z")
  fix: one line, optional
  confidence: sure | likely | unsure
Severity: high = wrong or exposed now, copies already drifted, or a common change error-prone today (a past bug with no
drift now is medium); medium = a real bug with a narrow trigger, or debt that already costs; low = worth knowing.
Be selective: 5-15 solid findings beat 40 weak ones. Also list what you checked and found in order, in one line. End
with a "Files read in full:" line and a "Not read in full:" line.
```

## Key questions that paid off (2026-11-05)
- **Views (3a/3b)**: logic copied between GameVideo, FreeBoard and EditBoard (player bars, move chips, keydown
  guards, pointer input); sizes not going through `tx()`/`L`, squares not through `view()`; LayoutCore and the views
  computing the same size twice; CSS in shell.html that is dead, duplicated, or redoes what LayoutCore computes.
- **Rules and records (1)**: rules and formats written twice (FEN reading, PGN writing, clocks, castling tables, move
  numbers outside `ChessCore.moveNo`).
- **Analysis and engines (2)**: the mate-score and win-chance constants against `AnalysisCore.C`; the HF and Lichess
  OAuth helpers; error codes nothing produces any more.
- **Export, vision, sound (4)**: does export drawing duplicate the live board's (it didn't: it walks the DOM); do Full
  Stockfish and vision use KeptFiles the same way; constants that tests check but the code doesn't read.
- **Build, deploy, offline (5)**: every list kept in step by hand (VENDOR, SW_LOCAL, CSP hosts, KEEP_HOSTS, cache
  names, LAYOUT.md pins, `VisionCore.FILES`, `buildFilter`), compared concretely; sha256sum the pinned files.
