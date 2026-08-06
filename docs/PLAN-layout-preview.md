# Plan: real page layout, live preview, and a PDF that isn't a `.tex`

Status: **steps 1–7 built and verified; step 8 remains.** Written for a fresh
session to pick up, then revised twice — once after checking what exists on npm,
and again after building it, which contradicted two of the decisions below. Both
corrections are recorded in "What building it changed", at the end.

## Why

Two complaints, one root cause:

> "I'm not really sure what to do with that latex file once I have it."
> "I need to be able to see all of these formatting and style options render
> before I can hit accept on anything."

The design gate _describes_ a style in prose and the export emits LaTeX source.
Nothing between them ever renders a page. So the gate can't be judged and the
output can't be used. Both are the same missing piece: **there is no layout
engine.**

## The idea (unchanged, and it survived scrutiny)

One layout pass owns everything.

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

**The preview is the PDF.** Not a CSS approximation — the actual bytes,
rendered by pdf.js, which this app already uses to read scans. One renderer, so
preview and output cannot drift.

The alternative considered and rejected again: render the preview to canvas
directly and skip the PDF round-trip. Faster, but it reintroduces a second
renderer and with it the possibility that what you approve isn't what ships.
The round-trip is the feature.

## What changed after checking npm

### 1. Don't write the line breaker — TeX's algorithm is on npm

`tex-linebreak` (0.9.0, zero dependencies) is a Knuth–Plass implementation.
`hypher` (0.2.5) + `hyphenation.en-us` (0.2.1, 44 KB) are Liang's patterns —
the same ones TeX uses.

This deletes two of the four worries outright. v1 of this plan had "greedy line
breaking, Knuth–Plass as a distant upgrade" and "budget for hyphenation." Both
are now a dependency choice made on day one, at TeX quality.

The one consequence to absorb up front: Knuth–Plass consumes text as a stream
of **boxes, glue and penalties**, not "words and widths." `break-lines.ts` must
be built around that shape from the start — retrofitting it later means
rewriting the module.

### 2. `@fontsource` is the wrong font source and would have blocked step 1

`@fontsource/*` ships **only WOFF and WOFF2** — verified, zero `.ttf`/`.otf` in
the package. pdf-lib + fontkit cannot embed those, so the whole export path
would have died on the first font.

Use **`@expo-google-fonts/*`**, which ships real `.ttf`. All six of the Google
families are there. Measured, regular + italic:

| Family            |        Size |
| ----------------- | ----------: |
| EB Garamond       |       912 K |
| Cardo             |       636 K |
| IM FELL English   |       384 K |
| Libre Baskerville |       232 K |
| Crimson Pro       |       216 K |
| Libre Caslon Text |       192 K |
| **six families**  | **~2.5 MB** |

That is far cheaper than feared, so bundling all of them is comfortably the
right call. Still load them **in the background after first paint** rather than
blocking it — this app already asks for ~23 MB of OCR assets on first use.

**Junicode is on neither registry** (it isn't a Google font). Vendor the `.ttf`
from its GitHub release into `public/fonts/` with `OFL.txt` beside it. It is
the one face chosen for archaic glyphs, so it is worth the manual step.

### 3. Small caps are real, and better than v1 assumed

v1 said small caps "cannot be faked — drop them where the family lacks an SC
face." Wrong on the facts: EB Garamond's TTF advertises `smcp`, `c2sc` and
`hist` (historical forms). Verified glyph coverage on the same file:

```
long-s ſ  YES     æ  YES     œ  YES     †  YES     —  YES     ¹  YES     ﬅ  YES
```

So the archaic characters these books need are present, and real small caps
exist. The catch is on the drawing side: **pdf-lib's `drawText` applies only
default OpenType features**, so `smcp` needs fontkit's `layout(text, ['smcp'])`
and drawing the resulting **glyph IDs** rather than a string. That is a
known-cost decision, not a blocker — see the open question at the end.

## The four concerns, triaged

The question was whether to work through them before continuing. Two are
**decisions**, now made at no cost. Two are **constraints on the API shape** —
they do not need building first, but `paginate.ts` must be _shaped_ for them or
it gets rewritten later.

| Concern          | Verdict                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Line quality     | **Decided.** `tex-linebreak`. Model text as boxes/glue/penalties from the start.                                 |
| Hyphenation      | **Decided.** `hypher` + `hyphenation.en-us`, wired in as penalties.                                              |
| Footnotes        | **Constraint.** Build later — but make pagination re-runnable against a constraint, never a single forward pass. |
| TOC page numbers | **Constraint.** Build later — but keep `layout()` a pure function of its inputs so it can simply be run twice.   |

Concretely, the constraint both circular problems impose is the same one:

```ts
// Pure, re-runnable, no hidden state. Both the footnote re-flow and the
// two-pass TOC are then just "call it again with different inputs".
export function layout(doc: BookDocument, style: StyleProfile, m: TextMeasurer): LaidOutPage[]
```

Footnotes are circular because a note's height reduces the space for body
lines, which moves the reference, which changes the notes on the page. Reserve
space as lines are placed, then re-flow once; if two passes don't converge,
push the note to the next page. Endnotes are the honest fallback.

The TOC is circular because page numbers exist only after layout, and inserting
TOC pages shifts them. Lay out, collect chapter pages, insert, lay out again.
Two iterations is standard and enough.

**So: no, don't stop and build all four.** The two decisions are made above. The
two constraints cost nothing today and everything if ignored.

## Modules

Follows the existing `core` (pure) / `platform` (browser) split.

### `src/core/layout/` — pure, no DOM

| File             | Contains                                                                     |
| ---------------- | ---------------------------------------------------------------------------- |
| `types.ts`       | `LaidOutPage`, `PositionedLine`, `TextRun`, `PageFrame`                      |
| `measure.ts`     | `TextMeasurer` interface — injectable, so tests need no fonts                |
| `frames.ts`      | trim + margins + gutter → text-block rect, mirrored for verso/recto          |
| `break-lines.ts` | boxes/glue/penalties → `tex-linebreak` → justified lines                     |
| `paginate.ts`    | flow blocks into frames; running heads, folios, widows/orphans, recto starts |

`TextMeasurer` is the seam that keeps the core pure:

```ts
export interface TextMeasurer {
  widthOf(text: string, font: FontRef, sizePt: number): number
  metrics(font: FontRef, sizePt: number): { ascent: number; descent: number; lineGap: number }
}
```

Tests inject a fake with fixed-width glyphs, so breaks are exact integers and
assertions are deterministic.

### `src/platform/browser/`

| File         | Contains                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------- |
| `fonts.ts`   | load TTF bytes once; expose a fontkit `TextMeasurer` **and** the same bytes for embedding |
| `pdf-out.ts` | `LaidOutPage[]` → pdf-lib document → `Uint8Array`                                         |
| `preview.ts` | sample pages → small PDF → pdf.js → canvas                                                |

Measure with fontkit's `layout()` — **the same call pdf-lib uses internally to
encode text.** Kerning and ligatures are then identical by construction, which
is what makes the preview trustworthy. Measuring with one engine and drawing
with another is exactly how WYSIWYG breaks.

pdf-lib needs `@pdf-lib/fontkit` and `registerFontkit()` before `embedFont`
will take a custom face. Embed with `{ subset: true }`: it keeps the export
small and makes the 4-page preview fast, since a sample touches few glyphs.
`pdf-lib` is currently a **dev** dependency; promote it.

### `src/app/`

- `PreviewPane.tsx` — page spreads, live, at the design gate.
- Design step gains the preview; export step downloads a real PDF.

Regenerate the preview only when the style actually changes, and debounce it.
Radio buttons, not keystrokes, so a few hundred milliseconds is fine.

## What this retires

Once the PDF path is trusted:

- `src/core/typeset/latex-document.ts`, `emit-body.ts`, `escape.ts`
- `src/core/export/tex-engine.ts` — that seam exists only because there was no
  way to make a PDF. There will be.
- The `.tex` download.

**Done** — all of it is gone, along with `resources/` and the Windows toolchain
script that only existed to feed XeLaTeX. `kdp-validate.ts` stayed, and got
_better_: after real layout the page count is measured rather than estimated,
and the two `pending` checks report the truth.

## Testing

- **Pure layout**: fake measurer; deterministic assertions on line breaks, page
  breaks, widow/orphan handling, recto chapter starts.
- **Real output**: generate a PDF, reopen it with pdf.js, assert the MediaBox is
  exactly the trim (6×9in = 432×648pt), fonts are embedded, and the page count
  matches what layout predicted. That last assertion is the one that catches
  measurement drift.
- **Browser harness**: extend `scripts/screenshot-flow.mjs` to screenshot the
  preview and assert it changes when a style answer changes — the same check
  already used for the design summary.

## Sequence

Each step leaves the app working.

1. ~~Fonts + fontkit measurer. Proof: one page of real text as a downloadable
   PDF whose MediaBox is exactly 6×9in.~~ **Done** — asserted in
   `test/layout-pdf.test.ts` by reopening the output with pdf.js.
2. ~~`tex-linebreak` + hyphenation over body prose; pagination. Export switches
   to PDF.~~ **Done.**
3. ~~Preview pane at the design gate (sample pages).~~ **Done** — and it shows
   the title page, the chapter opener and the body pages rather than the first
   four leaves, which in a real book are mostly half-title and blanks and answer
   none of the gate's questions.
4. ~~Front matter, running heads, folios.~~ **Done.**
5. ~~Chapter openers, drop caps, ornaments — these become line-box arithmetic
   (an initial spanning N lines, with those N lines indented), not LaTeX
   macros.~~ **Done**, exactly as line-box arithmetic — including the ornaments,
   which claim whole baseline slots so the text below moves down rather than
   being overprinted. The `.svg` files under `resources/` became vector path
   data in `src/core/ornament`: one source, drawn by `drawSvgPath`, with nothing
   on disk that can disagree with it.
6. ~~Footnotes (the reserve-and-re-flow loop).~~ **Done — and the re-flow was
   not needed.** Reserving as lines are placed only ever shrinks the body, so a
   line whose reference pulls in a new note either fits or moves to the next
   page; a single forward pass settles it. See "What building it changed".
7. ~~TOC with measured page numbers (the second pass).~~ **Done**, in two passes
   that provably converge — the folio sits in a fixed-width column, so the
   contents' length is decided by the titles and cannot move when the numbers
   are filled in.
8. ~~Delete the LaTeX path. Turn the two `pending` KDP checks into real ones.~~
   **Done.** The page count is measured and the engine reports overfull lines,
   so both checks report the truth.

   The `.tex` was held back until the PDF path was a superset of it. The last
   gap — the LaTeX emitter collected notes with no reference mark at the end of
   the book — is closed: `orphanNotes: 'collect'` appends a "Notes" section after
   the body, listed in the contents, each note keeping its original printed
   marker. Then the whole path went.

9. **Move the identity questions to where they can be answered.** Gate 1 asked
   for the title, the author and the year before anything had read the title
   page, so all three came up blank — on a phone, a trip out of the browser to
   go and look. They are asked at the export gate now, prefilled from what the
   vision pass read, with the scan of the title page beside them. **Done.**

10. **Illustrations.** The page model still has no image item, so an illustrated
    book cannot place its plates. Deferred until there is a real illustrated PDF
    to work against — the only remaining item.

## Decisions taken

### Small caps: not in v1, and never faked

Real `smcp` needs glyph-level drawing (`fontkit.layout(text, ['smcp'])` then
emitting glyph IDs, rather than `drawText`). Ruled out for the first version:
nice to have, not worth a lower-level drawing path and its spacing risks while
the rest of the engine is new.

So `headingStyle.smallCaps` renders as ordinary capitals — or italics, if that
reads better at chapter openings — and the interview copy should stop promising
small caps until they exist.

**Do not synthesise them by scaling capitals.** That is what cheap reprints do
and it reads as wrong even to people who cannot say why. Better to not offer the
look than to offer a poor version of it. Revisit once pagination is trusted; the
fonts do carry the real feature, so nothing is lost by waiting.

### Junicode: vendored by hand

Being fetched from https://github.com/psb1558/Junicode-font (Releases) and
dropped into `public/fonts/junicode/` — static Regular + Italic, **not** the
variable-font build, plus `OFL.txt`, which must travel with it since this repo
redistributes it publicly.

Filenames are whatever the release ships; read them off the directory rather
than hard-coding a guess.

**Expect it to be large.** Junicode's whole purpose is enormous glyph coverage
for medieval scholarship, so it may outweigh the other six combined. If it does,
load it on demand when the user actually selects it, rather than bundling it
with the rest — the other six stay eagerly loaded, so switching between them
remains instant.

## What building it changed

Two of the decisions above were wrong, and only rendering the output caught
them. Both are documented at the code, with the evidence.

### Fonts must be embedded whole, not subset

"Embed with `{ subset: true }`: it keeps the export small" was a mistake.
pdf-lib 1.17.1's subsetter silently corrupts the `glyf`/`loca` tables of three
of the six faces this app offers. Rendered side by side against an unsubset
embed of the same text:

| Face                                         | Subset               |
| -------------------------------------------- | -------------------- |
| EB Garamond, Cardo, IM FELL English          | most letters missing |
| Libre Baskerville, Libre Caslon, Crimson Pro | correct              |

What makes this the worst kind of bug is where it _isn't_ visible: the page
count is right, `getTextContent` extracts the text perfectly (the `ToUnicode`
map survives), and every KDP check passes. Only the printed page is wrong. The
cost of embedding whole is about 900 KB for a regular/italic pair.

Subsetting only the faces that survive it was rejected: correctness would then
depend on which typeface the user picked, and a font update could move a face
from one column to the other without anything failing loudly.

### Ligatures have to be off

The whole-font embedder builds its width array by walking the font's _character
set_ and taking the glyph for each code point. A ligature glyph — `f_i` —
answers to no single code point, so no width is ever written for it and the
reader falls back to a full em. On the page that is a hole after every "fi" and
every following word shoved right: `his fi ndingsto the assembled`.

So `LAYOUT_FEATURES` in `fonts.ts` turns `liga`/`dlig`/`hlig`/`clig`/`rlig` off,
and the same constant is passed to `embedFont`. It must be shared: the measurer
and the embedder disagreeing about the width of a word is precisely the drift
this whole design exists to prevent.

This is worth revisiting. A patched or forked embedder that writes widths for
every glyph actually laid out would give back real `fi` and `fl`, which a book
face is drawn to use.

### Footnote marks cannot be Unicode superscripts

The obvious way to set a reference mark is the Unicode superscript digits, which
need no special drawing at all. **IM FELL English carries ¹²³ and none of
⁰⁴⁵⁶⁷⁸⁹** — and it is the face this app _recommends_ for 17th-century books, so
any note past the third would have drawn as a missing glyph in the single most
likely configuration. Every other bundled face has all ten, which is exactly how
this would have shipped unnoticed.

So marks are synthesised: a smaller glyph lifted off the baseline. That needs
the line breaker to carry a span set differently from the text around it
(`Attachment`), because the mark occupies width and a breaker that did not know
about it would set every line carrying one fractionally too long.

The same mechanism is what small capitals would need, if they are ever done
properly.

### Two smaller things

- `breakLines` reads `lineLengths[i]` per line and does **not** clamp. Handing
  it the ergonomic four-entry array a drop cap wants (`[narrow, narrow, narrow,
full]`) made every paragraph past the fourth line vanish _silently_.
  `padLineWidths` now extends any array to the item count, which is a hard upper
  bound on the number of lines.
- Junicode could not be vendored: this sandbox cannot reach GitHub. It loads on
  demand from `public/fonts/junicode/`, substitutes EB Garamond when absent, and
  says so in the preview rather than quietly showing a different typeface. The
  manual step is written up in `public/fonts/junicode/README.md`.

## Open questions for the next session

- **Memory on a 300-page export.** A text-only PDF is small, but pdf-lib builds
  in memory and images land later. The page loop yields to the event loop
  between pages and reports progress, but it has only been run on short books.
- **Ligatures**, as above.

## Context worth carrying over

- `BookDocument` (`src/core/assemble`) is the input: `blocks`, `footnotes`,
  `chapters`, `asides`, `skipped`.
- `StyleProfile` (`src/core/model/types.ts`) already carries trim, margins,
  gutter, fonts, `headingStyle`, `runningHeads`, `dropCap`, `ornaments`.
- `profileFromAnswers()` (`src/core/design`) turns the five interview answers
  into that profile — the preview should render from its live output, exactly as
  the summary line does today.
- Path aliases are `@core` and `@platform`, defined in `tsconfig.json`,
  `vite.config.ts` and `vitest.config.ts` — update all three together.
- CI runs `eslint .`, not `eslint src test`. Run `npm run lint`.
