# Queue: work for the desktop, and how the two sides stay out of each other's way

Written for a Claude Code session on the editor's own machine, with a local
clone of both repositories. It is a queue rather than a plan: take the first
open item, mark it taken, do it, push, mark it done. The reasons a job is
here rather than in a cloud session are three, and each item says which.

- **The editor is at the keyboard.** Rulings at the query gate, the design
  gate, anything that ends at KDP. The cloud session can only send a sheet.
- **The machine persists.** The cloud container reverts its checkouts and
  restarts mid-run; a reading stretch or a second-engine pass that takes
  hours is safer where the driver stays up and the recon cache stays warm.
- **The shelf is local.** Loading a 12 MB scan and a book file is a copy, not
  a fetch, and a push is a second.

## How the two sides coordinate

1. **The shelf is the truth, and a book is worked by one side at a time.**
   A `text` edit does not commute, so two sessions with one book open will
   lose one of their corrections at the next save. Each item below names its
   book; while an item is _taken_, the other side does not write to that
   book. The claim is the status line in this file, committed and pushed
   before the work starts.
2. **Two sessions on one machine need two checkouts.** A second Claude in
   the same directory shares its working tree, its branch, its `node_modules`
   and its ports, and the two will overwrite each other's commits and fight
   over the driver. Give the second its own clone (`~/pdbf-b` and
   `~/shelf-b`), its own ports (`DRIVE_PORT=7798`, `npm run dev -- --port
5183`), and work that touches different files. Both still pull with
   `--rebase` before pushing.
3. **Every session opens with the sync check** in `HANDOFF.md` §1 and closes
   with a push. Commit per unit of work: a stretch, a pass, a fix.
4. **Desktop → cloud** is the commit history: `ledger.md`, `queries.md`,
   `rulings.md`, and comments left in the book editor (`drive.mjs memos`
   lists them). **Cloud → desktop** is this file, the crop sheets, and task
   cards in the desktop app, each carrying the item's prompt.
5. **One branch until it is merged.** Both repositories are on
   `claude/pdf-text-cleaning-workflow-evyna3`; the desktop works there too
   until item 4 lands, then `main`.
6. **Never `save` a book you did not load this session, and never `save`
   while the editor is working in the app.** `drive.mjs save` writes the
   browser's run over the book file wholesale. It now refuses when the file
   carries rulings or edits the run does not — but the refusal is a net, not
   a licence: the shelf is the source of truth and it moves under you, so a
   verb that writes `book.json` is the one thing to be sure about before
   running it. `corrections`, `querycrops`, `second`, `witness` and
   `book-files.mjs` all leave `book.json` alone and are safe beside the
   editor.
7. **`main` is what the editor sees, and it is fast-forwarded at every
   natural stopping point.** Not a tidying step and not item 4's business —
   the deployed app is built by a workflow that fires on a push to the
   formatter's `main`, and `loadShelf` defaults to `branch: 'main'`, so a
   book worked on this branch is a book the editor's tablet cannot list,
   open or rule on. It cost him a broken link to a book that was finished and
   pushed. His standing instruction is to do it at every stopping point:

   ```bash
   git checkout main && git merge --ff-only origin/<branch> && git push -u origin main
   git checkout <branch>
   ```

   Fast-forward only. A merge commit here means somebody pushed to `main`
   directly, and that is worth stopping to look at rather than resolving.

### Setting the machine up, once

```bash
git clone https://github.com/LazMcSpaz/Public-Domain-Book-Formatter.git ~/Public-Domain-Book-Formatter
cd ~/Public-Domain-Book-Formatter
git checkout claude/pdf-text-cleaning-workflow-evyna3
node -v && which npm          # see the warning below before going further
npm ci                        # `ci`, not `install`: the lockfile is committed
npx playwright install --with-deps chromium
npm test                      # 2,376 passing means the machine is ready
```

**On WSL, check which Node is answering before installing anything.** Windows
PATH interop puts the Windows `node` and `npm` ahead of Ubuntu's, and the
install fails in a way that names neither: esbuild's postinstall spawns
`cmd.exe`, `cmd.exe` refuses the `\\wsl.localhost\…` UNC path, falls back to
`C:\Windows`, and reports `Cannot find module 'C:\Windows\install.js'`. The
`EPERM … rmdir` warnings above it are the same cause. `which npm` returning
anything under `/mnt/c/` is the tell. Install Node **inside** the
distribution — nvm, then `nvm install` with no argument, which reads the
`.nvmrc` in this repo and gives Node 22, the version the suite is proven
against. `npm ci` after that, from a shell where `which npm` is under your
home directory. Playwright's browsers are per-Node too, so a
`playwright install` run under the Windows Node has to be run again.

**The shelf will not clone whole.** It is 1.05 GiB packed and 1.2 GB checked
out, and a plain `git clone` of it dies part way with `fetch-pack: unexpected
disconnect` — measured, on a home connection. Git has no resume, so retrying
starts from nothing. Clone it **blobless and sparse** instead: the commit
history is small, and only the files named below are ever downloaded. Other
books are added by widening the list, and their blobs arrive on demand.

```bash
git clone --filter=blob:none --no-checkout \
  https://github.com/LazMcSpaz/Public-Domain-Books-Storage.git ~/Public-Domain-Books-Storage
cd ~/Public-Domain-Books-Storage
git sparse-checkout set --no-cone \
  '/books/Blavatsky-TheTheosophicalGlossary-1s37ewg/**' \
  '/voice/**' \
  '/scans/c77f699e62cfb22ddae9c6dc67b110d9187d107bdd7a65557690479df6aa62e1.pdf'
git checkout claude/pdf-text-cleaning-workflow-evyna3
```

Then, from the formatter, with the dev server and driver up:

```bash
npm run dev &                                              # :5173
node scripts/drive.mjs serve &                             # :7788
node scripts/drive.mjs load ~/Public-Domain-Books-Storage/books/Blavatsky-TheTheosophicalGlossary-1s37ewg/book.json \
  ~/Public-Domain-Books-Storage/scans/c77f699e62cfb22ddae9c6dc67b110d9187d107bdd7a65557690479df6aa62e1.pdf
node scripts/drive.mjs use ~/Public-Domain-Books-Storage/scans/c77f699e62cfb22ddae9c6dc67b110d9187d107bdd7a65557690479df6aa62e1.pdf
```

Opening it runs recon once — render, OCR and harvest over 393 leaves, roughly
ten minutes — and caches it in the driver's profile. The second engine's
reading is **not** redone: `second.json` and `witness.json` sit beside the
book and the reading kit reads them from there.

Opening a book on this machine for the first time runs recon (render, OCR,
harvest — about ten minutes on the Glossary) and caches it in the driver's
profile. The second engine's reading is **not** redone: it is on the shelf
beside the book (`second.json`), and the reading kit reads it from there.

## One thing the editor has to decide before the shelf gets worse

**Fifty loose PDFs sit at the shelf's root, 778 MB of them** — page-range
chunks named `coo1-ark--13960-…`, downloaded while fetching a volume and
committed where they fell. They are two thirds of the repository, they are
not `scans/` and nothing reads them. Deleting them now frees nothing: git
keeps every version, so the 1.05 GiB stays in the history and every future
clone still pays for it. Only a history rewrite (`git filter-repo`, then a
force push, then every other clone re-made) actually removes them, and that
is destructive and the editor's call, not a session's. Until it is decided,
clone the shelf blobless and sparse, as above.

## The queue

Status is one of `open`, `taken (<who>, <date>)`, `done (<commit>)`.

### 1. Glossary — rule on the decisions waiting (editor)

`open`. Book: `Blavatsky-TheTheosophicalGlossary-1s37ewg`. **Forty-nine**
queries wait, all of one kind: a headword accented or spelt one way and its
own text or a neighbour another (`Matrâ`/`Mâtrâ`, `Kâla`/`Kala`, `Adunaï`).
The standing default is _leave as printed_. The crops are on sheets 1–6
already sent; the app shows the same crop at the gate:
`node scripts/drive.mjs link review`, or open the book from the shelf on the
tablet. Rulings save themselves to the shelf. No session is needed for this
one; it is listed so nothing else touches the book while it is being ruled.

### 2. Glossary — read leaves 270 to 392

`done (shelf 544b63d)`. Book: the Glossary. Four stretches through
`scripts/reading-kit/README.md`, exactly as 0–269 were read. Land each
stretch before starting the next; send a crop sheet for whatever
`apply.mjs` leaves for the editor. Fold anything a reader reports about
the engines into `scripts/reading-kit/glossary/PROMPT.md`. Done when
`drive.mjs transcribe` reports `stillMissing: 0`.

Read 2026-09-22/23 on the desktop, 123 leaves in four stretches (shelf
`14c2d06`, `f25e18c`, `513689a`, `544b63d`); `transcribe` reports 393 of 393,
`complete: true`. Sixty printer's errors swept one-for-one, 88 rulings filed
under the standing rules, and **seventeen queries left for the editor** on
crop sheets 7–9 (`~/glossary-kit/sheet-{7,8,9}.jpg` on the desktop; the
same crops are at the gate). Tag counts pristine against edited: no drift
over 3,098 blocks after each stretch.

### 3. Glossary — the end-of-book passes

`done (shelf cb3ad10)`. Book: the Glossary. In this order, each a commit:

> **The cloud session is applying standing rulings 2, 3 and 4 to this book's
> 31 remaining class queries (16:0x UTC), after seven hours with no Glossary
> commit from the desktop.** It files rulings and sweeps their fixes, and
> touches nothing else in item 3's list. Rulings commute by construction
> (`withRuling` collapses on the query key), so those cannot conflict; the
> sweeps are ordinary `text` edits and can, so pull before pushing.

- Quotation-mark spacing on leaves 0–29, which three readers normalised
  before the editor ruled _as printed_: re-check against the 400 DPI renders
  and restore what the page sets, per occurrence.
- The `[w. w. w.]` sign-off, transcribed both ways: the page prints small
  capitals, so one sweep to `[W. W. W.]`.
- The tag-and-stop convention, `<b>X.</b>` against `<b>X</b>.`, varies by
  batch. Cosmetic on the page; settle it one way with a sweep so the
  reference text is consistent.
- Display lines the drafts dropped as furniture: the title-page lines and
  `PREFACE.` — put them back as headings.
- Block kinds are the draft's guess from geometry: 378 entries are typed
  `blockquote` (an indented first line) and six last lines were typed
  `footnote` until assembly was found pulling them out of the text. Count
  the kinds (`book.json`, `run.transcriptions[].blocks[].kind`) and settle
  what an entry _is_ before layout; the reference text does not care, the
  page does.
- Matter the page sets in columns that the drafts set as prose, one row a
  block: Myer's Tetrad (leaf 329), the Brahmanical/Buddhist parallel with its
  brace (339), the sum run into the next paragraph (353), the Yuga table
  (385, blocks 2–17). Rebuild each as a `table` block against the render.
- Leaves 270–392 add their own share of `blockquote` entries (35 in the last
  stretch alone); two more last lines typed `footnote` (370, 376) were set as
  paragraphs before landing, so none reached the book this time.
- Entries the draft ran together or split across blocks (every stretch had
  some): `drive.mjs split` and `block … merge` until one block is one entry.
  This is Phase 3 work but it decides what the reference text looks like.
- Regenerate `reference/blavatsky/theosophical-glossary.txt` from the book,
  so the shelf search sees the accents (`scripts/blavatsky.mjs` folds them).
- Phase 2 checks: `drive.mjs consistency`, `drive.mjs damage --check`, the
  sense pass a chapter at a time (findings, never text), and the ledger at
  `books/<slug>/ledger.md`.
- The two names for one book: the directory is
  `Blavatsky-TheTheosophicalGlossary-1s37ewg` and the app's own derived slug
  is `c77f…-1s37ewg`. Settle which the shelf uses before the export exists.

Done 2026-09-23, every pass a commit and recorded in the book's `ledger.md`
(shelf `5872913` … `cb3ad10`). Left over, for whoever is next:

- **59 queries wait on the editor**, 27 of them new from the sense pass —
  oddities the photograph confirms are in the 1892 book (`Augiras`,
  `Bardesanes (B.C. 155 to 228)`, `the Norse Purcæ`). Crop sheets 7–10 on the
  desktop (`~/glossary-kit/sheet-*.jpg`); the same crops are at the gate.
- **The space before `;` `:` `!` on leaves 0–29** was closed up by the same
  early readers who closed the quotation marks; the as-printed ruling covers
  it and this item did not. One more pass over the renders.
- **`damage --check` fails on five places that are as printed** (three
  abbreviations, a possessive, `Mac Gregor`). A gate that cannot pass is
  worth a look before export.
- **Every other book with a healed page seam has italics one word late**
  until it is re-assembled with formatter `58c5a31`, and its PDF until it is
  re-exported. Not done: this item does not export.
- A cloud session applied the standing rulings to this book (`ec93b52`)
  while this item held it. Nothing was lost — its file was built on this
  item's latest and the two were merged — but the claim line is what
  prevents the case where it would be.

Close-out: `corrections.md` for the Glossary `taken (desktop session,
2026-09-23, second attempt)` — the first claim died to a transport error
without writing anything.

### 4. Merge both branches to main

`open`, when the editor says. Both repositories, fast-forward if possible.
The last merge covered formatter `918b43b` and shelf `d182c9d`; every stretch
since, the accent fold, the sweep fix and the reading kit are branch-only.

### 5. Isis Unveiled Vol. I — the queries, and a second witness

`open` for the queries (the editor's); the second reader `taken (desktop
session, 2026-09-23, second attempt)` — the first claim died before it started. Book: Isis Vol. I. Sixty-two queries wait on the editor at the gate
(the scan is too large for the shelf, so the crops are pre-cut under
`queries/`). Then a second engine over the volume with the kit's once-per-book
step, which this book has never had.

### 6. The other Blavatsky books, to Phase 2

`open`; _The Key to Theosophy_ **finished** (shelf 4e7e0f0): read, 100 of 112 queries ruled under standing ruling 1 (`RULINGS.md` on the shelf), 12 left for the editor, damage clean; no edition. Its scan loses lines at the head of most leaves (`cuts.md`). _A Modern Panarion_ **read and ruled** (shelf, 2026-09-24): all 514 leaves, 126 of 144 queries ruled under standing ruling 1, 18 left for the editor, damage clean, figures on 412/415 not yet cut; no edition. Brief: `scripts/reading-kit/panarion/PROMPT.md`. One at a time, in this order: _The Key to Theosophy_, _A Modern
Panarion_, then _The Secret Doctrine_ I and II and _Isis_ II. Each gets its
own kit directory and its own `scripts/reading-kit/<book>/PROMPT.md`, written
after its first stretch from what the readers report. Shape recorded first
(`scripts/shape.mjs <book-dir> --write`).

### 7. Two app gaps found on the Glossary

`open`, cloud or desktop. `drive.mjs state` reports the wizard step while
recon runs, so a long recon looks frozen at 9%; it should report leaves
done. And the second reader exists only behind the driver; the plan's next
step is the app.

### 8. Organise the shelf and write down what is on it

`done (shelf 9ed3f73)`. Books: none — this touches no `book.json`, so it is safe beside any
reading. Fifty PDFs sit loose at the shelf root and a hundred and sixteen
across the repository, named by SHA-256 or by a download slug, and until now
nothing said what any of them were.

```bash
node scripts/shelf-inventory.mjs ~/Public-Domain-Books-Storage          # writes INVENTORY.md
node scripts/shelf-inventory.mjs ~/Public-Domain-Books-Storage --move   # git mv the loose ones
```

It opens every PDF and classifies it on **what its opening leaves say**,
because the names carry nothing: Isis Vol. I runs `THE VEIL OF ISIS` as its
head and never prints its own title, which is why thirty-five of its chunks
read as unsorted the first time. `--move` touches only the root, never
`scans/`, whose paths every `book.json` names. Review the renames, commit,
push. Then look at whatever it still calls `unsorted` and either widen a
pattern or say in `INVENTORY.md` what the file is.

It does **not** shrink the repository. Git keeps every blob for ever, so the
778 MB at the root is 778 MB of history wherever the files now sit. That
rewrite is the editor's call, above.

### 9. The Secret Doctrine, ordered and assembled

`done (shelf 69cd4b9)`: Vol. II ordered, merged (811 leaves, rebuildable; `scripts/decrypt-chunks.mjs` + `merge-scan.mjs --manifest`) and built from its text layer, with `report.md` beside it; not exported. **Vol. I is missing pp. 359–411** and is ordered, not assembled. The chunks are ClearScan: `converted-text`, not a retypesetting. See `DECISIONS-2026-09-23.md` on the shelf. Thirty-one files, 169 MB, Theosophical University Press online
edition, **already carrying text** — so this needs no OCR and no reading
pass. What it needs is the order, and the order is legible: some chunks open
on a part head (`BOOK I., PART II. THE EVOLUTION OF SYMBOLISM`, `BOOK
II.-PART I. ANTHROPOGENESIS`), and the rest open on a folio (`86 THE SECRET
DOCTRINE`, `412 THE SECRET DOCTRINE`). Sort by part, then by opening folio,
and check the seams join: the last folio of one chunk and the first of the
next must be consecutive, and a gap is a missing chunk rather than something
to paper over.

Record the shape before anything else (`scripts/shape.mjs`, `textSource:
converted` unless the publisher is named) and read `docs/FLOW.md` for the
route that shape lands on. Stop at a built book and a report. **Do not
export an edition**: this is a modern press's transcription, not the 1888
setting, and whether an edition may be built from it is the editor's.

### 10. The four uploads of 22 September

`done (shelf c2e1044)`: shapes in `sources/SHAPES.md` (Pólya is `scan-with-layer`, not `converted`); Vol. 2's scan at `scans/082d3fae….pdf`, `second.json` and `witness.json` in `books/GrinderBandler-TheStructureOfMagicVolII-082d3f/`; no book files, since nothing is landed. At the shelf root, and none of them is public domain — 1954, 1975,
1976 and a journal piece — so treat them as reading and reference text, not
as editions to publish. Measured:

| File                            | Pages | Text layer     | What that means                           |
| ------------------------------- | ----: | -------------- | ----------------------------------------- |
| The Structure of Magic Vol. 2   |   204 | **none**       | a photograph: recon, then the reading kit |
| The Structure of Magic Vol. 1   |   243 | somebody's OCR | `converted`: the damage check, then read  |
| Patterns of Plausible Inference |   208 | somebody's OCR | `converted`, and not occult — reference   |
| Lakoff on Linguistics (Wilks)   |    21 | somebody's OCR | a short piece; reference                  |

Vol. 2 is the only real OCR job of the four. Record each shape, then for
Vol. 2 run recon and the second reader (`drive.mjs second`, then `witness`)
and put `second.json` and `witness.json` on the shelf beside the book, which
is the once-per-book step the reading kit expects. That is hours of machine
time and almost no judgement, which makes it the right thing to leave
running.

### 11. The Secret Doctrine Vol. I — the missing pages

`open`. Book: `Blavatsky-TheSecretDoctrineVolI-tup`. Vol. II is built; Vol. I
is ordered and **not** assembled, because pp. 359–411 are not among the
chunks. Nothing can fill that gap from what is here, so the job is to say
precisely which leaves are absent, in `report.md` beside the book, and stop.
Assembling around a gap would print a volume that skips fifty pages with
nothing on the page to say so, which is exactly the silent failure this
shelf's checks exist to prevent. Finding the missing chunk is the editor's.

### 12a. A crop beside every waiting query, on every book

`open`, and part of readying any book from here on. The editor rules from a
tablet and wants the paper beside **every** decision, not only the ones a
scan too large for the shelf forced. `drive.mjs querycrops` cuts them once
from a session that has the scan; they go to `books/<dir>/queries/<key>.jpg`
and the gate fetches them one at a time, so opening the book to rule on it
still pulls down a book file rather than a volume of pixels.

`book-files.mjs --finish` owes a book any that are missing and names the
leaves, so this is a check rather than a habit. Done: the Glossary (59),
_The Key to Theosophy_ (12), _Isis_ Vol. I (62, cut earlier). Owed by every
book read from now on, _A Modern Panarion_ first.

### 12. Proposals for the queries waiting on the editor

`open`; the Glossary `done (shelf dc3b4ed)`: 90 proposals on 58 of its 59
queries, none on one. Books: the Glossary
(59 waiting), _Isis_ Vol. I (62), _The Key to Theosophy_ (12). **One book at a time**, and only a book no other session
holds.

The gate now offers the reader's answers as options with nothing selected
(`drive.mjs propose`, `@core/queries/proposals`), so a query the reader has a
view on costs the editor a tap instead of a paragraph of dictation. Writing
those views is this item.

The rules are the ones the module is built on, and none of them is new:

- **A proposal is not a ruling and does not touch the book.** Nothing you
  write here has any effect until the editor picks it.
- **Read the passage before proposing anything** — the whole block, the block
  before, the block after, and the crop where there is one. Three of four
  findings put to the editor on _Uncommon Therapy_ were answered by the next
  sentence. A proposal written off the query's quote alone is a guess with a
  reason attached.
- **Give two where two are genuinely arguable**, and one where only one is.
  Never pad to three: an option nobody would take is an option the editor
  reads and discards, and the sheet is the thing being shortened.
- **Propose nothing where you do not know.** A query with no proposal is the
  honest answer and the gate asks it exactly as it asked it before. Coverage
  is not the measure; a proposal the editor takes is.
- `because` is what goes into `rulings.md` if it is taken, so write it as the
  edition's reasoning and not as an argument to the editor.

Work it into a JSON file — `[{ "leaf": 170, "quote": "…", "decision":
"corrected", "correction": "…", "because": "…" }]` — then
`drive.mjs propose p.json --by="<which session>"`, then `save`, and then
`card <shelf-book-dir>`, which is what writes `proposals.md` beside the book
(`save` writes only `book.json`). `propose` refuses a proposal whose words match
no waiting query, so a silent miss is not possible. Do not rule on anything.

## Handing an idle session its next item

A session that finishes its item stops and waits. This is the list of what
to type into it, so whoever is watching picks a line rather than composing
one. **One book at a time**: never hand an item to a session while another
holds the same book (the status line above says who holds what).

Every hand-off carries the same preamble, because a session may be fresh:

> Always `git pull --rebase` before pushing; other sessions push to this
> branch. Read `docs/QUEUE-desktop.md`. Claim the item in that file and push
> before you start. Work it through without stopping to ask questions;
> anything needing the editor goes in a file, not a question to me. Push
> each finished piece.

Then one of:

- **Item 3** — _for the session whose checkout already has the Glossary
  open, since its recon cache is warm._
  "Take item 3, the Glossary end-of-book passes. Work them in the order the
  item lists. Do not export an edition and do not rule on any query."
- **Item 6** — _for a session with a browser free._
  "Take item 6, starting with The Key to Theosophy: its scan is at
  `sources/blavatsky-other/blavatsky_the_key_to_theosophy_1889.pdf`. Record
  its shape first, then recon, then the second reader, then read it with the
  reading kit. One book; stop at the end of it."
- **Item 5, the machine half only** — _the queries in it are the editor's._
  "Take the second-witness half of item 5: run the second reader over Isis
  Vol. I and write `second.json` and `witness.json` beside the book. Do not
  touch its sixty-two queries; those are the editor's."
- **Item 7** — _for a session with no browser and no shelf._
  "Take item 7, the two app gaps. Tests for both, and each test must fail
  against the unfixed code. Touch no book file and not the shelf."
- **Item 11** — "Take item 11: name the missing Secret Doctrine Vol. I
  leaves in `report.md` and stop. Do not assemble around the gap."
- **Item 12a** — _for the session that has just finished reading a book._
  "Cut the query crops for <book> with `drive.mjs querycrops`, put them in
  `books/<dir>/queries/`, and check with `book-files.mjs <book-dir> --finish`
  that no waiting query is left without one."
- **Item 12** — _for a session whose book is already open and whose recon
  cache is warm._
  "Take item 12 for <book>: write proposals for the queries waiting on the
  editor. Read the whole block and its neighbours before each one, propose
  nothing where you do not know, and rule on nothing."

**What is never handed out:** items 1 and 5's queries, which are rulings only
the editor makes; item 4, the merge, which waits on the editor's word; and
any export of an edition.

## What the cloud session does meanwhile

App fixes, checks, sheets, and the ledger — never a book that is `taken`
above. A cloud session that wants a book asks here first.
