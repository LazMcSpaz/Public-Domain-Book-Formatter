# Spec: a command that runs the free first reading (cleanup task 17)

## What it does (plain English, for the owner)

Before anyone corrects a page, the tools read the whole scan for free with OCR. We call that the first reading. Every later check compares against it: when a batch of corrected pages lands, each page is checked against what OCR saw on the same page.

The instructions said loading a book starts that reading. It did not. On the _Goetia_ nothing started it, so every landed batch said "not checked", and no command existed to start it.

Now there is one: `drive.mjs recon`. After loading a book, a session runs it once.

- If the reading is already on this computer, it says so and does nothing.
- If the shelf already holds a reading of this exact scan (`recon.json.gz` beside the book), it loads that instead of reading again. A reading of a different copy is refused, with the reason.
- Otherwise it reads every page. A long book takes most of an hour, so it prints how far it has got while it works. If it is cut off part way, running it again carries on from where it stopped (it saves its place every 20 pages).
- At the end it says how many pages and words it read, whether the words came from OCR or from the PDF's own text, and how long it took. It then reminds the session how to keep the reading on the shelf.

Two more things change:

- `load` now says whether a reading is here, and if not, says to run `recon`.
- Landing a batch with no reading behind it is refused, naming `recon` as the fix. A session can still land it on purpose by adding `--without-ocr-check`; the report then still says "not checked". A book with no scan (an EPUB) is never refused: its report says the check does not apply, and why.

## Done when (how we'll know it works; how the owner can try it)

- After `load` and `recon` on a new book, `cachestat` lists the reading, and `transcribe` reports the OCR cross-check for every leaf.
- `transcribe` on a book with no reading is refused and changes nothing; with `--without-ocr-check` it lands and reports NOT CHECKED.
- An EPUB book's `transcribe` lands and says the check does not apply.
- A reading stopped part way carries on from its last checkpoint.
- The owner can ask a session: "Load this book and take its free reading." The answer names the pages and words read and the time taken.

## Modules touched

- `src/core/project/recon-plan.ts` (new): the decisions, with tests: what `recon` does given what is cached, the shelf file and `--fresh`; what `load` says; when `transcribe` refuses; the wording of its `ocr` line.
- `src/platform/browser/recon-run.ts` (new): carries the decision out in the driver's page with the app's own recon functions; `recon.ts` gains `BOOK_RECON`, the one set of reading conditions the app and every driver verb use.
- `scripts/drive.mjs`: the `recon` verb; `load` and `transcribe` changed; `reconimport` shares the shelf-file code; every cache read uses `BOOK_RECON`.
- `scripts/lib/recon-report.mjs`, `scripts/lib/drive-ticker.mjs` (new): the report and the progress lines.
- `src/app/App.tsx`: uses `BOOK_RECON` (no change in behaviour).
- `docs/process/reading.md`, `docs/process/sessions.md`, `docs/reference/commands.md`.

## Rules/decisions that apply

- Root CLAUDE.md: a check that did not run is NOT CHECKED, never passed.
- `scripts/CLAUDE.md`: never reimplement core or app logic in a script; a check with nothing to compare against must refuse, not pass.
- `src/core/CLAUDE.md`: decisions in core, pure and tested.
- The recon cache's stamp (`src/core/project/recon-cache.ts`): a reading is only used under the conditions it was taken in. Any reader asking with other conditions deletes the record, so all readers ask with `BOOK_RECON`.
- No new package.

## Out of scope

- Reading a book in pieces across several sessions by hand: the checkpoint covers it.
- Fixing the app's own reading screen, which already starts recon when a scan is opened.
- Landing against a partial reading: `transcribe` needs a finished one.
