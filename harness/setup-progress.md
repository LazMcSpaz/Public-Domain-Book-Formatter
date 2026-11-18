# Harness setup: progress

Temporary. Deleted at handoff. A session resuming this work reads this file first.

- **Plan (approved 18 Nov 2026):** `REBUILD-PLAN.md` in the shelf repository.
- **Audit it rests on:** `archive/reports/audit-2026-11-18.md` in the shelf repository. Both are there, not here, because this repository is public and they name study copies and business details.
- **Branches:** all work goes to `harness-setup` in both repositories.
- **Bookmarks:** `pre-rebuild` marks each repository's `main` as it was before (formatter `8178998`, shelf `6880ecc`). It is a branch, because the git proxy refuses tag pushes.
- **Other sessions:** the owner is pausing the Book of Solomon session until step A is done. No other sessions should push to either repository meanwhile.

## Status

| Phase (existing-project harness)              | Plan section      | Status                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Safety net                                 | 6.1               | **Done.** Bookmarks, branches, audit and plan saved on the shelf.                                                                                                                                                                                                                                                       |
| 1. Investigate                                | audit             | **Done.** Audit report, survey of both repositories, helper reports (all in the audit).                                                                                                                                                                                                                                 |
| 2. Confirm with the owner (checkpoint A)      | 6.2 items 1–2     | **In progress.** `docs/product.md` approved 18 Nov (description as drafted; no inspirations section). `docs/still-works.md` first run 18 Nov: steps 2, 4 and 5 fail, and the step-3 crop is small (see its Known issues). Saving from the tablet has not worked since 7 Oct; proposed as an urgent fix ahead of step A. |
| 3. Sort the notes                             | 6.2 item 3        | Not started                                                                                                                                                                                                                                                                                                             |
| 4. Target map and cleanup plan (checkpoint B) | 6.2 items 4, 5, 8 | Not started                                                                                                                                                                                                                                                                                                             |
| 5. Install the harness                        | 6.2 items 6, 7    | Not started                                                                                                                                                                                                                                                                                                             |
| 6. Dry run                                    | 6.2 item 9        | Not started                                                                                                                                                                                                                                                                                                             |
| 7. Handoff (checkpoint C)                     | —                 | Not started                                                                                                                                                                                                                                                                                                             |

## Decisions and findings so far

- **The owner's biggest frustration** (18 Nov): being told a book is done or ready, uploading it to KDP, then finding a dictionary check never ran or OCR breaks were left in. Measured cause:
  - `book-files.mjs --finish`, the only "finished" gate, checks only that the reading is complete, a ledger exists, the shape is recorded, `corrections.md` exists, the queries are ruled with crops, and that glossary marks were _asked about_.
  - It never runs the spelling sheet on the exported file, the page-turn check, the damage check, second-reading coverage, the unprintable-character report or footnote pairing. It never compares the PDF with the book.
  - **This becomes:**
    1. a hard rule in the root `CLAUDE.md` (never say done or ready without the readiness report; list everything that did not run as NOT CHECKED);
    2. three defined words for a book's state: _read_, _checked_, _ready to upload_;
    3. cleanup task 1, a readiness gate run on the exact upload file, writing a dated report, with releases refused without it.
- **Future directions confirmed:**
  - likely: many more books, tracing and picture books, compilations;
  - maybe: own writing, audiobooks, selling beyond Amazon, translations, other people working on it.
- **Study books:** shown in the app, marked "study".
- **To-do list:** GitHub Issues.
- **Backups:** weekly, to the owner's E: drive. It must run as a scheduled task on the owner's Windows computer, since cloud sessions cannot reach it.
- **Tracing pilot:** the Book of Solomon. It is not on either repository yet.
- **Windows trap to avoid:** `docs/ARCHITECTURE.md` exists. The new `docs/architecture.md` must replace it in the same commit (old one to `docs/archive/`), never sit beside it. Windows treats the two names as one file.
- **Public and private:** this repository is public. Book text, study-book details, KDP and ISBN details, and the owner's personal details go in the shelf, never here.
- **Audit correction: the shelf has unmerged branches too.** The audit counted only the tools repository's.
  - `ritual-magic-sources`: 2 commits, 9 Nov; 15 scans (229 MB) and OCR text for about 16 ritual magic works.
  - `claude/blavatsky-uploads-check-zjpq32`: 39 commits, 19 Sep; includes a second _Isis_ Vol. II folder, `isis-vol2-syhtl3`.
  - `claude/aura-astral-plane-notes-8mjio9`: 2 commits, 17 Sep.
  - Do not merge `ritual-magic-sources` as it stands: its scans belong in file storage (plan 3.1), and each work should become a book with a card.
- **"Load failed" when saving from the phone** is a browser-level failure: no answer at all, not a GitHub refusal. A bad token normally shows GitHub's "Bad credentials". The owner was using Brave on a phone. Proposed urgent fix: the app names exactly which request failed and why, plus a connection test in Settings.
- **Workflow change (owner, 18 Nov):**
  - Most work now happens through chat sessions; the shelf app's tablet features need not be robust.
  - The tablet save failure, the missing ritual-magic cards and the small crops are logged, not fixed urgently.
  - The owner's ruling and marks from the first run don't matter.
  - The still-works checklist is rewritten around asking a session.
