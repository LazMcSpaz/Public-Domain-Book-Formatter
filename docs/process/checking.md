# Checking: proving the read text

## Purpose

Run every check that applies to the book's shape, settle what they find
against the page, and record the results. When this job is finished the book
is **checked** ([README.md](./README.md)).

## Who runs it

The **scan checker**. The deterministic checks can be run by the session that
did the reading; the adjudication (step 7) must be done by a fresh reader that
did not raise the findings.

## Before you start

- The book is **read** ([reading.md](./reading.md)) and loaded from the shelf
  ([sessions.md](./sessions.md)). Its shape and route are known
  ([FLOW.md](../FLOW.md)).
- The editor is not working in the app, if you will save.
- Measure the **assembled** book (`drive.mjs body`), never `book.json`'s
  transcriptions or a rebuild keyed `p{page}b{index}`. Block ids are made at
  assembly, which joins paragraphs across page seams; one sweep run over a
  rebuild reported 24 faults, eight of which did not exist.

## Steps

1. **Free checks first**, because they cost nothing: C1, C2 and C5 below, and
   `node scripts/drive.mjs consistency out.json` (a name spelled two ways, a
   doubled word, a quotation never closed, a reference to a missing chapter).
   Score each check per book in the ledger; never tune a threshold to make a
   book pass.
2. **Read every flagged place with its whole block.** The sheet `damage`
   writes carries the whole paragraph because the paragraph usually settles
   it. Return a verdict per finding, never rewritten text.
3. **Fix a class with a sweep, carefully.**
   `node scripts/drive.mjs sweep --was "<text>"` only finds;
   `--now "<text>"` writes, and there is no dry run. Read every hit and its
   case first. A sweep matches the string, not the word (`Herschel` is inside
   `Herschell`), so sweep a phrase long enough to be the whole word;
   `scripts/reading-kit/variants.mjs` prints `SWEEP UNSAFE` for this. Without
   `--case` a hit's capital can be lowered; after a spelling ruling always use
   `--case`. When you fix a fault once, sweep the volume for the same fault:
   two split words in one book were fixed once and missed once. An `attested`
   damage finding lands through `sweep`, after a person agrees the class is
   real, never one block at a time and never automatically.
4. **Crop before joining or moving anything.** A page-turn finding was right
   about nine times in ten, not ten. Crop the turn
   (`node scripts/drive.mjs leaf <n> <name> 600 <x,y,w,h>`) and join only what
   the paper runs on. A line the coverage check says is missing comes from the
   page, or from a second copy of the same printing.
5. **Italic and Greek.** Where a witness exists, `scripts/emphasis-of.ts`
   ([reading.md](./reading.md)); crop a sample of its findings first. Read
   `damage`'s `greek` list against the scan: Greek garbled into Latin letters
   (`Xpbvos` for Χρόνος) passes every shape test.
6. **Read for sense**, a chapter at a time:
   `node scripts/drive.mjs chunks out.json`. Give every reader the book's own
   vocabulary. A reader returns **findings, never text**: a block id, an exact
   quote, a kind, why, and what it expects, marked as a guess.
7. **Adjudicate every finding against the page, blind.**
   `node scripts/drive.mjs crops findings.json` cuts a crop per finding and
   strips the reason and the guess; a fresh reader says what the paper says;
   `node scripts/drive.mjs review findings.json verdicts.json` writes the sheet
   (`sense.md`) with the score at its foot; a correction is built from the
   verdict, never from the guess. Shown both, a model
   confirms; shown the crop alone, it reads. On a book with no page images use
   a second digitisation first, then
   `node scripts/drive.mjs concordance findings.json`: a place with a parallel
   is settled, a place with only context goes to the editor as a query.
8. **Run the crop pass over the queries too**, before the editor sees them.
   One confident query once described a page that does not exist. Withdraw a
   refuted one with `drive.mjs unquery <leaf> <quote> "<reason>"`.
9. **The editor decides.** The verdicts and queries go to him as one sheet:
   the crop, what the paper says, what was proposed, what the checks made of
   it. `node scripts/drive.mjs link review` opens the book where decisions
   wait. Nothing reaches the book until he has looked.
10. **Look at rendered pages before believing the checks**
    (`node scripts/drive.mjs proof 1 9 40 "answers=<book.json>"`). Several
    faults here were invisible in every count and obvious on the page.
11. **Keep the ledger.** For the sense pass and every check: raised, confirmed,
    refuted. If few findings survive the pixels, tighten or drop the pass; a
    check nobody scores manufactures confidence.
12. **Record the results**: run `node scripts/readiness.mjs <book-dir>` (below).
    Its report, `readiness.md` beside the book, names every check in the list
    as passed, failed, needs a person or NOT CHECKED with its reason. Note the
    verdict and the date under a dated heading in `ledger.md`.

## Checks that must pass: the full list for "checked" and "ready to upload"

This is the only copy of the list: [export.md](./export.md) and
[upload.md](./upload.md) point here, and the readiness command is built from
it (`src/core/coherence/readiness.ts` holds the same list, item for item).

```bash
node scripts/readiness.mjs <shelf>/books/<book>                     # "checked": C1 to C12
node scripts/readiness.mjs <shelf>/books/<book> --interior <file> \
  --softcover <file> --hardcover <file> --epub <file>               # "ready to upload": and R1 to R11
```

Each file is a local path, a storage key, or the path it had on the shelf
(`STORAGE.tsv` gives its key); keys are fetched into a scratch folder outside
both repositories, and each file's SHA-256 goes in the report. It runs every
command below and reads its exit code and output; the driver's checks run only
when `drive.mjs serve` is up with the book open, and are NOT CHECKED otherwise.
`--export-report <proof.json>` gives R2 and R3 the saved output of the
`proof` run that wrote the interior; `--witness <w.json>` gives C6 its italic
witness. It writes `readiness.md` beside the book (never into this
repository), prints the verdict, and exits 0 only when the stage asked for is
reached: _checked_ when every C item passed or was signed off, _ready to
upload_ when every C and R item did. Anything NOT CHECKED or FAILED blocks the
stage. Read the report out to the owner with the verdict; never say "ready"
without it.

"(proposed check)" means nothing automates it yet: the readiness command
reports it as NEEDS A PERSON, and it counts only when done by hand and signed
off.

**Signing off a check a person does.** An item marked NEEDS A PERSON (the
spelling sheet, pages looked at, a list of findings to read) counts only once
`ledger.md` has a line in this form, above "By the numbers" (which
`book-files.mjs` rebuilds), best under a `## Readiness sign-offs` heading:

```
Signed off: R1 <sha256 of the file> 2026-11-19 the owner read the spelling sheet; every word kept or corrected
```

The check, the full SHA-256 the report prints beside the item (the upload
file for R items, `book.json` for C items; both covers for R7 and R10), the
day it was done, and who did it and what was decided. The report gives each
item its line with the fingerprint filled in. A sign-off counts only for that
exact file: a new export or a new save of the book needs a new line. The
person who did the reading writes it, or says so and the session writes it;
a session never signs off a reading it did not see done. A FAILED or NOT
CHECKED item cannot be signed off.

**For "checked"**, on the book as it stands on the shelf:

- **C1 Conversion damage.** `node scripts/drive.mjs damage --check`. Exists; exit code.
- **C2 Damage, apparatus, consistency, rulings not yet in the text.**
  `npx vite-node --config vitest.config.ts scripts/checks-of.ts <book.json> --check`. Exists; exit code.
- **C3 Paragraphs broken at a page turn.**
  `npx vite-node --config vitest.config.ts scripts/page-turns-of.ts <book.json> --check`.
  Exists; exit code; crop each finding. Text half only when there is no `recon.json.gz`.
- **C4 Lines lost or moved, against a second reading.** Scan routes:
  `npx vite-node --config vitest.config.ts scripts/coverage-of.ts <book.json> [--second <second.json>]`
  (refuses when too few leaves carry words: make one with `drive.mjs second`).
  No-pixel routes: `node scripts/drive.mjs witness <second.json>` and
  `node scripts/drive.mjs parallels`. Exists; read the findings.
- **C5 Footnotes under their own marks.** `node scripts/drive.mjs pairs`, and
  `node scripts/drive.mjs notes n.json --full` with none orphaned. Exists; read.
- **C6 Italic kept.** `italics-absent` inside C1; `scripts/emphasis-of.ts`
  where a witness exists. Exists.
- **C7 Glossary marks, rulings applied, ledger, shape, every query ruled (a
  crop for any still waiting).** `node scripts/drive.mjs finish <book-dir>`.
  Exists; exit code.
- **C8 Readable files in step.** `node scripts/book-files.mjs <book-dir> --check`
  and `node scripts/drive.mjs corrections <book-dir> --check`. Exists; exit code.
  The readiness command runs the first with `--body` (the body from
  `scripts/body-of.ts`), which checks the entries of `corrections.md` by the
  same derivation, so this item needs no driver.
- **C9 Same apparatus as the last comparable book.**
  `node scripts/book-files.mjs --shelf <shelf>/books/`. Exists; read the row.
- **C10 Editor's prose audited** (hedges, dismissals, banned phrasing, reading
  directions, long dashes).
  `node scripts/voice.mjs audit <book.json> --name "Etsu T. Dhent" --shelf <shelf>`.
  Exists; exit code; `finish` does not run it.
- **C11 No working notes in the text**, such as "(delete)".
  Every lower-case `(word)` in section and note text and in the book folder's
  `.md` sheets (the readiness report's own excepted). Run by the readiness
  command: a working-note word ("(delete)", "(check)", "(TK)" and the rest of
  `WORKING_NOTE_WORDS`) fails; list marks such as "(a)" and "(iv)" and "(sic)"
  are not counted; every other hit goes to a person to read.
- **C12 Italic and bold survived every sweep.** Per block, count `<i>`, `<b>`
  and `<sc>` in `pristine` and `edited` of the assembled body (`scripts/body-of.ts`,
  the same body `drive.mjs body` gives). Run by the readiness command; a block
  that lost any goes to a person, because a correction can mean it.

**For "ready to upload"**, on the exact files going to KDP:

- **R1 Spelling, on the exported interior.**
  `npx vite-node --config vitest.config.ts scripts/spelling-of.ts <book.json> --shelf <shelf>/books/ --text <interior.pdf>`.
  Exists; a sheet to read (needs `pdftotext`), every word decided.
- **R2 Export report clean.** The `node scripts/drive.mjs proof "answers=<book.json>" "pdf=<interior.pdf>"`
  run that wrote the file: `warnings: 0`, `notesDropped: []`, `imagesDropped: []`,
  `designFrom: "the book file"`. Exists; read.
- **R3 No character printed as an empty box.** `unprintable` in the same
  report is empty, or each one is ruled by the editor. Exists; read. Refusing
  on it is a (proposed check).
- **R4 Printed notes match the pairing.** The note sequence read out of the
  PDF (`pdftotext`) against `drive.mjs pairs`. (proposed check); by hand today.
- **R5 PDF made from this book file, with no markup in it.**
  `git log -1 --format=%h -- <book-dir>/book.json` and the same for the PDF
  name the same commit; `pdftotext <interior.pdf> - | grep -cE '</?(i|b|sc)>'`
  prints 0. Run by the readiness command: markup fails; the commit that holds
  this exact PDF (found through `STORAGE.tsv` and git), or failing that the
  date the PDF gives, is compared with the last change to `book.json`, and a
  later change goes to a person, because many changes never print.
- **R6 Text copies out of the PDF.** `pdftotext -layout <interior.pdf> - | less`
  reads as words. By hand.
- **R7 Covers made for this interior.** `pdfinfo <interior.pdf> | grep Pages`
  equals `pageCount` in `covers/softcover.json` and `covers/hardcover.json`,
  and the `-flat` PDFs were made after the last recut. Run by the readiness
  command: a different count fails, a cover that is not the `-flat` copy
  fails, and a flat copy older than the last change to its spec fails.
- **R8 Pages looked at.** `node scripts/drive.mjs proof <n> <n> … "answers=<book.json>"`:
  title page, contents, a chapter opening, a page with a note, a picture page,
  a blank verso. By hand.
- **R9 No line opens on a closing mark or ends on an opening one**, counted in
  the `pdftotext` output after any change to line breaking. (proposed check).
- **R10 Listing matches the cover**: title with its label, subtitle, author
  ([upload.md](./upload.md)). By hand.
- **R11 Every EPUB picture described.** `scripts/epub-of.ts` names none
  without a caption or a description. The readiness command reads the EPUB
  being uploaded itself and fails any picture with no description (alt text).

## What it produces and where it goes

Corrections landed in `book.json` through sweeps and `correct`; queries with
proposals for the editor; the dated check results and scores in `ledger.md`;
`damage.md` and other check sheets beside the book. Save, regenerate the
readable files and push in one commit ([sessions.md](./sessions.md)).

## Never

- Never let a check's output be corrected text; findings only.
- Never show the adjudicator the guess with the crop.
- Never use a crop of a book with no page images as evidence: it is the text
  layer drawn again.
- Never apply a damage finding or a spelling-sheet word automatically.
- Never sweep with `--now` before reading every hit.
- Never tune a check to make a book pass; record what it misses instead.
- Never call a book checked with an item above unrun; name it NOT CHECKED.
- Never sign off a check in `ledger.md` that the person did not do.
