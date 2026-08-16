# CLAUDE.md

Guidance for AI assistants (and humans) working in this repo.

## What this is

A **browser** app (React + TypeScript + Vite) that turns public-domain book PDFs
— usually old scans — into print-ready **KDP** interiors. It renders and OCRs
pages locally, harvests the book's own vocabulary, then (Phase 2) runs a
vision-grounded model pass that reads each page against the scan and recovers
its structure. The full design is in [`SPEC.md`](./SPEC.md); the module map is in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

Everything runs client-side. There is no server and no Electron shell.

## Commands

```bash
npm install
npm run dev          # vite dev server on :5173
npm run typecheck    # tsc --noEmit
npm test             # vitest (the gating check — pure logic, no browser needed)
npm run lint
npm run format:check # prettier --check  (npm run format to fix)
npm run build        # typecheck + vite build → dist/

node scripts/make-test-book.mjs      # regenerate the 8-page test fixture
node scripts/screenshot-flow.mjs     # drive the wizard headlessly, screenshot each screen
```

**Before committing: typecheck + test + format:check + lint.**

## The design philosophy that drives the UI

**The app interviews the user; it never makes them go find a setting.** Every
option starts life as a question asked at the moment it becomes relevant, with a
recommended answer pre-selected and the **evidence** for it attached — a word
crop, a page thumbnail, a rendered sample. Nobody should need to understand the
program's structure to use it.

Practical rules:

- **Questions are data, not screens.** A step returns `Question[]`; `QuestionView`
  renders whatever it gets. Adding a question needs no new UI code — and the
  whole flow is unit-testable with no DOM.
- **Batch into gates, don't drip.** 200 terms are one grid with accept-all, not
  200 prompts.
- **Never ask what isn't relevant yet** (no chapter-ornament question before we
  know the book has chapters).
- **Never ask what the app could find out first.** A question belongs at the
  point where the app can _help_ answer it. The title, author and year are asked
  at the export gate, after the vision pass has read them off the original title
  page, so the fields arrive prefilled with the scan beside them — not at Gate 1,
  where they were three empty boxes and a trip out of the browser.
- **Show the pixels.** Never ask "is this word right?" without the scan beside it.
- **Answer once, apply everywhere.** Confirming a term fixes it book-wide.
- **Correct content, never presentation.** The proof step fixes what the page
  _says_ and what a block _is_. It deliberately offers no per-paragraph indent
  and no manual line break: the book reflows to whatever measure the design gate
  settles on, so those are not corrections but damage. A paragraph needing
  different treatment gets a different kind, which the style system then applies
  consistently.

## Architecture in one breath

- `src/core` — **pure domain logic, no DOM and no Node.** Coordinate map, hOCR
  parsing, lexicon harvesting, page roles, the wizard step machine, assembly,
  design-by-interview, image algorithms, **the layout engine** (frames,
  Knuth–Plass line breaking, pagination, footnotes, illustrations, ornaments,
  the TOC), the ornament library, the edition/export report, style system. This
  is where the tests live.
- `src/platform/browser` — the only place browser APIs appear: PDF.js rendering,
  Tesseract.js OCR, canvas crops, the recon runner, font loading, the pdf-lib
  writer, and the page preview.
- `src/app` — the React wizard shell (`App.tsx`), the generic question renderer
  (`QuestionView.tsx`), the live page preview (`PreviewPane.tsx`), the export
  screen, and a dev-only `#preview` route for looking at gates that sit behind
  the paid run.

Path aliases: `@core`, `@platform` (defined in `tsconfig.json`,
`vite.config.ts`, and `vitest.config.ts` — update all three together).

### Conventions that matter

- **Core stays pure.** No `node:` imports, no `window`/`document` in `src/core`.
  Platform work belongs in `src/platform`. This is what keeps the flow testable.
- **API keys stay in the browser.** The key is the user's, stored locally, and
  sent straight to the API — there is no server to proxy through. Never log it,
  never put it in a prompt, never commit it.
- **Honest flag tiers** (SPEC §4): OCR confidence is a real probability; a model's
  self-assessment is not. Never gate a check on a model's opinion of its own
  output — escalation is decided by _deterministic_ cross-checks (OCR
  disagreement, word-count drift, structure anomalies).
- **OCR is the independent witness, not the source of truth.** Its value is that
  it isn't a language model, so it has no shared blind spots with the vision
  pass, and it supplies the bounding boxes the coordinate map needs.
- **Front matter is replaced, not transcribed.** The original title/copyright
  pages are _sources of metadata_; the scanned TOC and index carry the original
  edition's pagination and are discarded. The contents page is regenerated with
  numbers this edition actually prints (`src/core/pages`, `src/core/layout/toc`).
- **A note that cannot be placed is reported, never dropped.** `notesDropped`
  travels from the engine to the export screen. Silence here is the worst
  possible failure: the reader finds the missing footnote once it is printed.
  `imagesDropped` and `missingImages` are the same rule for pictures, and
  nothing is drawn in place of one — a grey placeholder box in a book for sale
  is worse than a gap the user was told about.
- **Never invent resolution.** Illustration crops are taken at the DPI the page
  renders at and placed at exactly that pixel size. Rendering a page larger to
  make the DPI number look better only interpolates pixels the scan never had:
  the print is no sharper and the KDP check that would have warned the user has
  been argued out of its warning. See `src/platform/browser/illustrations.ts`.
- **The preview is the PDF.** The design gate lays the book out, writes real PDF
  bytes and renders _those_ with pdf.js. Never add a second renderer that
  approximates the page — one renderer is what makes the gate's approval mean
  something. `layout()` is a pure function of its inputs, so the footnote
  re-flow and the two-pass TOC are "run it again", not mutable state.
- **Every glyph the book prints must have a width.** pdf-lib writes `/W` and
  `ToUnicode` from the glyphs a _code point_ reaches, so a ligature, a
  contextual alternate or a small capital gets neither: a full em of white space
  mid-word, and a page that copies out as line noise. `font-widths.ts` widens
  the list to what the book uses and `renderPdf` **verifies** it, raising rather
  than writing a book with holes. That check is only sound because `drawPage` is
  the single place text is drawn — keep it that way.
- **Measure with the engine that draws.** The `TextMeasurer` sums the advances
  of the glyphs `fontkit.layout()` returns, which is the same call pdf-lib makes
  to encode text. Measuring with anything else is how WYSIWYG breaks.
- **Memory discipline.** A 300-DPI page is ~19 MB of pixels; a 300-page book held
  at once would be ~5.8 GB. Recon renders, consumes, and releases one page at a
  time. Never accumulate page canvases.
- **Object URLs must be revoked.** Crops and thumbnails leak otherwise — see
  `releaseRecon`.
- **Only the paid step is persisted.** Everything else — rendering, OCR, the
  lexicon, assembly, layout — is free and repeatable, so the saved unit is the
  transcription, keyed to the file it came from (`src/core/project`). Reopening
  a book redoes the free half and _offers_ the paid half back as a question.
  Bump `CURRENT_SCHEMA_VERSION` and extend `migrateSavedRun()` in
  `src/core/project/saved-run.ts` on any shape change; it throws rather than
  returning a partial run, because a half-restored transcription looks like a
  book that was read and prints with holes in it.

### Pinned dependencies (deliberate)

- **`pdfjs-dist` v4** — v6 uses JS features not yet in every current browser.
- **`tesseract.js`** — its `main` is CommonJS with no `module` field, so the app
  imports `tesseract.js/dist/tesseract.esm.min.js`, which exposes only a
  **default** export.
- **Tesseract assets are vendored** into `public/tesseract/` (worker, WASM core,
  language data) rather than fetched from a CDN, so the app works offline.
- **Book faces come from `@expo-google-fonts/*`, not `@fontsource/*`** —
  fontsource ships only WOFF/WOFF2, which pdf-lib cannot embed.
- **`pdf-lib` fonts are embedded whole, with ligatures off.** Both are forced,
  and both fail silently if reverted: `{ subset: true }` corrupts the outlines
  of EB Garamond, Cardo and IM FELL English, and the whole-font embedder writes
  no width for a ligature glyph. The reasoning and the evidence are in
  `src/platform/browser/pdf-out.ts` and `fonts.ts` — read them before changing
  either, because nothing in the test suite short of looking at a rendered page
  catches the first one.
- **Junicode is vendored by hand** into `public/fonts/junicode/` (see the README
  there). It is not on npm and is loaded on demand; until it is present the app
  substitutes EB Garamond and says so.

## Verifying UI work

This sandbox has Chromium + Playwright, so **UI changes are verifiable here** —
run `node scripts/screenshot-flow.mjs` against a dev server and look at the PNGs
in `screenshots/`. Don't ship UI blind.

## Status

- **Done**: browser pipeline (render → OCR → harvest), lexicon builder, wizard
  step machine + question contract, Gate 1 (book identity + term review), and
  the vision pass engine (schema, prompt, client, runner, verification, cost) —
  all tested with a mock transport, so no API key or spend is needed to run the
  suite.
- **Also done**: the transcribe step is wired (key entry, cost approval,
  progress, cancel), assembly stitches pages into a book document (seam repair,
  hyphen healing, footnote linking, front-matter dispositions), and Gate 2
  surfaces flagged pages with the scan beside each.
- **Also done**: Gate 3 (structure confirmation).
- **Also done**: design-by-interview, and **the layout engine** — Knuth–Plass
  line breaking with Liang hyphenation, baseline-grid pagination with widow and
  orphan control, front matter, running heads, folios, recto chapter openings
  and drop capitals. The design gate now shows **real pages from the finished
  PDF**, and the export downloads that PDF. Because the page count and the
  layout warnings are measured, both KDP checks that used to report `pending`
  now report the truth.
- **The open TeX question is closed, and the LaTeX path is gone.** No browser
  TeX is needed: the app lays the book out itself and pdf-lib writes the file.
  `src/core/typeset` is now only the KDP checks.
- **Also done**: **footnotes** — set at the foot of the page their reference
  falls on, renumbered straight through the book, with the space reserved as
  lines are placed — and a **table of contents with measured page numbers**,
  laid out twice so the second pass cannot invalidate the first.
- **Also done**: **save and resume.** A finished transcription is stored in
  IndexedDB against the file's identity, so a refresh, a crash or a closed tab
  no longer costs the user the one thing they paid for.
- **Also done**: **ornaments in the PDF** (vector paths in `src/core/ornament`,
  placed by the engine and drawn with `drawSvgPath`), **collected endnotes** for
  notes whose reference mark is nowhere in the body, and moving the title,
  author and year questions to the export gate where they arrive prefilled.
- **Also done**: **proofreading** (`src/core/edits`) — each source leaf beside a
  readable render of its scan, with the text editable, blocks retypeable and
  pictures re-anchorable. Corrections are a _list_ applied over the pristine
  transcription, exactly like the image op stack, and are saved with the run
  (schema v6). Before this there was no way to fix a single wrong word.
- **Also done**: **the editor's own notes**, written at the proof step and set
  by the existing footnote machinery — placed, renumbered through the book, and
  collected as endnotes when they cannot be placed. Located by an explicit
  anchor rather than by splicing a marker into the text. This is the first thing
  the app can _add_ to a book rather than recover from it, which is what a
  public-domain reprint needs to be publishable.
- **Also done**: **illustrations** — detected from the OCR word boxes and an ink
  test on the pixels, reviewed one by one at Gate 3, cut out of the scan at
  render resolution, set to the measure (or given a leaf of their own), with the
  caption pulled out of the text flow and put under the picture. The KDP
  image-DPI check is measured from the placed size.
- **Also done**: **the image-editing mode** of SPEC §6 — crop by dragging,
  straighten, brightness, contrast, levels, despeckle, grey and threshold, on
  pictures cut from the scan and supplied alike. `src/core/image/engine` is
  wired at last. Non-destructive: the stack is re-applied over the original
  pixels every time, and the core resolves only the _size_ it leaves, through
  `sizeAfterOps`, because the DPI check divides by it. Background removal is
  deliberately not offered — the spec calls it best-effort, and without manual
  touch-up of the selection it is a magic button that eats part of the picture.
- **Also done**: **saved style profiles** (`src/core/style/saved-profile.ts`) —
  the book-two problem. A look is banked once and offered at the design gate on
  every later book, which then asks one question instead of five; the imprint
  and copyright holder ride along, while the ISBN, edition statement and
  publication date deliberately do not. What may be banked is enforced by
  `BANKED_STYLE_KEYS`, not by convention, so adding a field to `StyleProfile`
  fails a test until someone decides which of SPEC §7's two levels it belongs
  to. This also retired `ProjectFile` and the 141 lines of Electron-era model
  scaffolding reachable only from it.
- **Also done**: **Junicode**, vendored into `public/fonts/junicode/` with its
  licence beside it — the only CFF outlines here, so pdf-lib writes a
  `FontFile3` no other face exercises.
- **Also done**: **ligatures, contextual alternates and real small capitals.**
  All three were one bug: pdf-lib builds the PDF's width array from the glyphs a
  _code point_ reaches, so anything else printed as a full em of white space and
  copied out as line noise. `src/platform/browser/font-widths.ts` widens that
  list to the glyphs the book actually uses, and `renderPdf` verifies rather
  than hopes. Small capitals then needed no glyph-level draw path at all —
  pdf-lib applies features per embedded font, so a small-caps run is the same
  bytes embedded again with `smcp` on.
- **Also done**: **tables.** Matter set in columns is a `table` block carrying
  its `cells`, and its `text` is a _derived_ flattened view (rows on lines,
  cells separated by `|`) so the word-count cross-check, the seam checks and
  the proof editor all keep reading a page as prose. `normalizeTable` is the one
  place the two are reconciled, and it runs wherever a table can enter the book
  — the model's reply, assembly, and every correction — so they can never
  disagree. The engine sets one flowable **per row**, unbreakable: a long table
  breaks between rows without the pagination machinery knowing tables exist.
  Columns of figures are set to the right, heads in italic over a rule.
- **Also done**: **cross-page verification** (`src/core/transcribe/verify-book.ts`)
  — the other five checks compare a page against the OCR of _that page_, so a
  leaf missed, mis-ordered or read twice was invisible. Three deterministic
  comparisons across pages, with quorums and length floors so a book without
  running heads produces nothing rather than one finding per page.
- **Also done**: **Gate 1's term verdicts count** (`src/core/lexicon/vetted.ts`).
  The answer used to be read by nothing while the prompt called the raw harvest
  "confirmed as correct"; rejecting a word made the app insist on it.
- **Next**: [`docs/PLAN-next.md`](./docs/PLAN-next.md) — a book-length run
  against the live API is all that remains, and it needs a key and real spend.
  [`docs/PLAN-layout-preview.md`](./docs/PLAN-layout-preview.md) is closed and
  kept for why the layout engine is shaped the way it is.
