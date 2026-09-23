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

`open`. Book: `Blavatsky-TheTheosophicalGlossary-1s37ewg`. Thirty-two
queries wait, all of one kind: a headword accented or spelt one way and its
own text or a neighbour another (`Matrâ`/`Mâtrâ`, `Kâla`/`Kala`, `Adunaï`).
The standing default is _leave as printed_. The crops are on sheets 1–6
already sent; the app shows the same crop at the gate:
`node scripts/drive.mjs link review`, or open the book from the shelf on the
tablet. Rulings save themselves to the shelf. No session is needed for this
one; it is listed so nothing else touches the book while it is being ruled.

### 2. Glossary — read leaves 270 to 392

`taken (desktop session, 2026-09-22)`. Book: the Glossary. Four stretches through
`scripts/reading-kit/README.md`, exactly as 0–269 were read. Land each
stretch before starting the next; send a crop sheet for whatever
`apply.mjs` leaves for the editor. Fold anything a reader reports about
the engines into `scripts/reading-kit/glossary/PROMPT.md`. Done when
`drive.mjs transcribe` reports `stillMissing: 0`.

### 3. Glossary — the end-of-book passes

`open`, after 2. Book: the Glossary. In this order, each a commit:

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

### 4. Merge both branches to main

`open`, when the editor says. Both repositories, fast-forward if possible.
The last merge covered formatter `918b43b` and shelf `d182c9d`; every stretch
since, the accent fold, the sweep fix and the reading kit are branch-only.

### 5. Isis Unveiled Vol. I — the queries, and a second witness

`open`. Book: Isis Vol. I. Sixty-two queries wait on the editor at the gate
(the scan is too large for the shelf, so the crops are pre-cut under
`queries/`). Then a second engine over the volume with the kit's once-per-book
step, which this book has never had.

### 6. The other Blavatsky books, to Phase 2

`open`, one at a time, in this order: _The Key to Theosophy_, _A Modern
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

`open`. Books: none — this touches no `book.json`, so it is safe beside any
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

`taken (second desktop session, ~/pdbf-b, 2026-09-23)`. Thirty-one files, 169 MB, Theosophical University Press online
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

`taken (second desktop session, ~/pdbf-b, 2026-09-23)`. At the shelf root, and none of them is public domain — 1954, 1975,
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

## What the cloud session does meanwhile

App fixes, checks, sheets, and the ledger — never a book that is `taken`
above. A cloud session that wants a book asks here first.
