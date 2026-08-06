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
  │
  ├─ GATE 1 ▸ confirm how to read it  ← orthography + term review
  │
  ├─ TRANSCRIBE  (vision model pass)
  │    per page: role + clean text + structure tags + uncertain spans
  │
  ├─ GATE 2 ▸ check uncertain spots   ← where model & OCR disagree
  ├─ GATE 3 ▸ confirm structure       ← chapters, footnotes, images
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
| Image          | `src/core/image`       | Region detection, DPI math, op engine             | no            |
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

Reopening the same book re-runs the free half and _offers_ the paid half back —
as a question at the transcribe gate, with the page count, the age and the model
attached, and the free option recommended. Taking it skips every question that
existed only to approve a charge.

The scan itself is deliberately not stored. It runs to hundreds of megabytes and
the user already has it, and asking for it back buys full fidelity: the word
crops and page thumbnails the review gates need are regenerated by the free
pass, so a resumed session is complete rather than partial. The API key is not
stored with it either — it lives in its own place and must never travel with a
book.

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
- **Illustrations are not laid out at all.** The page model has no image item,
  so a scanned book's plates do not reach the PDF. `src/core/image` holds
  region detection, DPI maths and a non-destructive op engine, and nothing
  imports any of it yet — which also makes the design interview's "heavily
  illustrated" answer a trim size and nothing more.
- **Small capitals are not real.** `headingStyle.smallCaps` sets ordinary
  capitals. The fonts do carry `smcp`, but drawing it needs glyph-level output
  rather than `drawText`, and synthesising it by scaling capitals — what cheap
  reprints do — is worse than not offering it.
- **Ligatures are switched off**, because pdf-lib writes no width for a glyph
  that answers to no code point. See `src/platform/browser/fonts.ts`.
