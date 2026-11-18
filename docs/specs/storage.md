# Spec: big-file storage in Cloudflare R2 (cleanup task 3)

## What it does (plain English, for the owner)

Large files leave the shelf repository and go into the private Cloudflare bucket `libri-vetus-files`, so the repository stays small and fast while every original is still kept. A session uses one command to put a file in the bucket, fetch it back or list what is there; each file is named by its fingerprint and checked against it after every move, so nothing can be silently damaged or lost. The shelf keeps a list of what is in the bucket and where each file came from.

First moves, each checked before anything is removed from the shelf:

1. **The reference copies** in `sources/` (about 850 MB).
2. **The exported PDFs, EPUBs and cover files.** They are kept in the bucket, not deleted, because it is not yet known which of them are the files that went to KDP (the owner's uploaded copies are on his computer; cleanup task 11 settles that).

**The ritual magic work is not moved from here.** About 5.3 GB of it sits on the owner's Windows computer, not yet pushed, built on the `ritual-magic-sources` branch. The session doing that work uploads its own scans and figure originals from that computer with the same command, pushes only the small files, and the old branch is deleted after. Page renders are not stored anywhere: they are made again from the scan.

**The command works in both places:** in a cloud session the key is injected by the network; on the owner's computer it reads the key from an environment variable set there.

The scans in `scans/` stay where they are for now: the app and the driver read them from the shelf, and teaching them to fetch from the bucket is part of cleanup task 6.

## Done when (how we'll know it works; how the owner can try it)

- Every moved file is in the bucket with a matching fingerprint and listed on the shelf.
- The shelf's current files drop from about 2 GB to under about 1 GB.
- The command runs on the owner's Windows computer as well as in a cloud session.
- The owner can ask a session "fetch the 1889 Key of Solomon scan" and get the exact file back.

## Modules touched

- `scripts/`: one new storage command, using only Node's own `fetch` and hashing (no new package).
- The shelf: a storage list, the moved folders, `CLAUDE.md`.
- `docs/reference/commands.md`, `docs/process/upload.md`, `docs/cleanup-plan.md`.

## Rules/decisions that apply

- [Decision 0051](../decisions/0051-big-files-live-in-cloudflare-r2.md): big files live in R2, named by fingerprint.
- [Decision 0052](../decisions/0052-what-a-finished-book-keeps.md): what a finished book keeps.
- The access key is a credential the session's network injects; it is never written into a file, a prompt or a log. The account identifier lives in the private shelf, not in this public repository.
- Nothing is removed from the shelf until its copy in the bucket has been fetched back and its fingerprint matches.

## Out of scope

- Moving `scans/` (cleanup task 6, once the app and driver can fetch from the bucket).
- Retiring the live books' working files (needs the KDP records of cleanup task 11).
- Files over 300 MB (the one known, the 357 MB _Isis_ Vol. I scan, is already rebuilt from instructions).
- The weekly backup to the E: drive (set up from a session on the owner's computer).
