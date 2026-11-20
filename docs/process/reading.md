# Reading: getting the text right

## Purpose

Take a book from its source (a scan, a born-digital PDF or an EPUB) to a
transcription in which every leaf has been corrected against the page. When
this job is finished the book is **read** ([README.md](./README.md)).

## Who runs it

The **reader** ([.claude/agents/reader.md](../../.claude/agents/reader.md)),
one task per run, each launched by the managing editor: a reader prepares a
stretch (steps 1 to 5); batch readers, at most four at once, each correct one
batch against its renders and then end; a reader checks and lands the
finished batches and raises the queries (steps 6 to 13). The checks of
[checking.md](./checking.md) are the checker's.

## The one rule

**A model may propose a reading; only the page may accept one.** Nobody types
a leaf out from the image. The free OCR reading comes first, and every later
step is "here is an image and here is a text, where do they differ". A reader
that never writes text unprompted cannot invent a paragraph, and a session
that has read three hundred pages of one author is exactly where fluent
invention appears. Every arrangement below exists to keep that true.

## Before you start

- [sessions.md](./sessions.md) done: both repositories synced, the book loaded
  from the shelf with its real scan, `drive.mjs book` read.
- The shape is recorded and you know the route ([FLOW.md](../FLOW.md)). A
  book with no page images is read differently: see the last section.
- `RULINGS.md` (shelf root) and the book's `rulings.md` read. Standing
  rulings decide how many queries will be filed.
- **Ask what can see the book's italic, before the first batch.** A block with
  no `<i>` looks exactly like a block that never had any. A born-digital PDF
  names its faces (the draft carries them). A ClearScan or converted PDF keeps
  its glyph shapes: `node scripts/italic-witness.mjs <scan.pdf> w.json`. A scan
  whose layer names no face:
  `npx vite-node --config vitest.config.ts scripts/slant-witness.ts <scan.pdf> w.json`.
  A scan with no layer at all needs the word boxes the free reading found:
  after step 1, `node scripts/drive.mjs words --out` writes them and names the
  file; add `--words <that file>` to the slant witness. Either witness that
  measures nothing stops with an error and writes nothing; it never hands
  back an empty list as if the book had no italic. With no witness, the
  reader marks italic while correcting, like a letter.
- **Check the scan has whole leaves.** One Google scan had lost the running
  head and first lines of 288 leaves; each seam read straight across the gap.
  Lost lines come from a second copy of the same printing, never from memory.

## Steps

1. **Take the free reading.** Loading the book does not start it; `load`
   says whether a reading is here. Run `node scripts/drive.mjs recon`. It
   renders, OCRs and caches every leaf (a born-digital PDF has its own words
   read out), or loads `recon.json.gz` from beside the book when that is a
   reading of this scan, or does nothing when the reading is already here
   (`--fresh` reads again). A long book takes most of an hour: run it in the
   background; it prints how far it has got, and `recon --status` answers at
   once. If it is cut off, run it again: it carries on from its last
   checkpoint (every 20 leaves). Then keep the reading on the shelf with
   `node scripts/drive.mjs reconexport <shelf>/books/<folder>/recon.json.gz`.
   An EPUB has no pages to read: recon does not apply, and says so.
2. **Get a second reading** where the route allows one:
   `node scripts/drive.mjs second --out <shelf>/books/<folder>/second.json`
   (PaddleOCR over every leaf; `--layer` takes the scan's own OCR layer
   instead), then `node scripts/drive.mjs witness <that second.json>`. Keep
   `second.json` on the shelf beside the book; with no `--out` it goes to the
   scratch folder ([commands.md](../reference/commands.md)). Reading every
   leaf is the default: a quarter of the leaves chosen by any measure finds
   only about half the damage.
3. **Triage by measurement, never by feel.** OCR confidences and `assessText`
   decide which leaves get eyes. Never escalate because a model says it is
   unsure.
4. **Draft the leaves**: `node scripts/drive.mjs draft <out.json> <leaf> <leaf> …`.
   Leaves count from 0 and are the scan's leaves, not printed page numbers.
   Each leaf's `structural` list says what was guessed rather than measured;
   check those first. Line-break hyphens the book's vocabulary settles are
   already joined or kept; the `unsettled` ones need eyes. A draft is never
   saved and never believed.
5. **Batch the leaves into subagents.** Render the leaves
   (`node scripts/drive.mjs leaf <n> <name> 150`), then
   `node scripts/batch.mjs <draft.json> <out-dir> --per 13 --renders <dir> --prefix <tag> --seam <prev-tail.txt>`
   writes one lean draft and one brief per batch. The managing editor gives
   each brief to one batch reader, at most four at once. Every reader also
   gets `docs/BRIEF-reading.md`, the shared method
   (`batch.mjs` writes that path into each brief, so the file moves only
   together with `scripts/batch.mjs`). Readers open renders **three at a
   time**, then write; a request carrying more images times out and the batch
   is lost. If a reader dies at the render-loading turn, relaunch it and say
   nothing was written. Ten to thirteen leaves a batch. The reader who
   prepares and lands the batches never reads a leaf off its render itself,
   and nor does the managing editor: the batch readers do. The reading kit
   ([scripts/reading-kit/README.md](../../scripts/reading-kit/README.md)) is
   the same loop in stretches of thirty leaves, with a per-book `PROMPT.md`.
6. **Check each batch before landing it**:
   `node scripts/batch.mjs --check <done.json> <draft.json>`. It catches an
   unclosed `<i>`, a leaf missing from the reply, a footnote filed under the
   wrong mark and word drift a correction would not cause. For a book with
   notes, also run the reading kit's `balance.mjs` on the batch: one leaf whose
   marks and notes do not balance puts every later note of that mark under the
   wrong reference.
7. **Land it**: `node scripts/drive.mjs transcribe <scan.pdf> <done.json>`.
   It merges leaf by leaf (never use `replace` unless replacing is meant) and
   compares each leaf with the OCR. It refuses leaves no cached reading
   covers, naming `recon`; `--without-ocr-check` lands them anyway, and the
   report still says NOT CHECKED. Read its report: `ocr` says how many
   leaves were really compared, `flagged` lists disagreements, `complete` is
   never true on a guessed leaf count. Then save and push: one batch lost, not
   a book.
8. **While the leaf is still open**, settle what is cheapest to settle now:
   - Greek and Hebrew are read off the pixels; `node scripts/drive.mjs damage`
     lists the garbled kind and the word-shaped kind (`greek`) after each batch.
   - Matter in columns lands as a `table`: one printed line is one row, and a
     cell the paper sets over two lines is two rows. A no-break space binds
     nothing in this engine.
   - A symbol set inside a line is the typesetter's
     ([pictures.md](./pictures.md), step 4): leave it as the draft has it
     and name its leaf and block in your report. The typesetter cuts it as a
     figure, or sets the character the book prints for it elsewhere.
   - Front matter gets its `role` in the first batch.
   - A book that gathers numbered notes per Part or chapter records each mark
     as the superscript character (`¹`), never a plain `1`.
   - Where a witness exists,
     `npx vite-node --config vitest.config.ts scripts/emphasis-of.ts <book.json> w.json out.json`
     lists italic set in roman; `--restore` writes the batch that puts it
     back. Every witness is a floor: crop a sample before landing.
9. **Correct against the assembled book, never a leaf.** `node scripts/drive.mjs body`
   writes each block's id and whole text, with emphasis as `<i>`, `<b>` and
   `<sc>`, as first read (`pristine`) and as corrected (`edited`), to the file
   its result names; the book's own footnotes, with their `fn…` ids, are the
   separate tree `notes.edited` and `notes.pristine`. Assembly
   joins paragraphs across page seams, so a leaf's raw text truncates them.
   Write corrections against those strings:
   `node scripts/drive.mjs correct --batch b.json`. It refuses a change that
   strips every tag from a block (`--bare` only when meant) or moves a declared
   bare mark (re-declare, run `drive.mjs pairs`, then `--marks-checked`).
10. **Raise what is the editor's; never take it.** A compositor's error, a
    place the book contradicts itself, a passage where "faithful" and
    "correct" pull apart: transcribe it as printed and attach a query. Before
    raising one, read its whole block, the blocks either side and the same
    word elsewhere in the chapter; raise only what that cannot settle, with the
    paragraph attached. Quote whole words, including the fault. For a spelling
    query, put the counts from `scripts/reading-kit/variants.mjs` in it as
    evidence. A note the paper prints no mark for is the editor's too.
11. **Every query goes up with the reader's answer beside it** (editor's
    instruction, 5 October 2026):
    `node scripts/drive.mjs propose p.json --by="<who>"`, written from
    evidence (the crop, a second printing checked on its pixels, the book's
    own usage). Nothing is pre-selected; only the editor's choice files a
    ruling. `node scripts/drive.mjs queries` names any waiting query
    without a proposal; the list is empty when queries are pushed. Cut crops in
    advance with `node scripts/drive.mjs querycrops` (the passage's lines and
    three whole lines either side, the passage marked; crops cut before 19
    November 2026 are shorter and unmarked, so cut them again when the scan is
    to hand), and withdraw a query the pixels refute with
    `drive.mjs unquery <leaf> <quote> "<reason>"`.
12. **Standing rulings hold; they never settle.** `node scripts/drive.mjs held`
    lists waiting queries a standing ruling covers. `held approve --yes` files
    them only on the editor's word, never implied. After a spelling ruling,
    sweep with `--case` ([checking.md](./checking.md)).
13. **A ruling is not a correction.** `node scripts/drive.mjs rule <leaf> "<quote>" corrected "<text>"`
    files the editor's decision and leaves the text as it was. Apply it as a
    second step, with `correct` on the block (or `sweep`), then `save`. Until
    then `queries` lists the ruling under `decidedButNotPrinted`, which is
    empty when the book reads as ruled.

## When the book has no page images

A born-digital PDF, an EPUB, or somebody's OCR printed back to PDF. A PDF with
text and no page images is usually OCR (it once needed 350 word corrections
under a "confidence 100" stamp): read every leaf for conversion damage. A
render of such a leaf is the text layer drawn again, not evidence, so
`drive.mjs crops` refuses these books. What stands in, strongest first: a
second digitisation (archive.org's OCR, a Gutenberg text) through `witness`,
then the book's own repeated passages (`drive.mjs parallels`), then
`drive.mjs concordance`. A place a parallel settles is a correction; a place
only context speaks to is a **query**, never a correction. Heading levels and
lost line breaks are set by hand (`drive.mjs split`, `drive.mjs block`). A
Paper Capture PDF that redraws about half its words in a font is not a
photograph: declare its shape with `shape.mjs --declare … --because … --write`. An
EPUB's chapters come in through
`node scripts/drive.mjs epub <book.epub> e.json 1 2 3`, then `transcribe`.

## Checks that must pass before the book is called read

| Check                                | Command                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Each batch well formed               | `node scripts/batch.mjs --check <done.json> <draft.json>`                                               |
| Every leaf landed, compared with OCR | `transcribe` report: `stillMissing` 0, `complete` true, `ocr` names the leaves compared                 |
| Notes all claimed                    | `node scripts/drive.mjs notes n.json --full` (none orphaned) and `node scripts/drive.mjs pairs`         |
| Garbled script and tables read       | `node scripts/drive.mjs damage`, its `garbled`, `greek` and `table-as-prose` lines read                 |
| Every query has a proposal           | `node scripts/drive.mjs queries` lists none without                                                     |
| Markup kept through corrections      | (proposed check) tag counts per block, `pristine` against `edited` from `drive.mjs body`; by hand today |

## What it produces and where it goes

`book.json` on the shelf with every leaf transcribed and the reading marked
complete; `recon.json.gz` and `second.json` beside it; `queries.md`,
`proposals.md`, `rulings.md` and `review.md` (written by `drive.mjs queries`);
query crops in `queries/`; a `ledger.md` entry per stretch (batches, tokens
spent, what the checks found), written by the managing editor from the
reader's report. Then the book goes to
[checking.md](./checking.md).

## Never

- Never type a leaf out from the image, or let a step's output be text in
  place of a correction to a draft.
- Never trust a draft, an OCR confidence, or an assessment that says a text
  layer is trustworthy: none of them is a reading.
- Never write a correction against a leaf's raw text.
- Never correct or keep an editor's decision silently; raise it with a
  proposal, nothing pre-selected.
- Never claim evidence you do not have ("checked at 600 DPI" while holding one
  150 DPI render).
- Never repair a scanned book from its own vocabulary: where pixels exist they
  are the only accepter.
- Never call the book read while any leaf is unlanded or any landed batch is
  unchecked.
