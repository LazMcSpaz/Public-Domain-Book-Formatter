# 0052: What a finished book keeps

Status: accepted · Date: 2026-11-18

## Decision

When a book has been uploaded to KDP, its folder is cut down to what is worth keeping. Everything else is moved to storage or deleted, as the last step of the upload.

**Kept on the shelf (small, changes, worth every version):**

- `book.json`, the card, and the book's README;
- the ledger and the editorial sheets: queries, rulings, proposals, review, corrections;
- the readable views (introduction, glossary, notes) and the research behind them;
- cover designs (the spec files and blurb), not the cover files;
- the pictures placed in the book, at print size, with their provenance record;
- a receipt for each KDP upload: the exact files (fingerprints, sizes), the date, the ISBNs, where they are in storage, and the readiness report.

**Moved to storage (worth keeping, too big for git):**

- the scan, and any second copy used;
- reference copies;
- picture originals and traced masters;
- the exact files uploaded to KDP for each edition;
- the OCR and second readings, needed if a later fix means re-checking the book.

**Deleted (can be made again, nothing lost):**

- exports that were never uploaded, once a newer one exists;
- cover preview pictures and any cover file that was not uploaded (the spec rebuilds them);
- query crops, once every query is ruled (they can be cut again from the scan);
- contact sheets and scratch files;
- check sheets older than the latest readiness report.

## Why (plain English)

The owner does not want a finished book carrying files nobody needs. A book's lasting value is its text, its decisions and the record of what went to KDP; everything else is either a large original that belongs in storage or a by-product that can be made again in minutes.

## What we gave up

Keeping everything "just in case" in the repository, which is what made it 5 GB. Anything deleted here can be regenerated from what is kept.

## Rule for agents

Retire a book's working files as the last step of every upload, by this list, and say what was moved and what was deleted. Never delete a scan, a reference copy, an uploaded file, the book file or a hand-written record. Do not replace without a new decision record.

## Source

The owner's instruction, 18 November 2026: "after a book is done, we aren't keeping unnecessary files."
