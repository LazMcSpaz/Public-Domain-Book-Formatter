# Making the edition: from a read book to a printed one

[`PROCESS-reading.md`](./PROCESS-reading.md) takes a scan to a transcription
somebody can trust, and stops at **Stage 9 — a person decides**. This document
picks up there and carries the same book to a PDF on the shelf that a reader
could buy. The stage numbers continue, because it is one process.

Same conditions as the other half: no API, everything happens in a browser the
driver holds open or in a conversation, and most of what follows is about the
safeguards rather than the steps.

---

## The one rule

**The shelf must describe the book it holds.**

`book.json` is the source. The PDF is derived from it. `glossary.md` and
`introduction.md` are views of it. `corrections.md` and `notes.md` make counted
claims about it. The moment any of those disagrees, the shelf is lying to
whoever reads it next, and it does so quietly: nothing errors, nothing warns,
and the file that is wrong is the one a person actually opens.

So a change to a book is **four edits, not one** — the book file, the export,
the readable files, and one commit carrying all of them. A commit with a book
file and no exports is a commit that has to be remembered later, and this is
the half of the process where things get remembered wrong.

---

## Invariants

Each is meant to be falsifiable by running something. Attack them.

| #   | Invariant                                                                | How to attack it                                                                                                      |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| E1  | The readable files agree with `book.json`.                               | `node scripts/book-files.mjs <book-dir> --check` — non-zero exit means they do not.                                   |
| E2  | The PDF on the shelf was exported from the `book.json` beside it.        | Check `git log -1 -- book.json` and `git log -1 -- *.pdf` name the same commit.                                       |
| E3  | Nothing the engine could not place is lost in silence.                   | Confirm `notesDropped`, `imagesDropped` and `missingImages` are all empty in the `proof` report, and `warnings` is 0. |
| E4  | Every note is anchored to words that exist in the block it hangs on.     | `node scripts/voice.mjs check <proposals.json> <body.json>` — any `ANCHOR NOT FOUND` is a note pointing at nothing.   |
| E5  | Every fact a note asserts that the book does not state has been checked. | Same command: the `check:` list is the list. An unexamined entry there is an unverified claim in print.               |
| E6  | The prose does not lean, and does not tell the reader what to read.      | `node scripts/voice.mjs audit <book.json>` exits non-zero when it wants a person.                                     |
| E7  | A glossary entry for a word the book uses has a mark on that word.       | **Currently unmet — see Gaps.**                                                                                       |
| E8  | The text of the finished PDF is extractable.                             | Pull page text with pdf.js and read it. A scanned-looking page here means the fonts or the widths are wrong.          |
| E9  | The local checkout is not behind the remote.                             | `git rev-list --count HEAD..origin/main` in **both** repos. See Stage 10.                                             |

---

## Stage 10 — Take stock before touching anything

This container reverts both checkouts without warning. It happened six times
in the session that produced this document, twice _after_ the work had been
pushed, leaving a tree that looked like a week-old commit while the remote held
everything. Assume nothing about what is on disk.

```bash
for r in ~/Public-Domain-Book-Formatter ~/public-domain-books-storage; do
  git -C $r fetch origin -q
  echo "$r behind $(git -C $r rev-list --count HEAD..origin/main) ahead $(git -C $r rev-list --count origin/main..HEAD)"
done
```

**Behind and not ahead** means the container rolled you back: `git reset --hard
origin/main`, nothing is lost. **Ahead** means work is sitting here that only
this container has, and it goes up before anything else happens.

Then find out what state the book is in, rather than remembering:

```bash
node scripts/book-files.mjs <book-dir> --check   # do the readable files agree?
node scripts/drive.mjs book                      # which book is the browser holding?
node scripts/drive.mjs runs                      # any stray runs from a wrong load?
```

## Stage 11 — Load the book, from the shelf and from the right file

```bash
node scripts/drive.mjs load <book-dir>/book.json <shelf>/scans/<sha>.pdf
```

**The PDF sitting in the book's own directory is the export, not the scan.**
The scan lives in `scans/` under its own SHA-256, and `book.json` names it in
`scan.path`. Read the path out of the book file; do not reach for the PDF
beside it. Handing `load` the export does not fail — it stores a second run
under a different key, and every `leaf`, `ocr` and crop after that renders the
finished edition instead of the paper.

Confirm with `drive.mjs book` that the file you meant is the current one.

## Stage 12 — Proof the assembled body

`drive.mjs body out.json` hands back `pristine` and `edited` for every block,
with the ids and the exact strings an edit must be written in terms of.

**A leaf's text is not a block's text.** Assembly joins paragraphs across page
seams, so the raw transcription of a leaf ends mid-word while the block carries
the whole paragraph. Diffing an edit against a transcription reports changes
nobody made and hides the ones that were.

Corrections go in as `text` edits carrying the block's whole text. Anything
that is the editor's decision rather than a reading — a printer's error, a
place the book contradicts itself — is raised as a **query** and transcribed as
printed. See the standing rule in `PROCESS-reading.md`; it does not soften
here.

## Stage 13 — The apparatus

The part that makes a reprint worth publishing, and the part that skips.

- **The glossary**, written against the book's own vocabulary.
- **The marks.** Every entry whose word the book actually uses takes a small
  circle at that word's first occurrence in the running text. An entry for a
  word the book never uses is legitimate and takes no mark; say which and why
  in `notes.md`.
- **The notes**, sparing, for what a reader of the period knew and a reader now
  does not. A note is not a definition; definitions are the glossary's job.
- **The introduction**, in the editor's voice.

**A step done for one book is not done for the next.** One volume here carried
85 marks and 23 notes; the next carried a 74-entry glossary, no marks at all
and no notes, and every report was perfectly happy about it. Until E7 is
checked by something, ask it out loud: _has this book got the apparatus the
last one got?_

## Stage 14 — The checks that are not opinions

```bash
node scripts/voice.mjs check <proposals.json> <body.json>   # anchors + outside claims
node scripts/voice.mjs audit <book.json>                    # the bias pass
```

`check` is deterministic and does not care who wrote the note. Every date,
figure and name a note asserts that the book itself never states comes back as
the list to verify. `ANCHOR NOT FOUND` means a note points at words that are
not there.

`audit` reports hedges sitting on the tradition's own teaching, dismissals,
banned phrasing, long dashes, and a reading grade. A non-zero exit means a
person reads the flagged passages. **Do not tune the limits to make a draft
pass.** What it cannot see is flatness, which needs a reader: an entry so dry
that nobody who read it would want to try anything has failed, and no word list
will tell you.

## Stage 15 — Design, and the look

The design answers live in the book file, so they travel with the book and
survive a refresh. Set them there rather than in the browser.

The design gate lays the book out, writes real PDF bytes and renders _those_.
There is no second renderer and there must not be one: that is what makes the
gate's approval mean anything.

Look at real pages, not at the report. Render the title page, the contents, a
chapter opening, a page carrying a note, and a blank verso. Most of what went
wrong with the layout this session was invisible in every summary and obvious
on the page.

## Stage 16 — Export, and read the report

```bash
node scripts/drive.mjs proof "answers=<book-dir>/book.json" "pdf=<book-dir>/<Name>.pdf"
```

Read every field, not the page count:

- `warnings: 0` — overfull lines, things sticking past the margin.
- `notesDropped: []`, `imagesDropped: []` — a note that could not be placed is
  reported, never dropped. Silence here is the worst failure in the program:
  the reader finds the missing footnote once it is printed.
- `notesPlaced` and `imagesPlaced` match what you put in.
- `designFrom: "the book file"` — not `DEFAULTS`, which means the answers did
  not travel and the book has been laid out in a look nobody chose.

Then **read text out of the PDF you just wrote**. Extraction proves the fonts
embedded with real widths; a page that comes back as line noise means a glyph
reached the page that has no width, and the book copies out broken.

## Stage 17 — The readable files, and one commit

```bash
node scripts/book-files.mjs <book-dir>          # rebuild what is derivable
node scripts/book-files.mjs <book-dir> --check  # and confirm
```

Then commit **the book file, the PDF and the readable files together**, and
push. Verify the push landed rather than trusting the absence of an error:

```bash
git rev-list --count origin/main..HEAD   # 0
```

Checkpoint per unit of work, not per session. The stretch that placed 67 marks
and wrote 10 notes ran about forty tool calls with nothing committed; had the
container reverted in the middle of it, all of it was gone.

---

## Known gaps — read this before relying on any of it

- **The mark check needs the body, so it is opt-in.** `--marks` wants what
  `drive.mjs body` writes, because the marks live in the _assembled_ text and
  that only exists in the browser. It is therefore the one invariant here that
  a default run does not check. Ask for it.
- **The mark check knows nothing about which occurrence should carry the mark.**
  Any marked occurrence satisfies an entry, deliberately: these books introduce
  a term in a run-in heading set in capitals and name it in the prose below,
  and the circle belongs on the words. An entry whose headword differs from the
  book's own wording — `Astral filament` against the book's bare `filament` —
  is reported as a word the book never uses. That is a false quiet, not a false
  alarm, and it is the safer way round.
- **Nothing ties a book file to its scan.** `load` accepts any PDF. Reading
  `scan.path` out of the book file, or refusing a PDF whose digest does not
  match, would end the wrong-file class outright.
- **`corrections.md` and `notes.md` cannot be regenerated**, only count-checked,
  because each entry quotes the assembled body and that lives in the browser.
