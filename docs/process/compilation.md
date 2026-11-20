# Compilation: one volume from several works

## Purpose

Build one edition out of several documents that were each read separately,
from their own scans. One compilation exists so far: _The Manuscript Lectures_
of Manly Palmer Hall, 32 documents from 13 sources (shelf folder
`books/ManlyPalmerHall-CollectedManuscriptLectures-7qk2m4`). A second, the
Collected Booklets, is planned. A compilation book type with a parts list is
a likely future direction ([product.md](../product.md)), so this document
records what is known rather than a settled method.

## Who runs it

The **typesetter** ([.claude/agents/typesetter.md](../../.claude/agents/typesetter.md))
assembles the parts and keeps the parts list: putting the parts together is
making the book file and its pages, the stage the status notes call
`layout`. Each part is read by readers and checked by the **checker** as an
ordinary book, and the checker checks the whole volume and makes sure every
check that cannot run on the whole volume ran on each part.

## Before you start

- **Every part is read and checked on its own**, against its own scan, as an
  ordinary book ([reading.md](./reading.md), [checking.md](./checking.md)).
  The volume is a compilation of readings, not a reading.
- The editor has set the volume's order and each part's title (the Lectures
  keep them in `contents.md` beside the book). The titles are his sentences:
  never take them from the parts' own metadata or headings.
- The builder script is available (see below).

## What is known, as steps

1. **Keep a parts list**: each part's reading, its source scan
   (`scans/<sha256>.pdf`, or a note that no scan exists), and its shape. The
   Lectures keep the readings in `readings/` (one JSON per document) and the
   list in `sources.md`.
2. **Build the volume**:
   `node scripts/build-collection.mjs <book-dir> [--out book.json]` joins the
   readings into one run, renumbers their leaves into one sequence, takes
   chapter titles from `contents.md`, and sets each part's number as a heading
   over its title. It checks at build time that no part's last block is marked
   to continue onto the next leaf, so no paragraph joins across two documents.
   **This script is not on `main`**: it exists only on the unmerged branch
   `claude/manly-hall-manuscripts-86bvc0`. Merging it is the first step of the
   next compilation.
3. **Declare the shape.** The volume's book file names no scan
   (`scan: null`), so nothing can measure it:
   `node scripts/shape.mjs <book-dir> --declare '<json>' --because '<reason>'`,
   with the parts' shapes named in the reason.
4. **Load it in the driver against a stand-in.** `drive.mjs load` needs a PDF.
   For the Lectures a stand-in PDF of blank leaves, one per leaf of the volume,
   was used and never saved. Nothing in the export reads pixels from it, but
   `leaf`, `ocr`, `crops` and `querycrops` are meaningless against it: cut any
   crop from the part's own scan (`drive.mjs leaf <n> …` with that scan
   loaded), mapping the volume's leaf back to the part's leaf.
5. **Edit as any book**, against `drive.mjs body`. Before the stand-in trick,
   edits were made by hand through the core functions with markup counted
   before and after, and the book file's round trip proved first
   ([sessions.md](./sessions.md)).
6. **Check the whole volume** with every check that reads text: C1, C2, C3
   (text half only: there is no recon reading of the volume), C5, C7 to C12.
   Coverage (C4) and the italic witness run per part, where each part has a
   scan; record which parts were covered and which were NOT CHECKED.
7. **Export, cover and upload as any book**
   ([export.md](./export.md), [upload.md](./upload.md)). The Lectures' look
   is recorded with the book; its drop capital was deliberately not copied
   from the imprint's other books, because a lecture transcript is not
   scripture.

## Checks that must pass

The full list in [checking.md](./checking.md) and [upload.md](./upload.md),
with two differences for a compilation, each named in the checker's report
and recorded in the ledger by the managing editor:

- C3 (page turns) runs on the text half only;
- C4 (coverage) runs per part with a scan; parts with no scan anywhere (two of
  the Lectures exist only as a third party's transcription) are NOT CHECKED,
  and the editor's ruling on printing them is cited.

## What it produces and where it goes

One `book.json` built from the parts, the parts list and the readings beside
it on the shelf, the declared shape, and the usual exports and readable files.
The parts' own readings and scans stay on the shelf: anything that wants
pixels goes back to the part.

## Never

- Never take a part's title from its wrapper or its first heading when the
  editor has set one.
- Never treat the stand-in PDF as a scan, or cut a crop from it.
- Never call a compilation checked because the volume passed; say which parts
  each check covered.
- Never let a paragraph join across two documents.
