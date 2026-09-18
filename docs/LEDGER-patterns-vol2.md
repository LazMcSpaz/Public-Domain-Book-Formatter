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

## Rulings carried over from Volume I

Personal reading copy, not for sale. No glossary, no introduction. Sense
over fidelity where sense is confirmed; a guess is logged as a guess.
Footnotes set at the foot of the leaf their reference falls on, at three
quarters of the body. Same design answers as Volume I: nonfiction, modern,
Crimson, plain chapter openers, chapter running heads.

## The reading

Not begun.
