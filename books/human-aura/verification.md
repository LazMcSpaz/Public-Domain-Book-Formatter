# How this reading was checked

_The Human Aura_, Swami Panchadasi, Advanced Thought Publishing Co.,
Chicago, 1916. Eighty-eight leaves.

## What the text rests on

Two independent transcriptions of the same setting:

1. **Tesseract on our own scan** — 16,621 words off our own pixels.
2. **A Project Gutenberg volunteer**, proofread against a scan of this
   printing. (Their file is set from a 1940 Yoga Publication Society
   reprint, so its _front matter_ describes a different book. The body
   agrees with ours at 88%, and every disagreement was looked at.)

Where these two agree, our own pixels produced that word through an OCR
engine. That is what makes agreement evidence rather than assumption.

## What was looked at, and what it found

| Check                                        | Flagged                         | Real faults |
| -------------------------------------------- | ------------------------------- | ----------- |
| Word identity (`witness`, 286 disagreements) | 64 cropped, 6 leaves read whole | **2**       |
| Capitalisation, case-sensitive               | 9                               | **0**       |
| Sentence-ending punctuation, by count        | 4 leaves                        | **0**       |
| Paragraph breaks, draft geometry vs markup   | 23 leaves                       | **0**       |
| Italics                                      | 2 marked, both cropped          | **0**       |
| `@core/coherence` consistency                | 2                               | **2**       |
| Leaves with incomplete pixels                | 3                               | **3**       |

**Of 64 words cut out of our scan and looked at, 58 read on the paper
exactly as the second transcription had them** — `tlairvoyant` was
`clairvoyant`, `snbstance` was `substance`, `gresn` was `green`. Our own
OCR was the party in error nearly every time. That is what earns a second
transcription the standing of a checked witness rather than an assumed
one, and what makes the exceptions worth an editor's time.

The nine capitalisation flags were every one of them a sentence-initial
capital or a proper noun that Tesseract had simply not seen that
occurrence of — `Many writers on the subject`, `the three Astral Primary
Colors`. Nothing was wrong.

The paragraph flags were the draft's own over-segmentation: leaf 42 was
reported as ten paragraphs against two, and the paper prints two. Leaf 79
the same. The check is noisy from the draft side and clean from the book's.

The apparent italics on the last line of several leaves are the scan's
bottom curl, not type: they appear only ever on the final line, and on
leaves whose text is set roman throughout.

## What it caught

- **Project Gutenberg's licence text** sitting in leaf 85. Found by the
  consistency check on `including including`, which is what a `<pre>`
  block folded into a paragraph looks like.
- **Leaf 57** read as 113 words of a 202-word page — its capture is placed
  so the page box shows only the left half of every line. Recovered whole
  by rendering everything the page draws.
- Two places the second transcription had silently mended the compositor:
  `perscription` on leaf 75, and the contents calling chapter V "The Aura
  Kaleidoscope" where the chapter is headed "THE AURIC KALEIDOSCOPE".

## What is still not verified

- **Leaf 45** has no pixels at all for its first two lines. The capture is
  magnified and their line is outside the frame; rendering the whole drawn
  image recovers nothing, because there is nothing more in the file. The
  words there are attested by two transcriptions and by neither of our own
  readings of our own paper. This is query 45.
- **Leaf 37** reads only noise through Tesseract even from the wider
  frame, so its words rest on the second transcription and on this
  editor's own reading of the render, which is legible but for a few
  characters at each line's right edge.
- Punctuation was checked **by count, not by position**. A comma moved
  rather than added or dropped would not show. The one missing full stop
  found in this book was found by eye.
