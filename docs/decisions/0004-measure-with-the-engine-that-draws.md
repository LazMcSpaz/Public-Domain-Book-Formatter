# 0004: Measure with the engine that draws

Status: inherited · Date: 2026-11-18

## Decision

Text is measured through one `TextMeasurer` (`src/platform/browser/fonts.ts`) that adds up the glyph widths returned by fontkit's `font.layout()`, which is the same call pdf-lib makes when it writes the text. The same font files serve both jobs, and the type features in use (`LAYOUT_FEATURES`) are one shared setting for measuring and for drawing.

## Why (plain English)

The line breaker decides where each line ends by measuring words. If words were measured one way and drawn another, a line that fits in the calculation could overflow or fall short on the printed page. Using the identical call means the two cannot disagree.

## What we gave up

Any other way of measuring, even a quicker one. Every type feature choice, such as small capitals, has to be applied to both sides at once.

## Rule for agents

Measure text only through the fontkit-backed `TextMeasurer`. Change `LAYOUT_FEATURES` in one place, and never give the measurer and the PDF writer different font files or features. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1988–1990; src/platform/browser/fonts.ts (header and `LAYOUT_FEATURES`).
