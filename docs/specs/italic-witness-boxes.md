# Spec: the italic witness works on a scan with no text layer (cleanup task 18)

## What it does (plain English, for the owner)

Italic matters in these books, and a page that lost its italic looks exactly like a page that never had any. So a "witness" measures which words the paper prints in italic, from the slant of the letters, and the book is compared with it.

For a scan with no text layer, the witness needs to know where each word sits on the page. The first reading (task 17) already finds every word and its box, but nothing passed those boxes on. Without them the witness measured nothing, wrote an empty list and reported success. So italic was never checked on the _Goetia_.

Now:

- `drive.mjs words --out` writes the boxes from the first reading, in the form the witness reads.
- The witness fails with a plain message when it measured no words, and writes nothing. The same fault in the other witness (`italic-witness.mjs`, for files with a text layer) is fixed the same way.

## Done when (how we'll know it works; how the owner can try it)

- On a scan with no text layer, the witness, given the boxes, reports the words it measured.
- A run that measures no words exits with an error and writes nothing.
- A test fails when either fix is taken out.
- The owner can ask a session: "Check the italic of this scanned book." The answer gives the words measured, or says plainly why nothing could be measured.

## Modules touched

- `src/core/image/witness.ts` (new), with tests: `witnessPages` turns the first reading's words into the witness's boxes; `noWordsMeasured` is the plain message when nothing was measured.
- `scripts/drive.mjs`: `words --out`.
- `scripts/slant-witness.ts` and `scripts/italic-witness.mjs`: fail loudly.
- `docs/process/reading.md`, `docs/reference/commands.md`.

## Rules/decisions that apply

- `scripts/CLAUDE.md`: a check with nothing to compare against must refuse, not pass.
- The boxes must be in the witness's own pixels. Checked, not assumed, on a synthetic scan with no text layer: recon's boxes and the original file's text layer agree to a few pixels at 300 DPI on every word, on the same leaf numbers (both count from 0), and pdf.js (recon) and mupdf (the witness) frame rotated and cropped pages identically. Cleaning before OCR never resizes a page. Only the resolution could differ, and the boxes are scaled to 300 DPI if it ever does.
- The boxes carry the book's words, so they go to a working file outside this public repository.
- No new package.

## Out of scope

- Changing how the witness measures slant.
- Running the witness automatically inside the readiness check.
