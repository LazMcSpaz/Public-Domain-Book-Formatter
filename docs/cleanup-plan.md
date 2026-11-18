# Cleanup plan

Numbered tasks. **The numbers are names, not the order:** work them in the order below, so a new task can go anywhere without renumbering. Each fits in one session and leaves everything working. When asked to "clean up", take the first unfinished task in this list, follow "How to build a feature" in the root CLAUDE.md, and mark the task done here with the date and commit.

**Order of work:** 0, 3, 1, 17, 18, 19, 20, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16. Task 2 is done. Storage comes before the readiness check by the owner's decision of 18 November 2026, because a book whose scan is over GitHub's limit cannot reach the app until it exists.

The design behind tasks 3 and 6 to 15 is the rebuild plan the owner approved on 18 November 2026 (`REBUILD-PLAN.md` on the shelf). Still-works steps are numbered as in [still-works.md](still-works.md).

## 0. Generated sheets never land in the tools repository

**Why (plain English).** On the first book run through the new setup (the 1904 _Goetia_), `drive.mjs queries` wrote `queries.md`, `review.md` and `rulings.md` into the root of this public repository, `damage` wrote `damage.md` there, and `save` after `propose` once left `proposals.md`. Those sheets quote the book, so one `git add -A` would publish private text. The shelf path the command reported was also wrong: a folder name built from the scan's path, not the book's real folder. Found and reported by the session that ran the book.

**The fix.**

- Every verb that writes a sheet writes it beside the loaded `book.json` (the path given to `load` or `save`), or refuses.
- The reported shelf path comes from the book's real folder, through the one shelf map.
- A test proves a sheet cannot be written to the repository root.
- The `.gitignore` safety net is already in place (18 November 2026).

**Risk:** low.

**Touches:** `scripts/drive.mjs`, `src/core/sync/shelf.ts`, `test/`.

**Done when:** running `queries`, `damage` and `propose` then `save` on a book loaded from any shelf folder leaves nothing in the tools checkout, and the reported paths name the book's folder.

**Verify:** `git status` in the tools repository is clean after the run; the tests; `harness/check.py`.

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

## 3. Big files into Cloudflare R2, and finished books cut down to what they need

**Why (plain English).** The shelf repository is about 5.5 GB with its history, almost all of it scans and exported PDFs, and every session downloads it. The books themselves are about 2 MB each. The owner also wants a finished book to carry no files nobody needs. Decisions [0051](decisions/0051-big-files-live-in-cloudflare-r2.md) and [0052](decisions/0052-what-a-finished-book-keeps.md) say what goes where.

**The fix.**

- **The owner** enables R2 in the Cloudflare dashboard (the Cloudflare connection reported it is not enabled).
- **A private bucket:** files named by fingerprint, laid out as:
  - `scans/`;
  - `sources/`;
  - `pictures/`;
  - `editions/<book>/<edition>/` for the exact files uploaded to KDP.
- **An access key** stored as a credential for sessions, never in a file.
- **One small storage command** for sessions: put, get, list, each checking the fingerprint. Its first use moves:
  - the ritual magic scans (the `ritual-magic-sources` branch, which is then deleted, unmerged);
  - `sources/`;
  - the large scans the shelf cannot hold.
- **The "retire the working files" step** of decision 0052, run as the last step of an upload, and once over the books already live.
- **The weekly backup to the owner's E: drive** copies the bucket too.

**What the first full book run showed (18 November 2026).**

- The ritual magic work holds about 5.3 GB of new files on the owner's Windows computer, not yet pushed: 600-ppi page renders, figure cut-outs and scans.
- The _Goetia_ scan alone is 134 MB, over GitHub's 100 MB limit for one file, so without the bucket such a book cannot reach the app at all.
- **The ritual magic session migrates its own files,** from the computer where they are. It uploads scans and figure originals to the bucket, pushes only the small files (book folders and records) to the shelf, and the old remote branch is deleted after that. No session elsewhere touches that work.
- **Page renders are not kept anywhere:** they are made again from the scan in minutes (decision 0052).
- **The storage command works in both places:** in a cloud session, the key is injected by the network; on the owner's Windows computer, it reads a key from an environment variable set there.

**Risk:** medium (files move; nothing is deleted until its copy in R2 is checked by fingerprint).

**Touches:** `scripts/`, `docs/process/upload.md`, the shelf.

**Done when:**

- the bucket exists;
- every moved file is in R2 with a matching fingerprint and recorded on the shelf;
- the shelf's current files are under about 0.8 GB;
- the four live books keep only what decision 0052 lists.

**Verify:** fingerprints match for every moved file; `harness/check.py` in both repositories; still-works steps 1–2.

## 4. One command before every commit, and the harness check in CI

**Why (plain English).** "Typecheck, test, format check, lint" is a habit written down, and habits skip.

**The fix.** `npm run verify` runs all four plus `python3 harness/check.py`; CI runs it on every push.

**Risk:** low.

**Touches:** `package.json`, `.github/workflows/ci.yml`.

**Done when:** a push with a new problem fails CI with the check's own message.

**Verify:** `npm run verify`.

## 5. Enforce "core stays pure" and fix the one boundary crossing

**Why (plain English).** The rule is only written down. A text search cannot enforce it, because the core has a variable named `document`. `src/platform/browser/control.ts` imports from the app.

**The fix.**

- A separate type-check for `src/core` with no browser or Node types available.
- Move what `control.ts` needs out of the app.

**Risk:** low.

**Touches:** a new tsconfig for core, `src/platform/browser/control.ts`, `src/app/agent-surface.ts`.

**Done when:** the type-check runs in `npm run verify`, and the boundary problem drops out of the baseline.

**Verify:** `harness/check.py`, the tests, and still-works steps 1–2.

## 6. The tools learn the new shelf layout, and pictures are found

**Why (plain English).** Today the app looks for a book's pictures at the top of the shelf while 151 of the 152 sit in the book's folder, so plates go missing. The rebuild moves files, so every tool must ask one map where things are.

**The fix.**

- One layout map in `src/core/sync/shelf.ts`, which the app, the driver and every script ask.
- Every read tries the new place, then the old.
- A book file's picture paths are read relative to its book.

**Risk:** medium.

**Touches:** `src/core/sync/`, `src/platform/browser/`, `scripts/`.

**Done when:** the app and the driver open every book with its pictures from either layout.

**Verify:** `harness/check.py`, the tests, and still-works steps 1, 2 and 7.

## 7. Catalogue records and the rights check

**Why (plain English).** Nothing records a book's rights, so the Hall territories were missed.

**The fix.**

- Each book's card gains: permanent ID, type (for sale, study, planned, archived), stage, series, ISBNs per format, live formats, the AI declaration, and rights (authors' death years, publication, territories chosen).
- A check flags any book sold outside the US whose author died within 70 years.
- The rights sections are drafted from the ledgers for the owner to confirm.

**Risk:** low.

**Touches:** `src/core/sync/`, `scripts/`, the shelf's cards.

**Done when:** every book's card has the fields, and the check runs.

**Verify:** `harness/check.py`, the tests, and still-works step 6.

## 8. Changes reach `main` through the checks, and the shelf gets its own checks

**Why (plain English).** Work was stranded on branches the app never sees, and rules on the shelf were kept by memory.

**The fix.**

- A workflow merges a session's branch into `main` by itself once CI passes. It works on any GitHub plan, and replaces the "fast-forward main" rule.
- The shelf gets a harness check: layout, picture provenance, rights fields, size limits.

**Risk:** low to medium.

**Touches:** `.github/workflows/` in both repositories.

**Done when:** a session's push with passing checks lands on `main` without a manual merge, and one with failing checks does not.

**Verify:** both repositories' checks.

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

## 11. Records of what went to KDP

**Why (plain English).** "What is live, and from which files?" had no answer; the files the owner uploaded are on his computer.

**The fix.**

- The owner's uploaded files (in his Downloads folder) go into R2 under `editions/<book>/<edition>/`.
- Each upload gets a receipt on the shelf naming the exact files by fingerprint.
- Exports never uploaded are deleted by decision 0052.

**Risk:** low.

**Touches:** the shelf, R2.

**Done when:** each live edition has a receipt, and its files are in R2.

**Verify:** fingerprints match.

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

## 17. A command that runs the free first reading (recon)

**Why (plain English).** `docs/process/reading.md` and `commands.md` say loading a book runs recon: the free OCR reading that every later cross-check compares against. On the _Goetia_ nothing started it, so every `transcribe` reported the OCR cross-check NOT CHECKED, and no verb exists to start it.

**The fix.** A `drive.mjs recon` verb that runs and caches the reading for the loaded book (resuming a partial one). `transcribe` refuses to land leaves without it unless told to, and the docs describe the real trigger.

**Risk:** low.

**Done when:** after `load` and `recon` on a new book, `cachestat` lists the reading and `transcribe` reports the OCR cross-check for every leaf.

**Verify:** a synthetic test book; the tests; still-works step 1.

## 18. The italic witness works on a scan with no text layer

**Why (plain English).** `slant-witness.ts` needs word boxes for a scan with no text layer, nothing in the tools produces them, and without them it reads nothing, writes an empty list and reports success. So italic, which the books rely on, was never checked on the _Goetia_.

**The fix.**

- The tools emit the word boxes they already compute during OCR, in the form `slant-witness.ts` reads.
- The witness fails loudly when it measured no words.

**Risk:** low.

**Done when:** the witness runs end to end on a scan with no text layer and reports words measured, and a run that measures none exits with an error.

**Verify:** a synthetic fixture; the check fails with the fault put back.

## 19. The house look lives on the shelf, and the default face covers Hebrew and Greek

**Why (plain English).** `proof` on the new book found "no design answers for this book" and fell back to defaults (6×9, Crimson Pro), because the house look lives in a browser profile, not on the shelf. The owner's standing answer for a new book is "the same as the others". The default face has no Hebrew, so Hebrew letters, superscript letters and two symbols printed as boxes.

**The fix.**

- A banked house look, kept on the shelf, that a new book inherits unless the owner says otherwise.
- The default look's fallback face covers Hebrew and Greek.
- Symbols no face has stay on the symbol-font list (the house font, after the cleanup).

**Risk:** medium (changes how new books look by default; the owner confirms the house look before it is banked).

**Done when:** a new book's first `proof` uses the house look, and its Hebrew and Greek print.

**Verify:** the unprintable report on a synthetic page; the owner looks at a proof.

## 20. Small fixes from the first full book run

One session; each is small:

- **The reader brief** (`docs/BRIEF-reading.md`): drop the line that describes one book's italics as every book's, and list every page role the parser accepts (plate, title page, colophon, half-title and the rest), not four.
- **`batch.mjs --check`:** a plate or blank leaf read as no blocks is expected, not a blocking word-drift problem.
- **`shelf-new-book.ts`:** create `scans/` and `books/` if they are missing (a sparse shelf checkout).
- **JSON files with a leading byte-order mark** (what Windows PowerShell writes) are read, not refused, by every script.
- **`docs/process/sessions.md`:** on Windows, run `npm` and `npx vite-node` from PowerShell, not Git Bash.
- **The shelf's check in a sparse checkout:** links to scans that are not checked out are expected; say so, or have the check notice.
- **The docs that say small capitals do not render:** they do (`<sc>` sets real small capitals); correct them.
- **`rule` then `correct`:** document that filing a ruling does not change the text and a correction is a second step, or have `rule … corrected` offer to apply it.
- **`body`'s output:** document that notes are a separate tree (`notes.edited`, `notes.pristine`), where a footnote's `fn…` id is found.

**Risk:** low.

**Verify:** each code fix has a test that fails with the fault put back; `harness/check.py`.

## After the cleanup (product work, not cleanup)

- merge the two reading pipelines;
- the house symbol font;
- the Book of Solomon as the pilot tracing book;
- the GitHub Issues board;
- the weekly backup to the owner's E: drive, set up from a session on his computer;
- monthly checkups;
- the tablet's failed saves, logged in still-works and not urgent by the owner's decision.
