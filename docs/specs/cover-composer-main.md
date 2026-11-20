# Spec: the cover composer on `main`, with the picture on the frame's rule and textures from a file

Approved by the owner on 20 November 2026.

## What it does (plain English, for the owner)

"The cover program: add the setting that puts the drawing on the red line, and install the program properly. At the moment it only exists as an unfinished draft copy."

In more detail:

- The cover program (`scripts/cover-front.mjs`, the cover studio at `#cover`, and the code that lays out a cover) moves from its draft branch onto `main`, so every session and the deployed app have it.
- A new cover setting, off unless a cover asks for it, puts a picture held inside the frame right on the inner edge of the frame's inner line, touching it, instead of standing a little way inside.
- A cover can use a picture from a file as its background texture: the cover's spec names the file, and says where it goes, how large it is and how faint it prints. The picture itself stays with the book on the shelf (or in storage); it is never copied into the public tools.
- A small program that prepares such a picture (greys it, turns paper white and ink black, can drop red lettering, fades an edge, and sets it on a canvas the size of the box it fills) comes with it.

## Done when (how we'll know it works; how the owner can try it)

- `scripts/cover-front.mjs` and its modules are on the branch, and `npm run verify` passes.
- With `groundFigureOnRule` on, a framed picture's box starts exactly where the frame's inner line ends; with it off, covers come out as before. Tests prove both and fail with the fault put back.
- A spec with a `texture` block draws the named file in the box its placement names, at its scale, alignment and opacity. Tests prove the placement arithmetic in core.
- A spec that names a built-in figure the composer does not have stops with a message saying so, rather than quietly drawing no figure.
- The owner can try it by asking a session to recut a cover with its texture file: the session runs `node scripts/cover-front.mjs <spec.json> <out.png> --textures <folder>` and shows him the picture.

## Modules touched

- `src/core/cover/` (new folder of core: the cover's geometry, layout, checks, look and interview), split to the 400-line limit.
- `src/platform/browser/` (`cover-pdf.ts`, `cover-preview.ts`, `press-mark.ts`, `cover-looks.ts`, and small additions to `fonts.ts` and `download.ts`).
- `src/app/` (`CoverStudio.tsx` and its parts, the `#cover` route, the export screen's button).
- `scripts/` (`cover-front.mjs`, `cover-texture.py`, `screenshot-cover.mjs`, `textground.mjs`, `lib/chromium.mjs`).
- `test/` (the cover tests).
- `public/devices`, `public/marks`, `public/patterns` (the vector artwork the composer draws).
- `docs/` (this spec, `process/upload.md`, `reference/commands.md`, `reference/cover-composer.md`, `architecture.md`).

## Rules/decisions that apply

- This repository is public: no book's pictures go into it. The three photographs on the draft branch (`public/figures/`) stay out; a book's picture reaches the composer only as a texture file named in its spec.
- Only listed packages (`harness/rules.json`); nothing new is added. `cover-texture.py` uses Pillow only, which `flatten-cover.py` and `epub-shrink-images.py` already use. Known gap, older than this change: the Python packages (Pillow, and `img2pdf` for `flatten-cover.py`) have no decision record, since `rules.json` lists only npm packages.
- Module boundaries: the cover core stays pure (`npm run typecheck:core`); the browser parts stay in `src/platform/browser/`.
- Never raise the main device database's version for a cache (`src/platform/browser/CLAUDE.md`): banked cover looks get their own database.
- The baseline may only shrink: every new file is under 400 lines.
- Covers uploaded to KDP are the flattened copies (`docs/process/upload.md`), unchanged.

## Out of scope

- Making cover art with an outside image service (Replicate, built on the cover branch): a paid service the approved summary does not name and `docs/product.md` does not list. It stays on `claude/cover-front-icons` until the owner decides; it would come back with a decision record.
- A book's own text as a built-in ground (the branch's `lexicon` pattern, which was one book's text): `scripts/textground.mjs` makes it per book, outside the tools, and a spec gives it as a texture.
- `scripts/trace-device.py`, which needs NumPy and `potrace`, packages no script on `main` uses; the vector devices it traced are kept, the tool stays on the old branch.
- Changing any cover spec on the shelf. A spec that names `candidate-at-the-gates`, `sinnett`, `mahatma-hands` or `swami-plate`, or the `lexicon` pattern, needs its picture or text given as a texture file before it can be recut; that is the typesetter's.
- The book-specific cutting steps in the typesetter's scratch script (the crops, the canopy, skyline and floor extensions) and `make-handwriting-ground.py`; they stay with the typesetter.
- `scripts/radiance.mjs`, which made one emblem's artwork; that artwork is kept, the tool stays on the old branch.
