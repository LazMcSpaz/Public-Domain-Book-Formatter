# Pictures: the book's own, the ones added, and tracings

## Purpose

Three kinds of picture work, each with its own rules:

- **The book's own pictures**, reproduced where and at the size the original
  printed them (the editor's standing ruling, first made on leaf 193 of _Isis
  Unveiled_ Vol. I). A transcription has no field for an engraving, so a
  figure reaches the book only when someone with the scan cuts it and says
  where it stood.
- **Pictures added for this edition**: plates, illustrations, a frontispiece,
  each sourced, licensed and recorded.
- **Tracings**: a clean redrawing of a plate or seal, kept beside its original.

## Who runs it

- **Image tracer**: finds, measures, cuts, cleans and traces, and writes the
  provenance record.
- **Image checker**: a reader who did not do that work, checking every picture
  against its passage, its caption and its source. The checker edits nothing.

## Before you start

- The book is read and loaded from the shelf with its real scan
  ([sessions.md](./sessions.md)).
- For added pictures: the editor has chosen which, from a candidates sheet.

## Steps: the book's own pictures

1. **Ask the book once for every picture**: `node scripts/drive.mjs figures f.md`
   lists what the first reading's ink test found. It is a shortlist, not a
   check: on _Isis_ Vol. I it found one of three plates, and a figure with text
   run around it escapes it entirely.
2. **Look at every leaf.** Render the leaves (`node scripts/drive.mjs leaf <n> <name>`
   for each, named `<anything>-<leaf>.png`), then
   `node scripts/contact-sheets.mjs <renders-dir> <out-dir>` tiles them many to
   a sheet. A shape among even grey columns is unmistakable. A clean sweep is a
   floor, not a census: a two-line diagram may not survive the reduction, so
   say so rather than reporting the book has no pictures.
3. **Measure the box, do not guess it.** `node scripts/figure-boxes.mjs <render.png>`
   bands a rendered leaf by clear rows and prints each band's ink box in the
   coordinates `figure cut` takes (x, y, width, height as fractions of the
   leaf). A figure drawn out of type and rules (a diagram) is found by looking,
   then measured this way.
4. **Cut and place**, at 300 DPI, as the original set it:
   - between paragraphs at its printed size:
     `node scripts/drive.mjs figure cut <leaf> <x,y,w,h> --after <blockId>`;
   - inside a paragraph, before a phrase:
     `node scripts/drive.mjs figure cut <leaf> <x,y,w,h> --in <blockId> --at "<phrase>"`;
   - with the text running past it:
     `node scripts/drive.mjs figure cut <leaf> <x,y,w,h> --beside <blockId> --at "<phrase>" --side left|right`.

   `figure list` and `figure drop <id>` manage them. `--from <pdf>` cuts from
   another copy of the same printing (for a book read from an EPUB). A symbol
   set inside a line is cut the same way with `--in`, or replaced by the
   character the book prints for it elsewhere.

5. **Caption and description.** A caption the leaf carries as its own block
   prints where it is. To change a caption or position without cutting again:
   `node scripts/drive.mjs figure set <id> --caption-file c.txt --after <blockId>`.
   `--alt "…"` is the description for readers who cannot see the picture (the
   EPUB's alt text, never printed); write it from the picture and its passage.
6. **Look at the page it landed on.** `node scripts/drive.mjs proof` reports
   each picture's page and its DPI at the placed size; `proof <page>` renders
   it. Cut at 300 and set at its own width, it is 300; a smaller number means it
   was set larger than the original.
7. **Save and commit**: `save` writes new pictures beside the book
   (`images/<digest>.png`) and leaves one the shelf already has where it is,
   then the readable files, then one commit.

## Steps: pictures added for this edition

1. **A candidates sheet for the editor** (`image-candidates.md` beside the
   book): the places a picture would help a reader most, each with its passage,
   the kind (an old plate, or a diagram drawn new from the entry's words) and
   the source found. The editor chooses.
2. **Source rules.** A pre-1931 image is preferred. Check the licence on the
   file's own page: a museum photograph is modern even when the object is
   ancient. A picture licensed CC BY must print its credit in the caption.
3. **Place it**: `node scripts/drive.mjs figure add <file> --plate <blockId> --caption "<caption>"`
   gives it a leaf of its own after the block; `--frontispiece` puts it facing
   the title page. The file is copied pixel for pixel.
4. **Record its provenance**, one entry per picture: the caption, the source
   (work, date, plate or page), the scan used (where, resolution), the work
   done, and the editor's approval with its date. Today this is `art/SOURCES.md`
   or `illustrations.md` beside the book; one `images/pictures.md` per book is
   planned. KDP's "Illustrated" label needs ten or more original illustrations
   ([upload.md](./upload.md)).

## Steps: tracing

1. Trace from the best scan of the original, at print resolution, not scan
   resolution (KDP caps the interior's file size).
2. Vectorise a line engraving as engraved (potrace), or keep it as a 1-bit
   raster near 600 DPI at print size where the hatching is the engraver's.
3. **Clean-up is fine where the meaning of a symbol or seal is certain**
   (owner's rule). Anything more, such as completing a part the plate frame cut
   off or making a figure symmetrical, is written in the provenance entry's
   "work done" and approved by the editor.
4. Keep the original and the tracing side by side under the same name (planned
   home: `images/originals/` and `images/traced/`).
5. Not supported yet: setting an original and its tracing as a planned pair of
   facing pages, a book with no text to recover, and a check that lays a tracing
   over its original. The first picture book (the Book of Solomon) is the pilot
   for these.

## Steps: the image check

The image checker opens every picture, reads the whole entry or passage it
illustrates, and checks the caption and source against what the picture shows
and against the source's own record (licence included). Each picture is graded
OK, MINOR or WRONG with the reason, in a dated sheet beside the book (today
`art/CHECK-<date>.md`; planned `review/checks/<date>-image-checker.md`).
Nothing is edited by the checker. Every WRONG is fixed or put to the editor
before the book is called checked.

## Checks that must pass

- The `proof` report: `imagesDropped: []`, every picture's page and DPI
  listed, no missing picture warned about (R2 in [checking.md](./checking.md)).
- Every picture has a provenance entry. (proposed check); by hand today.
- The image check sheet has no WRONG left open.
- `npx vite-node --config vitest.config.ts scripts/epub-of.ts <book-dir> <out-dir>`
  names no picture with neither a caption nor a description (R11).
- The contact sheets were looked at, and the ledger says the sweep is a floor.

## What it produces and where it goes

Picture edits in `book.json`; the pixels in `images/` beside the book; the
originals and tracings in `art/`; the provenance record and the image check
sheet; a ledger entry saying what the sweep found and what it could have
missed.

## Never

- Never invent resolution: cut at the render's DPI and place at that size;
  never render larger to make the number look better.
- Never draw a placeholder for a missing picture; report it.
- Never call a book free of pictures from `figures` alone.
- Never print a CC BY picture without its credit.
- Never let a tracing change what a symbol means without the editor's approval.
- Never let the person who made a picture be its only checker.
