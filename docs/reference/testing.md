# Testing Guide

Three layers, in the order you should reach for them:

1. **Automated checks** — pure logic, no browser, no network, no spend. This is
   what CI runs and what a change has to pass.
2. **The browser harness** — drives the real app in real Chromium and
   screenshots every screen. UI work is verified here, not shipped blind.
3. **A manual paid pass** — the one thing neither of the above can do, because
   it costs money: a whole book through the vision model.

---

## 1. Automated checks

```bash
npm install
npm run format:check   # prettier
npm run lint           # eslint, whole repo
npm run typecheck      # tsc --noEmit
npm test               # vitest
npm run build          # typecheck + vite build → dist/
```

All five should pass; this is exactly what `.github/workflows/ci.yml` runs. If
you only run one thing, run `npm test`.

**No API key is needed and nothing is spent.** The vision pass is exercised
through a mock transport, so the schema, the prompt, the runner, the retry
behaviour, the verification and the cost arithmetic are all covered without a
single real request.

### What the suite actually proves

| Area               | Covered by                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The whole flow     | `wizard-steps` — the step machine and every gate's questions, with no DOM                                                                                                                                                                                                                                           |
| Reading the scan   | `hocr`, `coordinate-map`, `lexicon-build`                                                                                                                                                                                                                                                                           |
| The model pass     | `transcribe`, `transcribe-runner` — mocked transport, real schema and parsing                                                                                                                                                                                                                                       |
| Stitching the book | `assemble-book` — page seams, hyphen healing, footnote linking, front-matter dispositions                                                                                                                                                                                                                           |
| **Layout**         | `layout-break-lines`, `layout-paginate`, `layout-footnotes` — a fixed-width fake measurer, so every break is exact integer arithmetic about the engine rather than a fact about EB Garamond                                                                                                                         |
| **The real PDF**   | `layout-pdf` — generates a file, reopens it with **pdf.js** (a different library from the one that wrote it), and asserts the MediaBox is exactly the trim, the font program is embedded, the folios are drawn, the footnotes and the contents page are present, and the page count is the one the engine predicted |

That last assertion is the one that earns its keep. Everything else can pass
while the measurer and the embedder quietly disagree about how wide a word is;
when they do, the lines break differently and the page count moves.

---

## 2. The browser harness

```bash
npm run dev                        # in one shell
node scripts/screenshot-flow.mjs   # in another
```

It drives the wizard in headless Chromium against a generated 8-page test book
(`node scripts/make-test-book.mjs`), writes a screenshot per screen into
`screenshots/`, and **fails the run** if any of these is not true:

- the term grid rendered rows with real word crops beside them;
- the design summary changed when a design answer changed;
- the page preview rendered, and its **pixels** changed when a style answer
  changed (the image `src` is an object URL that changes on every regeneration
  whether or not anything moved, so it proves nothing);
- a transcription seeded into IndexedDB under the book's key is **offered back**
  at the transcribe gate rather than silently reused or silently ignored, taking
  it asks for no API key and raises no cost prompt, and it lands on the next
  gate — the store itself is round-tripped, capped, and checked for evicting the
  oldest and discarding records it cannot read;
- the export offered a PDF with a page count;
- no KDP check is still reporting `pending`;
- neither the design gate nor the export screen scrolls sideways at 390px.

Look at the PNGs. The check is a floor, not a substitute for seeing it.

Gates that sit behind the paid transcription run are reachable in development at
`#preview` (`src/app/DevPreview.tsx`), so looking at them costs nothing.

---

## 3. The manual paid pass

Only this can tell you whether the app works on a real book, and it spends real
money. Budget one short book.

1. Get a scanned public-domain PDF — the Internet Archive is the easiest source.
   Pick something short (20–60 pages) with clear chapter headings and at least a
   few footnotes, so the interesting paths are exercised.
2. `npm run dev`, drop the PDF in, and let recon finish. This part is free.
3. At the transcription gate, enter an Anthropic API key. The key is stored in
   this browser only and is sent straight to the API — there is no server to
   proxy it. **Approve the cost estimate before it runs**; the estimate errs
   high on purpose.
4. Walk the gates, then check the exported PDF against the scan:
   - every chapter starts on a right-hand page;
   - the running heads name the right chapter, and the folios run correctly;
   - **footnotes sit at the foot of the page their reference is on**, renumbered
     straight through the book;
   - **the contents page numbers match the pages the chapters actually open on**;
   - no line runs past the margin — the export screen reports these, so check it
     agrees with what you can see;
   - the page count on the export screen matches the PDF, because that number is
     what a cover spine is sized from.
5. **Print a proof.** Gutter swallow, tight margins, and light faces at print
   size only show on paper. The app reduces proof cycles; it cannot remove them
   (SPEC §10).

### What a manual pass still cannot check here

- **Junicode** is not installed by `npm install` and is not committed. Selecting
  it falls back to EB Garamond, and the preview says so. See
  `public/fonts/junicode/README.md`.
- **Illustrations** are not laid out at all yet, so an illustrated book comes
  back as text only.
- **Resuming across browsers or machines.** The transcription is saved in _this_
  browser's IndexedDB. Another browser, another machine, or a cleared site
  storage means reading — and paying for — the book again.

After the run finishes, reload the tab and re-open the same PDF. The free pass
runs again and the transcribe gate should offer the run back rather than asking
for a key. That is the one path worth checking by hand, because it is the one
that protects the money.
