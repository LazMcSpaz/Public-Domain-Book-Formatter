# CLAUDE.md

Guidance for AI assistants (and humans) working in this repo.

## What this is

A Windows **Electron + TypeScript** desktop app that turns public-domain book
PDFs (often old scans) into print-ready **KDP** interior PDFs. It orchestrates
mature external tools (Tesseract/OCRmyPDF, Pandoc, XeLaTeX) and provides a
side-by-side review instrument for the manual cleanup that OCR can't fully
automate. The full design is in [`SPEC.md`](./SPEC.md); the module map and
build status are in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

All four SPEC §12 phases are implemented (pipeline, review instrument, structure
& images, polish/templates/packaging).

## Commands

```bash
npm install            # ELECTRON_SKIP_BINARY_DOWNLOAD=1 if the binary CDN is blocked
npm run typecheck      # tsc --noEmit over the whole tree
npm test               # vitest (the gating check here — no system tools needed)
npm run lint           # eslint
npm run format:check   # prettier --check  (npm run format to fix)
npm run build          # electron-vite build (bundles main/preload/renderer)
npm run dev            # launch the app (needs a display + the Electron binary)
npm run dist:win       # Windows NSIS installer (needs Windows/CI + the binary)
```

CI (`.github/workflows/ci.yml`) runs format → lint → typecheck → test → build on
every push/PR. **Before committing, run typecheck + test + format:check + lint.**

## Environment reality (important)

This dev sandbox has **no Tesseract/Pandoc/XeLaTeX/pdftoppm and no display**.
So:

- The engine is unit-tested against **fixtures** and **generated-output
  assertions** (e.g. asserting the produced `.tex`), never live binaries.
- Every external-tool call goes through an **injectable `CommandRunner`**
  (`src/tooling/process.ts`); tests pass a mock runner.
- Live OCR/typesetting, the on-screen UI, and the Windows installer build are
  only exercisable on a real machine/CI. Don't add tests that shell out to real
  tools.

## Architecture in one breath

`src/core` is pure domain logic (no Electron/Node-UI deps): the **CoordinateMap**
backbone (`core/model/coordinate-map.ts`), hOCR parsing, project persistence,
structure detection, image algorithms, the LaTeX document builder, and the style
system. `src/tooling` wraps the external binaries + the pipeline + export
assembler. `src/pipeline` is the staged engine. `src/main`/`src/preload` are the
Electron shell exposing a typed IPC bridge; `src/renderer` is the React UI. The
shared contract types live in `src/core/model/types.ts` and `src/shared/ipc-types.ts`.

### Conventions that matter

- **Output-offset convention**: `ProjectFile.markdown` is the formatted text;
  every `MappingEntry.output` is a half-open `[start, end)` char range into it.
  Keep tagging, spans, and TOC consistent with this (`src/pipeline/stages/ocr.ts`
  documents it).
- **Honest flag tiers** (SPEC §4): `Flag` is a discriminated union — only
  `kind:'ocr'` carries a real confidence number; cleanup/structure produce
  `kind:'heuristic'` labels, never probabilities. Preserve this distinction.
- **Path aliases**: `@core`, `@shared`, `@tooling`, `@pipeline` (defined in
  `tsconfig.json` and `electron.vite.config.ts`); bare and subpath forms both resolve.
- **Project file is versioned**: bump `CURRENT_SCHEMA_VERSION` and extend
  `migrate()` in `src/core/project/project-file.ts` on any `ProjectFile` shape
  change.
- **Non-destructive image edits**: the engine re-derives from the original via an
  `ImageEditOp[]` stack (`src/renderer/components/ImageMode/engine`); never mutate
  source pixels.

## Working style in this repo

Large features here were built as: a committed **shared-contract scaffold**
(types/IPC/store + stub implementations), then parallel work on **disjoint
directories** against those contracts, then an **integration pass** that wires
things together and runs the full verification. When extending, define the shared
type/IPC surface first so independent pieces compile against one source of truth.

Commit only when the tree typechecks, tests pass, and format/lint are clean.
Don't push to a different branch or open a PR unless asked.
