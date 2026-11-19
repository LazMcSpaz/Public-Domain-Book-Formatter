Every command a session runs, grouped by job. The checks marked [before upload] must all have run before a book is called ready to upload; see docs/process/README.md.

# Commands reference

Every script named here was checked on disk on 18 November 2026 (`ls scripts/`,
the npm scripts in `package.json`, and each `drive.mjs` verb in its handler
table).

## Before calling a book checked or ready to upload

The full list of checks, C1 to C12 for _checked_ and R1 to R11 for _ready to upload_, with each command, lives in one place: [process/checking.md](../process/checking.md#checks-that-must-pass-the-full-list-for-checked-and-ready-to-upload). Run every item for the stage on the exact files that go to KDP and report each result; anything not run is NOT CHECKED. A book is not ready because one check passed, and `drive.mjs finish` covers only part of the list. The commands below marked [before upload] are the ones that list uses.

## Things to know before using the driver

- `npm run dev` must be running. The driver drives the app at
  `localhost:5173` and takes commands on port 7788.
- Leaves are counted from 0 and are the scan's leaves, not the printed page
  numbers.
- Editing commands change the copy in the driver's browser only. `save`
  (see "Named elsewhere") writes `book.json`; then commit and push to the shelf.
- **Sheets go beside the book, never into this repository.** The sheets the
  driver writes from a book (`queries.md`, `rulings.md`, `review.md`,
  `proposals.md`, `damage.md`, `parallels.md`, `sense.md`) quote it, and this
  repository is public. With no output path they are written beside the
  `book.json` that `load` was given (or, for a book never loaded, the one
  `save` first wrote). `book` shows which file that is. With no book file
  known the command refuses and says which shelf folder to load from. An
  output path you name must be outside this repository: a path inside it is
  refused, and so is `card` or `corrections` pointed at a folder inside it.
- After editing `src/core` or `scripts/drive.mjs`, restart both servers. A
  running `serve` keeps the old code in memory.

## Setup and checks for the code

Before committing code: run typecheck, test, format:check and lint, all four, and `python3 harness/check.py`.

- `npm install`: installs the project's packages. Once, in a fresh checkout.
- `npm run dev`: starts the app on `http://localhost:5173`.
- `npm run typecheck`: checks the TypeScript types without building
  (`tsc --noEmit`).
- `npm test`: runs the automated tests (vitest). The main gate for code
  changes. Pure logic, no browser needed.
- `npm run lint`: runs ESLint.
- `npm run format:check`: checks formatting with Prettier. `npm run format`
  fixes it. On an old Windows checkout with CRLF line endings this fails on
  hundreds of untouched files; check only the files you changed.
- `npm run build`: typecheck plus a production build into `dist/`.
- `node scripts/make-test-book.mjs`: rebuilds the 8-page scanned test book.
- `node scripts/make-test-epub.mjs`: rebuilds the EPUB test book.
- `node scripts/make-test-digital.mjs`: rebuilds the born-digital PDF test
  book.
- `node scripts/make-icons.mjs`: redraws the app's icons from the house
  fleuron.
- `node scripts/screenshot-flow.mjs`: drives the whole wizard with no window
  and saves a screenshot of each screen in `screenshots/`. Look at these
  before shipping any change to the screens.

Browser checks. All need `npm run dev` running, except `check:install`, which
builds its own copy.

- `npm run check:install`: builds the app as GitHub Pages serves it and checks
  the installed app still opens with the network off.
- `npm run check:outbox`: checks a mark made offline reaches the shelf when
  the connection returns (the shelf is faked in the page).
- `npm run check:crop`: checks the query screen shows the crop cut in advance
  for a book whose scan is too large for the shelf.
- `npm run check:proposals`: checks the query screen offers the reader's
  suggested answers with none of them selected.
- `npm run check:held`: checks "Approve all" on the query screen files what it
  approves at once, with no Next pressed, and nothing else.
- `npm run check:cache`: checks that a cached read of a book file can never
  answer a later lookup. This fault once lost the editor's rulings.
- `npm run check:queue`: checks one click reads every unread scan on the
  (faked) shelf and that a stopped queue survives a reload.

## Opening and reading a book

- `node scripts/drive.mjs serve &`: opens a browser on the app and keeps it
  open for the commands below. Start this first.
- `node scripts/drive.mjs load <book.json> <scan.pdf>`: loads a book from the
  shelf into the driver's browser, and remembers the `book.json` so the sheets
  are written beside it. **Warning:** the scan is
  `scans/<sha256>.pdf`, named in `book.json` under `scan.path`. The PDF next to
  `book.json` is the export; loading it creates a second, wrong book (check
  with `runs`).
- `node scripts/drive.mjs use <scan.pdf>`: says which book every later command
  means.
- `node scripts/drive.mjs book`: reports which book that is, its shape and
  route, open comments from the editor, and queries without a proposal.
  `book clear` forgets the choice.
- `node scripts/drive.mjs state`: the current wizard screen as JSON.
  `answer <id> <value>` and `advance` work through it.
- `node scripts/drive.mjs body out.json`: the assembled book. Each block's id
  and its exact text (italic as `<i>`, bold as `<b>`), as first read
  (`pristine`) and as corrected (`edited`). **Every correction is written
  against these strings, never against a leaf's raw text.**
- `node scripts/drive.mjs notes n.json --full`: the book's own footnotes with
  their text. `body` gives blocks only, so a count without the notes is not a
  count.
- `node scripts/drive.mjs ocr 12 16 19`: what OCR read off the named leaves,
  as plain text. `ocr 37 fresh` re-reads the pixels instead of the saved
  reading; `fresh --clean=gentle` reads through a cleaning preset.
- `node scripts/drive.mjs draft b.json 12 13 14`: those leaves as blocks,
  built from the saved OCR. A draft to correct, never to trust. Check its
  `structural` list first: those are guesses.
- `node scripts/drive.mjs transcribe <scan.pdf> b.json`: lands a checked
  batch of leaves into the book. Merges leaf by leaf by default and
  cross-checks against OCR. `-` in place of the scan means the open book. A
  `replace` mode exists; do not use it unless replacing is meant.
- `node scripts/drive.mjs epub <book.epub> e.json 1 2 3`: reads those EPUB
  chapters with the app's own importer, as a batch for `transcribe`.
- `node scripts/drive.mjs leaf 133`: renders a leaf to `screenshots/`.
  `leaf 133 tight 600 0.3,0.24,0.2,0.03` saves a crop named `tight` at 600 DPI
  (box as fractions of the leaf: x, y, width, height).
- `node scripts/drive.mjs sheet typos 28:occulist`: one image of suspect words,
  each cut from the leaf it sits on (`leaf:word` pairs), to check many at once.
- `node scripts/drive.mjs second 12 16 --out second.json`: a second OCR engine
  (PaddleOCR) over the named leaves (all by default), as the file `witness`
  reads. `--layer` takes the scan's own OCR layer instead. `--tier small` uses
  the larger model, which is on disk.
- `node scripts/drive.mjs witness second.json`: the two readings side by side.
  Mechanical differences settled, real disagreements listed worst first.
- `node scripts/drive.mjs select p12b3 "a candle flame"`: drags over words in
  the reading view as a finger would. The reading view must be open.
- `node scripts/drive.mjs reading`: every passage the editor marked while
  reading, found by its words in the book as it stands. `--tag intro` gives
  one pass's brief; `--json` hands it to a writing agent.
- `node scripts/drive.mjs reconimport <books/<dir>/recon.json.gz>`: loads a
  reading the editor's browser already took and put on the shelf, so OCR is
  not run again here. `load` the book too.
- `node scripts/drive.mjs reconexport <books/<dir>/recon.json.gz>`: the other
  way. Writes the driver's own finished reading as that file, for the session
  to commit. Without it, a reading done here lives only in `.drive-profile`.
- `node scripts/drive.mjs runs`: the readings stored in the driver's browser.
  `runs drop <n>` removes one (for example a book loaded from the wrong PDF).
- `node scripts/drive.mjs cachestat recount <scan.pdf>`: puts a saved
  reading's true page count back, measured off the file. **After any
  interrupted reading, compare the recorded page count with the file's.**
- `node scripts/drive.mjs cleantrial t.json --truth truth.json --leaves 13,27`:
  measures every cleaning preset against the proofed text, leaf by leaf.
  `truth.json` comes from `drive.mjs truth`.
- `node scripts/cleanup-ledger.mjs <trial.json>...`: turns `cleantrial` files
  into the cleanup ledger's tables and applies the decision rule.

## Checking a book's text

Finding faults. The `.ts` scripts here need no browser and run over one shelf
book or many (`books/*/book.json`).

- `node scripts/drive.mjs damage`: writes `damage.md` beside the book: marks
  a printer would never set: split
  words, stray full stops and apostrophes, a note printing its own mark,
  paragraphs split wrongly at a page turn, garbled tokens. Greek misread as
  Latin letters is listed to read, not counted. No pixels needed.
  `--check` exits with an error on any finding. **[before upload]**
- `npx vite-node --config vitest.config.ts scripts/checks-of.ts books/*/book.json --out d/`:
  every check that needs no browser (damage, apparatus, consistency, rulings
  not yet in the text) over one or many shelf books. `--check` exits with an
  error on anything left after the editor's rulings. **[before upload]**
- `npx vite-node --config vitest.config.ts scripts/page-turns-of.ts <book.json> [--check]`:
  paragraphs broken at a page turn where the paper runs on, from the text and
  from each leaf's first-line indent in the saved reading. Crop each finding
  before merging. **[before upload]**
- `npx vite-node --config vitest.config.ts scripts/coverage-of.ts <book.json> [--second s.json]`:
  lines the paper prints that the book lacks or sets elsewhere, against the
  scan's own OCR layer, or a `second` reading for a scan with none. No browser
  needed. Refuses when too few leaves have words to compare. **[before upload]**
- `npx vite-node --config vitest.config.ts scripts/spelling-of.ts <book.json> --shelf books/ [--out s.md] [--text interior.pdf]`:
  words no dictionary knows that stand alone (once here, under three times on
  the rest of the shelf). With `--text`, it reads the exported PDF itself,
  which catches every part that prints. Run it on the file about to be
  uploaded. Needs `pdftotext`. A sheet to read, not an automatic pass or fail:
  readiness requires that it was made from the exact upload file and read, each
  word corrected or kept as printed on purpose, and that reading recorded. **[before upload]**
- `node scripts/drive.mjs parallels`: writes `parallels.md` beside the book:
  passages the book prints twice, and where the two copies disagree on a word. The second witness for a book with
  no scan.
- `node scripts/drive.mjs concordance f.json`: for a book with no scan, what
  the checking reader gets instead of a crop: the paragraph, its neighbours,
  its parallels, and never the guess being tested.
- `node scripts/italic-witness.mjs <scan.pdf> w.json`: which words a ClearScan
  or named-face PDF prints in italic, measured off the letters' slant. Feeds
  `emphasis-of.ts`.
- `npx vite-node --config vitest.config.ts scripts/slant-witness.ts <scan.pdf> w.json [--words t.json] [--book book.json]`:
  italic read off the pixels, for a scan whose text layer names no face or
  that has no layer. Take it to `emphasis-of.ts` with `--no-headings`, and
  crop a sample before landing.
- `npx vite-node --config vitest.config.ts scripts/emphasis-of.ts <book.json> w.json out.json`:
  italic the witness saw that the book sets in roman. `--restore` writes the
  batch that puts it back, text unchanged.

Fixing faults:

- `node scripts/drive.mjs sweep --was "belleves"`: finds a string across the
  whole book, notes and contents included. Free, changes nothing.
- `node scripts/drive.mjs sweep --was "belleves" --now "believes"`: replaces
  every match, keeping italics, and reports each change. **Warnings:**
  `--now` writes; there is no dry run, the find is the same command without
  `--now`. It matches the string, not the word (`Herschel` is inside
  `Herschell`), so sweep a phrase long enough to be the whole word. Without
  `--case` it matches any case and can lower a capital; check the case of
  every hit first.
- `node scripts/drive.mjs correct --batch b.json`: many whole-block
  replacements in one save; each entry is `{ "id": "p12b3", "text": "…" }`
  (a note id like `fn40` works too). Refuses a change that would strip all
  italics from a block (`--bare` says it was meant) or move a declared bare
  mark (`--marks-checked`). The single form is `correct <blockId> <file>`.
- `node scripts/drive.mjs split <blockId> "<words the next line starts with>"`:
  puts back a line break the conversion dropped, as a split edit.
- `node scripts/drive.mjs block <id> retype footnote`: lifts a paragraph that
  is really a footnote out of the body and into the notes.
- `node scripts/drive.mjs insert <after> footnote <file>`: puts back a note the
  reading folded into another.
- `node scripts/drive.mjs edits p13b5`: every edit that names a block.
  `edits p13b5 drop retype` withdraws one; this is how a block lifted into
  the notes is reached again.
- `npx vite-node --config vitest.config.ts scripts/notes-to-footnotes.ts <book.json> <out.json> [--keep <head-leaf>:<note>]`:
  turns notes gathered under "FOOTNOTES FOR …" into real footnotes. Stops
  with an error naming any note its chapter has no mark for. Check with
  `drive.mjs pairs` before landing.

## Editorial queries and rulings

- `node scripts/drive.mjs queries`: decisions waiting on the editor, as
  `queries.md` beside the book, with `rulings.md`, `review.md` and (when the
  reader has offered answers) `proposals.md` beside it. The shelf paths it
  reports name the book's own folder. **Warning:** it overwrites those
  sheets; read `git log -1 -- <dir>/rulings.md` and the head of the file
  first, and restore a hand-written sheet from git afterwards. Lists any
  waiting query without a proposal.
- `node scripts/drive.mjs propose p.json --by="the Glossary session"`: the
  reader's suggested answers, offered at the query screen with nothing
  selected. The file is an array of `{ leaf, quote, decision, correction?,
because }`. Not rulings: only the editor picking one files anything. Write
  `--by=` with the equals sign; with a space the name is ignored.
  `--replace` clears the book's earlier proposals first. Then `save`, run
  `queries` to write `proposals.md`, and push.
- `node scripts/drive.mjs held`: waiting queries that a standing ruling holds
  an answer for. `held approve --yes` files them, naming the ruling each came
  from. **The `--yes` is the editor's word, never implied.**
- `node scripts/drive.mjs link review`: a web address that opens this book on
  the screen where decisions wait. Works only once the book is on the shelf.
- `node scripts/drive.mjs memos`: notes the editor left for the assistant,
  with the text each sits in. `memos resolve <id> "<what was done>"` answers
  one; the memo stays until the editor clears it. `memos clear` is the
  editor's move. A memo asking for prose gets a proposal, never a landed edit.

## Writing and glossary

- `node scripts/voice.mjs audit <book.json>` (or any prose file): the bias
  pass over the editor's sections and notes. Lists hedges on sentences about
  the tradition, dismissals, banned phrases, reading directions, dashes, the
  reading grade and flat stretches; exit 1 means a person reads the flagged
  passages.
- `node scripts/drive.mjs answers a.json`: merges design and edition answers
  into the open book. `save` writes them to `book.json`.
- `node scripts/drive.mjs annotate p284b12 --after "Triangle." note.txt --id ed-columns`:
  a footnote of the editor's own, hung after a phrase the block prints exactly
  once. Running it again with the same `--id` replaces it;
  `annotate drop <id>` removes it.
- `node scripts/drive.mjs insert p640b3 table t.txt --id modern --header`: a
  block the editor wrote, after the named block: a table (rows on lines,
  cells split by `|`), a caption or a heading. `insert drop <id>` removes it.
- `npx vite-node --config vitest.config.ts scripts/glossary-packets.ts <book.json> --shelf <shelf> --out <dir>`:
  for each glossary entry, the evidence it is written from: Blavatsky's own
  Glossary entry, her other books, the author's uses. Method in
  `docs/PROCESS-glossary.md`.
- `npx vite-node --config vitest.config.ts scripts/glossary-merge.ts <book.json> --out <txt> --packets <dir> out-*.json`:
  folds the rewritten entries back in order, drops cuts named by `--drop`,
  and names every quotation no packet carries. Lands with
  `drive.mjs section glossary`.
- `npx vite-node --config vitest.config.ts scripts/glossary-circles.ts <book.json> <batch.json>`:
  a glossary circle for every entry nothing points at, as a
  `correct --batch` file. Read each line before landing it.

## Pictures

- `node scripts/drive.mjs figures f.md`: every picture the first reading
  already found, leaf by leaf. A shortlist, not a check.
- `node scripts/contact-sheets.mjs <renders> <out>`: every leaf of the book,
  small, many to a sheet. The only way to answer "is there a picture we have
  missed?" Reads renders named `<anything>-<leaf>.png`.
- `node scripts/drive.mjs figure cut 193 0.527,0.532,0.389,0.175 --beside p193b1 --at "various kinds" --side right`:
  cuts a figure out of the scan at 300 DPI and sets it where the original set
  it. `--after <block>` between paragraphs at its printed size;
  `--in <block> --at "<phrase>"` inside a paragraph; `--beside … --side
left|right` with the text running past it. `figure list` and
  `figure drop <id>` manage them. `--from <pdf>` cuts from another copy of
  the same printing (for a book read from an EPUB).
- `node scripts/drive.mjs figure add plates/3.jpg --plate p32b4 --caption "The Emerald Tablet"`:
  a picture file the scan left out, copied pixel for pixel. `--plate <block>`
  gives it a leaf of its own after the block; `--frontispiece` puts it facing
  the title page.
- `node scripts/drive.mjs figure set <id> --caption-file c.txt --after p244b4`:
  changes a supplied figure's caption or position without cutting it again.
  `--alt "…"` (or `--alt-file`) is the description for readers who cannot
  see it: the EPUB's alt text, never printed.

## Export, EPUB and covers

- `npx vite-node --config vitest.config.ts scripts/epub-of.ts <book-dir> <out-dir>`:
  the book as an EPUB for quick reading: the same text and note pairing as
  the PDF, a chapter per file. Pack with `zip -X0`, `mimetype` first, then
  `META-INF` and `OEBPS`. It also names every picture with neither a
  description nor a caption.
- Spelling on the exported PDF: see `spelling-of.ts --text` under "Checking a
  book's text". **[before upload]**

The PDF export (`drive.mjs proof`) and cover flattening
(`scripts/flatten-cover.py`) are listed under "Named elsewhere" below.

## Shelf maintenance

- `node scripts/book-files.mjs <book-dir> --check`: checks the readable files
  (`glossary.md`, `introduction.md`, `corrections.md`, `notes.md`, the ledger)
  still describe `book.json`. Without `--check` it rewrites them, keeping the
  editor's title and description lines. `--body body.json` checks the entries
  of `corrections.md` too. **[before upload]**
- `node scripts/drive.mjs finish <book-dir>`: the "done" list from the driver:
  `book-files.mjs --finish` plus glossary marks, rulings not yet applied, and
  conversion damage. Exits with an error naming what is owed. See the top of
  this file for what it does not cover. **[before upload]**
- `node scripts/book-files.mjs <book-dir> --finish`: every condition for
  "done", named, with an error exit. Change this list when the definition of
  finished changes. **[before upload]**
- `node scripts/book-files.mjs --shelf books/`: one row per book: what each
  has and what it is missing. Answers "has this book got what the last one
  got?"
- `node scripts/shape.mjs <book-dir> --write`: measures what the book is made
  of (pixels, where its text came from, a second copy) and records it as
  `run.shape`. `--declare '<json>' --because '<reason>'` where nothing can
  measure it; `--shelf books/` gives one row per book; `--flow` regenerates
  the table in `docs/FLOW.md`.
- `node scripts/drive.mjs corrections <book-dir>`: rewrites the entries of
  `corrections.md` from the book as it stands, keeping the prose above them.
  `--check` writes nothing.

## Storage

Big files (scans, reference copies, exports, picture originals) live in the
private Cloudflare R2 bucket `libri-vetus-files`, each named by its SHA-256
fingerprint ([decision 0051](../decisions/0051-big-files-live-in-cloudflare-r2.md)).
In a cloud session the key is added by the network; on the owner's computer
it is read from `CLOUDFLARE_API_TOKEN` (see
[sessions.md](../process/sessions.md#storage-key-on-your-own-computer)).

- `node scripts/storage.mjs put <file> --kind <kind> --shelf <shelf>`: puts
  a file in the bucket as `<kind>/<sha256>.<ext>` (refusing a `--shelf` or an output inside the tools repository) (kinds: `scans`, `sources`, `pictures`, `exports` for old exports not yet matched to an upload, and `editions/<book folder>/<edition>` for the exact files sent to KDP; a book folder keeps its capitals), skips the upload when that key is already
  there at that size, then always fetches it back and checks the
  fingerprint. With `--shelf` it adds a row to `STORAGE.tsv` at the shelf's
  root (key, fingerprint, bytes, where it was on the shelf, date); `--from
<path>` names where it was when that is not its path under the shelf.
  Prints one line of JSON. Refuses files over 300 MB. Remove nothing from
  the shelf until this has printed `"verified":true`.
- `node scripts/storage.mjs get <key> <out>`: fetches a file back. A key
  carrying a fingerprint is checked, and a download that does not match is
  not kept. Refuses to overwrite a different file at `<out>`.
- `node scripts/storage.mjs list [prefix]`: every key in the bucket with its
  size, one per line (`list sources/` for one kind).
- `node scripts/storage.mjs verify <key>`: fetches the file in the bucket and
  checks it against the fingerprint in its key.
- `node scripts/storage.mjs selftest`: puts a small made-up file under
  `_test/`, gets it, checks it, lists it and deletes it. Run it first on a new
  computer to prove the key works. The command deletes nothing else.

## Named elsewhere

These are used or mentioned by the commands above and have no entry of their
own yet. All exist: `drive.mjs save` (writes the open run to `book.json`), `pairs`, `proof`
(lays out the book; `proof pdf=<out.pdf>` writes the PDF export; reports
unprintable characters), `querycrops`, `crops`, `card`, `shelf`, `section`,
`bare`, `query`, `rule`, `truth`; `scripts/flatten-cover.py <cover.pdf>
<cover-flat.pdf>` (the cover copy KDP accepts);
`scripts/reading-kit/variants.mjs` (prints `SWEEP UNSAFE`).
