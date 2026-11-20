# Sourcing: finding, comparing and fetching what a book is made from

## Purpose

Find the best source for a book (a scan, a born-digital PDF or an EPUB),
compare its editions and printings, set out the evidence on its rights,
download the chosen file, put it in storage and start the book on the shelf.
The same job fetches a second copy of a printing, a reference copy, or a
picture added for an edition.

The search-and-download tools, the "materials ecosystem", come later, with
their own spec ([agent-roles.md](../specs/agent-roles.md), "Out of scope"):
searching archive.org, HathiTrust, Google Books and Wikimedia Commons from
the libraries' own catalogues, recording where each file came from and its
rights statement, and putting it in storage in one step. Until then the scout
works by hand, as below.

## Who runs it

The **scout** ([.claude/agents/scout.md](../../.claude/agents/scout.md)) runs
every step but one. Starting the book (step 8) takes a reading of its first
leaf, and the scout does not read, so a **reader**
([.claude/agents/reader.md](../../.claude/agents/reader.md)) does it, then
hands back to the scout for the book's `scan.md`. The **owner** chooses the
printing and decides every rights question; the managing editor puts them to
him.

## Before you start

- [sessions.md](./sessions.md) done: both repositories present and in step.
- **Ask the owner first.** The questions in
  [sessions.md](./sessions.md#starting-a-new-book), "Starting a new book":
  the scan and which printing; whether the book stands alone or joins others
  in a volume; the imprint details, if not banked in a saved look; anything
  already ruled on that edition. The managing editor asks them before it
  launches the scout and hands over the answers. If one is missing, ask
  (`work.mjs ask`) rather than guess: a guess wastes the run.
- **The book is not on the shelf already.** Look under `books/` and in
  `STORAGE.tsv` at the shelf's top.

## Steps

1. **Find the candidates.** Search the libraries the product works with
   ([product.md](../product.md), "Works with"): archive.org, HathiTrust and
   Google Books for books, Wikimedia Commons for pictures. Where the
   book-search connector is connected, start with its `search_all`. For each
   candidate, record the edition and printing as its title page and the back
   of it say (publisher, place, year, edition statement), not the catalogue
   alone; the library and its identifier; what the file is (page photographs,
   photographs with a text layer, somebody's OCR, typeset text); its page
   count; and whether leaves are missing or cut, from a sample looked at.
2. **Compare the editions and printings.** A first edition against a later,
   revised one; the printing with the plates; the cleaner type; the copy with
   whole leaves (one scan once lost the first lines of 288 leaves). Prefer the
   printing the owner named. Write the comparison as the candidates sheet
   `sources/<Author-TitleCamel>-candidates.md` on the shelf: one row per
   candidate, a suggested choice and its reason, nothing chosen.
3. **Check the rights**, for each candidate: the date and place of first
   publication, the edition's own date (a revised edition carries its own
   copyright), the death year of each author, translator, illustrator and
   editor whose work is in it, and the library's rights statement. A
   catalogue's rights flag is its own view, not a legal answer. In 2026 a
   book published before 1931 is public domain in the United States (the
   year moves on by one each 1 January). Most other countries count from the
   death of each of those people, commonly 70 years, so a book sold outside
   the United States needs them dead for longer than that, or the owner's
   decision on territories. Put
   the evidence and your reading of it on the candidates sheet. Anything in
   doubt goes to the owner; never assume. A book still in copyright is only
   ever a study book and is never published ([product.md](../product.md),
   "Never").
4. **Put the choice to the owner**:
   `node scripts/work.mjs ask <id> --what "<choose a printing>" --where sources/<Author-TitleCamel>-candidates.md`.
   The managing editor brings his answer to the next run.
5. **Download** the chosen file with `curl`, from the library's own download
   link, into a scratch folder outside both repositories. Check it opens, its
   page count matches the candidate's, and a sample of its leaves is whole.
   Take its SHA-256 (`sha256sum`). A library that asks for a login, a payment
   or a key goes to the owner.
6. **Put it in storage**, and remove nothing until the command prints
   `"verified":true`:
   - a scan: `node scripts/storage.mjs put <file> --kind scans --shelf <shelf>`;
   - a reference copy: `--kind sources`;
   - a picture original: `--kind pictures`.

   Each adds its row to `STORAGE.tsv` ([commands](../reference/commands.md#storage)).
   Never commit a scan or a reference copy to the shelf
   ([decision 0051](../decisions/0051-big-files-live-in-cloudflare-r2.md)):
   commit the small files by name.

7. **Hand the scan to a reader.** Add the chosen file's SHA-256 and storage
   key to the candidates sheet, commit it and push, then
   `work.mjs handoff <id> --to reader --result "<printing> stored as scans/<sha256>.pdf; start the book"`.
   For a reference copy or a picture the job ends here, with `done`.
8. **Start the book on the shelf** (the reader), with
   `npx vite-node --config vitest.config.ts scripts/shelf-new-book.ts <shelf> <scan> <Author-TitleCamel> <leaves> <voice-from/book.json> <leaf0.json>`.
   Each argument comes from here:
   - `<shelf>`: the shelf's path.
   - `<scan>`: the chosen file, fetched from storage into your scratch folder:
     `node scripts/storage.mjs get scans/<sha256>.pdf <scratch>/<sha256>.pdf`
     (the key is on the candidates sheet and in `STORAGE.tsv`).
   - `<Author-TitleCamel>`: the candidates sheet's name without
     `-candidates.md`. The script adds a short tag to it.
   - `<leaves>`: the scan's page count, from `pdfinfo <scan>` (`Pages:`); for
     an EPUB, the number of spine documents.
   - `<voice-from/book.json>`: the `book.json` of a shelf book that already
     carries the editor's voice (its `voice.penName` is "Etsu T. Dhent"), so
     the new book starts with it; `''` starts from an empty voice.
   - `<leaf0.json>`: leaf 0, read by you against a render of it
     (`pdftoppm -f 1 -l 1 -r 150 -png <scan> <scratch>/leaf`), as one
     transcription: `{"pageIndex":0,"role":"<role>","blocks":[…]}`. A scan's
     first leaf is usually a cover, a library's notice or a blank, which
     takes its role (the roles are listed in
     [BRIEF-reading.md](../BRIEF-reading.md)) and no blocks. A leaf that
     prints words keeps the rule of [reading.md](./reading.md): correct the
     text its layer gives (`pdftotext -f 1 -l 1 <scan> -`) against the render,
     never type it out. The first batch reads leaf 0 again, and landing it
     replaces this one.

   The script copies the scan into the shelf's `scans/`, where the driver
   reads it; that copy stays out of git, and a later session fetches it back
   with `node scripts/storage.mjs get scans/<sha256>.pdf <shelf>/scans/<sha256>.pdf`.
   Then record the book's shape with `node scripts/shape.mjs <book-dir> --write`
   (or `--declare '<json>' --because '<reason>' --write` where nothing can
   measure it), commit the new folder by name, push, and
   `work.mjs handoff <id> --to scout --result "Started books/<folder>"`.

9. **Write the book's `scan.md`** (the scout) beside its `book.json`: the
   printing chosen and the owner's answer, the library and identifier, the
   rights evidence and his decision, the file's SHA-256 and storage key, its
   known faults, any second copy, and the path of the candidates sheet.
10. **Hand on**: commit and push, then
    `work.mjs handoff <id> --to reader --result "<one line>"`.

**The app cannot show a new book's pages yet.** It fetches the scan named in
`book.json` (`scan.path`) from the shelf on GitHub, and a new book's scan is
only in storage. Until cleanup task 6 is finished (the scans follow the one
map of the shelf), the app on the tablet opens a new book's text,
corrections and notes but not its page images: it says the scan is not on
the shelf and asks for the file. Sessions fetch the scan with
`storage.mjs get`, as above.

## Status notes

`shelf-new-book.ts` settles the book's folder name only when it makes the
folder: it adds a short tag to the name you give it. A note that named the
folder before then would name one that never exists, and the owner's
Workroom would show it. So a new book takes three runs:

- **The scout, steps 1 to 7, naming no book:**
  `node scripts/work.mjs start --role scout --job "<find and fetch a printing of …>"`.
  It waits on the owner at step 4; once he has answered, the next scout is
  handed the same run id and moves it on with `progress`. After step 7,
  `handoff --to reader`.
- **The reader, step 8, naming no book either**, because the folder does
  not exist until the script makes it:
  `start --role reader --job "Start the book from scans/<sha256>.pdf" --from <scout's id>`,
  then `handoff --to scout` with the new folder in its result.
- **The scout, steps 9 and 10, naming the folder:**
  `start --role scout --book <folder> --stage sourcing --from <reader's id>`,
  then `handoff --to reader`, for the reading.

A job on a book already on the shelf (a second copy, a reference copy, a
picture) is one run that names the book from its start. Everything else is as
[sessions.md](./sessions.md#status-notes-what-you-are-doing-on-the-shelf)
says.

## Checks that must pass

- The downloaded file opens, its page count matches the candidate's record,
  and a sample of its leaves is whole.
- `storage.mjs put` printed `"verified":true`, and the row is in
  `STORAGE.tsv`.
- `node scripts/drive.mjs book`, once the book is loaded, names the book and
  its shape and route ([FLOW.md](../FLOW.md)).
- `scan.md` records the owner's choice and his decision on rights.

## What it produces and where it goes

The candidates sheet in the shelf's `sources/`; the scan, reference copies and
picture originals in storage, each in `STORAGE.tsv`; the new book's folder
with its `book.json`, card and recorded shape (the reader's) and `scan.md`
(the scout's); the status notes. The managing editor writes the ledger entry
from the scout's and the reader's reports.

## Never

- Never choose the printing or settle a rights question; the owner does.
- Never take a catalogue's rights flag as the answer.
- Never start a book on the shelf before the owner has answered.
- Never let the scout read a leaf: leaf 0 is a reader's.
- Never commit a scan or a reference copy to the shelf; they go to storage.
- Never spend money, sign up for anything, or handle a key.
- Never put a downloaded file, book text or a study book's details in this
  repository.
- Never mend lost lines from another printing or from memory; a second copy
  must be of the same printing ([reading.md](./reading.md)).
