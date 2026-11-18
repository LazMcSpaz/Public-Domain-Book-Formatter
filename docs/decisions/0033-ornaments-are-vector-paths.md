# 0033: Ornaments are vector paths drawn by the PDF writer

Status: inherited · Date: 2026-11-18

## Decision

Printer's ornaments (fleurons, dividers, chapter-opener art) are a built-in library of vector shapes stored as path data in `src/core/ornament/ornaments.ts` (`BUILTIN_ORNAMENTS`), placed by the layout engine and drawn into the PDF with pdf-lib's `drawSvgPath`.

## Why (plain English)

Vector shapes print sharp at any size. Keeping the art as data in one place means there is no separate image file and copy that could disagree. The earlier plan converted SVG files to PDF for XeLaTeX, which no longer exists.

## What we gave up

SPEC.md §8's user-uploadable ornaments and its SVG-to-PDF conversion step. Code note: there is no upload path; the library is the built-in set only.

## Rule for agents

Add an ornament as path data in `ornaments.ts`. Do not add image files for ornaments or a second way of drawing them. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2103–2106; SPEC.md §8; src/core/ornament/ornaments.ts (header comment).
