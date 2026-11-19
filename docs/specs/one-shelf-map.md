# Spec: one shelf map for the tools (cleanup task 6, the tools' part)

## What it does (plain English, for the owner)

The app already finds a book's pictures where they really are: in the book's own folder first, then at the top of the shelf. That rule lives in one place, and the app asks it. The tools that run in a chat session did not. The driver had its own copy of the rule, looking at the top of the shelf first. The EPUB builder looked only in the book's folder, so a picture kept at the top of the shelf stopped it.

Now every tool asks the same rule as the app. Opening a book with the driver, saving it, and building its EPUB all look in the same two places, in the same order. A picture found in neither place is still named, never left out quietly.

A book file kept outside a shelf (for example a copy in a scratch folder) still finds the pictures beside it, as before. It does not look anywhere above that folder.

Saving a book with the driver now leaves a picture where the shelf already has it. Before, a picture kept at the top of the shelf was copied into the book's folder on every first save, so it was stored twice. The app already worked this way.

One more safety step: when the app reads a file from the shelf, every part of the path is now written in the safe form a web address needs. Today every real name on the shelf is plain letters, digits, dots and dashes, so nothing changes for them. A name with a space, `#`, `?` or `%` in it, typed into a book file by hand, can no longer be misread as something else.

## Done when (how we'll know it works; how the owner can try it)

- One shared helper in `scripts/lib/` turns a picture a book names into a file on disk. It asks core's rule (`pictureCandidates`) and never copies it.
- The driver's `load`, the driver's `save` and the EPUB builder (`scripts/epub-of.ts`) all use that helper. A source test pins each one to it, and fails if any of them works out a picture's place by hand.
- The helper has its own tests on made-up files: a book on a shelf with its picture beside it, a picture at the top of the shelf, a picture found nowhere, a refused name, and a book outside a shelf.
- `readUrl` in `src/platform/browser/shelf.ts` encodes each part of the path, and so does the write beside it. A test shows a part with a space, `#`, `?` and `%` comes out encoded, and an ordinary `books/X/book.json` is unchanged.
- The real driver loads a made-up book whose pictures sit beside it, and another whose picture sits at the top of the shelf. Neither reports a missing picture, and the pictures are in the loaded book.
- Each test fails when its fault is put back.
- `npm run verify` passes.
- **The owner tries it:** nothing new to try by hand. The next session that loads a book with pictures should see no `missingImages` line, and the EPUB of a book with plates should build.

## Modules touched

- `scripts/lib/book-pictures.mjs` (new): the shared helper.
- `scripts/drive.mjs`: `load` and `save` call the helper. The file gets shorter.
- `scripts/epub-of.ts`: copies each picture from where the helper finds it.
- `src/platform/browser/shelf.ts`: `readUrl` and `putFile` encode each part of the path.
- `test/`: tests for the helper, the wiring and the encoding.
- `scripts/CLAUDE.md`, `docs/reference/commands.md`: a line each.

## Rules/decisions that apply

- This repository is public: tests and the end-to-end run use made-up books and pictures, never shelf text.
- `scripts/CLAUDE.md`: a script imports core's logic, never copies it.
- `src/platform/browser/CLAUDE.md`: every shelf read goes through `readUrl`.
- A picture that cannot be found is reported, never silently dropped.
- `drive.mjs` is over the size limit: it must not grow, so new logic goes in `scripts/lib/`.

## Out of scope

- Where a new picture is written. The driver still writes a new picture beside the book, and the app still writes one at the top of the shelf. Both places are read, so either is safe; settling one place belongs to the layout move (cleanup tasks 9 and 10).
- The other paths in the layout map (sheets, scans, cards) and `shelf push` reporting paths from the run key. They stay on task 6's list.
- Refusing a scan or crop path that climbs with `..`. Encoding cannot stop that; it needs a refusal of its own.
- The other review follow-ups listed under task 6 (the reading screen's note, the save's lookups, `screenshot-flow.mjs`).
