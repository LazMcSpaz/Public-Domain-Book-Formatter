You are correcting a machine reading of up to ten leaves of a book on NLP (neuro-linguistic programming), against photographs of those leaves.

BOOKNOTES

**What the text is for.** This book is being read for **personal study**: the text will be used to build a course that synthesises several NLP books. It will not be published. So the standard is **the right words in the right structure**, not a facsimile. Spend your care on: every word right, nothing dropped or doubled, nothing out of order, and the book's structure (chapters, headings, lists, exercises, examples, dialogue) visible. Do **not** spend it on spacing, the exact style of quotation marks, or italics.

**You are NOT transcribing from the image.** You are given a text OCR produced and the image it came from; your job is _where do they differ?_ Never retype a page from the picture. Change what you can see is wrong.

## Inputs

Brief: `BRIEF` — an array, one entry per leaf: `leaf`, `image` (a 300 DPI PNG — read it with the Read tool), `blocks` `[{i, kind, text}]` (keep `i`). Ignore `secondReader` and `disagreements`; they are empty.

Use `WORKDIR` for scratch files. Do not write anywhere else. To look closer: `node scripts/reading-kit/crop.mjs <image> WORKDIR/c.png <x> <y> <w> <h> [scale]` (run from `/home/user/Public-Domain-Book-Formatter`).

## What to fix

1. **Words.** Every misread word (`MAPPNG` → `MAPPING`, `Tue` → `The`, `1` or `|` for `I`, `rn` for `m`), every word or line OCR dropped, doubled or moved. Read the whole leaf against the image; a clean-looking paragraph can still have lost a line.
2. **Line-end hyphens**: join the word (`automo- bile` → `automobile`). A real compound keeps its hyphen (`self-talk`).
3. **Junk**: running heads, folios, page-edge bars `|`, specks, bleed-through, decorative glyphs (`¢`, `¥`, `®` before a heading) — delete; a block that is only junk becomes `""`. Running heads and folios are never text.
4. **Headings**: give every heading `"kind": "heading"` and a `"level"`: `1` for a part or chapter title, `2` for a section head, `3` for a sub-head. A chapter number line and its title are two blocks, both headings, level 1. Headings the draft typed `paragraph` or `blockquote` are common.
5. **Lists and bullets**: OCR turns a bullet into junk (`I»`, `=`, `p>`, `#`, `m`, `@`). Set each bullet item as its own `paragraph` block starting `• ` — if the draft ran several items into one block, keep the first in that block and add the rest with `add` (`after` = the block's `i`; several adds after the same `i` keep their order). A numbered step keeps its number (`1.`).
6. **Boxed matter** (sidebars, tips, "Remember", "Warning", exercise boxes, the Dummies icons): keep the text, typed `blockquote`, and start it with the box's label in square brackets if it has one (`[Tip] …`, `[Remember] …`, `[Try this] …`). The icon picture itself is not text.
7. **Dialogue and transcripts** (a trainer and a participant, a script to say to a client): keep each speaker's turn as its own paragraph, with the speaker label as printed.
8. **Split blocks**: where the draft cut one paragraph into several blocks, mark each continuation `"join": true`. Where one block holds two paragraphs, split it: keep the first in the block and `add` the second after it.
9. **Tables and diagrams**: a table becomes one `paragraph` per row, cells separated by `|`, and say so in your report. A diagram or chart keeps its caption (`Figure 3`, typed `caption`), and **its labels are content for study**: add one `caption` block after it that describes the diagram in a sentence and gives every label in reading order — `[Diagram: a circle headed KIDS (needs), in four quadrants. Financing: want good interest rate; …]`. Delete the scattered label fragments OCR made of it. A purely decorative picture gets only its caption.
10. **Front and back matter**: a copyright page, contents, index, "about the author", advertisements — correct them only roughly; the words matter less there. An index or contents may be left as the draft has it, only junk removed.

What to leave alone: thin spaces, straight versus curly quotes, italics and bold (keep any `<i>`/`<b>` already there; do not add them), the book's own typos (set as printed, no query), and a word split across two leaves (leave both halves as printed; assembly joins them).

Queries: raise one only where the page itself cannot be read (a torn corner, a smear over a word) — `kind: "unclear"`, the words either side as `quote`, no fix. Nothing else is a query in this book.

## Output

Write `OUTFILE` — shape:

```json
[{"leaf": N, "blocks": [{"i": 0, "text": "...", "kind": "only where the draft's is wrong", "level": 1, "join": true}, ...],
  "add": [{"after": 3, "kind": "paragraph", "text": "• the second item"}],
  "queries": []}]
```

Build the output with a small script (Node or Python) that reads the brief, applies your corrections and writes the file — do not paste long passages of the book into your replies. Every block, corrected or not, with its `i`. `level` only on headings, `join` only where it applies, `add` only where needed. Work leaf by leaf and check the JSON parses before you finish.

Report back only: blocks changed per leaf (a number each), any tables or diagrams, any query, and anything a later batch should know about this book's type or the OCR that is not already above — in a few lines.
