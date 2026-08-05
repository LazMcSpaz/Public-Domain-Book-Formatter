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
  ├─ TRANSCRIBE  (vision model pass — not built yet)
  │    per page: role + clean text + structure tags + uncertain spans
  │
  ├─ GATE 2 ▸ check uncertain spots   ← where model & OCR disagree
  ├─ GATE 3 ▸ confirm structure       ← chapters, footnotes, images
  ├─ DESIGN  ▸ interview → preview
  └─ EXPORT  ▸ LaTeX → PDF → KDP validation
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
| Structure      | `src/core/structure`   | Headings, footnotes, TOC, body assembly           | no            |
| Image          | `src/core/image`       | Region detection, DPI math, op engine             | no            |
| Typeset        | `src/core/typeset`     | LaTeX document + body emitter, KDP validation     | no            |
| Style          | `src/core/style`       | Profiles, resolution                              | no            |
| **Design**     | `src/core/design`      | Interview answers → a complete style profile      | no            |
| **Export**     | `src/core/export`      | Book + style + edition → LaTeX; the TeX seam      | no            |
| Ornament       | `src/core/ornament`    | SVG ornament library                              | no            |
| **Platform**   | `src/platform/browser` | PDF.js, Tesseract.js, crops, recon runner         | **yes**       |
| **App**        | `src/app`              | Wizard shell, generic question renderer           | **yes**       |

The `core` / `platform` split is the load-bearing boundary: `core` has no DOM and
no Node, so every rule in the flow is unit-testable without a browser.

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
| Domain logic | `npm test` — 383 tests, pure, no browser                                                |
| Types        | `npm run typecheck`                                                                     |
| UI           | `node scripts/screenshot-flow.mjs` → real Chromium, screenshots per screen              |
| Later gates  | `#preview` in dev → `src/app/DevPreview.tsx`, so gates behind the paid run stay visible |
| Test fixture | `node scripts/make-test-book.mjs` → 8-page mock scan with recurring archaic vocabulary  |

## Known gaps

- **Typesetting in the browser is unproven.** SwiftLaTeX (XeTeX/WASM) is the
  candidate; the sandbox blocks its CDN so it hasn't been tested. The app builds
  the LaTeX document regardless — only the final compile is affected, and it is
  deliberately isolated as a swappable step.
- **Project storage** is not implemented for the browser yet (OPFS/IndexedDB).
  The schema and migrations exist in `src/core/project`.
- **The live API has been exercised once, not at book scale.** The request
  shape, all three offered model IDs, metadata extraction, and uncertainty
  reporting were verified against real calls; a whole-book run has not been
  done. Cost estimation was calibrated against real usage and errs high, as
  intended.
- **No PDF is produced yet.** `buildExport` emits complete XeLaTeX source and
  the export screen hands it to the user; `TexEngine` is the seam where a
  browser TeX would slot in, and until one does the app says so rather than
  pretending. The `.tex` compiles anywhere XeLaTeX runs.
