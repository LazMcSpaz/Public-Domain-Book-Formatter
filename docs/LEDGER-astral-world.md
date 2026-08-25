# Reading ledger — _The Astral World_

102 leaves of scan; 94 transcribed (leaves 2–95). Leaves 0–1 are the cover and
the archive.org digitisation notice; 96–101 are the publisher's advertisements
for other titles, two blanks and the back cover. None of those is the book, and
none was transcribed.

## The readers

| Reader          | What it is                                                                                                           | Independent of                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Ours            | Tesseract off the 300-dpi render, shaped by `@core/draft`'s geometry, then corrected leaf by leaf against the pixels | —                             |
| archive.org     | ABBYY OCR of the same scan, one HTML file per leaf, supplied by the editor                                           | our engine, not our pixels    |
| Typeset witness | An independently set modern edition, 16,376 words, supplied by the editor                                            | our engine **and** our pixels |

Project Gutenberg was unreachable: this container's proxy answers 403 to every
outside host, confirmed against `gutenberg.org` and `archive.org` alike.

## What each check raised, and what survived

| Check                                           | Raised  | Confirmed            | Refuted | Became a query |
| ----------------------------------------------- | ------- | -------------------- | ------- | -------------- |
| `witness` — ours vs archive.org, 90 body leaves | 58      | 21                   | 37      | 0              |
| Three-way diff — ours vs the typeset witness    | 91 runs | 12                   | 79      | 0              |
| `consistency` over the pristine text            | 4       | 1                    | 2       | 1              |
| Reading every leaf against its render           | —       | 109 ops on 68 leaves | —       | 6              |

"Refuted" is overwhelmingly one thing and not an error rate: hyphenation and
line-break artefacts of the comparison itself (`sub-planes` against `sub
planes`, `suf- ficiently` against `sufficiently`), and page furniture that we
moved to `furniture` and the other readers left in the text.

Mean agreement with archive.org across the 90 body leaves: **0.9658**.
Similarity to the typeset witness after correction: **0.9935**.

## What the second and third readers were actually worth

Five substantive corrections were found by a witness and settled by the pixels,
and would very likely have been missed by eye alone, because each is a real
English word in a plausible place:

| Leaf | OCR read                | The paper says          | Found by        |
| ---- | ----------------------- | ----------------------- | --------------- |
| 9    | `dc not lie`            | `do not lie`            | witness         |
| 28   | `advanced occuitists`   | `advanced occultists`   | witness         |
| 34   | `friends with thern`    | `friends with them`     | witness         |
| 47   | `Christian Church held` | `Christian Church hold` | typeset witness |
| 85   | `various mames`         | `various names`         | witness         |

Leaf 47 is the one that earns the third reader on its own: `held` and `hold` are
both words, both scan, and nothing mechanical without a second opinion would
have looked twice.

Two findings were **refuted at the pixels** and are recorded so the check can be
scored rather than trusted: `stray-spelling` proposed `fourth` for `forth` in
"more of its kind will come forth from that place", and `sights` for `sighs` in
"as a dove sighs for its far-off home". Both are correct English and both were
left alone.

## The systematic faults, which no witness found

These came out of reading the leaves and are invisible to a text comparison,
because both OCR engines make them:

- **Eleven drop capitals.** Every chapter opens with one and OCR either dropped
  the letter or read it as noise: `VERY student` for `EVERY student`,
  `AISING` for `RAISING`, `\ A fa` for `WITHOUT`. All eleven are restored.
- **Nine running heads left in the text**, where the folio beside them was
  misread and the draft could not tell furniture from a first line.
- **Ten spurious blocks** — specks the OCR read as punctuation, and on leaf 52
  the **University of Illinois library stamp**, which would otherwise have
  printed inside chapter VI.
- **Three mangled asterisk rows**, the author's own section breaks, which came
  back as `k kx kk kk kk x` and are now set as centred rows of eight.

## What only the rendered page showed

Everything above was clean, all three readers agreed, `consistency` was down to
two known false positives, and the book was already pushed to the shelf. Then
the first proof came back with **301 broken hyphens printing mid-line**:

> But even he finds constant ref- erence to the subject…

`draftPage` joins OCR lines with a space, so the 1915 setting's line-break
hyphens survive into the text as `ad- vanced`. Nothing downstream heals them:
assembly's hyphen healing runs at page **seams** only, and `src/core/draft/index.ts`
says so in its own comment. No unit test can see this, no witness comparison
raises it (both OCR engines break the lines in the same places), and every one
of the 90 leaves had been read by eye without it registering, because the draft
shows the same break the paper does.

It was settled with a witness rather than a rule, because `counter-part` heals
and `thought-transference` must not. The independently typeset edition sets the
same words with its line breaks in different places and carries no broken
hyphens of its own, so it can say which of the two a compound is. **251 pairs
joined; 12 kept their hyphen** (`sub-plane`, `thought-form`, `free-and-easies`,
`praise-worthy`, `earth-lives` and the rest), each because that witness or
archive.org's reading prints it hyphenated.

The proof also turned up four stray quote marks the OCR had read out of specks,
including `entering a strange ‘region`. A scan for a quote glued to a lower-case
word found those four among 130 legitimate ones.

**The lesson is the one already written down in `PLAN-next.md`, and it held
again: the next fault is found by a real page, not by a reader.** Proof before
you believe the checks, not after.

## Queries raised

Eight, none of them settled here. Six printer's errors and two places the book
contradicts itself. See `queries.md`. The eighth came out of writing the
glossary rather than out of any check: the book sets _etheral_ on two leaves and
_ethereal_ in full on two others, and the typeset witness disagreed with us on
one of the four, so it went to a 500-dpi crop, which reads _ethereal_.

## The trim, measured rather than estimated

Settled by the editor at **6 × 9, 12 pt**. Measured through the engine, with
each book's editorial matter actually in it, which the research brief's table
predates:

| Volume                                                        | Pages at 6 × 9 / 12 pt | Spine (KDP needs 79) |
| ------------------------------------------------------------- | ---------------------- | -------------------- |
| _The Human Aura_ (88 leaves, no introduction or glossary yet) | 65                     | **short by 14**      |
| _The Astral World_ (94 leaves, introduction + glossary in)    | 89                     | clears               |
| _Clairvoyance_ (328 leaves, introduction + glossary in)       | 332                    | clears               |

The Aura is the binding constraint for the set, as it always was. Its editorial
matter does not exist yet; this book's introduction and glossary come to 5,400
words and added 18 pages at this trim, so roughly 4,200 words of introduction
and glossary would carry the Aura past 79. That is a modest requirement, and
_Clairvoyance_'s glossary alone runs to 6,852 words.

**Measuring this turned up a driver fault.** `load` wrote a run but did not make
it current, so with two books on the device every later verb went on reading the
one before. The first Aura measurement came back as _The Astral World_'s page
count, to the page, twice — which is the only reason it was caught. Fixed in
`scripts/drive.mjs`: `load` now adopts what it loaded and says so, the way
`open` does. It is the same fault Phase 0 of `PLAN-next.md` was written to
close, in the one verb that was missed.

## Rulings applied

Two, both carried over from this shelf rather than invented for this book: the
British/American spelling mix is kept and told to the reader, and one plain
compositor's error (`varietites`) is mended under the standing ruling that
obvious printer's errors are fixed. That mending lands as an **edit over the
pristine text**, not as a rewritten transcription: the leaf is transcribed as
printed. See `rulings.md`.
