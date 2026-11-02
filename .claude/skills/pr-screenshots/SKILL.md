---
name: pr-screenshots
description: How to add screenshots to a chess-replay pull request description (the orphan pr-screenshots branch, written with git plumbing). Use whenever a PR gets screenshots.
---

# Screenshots in a PR description

`gh` can't upload attachments, so they live on the orphan branch `pr-screenshots` (no workflow files, so no CI; Render builds only `main`) under `pr-<N>/`, embedded as `https://github.com/boneyland/chess-replay/raw/pr-screenshots/pr-<N>/<file>.png`, each with a caption (viewport, browser).

Add them with git plumbing, leaving the working tree alone: a temporary `GIT_INDEX_FILE` seeded from the branch tip (`git read-tree origin/pr-screenshots`), `git hash-object -w` + `git update-index --add --cacheinfo`, `write-tree`, `commit-tree -p origin/pr-screenshots`, then `git push origin "${c}:refs/heads/pr-screenshots"` (braces, not just quotes: zsh reads `$c:r` as the `:r` modifier even inside double quotes).
