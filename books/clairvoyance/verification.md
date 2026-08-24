# How this reading was checked

*Clairvoyance and Occult Powers*, Swami Panchadasi. 328 leaves.

This book was read before most of the checks existed, so it was re-checked
from scratch. The scan was re-read leaf by leaf to give it a second
independent reader it had never had.

## What the text rests on

Three readings of the same setting, which is one more than most books will
ever have — and the reason this one is worth measuring rather than merely
checking:

1. **The model pass** that produced the text.
2. **Tesseract on the same pixels**, read for this purpose. 328 leaves; only
   the final blank came back empty, and **no leaf needed a wider frame**, so
   unlike *The Human Aura* this scan has no clipped captures.
3. **A Project Gutenberg volunteer** (ebook 12480). An older text with no page
   anchors, so it was aligned to our leaves by fingerprint rather than split
   by markup — 314 of 328 leaves matched.

## Where the finished book stands

**99.7% agreement with Gutenberg**: 114 disagreements away from the seams in
about 85,000 words. Several of them are places where *this* edition is right
and Gutenberg is wrong — `occultist` where they print `occulist`, `vestigial`
where they print `vestigal` — and in two places this edition carries passages
Gutenberg is missing, because their source had a defect.

The prose audit on the introduction and glossary comes back **clean**: grade
9.1, one hedge, and it sits on a contested historical claim, which is where a
hedge belongs.

`checkConsistency` on the finished text returns three findings, all of them
legitimate words.

## What the earlier reading had, and had not

It had a sense pass over all 611 blocks with findings adjudicated against
crops — 187 corrections landed, and six of the eight slips found by
comparing against Gutenberg had **already been fixed** by it.

It had not: a second reader of its pixels, a clipped-capture check, or any
record in `answers` or `adjudicated` — the uncertainty gate and the second
reading pass have no record here, and two `uncertain` spans across 328 leaves
is implausibly few.

## The measurement that matters for other books

Most books will not have a Gutenberg text. So: of the places Gutenberg
disagrees with our reading, how many would our own tools have pointed at?

| | share |
| --- | --- |
| Found by our two readers (model pass vs Tesseract) | 46.5% |
| Found only by `stray-spelling` | 7.0% |
| **Our own tools together** | **53.5%** |

Nine of the apparent misses are `page NN` from the contents leaves, which the
alignment mishandles rather than the book getting wrong, and one is
Gutenberg's own transcriber's note. Set those aside and our own tools reach
about **61%**.

What still escapes is mostly one-letter substitutions where the two printings
genuinely differ — `illustrations`/`illustration`, `proven`/`proved`,
`aids`/`aid` — or where Gutenberg is the one in error (`hag`, `fends`). The
substantive misses are `experimentors`, `malling` and `itinerent`.

## What is still not verified

- Case, punctuation position and paragraph breaks were not checked here as
  they were for *The Human Aura*; the witness comparison strips all three.
- The alignment is by fingerprint, so the first and last few words of each
  leaf are arbitrary and were excluded from every count above.
