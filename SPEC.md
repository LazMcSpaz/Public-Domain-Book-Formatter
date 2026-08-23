# Public-Domain Book Reprint Tool — Project Spec

> ## Read this first: parts of this document are superseded
>
> This is the **original** design, written before the app was rebuilt to run in
> the browser. It is kept because its _goals_, its philosophy, and its honest
> account of the labour involved (§1, §4's trust tiers, §7, §10, §11) still
> describe what is being built. Its _architecture_ does not.
>
> What changed, and where the current description lives:
>
> | This spec says                                   | Actually                                                                                                                                           |
> | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Electron desktop app, Windows install wizard     | A browser app. No shell, no installer, no system dependencies.                                                                                     |
> | Tesseract / OCRmyPDF / pdftoppm binaries         | `tesseract.js` and PDF.js, in the tab.                                                                                                             |
> | Pandoc → Markdown → XeLaTeX → PDF                | A layout engine in `src/core/layout` and pdf-lib. No TeX anywhere.                                                                                 |
> | Cleanup heuristics over OCR text (§3)            | A vision model reads the page against the scan and returns typed structure. OCR stays as the independent witness and the source of bounding boxes. |
> | Review as a side-by-side reading instrument (§4) | An interview: the app runs unattended and stops at gates, with the evidence attached. The side-by-side instrument was not built.                   |
>
> **Current, accurate documents:** [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
> for the flow and module map, [`README.md`](./README.md) for what works today
> and what does not, [`CLAUDE.md`](./CLAUDE.md) for the conventions.
>
> §12's build sequence and §13's settled decisions are both superseded; see the
> notes at each.

A Windows desktop application that turns public-domain book PDFs (including old scans) into print-ready KDP interiors. The tool automates the bulk of OCR, cleanup, and typesetting, then gives the user a comfortable review surface to bring output to publishable quality.

**Design philosophy:** Automate the easy 80%. Make the human override of the hard 20% fast, pleasant, and non-destructive. Never dress up a heuristic as if it were a guarantee.

_(The philosophy above is unchanged and still governs. The application shell
described below is not what was built.)_

---

## 1. Goals & Non-Goals

### Goals

- Convert scanned or text-based public-domain PDFs into clean, reflowable, print-quality book interiors.
- Target Kindle Direct Publishing (KDP) print specs out of the box.
- Provide a full-book side-by-side reading/proofing instrument as the centerpiece of review.
- Make structural markup (footnotes, verse, headings, etc.) a fast point-and-tag operation.
- Support a real image-editing workflow for embedded illustrations.
- Allow deep customization of the book's look, with reusable saved styles for series coherence.
- Install via a Windows wizard. No command line required.

### Non-Goals (handled externally by the user)

- ~~**Book covers** — out of scope. _But the tool must report final page count, which the user needs for spine-width math._~~ — **reversed.** The carve-out was the argument: the page count _is_ the spine, this app is the only thing that knows it, and the old answer was to print the number on a screen and send the user elsewhere with it in their head. Everything else a cover needs was already here — the trim, the title and author read off the original title page, plates cut at render resolution, the ornament library, six embeddable faces and the DPI rule. See [`docs/PLAN-cover.md`](./docs/PLAN-cover.md).
- **Public-domain status verification** — out of scope. The user verifies this elsewhere.
- **Index regeneration** — templated structure available but optional/low-priority; recreating old indexes is rarely worth it.

---

## 2. Architecture Overview

> **Superseded in full.** No Electron, no installer, no system binaries. The
> browser does all of it. The one part of this section that survived intact is
> the hOCR coordinate mapping below, which is still the backbone and still
> exists at `src/core/model/coordinate-map.ts`.

### Application shell

- **Electron** desktop app (HTML/CSS/JS in a desktop shell). Chosen because the linked side-by-side panes, hover/scroll sync, live preview, and in-app image editor are exactly what web UI tech does well.
- **Windows install wizard** bundling the app and its system dependencies.

### Tool chain (existing, mature tools — not custom-built)

These do ~90% of the raw capability. They are better than anything written from scratch.

- **Tesseract** — OCR engine. Exposes per-word/per-character confidence scores via hOCR/TSV output. Also provides bounding-box coordinates for every word.
- **OCRmyPDF** — wraps Tesseract; handles deskew and preprocessing.
- **Pandoc** — Markdown → LaTeX conversion.
- **XeLaTeX (TeX Live)** — the typesetter. Chosen over plain LaTeX so any system/OpenType font can be used. Embeds fonts by default; nails trim size via the `geometry` package; handles running heads via `fancyhdr`; sets footnotes, TOC, and ornaments cleanly.

> **System-dependency note:** Tesseract, Pandoc, and TeX Live are system-level installs, not Python/JS packages. The install wizard must install or verify all three. Docker is a possible later convenience to bake these in, but not required for v1.

### The backbone: hOCR coordinate mapping

The single most important internal structure. Every OCR'd word retains:

- its **bounding-box coordinates** in the source PDF,
- its **position** in the cleaned/formatted output,
- its **OCR confidence score**.

This mapping powers hover-sync, scroll-sync, click-to-jump, confidence tinting, source-image-on-hover, and image-region handling. **Build it deliberately and early** — retrofitting it later is painful.

---

## 3. Processing Pipeline

```
Source PDF
   │
   ├─ Extract pages (pdftoppm / pdfimages)
   │
   ├─ OCR (Tesseract via OCRmyPDF) → text + per-word confidence + bounding boxes (hOCR)
   │
   ├─ Detect image regions → extract candidate illustrations (best-guess, low trust)
   │
   ├─ Cleanup layer (custom) → de-hyphenation, ligature fixes, header/footer strip,
   │                            OCR-confusion correction, paragraph reflow
   │                            (emits heuristic "this was touched" flags)
   │
   ├─ Structure detection → candidate chapter/heading marks (confirmable in review)
   │
   ├─ Intermediate format: Markdown (human-readable, hand-tweakable)
   │
   ├─ REVIEW (the human stage — see §4)
   │
   ├─ Typeset: Pandoc → XeLaTeX → PDF
   │
   └─ KDP export validation → print-ready interior PDF
```

---

## 4. The Review Instrument (centerpiece)

The side-by-side view is a **full-book reading instrument first, a correction instrument second.** The user reads the entire formatted book against the source, start to finish. Flags and confidence tints are aids layered over a fundamentally comfortable read — not the point of the view.

### Reading experience (must be comfortable for hours)

- **Linked side-by-side panes:** source on one side, formatted output on the other.
- **Hover-sync:** hovering a passage highlights it and its counterpart on the other side, so eyes don't lose their place moving between texts.
- **Scroll-sync:** scrolling one pane tracks the other, so a long read never drifts apart. _As important as hover-sync for whole-book reading._
- **Reading-comfort typography in the panes:** adjustable font size, line spacing, line length, and pane widths — independent of the book's final typesetting.
- **Toggleable confidence tinting:** off by default for clean reading; flip on to see the map of low-confidence/flagged areas. Aggressive tinting all the time would be visual noise over a multi-hour read.

### Correction tools (layered over the read)

- **Inline editing** in the output pane — fix errors while looking at the source; edits feed back before the LaTeX step.
- **Source-image-on-hover** — show the actual cropped scan pixels of a word/region. For ambiguous OCR, the original pixels resolve "is that an l or a 1" better than text-to-text. _Core for a scan workflow._
- **Jump-to-next-flag** — skip to the next low-confidence word or heuristic flag; spot-fixing accelerator.
- **Per-book find-replace dictionary** — save a replacement rule once (a character that always OCRs wrong, an archaic spelling to normalize or preserve) and apply throughout. Big time-saver on long books.
- **Suspicious-character flagging** — catch systematic special-character issues (long-s → f, ligatures, em-dash vs hyphen, old-style quotes).

### Confidence & flags — honest tiers

| Source              | Type                                      | Trust                           |
| ------------------- | ----------------------------------------- | ------------------------------- |
| OCR text            | True engine confidence (0–100)            | Real probability                |
| Cleanup layer       | "This was touched / aggressively changed" | Heuristic flag, labeled as such |
| Structure detection | "Probably a heading"                      | Heuristic flag                  |
| LaTeX typesetting   | Overfull-box / bad-break warnings         | Surfaced as quality flags       |

The review report has **one column of real numbers (OCR)** and several columns of **honest heuristic flags.** Heuristics are never presented as probabilities.

---

## 5. Structural Tagging (right-click semantic markup)

The primary tool for the messiest manual labor. In the side-by-side view, the user **selects a passage → right-clicks → assigns what it is.** The tool re-typesets that type correctly in LaTeX. One interaction for every structural oddity, done as a pass during the read-through already happening.

**Taggable types:** footnote, block quote, verse/poetry, chapter heading, table, epigraph, caption, front-matter element.

- **Footnote tag** does two jobs: pulls the text out of the body flow _and_ re-links it to its in-text reference mark, so XeLaTeX sets it properly at the page bottom. Replaces the cut-and-paste-elsewhere pain with one click.
- **Heading confirmation** feeds the auto-generated TOC (see §7).
- Non-prose types (verse, tables, epigraphs) get correct structural typesetting instead of being mangled by prose-reflow logic.

---

## 6. Image Handling & Editing

Automated extraction from old scans is **unreliable** — so the design treats auto-extraction as a _first guess_ and makes manual editing the real tool.

### Detection (low trust)

- Layout analysis flags candidate image regions and rough-crops them, so the user isn't hunting for illustrations. A marker is left in the text flow where each belongs.

### Image-editing mode (the real instrument)

Entered from the review view when the user hits an image. Opens the illustration **from the original full-resolution source pixels** (never a downsized preview), so print stays sharp. **Non-destructive:** edits are stored and can always be re-derived from the original.

**Reliable operations (just work):**

- Crop, rotate, straighten.
- Sharpness, blur, contrast, brightness, levels/curves — slider-driven, real-time preview.
- Grayscale / threshold conversion — crisp output for line art and engravings.
- Despeckle / scan-noise & foxing cleanup.
- Re-pull original region at full resolution.

**Best-effort (honest about limits):**

- **Smart-wand / background removal** — reliable on clean uniform backgrounds (black line art on cream paper, common in old books), unreliable on busy or unevenly-lit scans. Offered with a tolerance slider and always with manual touch-up of the selection. Framed as an accelerator, not magic.

### Placement & print quality

- Confirm/adjust placement in the text flow.
- **DPI awareness:** show effective DPI at placed size; warn if an image is scaled past what its source resolution supports (KDP wants ~300 DPI). Prevents beautiful-on-screen art printing muddy. Folds into export validation.

**Image flow end to end:** auto-detect candidates (low trust) → review/accept/reject regions → per-image editing mode (reliable tools + best-effort background removal, non-destructive, full-res) → DPI-aware placement → export validation.

---

## 7. Templates & Style System

Templates are **starting points, not fixed forms.** Every visual element is tweakable, and a configured look can be **saved and reused** for series/imprint coherence.

### Two-level separation

- **Per-book config** — content-specific, unique per book: ISBN, title, edition date, chapter structure, image edits, find-replace dictionary. Never reused.
- **Saved style profile** — the reusable _look_, divorced from content: trim size, margins, gutter rules, body font/size, heading fonts/styling, running-head layout, page-number treatment, ornament choices and placement, front-matter visual design. Banked once, applied across books.

### Three states

1. **Shipped defaults** — tasteful starting points so day one isn't a blank page.
2. **User tweaks** — full control over every element.
3. **Saved profiles** — banked looks, applied across books and series.

**Workflow:** load a saved profile → new book inherits the full style → pour in content. Book two in a series already looks right; setup time drops sharply after the first volume.

### Templated front/back matter

- **Copyright / edition info page** — ISBN, publication date, edition statement, imprint. Fill-in fields, saved into the profile.
- **Title page** — templated, customizable.
- **Table of contents** — **auto-generated** from detected/confirmed chapter headings, with correct _edition_ page numbers. The original scanned TOC (with wrong page numbers) is discarded.
- **Index** — templated structure available but optional/low-priority.

---

## 8. Polish / Ornament Layer

Where XeLaTeX shines and Google Docs can't compete. Gives books a real-edition feel.

- **Running heads** via `fancyhdr` — verso/recto aware (e.g., chapter title on the left page, book title on the right), auto-pulling the current chapter title, flipping sides correctly as pages turn. Set once in the profile, propagates through the book.
- **Decorative flourishes** — page-number ornaments, rules, section dividers, chapter-opener art, in the printer's-ornament / fleuron tradition (period-appropriate for old public-domain books).
- **Reusable ornament library** shipped with the tool as print-ready vector files. A tasteful starter set authored as part of the build so it's usable day one.
- **User-uploadable ornaments**, with a mark for "repeats across the book" (page-number decoration) vs. "once per chapter" (chapter opener).
- **SVG → print-ready PDF conversion note:** XeLaTeX embeds vector PDF most reliably; the tool converts uploaded SVGs to PDF on import. Shipped library best authored as / converted to vector PDF under the hood. Budget for this small conversion step.

---

## 9. Project Save / Resume

Books are long; work spans multiple sittings.

- **Save/resume edit state:** edits, confirmed flags, tags, image edits, config.
- **Reading-progress persistence:** where the user left off in the read-through, and which pages are marked "reviewed/approved" — giving a full proofing pass a sense of completion. (Distinct from edit state: this is reading position.)

---

## 10. KDP Export Validation

Before upload, validate the final interior PDF against KDP realities:

- Embedded fonts present.
- Correct trim size.
- Adequate gutter for the final page count.
- Image DPI sufficient at placed sizes (~300 DPI).
- Surfaced LaTeX warnings (overfull boxes / bad breaks) resolved or acknowledged.
- **Report final page count** (input for the user's externally-made cover spine).

> **Physical proof reality:** Even a perfect digital file needs at least one physical KDP proof copy — gutter swallow, tight margins, light fonts at print size, muddy images only show on paper. The tool reduces proof cycles via DPI warnings and validation but cannot eliminate the physical proof loop.

---

## 11. Anticipated Labor (set expectations honestly)

OCR and formatting _feel_ hard but are largely tool-solved. The labor that actually fills time is structural:

- **Front/back matter** — discard wrong original TOC/index, author new title + copyright pages.
- **Footnotes/endnotes** — reconnect notes to references (mitigated by right-click tagging).
- **Non-prose passages** — verse, tables, plays, marginalia need structural tagging.
- **Special characters / archaic typography** — long-s, ligatures, accents, dashes, old quotes (mitigated by find-replace dictionary + suspicious-character flags).
- **Proofreading pass** — the last 1–2% OCR can't nail; guided by confidence tinting and jump-to-flag.
- **Physical proof iteration** — at least one per book.

---

## 12. Build Sequence

> **Superseded.** This sequence was written for the Electron design. The browser
> app was built in a different order and several items here were dropped rather
> than deferred — the side-by-side review instrument (P2), the image editor
> (P3 #14) and the Windows installer (P4 #21) do not exist and are not currently
> planned. [`README.md`](./README.md) lists what is built and what is missing.

Tiered so the highest-value, foundational pieces come first.

### Phase 1 — Core pipeline (prove the engine)

1. Electron shell + project file structure (save/resume scaffold).
2. PDF page extraction.
3. OCR via Tesseract/OCRmyPDF → text **with hOCR confidence + bounding boxes**. _(Backbone — build the coordinate mapping here.)_
4. Cleanup layer v1 — de-hyphenation, ligature fixes, header/footer strip, OCR-confusion passes, with heuristic flags.
5. Markdown intermediate → Pandoc → XeLaTeX → PDF, with a basic KDP-ready template (trim size, margins, gutter, embedded fonts).

### Phase 2 — The review instrument (the centerpiece)

6. Side-by-side panes with hover-sync and scroll-sync (driven by the coordinate mapping).
7. Reading-comfort controls; toggleable confidence tinting.
8. Inline editing + source-image-on-hover.
9. Confidence/flag report + jump-to-next-flag.
10. Per-book find-replace dictionary + suspicious-character flags.

### Phase 3 — Structure & images

11. Right-click semantic tagging (footnotes first, then verse/quote/table/etc.).
12. Auto-generated TOC from confirmed headings.
13. Image region detection → accept/reject.
14. Image-editing mode (reliable tools first; background-removal best-effort second; non-destructive, full-res).
15. DPI-aware placement.

### Phase 4 — Polish, templates, packaging

16. Template customization + two-level config/profile save system.
17. Front/back-matter templates (copyright/edition page, title page).
18. Ornament layer + shipped starter SVG library + user uploads + SVG→PDF conversion.
19. Running heads (verso/recto) via `fancyhdr`.
20. KDP export validation + final page-count report.
21. **Windows install wizard** bundling/verifying Tesseract, Pandoc, TeX Live.

### Later / optional

- Docker packaging to simplify system dependencies.
- Index template.
- Catalog-level metadata bookkeeping (titles, ISBNs, edition tracking) once past a handful of books.

---

## 13. Open Decisions (settled — and two since reversed)

- ~~**Electron** over native Windows~~ — **reversed.** The app runs in a browser.
  Nothing in the flow needed a desktop shell, and dropping it removed the
  install wizard, the system-dependency detection, and three system binaries
  from the project at once.
- ~~**XeLaTeX** over plain LaTeX~~ — **reversed.** There is no TeX. Running one
  in the browser was the last unproven piece of the pipeline, so the app lays
  the book out itself and pdf-lib writes the file. The `.tex` emitter survives
  as a secondary download while the PDF path earns trust, and is scheduled for
  deletion. See [`docs/PLAN-layout-preview.md`](./docs/PLAN-layout-preview.md).
- **Output:** clean reflowable text, not preserved page images — confirmed, and
  still true.
- **Target:** KDP print-on-demand interior — confirmed, and still true.
- **Covers & PD verification:** out of scope — confirmed, and still true. The
  final page count is reported, and is now measured rather than estimated.
