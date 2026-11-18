# 0019: Every glyph the book prints has a width

Status: inherited · Date: 2026-11-18

## Decision

Every glyph the book prints must have its width recorded in the PDF. `src/platform/browser/font-widths.ts` adds the glyphs the book actually uses (ligatures, alternates, small capitals) to pdf-lib's width list, and `renderPdf` verifies every drawn glyph before saving and throws rather than write a book with holes. Letters a book's face lacks (Greek, Hebrew) are set in Cardo (`GLYPH_FALLBACK_FAMILY`), and any character still drawn as an empty box is named in the export warnings (`unprintableIn`).

## Why (plain English)

pdf-lib records widths only for glyphs reached from a character code, so a ligature or small capital printed as an em of white space in the middle of a word, and copied out as nonsense. Every other check passed while the page was wrong. Greek and Hebrew printed as rows of empty boxes in the Theosophical Glossary and passed every check too, until the export was read back.

## What we gave up

Turning ligatures and small capitals off, which was the earlier workaround. A slightly slower export, since every glyph is checked.

## Rule for agents

Draw text only in `drawPage` (`src/platform/browser/pdf-out.ts`), the single place the width check covers. Never weaken `verifyWidths` to make an export pass. After exporting a book that quotes another script, read the `unprintable` line and look at the page. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1296–1325, 1981–1987, 2143–2150.
