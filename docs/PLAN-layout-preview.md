# Plan: real page layout, live preview, and a PDF that isn't a `.tex`

Status: **planned, not started.** Written for a fresh session to pick up.

## Why

Two complaints, one root cause:

> "I'm not really sure what to do with that latex file once I have it."
> "I need to be able to see all of these formatting and style options render
> before I can hit accept on anything."

The design gate _describes_ a style in prose and the export emits LaTeX source.
Nothing between them ever renders a page. So the gate can't be judged and the
output can't be used. Both are the same missing piece: **there is no layout
engine.**

## The idea

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

**The preview is the PDF.** Not a CSS approximation of it — the actual bytes,
rendered by pdf.js, which this app already uses for reading scans. There is no
second renderer, so preview and output cannot drift. That is the whole point.

For speed the preview lays out a _sample_ (title page, a chapter opening, a
dense body spread) into a ~4-page PDF on every style change. The export runs
the identical code over the whole book.

## Decisions already made

- **Own paginator → pdf-lib.** Not browser Print-to-PDF: on iPad Safari the
  print sheet controls paper size and margins, so exact trim and font embedding
  — the two things KDP actually checks — aren't guaranteed.
- **Bundle all seven faces** up front so switching typefaces in the preview is
  instant.
- **Stays in the browser.** No server, no CDN at runtime.

## Blocker to resolve first

**Junicode is not on npm.** The other six are (`@fontsource/*` v5.3.0:
`eb-garamond`, `libre-baskerville`, `libre-caslon-text`, `crimson-pro`,
`cardo`, `im-fell-english`). Junicode is the one face chosen for archaic
glyphs and long-s, so it matters for exactly the books this tool targets.

Options, in order of preference:

1. Vendor the `.ttf` from the Junicode GitHub release into `public/fonts/`
   (OFL permits redistribution; keep `OFL.txt` beside it).
2. Replace it with another OFL face with wide archaic coverage.
3. Drop to six and say so in the interview copy.

## Modules

Follows the existing `core` (pure) / `platform` (browser) split.

### `src/core/layout/` — pure, no DOM

| File             | Contains                                                             |
| ---------------- | -------------------------------------------------------------------- |
| `types.ts`       | `LaidOutPage`, `PositionedLine`, `TextRun`, `PageFrame`              |
| `measure.ts`     | `TextMeasurer` interface — injectable, so tests need no fonts        |
| `frames.ts`      | trim + margins + gutter → text-block rect, mirrored for verso/recto  |
| `break-lines.ts` | line breaking + justification                                        |
| `paginate.ts`    | flow blocks into frames; running heads, folios, widow/orphan control |

`TextMeasurer` is the seam that keeps the core pure:

```ts
export interface TextMeasurer {
  widthOf(text: string, font: FontRef, sizePt: number): number
  metrics(font: FontRef, sizePt: number): { ascent: number; descent: number; lineGap: number }
}
```

Tests inject a fake with fixed-width glyphs, so line and page breaks are exact
integers and assertions are deterministic.

### `src/platform/browser/`

| File         | Contains                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `fonts.ts`   | load font bytes once; expose a fontkit-backed `TextMeasurer` **and** the same bytes for embedding |
| `pdf-out.ts` | `LaidOutPage[]` → pdf-lib document → `Uint8Array`                                                 |
| `preview.ts` | sample pages → small PDF → pdf.js → canvas                                                        |

One font file serves both measurement and embedding. That single fact is what
makes the preview trustworthy — measuring with one source and embedding another
is how WYSIWYG breaks.

`pdf-lib` needs `@pdf-lib/fontkit` (v1.1.1, available) and
`pdfDoc.registerFontkit(fontkit)` before `embedFont` will take a custom face.
`pdf-lib` is currently a **dev** dependency; promote it.

### `src/app/`

- `PreviewPane.tsx` — page spreads, live, at the design gate.
- Design step gains the preview; export step downloads a real PDF.

## The hard parts (do not discover these late)

- **Footnotes are circular.** A note's height reduces the space for body lines,
  which changes where the reference lands, which changes the notes on the page.
  Plan: reserve space as lines are placed, then one re-flow pass; if it doesn't
  converge in two passes, push the note to the next page. Endnotes are the
  honest fallback.
- **The TOC needs two passes.** Real page numbers are only known after layout,
  and inserting TOC pages shifts them. Lay out, collect chapter pages, insert,
  lay out again. Two iterations is standard and enough.
- **Greedy line breaking is visibly worse than TeX.** Start greedy, measure the
  result, and treat Knuth–Plass as the upgrade path — not a prerequisite.
- **Without hyphenation, justified text on a 5.5in measure gets rivers.** TeX's
  `en-us` Liang patterns are small and public domain; budget for them.
- **Small caps.** Most of these families ship no true SC face. Synthesising by
  scaling capitals looks cheap. Either use the real SC variants where they exist
  (EB Garamond has one) or drop small caps for families that lack it — do not
  fake it silently.
- **Drop caps and ornaments now need real geometry**, not LaTeX macros. The
  `\lettrine` and `\chapterornament` logic in `emit-body.ts` becomes line-box
  arithmetic: an initial spanning N lines, with the first N lines indented.
- **Memory.** A text-only 300-page PDF is small, but `pdf-lib` builds in memory
  and images will land later. Keep the page loop streaming-friendly.

## What this retires

Once the PDF path is trusted:

- `src/core/typeset/latex-document.ts`, `emit-body.ts`, `escape.ts`
- `src/core/export/tex-engine.ts` — the `TexEngine` seam exists only because
  there was no way to make a PDF. There will be.
- The `.tex` download

Keep `.tex` as a secondary "advanced" download during the transition so there
is always a working path out, then delete it. Do not delete
`kdp-validate.ts` — it gets _better_, because after real layout the page count
is measured rather than estimated, and the two `pending` checks become real.

## Testing

- **Pure layout**: fake measurer, deterministic assertions on line breaks, page
  breaks, widow/orphan handling, recto chapter starts.
- **Real output**: generate a PDF, reopen it with pdf.js, assert the MediaBox is
  exactly the trim (6×9in = 432×648pt), fonts are embedded, page count matches
  what layout predicted.
- **Browser harness**: extend `scripts/screenshot-flow.mjs` to screenshot the
  preview pane and assert it changes when a style answer changes — the same
  check already used for the design summary.

## Sequence

Each step leaves the app working.

1. Fonts + fontkit measurer. Proof: one page of real text as a downloadable PDF.
2. Line breaking + pagination for body prose. Export switches to PDF.
3. Preview pane at the design gate (sample pages).
4. Front matter, running heads, folios.
5. Chapter openers, drop caps, ornaments.
6. Footnotes.
7. TOC with measured page numbers.
8. Delete the LaTeX path; turn the two `pending` KDP checks into real ones.

## Context worth carrying over

- `BookDocument` (`src/core/assemble`) is the input: `blocks`, `footnotes`,
  `chapters`, `asides`, `skipped`.
- `StyleProfile` (`src/core/model/types.ts`) already carries trim, margins,
  gutter, fonts, `headingStyle`, `runningHeads`, `dropCap`, `ornaments`.
- `profileFromAnswers()` (`src/core/design`) turns the five interview answers
  into that profile — the preview should render from its live output, exactly
  as the summary line does today.
- Path aliases are `@core` and `@platform`, defined in `tsconfig.json`,
  `vite.config.ts` and `vitest.config.ts` — update all three together.
- CI runs `eslint .`, not `eslint src test`. Run `npm run lint`.
