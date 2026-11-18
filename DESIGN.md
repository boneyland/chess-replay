---
name: Chess Replay
description: A chess game you can watch, on parchment by day and walnut-dark by night, lit in gold.
colors:
  parchment: "#f2ece3"
  vellum: "#fbf7f1"
  oak-raise: "#ebe3d6"
  ink-umber: "#2a211b"
  dust-umber: "#6b5f53"
  lamplight-gold: "#8a5e15"
  gold-ink: "#fffaf2"
  blunder-red: "#c0392b"
  best-green: "#237a46"
  mistake-amber: "#b05616"
  queen-plum: "#952660"
  hairline: "rgba(60, 40, 20, 0.14)"
  hairline-strong: "rgba(60, 40, 20, 0.3)"
  night-walnut: "#13100f"
  night-panel: "#1b1715"
  night-raise: "#241e1b"
  night-ink: "#efe8de"
  night-dust: "#9a8e82"
  night-gold: "#e3b55b"
  night-gold-ink: "#15100d"
  night-blunder: "#e4553f"
  night-best: "#62c483"
  night-mistake: "#ec9442"
  night-queen: "#f08cbc"
  board-light: "#f0d9b5"
  board-dark: "#b58863"
  last-move: "rgba(155, 199, 0, 0.41)"
typography:
  commentary:
    fontFamily: "Instrument Serif, serif"
    fontWeight: 400
    lineHeight: 1.14
  commentary-aside:
    fontFamily: "Instrument Serif, serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.25
  headline:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "28px"
    fontWeight: 700
  panel-label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "0.12em"
  notation:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "16px"
    fontWeight: 600
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
  control:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.9375rem"
    fontWeight: 600
  dialog-title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.005em"
rounded:
  chip: "2px"
  control: "3px"
  field: "4px"
  menu: "5px"
  dialog: "6px"
  round: "50%"
spacing:
  hairline: "2px"
  tight: "6px"
  base: "8px"
  stage-gap: "10px"
  box: "16px"
components:
  dock-button:
    backgroundColor: "{colors.oak-raise}"
    textColor: "{colors.ink-umber}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "34px"
  dock-button-primary:
    backgroundColor: "{colors.lamplight-gold}"
    textColor: "{colors.gold-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "34px"
  panel-button:
    backgroundColor: "{colors.lamplight-gold}"
    textColor: "{colors.gold-ink}"
    rounded: "{rounded.field}"
    padding: "4px 12px"
    height: "30px"
  panel-button-secondary:
    backgroundColor: "{colors.oak-raise}"
    textColor: "{colors.ink-umber}"
    rounded: "{rounded.field}"
    padding: "4px 12px"
    height: "30px"
  field:
    backgroundColor: "{colors.oak-raise}"
    textColor: "{colors.ink-umber}"
    rounded: "{rounded.field}"
    padding: "0 10px"
    height: "38px"
  move-chip-white:
    backgroundColor: "#f1ebe1"
    textColor: "#15100d"
    typography: "{typography.notation}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  move-chip-black:
    backgroundColor: "#2a2320"
    textColor: "#efe8de"
    typography: "{typography.notation}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  dialog:
    backgroundColor: "{colors.vellum}"
    textColor: "{colors.ink-umber}"
    rounded: "{rounded.dialog}"
    padding: "16px 18px 18px"
    width: "560px"
---

# Design System: Chess Replay

## Overview

**Creative North Star: "The Study by Lamplight"**

A quiet study where a game is read slowly: parchment and vellum by day, walnut-dark by night, and one warm gold that does the work of a lamp, falling on the last move, the main action and the bar you play the game from. The board is the picture on the desk; everything else is paper laid beside it. The colours come from one source (`app/theme.js`), written into the page as CSS custom properties (`--bg`, `--panel`, `--ink`, `--accent`…) and into the views' palettes, so the page and an exported video always match.

The voice is split three ways and each has one job. Mono (JetBrains Mono) is the record: notation, clocks, evals, labels, buttons. Serif (Instrument Serif) is the annotator's hand: commentary and the board's quiet asides, often in italics. Sans (IBM Plex Sans) is the room's plain speech: player names, dialog prose, notes. Controls are tactile and warm: raised paper-toned buttons, gold primary buttons, and frosted-glass menus and dialogs that let the board show through, with a bright rim along their top edge like light catching a pane.

Panels sit flat on the page, separated by hairlines rather than shadows; only what floats above the board (menus, Settings, Queen, dialogs) casts one. The playing video is a still, clean picture, and every control belongs to the paused page.

**Key Characteristics:**
- Two themes from one token set: Parchment (light) and Night Walnut (dark), following the system or the page's own setting, plus a stronger "more contrast" variant of each.
- One accent, Lamplight Gold; four meaning colours (best, mistake, blunder, Queen) that are chess verdicts, never decoration.
- Mono for anything that is data; serif only for commentary; sans for prose.
- Flat panels with hairline borders; floating surfaces are glass with a rim and a drop shadow, and a soft halo glow in the dark theme.
- Every size goes through the Text size setting (`tx(px)`), and the layout is computed, not breakpointed by hand.

## Colors

Warm, low-chroma paper and umber neutrals carry everything; gold and four verdict colours are the only saturated hues.

### Primary
- **Lamplight Gold** (light #8a5e15, dark #e3b55b): the last move, primary buttons (Import game, a dialog's main action), the Transport bar's tint, the menus' group labels, links and the focus ring. **Gold Ink** (#fffaf2 light, #15100d dark) is the text on it.

### Tertiary
- **Best Green** (#237a46 / #62c483): a best move and its line, the engine's agreement, the online note when connected.
- **Mistake Amber** (#b05616 / #ec9442): a mistake or inaccuracy.
- **Blunder Red** (#c0392b / #e4553f): a blunder, errors, the danger state of a confirmation, the offline note.
- **Queen Plum** (#952660 / #f08cbc): Ask Queen's text and marks only, kept at 5:1 or more on any panel, button or glass.

### Neutral
- **Parchment** (#f2ece3) / **Night Walnut** (#13100f): the page behind everything.
- **Vellum** (#fbf7f1) / **Night Panel** (#1b1715): panels, dialogs, menus (also the glass's base colour).
- **Oak Raise** (#ebe3d6) / **Night Raise** (#241e1b): fields, secondary buttons, tiles; dark buttons are a step lighter (#3a312c), hover deeper (#ddd2c0 / #5a4d44).
- **Ink Umber** (#2a211b) / **Night Ink** (#efe8de): text.
- **Dust Umber** (#6b5f53) / **Night Dust** (#9a8e82): secondary text, panel labels, empty states.
- **Hairline** and **Hairline Strong** (umber at 14% and 30%, cream at 10% and 25% in dark): borders and dividers.

### Board
- **Board Light** (#f0d9b5) and **Board Dark** (#b58863), the default board; the Lichess last-move tint (yellow-green at 41%) sits on both. The board and the eval bar's white and black halves are the sides' colours and never follow the theme.
- **Coordinates** are each square's colour on the other, as Lichess draws them (about 2:1); under `prefers-contrast: more` they turn black or white, whichever stands out on the square (4.58:1 at least).
- **Keyboard cursor:** the board's square under the arrow keys carries a 5 px ring inside its edge in the theme's ink (Ink Umber, Night Ink in dark); it shows only while the board has keyboard focus, never after a press, and the picked-up square keeps its usual highlight.

### Named Rules
**The One Lamp Rule.** Gold is the only accent. It marks where you are (the last move), what to do next (the primary button) and how to get around (the Transport bar, menu labels, links). Never a second accent hue, and never gold as decoration.

**The Verdict Rule.** Green, amber, red and plum mean best, mistake, blunder and Queen, and nothing else. Never use them for branding, status chrome or emphasis. One exception: the analysis spinner (the Analysis title's computer button while a game analysis runs) is a turning rainbow of the night verdict hues plus a yellow, blue and violet of its own, read as "working", not as any verdict.

**The Measured Contrast Rule.** Every coloured text keeps 4.5:1 where it actually sits, glass over the board included; on glass, a dialog's dim, gold and verdict colours are mixed a quarter of the way to the ink. A new colour or surface gets measured, not eyeballed.

## Typography

**Display/Commentary Font:** Instrument Serif (with serif)
**Body Font:** IBM Plex Sans (with system-ui, -apple-system, Segoe UI, sans-serif)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo, monospace)

Noto Sans Symbols 2 is also requested from Google Fonts but named in no font stack, so browsers never download it: an open question whether to drop it.

**Character:** A typewritten scoresheet annotated by hand. The mono is exact and tabular, the serif is condensed and literary, and Plex keeps prose readable between them.

### Hierarchy
- **Info mark** (Instrument Serif italic 400, 16 px): the "i" in the ⓘ buttons.
- **Commentary** (Instrument Serif 400, sized to fit the panel, line-height 1.14): the commentary text, revealed by the typewriter while playing. Its asides ("No comment on 12… Nbd7.", "Loading the opening book…") are italic, 26–30 px, in Dust Umber.
- **Headline** (JetBrains Mono 700, 28 px, 22 px when tight): the Analysis panel's move and eval, the biggest numbers on the page.
- **Panel label** (JetBrains Mono 600, 15–16 px, 0.12em tracking, uppercase, Dust Umber): MOVES, ANALYSIS, COMMENTARY, WHITE/BLACK on the graph.
- **Notation** (JetBrains Mono 600, 16–17 px): move chips, clocks, the best line, move numbers (500, dim).
- **Body** (IBM Plex Sans 400, 14 px, line-height 1.4–1.45): player names (600), dialog notes, Settings text.
- **Control** (JetBrains Mono 600, 15 px): dock and menu buttons; panel buttons are Plex 600.

### Named Rules
**The Three Hands Rule.** Mono is the record, serif is the annotator, sans is the room. Data never appears in serif, and commentary never in mono.

**The Text Size Rule.** Every size in the views goes through `tx(px)` so the Text size setting scales it; never a fixed pixel size for text the viewer reads.

## Layout

One page, laid out by `LayoutCore` (`app/layout-core.js`): a pure function from the window size, text size and view to boxes for the board, the player bars and the panels, in one column or two. Wide windows put the board on the left with Game info, Moves, Commentary and Analysis stacked beside it, the eval graph full width beneath, and the Transport bar along the bottom. Narrow windows stack board, Moves, Analysis and Commentary in one scrolling column under the player bars, with the Transport bar fixed at the foot over the scrolling page. A phone held sideways moves the player bars into a column beside the board. A playing video fits the window exactly; the paused one-column page scrolls.

The board is a 768 px picture scaled into its box, so everything on it is positioned in board pixels. Spacing is tight and regular: 10 px between the stage's blocks, 6–8 px inside menus and between buttons, 16 px panel and dialog padding, safe-area insets respected on every edge.

**The Board Leads Rule.** The board takes the largest box the layout can give it; panels fit around it, never the other way round.

## Elevation & Depth

Hybrid. Anything that lies on the page (panels, the board, player bars, the graph) is flat, defined by a hairline border on Vellum. Anything that floats above the board is frosted glass (blur 12 px, saturate 1.6) with a bright rim along its top, a fainter rim all round, a drop shadow and, in dark, a soft cream halo: the Menu, the Play and Explore menu, the Settings and Queen panels, and dialogs (over a clear scrim). The glass turns opaque for reduced transparency, more contrast and forced colours.

### Shadow Vocabulary
- **Tooltip** (`box-shadow: 0 8px 24px var(--shadow), var(--halo)`): tooltips and small notes.
- **Menu** (`box-shadow: inset 0 1px 0 var(--rim), inset 0 0 0 1px var(--rim-soft), 0 12px 32px var(--shadow), var(--halo)`): menus above the Dock.
- **Dialog** (`box-shadow: inset 0 1px 0 var(--rim), inset 0 0 0 1px var(--rim-soft), 0 16px 48px var(--shadow), var(--halo)`): dialogs and the Settings and Queen panels.
- **Transport glow** (`box-shadow: inset 0 1px 0 var(--line-strong), inset 0 2px 0 var(--rim-soft), 0 0 4px 1px color-mix(in srgb, var(--accent) 25%, transparent)`): the Transport bar's gold-tinted glass.

### Named Rules
**The Paper and Glass Rule.** What lies on the page is paper: flat, hairline-edged, no shadow. What floats over the board is glass: blurred, rimmed and shadowed. Never a shadow on a resting panel.

## Shapes

Small, nearly square corners that read as cut card rather than pills: 2 px on move chips, 3 px on dock buttons, 4 px on fields and panel buttons, 5 px on menus, 6 px on dialogs and tiles. Full circles only for the play button, toggles' knobs and the seek bar's knob. Borders are 1 px hairlines; a control's edge (1.5 px, stronger than a panel's line) marks things you press inside a panel.

## Components

### Buttons
Tactile and warm: paper-toned, raised, pressed with a slight scale.
- **Shape:** gently squared (3 px in the Dock, 4 px in panels and dialogs).
- **Dock button:** Oak Raise on a hairline, Ink Umber mono 600 at 15 px, 34 px high (40 px icon buttons in the folded menu, 44 px on phones in the Analysis title).
- **Primary:** Lamplight Gold with Gold Ink text, no border; hover brightens it (brightness 1.15).
- **Panel button:** gold, 30 px minimum, 4 × 12 px padding; **secondary** is Oak Raise with a hairline. Dialog buttons are 34 px and name their action ("Remove", "Keep"), never OK / Cancel.
- **Hover / Focus:** hover deepens to the hover tone only where hover exists (`@media (hover: hover)`); focus is a 2 px gold outline offset 2 px, ink on thin glass.
- **Target size:** every control takes presses over at least 24 × 24 px (WCAG 2.5.8), 44 px where the page already gives it on phones. A control drawn smaller (the ⓘ marks, Settings switches, move chips) gets a transparent `::before` hit area around it (the ⓘ marks' and switches' wider under `pointer: coarse`), so the drawing keeps its size.

### Move chips
The record of the game: mono 600, 2 × 8 px padding, 2 px corners. White's moves on a pale chip (#f1ebe1), Black's on a dark one (#2a2320), whatever the theme, so the side reads at a glance. The current move is bolder and outlined; moves not yet played are faded to 70% (their text stays at 5:1 or more on either chip in either theme); a flagged move takes its verdict colour.

### Cards / Containers (panels)
- **Corner Style:** square-ish (2–4 px).
- **Background:** Vellum / Night Panel.
- **Shadow Strategy:** none (Paper and Glass Rule).
- **Border:** 1 px hairline.
- **Internal Padding:** 16 px, with an uppercase mono panel label in Dust Umber and title-row tools (switch, engine drop-down, icons) at its right.

### Inputs / Fields
- **Style:** Oak Raise, 1 px hairline, 4 px corners, mono 500 at 14 px (16 px on touch screens, so the phone doesn't zoom), 38 px high in dialogs.
- **Focus:** the 2 px gold outline.
- **Error:** the message beneath in Blunder Red mono, "problem: cause or way out".

### Navigation (Transport bar and Dock)
A gold-tinted glass bar along the foot: step and play buttons and the seek bar on the left, the Dock's icons (sound, download, Menu, share, Settings, full screen) on the right. The play button is a filled ink circle. On a phone it slims to 36 px and folds the Dock into one Menu. It never shows while the video plays clean.

### Eval bar and graph (signature)
The eval bar beside the board is literal white and black, the eval printed in mono at its foot. The graph beneath is a thin Best Green line on Vellum, the future dashed in Dust Umber, a dot for the current move.

### Dialogs
A centred glass box (max 560 px, 760 px for Position from image) over a clear scrim, rising 8 px and fading in over 0.2 s; reduced motion keeps only the fade.

## Do's and Don'ts

### Do:
- **Do** take every colour from the theme tokens (`app/theme.js`, `--bg`, `--panel`, `--ink`, `--accent`…) and add a new one there for both themes and both "more contrast" variants.
- **Do** set data (moves, clocks, evals, labels) in JetBrains Mono, commentary in Instrument Serif, prose in IBM Plex Sans.
- **Do** keep panels flat with a 1 px hairline, and put glass, rim and shadow only on surfaces that float over the board.
- **Do** size text with `tx(px)` and position on the board in board pixels.
- **Do** measure contrast where the text actually sits (4.5:1 on glass over the board too) and give reduced transparency, more contrast and forced colours an opaque fallback.
- **Do** keep reduced motion as a short fade that still shows the change.

### Don't:
- **Don't** add a second accent hue, or use the verdict colours (green, amber, red, plum) for anything but their verdicts.
- **Don't** theme the board squares, the eval bar's halves or the move chips' sides: they are White and Black.
- **Don't** put a shadow on a resting panel, or a large radius or pill shape on a button.
- **Don't** show buttons, progress lines or engine controls on the playing video.
- **Don't** set commentary in mono or data in serif.
