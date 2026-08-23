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
  │    render, OCR, word crops, book-wide lexicon, illustration candidates
  │
  ├─ GATE 1 ▸ confirm how to read it  ← orthography + term review
  │
  ├─ TRANSCRIBE  (vision model pass, paid, cost approved first)
  │
  ├─ GATE 2 ▸ check uncertain spots   ← where model and OCR disagree
  ├─ GATE 3 ▸ confirm structure       ← chapters, footnotes, illustrations
  ├─ PROOF   ▸ each leaf beside its scan ← fix what was read wrong
  ├─ DESIGN  ▸ interview → layout → real pages, live
  └─ EXPORT  ▸ confirm the title page → PDF → KDP validation
```

Gates are the only stops. Everything between them runs unattended.

**The preview is the PDF.** The design gate does not approximate the finished
page in CSS: it lays the book out, writes real PDF bytes, and renders _those_
with pdf.js. One renderer, so what you approve and what you get cannot drift.

**A question waits until the app can help answer it.** The title, the author and
the year of the original are asked at the _end_, not the start — by then the
vision pass has read them off the original title page, so the fields arrive
filled in with the scan beside them. Asked at the start they would have been
three empty boxes and a trip out of the browser to go and find the answers.

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
    edits/      Corrections as a list, applied over the assembled book
    transcribe/ Vision-pass schema, prompt, client, runner, verification, cost
    assemble/   Per-page transcriptions → one book (seams, hyphens, notes)
    design/     Five interview answers → a complete style profile
    layout/     Frames, Knuth–Plass line breaking, pagination, footnotes, TOC
    ornament/   The shipped flourishes, as vector paths
    typeset/    KDP validation
    export/     Edition details, file naming, the honest report
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
footnotes set at the foot of the page they belong to, chapter ornaments, a
collected endnotes section for notes whose reference mark was never found,
illustrations cut out of the scan and set with their captions, a proofing step
that puts each leaf beside its scan so a misreading can actually be fixed,
annotations, pictures and an introduction of your own, non-destructive
retouching of every illustration, and a table of contents carrying measured page
numbers. The KDP report's page count and typesetting
warnings are measured rather than estimated.

The one step that costs money — the vision pass — is saved against the file it
read, so reopening the same book offers the transcription back instead of
charging for it again. Everything else is regenerated from the scan, free, so a
resumed session is complete rather than degraded.

**Not built yet**, with the honest reasons in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md):

- **A book-length run against the live API.** Everything is exercised against a
  mock transport, which proves the shape of the thing and not the cost or the
  failure modes of three hundred real requests. See
  [`docs/PLAN-next.md`](./docs/PLAN-next.md).
- **A physical proof copy.** No digital check substitutes for one, on the
  interior or the cover.

## Covers

`#cover` is the second arm: the flat KDP sheet — back, spine, front — with the
spine computed from the page count and the paper, the type set in the same
embeddable faces as the interior, and the whole thing written as a PDF and
previewed from its own bytes. It stands alone, so a book this app never set can
still have a cover; the export screen links into it carrying the _measured_ page
count, which is the number that sets the spine.

A look — arrangement, palette, faces, ornament — can be banked and applied to
the next volume, which is how a collection ends up looking like one. Cover art
can come from a plate already cut out of the book's own scan, from a file of
your own, from a Replicate model, or from nowhere at all: type, a rule and a
fleuron is a perfectly good cover for a plain reprint. Whatever the source, the
picture is held to the same rule as everything else here — it prints at the
resolution it has, and the app says what that works out to in DPI at the size it
will be printed rather than quietly enlarging it.

The reasoning, and what is left to do, is in
[`docs/PLAN-cover.md`](./docs/PLAN-cover.md).

## The one manual step

Junicode is not on npm — it is not a Google font — so it is not installed by
`npm install`. Until the files are dropped into `public/fonts/junicode/`,
choosing it falls back to EB Garamond and the preview says so. See the README
in that directory.

## Licence

MIT. The shipped typefaces are open-licensed (OFL), which is what makes it legal
to embed them in a book you sell.
