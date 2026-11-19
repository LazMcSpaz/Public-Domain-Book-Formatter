# Spec: pictures beside the book (cleanup task 6, the app's part)

## What it does (plain English, for the owner)

When the app opens a book from the shelf, it now finds the book's pictures where they really are. A book names each picture as a path such as `images/<name>.png`. Almost every picture sits in the book's own folder, but the app looked only at the top of the shelf, so plates went missing. That is why tablet step 7 fails.

Now the app looks in the book's folder first, then at the top of the shelf. A picture found in neither place is still reported by name, as before. Nothing is drawn in its place.

This is the same for opening a book to work on and opening it to read.

## Done when (how we'll know it works; how the owner can try it)

- One rule decides where to look for a picture. It is in the shelf map, `src/core/sync/shelf.ts`, and has its own tests.
- The rule tries the book's folder, then the top of the shelf. It never looks twice in one place, and it refuses a path that leaves the shelf or starts from the top of a disk.
- The app's two ways of opening a book from the shelf use one shared function that follows the rule.
- A test serves a picture only beside the book, only at the top of the shelf, and nowhere. The first two are found; the third is reported missing.
- That test fails when the old fault (looking at the top of the shelf only) is put back.
- `npm run verify` passes.
- **The owner tries it:** on the tablet, open _The Lost Keys of Masonry_ to read. Its seven plates show (still-works step 7).

## Modules touched

- `src/core/sync/`: the rule, in its own small file, reached through `shelf.ts` as the sheets rule is. `shelf.ts` is close to the size limit.
- `src/platform/browser/`: one function that fetches a book's pictures through the rule, in a new `shelf-pictures.ts`. `shelf.ts` there is already over the size limit, so it does not grow.
- `src/app/App.tsx`: the two picture loops are replaced by a call to that function. The file gets shorter.
- `test/`: tests for the rule and the function.
- `docs/still-works.md`: the Known issues entry says the cause is fixed, pending the owner's run.

## Rules/decisions that apply

- The root CLAUDE.md: this repository is public, so the tests use made-up names and bytes.
- `src/core/` stays pure: the rule is strings in, strings out.
- Every shelf read goes through `readUrl` in `src/platform/browser/shelf.ts`. The new function reads only through `getBytes`, which does.
- A picture that cannot be found is reported, never silently dropped.
- Cleanup task 6: one map of the shelf, read in the new place first and then the old.

## Out of scope

- **Where new pictures are written.** The app still writes a new picture to the top of the shelf (`images/<digest>.png`). Where new pictures should go belongs to the layout move (cleanup tasks 9 and 10). Until then, the app finds pictures in both places, so either is safe.
- The driver (`scripts/drive.mjs`). Its `load` already looks in both places. Teaching it the shared rule comes later in task 6.
- Other scripts, and fetching scans from the Cloudflare bucket.
- Moving any picture on the shelf.
