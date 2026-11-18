# 0039: pdf-lib writes the PDF, with fonts embedded whole

Status: inherited · Date: 2026-11-18

## Decision

`pdf-lib` (`^1.17.1`) writes the finished PDF, with `@pdf-lib/fontkit` registered for fonts (0040). Fonts are embedded whole (`subset: false` in `src/platform/browser/pdf-out.ts`). The file is saved with a classic cross-reference table (`useObjectStreams: false`) and with empty `/Annots` arrays removed.

## Why (plain English)

pdf-lib runs in the browser with no server and no TeX. Its font subsetter (version 1.17.1) silently corrupts EB Garamond, Cardo and IM FELL English: most letters vanish on the printed page while every check passes. Embedding whole costs about 900 KB for a pair of faces, far below KDP's limit. KDP refused an interior written in pdf-lib's default compact form ("Error processing your interior"); the plain form processed at once.

## What we gave up

Smaller files. Subsetting only the faces that survive it was rejected: correctness would depend on which face was picked, and a font update could move a face between lists without anything failing.

## Rule for agents

Keep `subset: false` and `useObjectStreams: false`. Read `pdf-out.ts` and `fonts.ts` before changing embedding, and look at a rendered page afterwards: no test short of that catches the corruption. Code note: the old text says ligatures are turned off. They are on: `font-widths.ts` writes the missing widths (0019), and `LAYOUT_FEATURES` turns off only discretionary (`dlig`) and historical (`hlig`) ligatures. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1263–1273, 2042–2048, 2143–2150; docs/PLAN-layout-preview.md ("What building it changed"); harness/sorting/part-4.md, contradiction 1.
