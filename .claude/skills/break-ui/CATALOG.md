# Worst-Case Catalog

Realistic values that break UI, grouped by what kind of value the component renders. Use the rows that apply to the fields in your Phase 1 table. Each value is something a real user could produce; the note says what it tends to break.

Use `example.com` or `.test` domains for any made-up URL. In PGN Site tags, keep the real shape (`https://lichess.org/…`, `https://www.chess.com/game/live/…`) but invent the game ID.

The PGN section is the main one. The sections after it cover the page's other inputs and lists: the Import game box, My games, Position from image, the engine and clock numbers, and the conditions to check every case under. Adapted from the original skill's generic catalog (2026-11-16).

---

## Chess games (PGN)

Every value here occurs in real exports. PGN puts no length limit on any tag.

### Players

| Tag · value | Breaks |
| --- | --- |
| `White "Vachier-Lagrave, Maxime"` | Long, hyphenated, "Last, First" order: the Player bar's name runs into the rating and clock |
| `White "Nepomniachtchi, Ian"` next to `Black "So, Wesley"` | One long and one very short name: the two bars or Game info lines look unbalanced |
| `Black "丁立人"` / `Black "Ding, Liren"` | CJK with no spaces: breaks anywhere; initials or "last name" logic finds one word |
| `White "Đặng Thị Ngọc Hân"` | Stacked Vietnamese diacritics: clipped by a tight `line-height` with `overflow: hidden` |
| `Black "عبد الرحمن، نور الهدى"` | RTL: comma and rating land on the wrong side without `dir="auto"` |
| `White "lichess AI level 8"` / `White "Stockfish 17.1 (3500)"` | Engine names with numbers and brackets, where a name was expected |
| `White "magnuscarlsen"` / `White "DrNykterstein"` | Lichess and Chess.com handles: lowercase, no space, unbreakable |
| `White "?"` / `White ""` / tag missing | Unknown player: the page must show something in words, not `?` or nothing |
| `WhiteElo "?"`, `"0"`, `"-"`, missing | Rating placeholders rendered raw |
| `WhiteElo "3512"` (an engine), `BlackElo "800"` | Four digits wider than the rest, or three narrower: the bar's layout shifts |
| `WhiteTitle "WCM"`, `"BOT"`, `"LM"` | Rare and Lichess-only titles: a title badge sized for `GM` |
| `WhiteTeam "Ganges Grandmasters & Friends Chess Club e.V. 1923"` | Long club names in team events |
| `WhiteFideId`, `WhiteClock`, other tags the page doesn't read | Must be ignored, not shown raw |

### Event, place and date

| Tag · value | Breaks |
| --- | --- |
| `Event "Tata Steel Chess Tournament 2024 - Masters, Round 13 (Armageddon tiebreak)"` | 80+ characters: Game info's line wraps or overflows |
| `Event "Rated Blitz game"` | Lichess's generic event: short, says little |
| `Event "?"` / missing | Unknown event |
| `Site "https://lichess.org/broadcast/fide-world-championship-2024/round-14/AbCdEfGh/IjKlMnOp"` | Long unbreakable URL (Game info turns it into a link): overflow, and end truncation hides the part that differs |
| `Site "Chess.com"` / `Site "Wijk aan Zee NED"` | Short sites, and the ChessBase "Place COUNTRY" shape |
| `Date "2024.??.??"` / `"????.??.??"` / `"2024.11"` | Partial and unknown dates, and a malformed one |
| `UTCDate`, `UTCTime` with no `Date` | The date only in Lichess's UTC tags |
| `Round "13.4.2"` / `"-"` / `"?"` | Broadcast board numbers; a dash or `?` for no round |
| `TimeControl "5400/40+30:1800+30"` / `"-"` / `"600+5"` | Classical multi-stage control, none, and Lichess seconds |
| `Termination "Time forfeit"` / `"Abandoned"` / `"Rules infraction"` | Endings the page may phrase differently from checkmate |

### Opening, result and start position

| Tag · value | Breaks |
| --- | --- |
| `Opening "Sicilian Defense: Najdorf Variation, English Attack, Anti-English, Perenyi Attack"` | Lichess's longest opening names: overflow in Game info or Commentary |
| `ECO "A00"` + `Opening "Van't Kruijs Opening"` | Apostrophe, and the book disagreeing with the tag |
| `ECO "?"` / no opening tag and a position out of book | No opening at all: the line should vanish, not show an empty label |
| `Result "*"` on a game that ends in checkmate | Tag and board disagree |
| `Result "1/2-1/2"` | Shown as `½–½` in one place and `1/2-1/2` in another |
| `Result "0-0"` (double forfeit), `"+/-"` (forfeit, ChessBase) | Non-standard results |
| `SetUp "1"` + `FEN` with Black to move and move number 41 | Move numbers start at `41…`; Moves panel and Transport bar labels |
| `Variant "Chess960"` + `FEN` | "Chess960 #n" in Game info; castling notation |
| `Variant "From Position"` (Lichess) | A variant name the page doesn't use |

### Moves and annotations

| Value | Breaks |
| --- | --- |
| No moves (tags and `*` only) | Empty Moves panel, Transport bar with nothing to play, Eval graph with no points |
| One move (`1. e4 1-0`, a resignation) | "1 move", an Eval graph with one point, Play that ends at once |
| 150–300 moves (a real long rook ending) | Moves panel scrolling, Transport bar labels with three-digit move numbers, Eval graph density, stepping speed |
| A comment on every move, some 600 characters long | Commentary overflow and clamping, Moves panel height |
| A comment that is one long URL, or `{[%evp 0.17,0.25,…]}` with hundreds of values | Unbreakable comment text |
| `{[%clk 1:59:58]}` and `{[%eval #-3]}` inside comments | Clock and eval markup shown raw instead of read or hidden |
| `{ <b>Brilliant</b> &amp; **bold** }` | Escaping: must show as literal text |
| Variations nested 4 deep, and 10 sidelines at one move | Indentation running past the panel; finding the main line again |
| NAGs `$1 $3 $14 $18 $146`, and two on one move | Symbols the font lacks; several glyphs on one move |
| Promotions to every piece, `O-O-O+`, `exd6 e.p.` | Long SAN tokens; text the parser must accept |
| A game file with Windows line endings and a BOM | Parsing, and a stray character before `[Event` |
| Several games in one file | Which game opens, and how the others are offered |
| A comment in Arabic, Russian or Chinese | `dir="auto"`, fonts, line breaking |

---

## The Import game box

| Value | Breaks |
| --- | --- |
| Empty, or only spaces and newlines | The message for nothing to open |
| A FEN with a trailing space, or only the board field (`rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR`) | FEN detection and its message |
| An illegal FEN (two white kings, pawns on the 8th rank) | Edit position's `problems()` wording, reached from import |
| A Lichess game, study chapter or broadcast link with `#32` or `?color=black` on the end | Link parsing |
| A Chess.com link | A site the box doesn't read: the message must say what it does read |
| A 2 MB PGN pasted at once (a whole tournament) | Typing lag in the box, which game opens |
| Text that is a PGN with a typo (`1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Kxe8`) | The message must say which move fails |
| `<script>`-looking text, `&amp;` | Shown back as literal text in any message |

## My games

The list keeps the 50 newest (`GamesCore`, `KEEP`).

| Value | Breaks |
| --- | --- |
| 0 games | The empty state's wording (`ui-text` › Messages by kind) |
| 1 game | A list of one; any "1 games" |
| Exactly 50, then a 51st | The oldest drops out silently |
| Two games with the same players and date | The only difference must still show |
| A vs computer game as White and one as Black, a vs human game, a finished and an unfinished one | Every kind of row at once |
| A game played from a set-up position, and a Chess960 one | The row's start label |

## Position from image

| Value | Breaks |
| --- | --- |
| A 4000×200 strip, a 200×4000 strip | The picture's box in Edit position, the auto-crop |
| A 12-megapixel phone photo with EXIF rotation 6 | Rotation (`tests/fixtures/vision-exif6.jpg`) |
| A picture with no board (`vision-noboard.png`) | The "no board found" message |
| A transparent PNG, a dark diagram on the dark theme | Invisible board or picture |
| A HEIC file, a PDF, a 40 MB file | Formats the browser can't decode, and size |
| A board seen from Black's side with labels (`vision-black-labels.png`) | Orientation |

## Numbers on the page

| Value | Breaks |
| --- | --- |
| Eval `+0.0`, `-0.0`, `+12.4`, `#1`, `#-12`, a mate found mid-game | Sign, width of the eval bar's number, mate notation |
| Depth 1 vs depth 40, nodes in the billions | Width of the Analysis panel's stats |
| A clock at `0:00.3`, at `1:59:58`, a game with no clock | Three formats in one Player bar; the bar without a clock |
| 15 captured pieces on one side, promoted pieces captured | Captures overflowing the Player bar |
| Move 147, Black to move (`147…`) | Width of move numbers in Moves and the Transport bar |
| A value changing every frame (eval, clock) | Width jumps without `tabular-nums` |

## States

| Value | Breaks |
| --- | --- |
| Loading: Stockfish starting, Full Stockfish or the board reader downloading | Progress lines (`ui-text`), boxes that jump when the text arrives |
| Offline (stop the server, don't rely on Playwright's offline mode in Firefox) | Lichess, Queen and downloads saying why they can't run |
| A failed fetch (Lichess 429, Queen's quota used up) | The message and the way forward |
| A browser without WebAssembly SIMD (the asm.js engine) | The red "very slow" note |
| Every setting at its extreme: largest Text size, Flip on, every panel on | Layout at once |

## Environment

Flip to each worst case, then change these:

| Condition | Breaks |
| --- | --- |
| 320×568 | Every overflow above, at once |
| 1280×600 (short two-column window) | Game info hidden, the Transport bar docked in the sidebar |
| 844×390 (phone sideways) | The one-column page in landscape |
| 2560×1440 | Panels stretched or stranded |
| Text size setting at its largest | Fixed heights clipping text |
| Dark theme (the page's setting, and the system's) | Hard-coded colours, invisible borders |
| Firefox as well as Chromium | Columns and overflow Chromium never shows |
| Touch (Chromium's phone profile, then the real phone) | Hover-only controls, drag-only actions |
| Playing and exporting (the video fits the window exactly) | Text that fits paused but not while playing |
