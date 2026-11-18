# 0038: Tesseract.js is the OCR engine, with its files vendored

Status: inherited · Date: 2026-11-18

## Decision

Tesseract.js (`^7`) is the primary OCR engine, run in the browser. It is imported from its ESM build, `tesseract.js/dist/tesseract.esm.min.js`, which has only a default export (`src/platform/browser/ocr.ts`). Its worker, WebAssembly core and English language data are kept in `public/tesseract/` and loaded from there, never from a CDN. `@tesseract.js-data/eng` is not imported by any code; it is where the vendored language file came from.

## Why (plain English)

OCR supplies the independent witness and the word boxes (0011), and its confidence scores are real probabilities. The package's main entry is an older module format with no modern entry point, so the bundler needs the ESM build. Keeping the files in the repository means the app works offline and fetches nothing from a third party.

## What we gave up

The desktop Tesseract and OCRmyPDF programs SPEC.md planned. Automatic updates of the vendored files: nothing in `package.json` or `scripts/` copies them, so they do not follow the package when it is upgraded.

## Rule for agents

Import only the ESM build, as a default import. Never point Tesseract at a CDN. When `tesseract.js` is upgraded, refresh `public/tesseract/` from the same version by hand. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2035–2039; src/platform/browser/ocr.ts; harness/sorting/part-4.md ("Packages in use").
