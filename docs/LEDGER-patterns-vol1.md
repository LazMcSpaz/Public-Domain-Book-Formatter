# Ledger: _Patterns of the Hypnotic Techniques of Milton H. Erickson, M.D._, Volume I

Bandler and Grinder, 1975, in the Meta Publications setting. Findings raised,
confirmed and refuted, so the checks can be scored rather than trusted. The
shape is `LEDGER-isis-vol1.md`.

**Written late, and the gap is part of the record.** This book was read,
corrected, ruled on and exported without a ledger, across several sessions and
several chats. Most of what follows is recovered from the artefacts — the book
file, `rulings.md`, `corrections.md`, and the checks re-run over the finished
volume. **The reading itself is not recoverable** and is marked so below rather
than reconstructed. Why it went missing is in **What this book cost the
process**, at the foot.

## The scan, which is not a scan

- `scans/fe9ba777dc3dde455f2a9c0a91e6407389ac2842bdb7e63dfcfba064b4b8ba78.pdf`,
  **512 KB**, `Producer: Acrobat PDFWriter`, made in 2016. 121 leaves and
  **not one page image in it.** It is somebody's OCR of the 1975 typescript,
  printed to PDF.
- `looksScanned` says not a photograph — correctly — so the text was read
  straight out and **every one of 81,743 words was stamped confidence 100**.
  `assessText` scored it **trustworthy, 0.998, no signals** — also correctly,
  because it measures character garbage and there was none.
- **Both verdicts were right and the file still needed 465 corrections.** Two
  questions were being answered by one test: _is the page a photograph?_ says
  whether the geometry can be trusted, and it had been taken to mean the
  characters could be too.
- **There are no pixels, and there is no getting any.** Rendering a leaf draws
  the text layer again. The ruling on leaf 38 states it: _"This copy is
  born-digital and has no independent witness."_ Every check on this book has
  had to stand in for a crop.

## The structure

- 121 leaves, three Parts plus a Preface by Erickson, Acknowledgments, an
  Appendix of presupposition environments and a bibliography.
- Pristine block kinds: 1,001 paragraphs, 500 blockquotes, 81 headings, 45
  footnotes, 45 tables, 7 captions. The blockquote count is the book's method
  — it is a training manual and sets its examples out displayed.
- **80 headings arrived with no level**, each opening a page, because the
  conversion had flattened the type sizes. 52 `retype` edits set them.
- 15 pictures, supplied as `images/<digest>.png` — cut from the figures the
  conversion left as raster.

## The reading

**Not recoverable.** It happened across several chat sessions before this
ledger existed, and no record of the batching, the drafts or what the readers
caught survives in the repository. What can be counted is what it left:

|                                                  | the reading left | this session added |     now |
| ------------------------------------------------ | ---------------: | -----------------: | ------: |
| `text` corrections                               |              279 |                 11 |     290 |
| `split` (a line break the conversion dropped)    |               61 |                  1 |      62 |
| `drop` (furniture, labels, the back-cover blurb) |               57 |                  — |      57 |
| `retype` (heading levels, one paragraph)         |               51 |                  1 |      52 |
| `image`                                          |               15 |                  — |      15 |
| `note-text`                                      |                2 |                  — |       2 |
| **total**                                        |          **465** |             **13** | **478** |

Seventeen corrections were made this session against eleven new `text`
edits, because five of them landed on blocks a reader had already corrected
once — which is the shape of the finding below.

That this section cannot be written is the finding. See the foot.

## The rulings

17 queries raised over the life of the book, 14 ruled in the reading sessions,
**3 raised in this one and still waiting**. Kinds: 10 `inconsistent`, 6
`printers-error`, 1 `unclear`. Full text in the book's own `rulings.md` and
`review.md`.

The three standing decisions that did the most work:

- **A misspelling the book makes consistently is still the book's.**
  `cerebral assymetry` is set with two s's all three times, including inside
  the title of Dimond and Beaumont's _Bilateral Asymmetry in Hemispheric
  Function in the Human Brain_, whose own title page has one. Corrected, at the
  editor's direction, **including inside the other book's title** — a reprint
  that keeps another book's title misspelled is passing on the error rather
  than reproducing it.
- **A name the book spells five ways one way and twice another is settled by
  the count.** `Gardiner` on leaf 38 against `Gardner` on leaves 9, 87, 91 and
  in the bibliography; _The Shattered Mind_ (Knopf, 1975) is Howard Gardner's.
  Three occurrences changed.
- **One guess, logged as one.** `Way situation is decaying.` in a table of
  noun phrases without referential index: every other row is a well-formed
  sentence and the left column was capitalised on this row alone. Read `My`.
  Nothing in the book confirms the word, and the ruling says so.

## The apparatus

- **45 footnotes**, renumbered through the book, 26 placed in the current
  export and none dropped. The original gathers its notes at the back of each
  Part; this edition sets them at the foot of the leaf the reference falls on,
  at three quarters of the body size, with superscript marks as the original
  prints them.
- **Two of Part II's notes carry no reference mark anywhere in this copy** and
  cannot be placed. They are kept where the original prints them, under its own
  heading.
- **0 bare marks** declared. The volume needed none.
- No glossary, no editor's introduction, no fact bank (`facts: 0`), no reading
  marks. This book has **less apparatus than the Panchadasi volumes** and
  nothing anywhere says so — see the foot.

## The checks, scored

The number that matters. Run over the **assembled** book after it had been
read, corrected 465 times, ruled on, exported and marked `complete: true`:

| Check                          | Raised | What became of it                                                                    | Cost     |
| ------------------------------ | -----: | ------------------------------------------------------------------------------------ | -------- |
| `checkDamage` split-word       |      3 | 3 corrected                                                                          | free     |
| `checkDamage` stray-point      |      7 | 7 corrected, one of them the run-in quotation                                        | free     |
| `checkDamage` stray-apostrophe |      6 | 6 corrected                                                                          | free     |
| `findParallels` pointing       |      6 | 1 corrected, 3 raised as queries, 1 corroborating a `checkDamage` finding, 1 refuted | free     |
| **total**                      | **22** | **17 corrected · 3 raised · 1 corroboration · 1 refuted**                            | **free** |

**`checkDamage`: 16 raised, 16 real, no false positives.** It returned
nothing that was not damage. Read that as a floor rather than a ceiling — a
check that misses nothing on its first book may simply be too tight to be
finding everything, and it is worth re-scoring on the next volume.

**`findParallels`: 5 of 6 pointed at something real**, and the sixth is the
honest kind of miss: leaves 12 and 98 set two genuinely different sentences
that share most of their words. Three of the five are the book setting the
same matter two ways and are the editor's to rule on, not faults.

Two findings were settled by the book rather than by sense. Leaves 7 and 100
print the same sixty words of the Surface Structure passage, converted
independently a hundred leaves apart, and **each copy is damaged where the
other is clean** — leaf 7 has `representation'`, leaf 100 has `Structure'`.
That pair is the argument for `findParallels` and it came from this volume.

**Three or four of the seventeen the editor found by reading twenty pages.**
The rest nobody had looked for.

## The edition

- 274 pages, **0 layout warnings**, 26 notes placed, 0 notes dropped, 0 images
  dropped, no font substitutions.
- `book-files.mjs --body`: in step. 348 corrections and 24 reference marks in
  `corrections.md`.

## What this book cost the process

Six things, all fixed, each with the thing that catches it next time.

1. **A PDF with no page images passed every check.** `looksScanned` and
   `assessText` were both right and the conclusion drawn from them was wrong.
   Fixed: the intake note for an embedded-text PDF says what such a file is,
   `describeAssessment` no longer says "can be used as it stands", and
   `draftPage` takes a heading's level from its type size.

2. **A correction typed as plain text threw the paragraph's italics away.**
   44 corrected blocks lost **188 emphasis runs** between them — every book
   title in the bibliography, every phrase the authors set apart. Nothing
   reported it: a block with no emphasis looks exactly like a block with no
   emphasis. Repaired by diffing against the stripped pristine and replaying
   into the marked one. Fixed: `correct` now **refuses** a whole-block
   replacement that would take a block's tag count to zero, with `--bare` to
   say it was meant.

3. **A reference mark on a chapter title reached the contents and the running
   head.** Each Erickson article reprinted here carries its journal citation on
   its title, so the contents read "…and Pain Control⁷" and every page of the
   article was headed the same. Fixed: `headingsWithoutMarks`, one lookup both
   consumers use.

4. **A marker in superscript digits is a run, exactly as `**` is.** `¹` matched
   inside every `¹⁰`…`¹⁷`, and the overlap guard came too late for the count.
   Fixed: `footnoteMarkerPattern` builds the same lookarounds for a superscript
   marker as for a plain digit.

5. **Seventeen conversion faults survived to the finished book**, and two of
   the three split words stood **twice** in the pristine text and **once** in
   the edited one — met, corrected, and never swept for. Fixed:
   `checkDamage`, `findParallels`, and `drive.mjs damage --check` as an export
   gate. The counter-example in the same book is the model: `arc` for `are`,
   15 occurrences, 14 corrected and the one left a real arc.

6. **This ledger did not exist until the book was finished.** Three of eleven
   books on the shelf have one. The instruction is not unclear — it is stated
   in `CLAUDE.md`, in `PROCESS-reading.md` and as its own numbered section in
   `HANDOFF.md`. A rule stated three times and kept three times in eleven is
   not a comprehension problem. What is missing is structural, and it is the
   same diagnosis this file makes about everything else here: **nothing checks
   it.** `HANDOFF.md`'s own "Before you stop" list names five commands and the
   ledger is in none of them; `book-files.mjs --check` exists for exactly this
   failure and covers the other four derived files. The ledger also lives in
   the _formatter_ repository while the book lives on the shelf, so it is the
   only per-book record that does not travel with its book — and it is written
   last, at the end of the longest job, which is when a session is nearest its
   limit. See `PLAN-next.md`.
