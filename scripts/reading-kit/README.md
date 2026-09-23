# The reading kit

How a scanned book gets read without an API, in the shape CLAUDE.md
describes: `draft` → readers with the pixels → `transcribe`, thirty leaves
at a time, checkpointed at every stretch. These scripts were written in one
session's scratchpad while _The Theosophical Glossary_ was read and moved
here so the next session, on any machine, runs the same loop rather than
rebuilding it. Every one of them was checked to reproduce that session's
files exactly before it was committed.

The book-specific part is the reader's brief: `glossary/PROMPT.md` names
what each OCR engine gets wrong _on that book_ and the editor's rulings that
govern it. A new book gets its own directory here with a PROMPT.md written
after its first stretch, when those facts are known.

## Once per book

```bash
node scripts/drive.mjs serve &                       # a browser, on DRIVE_PORT
node scripts/drive.mjs load <shelf>/books/<slug>/book.json <shelf>/scans/<sha>.pdf
node scripts/drive.mjs use <shelf>/scans/<sha>.pdf
mkdir -p <kit>                                       # a working directory outside both repos
node scripts/drive.mjs second --out <kit>/second.json   # the second engine, every leaf (slow: minutes to hours)
node scripts/drive.mjs witness <kit>/second.json <kit>/witness.json
```

`second.json` is worth keeping on the shelf beside the book (the Glossary's
is at `books/<slug>/second.json`); `witness.json` is a second's work from it.

## Per stretch of thirty leaves

```bash
scripts/reading-kit/stretch.sh <kit> scripts/reading-kit/glossary <from> <to>
```

That drafts the leaves off the cached OCR, restores the `(Sk.)` tag the
engine mangles, renders each leaf at 400 DPI into `<kit>/shots/`, writes one
brief per five leaves to `<kit>/briefs/`, and one prompt per brief to
`<kit>/work/<batch>/prompt.md`. Then **dispatch one subagent per prompt**,
in the same message so they run at once:

> Your whole task is written in `<kit>/work/240-244/prompt.md`. Read that
> file first and follow it exactly. Work leaf by leaf; write the output file
> it names; report back only what it asks for.

Each writes `<kit>/done/<batch>.json` and reports blocks changed, queries by
kind, and anything the next stretch should know. Fold what is new into
PROMPT.md's engine notes before the next stretch — that is how the brief
got its list.

When all six are back:

```bash
node scripts/reading-kit/land.mjs <kit> <from> <to>      # → batch-, queries-<tag>.json; prints the PE fixes
node scripts/drive.mjs transcribe <shelf>/scans/<sha>.pdf <kit>/batch-<tag>.json
#   write <kit>/corrections-<tag>.json by hand from the PE list: [[was, now], …],
#   each `was` long enough to match once in the whole book
node scripts/reading-kit/apply.mjs <kit> <from> <to>     # sweeps (must be 1 each) + rulings under the standing rules
node scripts/drive.mjs save <shelf>/books/<slug>/book.json
node scripts/drive.mjs queries <shelf>/books/<slug>/queries.md
git -C <shelf> add books/<slug> && git -C <shelf> commit && git -C <shelf> push
```

A reader who needs a closer look uses `crop.mjs` (pure Node, since the
desktop has no image library): `node scripts/reading-kit/crop.mjs <png>
<out.png> x y w h [scale]`.

`apply.mjs` lists what it left for the editor. Cut crops for those leaves
and send them as one sheet:

```bash
node scripts/drive.mjs querycrops <kit>/qc <leaf...>
node scripts/reading-kit/sheet.mjs <shelf>/books/<slug>/book.json <kit>/qc <kit>/sheet-N.jpg <leaf...>
```

## Rules the scripts hold, and one they cannot

- A reader is given an image and a text and asked where they differ. It
  never types a leaf out from the picture (PROMPT.md, first paragraph).
- A sweep must replace exactly one match; `apply.mjs` prints CHECK and exits
  non-zero otherwise. A `--was` short enough to be a class is counted
  first — `(Zend).` matched fourteen of the book's own settings once.
- `land.mjs` strips any field `transcribe` does not know, because it refuses
  a page carrying one and a batch refused is a stretch not landed.
- What no script can check: after each stretch, compare tag counts pristine
  against edited over the whole body (`drive.mjs body`) — a block with no
  bold looks exactly like a block with no bold. See CLAUDE.md, "A sweep
  typed as a phrase stripped the runs the phrase spanned."
