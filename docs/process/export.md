# Export: laying the book out and writing the files

## Purpose

Lay the book out and write the interior PDF and the EPUB, so that the files on
the shelf are exactly what `book.json` describes. **The shelf must describe the
book it holds**: `book.json` is the source, the PDF and EPUB are made from it,
and the readable files are views of it. The moment one disagrees, the shelf
misleads whoever opens it next, and nothing warns.

## Who runs it

The **format checker**: lays the book out, reads the export report field by
field, and looks at the pages.

## Before you start

- The book is checked ([checking.md](./checking.md)), or you know exactly
  which checks are NOT CHECKED and will say so.
- The book is loaded from the shelf ([sessions.md](./sessions.md)); for a
  collection with no scan, see [compilation.md](./compilation.md).
- **The design answers live in the book file**, not in a browser. Merge them
  with `node scripts/drive.mjs answers a.json`, then `save`. Set the contents'
  depth (`contentsDepth`) from the original's own contents page, usually
  chapters only; the default lists every heading level, run-in sub-heads
  included.
- **A new book starts from the house look** (`imprint/house-look.json` at the
  top of the shelf; [the spec](../specs/house-look.md)). With no design answers
  of its own, `proof` lays it out in the house look, on 6×9 if it prints under
  100 pages at 7×10, and says so in `designFrom`; the report's `inherited` is
  the answers it used. Once the owner approves the look, write them into the
  book (`answers` with them as `"design"`, then `save`): the export needs
  `designFrom: "the book file"`, and a book keeps its look when the house look
  changes.
- **The running heads follow the book's structure** (the owner's decision of
  19 November 2026; [the spec](../specs/topic-heads.md)). A book inheriting
  the house look whose chapters are, at least half of them, divided by
  subheadings in the text gets the chapter title on the left page and the
  topic in force on the right; any other book keeps the author and the
  chapter. `designFrom` says which, and why.
- **Chapters that only open with a list of topics are the owner's question.**
  When `proof` reports `askOwner`, the chapters print a list of topics under
  the title and no subheadings in the text, and no tool can know which pages
  each topic covers. Put it to the owner as a question about this book's
  design, with a chapter opening rendered in front of him
  (`proof <page> "answers=<book.json>"`): keep the author and chapter heads,
  or say where each listed topic begins so it can be set as a subheading,
  after which the book is divided and gets topic heads. Never set topic
  heads on such a book without his answer. Record the question and his
  answer in the book's `ledger.md`, and write the heads he chose into the
  book's design answers (`runningHeadVerso`, `runningHeadRecto`) with
  `answers` and `save`.

## Steps

1. **Proof pages first**:
   `node scripts/drive.mjs proof 1 3 9 40 "answers=<book-dir>/book.json"`
   renders those pages of the real PDF (one renderer: the preview is the PDF).
   Look at the title page, the contents, a chapter opening, a page with a note,
   a page with a table, every picture page and a blank verso. Most layout
   faults were invisible in every summary and obvious on the page.
2. **Export**:
   `node scripts/drive.mjs proof "answers=<book-dir>/book.json" "pdf=<book-dir>/<Name>.pdf"`
   (give absolute paths). Without `answers=` the look comes from the browser,
   the house look or the defaults, and the report says so in `designFrom`. Keep the report
   (redirect it to a file outside the tools repository): it names the PDF's
   SHA-256 as `pdfSha256`, and the readiness command takes it with
   `--export-report` for R2 and R3 only when that matches the interior.
3. **Read every field of the report**, not the page count:
   - `warnings: 0`; `warningsFirst` names the first few with their pages;
   - `notesDropped: []` and `imagesDropped: []`: nothing the engine could not
     place is lost in silence;
   - `notesPlaced` and `imagesPlaced` match what the book holds;
   - `designFrom: "the book file"`, not `DEFAULTS`;
   - `headsShortened`, in a book with topic heads: each running head too long
     for the page, what was set instead and on which pages. Each one wants a
     short form from the owner; it is also counted in the warnings;
   - `askOwner`: see "Before you start"; the book's heads are not settled
     until the owner answers;
   - `unprintable`: characters drawn as an empty box because no face carries
     them. Each one is the editor's decision; look at the page;
   - `chapters`: each opening on the side the design asks for.

   A report that only counts cannot tell a fault from a hard book: render the
   page a warning names and look.

4. **Read the text back out of the PDF**: `pdftotext -layout <Name>.pdf - | less`.
   Text that copies out as noise means a glyph was drawn with no width. No
   `<i>`, `<b>` or `<sc>` may appear as literal text.
5. **For a book with footnotes**, read the printed note sequence out of the PDF
   and compare it with `node scripts/drive.mjs pairs`; they must agree.
6. **The EPUB**:
   `npx vite-node --config vitest.config.ts scripts/epub-of.ts <book-dir> <out-dir>`,
   then pack it with `(cd <out-dir> && zip -X0 ../book.epub mimetype && zip -Xr9D ../book.epub META-INF OEBPS)`.
   It names every picture with neither a caption nor a description.
7. **Regenerate the readable files**: `node scripts/book-files.mjs <book-dir>`
   (it keeps the title and description lines a person wrote at the top of
   each), `node scripts/drive.mjs corrections <book-dir>`, then check both with
   `--check`.
8. **One commit**: `book.json`, the PDF, the EPUB and the readable files
   together, then push and confirm `git rev-list --count origin/<branch>..HEAD`
   prints 0. A commit that carries a book file without its exports has to be
   remembered later.
9. **If the page count changed, the covers are stale.** A cover's spine is
   computed from the page count; see [upload.md](./upload.md) before anything
   goes to KDP.
10. **A fix to the engine is not finished at the book it was found on.**
    Shelf PDFs go stale in silence. After a fix to parsing or layout, re-export
    every book the fault could reach and check the bytes (for example, pull
    each PDF's text and look for literal `<i>`), rather than reasoning about
    which books it touches.

## Checks that must pass

The full list lives in one place, so the three documents cannot disagree: [checking.md](checking.md#checks-that-must-pass-the-full-list-for-checked-and-ready-to-upload), items C1 to C12 for _checked_ and R1 to R11 for _ready to upload_. Run every item for this stage on the exact files that go to KDP, and name anything that did not run as NOT CHECKED.

## What it produces and where it goes

`books/<dir>/<Name>.pdf` and `<Name>.epub` on the shelf, made from the
`book.json` in the same commit; the readable files regenerated; a ledger entry
with the page count, the report's fields and every check result. (An export
receipt beside each file, saying what made it, when, and what it passed, is
planned.)

## Never

- Never lay a book out from a browser's design answers; pass `answers=` from
  the book file.
- Never accept an export on its counts alone; read every field and look at
  pages.
- Never add a second way of drawing pages. The preview is the PDF.
- Never commit a book file without its re-exported PDF and readable files.
- Never leave a placeholder where a note or picture could not be placed;
  report it.
- Never hand-edit a readable file that `book-files.mjs` or
  `drive.mjs corrections` generates; regenerate it.
