# Upload: proving the exact files and preparing the listing

## Purpose

Get the exact files that go to Amazon KDP (the interior PDF, the paperback
and hardcover covers, the Kindle cover, the EPUB) proved by every readiness
check, and the listing written to KDP's rules. When this job is finished the
book is **ready to upload** ([README.md](./README.md)), and the owner
uploads it.

## Who runs it

The **publisher**. A session prepares the files, the checks and the listing;
**the owner presses the buttons on KDP**. A session never spends money or
handles keys on his behalf.

## Before you start

- The book is checked, with the results in its ledger
  ([checking.md](./checking.md)).
- The interior and EPUB were exported from the `book.json` beside them, in
  the same commit ([export.md](./export.md)).
- Per-book listings, ISBNs and cover status live on the shelf
  (`KDP-listings.md` at its root), never in this public repository.

## Steps

1. **Name the exact files**: the interior PDF, the two `-flat` cover PDFs and
   the EPUB, each by its path, its storage key, or the path it had on the
   shelf. Every check below runs on these files and no others. A check run on
   an earlier export proves nothing about this one.
2. **Run the readiness command** on them, which runs the whole list, C1 to C12
   and R1 to R11, and records each file's SHA-256:

   ```bash
   node scripts/readiness.mjs <shelf>/books/<book> --interior <file> \
     --softcover <file> --hardcover <file> --epub <file> [--export-report proof.json]
   ```

   Start the driver with the book loaded first, or its checks come back NOT
   CHECKED. What it does and how a person's check is signed off:
   [checking.md](checking.md#checks-that-must-pass-the-full-list-for-checked-and-ready-to-upload).

3. **Read the spelling sheet word by word** (R1). It is the check KDP's own
   spell-check runs on the interior; it reads the exported file itself, so it
   holds every part that prints, contents and front matter included. A word
   the scan's second reading agrees with is printed so; a word it disagrees
   with is ours to crop and correct. Nothing on the sheet is changed
   automatically: an author's own coinages stay.
4. **Make sure the covers are for this interior** (R7). A cover's spine is
   computed from the interior's page count and the paper (cream, black and
   white is the editor's standing choice), so a re-export that changes the page
   count invalidates both covers. Compare
   `pdfinfo <interior.pdf> | grep Pages` with `pageCount` in
   `covers/softcover.json` and `covers/hardcover.json`. To recut, the cover
   specs are the record and the composer redraws them (see "Covers today"
   below). Then flatten both, in the same commit:

   ```bash
   python3 scripts/flatten-cover.py covers/softcover.pdf covers/softcover-flat.pdf
   python3 scripts/flatten-cover.py covers/hardcover.pdf covers/hardcover-flat.pdf
   ```

   **Upload the `-flat` files.** KDP stalled for an hour and a half on a
   composed cover's transparency, then errored. Flat copies go stale with
   their covers: re-flatten after every recut.

5. **Write the listing**, following KDP's rules for a public-domain book:
   - the label goes in the title field, in brackets: "(Annotated)",
     "(Illustrated)" or "(Translated)"; a subtitle does not count;
   - "Illustrated" needs ten or more original illustrations; "Annotated"
     needs original added material (an introduction, a glossary, notes);
     better formatting alone does not qualify;
   - the description opens with one line of at most 80 characters saying how
     the book is original, and uses only the HTML tags KDP's box accepts;
   - the cover matches the title, subtitle and author fields exactly;
   - Etsu T. Dhent is added as contributor, role Editor, on every book;
   - seven keywords of up to 50 characters, repeating no title or author
     words, naming no author who is not in the book, making no quality claims;
   - three categories, the nearest matches under Religion & Spirituality.

   The ISBN printed on the copyright page must be the one for that binding.
   Ask the owner about territories and KDP's question on AI-generated content
   until each book's card records them (planned).

6. **Run the readiness command again** once the sheets are read and signed
   off in `ledger.md`. It writes `readiness.md` beside the book: the files and
   their fingerprints, each check passed, failed, needs a person or NOT
   CHECKED with its reason, and the verdict. Note the verdict and date in the
   ledger and give the owner the report.
7. **Only then say "ready to upload"**, and only if the report's verdict says
   so. If the owner, told exactly what was not checked, says to go ahead
   anyway, record his words in the ledger; the report still says what it says.
8. **After he uploads**, record what went up (date, files, commit, hashes) in
   the ledger and update the book's entry in `KDP-listings.md`. (A permanent
   release per edition, tagged with the book's ID, is planned.)

## Covers today

The cover composer, `scripts/cover-front.mjs`, is named in the shelf's cover
READMEs but **is not on `main`**: it exists only on the unmerged branch
`claude/cover-front-icons`. Until it is merged, a cover can be recut only from
that branch. Say so to the owner rather than working around it.

## When KDP refuses a file

"Error processing your interior", with no code, once came from how the PDF
was written; the writer now saves every object plainly with a classic
cross-reference table, so a recurrence is a new fault to report, not to
retry. A cover that stalls is almost always one that was not flattened.

## Checks that must pass

The full list lives in one place, so the three documents cannot disagree: [checking.md](checking.md#checks-that-must-pass-the-full-list-for-checked-and-ready-to-upload), items C1 to C12 for _checked_ and R1 to R11 for _ready to upload_. Run every item for this stage on the exact files that go to KDP, and name anything that did not run as NOT CHECKED.

## What it produces and where it goes

The flattened covers beside their specs in the book's `covers/` folder; the
listing in `KDP-listings.md` on the shelf; `readiness.md` and the sheets it
names (`readiness-*.md`) beside the book; the sign-offs and the record of what
was uploaded in `ledger.md`.

## After the upload: retire the working files

The last step of every upload, by [decision 0052](../decisions/0052-what-a-finished-book-keeps.md):

1. **Write the receipt:** the exact files uploaded (fingerprints and sizes), the date, the ISBNs, where they are in storage, and the readiness report.
2. **Move to storage** ([decision 0051](../decisions/0051-big-files-live-in-cloudflare-r2.md)), checking each file's fingerprint after it lands:
   - the uploaded files;
   - the scan and any second copy;
   - reference copies;
   - picture originals;
   - the OCR readings.
3. **Delete what can be made again:**
   - exports never uploaded;
   - cover previews and unuploaded cover files;
   - query crops once every query is ruled;
   - contact sheets and scratch files;
   - check sheets older than the latest readiness report.
4. **Tell the owner** what was moved and what was deleted.

Never delete a scan, a reference copy, an uploaded file, the book file or a hand-written record. Step 2 uses `node scripts/storage.mjs put <file> --kind <kind> --shelf <shelf>` ([commands](../reference/commands.md)); the uploaded files go under the kind `editions/<book folder>/<edition>`.

## Never

- Never call a book ready to upload unless `node scripts/readiness.mjs` says
  so on the exact files being uploaded; name anything not checked.
- Never upload, pay, or enter credentials on the owner's behalf.
- Never upload a composed cover; upload the `-flat` copy made after the last
  recut.
- Never upload covers cut for a different page count or paper.
- Never put ISBNs, KDP details or listings in this repository.
- Never label a book "Illustrated" with fewer than ten original
  illustrations.
