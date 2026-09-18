# Ledger: _Patterns of the Hypnotic Techniques of Milton H. Erickson, M.D._, Volume II

Grinder, DeLozier and Bandler, 1977, in the Grinder & Associates reissue.
Findings raised, confirmed and refuted, so the checks can be scored rather
than trusted. The shape is `LEDGER-isis-vol1.md`.

## The scan

- `scans/2163dab6e4751d34585a9589239be6b17b1f4c428ee5837c5ad10933a4fc49c6.pdf`,
  9.4 MB, from the Internet Archive (December 2023). 237 leaves, every one a
  photograph: a 300 DPI bilevel text layer over a 100 DPI colour background.
  The renders are sharp and level.
- The text layer is archive.org's OCR. `assessText`: mixed, 0.98 — 2% of
  words not words, stray symbols, digits inside words. Recon's own Tesseract
  reading at 300 DPI is what `draft` works from: 61,171 words.
- **The scan omits every blank verso.** The folio offset (folio − leaf) runs
  −5 at the Introduction, −4 from leaf 30, −3 from 43, −2 from 56, −1 from
  61, 0 from 74, +1 from 81, +2 from 90, +3 from 101, +5 from 115, +7 from
  166, +10 from 227, +11 from 233. Every step falls at a chapter seam — the
  earlier leaf closes a chapter and the next opens one, or a part title
  stands between — and the text was checked continuous across each. Nothing
  is missing but blanks. It means `folioOffset`'s vote is only good within a
  chapter, and the folio a leaf prints is the folio to believe.
- Front matter to discard: leaf 1 the title, leaf 2 the back-cover blurb with
  the price on it, leaf 5 the copyright page, leaf 6 a photograph OCR read as
  noise.

## The structure

- **110 leaves are transcript pages** in two columns, Erickson's words left
  and the analysis right, with a third column of notes on many leaves of
  Transcript I. Leaves 48, 107, 116–224 by the utterance numbers.
- Handled by `findPairedBands` (see `PROCESS-reading.md`, gap 2, and the
  CLAUDE.md entry). Measured over every leaf: 105 of the 110 divide on a
  clear band; the rest carry prose above the transcript or a dialogue column
  too narrow to take, and are named in the draft's `structural` for a hand.
- Dialogue stretches (leaf 135 and the like) come out a row a turn.
- The book gathers its footnotes at the end of each Part (`FOOTNOTES / 115`
  on leaf 112), so no notes are looked for at the foot of a transcript page.

## Rulings carried over from Volume I, and two of this volume's own

Personal reading copy, not for sale. No glossary, no introduction. Sense
over fidelity where sense is confirmed; a guess is logged as a guess.
Footnotes set at the foot of the leaf their reference falls on, at three
quarters of the body. Same design answers as Volume I — nonfiction, modern,
plain chapter openers, chapter running heads — **except the face**.

- **EB Garamond, not Crimson.** Measured with the app's own fontkit over
  every regular face on the shelf: Crimson Pro has no φ, no →, and none of
  the subscript letters; IM Fell, Baskerville and Caslon are worse; EB
  Garamond (and Junicode) carry every character this book's notation uses.
  `renderPdf` refuses a glyph with no width, so the face is not a matter of
  taste here.
- **Subscripts and superscripts in plain ASCII: A_t, A_d, V_i, V^e.** The
  book sets the 4-tuple's auditory tonal channel as A with a subscript t and
  the digital channel as A with a subscript d. Unicode has ₜ and ᵢ but no
  subscript d at all, and the app has no subscript markup, so no face can
  set the notation as printed. The underscore form is unambiguous ("At" is
  a word), consistent across the book, and can be swept into real markup
  the day the app has it. The first readers wrote a mixture — plain "At",
  "Aₜ", "ᵉ" — and a sweep unifies it once every batch has landed.
- **φ, → and ≠ as themselves.** The blank channel, the R-operator's arrow,
  and the tracking model's inequality.

## The reading

Readers are subagents given `BRIEF-reading.md` and a per-batch brief from
`scripts/batch.mjs`; every result goes through `batch.mjs --check` and lands
with `drive.mjs transcribe`, which cross-checks each leaf against the cached
OCR. Front matter (leaves 0–6, 8, 10) was written from the drafts by hand:
the covers, title page, copyright, dedication, the plate and the contents.

| Batch | Leaves      | Changed | Queries | Check                                                                                          |
| ----- | ----------- | ------- | ------- | ---------------------------------------------------------------------------------------------- |
| ch0-A | 7, 9, 11–17 | 25      | 6       | leaf 17 +7.8%: two displays set as tables, cell bars count                                     |
| ch0-B | 18–26       | 33      | 10      | clean                                                                                          |
| ch1-A | 27–34       | 24      | 6       | clean                                                                                          |
| ch1-B | 35–41       | 42      | 9       | clean                                                                                          |
| ch2-A | 42–50       | 38      | 10      | clean; leaf 48's dialogue is prose, not columns                                                |
| ch2-B | 51–59       | 15      | 10      | clean                                                                                          |
| t1a-A | 113–119     | 36      | 6       | −6 to −20% on the table leaves: spaced dots to one ellipsis; alphabetic words 125→125, 191→190 |
| t1a-B | 120–125     | 48      | 4       | clean once the check counted lexical tokens                                                    |
| ch3-A | 60–69       | 23      | 11      | clean; chapter title printed "Transderivatonal", kept                                          |
| ch3-B | 70–79       | 65      | 11      | clean; three body asterisks on 78–79 with no note printed                                      |
| ch4-A | 80–89       | 33      | 21      | clean                                                                                          |
| ch4-B | 90–99       | 70      | 9       | clean; a five-line passage the book sets twice on leaf 96                                      |
| ch5-A | 100–112     | 36      | 22      | leaf 100 +8%: six formula lines rebuilt from OCR noise, checked on the render                  |
| t1b-A | 126–135     | 64      | 1       | clean; leaf 135's dialogue column rebuilt by the reader                                        |
| t1b-B | 136–145     | 81      | 6       | clean                                                                                          |
| t1c-A | 146–155     | 56      | 10      | clean                                                                                          |
| t1c-B | 156–164     | 60      | 6       | clean; Transcript I ends on leaf 164                                                           |
| t2a-A | 165–175     | —       | 12      | clean                                                                                          |
| t2a-B | 176–185     | —       | 3       | clean                                                                                          |
| t2b-A | 186–195     | —       | 11      | clean                                                                                          |
| t2b-B | 196–205     | —       | 7       | clean                                                                                          |
| t2c-A | 206–215     | —       | 8       | clean                                                                                          |
| t2c-B | 216–225     | —       | 6       | clean; Transcript II ends on leaf 225                                                          |
| ch6-A | 226–236     | —       | 10      | clean; the Summary, the bibliography and the warning to the reader                             |

The check's word drift now counts tokens carrying a letter or digit
(`scripts/batch.mjs`): OCR reads the analysis column's `. . .` as three
tokens where a reader writes one, and leaf 118 scored −17% on that alone
with its lexical words unchanged. A dropped or invented passage is made of
words, and the check counts those.

All 237 leaves are landed, and `transcribe` reports the run complete. The
first reader on the sparse Vol. I leaf 28 and this book's ch3-B both met
body reference marks with no note printed on the leaf; this book gathers
its notes at the end of each Part (leaves 110–112, notes 1–8), and pairing
them to their marks is the apparatus step, after the reading.

## The apparatus, done

- Part I's eight notes were landed with plain-digit markers 1–8, and
  `pairs` showed exactly the false match Vol. I found: marker `6` had taken
  "at least 6 feet" on leaf 13, `7` the Magic Number on leaf 14, `1`
  "Example 1" on leaf 32. Re-landed through `transcribe` with the
  superscript characters as markers (leaves 110–112, and the bibliography's
  own ¹ on leaf 235), `pairs` reads 9 references, 9 notes, none orphaned,
  each under its own mark.
- **⁹ on leaf 27** is a 9 on the render, where the eighth and last note of
  Part I belongs; corrected to ⁸ and ruled, `kind:printers-error`.
- **⁴ on leaf 21** put back as a correction: "coordinate distinctions,⁴ are".
- **Six asterisks with no note printed** — leaves 63, 78 (two), 79, 81, 89 —
  declared bare, after the render of leaf 112 showed only the tail of note
  8 and no asterisked note anywhere.
- The "Footnotes" head and its "Part 1, Patterns II" line on leaf 110 are
  dropped, since the notes now sit under their marks; ruled `kind:unclear`
  so the decision is on the shelf.

## The rulings

215 queries, 220 rulings: every query answered from a hand list under the
standing rulings, plus five raised at the edition with a kind of their own
(the ⁹ above, the doubled comma round Haley's mark on leaf 233, the
sub-head leaf 95 sets twice, the "Footnotes" head, a stray apostrophe on
leaf 104). 150 corrected, 53 as printed, 12 noted. The corrections landed
as 121 book-wide sweeps checked one at a time against a dry run — every hit
on a ruled leaf or its neighbour, none elsewhere — and 14 more that the dry
run flagged, each decided from its contexts (`TOTES` with `--case`, the
`clues` on leaf 38 that the leaf-49 query had named the pattern of). The six
passages the compositor set twice were dropped by block-scoped `correct`
with the exact doubled span, found mechanically as the longest repeated
substring of the block rather than by eye. `queries` reports nothing
waiting and nothing decided-but-not-printed.

The notation is uniform: `A_t`, `A_d`, `V^i`, `V^e`, `K^i`, `O^i`,
`A_t^i_t/p`, `R_time_1`; `→` for every arrow the readers wrote as `-------->`
or `——>`; `{i/e}` as note 4 writes it. Prose "At" and "Ad" inside formulas
were corrected block by block, because "At" is a word.

## The edition

Same design answers as Vol. I but the face, EB Garamond at 11pt on 6×9,
`contentsDepth` 1. 232 pages, 9 notes placed and none dropped, 0 layout
warnings, `designFrom: the book file`, and every page's text extractable
(the three pages an unguarded scan calls noisy carry the combining macron
of C̄). Four faults in the app stood between the first proof and that, all
found by looking at rendered pages rather than the report:

- **The transcript tables printed their `<i>` tags** while also setting the
  words in italic — 479 "overfull" warnings and 260 pages, none of which
  said so. `normalizeTable` now reads a cell's markup the way a paragraph's
  is read; 232 pages.
- **The contents listed every heading level**, indented, where the original
  names chapters only: `contentsDepth` on the style profile.
- **`search—L-operator` and `when/where/how?...` were one box each** to the
  breaker: a token now breaks after a dash, a slash or an ellipsis run.
- **A ragged line could not hold one word.** The stretch sat on the space
  glue the break discards, so every single-token line in a narrow column was
  infeasible and the breaker set two tokens overfull instead: 43 warnings
  after the tokens were made breakable. Knuth's own ragged-right glue
  construction; 0.

A lesson from ch0-A: I landed it with the check red on leaf 17 because my
shell chained the two commands. The drift was legitimate, but the check
exists to be read first, and every batch since lands only on "Land it".
