# Spec: generated sheets go beside the book (cleanup task 0)

## What it does (plain English, for the owner)

The commands that write a book's sheets (queries, rulings, review, proposals, damage, parallels) put them in that book's folder on the shelf, never in the tools repository, which is public. If a command cannot tell where the book's folder is, it refuses and says why. The location it reports is the book's real folder.

## Done when (how we'll know it works; how the owner can try it)

- After loading a book from any shelf folder and running `queries`, `damage`, `parallels`, and `propose` then `save`, `git status` in the tools repository shows nothing new.
- The sheets are beside that book's `book.json`, and the reported paths name its folder.
- A sheet path inside the tools repository is refused, with a message naming the book folder to use.
- A test fails if the rule is taken out.

## Modules touched

- `scripts/drive.mjs` (the verbs that write sheets, and `load`, which must remember where the book file came from).
- `src/core/sync/shelf.ts` (one pure function that decides a sheet's path, used by the driver).
- `test/`.

## Rules/decisions that apply

- The root CLAUDE.md: this repository is public; book text never goes in it.
- One map of the shelf (`src/core/sync/shelf.ts`) decides paths; the driver asks it.

## Out of scope

- Moving any existing sheet on the shelf.
- The shelf layout of the rebuild (cleanup task 6).
