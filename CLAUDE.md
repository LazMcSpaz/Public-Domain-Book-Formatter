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
- **Show the pixels.** Never ask "is this word right?" without the scan beside it.
- **Answer once, apply everywhere.** Confirming a term fixes it book-wide.

## Architecture in one breath

- `src/core` — **pure domain logic, no DOM and no Node.** Coordinate map, hOCR
  parsing, lexicon harvesting, page roles, the wizard step machine, assembly,
  design-by-interview, image algorithms, **the layout engine** (frames,
  Knuth–Plass line breaking, pagination), the LaTeX body emitter and document
  builder, the export seam, style system. This is where the tests live.
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
  edition's pagination and are discarded and regenerated (`src/core/pages`).
- **The preview is the PDF.** The design gate lays the book out, writes real PDF
  bytes and renders _those_ with pdf.js. Never add a second renderer that
  approximates the page — one renderer is what makes the gate's approval mean
  something. `layout()` is a pure function of its inputs, so the footnote
  re-flow and the two-pass TOC are "run it again", not mutable state.
- **Measure with the engine that draws.** The `TextMeasurer` sums the advances
  of the glyphs `fontkit.layout()` returns, which is the same call pdf-lib makes
  to encode text. Measuring with anything else is how WYSIWYG breaks.
- **Memory discipline.** A 300-DPI page is ~19 MB of pixels; a 300-page book held
  at once would be ~5.8 GB. Recon renders, consumes, and releases one page at a
  time. Never accumulate page canvases.
- **Object URLs must be revoked.** Crops and thumbnails leak otherwise — see
  `releaseRecon`.
- **Project file is versioned**: bump `CURRENT_SCHEMA_VERSION` and extend
  `migrate()` in `src/core/project/project-file.ts` on any shape change.

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
- **Also done**: Gate 3 (structure confirmation) and the LaTeX body emitter.
- **Also done**: design-by-interview, and **the layout engine** — Knuth–Plass
  line breaking with Liang hyphenation, baseline-grid pagination with widow and
  orphan control, front matter, running heads, folios, recto chapter openings
  and drop capitals. The design gate now shows **real pages from the finished
  PDF**, and the export downloads that PDF. Because the page count and the
  layout warnings are measured, both KDP checks that used to report `pending`
  now report the truth.
- **The open TeX question is closed.** No browser TeX is needed: the app lays
  the book out itself and pdf-lib writes the file. The `.tex` download survives
  as a secondary path during the transition.
- **Next**: footnotes (reserve space, re-flow once), then a table of contents
  with measured page numbers (lay out, collect, insert, lay out again), then
  deleting the LaTeX path. See [`docs/PLAN-layout-preview.md`](./docs/PLAN-layout-preview.md).
