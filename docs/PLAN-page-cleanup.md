# Plan: clean the page before Tesseract reads it

Status: **approved, not started.** Scope A of two; the other is
[`PLAN-second-reader.md`](./PLAN-second-reader.md). Independent of it — either
can land first.

## Why

Recon renders a leaf at 300 DPI and hands the canvas straight to Tesseract
(`src/platform/browser/recon.ts`, the `engine.recognize(rendered.canvas, i)`
call). Nothing is done to the pixels first. Every mature scan pipeline does its
cheapest quality work at exactly this point, and this app already owns the
machinery for it: `src/core/image/engine` implements levels, grayscale,
contrast and despeckle as pure functions over a `RasterImage`, wired today only
to illustrations.

Better OCR here pays twice: a cleaner draft is less to correct against the
render, and `assessText` escalates fewer leaves to eyes.

Whether it actually is better is **measured, not assumed** — see _Measuring_.
If no preset beats `off`, the deliverable is the ledger saying so, and `off`
stays the default. That is a successful outcome.

## The rules this must keep

1. **The cleaned image is for the OCR engine and nothing else.** Word crops,
   context crops, thumbnails, illustration detection (`detectIllustrations`,
   `inkProfile`), leaf renders and every piece of evidence shown to a person or
   a session come from the **original** render. The paper is the evidence; a
   cleaned page is an opinion about the paper. Pass the original canvas to
   everything after OCR, as today.
2. **No geometry.** No crop, rotate, straighten or deskew in this plan. The
   cleaned image must have exactly the original's width and height, so every
   word box stays in original-page pixels and the coordinate map is untouched.
   Assert it in a test. Deskew is a separate decision with its own mapping
   story, and is not in scope.
3. **Core stays pure.** Choosing the ops is a pure function in `src/core`
   (e.g. `src/core/image/cleanup.ts`: page statistics + preset → `ImageEditOp[]`).
   Canvas ↔ `RasterImage` conversion and the call to `applyOps` live in
   `src/platform/browser`.
4. **One page in memory at a time.** `applyOps` clones its source, so a leaf
   briefly costs one extra full-page buffer (~33 MB at 300 DPI). Acceptable;
   anything beyond that is not. Release the cleaned buffer before the next
   page renders. Recon runs on phones.
5. **Born-digital PDFs are untouched.** Where recon reads the file's own words
   (`extractPageWords`), there is no OCR and so no cleanup.
6. **No new question.** The app can find this out, so it does not ask. The
   default is whatever the measurement picks. It is settable from the driver for
   measuring, and nowhere in the wizard.

## Shape

- **Presets, not knobs.** A small closed set, e.g.:
  - `off` — today's behaviour, byte for byte.
  - `gentle` — grayscale, then levels anchored to the page's own paper and ink
    tones (percentiles of the leaf's luminance histogram, measured through a
    downscale the way `inkProfile` measures, so cream, grey and foxed scans all
    land on the same white).
  - `gentle+despeckle` — the above plus a small-radius despeckle.

  Do **not** ship a binarising (threshold) preset by default: Tesseract
  binarises internally and pre-thresholding usually costs it. Measure one if
  you like, and record the result either way.

- **One read path.** Recon and `drive.mjs ocr … fresh` must go through the same
  function, so the verb measures what recon does. Give `ocr` a
  `--clean=<preset>` option for measuring.
- **The recon cache knows.** Add the preset to the recon-cache record in
  `src/core/project/recon-cache.ts` and refuse a stored reading made under a
  different preset, exactly as a different DPI is refused today. A record with
  no preset field means `off`. Bump `RECON_CACHE_VERSION` only if the record
  shape requires it.

## Measuring

The ground truth already exists: every finished book on the shelf is a
proofread text keyed to its leaves (the transcription with corrections applied)
— _Clairvoyance_, _The Astral World_, _The Human Aura_, the _Patterns_ volumes.

1. Choose **at least 30 leaves across at least three books**, covering both
   typographic regimes in `test/fixtures/boxes`, plus leaves `assessText` rated
   damaged. Write the leaf list down before running anything.
2. For each leaf and each preset, run a fresh Tesseract read and align it
   against the proofed text of that leaf (the witness alignment in
   `src/core/witness` already does this job). Record words agreeing, substantive
   disagreements, mean confidence, and milliseconds for the cleanup step.
3. Report **per book and per regime**, not only in aggregate. A preset that
   wins overall and loses badly on one book is a preset that loses.
4. Write it to `docs/LEDGER-page-cleanup.md`: the leaf list, the table, and
   the decision with its reason.

**Decision rule:** a preset becomes the default only if it reduces substantive
disagreements with the proofed text in aggregate **and** does not increase them
on any single book by more than a few percent. Mean confidence is secondary
evidence — confidence is not accuracy — and cannot carry the decision alone.

## Tests (pure, no browser)

- Preset → op list, including `off` → `[]`.
- Paper/ink tone estimation from a synthetic histogram (cream, grey, foxed).
- The ops chosen never change dimensions (run `sizeAfterOps` over each preset).
- Recon cache refuses a reading made under a different preset; a record with no
  preset reads as `off`.

## Done when

- The ledger is committed and the default is the preset it chose, with the
  numbers beside the choice.
- Evidence (crops, thumbnails, illustration candidates) is provably still cut
  from the original render.
- `npm test`, `typecheck`, `lint`, `format:check` and `build` pass, and
  `check:install` still opens offline.
- `ARCHITECTURE.md`'s recon diagram and CLAUDE.md's status mention the step.

## Deliberately not doing

- Deskew, page splitting, dewarping — geometry, and a different plan.
- Tuning a preset leaf by leaf. One default per app, chosen from the ledger.
- Showing cleaned pages to anyone.
