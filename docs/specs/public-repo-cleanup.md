# Spec: Clean the public tools of book copies and ISBNs

Approved by the owner on 23 November 2026 ("B yes"), from this summary:

> A builder, checked by a reviewer, would remove the old book copies and the ISBNs from the public tools; after saving the three photographs to storage, delete the three old cover drafts on GitHub.

## What it does (plain English, for the owner)

This repository is public, and its rules say book text and ISBNs belong only on the private shelf. Three things broke that rule, and this change mends them:

1. **The old book copies.** `books/` held two early copies of the Panchadasi books, _Clairvoyance_ and _The Human Aura_ (their text, sheets and one picture), from before the shelf existed. The shelf has newer copies of both, made from the same scans, so these are removed. Nothing in the app, the scripts or the tests read them; the one place that named one (the paused "read a chapter aloud" button on GitHub) now asks for the book file instead of pointing at a removed one.
2. **Real ISBNs.** One code comment and one test used two real ISBNs of a published book. They now use made-up ISBNs (979-8-00000-301-5 and 979-8-00000-302-2), which are valid in shape but belong to no book, as the cover tests already do. The test still checks the same thing: a book with two ISBNs prints two ISBN lines.
3. **Three photographs on an old cover draft.** The old cover branch `claude/cover-front-icons` carries three book photographs used as cover backgrounds. Each is first saved to the storage bucket and listed in the shelf's `STORAGE.tsv`; only then may the old cover branches be deleted, by the managing editor, after the reviewer says ready.

**What this cannot do.** Git keeps every past version. The old book copies and the two ISBNs stay readable in this repository's history (and in the old branches until they are deleted), and the earlier study-book text that cleanup task 2 removed is still in history too. Removing anything from history means rewriting it with a "force-push", which this project forbids; that would need its own decision by the owner. This change stops the material appearing in the current files, nothing more.

## Done when (how we'll know it works; how the owner can try it)

- `books/` is gone from `main`'s files, and `npm run verify` passes.
- No 13-digit ISBN in the tree except made-up ones and a well-known textbook example (9780306406157) used in a barcode test.
- The three photographs are in the bucket under `pictures/<fingerprint>`, each fetched back and its fingerprint checked, and listed in the shelf's `STORAGE.tsv`.
- **Owner can try it:** on GitHub, open the tools repository: there is no `books` folder at the top. On the shelf, open `STORAGE.tsv` and search for `pictures/`: three rows dated 23 November 2026.

## Modules touched

- `books/` (removed).
- `src/core/layout/paginate.ts` (a comment only) and `test/layout-paginate.test.ts` (made-up ISBNs).
- `test/work-script.test.ts`: the test that the status-note command refuses the tools even when they have a `books/` folder relied on this repository having one. It now aims at a copy of the tools in a temporary folder, which also keeps a broken guard from writing here (the rule in `scripts/CLAUDE.md`).
- `.github/workflows/read-chapter.yml` (no default book), `scripts/read-book.mjs` (comment examples).
- `harness/rules.json`: `books` taken out of the folders the check skips, so a book copy put back at that path would be checked like anything else.
- `docs/architecture.md`, `docs/cleanup-plan.md` (task 13 notes `books/` as done; its four stray images remain).
- On the shelf: `STORAGE.tsv` only, written by `scripts/storage.mjs`.

## Rules/decisions that apply

- Root CLAUDE.md: "This repository is public. Book text, study-book details, KDP and ISBN details and the owner's personal details go in the shelf, never here."
- Cleanup task 13 ("Remove `books/`"): this does that part of it.
- Decision 0051 (large files in the R2 bucket, listed in `STORAGE.tsv`).
- No force-push; no branch deleted by the builder.

## Found in the search, not changed here

The whole tree was searched for other 13-digit 978/979 numbers, KDP details and the owner's details. No other real ISBN, no KDP account detail and no personal detail of the owner was found. These were found and are left for the owner to rule on, because they are outside the approved summary:

- **A study book's words in test fixtures.** `test/fixtures/boxes/patterns-vol1.json` and `patterns-vol2.json` (about 350 KB) are OCR word boxes taken from a study book still in copyright: each word of the sampled pages with its position. Tests of the reading-order and draft code read them. Replacing them needs made-up fixtures with the same page shapes, a change of its own.
- **Public-domain books' words in test fixtures.** The other files in `test/fixtures/boxes/` are word boxes from public-domain books; not a copyright problem, but "book text" in the wide sense.
- **A study book's title in code comments.** Several comments in `src/core/draft/`, `src/core/layout/`, `scripts/drive.mjs` and the tests name the study book the code was measured on. No text of it; a title only.
- **Old branches.** Nearly every old branch carries `books/` and the two ISBNs, and twelve (among them `claude/cover-front-icons` and `pre-rebuild`) still carry the study-book text that task 2 removed from `main`.

## Out of scope

- Deleting any remote branch (the managing editor does that, after review).
- Rewriting history.
- The four stray images and the rest of cleanup task 13.
- Copying anything onto the shelf other than the `STORAGE.tsv` rows.
