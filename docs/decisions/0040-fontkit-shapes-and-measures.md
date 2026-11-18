# 0040: fontkit shapes the type for both measuring and drawing

Status: inherited · Date: 2026-11-18

## Decision

`@pdf-lib/fontkit` parses and shapes fonts. The same loaded font serves pdf-lib's embedding and the app's `TextMeasurer`, which sums the advances of the glyphs `font.layout()` returns (0004). Type features go through it: a face's own ligatures, and small capitals, where a small-caps run is the same font embedded a second time with `smcp` on.

## Why (plain English)

Using the same shaping call to measure and to draw means a word is the same width in the line breaker as on the page. It is pdf-lib's own companion package, so the two agree by construction.

## What we gave up

Any other font library or measuring method.

## Rule for agents

Measure only through the fontkit-backed measurer, and keep the feature list shared (`LAYOUT_FEATURES`). Any wrapper around the measurer must pass on its optional questions (such as `hasGlyph`), or the engine believes every face can draw every character. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1296–1325, 1988–1990, 2143–2150; harness/sorting/part-4.md ("Packages in use").
