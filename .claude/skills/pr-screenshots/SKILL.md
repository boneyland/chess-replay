---
name: pr-screenshots
description: How to add screenshots to a chess-replay pull request description (the orphan pr-screenshots branch, written with git plumbing). Use whenever a PR gets screenshots.
---

# Screenshots in a PR description

`gh` can't upload attachments, so they live on the orphan branch `pr-screenshots` (no workflow files, so no CI; Render builds only `main`) under `pr-<N>/`, embedded as `https://github.com/boneyland/chess-replay/raw/pr-screenshots/pr-<N>/<file>.png`, each with a caption (viewport, browser).

## Glass and Firefox

Playwright's Firefox screenshots never draw `backdrop-filter`: a glass surface (the Menu, Play and Explore menus, Settings and Queen panels, dialogs, the Transport bar) shows the page behind it sharp, as if the blur were broken. The page itself blurs fine in Firefox; only the capture leaves it out.

- Wherever glass is on screen, the PR's picture of it is a Chromium screenshot. Judge the blur, and anything seen through it, only there.
- A Firefox screenshot goes in only for a layout change (columns, overflow, height caps, wrapping), and if glass shows in it, its caption says so: "Firefox, layout only (its screenshots draw no blur)".
- A true Firefox picture of the blur needs a headed Firefox window captured by the desktop, not by Playwright; only when the blur itself is what's being checked.

## Adding them

Add them with git plumbing, leaving the working tree alone: a temporary `GIT_INDEX_FILE` seeded from the branch tip (`git read-tree origin/pr-screenshots`), `git hash-object -w` + `git update-index --add --cacheinfo`, `write-tree`, `commit-tree -p origin/pr-screenshots`, then `git push origin "${c}:refs/heads/pr-screenshots"` (braces, not just quotes: zsh reads `$c:r` as the `:r` modifier even inside double quotes).
