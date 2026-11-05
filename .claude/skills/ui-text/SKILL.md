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

## Messages by kind

| Kind | Where | Must say |
|---|---|---|
| Input problem | next to the field or dialog | what's wrong with *this* input, in terms of what the viewer gave ("That link isn’t a Lichess game, broadcast or study.") |
| Something failed | the dialog or panel it happened in | what failed, the likely cause if known, what to do next |
| Can't run here | where the feature would be | what this browser or device lacks, and what still works |
| Before a download or permission | before the click | what it's for, the cost (MB, time, quota), that nothing happens until they click |
| Empty list or panel | in place of the empty box | that it's empty, then what fills it and how to start ("No games yet. A game of Play vs human or Play vs Stockfish is kept here from its first move.") |

Every failure has a way forward: a retry, another route, or what still works. An error code or `e.message` may follow the sentence, never replace it.

## Words that blame or say nothing

| Instead of | Say |
|---|---|
| "Invalid input", "Illegal" | what it isn't, or what's needed |
| "Something went wrong", "An error occurred" | what failed |
| "Click here", "Read more" | what the link opens |
| "OK", "Submit" | the action ("Read board", "Export video") |

## Screen readers

- An icon-only button needs an `aria-label` naming its action ("Share and export", "Settings"), and its `title` the same text.
- A field's label and its error are read together: word the error to make sense right after the label.
- Never let colour alone carry a meaning (a move's rating, an error): pair it with a mark or a word, as move marks (?!, !!) do.
- A dialog gets an `aria-label` (or a visible title) saying what it is: "Exporting", "Export failed".

## Review pass

Before committing new or changed text, read it once for each:

1. **Purpose**: does it help the viewer do what they came to do, or answer the question they'll have here?
2. **Length**: cut words that add nothing; put the important word first. Notes may run longer when they explain a real constraint (the export's "Keep this tab active…"): length is fine, padding isn't.
3. **Read aloud**: would a person say it? Active voice unless passive is clearer.
4. **Consistency**: the same name for the same thing as the rest of the page and `docs/spec.md` (Full / Lite, Import game, My games, Share and export). A rename changes every place it appears, the spec and the live tests' selectors included.

Adapted from content-designer/ux-writing-skill (MIT, © 2026 Christopher Greer): the message kinds, the screen-reader notes and the four-pass review.
