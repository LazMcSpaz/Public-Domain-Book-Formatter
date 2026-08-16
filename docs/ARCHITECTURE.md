# Architecture

Browser-only. React + TypeScript + Vite, no server, no Electron.

## The flow

```
Open PDF
  │
  ├─ RECON  (free, local, no API cost)
  │    PDF.js render @300dpi ─┐
  │    Tesseract.js OCR       ├─ one page at a time, released after use
  │    word crops             ─┘
  │    lexicon harvest (book-wide, frequency-driven)
  │    illustration candidates (OCR boxes + an ink test on the pixels)
  │
  ├─ GATE 1 ▸ confirm how to read it  ← orthography + term review
  │
  ├─ TRANSCRIBE  (vision model pass)
  │    per page: role + clean text + structure tags + uncertain spans
  │
  ├─ GATE 2 ▸ check uncertain spots   ← where model & OCR disagree
  ├─ GATE 3 ▸ confirm structure       ← chapters, footnotes, illustrations
  ├─ PROOF   ▸ each leaf beside its scan ← fix what was read wrong
  ├─ DESIGN  ▸ interview → layout → real pages, live
  └─ EXPORT  ▸ confirm title/author (prefilled) → PDF → KDP validation
```

Gates are the only stops. Everything between them runs unattended.

## Module map

| Area           | Path                   | Contains                                          | Browser APIs? |
| -------------- | ---------------------- | ------------------------------------------------- | ------------- |
| Domain model   | `src/core/model`       | Coordinate map, flags, project types              | no            |
| hOCR           | `src/core/hocr`        | hOCR parsing → tokens + boxes                     | no            |
| **Lexicon**    | `src/core/lexicon`     | Term harvesting, variant clustering, prompt block | no            |
| **Page roles** | `src/core/pages`       | Roles, dispositions, front-matter metadata        | no            |
| **Wizard**     | `src/core/wizard`      | Question contract, step machine                   | no            |
| **Edits**      | `src/core/edits`       | Corrections as a list, applied over the book      | no            |
| **Image**      | `src/core/image`       | Region detection, DPI math, op engine             | no            |
| **Layout**     | `src/core/layout`      | Frames, line breaking, pagination, notes, TOC     | no            |
| Typeset        | `src/core/typeset`     | KDP validation                                    | no            |
| Style          | `src/core/style`       | Profiles, resolution                              | no            |
| **Design**     | `src/core/design`      | Interview answers → a complete style profile      | no            |
| **Export**     | `src/core/export`      | Edition details, file naming, the honest report   | no            |
| Ornament       | `src/core/ornament`    | Vector ornament library (paths, no files)         | no            |
| **Platform**   | `src/platform/browser` | PDF.js, Tesseract.js, fonts, PDF writer, preview  | **yes**       |
| **App**        | `src/app`              | Wizard shell, question renderer, page preview     | **yes**       |

The `core` / `platform` split is the load-bearing boundary: `core` has no DOM and
no Node, so every rule in the flow is unit-testable without a browser.

## One layout, two consumers

```
BookDocument + StyleProfile
        │
        ▼
  layout engine  ──►  LaidOutPage[]  ──►  pdf-lib  ──►  PDF bytes
   (pure core)                                              │
                                            ┌───────────────┴────────────┐
                                            ▼                            ▼
                                   preview: pdf.js → canvas        download
```

**The preview is the PDF.** The design gate does not approximate the finished
page in CSS — it lays the book out, writes real PDF bytes, and renders those
bytes with pdf.js, the same library the app already uses to read scans. One
renderer means preview and output cannot drift, which is the only property that
makes a design gate worth stopping at.

`layout()` is a pure function of its inputs, and deliberately so. Both of the
circular problems the design anticipated are solved by that property:

- **Footnotes.** A note's height shrinks the body area on its page, which moves
  the line carrying its reference, which changes which notes are on the page.
  Resolved by reserving space _as lines are placed_: a line whose reference
  pulls in a new note shrinks the body before the line is committed, and moves
  to the next page if it no longer fits. The reservation only ever shrinks the
  body, so this settles in a single forward pass — the re-flow the plan
  budgeted for turned out not to be needed.
- **The table of contents.** Its page numbers only exist after a layout, and
  inserting the pages that carry them moves everything they refer to. Resolved
  by making the contents' _length_ independent of the numbers: the folio sits in
  a fixed-width column, so the line count is decided by the titles, which are
  known before any layout has run. Pass one lays out with the column blank and
  so already has the right page count; pass two fills the measured numbers in
  and cannot change the pagination. See `layoutWithToc`, which checks that
  invariant rather than assuming it.

Text measurement enters through an injectable `TextMeasurer`. The browser
supplies one backed by fontkit — _the same call pdf-lib makes to encode text_ —
so what the engine measures and what the PDF draws agree by construction. Tests
inject a fixed-width fake, so line breaks are exact integers and no font is
needed to assert on them.

## Never ask what the app can find out

A question is asked at the point where the app can _help_ answer it, not at the
point where the answer is first mentioned. The title, the author and the year of
the original used to be Gate 1's first three fields — asked before anything had
read the title page, so all three came up blank and the user had to go and open
the PDF somewhere else to fill them in. On a phone that means leaving the
browser.

They are asked at the export gate now. By then the vision pass has read the
original front matter, so the boxes arrive already filled with what it found,
with the scan of the title page beside them, and confirming is a glance. The
gate is not merely later: it is the first moment the app has something to offer.

Gate 1 keeps what it can genuinely ask at that point — how the original spelling
should be handled, and the harvested vocabulary, both of which shape the paid
pass that follows and neither of which the app could decide alone.

## Correcting what was read

The vision pass misreads words, and no cross-check can catch all of it. OCR
disagreeing is a _hint_; a page both witnesses read the same wrong way raises no
flag at all. Structure is worse — whether a line is a heading or a paragraph is
a judgment, and only a person looking at the leaf can settle it.

Before `src/core/edits` the app had no answer. The term grid at Gate 1 feeds
vocabulary into the _prompt_; it edits nothing. Gate 2 offers to re-read a page,
which costs money and may return the same reading. A book could be exported with
a wrong word in it and there was nothing to be done about that word.

- **Corrections are a list, not edited text.** Exactly the shape of the image op
  stack, for exactly the same reason: the transcription is the one artifact the
  user paid for, so it stays pristine and `applyEdits` is re-run over it. That
  buys undo, and it means removing a page or accepting a different picture
  re-derives the book with every correction still on it.
- **A block's id names its origin, not its position.** `p{page}b{index}` of the
  transcribed block that started it. An id counted off the _output_ would slide
  out from under every existing edit the moment a page was excluded or a caption
  left the flow. A block joined across a seam keeps the id of its first half.
- **The unit is the source leaf.** Not the finished page — this edition
  repaginates, so a finished page corresponds to nothing the user can hold the
  scan against — and not the whole book, which on 300 pages would be thousands
  of text boxes in the DOM. The leaf is also just how proofreading is done.
- **The leaf is rendered on demand at a readable size.** Recon's ~200px
  thumbnails are right for a page rail and useless for comparing words; keeping
  legible renders of every leaf would be hundreds of megabytes. So one is
  rendered when the user opens it and revoked when they move on — the same
  render-consume-release discipline as everything else that touches pixels.
- **Content is correctable; presentation is not.** Fix a word, retype a block,
  drop it, split it, join it, move a picture. There is deliberately no "indent
  this paragraph" or "break the line here": in a book that reflows to whatever
  measure the design gate settles on, those are not corrections but damage that
  survives until someone notices the page looks typed rather than set. A
  paragraph that needs different treatment gets a different _kind_, which the
  style system then sets consistently everywhere.
- **The one addition that is not a correction: the editor's own notes.** A
  public-domain reprint needs something of its editor's in it to be worth
  publishing, and an annotation is the cheapest honest way to add one. A note
  written at the proof step becomes a `Footnote` like any other, so it is
  placed, renumbered straight through with the book's own notes, and collected
  as an endnote if it cannot be placed — none of that machinery knows or cares
  who wrote it. It is located by an explicit `anchor` (block + character offset)
  rather than by splicing a marker into the text: a marker would show up in the
  proof sheet's edit box, where it reads as a typo and one backspace would
  silently orphan the note.
- **Divisions the editor wrote are the third addition, and the only one that is
  not a block.** An introduction or an afterword flows over as many leaves as it
  needs, carries its title into the contents, and is numbered by where it sits —
  roman in front matter, arabic at the back. It flows through the _same_ loop as
  the body and differs only in the `pageSection` its flowables open pages with,
  which is what `folioFor` reads. The count of front-matter pages is therefore
  read off `page.section` after the flow rather than captured before it. Its
  prose is split into paragraphs on blank lines: the convention prose already
  uses, so there is no markup language to learn.
- **Contents entries are matched to pages by id, not by array position.** They
  used to be paired by index, which worked only while the entries were exactly
  the book's own chapters; a single authored introduction in front of them would
  have handed every chapter the wrong folio.
- **The step leads with what was flagged but lists every leaf.** The flagged
  ones are where the app has an opinion; the unflagged ones are where this
  feature earns its existence.
- **Corrections are saved with the run** (schema v6). They are the other thing
  here that cannot be regenerated for free: everything else is re-derived from
  the scan, but an hour spent reading a book against its scan is an hour.

## Illustrations

A picture has to answer three questions that text does not: where it is on the
scan, whether it is a picture at all, and how big it may be printed. Each is
answered by a different witness, and none of them is the vision model.

```
OCR word boxes ──► detectRegions ──► rectangles with no *text* in them
                                          │
       page pixels ──► inkProfile ──► is there ink? where exactly?
                                          │
                                   candidates, tightened to their ink
                                          │
                              GATE 3 ▸ the user unticks the wrong ones
                                          │
                        crop at 300 DPI ──► PNG bytes ──► pdf-lib
                                          │
                              layout() sizes it ──► effective DPI ──► KDP
```

- **Detection is deliberately not the model's job.** `detectRegions` reads the
  OCR bounding boxes, which is the one witness in the pipeline that is not a
  language model. It finds maximal rectangles the _text_ flows around — which
  includes every margin, sink and short last page, so the pixels are asked
  next: `inkProfile` measures ink against the region's **own** paper tone,
  which is what makes one threshold work across cream, grey and foxed scans.
- **Then the box is pulled in to the ink.** A maximal empty rectangle reaches
  out to the margins; the picture inside it may be a third of that. Cropping the
  rectangle would set a small drawing in a large white box and then scale the
  box to the measure — spending the printed inches on paper. Tightening also
  makes the duplicate rectangles over one gap converge, so they can be deduped.
- **Every candidate is reviewed** (SPEC §6 calls detection low-trust, and it
  is). Gate 3 shows each crop with its size and ink fraction, all ticked; the
  user unticks what is not a picture. Only then are the accepted regions cut,
  so memory is never spent on a guess the user is about to reject.
- **Resolution is never invented.** Crops are taken at the DPI the page renders
  at and handed on at exactly that size. Rendering larger to make the DPI number
  look better would interpolate pixels the scan never had — the print would be
  no sharper, and the one check that would have warned the user would have been
  talked out of it. A low number is information.
- **The engine sizes, and therefore measures.** An illustration is set to the
  measure, scaled down if it will not fit, and given a leaf of its own once it
  is tall enough that the text around it would be a stub. Effective DPI is
  source pixels over _printed_ inches, so it does not exist until that decision
  is made — which is why the KDP check reads it off the finished pages.
- **Placement is as honest as its evidence.** The scan says only which page a
  picture was on, so it goes after the last text that shared that page. Inferring
  a position within the page would be guessing, and a picture confidently dropped
  into the wrong paragraph is harder to spot than one sitting a paragraph late.
- **Pixels travel beside the page model, not in it.** `ImageItem` carries an id;
  the renderer resolves it. Ornaments carry their art because art is path data,
  and pictures cannot: megabytes of decoded bitmap in a `LaidOutPage` would drag
  the DOM into `src/core` and hold a whole book of them at once.
- **A picture can also come from the editor**, not only from the scan. Such a
  picture has no source leaf, so `anchorAfterBlockId` is the only thing that
  places it and `origin: 'supplied'` is what stops the page rule being used as a
  fallback for a page it never had. It is decoded through a canvas — which both
  accepts any format the browser reads and bounds a phone photograph to what a
  book page can print — and its bytes are saved with the run, because unlike a
  crop they cannot be cut out of the scan again.
- **Anchors follow their block through a split or a merge.** "After that block"
  is still a place when the block is renamed or absorbed, and without the
  migration ordinary editing would silently unpin every picture that followed
  the paragraph being edited.
- **Retouching is an op stack, never a write.** SPEC §6's editing mode — crop,
  straighten, brightness, contrast, levels, despeckle, grey, threshold — appends
  to `Illustration.edits`, which the platform re-applies over the _original_
  bytes every time it changes. So any control can be dragged back, an op removed
  from the middle, the order changed, and nothing compounds or is lost. A crop is
  always measured against the original for the same reason: a second drag
  replaces the first rather than cropping the crop.
- **The core resolves only the _size_ of a retouch**, through `sizeAfterOps` —
  because the DPI check divides source pixels by printed inches, and a crop that
  halves a picture halves what the book has to print with. That is duplicated
  logic (the pixels live in the platform), so `test/image-ops.test.ts` asserts it
  agrees with `applyOps` on every op rather than trusting that it has.
- **Background removal is left out.** The spec calls it best-effort and it is;
  offering it without the manual touch-up of the selection that would make it
  honest is offering a magic button that quietly eats part of the picture.
- **A picture that could not be set is reported**, exactly as a note is —
  `imagesDropped` on the book, `missingImages` from the writer, both on the
  export screen. Nothing is drawn in its place: a grey placeholder in a book for
  sale is worse than a gap someone was told about.

## Ornaments and endnotes

- **Ornaments are vector data, not files.** `src/core/ornament` holds path data
  in each ornament's own coordinates; `layout()` places one under a chapter
  title as an `OrnamentItem` carrying the art itself, and `pdf-out` draws it with
  `drawSvgPath`. The item claims whole baseline slots, so the text under it moves
  down rather than being overprinted. A profile naming an ornament that no longer
  exists lays out without one — a missing flourish must never cost a chapter.
- **Endnotes are the honest home for a note with no reference.** A note whose
  marker appears nowhere in the body cannot be set at the foot of any page. The
  structure gate asks; `orphanNotes: 'collect'` appends a short "Notes" section
  after the body, keeping each note's _original_ printed marker — renumbering it
  would invent a placement nothing in the text supports — and lists that section
  in the contents. The other answer drops them, and `notesDropped` says so on the
  export screen. What must never happen is silence.

## What is saved, and what is not

Exactly one step in this app costs the user money. Everything else — rendering,
OCR, the lexicon, assembly, layout, the PDF — is free and repeatable. So the
saved unit is not a "project": it is **the paid transcription, keyed to the file
it came from** (`src/core/project`, stored in IndexedDB by
`platform/browser/run-store`).

Reopening the same book _offers_ the paid half back — as a question at the
transcribe gate, with the page count, the age and the model attached, and the
free option recommended. Taking it skips every question that existed only to
approve a charge.

Two things ride alongside it, under the user's own answer at the transcribe gate
about keeping book data on the device. Neither is ever a reason to fail: both
are conveniences, both are written after the paid record and never awaited into
the user's path, and both degrade to "do it again" rather than to an error.

- **The scan**, so reopening a book is a tap rather than an errand — finding the
  same PDF in a phone's downloads, and finding the _same_ one, since a
  re-download changes the modification time the key is built from.
- **The reading of it** (`src/core/project/recon-cache.ts`,
  `platform/browser/recon-cache`). Free is not the same as quick: rendering and
  OCR-ing three hundred pages is ten minutes of a warm phone to arrive back
  where you were. Stored as Blobs rather than object URLs, since a URL names a
  Blob in a tab that has since closed. The rules that matter are the ones for
  **refusing** it — a different DPI or a different page limit describes a book
  this session does not have — and a refused reading is deleted, because unlike
  a transcription it costs only time to replace.

The API key is stored with neither. It lives in its own place and must never
travel with a book.

## Why OCR is still here

Under the vision-pass design the model reads the page, so OCR is no longer the
source of truth. It stays for two reasons that a language model can't provide:

1. **Coordinate map.** Bounding boxes anchor every word to its pixels — the
   backbone for word crops, hover-sync, and image placement.
2. **Independent witness.** Tesseract is not a language model, so it has no
   shared blind spots with the vision pass. Where they disagree is real evidence;
   a model's confidence in its own output is not.

## Verification

| What         | How                                                                                     |
| ------------ | --------------------------------------------------------------------------------------- |
| Domain logic | `npm test` — pure, no browser, no API key, nothing spent                                |
| Types        | `npm run typecheck`                                                                     |
| UI           | `node scripts/screenshot-flow.mjs` → real Chromium, screenshots per screen              |
| Later gates  | `#preview` in dev → `src/app/DevPreview.tsx`, so gates behind the paid run stay visible |
| Test fixture | `node scripts/make-test-book.mjs` → 8-page mock scan with recurring archaic vocabulary  |

## Known gaps

- **The live API has been exercised once, not at book scale.** The request
  shape, all three offered model IDs, metadata extraction, and uncertainty
  reporting were verified against real calls; a whole-book run has not been
  done. Cost estimation was calibrated against real usage and errs high, as
  intended.
- **There is no image-editing mode.** SPEC §6 describes one — crop, straighten,
  levels, despeckle, background removal, all non-destructive over the original
  pixels. `src/core/image/engine` is that machinery, written and unwired: the
  illustration path places what it finds, and cannot yet retouch it. A foxed or
  crooked scan comes through foxed and crooked.
- **Small capitals are not real.** `headingStyle.smallCaps` sets ordinary
  capitals. The fonts do carry `smcp`, but drawing it needs glyph-level output
  rather than `drawText`, and synthesising it by scaling capitals — what cheap
  reprints do — is worse than not offering it.
- **Ligatures are switched off**, because pdf-lib writes no width for a glyph
  that answers to no code point. See `src/platform/browser/fonts.ts`.
