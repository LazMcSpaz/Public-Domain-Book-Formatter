# src/core/layout/

The layout engine: a book document plus a style, laid out onto real pages (frames, Knuth-Plass line breaking, pagination, footnotes, pictures, contents). The preview and the exported PDF are both drawn from its output.

Heading: `paginate.ts` (about 4,800 lines) is to be split along clear responsibilities, one task at a time.

## May use

- `@core/model`, `@core/assemble`, `@core/transcribe`, `@core/pages`, `@core/ornament`, `@core/image`; `hyphenation.en-us`, `tex-linebreak`.

## Must not

- Measure text any way but through the `TextMeasurer` it is handed, or load a font itself.
- Grow a second renderer or an approximate layout elsewhere: `layout()` is the one pass that owns the page.

## Key files

- `paginate.ts`: `layout()`, flowing a book onto pages; `spansFor`, `balancedLines`, `folioLabel`.
- `break-lines.ts`: `breakParagraph`, Knuth-Plass line breaking with hyphenation.
- `footnotes.ts`: `prepareFootnotes`, finding reference marks and pairing them with notes.
- `measure.ts`: `TextMeasurer`, `cachedMeasurer`, and `fixedWidthMeasurer` for tests.
- `frames.ts`: `frameFor`, page geometry and `RUNNING_HEAD_RISE`.
- `toc.ts`, `contents-pages.ts`, `contents-split.ts`: the contents, laid out twice so its numbers are measured.
- `types.ts`: what a laid-out page is made of (points, origin top left).

## Folder-specific rules and lessons

- No bold italic: `spansFor` puts strong before italic and first match wins (no synthesised weights: test/layout-polish.test.ts).
- Measure a space reserved for a thing on that thing as drawn (as `folioLabel` is), never on a stand-in string.
- A `TextMeasurer` wrapper must pass on every optional method (`hasGlyph`, `smallCapScale`); a dropped one makes every face seem complete.
- A positioned run's `xPt` is already absolute on the leaf: never add the frame origin to it.
- Slots are one body leading: type set larger takes several slots, so sizes just above body size silently double their spacing.
- Hang a rule from the baseline of a title's last line, at a fraction of the type size; never hang it on the slot grid.
- Measure from the frame or the trim, never both: folios centre on the frame; the title-page border and the type inside it use the trim.
- `balancedLines` breaks narrower than the measure, so re-centre every laid line on the measure explicitly.
- In any two-pass layout, pass one must reserve every line pass two emits, or the guard falls back (test/layout-footnotes.test.ts).
- Every guard fallback must add a warning to the laid-out book; a fallback beside "warnings: 0" is the failure mode.
- Figure width is inches (`widthIn`) at its cut DPI, never a share of the measure; an unhonoured placement falls back and is reported.
- Every consumer of note pairing (galley, `pairs`, EPUB, checks) reads `prepareFootnotes`' output; never write a second pairing rule.
