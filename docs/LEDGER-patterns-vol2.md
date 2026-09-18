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

The check's word drift now counts tokens carrying a letter or digit
(`scripts/batch.mjs`): OCR reads the analysis column's `. . .` as three
tokens where a reader writes one, and leaf 118 scored −17% on that alone
with its lexical words unchanged. A dropped or invented passage is made of
words, and the check counts those.

Part I and Transcript I — leaves 0 to 164 — are landed: 165 of 237. The
first reader on the sparse Vol. I leaf 28 and this book's ch3-B both met
body reference marks with no note printed on the leaf; this book gathers
its notes at the end of each Part (leaves 110–112, notes 1–8), and pairing
them to their marks is the apparatus step, after the reading.

A lesson from ch0-A: I landed it with the check red on leaf 17 because my
shell chained the two commands. The drift was legitimate, but the check
exists to be read first, and every batch since lands only on "Land it".
