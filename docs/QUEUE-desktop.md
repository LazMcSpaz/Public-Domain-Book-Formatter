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
2. **Every session opens with the sync check** in `HANDOFF.md` §1 and closes
   with a push. Commit per unit of work: a stretch, a pass, a fix.
3. **Desktop → cloud** is the commit history: `ledger.md`, `queries.md`,
   `rulings.md`, and comments left in the book editor (`drive.mjs memos`
   lists them). **Cloud → desktop** is this file, the crop sheets, and task
   cards in the desktop app, each carrying the item's prompt.
4. **One branch until it is merged.** Both repositories are on
   `claude/pdf-text-cleaning-workflow-evyna3`; the desktop works there too
   until item 4 lands, then `main`.

### Setting the machine up, once

```bash
git clone <formatter> ~/Public-Domain-Book-Formatter
git clone <shelf>     ~/public-domain-books-storage        # HANDOFF.md assumes this path
cd ~/Public-Domain-Book-Formatter && npm install && npx playwright install chromium
npm run dev &  &&  node scripts/drive.mjs serve &         # :5173 and :7788
```

Opening a book on this machine for the first time runs recon (render, OCR,
harvest — about ten minutes on the Glossary) and caches it in the driver's
profile. The second engine's reading is **not** redone: it is on the shelf
beside the book (`second.json`), and the reading kit reads it from there.

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

`open`. Book: the Glossary. Four stretches through
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

## What the cloud session does meanwhile

App fixes, checks, sheets, and the ledger — never a book that is `taken`
above. A cloud session that wants a book asks here first.
