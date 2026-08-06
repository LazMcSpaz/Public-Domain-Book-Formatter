# Public-Domain Book Reprint Tool

A **browser** app that turns public-domain book PDFs — usually old scans — into
print-ready [KDP](https://kdp.amazon.com/) interiors. It renders and OCRs the
pages locally, harvests the book's own vocabulary, then runs a vision-grounded
model pass that reads each page against the scan and recovers its structure.
Finally it lays the book out itself and writes the PDF.

Everything runs client-side. There is no server, no Electron shell, and no
system toolchain to install: open the page, drop in a PDF.

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — the flow and the module map.
- [`CLAUDE.md`](./CLAUDE.md) — the conventions that matter when changing it.
- [`SPEC.md`](./SPEC.md) — the original design. Read the note at its head first:
  it predates the browser rewrite and several of its decisions were reversed.

## The design idea

**The app interviews the user; it never makes them go find a setting.** Every
option starts life as a question asked at the moment it becomes relevant, with a
recommended answer pre-selected and the _evidence_ for it attached — a word crop,
a page thumbnail, a rendered page. Nobody should need to understand the
program's structure to use it.

```
Open PDF
  │
  ├─ RECON  (free, local, no API cost)
  │    render, OCR, word crops, book-wide lexicon
  │
  ├─ GATE 1 ▸ confirm the book        ← identity + term review
  │
  ├─ TRANSCRIBE  (vision model pass, paid, cost approved first)
  │
  ├─ GATE 2 ▸ check uncertain spots   ← where model and OCR disagree
  ├─ GATE 3 ▸ confirm structure       ← chapters, footnotes
  ├─ DESIGN  ▸ interview → layout → real pages, live
  └─ EXPORT  ▸ layout → PDF → KDP validation
```

Gates are the only stops. Everything between them runs unattended.

**The preview is the PDF.** The design gate does not approximate the finished
page in CSS: it lays the book out, writes real PDF bytes, and renders _those_
with pdf.js. One renderer, so what you approve and what you get cannot drift.

## Running it

```bash
npm install
npm run dev          # vite dev server on :5173
npm run typecheck
npm test             # the gating check — pure logic, no browser needed
npm run lint
npm run format:check
npm run build        # typecheck + vite build → dist/

node scripts/make-test-book.mjs      # regenerate the 8-page test fixture
node scripts/screenshot-flow.mjs     # drive the wizard in real Chromium
```

The transcription pass needs an Anthropic API key, which the app asks for and
stores locally. The key is the user's, is sent straight to the API, and never
touches a server — there isn't one. The test suite needs no key and spends
nothing: the model transport is mocked.

## Layout

```
src/
  core/       Pure domain logic — no DOM, no Node. Where the tests live.
    model/      Coordinate map, honest flags, project types
    hocr/       hOCR parsing → tokens with bounding boxes and confidence
    lexicon/    Term harvesting from the book's own vocabulary
    pages/      Page roles and what to do with each
    wizard/     The question contract and the step machine
    transcribe/ Vision-pass schema, prompt, client, runner, verification, cost
    assemble/   Per-page transcriptions → one book (seams, hyphens, notes)
    design/     Five interview answers → a complete style profile
    layout/     Frames, Knuth–Plass line breaking, pagination, footnotes, TOC
    typeset/    LaTeX emitter and KDP validation
  platform/
    browser/    The only place browser APIs appear: PDF.js, Tesseract.js,
                fonts, the pdf-lib writer, the page preview
  app/        The React wizard shell and the generic question renderer
test/         Vitest — pure, no browser
```

The `core` / `platform` split is the load-bearing boundary: `core` has no DOM
and no Node, so every rule in the flow is unit-testable without a browser.

## Where it stands

**Working end to end**: the local pipeline, the lexicon, all three review gates,
the vision pass, assembly, the design interview with a live page preview, and a
print-ready PDF with front matter, running heads, folios, drop capitals,
footnotes set at the foot of the page they belong to, and a table of contents
carrying measured page numbers. The KDP report's page count and typesetting
warnings are measured rather than estimated.

The one step that costs money — the vision pass — is saved against the file it
read, so reopening the same book offers the transcription back instead of
charging for it again. Everything else is regenerated from the scan, free, so a
resumed session is complete rather than degraded.

**Not built yet**, with the honest reasons in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md):

- **Illustrations.** The layout engine has no image support, so an illustrated
  book cannot place its plates. `src/core/image` holds region detection, DPI
  maths and a non-destructive op engine, but nothing calls them yet.
- **Ornaments in the PDF.** The design gate offers a chapter-opener ornament and
  the PDF path ignores it.
- **Real small capitals**, and the ligatures that pdf-lib's embedder cannot
  write widths for.

## The one manual step

Junicode is not on npm — it is not a Google font — so it is not installed by
`npm install`. Until the files are dropped into `public/fonts/junicode/`,
choosing it falls back to EB Garamond and the preview says so. See the README
in that directory.

## Licence

MIT. The shipped typefaces are open-licensed (OFL), which is what makes it legal
to embed them in a book you sell.
