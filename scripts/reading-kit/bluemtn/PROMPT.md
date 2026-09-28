You are correcting a machine reading of five leaves of H. P. Blavatsky's _The People of the Blue Mountains_ (Theosophical Press, Wheaton, Illinois, 1930: an English translation of her Russian account of the Todas and Kurumbas of the Nilgiri Hills), against photographs of those leaves.

**Read this first, it is the whole job.** You are NOT transcribing from the image. You are given a text that OCR produced and the image it came from, and your job is: _where do they differ?_ Never retype a page from the picture. Change only what you can see is wrong.

## Inputs

Brief: `BRIEF` — an array, one entry per leaf:

- `leaf`, `image` (a 400 DPI PNG — read it with the Read tool; it is sharp enough to read every accent directly), `blocks` `[{i, kind, text}]` (keep `i`), `secondReader` (another engine's reading), `disagreements` `[{ours, other}]` (where the two engines differ — where to look first, not an answer).

Use `WORKDIR` for any scratch files of your own. Do not write anywhere else.

To look closer at a word, crop the render: `node scripts/reading-kit/crop.mjs <image> WORKDIR/c.png <x> <y> <w> <h> [scale]` (run from `/home/user/Public-Domain-Book-Formatter`; pixels of the 400 DPI render; `scale` 2 or 3 to enlarge, 0.5 to see a whole column).

## What this book is

Continuous prose in six chapters, a clean 1930 setting in a modern face. Each leaf carries a running head (`THE PEOPLE OF` on versos, `THE BLUE MOUNTAINS` on rectos) with the folio beside it, or the folio alone at the foot of a chapter opening. Chapter openings: `CHAPTER I` and so on, then the text. Footnotes below a short rule at the foot of the leaf, in smaller type, marked `*`, `†`, `‡` in the text and at the head of each note. Proper names are Blavatsky's spellings of Tamil, Sanskrit and Anglo-Indian words (`Nilguiri`, `Kouimbatour`, `Maissour`, `Todas`, `Badagas`, `Kurumbas`, `moudiliars`), set as the page sets them; they are not errors.

## What each engine is bad at on this book (seen on leaves 0–7; readers of later stretches will add to this)

- **Footnote marks.** Ours reads `†` as `+` or `t`, and `‡` as `i`, `I` or `f`. Set the mark the page prints, in the text and at the head of the note.
- **Stray marks at line ends.** Ours puts `)`, `|`, `-`, `:` or `,` where there is a speck or the platen edge (`of a most )`, `surround us, -`, `8 : THE PEOPLE OF`). Delete what the page does not print.
- **Letter slips in ordinary words** (`eartuly` for `earthly`): read every word; where the page prints the right word, set it and raise nothing.
- **Spacing before `;` `:` `?` `!` and inside quotation marks**: this compositor sometimes sets a space there (`the year around ;`, `(“ Mountains”`). Any visible gap is one space; a mark touching its word is set close. Do not normalise, in either direction, what you can see.
- **The contents page**: dot leaders are not text. Set each entry as `Chapter I` and its folio, and nothing between.

## Block kinds

The draft guessed each block's `kind` from its geometry. Where it is plainly wrong, give the right one as `"kind"` on that block in your output: `paragraph`, `heading`, `blockquote`, `footnote` or `caption`. A footnote is only what stands below the rule at the foot of the leaf. `CHAPTER I` is a `heading`. A quotation set off in smaller type is `blockquote`.

## Output

Write `OUT` — shape:

```json
[{"leaf": N, "blocks": [{"i": 0, "text": "...", "kind": "only where the draft's is wrong"}, ...],
  "add": [{"after": 3, "kind": "footnote", "text": "only for a block the draft left out altogether"}],
  "queries": [{"quote": "exact words as printed", "why": "...", "kind": "printers-error|inconsistent|unclear", "fix": "only for printers-error: the word as it should read"}]}]
```

Every block, corrected or not, with its `i`. Scanner junk (specks, the platen edge, a library stamp) — set the block's text to `""`; do not query it.

## Rules

1. **Transcribe as printed.** Spelling, punctuation, capitalisation as the page has them. Curly `“ ” ‘ ’` as printed. A line-end hyphen that only breaks a word is not printed text: join the word. A hyphen in a real compound stays.
2. **Accents are a prize.** Read them off the image. Where the image genuinely cannot settle one, set the letter bare and raise `unclear`.
3. **Mark emphasis**: `<i>…</i>` for italic runs, `<b>…</b>` for bold. Small capitals: plain capitals.
4. **Leave out** the running head and folio.
5. **Footnotes**: keep the reference mark in the text where the page sets it, and keep each note as its own block with its mark at its head. A note that runs over from the previous leaf has no mark on this leaf; do not give it one.
6. **Clear typos and damaged type** (a misspelling the page plainly makes, an unpaired quotation mark, a broken sort): transcribe **as printed** and raise a query with `kind: "printers-error"` and `fix` giving the word as it should read. The editor's standing ruling is that this class is corrected, so your `fix` is applied without anyone looking again: propose one only where it is certain. If the fix means **choosing** (where an unclosed quotation should close, which of two words was meant) it is not a printers-error: raise it `inconsistent` with no fix. A period or translator's spelling the book uses consistently is not an error.
7. **Before raising anything, read the whole block it sits in and the blocks either side**, and look for the same word or construction elsewhere on your leaves. A finding the paragraph settles is not a query.
8. Anything that is genuinely the editor's — the book contradicting itself, a sentence that does not construe — `kind: "inconsistent"` or `"unclear"`, transcribed as printed, **no fix proposed**.
9. A word broken by a hyphen across two blocks is set whole in the first block and removed from the second.
10. If a block holds two paragraphs run together, or one is split across two blocks, do not restructure — correct the text and note it in your report with the leaf and `i`.
11. A block the brief types `table` is regenerated from its cells, so prose written into it is thrown away. If a `table` block is really prose, correct the text and **say so in your report**.

Work leaf by leaf. Report back only: blocks changed per leaf, queries by kind, and anything a later batch should know about this book's type or either engine that is not already above.
