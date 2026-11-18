# 0013: Without pixels, the book is its own witness

Status: inherited · Date: 2026-11-18

## Decision

For a book with no page images (a born-digital PDF, an EPUB, an OCR'd typescript printed to PDF), a "crop" is only the text layer drawn again, so it cannot accept a reading. What stands in, strongest first: a second digitisation of the same printing (`src/core/witness`), then passages the book prints twice (`findParallels`, `drive.mjs concordance`), then the book's own vocabulary, counted. A damage finding carries `confidence`: `attested` where the volume itself settles it (the word is set whole elsewhere), `shape` where it cannot (a stray full stop has nothing to be counted against). A place with only context, and no parallel, raises a query rather than a correction.

## Why (plain English)

Showing a checker the same characters a finding was raised on, and asking whether that is what the page says, gets "yes" every time, which manufactures confidence. The book can honestly answer only what it can count: "Gardiner" five times against "Gardner" twice is evidence; a comma against a full stop is not.

## What we gave up

Automatic repair of such books. Even `attested` findings land only through a reported `sweep` once a person agrees the class is real; `shape` findings are only places to look.

## Rule for agents

Never check a no-pixel book against crops of its own text layer (`drive.mjs crops` refuses by the book's shape). Mark `attested` only where the volume's own text settles it, and list the two kinds apart. Never use this to repair a scanned book from its vocabulary: where pixels exist they remain the only accepter. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1899–1962 (1917–1925 for attested and shape).
