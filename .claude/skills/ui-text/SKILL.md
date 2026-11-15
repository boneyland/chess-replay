---
name: ui-text
description: Use when writing, changing or reviewing text the chess-replay page shows or announces - error and status messages, button and menu labels, aria-labels, dialog notes, confirmations, empty states, progress lines - in app/ or in a spec section that words them.
---

# UI text in chess-replay

What to check before a string goes in the page: a checklist and the page's own conventions. When drafting a new string, write two or three wordings and pick one against the review pass below, rather than polishing the first.

## The page's conventions

Read the strings around the one you're writing and match them. Recurring patterns:

- **Problem, colon, cause or way out**: "Lichess can’t be reached: check that you’re online." · "That file isn’t a PGN, an analysis JSON or a notes file."
- **Sizes and costs on the button**: "Download board reader · 56 MB", decimal MB, joined with " · ".
- **Confirmations say the consequence and name both buttons by their action**: "Remove the full engine? You’d need to download 99 MB again to use it." with **Remove** and **Keep**, never OK / Cancel.
- **"…" only on a line saying something is under way** ("Loading the encoder…", "Fetching from Lichess…"); menu buttons have no trailing ellipsis.
- **Progress lines say how far, and how long when the page knows**: "Analysing 12 of 40 positions · about 1 min left", "Downloading board reader · 18 of 56 MB". A bare "Loading…" only for waits too short to measure.
- Sentence case everywhere; no exclamation marks; plain explanation over cheerfulness.
- **Speak to the viewer as "you"**, never "we" or "the user"; a step is an imperative ("Drop a picture of a board here").
- **Numerals for counts** ("3 games", "12 of 40 positions"), and the plural follows the number: never "1 games" or "1 plies".

## Typography

- **Curly apostrophes and quotes** in shown text: ’ “ ”, not ' ". The source mixes both today; use curly ones in any string you write or touch, without a sweep of its own.
- **"…" is one character**, never three dots.
- **A space before a unit, and a non-breaking one** so the number and unit never split over two lines: `56 MB`, `3 s`, `99 MB` (` ` in a JS string, `&nbsp;` doesn't work in JSX text). Same for a key with its name (`Ctrl K`).
- **Placeholders show an example of what goes in**, never the only label: the field still has a `<label>` or `aria-label` ("PGN, FEN or Lichess link"). A placeholder takes no trailing "…" unless it is an example cut short (`1. e4 e5 2. Nf3 Nc6 …`).
- **Moves, FENs, UCI, engine names and player names aren't words to translate**: wrap them in `translate="no"` (an element, or the attribute on the one holding them), or the browser's page translation turns `Nf3` or `Bxe5` into nonsense.

## Messages by kind

| Kind | Where | Must say |
|---|---|---|
| Input problem | next to the field or dialog | what's wrong with *this* input, in terms of what the viewer gave ("That link isn’t a Lichess game, broadcast or study.") |
| Something failed | the dialog or panel it happened in | what failed, the likely cause if known, what to do next |
| Can't run here | where the feature would be | what this browser or device lacks, and what still works |
| Before a download or permission | before the click | what it's for, the cost (MB, time, quota), that nothing happens until they click |
| Empty list or panel | in place of the empty box | that it's empty, then what fills it and how to start ("No games yet. A game of Play vs human or Play vs computer is kept here from its first move.") |

Every failure has a way forward: a retry, another route, or what still works. An error code or `e.message` may follow the sentence, never replace it.

## Words that blame or say nothing

| Instead of | Say |
|---|---|
| "Invalid input", "Illegal" | what it isn't, or what's needed |
| "Something went wrong", "An error occurred" | what failed |
| "Click here", "Read more" | what the link opens |
| "OK", "Submit", "Continue" | the action ("Read board", "Export video") |
| "easy", "simple", "quick", "just", "simply", "really", "very" | cut it, or say the concrete thing ("one click", "under a minute") |
| "significantly", "often", "usually", "many" | a number, or the actual condition ("on phones from before 2020") |
| A rhetorical question ("Want to try Full Stockfish?") | the statement and its cost ("Full Stockfish is stronger · 99 MB") |

## Screen readers

- An icon-only button needs an `aria-label` naming its action ("Share and export", "Settings"), and its `title` the same text.
- A field's label and its error are read together: word the error to make sense right after the label.
- Never let colour alone carry a meaning (a move's rating, an error): pair it with a mark or a word, as move marks (?!, !!) do.
- A dialog gets an `aria-label` (or a visible title) saying what it is: "Exporting", "Export failed".
- **Text that changes while the viewer waits is announced**: a progress or status line sits in `role="status"` (or `aria-live="polite"`), an error that appears after an action in `role="alert"`. Announce the change, not every tick: a progress line updated each frame floods a screen reader, so announce its start, its end and milestones.
- An icon next to a text label (a glyph in a Dock button, a mark before a message) is decorative: `aria-hidden="true"` on the icon, so the label isn't read twice.
- Every form control has a label a screen reader reads: a `<label>` wrapping it or pointing at it with `htmlFor`, or an `aria-label`. A checkbox's or toggle's label is clickable too, with no dead gap between label and control.
- A destructive action (Resign, Remove the full engine, Clear saved data, deleting a game from My games) asks first, in a confirmation following the conventions above, or offers an undo. Never on one click.

## Review pass

Before committing new or changed text, read it once for each:

1. **Purpose**: does it help the viewer do what they came to do, or answer the question they'll have here?
2. **Length**: cut words that add nothing; put the important word first. Notes may run longer when they explain a real constraint (the export's "Keep this tab active…"): length is fine, padding isn't.
3. **Read aloud**: would a person say it? Active voice unless passive is clearer. In longer notes (Settings › About, a dialog's explanation), watch for the habits of generated text: a paragraph that opens by summing up the last one, datasheet phrasing ("provides", "is configurable"), and machines doing human things ("hands the engine a position" → "sends the engine a position"). If a sentence has to be read twice, name who does what.
4. **Consistency**: the same name for the same thing as the rest of the page and the spec, `docs/spec.md` and the files it links (Full / Lite, Import game, My games, Share and export). A rename changes every place it appears, the spec and the live tests' selectors included.

Adapted from content-designer/ux-writing-skill (MIT, © 2026 Christopher Greer): the message kinds, the screen-reader notes and the four-pass review. The typography rules, the extra words to avoid, the live-region, label and destructive-action notes and the generated-text check come from Vercel's Web Interface Guidelines and Writing Guidelines (github.com/vercel-labs/web-interface-guidelines and writing-guidelines, read 2026-11-16), keeping only the rules that fit this page: their Title Case and their ban on dashes as punctuation don't apply here.
