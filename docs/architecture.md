# Architecture

A plain-English map of this repository: what each folder is for and who may use whom. The books themselves live in the separate, private shelf repository (`Public-Domain-Books-Storage`); this repository holds the tools only.

## Today

### The program (`src/`)

| Folder                  | What it does                                                                                                                                            | May use                              | Must not                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `src/core/`             | All the book logic, as pure code: no browser, no Node. Where the tests aim.                                                                             | only `src/core/`                     | touch the screen, files, network or `window`                               |
| `src/platform/browser/` | Everything that needs a browser: PDF rendering (pdf.js), OCR (Tesseract, PaddleOCR), fonts, writing the PDF (pdf-lib), the shelf connection, the outbox | `src/core/`                          | reach into `src/app/` (one file does today: `control.ts`, a known problem) |
| `src/app/`              | The web app: the guided flow, the question screens, the book editor and reader, the page browser, Settings                                              | `src/core/`, `src/platform/browser/` | hold book logic of its own                                                 |

**The areas inside `src/core/`, one line each:**

- `adjudicate/`: a second look at the places the checks flagged.
- `annotate/`: the editor's own notes and introduction, in the editor's voice, and the prose audit.
- `assemble/`: pages joined into one book: page seams, hyphens, footnotes linked.
- `coherence/`: checks that read the whole book against itself (damage, spelling, page turns, apparatus, emphasis).
- `control/`: the protocol the driver uses to operate the app from outside.
- `design/`: the design interview: a few questions produce a full style.
- `draft/`: the free reading: OCR words shaped into a page's blocks.
- `edits/`: corrections held as a list and applied over the original reading.
- `epub/`: reading EPUBs in.
- `export/`: the edition details folded into the book before export.
- `harvest/`: the fact bank each book leaves behind.
- `hocr/`: reading OCR output.
- `image/`: picture handling: regions, the image editor's operations, slant (italic) measurement, cleanup.
- `layout/`: the layout engine: pages, line breaking, footnotes, contents, pictures.
- `lexicon/`: the book's own vocabulary.
- `model/`: the shared shapes of a book.
- `ornament/`: the ornament library.
- `pages/`: page roles, front matter, the analytical contents.
- `project/`: saving and resuming, the book file, the recon cache, the ledger numbers.
- `provenance/`: what a book is made of (pixels, text source, second copy) and which stages apply.
- `queries/`: the editor's queries, rulings and proposals.
- `speech/`: text prepared for reading aloud (audiobooks, paused).
- `style/`: the style system and saved looks.
- `sync/`: the shelf: paths, cards and saving to GitHub.
- `textquality/`: how damaged a text is.
- `transcribe/`: the old vision pass (API) and the shapes a page's reading is stored in.
- `typeset/`: the KDP checks.
- `witness/`: two independent readings compared.
- `wizard/`: the guided flow's steps and questions.

### Everything else

| Folder                                     | What it is                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/`                                 | Commands sessions run: the driver (`drive.mjs`), checks, exports, covers, glossary tools. `scripts/reading-kit/` is the second reading pipeline (to be merged into the first). |
| `test/`                                    | Automated tests (vitest). `npm test` runs them.                                                                                                                                |
| `docs/`                                    | Process documents, plans, measurement ledgers. Being sorted into the layers below.                                                                                             |
| `public/`                                  | Fonts, OCR data, icons: files the app loads. Vendored, not edited by hand.                                                                                                     |
| `harness/`                                 | The rules (`rules.json`), the check script (`check.py`) and the list of known old problems (`baseline.json`).                                                                  |
| `.claude/agents/`                          | The writer persona (`etsu.md`).                                                                                                                                                |
| `.github/workflows/`                       | Automatic runs: tests on every push, and deploying the app.                                                                                                                    |
| `books/`, `voice/`, four images at the top | Leftovers: old copies of two books, the audiobook pronunciation list, stray uploads. To be moved or removed by cleanup tasks.                                                  |

## Target

Where it is heading, reached through the cleanup plan (`docs/cleanup-plan.md`):

- **The same three program folders, with the boundaries enforced:**
  - `src/core/` type-checked on its own, with no browser or Node available;
  - `src/platform/` never using `src/app/`.
- **One map of the shelf's layout** in `src/core/sync/`, which the app, the driver and every script ask.
- **No giant files.** `scripts/drive.mjs`, `src/app/App.tsx` and `src/core/layout/paginate.ts` are split along clear responsibilities, one task at a time.
- **One reading pipeline:** `scripts/reading-kit/` merged into the main one.
- **Paused audiobook work kept together:** `voice/` and the text-to-speech scripts move into `audiobook/`, with a README saying it is paused.
- **Book-specific one-off scripts** in `scripts/one-off/<book>/`.
- **Documentation in layers:** `docs/product.md`, `docs/still-works.md`, this file, `docs/decisions/`, `docs/process/` (one per book job), `docs/reference/`, `docs/specs/_template.md`, and `docs/archive/` (history; never instructions).

**Reserved for the likely future directions** (no folders yet):

- **Many more books:** the shelf's catalogue records and templates, read through `src/core/sync/`.
- **Tracing and picture books:** facing-page layout in `src/core/layout/`, and tracing checks in `src/core/image/`.
- **Compilations:** a parts list in the book file, read by `src/core/assemble/`.

## Who may use whom

```
src/app/  ───────▶  src/platform/browser/  ───────▶  src/core/
   │                                                   ▲
   └───────────────────────────────────────────────────┘
scripts/  ──▶  src/core/ (through vite-node)  and the app (through the driver's browser)
test/     ──▶  src/core/ and src/platform/ (with stubs)
src/core/ ──▶  nothing outside src/core/
```
