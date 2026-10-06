You are correcting a machine reading of five leaves of Manly P. Hall's _The Lost Keys of Masonry: The Legend of Hiram Abiff_ (second edition, Hall Publishing Company, Los Angeles, 1924), against photographs of those leaves.

**Read this first, it is the whole job.** You are NOT transcribing from the image. You are given a text that OCR produced and the image it came from, and your job is: _where do they differ?_ Never retype a page from the picture. Change only what you can see is wrong.

## Inputs

Brief: `BRIEF` — an array, one entry per leaf:

- `leaf`, `image` (a 400 DPI PNG — read it with the Read tool; it is sharp enough to read every letter directly), `blocks` `[{i, kind, text}]` (keep `i`), `secondReader` (another engine's reading: the OCR layer Acrobat Capture put in the PDF in 2002), `disagreements` `[{ours, other}]` (where the two engines differ — where to look first, not an answer).

**Open all five images at once, in one turn, then write the output once.** Every turn re-sends what you have already opened, so a reader who opens one image, writes, opens the next and writes again pays for the first image five times over.

Use `WORKDIR` for any scratch files of your own. Do not write anywhere else.

To look closer at a word, crop the render — there is no PIL or ImageMagick, and you do not need to write a cropper: `node scripts/reading-kit/crop.mjs <image> WORKDIR/c.png <x> <y> <w> <h> [scale]` (run from `/home/user/Public-Domain-Book-Formatter`; pixels of the 400 DPI render; `scale` 2 or 3 to enlarge, 0.5 to see a whole page).

## What this book is

Continuous prose, Hall's first book, on the inner meaning of the Masonic degrees, in a clean 1920s letterpress setting in one roman face. The scan is black and white (1-bit), sharp, with no tone at all.

- **Running heads** at the top of most pages: `THE LOST KEYS OF MASONRY` on versos, the section's title on rectos (`INTRODUCTION`, `THE CANDIDATE`, `THE PRIEST OF RA`). **The folio is centred at the foot of every page.** Leave both out: set any block that is only a running head or a folio to `""`.
- **An ornamental initial opens every chapter and section**: a large decorated capital three lines deep, with the rest of the first word in capitals beside it (`THE average Mason`, `THERE comes a time`). OCR drops the initial or reads it as junk (`HE average`, `©HE`, `“HERE`). **Set the whole word as printed, initial included, in plain capitals**: `THE average Mason`. Check the first word of every opening.
- **Section numerals** (`I`, `II`, …, as the page sets them, with or without a stop) are centred above the Introduction's sections. Give each `"level": 2` on its block (or on the `add` that puts it in, if the draft has no block for it), so it stands as a section and not a chapter.
- **Chapter openings** set `Chapter One` (italic) over the title in capitals (`THE CANDIDATE`): two `heading` blocks. The italic of `Chapter One` is the heading's design: plain text, no `<i>`.
- **Short pieces between the chapters** (`TEMPLE BUILDERS`, `MOTIVE`, `TRANSMUTATION`, `FRIENDSHIP`, `THOUGHTLESSNESS`, `THE PRESENCE OF THE MASTER`) are a centred heading and one paragraph, on a page of their own. The heading is `heading`, the text `paragraph`.
- **A few pages carry only a title in display type** in the middle of the page (`The Master Mason`, `The Qualifications of a True Mason`, `To The Order of De Molay`). They are half-titles: one `heading` block.
- **Footnotes** sit at the foot of the page in smaller type, with no rule above them, marked `*` in the text and at the head of the note. Keep the mark where the page sets it, both places. A note is its own block, kind `footnote`.
- **Italic** is used for emphasis and for names of works and terms (`<i>THE SECRET WORK</i>`, `<i>Chiram, the universal agent</i>`). Mark every italic run with `<i>…</i>`; the draft has **no** italic at all, so every one you see is yours to add. Look at every leaf for it: a block with no `<i>` looks exactly like a block that never had any. Capitals in a heading are plain capitals.
- **Small capitals** in running text: plain capitals.

## What each engine is bad at on this book

(Seen on leaves 0–14; readers of each stretch add to this.)

- **Ours drops the ornamental initial** (above), and may put a stray `©`, `“`, `|` or `\` where the ornament's flourishes are, as a block of its own (set it to `""`). The ornamental `M` looks like a `Φ` with flourishes (leaf 13: `ASONRY is` is `MASONRY is`).
- **The lines beside an ornamental initial are inset only because of the initial.** Ours types them `blockquote` and splits the paragraph into two or three blocks: retype to `paragraph` and mark the pieces after the first `"join": true`.
- **Ours types an ordinary indented paragraph `blockquote`** now and then (leaf 5). Look at the indent: a quotation is inset on both sides, a paragraph only on its first line.
- **A display title at the top of a leaf is sometimes taken off as a running head** and has no block (`ILLUSTRATIONS`, leaf 11): if the page prints a title that is not in the blocks, add it (`after: -1`, kind `heading`).
- **Ours puts `|`, `~` and specks at the start or end of a line.** Delete what the page does not print.
- **Capture reads italic `f` as `j`** (`oj` for italic `of`): where the two engines differ on a letter in an italic run, look.
- **Around a footnote** (seen on leaves 23–28): ours types the last body line above the note `footnote` (retype it `paragraph`, `"join": true`), splits a two-line note into two `footnote` blocks (mark the second `"join": true`), and types the folio `footnote` (set it to `""`). It reads the `*` in the running text as `”` and Capture reads it as `?`: check every reference mark in the text, not only the one at the head of the note.
- **A word broken across two leaves** (`dark-` at the foot of one leaf, `ness` at the head of the next) is left as printed on both: the hyphen stays at the end of the first leaf and the second opens with the rest, and assembly joins them. Line-end hyphens print small and blobby here, and ours sometimes reads the last one on a leaf as a full stop (`understand.` for `understand-`): check the last character of every leaf.
- **Damaged sorts that still read plainly as the right letter** (a broken-open `e`, an `l` with a nicked stem) are set as the word and raise nothing. Specks beside a comma can look like a semicolon: a real `;` dot on this page is as large as a full stop.
- **From the Prologue on (leaf 41) the page is set in an old-style face**, looser and Caslon-like, where the earlier matter is in a Century-style face. In it Capture reads `l` as `I` or `i` (`Iiving`), `y` as `v` (`mv`), and specks as `*`: a `*` from Capture alone is not a footnote mark.
- **Capture garbles italic** (`OnZy`, `Thirtg`, `Moc7n`, `Hirctm`): a run of garble in Capture where ours is clean is a cheap sign of an italic run. Ours reads the letters right but marks no italic.
- **Italic tags close before trailing punctuation**: `<i>Hiram</i>,` and not `<i>Hiram,</i>`. Words separated only by commas are one run: `<i>Fire, Air</i>,`.
- **Openings of the Prologue and Epilogue** are set like a chapter's: `PROLOGUE` over the title (`IN THE FIELDS OF CHAOS`), two `heading` blocks. The draft often has no block for the first line: add it.
- **Extra lead between paragraphs** varies from page to page where the compositor filled the depth. It is not a section break; only a numeral or a heading is.
- **`Chiram` and `Hiram`** both stand in this book, each where the author means it, and `Chiram` is sometimes italic as a word under discussion and sometimes roman: set each as printed.
- **Folios come through under any kind**: `paragraph`, `heading`, `footnote`, and misread (`of`, `a9`, `a3`, `4`, `53 | |`). A lone short block at the foot of the page is the folio: set it to `""`.
- **Ours reads a line-end hyphen as a full stop in mid-leaf too** (`con. sciousness`, `breath. ing`, `Mas. ter’s`): a `word. lowercase` break inside a sentence is a hyphenated word; join it.
- **Ours reads the `*` reference mark as `®`, `”` or `?`** and ends a note with a comma where the page prints a full stop: check both.
- **Not every initial is decorated**: Chapter Four opens with a plain large `O` (`ON the upper step`). Capture reads it as `0`; ours drops it.
- **Numbered lists** (`1. It is absolutely necessary…`) are ordinary paragraphs opening with the numeral, one block each.
- **Some sorts print heavy** (a `ch`, an `F`); that is not bold: set them plain. A single letter set in the wrong fount (an italic `n` inside a roman word, leaf 82) is a printers-error: transcribe it with the tag and give the plain word as `fix`.
- **The short pieces between chapters are set in a heavier face** with wider spaces before `?` and `!` (leaf 82). The rule for those marks does not change: set close.
- **Both engines read `y` as `v` in the old-style face** (`destroved`, `obev`, `eves`): when both agree on a `v` in an `-oyed`, `-ey` or `-ye-` word, look.
- **No space before `;` `:` `?` `!`.** The gap you can see is the glyph's own sidebearing: measured at 400 DPI, 20 px before `;` against 15 px before a full stop on the same line, and 46–98 px for a word space. Set every such mark close (`Cup;`, `riddle?`, `says:`), whatever either engine has.
- **The other reader (Capture)** runs words together (`THE LOSTKEYS OFMASONRY`, `CHAPTERTHREE`), reads `fi` as `$` (`Qual$ications`), and puts `-`, `_`, `~`, `*` in leader rows. It is often right on a single letter where ours is wrong; it is not evidence on spacing.
- **Line-end hyphens**: a hyphen that only breaks a word at the end of a line is not printed text: join the word (`unrecog-` / `nized` → `unrecognized`). A real compound keeps its hyphen (`light-beings`, `self-conscious`).
- **Em dashes** are set close (`Life—that`): no space either side unless the page shows one.
- **Specks** come through as `'`, `,`, `.` or `·` in the middle of a line. Delete what the page does not print.

## Block kinds

The draft guessed each block's `kind` from its geometry. Where a kind is plainly wrong, give the right one as `"kind"` on that block in your output: `paragraph`, `heading`, `blockquote`, `footnote` or `caption`. A quotation set off from the text in smaller type or indented on both sides is `blockquote`; a footnote is only what stands at the foot of the page under a `*`.

## Output

Write `OUT` — shape:

```json
[{"leaf": N, "blocks": [{"i": 0, "text": "...", "kind": "only where the draft's is wrong"}, ...],
  "add": [{"after": 3, "kind": "heading", "text": "only for a block the draft left out altogether"}],
  "queries": [{"quote": "exact words as printed", "why": "...", "kind": "printers-error|inconsistent|unclear", "fix": "only for printers-error: the word as it should read"}]}]
```

Every block, corrected or not, with its `i`. A block that is only scanner junk, a running head or a folio: set its text to `""`; do not query it. `add`: `after` is the `i` it follows (`-1` for the top of the leaf), `kind` one of the five above, `text` read off the page like any other block. Add only what you can see printed.

## Rules

1. **Transcribe as printed.** Spelling, punctuation, capitalisation as the page has them. Curly `“ ” ‘ ’` as printed. No space before `;` `:` `?` `!` (see above).
2. **Mark emphasis**: `<i>…</i>` for italic runs, `<b>…</b>` for bold. Small capitals: plain capitals.
3. **Leave out** the running head and folio.
4. **Clear typos and damaged type** (a misspelling the page plainly makes, an unpaired quotation mark, a broken sort): transcribe **as printed** and raise a query with `kind: "printers-error"` and `fix` giving the word as it should read. The editor's standing ruling (`RULINGS.md` on the shelf) is that this class is corrected, so your `fix` is applied without anyone looking again: propose one only where it is certain. It covers a misspelling the page plainly makes, a broken or turned sort, and an unpaired quotation mark; not pointing that merely varies, and not a period or author's spelling the book uses consistently. A name spelled two ways in the book (a form on one leaf, another on the next) is not yours to settle: set each as printed and say so in your report. If the fix means **choosing** (where an unclosed quotation should close, which of two words was meant) it is not a printers-error: raise it `inconsistent` with no fix.
5. **Before raising anything, read the whole block it sits in and the blocks either side**, and look for the same word or construction elsewhere on your leaves. A finding the paragraph settles is not a query.
6. Anything that is genuinely the editor's — the book contradicting itself, a sentence that does not construe — `kind: "inconsistent"` or `"unclear"`, transcribed as printed, **no fix proposed**.
7. A word broken by a hyphen across two blocks is set whole in the first block and removed from the second.
8. If a block holds two paragraphs run together, or one is split across two blocks, do not restructure — correct the text and note it in your report with the leaf and `i`. A block that only continues the one before it on the same leaf may be marked `"join": true`.
9. A block the brief types `table` is regenerated from its cells, so prose written into it is thrown away. If a `table` block is really prose (the contents page is the likeliest), correct the text and **say so in your report**.

Work leaf by leaf. Report back only: blocks changed per leaf, queries by kind, italic runs added, and anything a later batch should know about this book's type or either engine that is not already above.
