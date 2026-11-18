# 0037: pdfjs-dist (pdf.js) stays on version 4

Status: inherited · Date: 2026-11-18

## Decision

`pdfjs-dist`, Mozilla's pdf.js, reads and renders PDFs: scans for OCR and crops in the app (`src/platform/browser/pdf.ts`, `page-image.ts`), the preview of the exported book (`preview.ts`), and text and page geometry in Node scripts (`drive.mjs`, `shape.mjs`). It stays on major version 4 (`^4.10.38` in `package.json`, 4.10.38 installed).

## Why (plain English)

pdf.js is how a browser draws a PDF, and showing the exported bytes through it is what makes the preview honest (0003). Later major versions (version 6 when this was decided) use JavaScript features not yet in every current browser, and the owner works on an iPad.

## What we gave up

The fixes and features of newer major versions.

## Rule for agents

Keep `pdfjs-dist` at `^4`. Do not move the major version without testing the target browsers, the iPad's Safari included. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2032–2034; harness/sorting/part-4.md ("Packages in use").
