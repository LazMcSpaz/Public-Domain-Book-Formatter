# Architecture

Browser-only. React + TypeScript + Vite, no server, no Electron.

## The flow

```
Open PDF
  │
  ├─ RECON  (free, local, no API cost)
  │    PDF.js render @300dpi ─┐
  │    Tesseract.js OCR       ├─ one page at a time, released after use
  │    word crops             ─┘
  │    lexicon harvest (book-wide, frequency-driven)
  │
  ├─ GATE 1 ▸ confirm the book        ← identity + term review (built)
  │
  ├─ TRANSCRIBE  (vision model pass)
  │    per page: role + clean text + structure tags + uncertain spans
  │
  ├─ GATE 2 ▸ check uncertain spots   ← where model & OCR disagree
  ├─ GATE 3 ▸ confirm structure       ← chapters, footnotes, images
  ├─ DESIGN  ▸ interview → layout → real pages, live
  └─ EXPORT  ▸ layout → PDF → KDP validation
```

Gates are the only stops. Everything between them runs unattended.

## Module map

| Area           | Path                   | Contains                                          | Browser APIs? |
| -------------- | ---------------------- | ------------------------------------------------- | ------------- |
| Domain model   | `src/core/model`       | Coordinate map, flags, project types              | no            |
| hOCR           | `src/core/hocr`        | hOCR parsing → tokens + boxes                     | no            |
| **Lexicon**    | `src/core/lexicon`     | Term harvesting, variant clustering, prompt block | no            |
| **Page roles** | `src/core/pages`       | Roles, dispositions, front-matter metadata        | no            |
| **Wizard**     | `src/core/wizard`      | Question contract, step machine                   | no            |
| Image          | `src/core/image`       | Region detection, DPI math, op engine             | no            |
| **Layout**     | `src/core/layout`      | Frames, Knuth–Plass line breaking, pagination     | no            |
| Typeset        | `src/core/typeset`     | LaTeX document + body emitter, KDP validation     | no            |
| Style          | `src/core/style`       | Profiles, resolution                              | no            |
| **Design**     | `src/core/design`      | Interview answers → a complete style profile      | no            |
| **Export**     | `src/core/export`      | Book + style + edition → LaTeX; the TeX seam      | no            |
| Ornament       | `src/core/ornament`    | SVG ornament library                              | no            |
| **Platform**   | `src/platform/browser` | PDF.js, Tesseract.js, fonts, PDF writer, preview  | **yes**       |
| **App**        | `src/app`              | Wizard shell, question renderer, page preview     | **yes**       |

The `core` / `platform` split is the load-bearing boundary: `core` has no DOM and
no Node, so every rule in the flow is unit-testable without a browser.

## One layout, two consumers

```
BookDocument + StyleProfile
        │
        ▼
  layout engine  ──►  LaidOutPage[]  ──►  pdf-lib  ──►  PDF bytes
   (pure core)                                              │
                                            ┌───────────────┴────────────┐
                                            ▼                            ▼
                                   preview: pdf.js → canvas        download
```

**The preview is the PDF.** The design gate does not approximate the finished
page in CSS — it lays the book out, writes real PDF bytes, and renders those
bytes with pdf.js, the same library the app already uses to read scans. One
renderer means preview and output cannot drift, which is the only property that
makes a design gate worth stopping at.

`layout()` is a pure function of its inputs, and deliberately so: the two
circular problems still ahead — a footnote whose height moves its own reference,
and a table of contents whose page numbers only exist after layout — are then
solved by running it again with different inputs rather than by threading
mutable state through the flow.

Text measurement enters through an injectable `TextMeasurer`. The browser
supplies one backed by fontkit — _the same call pdf-lib makes to encode text_ —
so what the engine measures and what the PDF draws agree by construction. Tests
inject a fixed-width fake, so line breaks are exact integers and no font is
needed to assert on them.

## Why OCR is still here

Under the vision-pass design the model reads the page, so OCR is no longer the
source of truth. It stays for two reasons that a language model can't provide:

1. **Coordinate map.** Bounding boxes anchor every word to its pixels — the
   backbone for word crops, hover-sync, and image placement.
2. **Independent witness.** Tesseract is not a language model, so it has no
   shared blind spots with the vision pass. Where they disagree is real evidence;
   a model's confidence in its own output is not.

## Verification

| What         | How                                                                                     |
| ------------ | --------------------------------------------------------------------------------------- |
| Domain logic | `npm test` — 378 tests, pure, no browser                                                |
| Types        | `npm run typecheck`                                                                     |
| UI           | `node scripts/screenshot-flow.mjs` → real Chromium, screenshots per screen              |
| Later gates  | `#preview` in dev → `src/app/DevPreview.tsx`, so gates behind the paid run stay visible |
| Test fixture | `node scripts/make-test-book.mjs` → 8-page mock scan with recurring archaic vocabulary  |

## Known gaps

- **Project storage** is not implemented for the browser yet (OPFS/IndexedDB).
  The schema and migrations exist in `src/core/project`.
- **The live API has been exercised once, not at book scale.** The request
  shape, all three offered model IDs, metadata extraction, and uncertainty
  reporting were verified against real calls; a whole-book run has not been
  done. Cost estimation was calibrated against real usage and errs high, as
  intended.
- **Footnotes and the table of contents are not laid out yet.** Both are
  circular — a note's height moves the reference that placed it; inserting TOC
  pages shifts the numbers on them — and both are solved by running `layout()`
  a second time. The engine is shaped for that; the second pass isn't written.
- **Small capitals are not real.** `headingStyle.smallCaps` sets ordinary
  capitals. The fonts do carry `smcp`, but drawing it needs glyph-level output
  rather than `drawText`, and synthesising it by scaling capitals — what cheap
  reprints do — is worse than not offering it.
- **Ligatures are switched off**, because pdf-lib writes no width for a glyph
  that answers to no code point. See `src/platform/browser/fonts.ts`.
- **The LaTeX path is still present.** `buildExport` still emits XeLaTeX source
  and the export screen offers it as a secondary download. It is scheduled for
  deletion once the PDF path has been used on real books; a working way out of
  the app should not disappear before its replacement is trusted.
