# Cleanup plan

Numbered tasks, in order: the one the owner most needs first, then the safest and most useful, the riskiest last. Each fits in one session and leaves everything working. When asked to "clean up", take the top unfinished task, follow "How to build a feature" in the root CLAUDE.md, and mark the task done here with the date and commit.

The design behind tasks 5 to 15 is the rebuild plan the owner approved on 18 November 2026 (`REBUILD-PLAN.md` on the shelf). Still-works steps are numbered as in [still-works.md](still-works.md).

## 1. One readiness check, run on the exact files that go to KDP

**Why (plain English).** Books were called done that were not fully checked: the dictionary check had not run, or page-turn breaks were left in. The only "finished" check (`book-files.mjs --finish`) looks at the reading and the queries and runs none of the checks on the file being uploaded, and `drive.mjs finish` runs only some of them.

**The fix.** One command that:

- runs every check for the book's stage on the exact interior, cover and EPUB files;
- writes a dated report to the book's folder on the shelf;
- marks each check passed, failed or NOT CHECKED.

It runs or owes **every item of the full list** in [process/checking.md](process/checking.md#checks-that-must-pass-the-full-list-for-checked-and-ready-to-upload) (C1 to C12, R1 to R11), not a selection. Among them:

- the spelling sheet on the exported file (`spelling-of.ts --text`), with a recorded line saying it was read and each word settled;
- page turns, damage, apparatus, consistency and coverage, using `--second` where the scan has no text layer;
- footnote pairing;
- characters printed as empty boxes (`unprintableIn`, given a test);
- working notes left in the text, such as "(delete)";
- markup or stale text in the PDF, and the PDF older than its book file;
- the cover page count against the interior;
- the bias audit on the editor's prose;
- glossary marks;
- the readable files in step.

**Two gaps it must handle:**

- A book whose only recon reading is of another copy has leaves shifted against its own, as with _Thought Vibration_'s `recon-1906.json.gz`, offset by 4. It must report the page-turn paper check as NOT CHECKED, not run it against the wrong copy.
- The export report is not saved, so the export-side checks need the export run again or its report kept.

Both finish commands defer to it.

**Risk:** medium (new checks; no book data changes).

**Touches:** `scripts/`, `src/core/coherence/`, `src/platform/browser/font-widths.ts` (`unprintableIn`), `test/`, `docs/process/`, `docs/reference/commands.md`.

**Done when:**

- the command reports on _The Lost Keys of Masonry_ and _Thought Vibration_;
- a deliberately planted fault (a "(delete)" note, a split word) makes it fail;
- the root CLAUDE.md rule names it.

**Verify:** `harness/check.py`, the tests, and still-works step 3.

## 2. Take the study-book text out of the public repository (done 18 November 2026)

**Done.** The trial readings moved to the shelf's `archive/ledger-data/`; `scripts/select-ledger.mjs` now takes the folder as an argument. By the owner's decision the repository's history was left as it is, so the text remains in past commits.

**Why (plain English).** `docs/ledger-data/` holds about 1.7 MB of OCR and proofed text from _Patterns_ Vol. II (1977), a copyrighted study book, in this public repository.

**The fix.**

- Move the trial readings to the shelf's `archive/`, and repoint `scripts/select-ledger.mjs`.
- Whether to also erase the text from this repository's history is the owner's decision: it means rewriting public history.

**Risk:** low.

**Touches:** `docs/ledger-data/`, `scripts/select-ledger.mjs`, `scripts/cleanup-ledger.mjs`.

**Done when:** no study-book text is in the repository's current files, and the ledger scripts still run against the shelf copy.

**Verify:** `harness/check.py` and the tests.

## 3. One command before every commit, and the harness check in CI

**Why (plain English).** "Typecheck, test, format check, lint" is a habit written down, and habits skip.

**The fix.** `npm run verify` runs all four plus `python3 harness/check.py`; CI runs it on every push.

**Risk:** low.

**Touches:** `package.json`, `.github/workflows/ci.yml`.

**Done when:** a push with a new problem fails CI with the check's own message.

**Verify:** `npm run verify`.

## 4. Enforce "core stays pure" and fix the one boundary crossing

**Why (plain English).** The rule is only written down. A text search cannot enforce it, because the core has a variable named `document`. `src/platform/browser/control.ts` imports from the app.

**The fix.**

- A separate type-check for `src/core` with no browser or Node types available.
- Move what `control.ts` needs out of the app.

**Risk:** low.

**Touches:** a new tsconfig for core, `src/platform/browser/control.ts`, `src/app/agent-surface.ts`.

**Done when:** the type-check runs in `npm run verify`, and the boundary problem drops out of the baseline.

**Verify:** `harness/check.py`, the tests, and still-works steps 1–2.

## 5. The tools learn the new shelf layout, and pictures are found

**Why (plain English).** Today the app looks for a book's pictures at the top of the shelf while 151 of the 152 sit in the book's folder, so plates go missing. The rebuild moves files, so every tool must ask one map where things are.

**The fix.**

- One layout map in `src/core/sync/shelf.ts`, which the app, the driver and every script ask.
- Every read tries the new place, then the old.
- A book file's picture paths are read relative to its book.

**Risk:** medium.

**Touches:** `src/core/sync/`, `src/platform/browser/`, `scripts/`.

**Done when:** the app and the driver open every book with its pictures from either layout.

**Verify:** `harness/check.py`, the tests, and still-works steps 1, 2 and 7.

## 6. Catalogue records and the rights check

**Why (plain English).** Nothing records a book's rights, so the Hall territories were missed.

**The fix.**

- Each book's card gains: permanent ID, type (for sale, study, planned, archived), stage, series, ISBNs per format, live formats, the AI declaration, and rights (authors' death years, publication, territories chosen).
- A check flags any book sold outside the US whose author died within 70 years.
- The rights sections are drafted from the ledgers for the owner to confirm.

**Risk:** low.

**Touches:** `src/core/sync/`, `scripts/`, the shelf's cards.

**Done when:** every book's card has the fields, and the check runs.

**Verify:** `harness/check.py`, the tests, and still-works step 6.

## 7. Changes reach `main` through the checks, and the shelf gets its own checks

**Why (plain English).** Work was stranded on branches the app never sees, and rules on the shelf were kept by memory.

**The fix.**

- A workflow merges a session's branch into `main` by itself once CI passes. It works on any GitHub plan, and replaces the "fast-forward main" rule.
- The shelf gets a harness check: layout, picture provenance, rights fields, size limits.

**Risk:** low to medium.

**Touches:** `.github/workflows/` in both repositories.

**Done when:** a session's push with passing checks lands on `main` without a manual merge, and one with failing checks does not.

**Verify:** both repositories' checks.

## 8. Choose where big files live

**Why (plain English).** The shelf is about 2 GB of files plus about 3.4 GB of history; GitHub asks for under 1 GB.

**The fix.** Test GitHub's large-file storage and Cloudflare R2 on one book's files, including whether the app can read them in a browser, and record the choice as a decision.

**Risk:** low.

**Touches:** a decision record; no books yet.

**Done when:** the decision record names the storage and the measured results.

**Verify:** the test results in the record.

## 9. Move one pilot book to the new layout

**Why (plain English).** Prove the layout on one small, live book with pictures before moving the rest.

**The fix.** Move _The Lost Keys of Masonry_ into the new layout, with every file moved together with its history.

**Risk:** medium.

**Touches:** one shelf book folder.

**Done when:** every file is accounted for by fingerprint, the book file is unchanged apart from its picture paths, every check gives the same answer as before, and the app opens it with its plates.

**Verify:** still-works steps 1–3 and 7.

## 10. Move the other books, a few per session

**Risk:** medium.

**Touches:** the shelf's book folders.

**Done when:** every book folder matches its type's layout, and the shelf check passes.

**Verify:** still-works steps 1–5.

## 11. Releases for what went to KDP, and big files out of git

**Why (plain English).** "What is live, and from which files?" had no answer.

**The fix.**

- A release per edition uploaded to KDP, made from the owner's Downloads files.
- A "latest" release per book for exports not yet uploaded.
- `sources/` and the ritual magic scans go to the storage chosen in task 8.

**Risk:** medium.

**Touches:** the shelf.

**Done when:** each live edition has a release, and the shelf's files are under about 820 MB.

**Verify:** still-works steps 1–2.

## 12. Clean folder names, archived books and the ritual magic works as books

**The fix.**

- Clean `Author-Title[-VolN]` names.
- The separate _Human Aura_ and _Astral World_ go to `archive/books/`.
- Study books are marked "study".
- Each ritual magic work becomes a book folder with a card.

**Risk:** medium.

**Touches:** the shelf.

**Done when:** the shelf check passes, and the app lists study books marked as such.

**Verify:** still-works steps 1 and 6.

## 13. Tidy the tools repository

**The fix.**

- Merge or close the unmerged branches: eight here and three on the shelf. Merge the cover maker (`claude/cover-front-icons`) and the compilation builder (`claude/manly-hall-manuscripts-86bvc0`); today neither script is on `main`.
- Remove `books/` and the four stray images.
- Delete the 11 abandoned scripts.
- Group the paused audiobook work in `audiobook/`.
- Move book-specific one-off scripts to `scripts/one-off/<book>/`.
- Remove unused packages after confirming they are unused.

**Risk:** low.

**Touches:** this repository.

**Done when:** the harness baseline has shrunk, and no instruction names a missing script.

**Verify:** `npm run verify` and still-works steps 1–2.

## 14. Turn the known traps into checks

One small task each:

- a tag-count comparison after every sweep, so a sweep that strips italics fails;
- `drive.mjs load` refuses a PDF that is not the book's scan;
- `sweep` refuses a match inside a longer word;
- `transcribe` warns when landed leaves shift the numbering of corrected notes;
- driver commands warn when the running server is older than the code;
- `card` and `queries` refuse to overwrite hand-written sheets;
- a test that the path aliases agree in `tsconfig.json`, `vite.config.ts` and `vitest.config.ts`;
- a count of bad line starts in an exported PDF after any line-breaking change.

**Risk:** low each.

**Verify:** each new check is seen to fail with its fault put back.

## 15. Remove the old-layout fallback

After a few days of normal use following task 12.

**Risk:** low.

**Verify:** still-works steps 1–5.

## 16. Split the giant files, one per task

`scripts/drive.mjs` (7,815 lines), `src/app/App.tsx` (5,670) and `src/core/layout/paginate.ts` (4,811) are also the files changed most often.

**Risk:** high, so last.

**Done when:** each split file is under the size limit, and behaviour is unchanged.

**Verify:** all checks, all tests, and every still-works step, before and after.

## After the cleanup (product work, not cleanup)

- merge the two reading pipelines;
- the house symbol font;
- the Book of Solomon as the pilot tracing book;
- the GitHub Issues board;
- the weekly backup to the owner's E: drive, set up from a session on his computer;
- monthly checkups;
- the tablet's failed saves, logged in still-works and not urgent by the owner's decision.
