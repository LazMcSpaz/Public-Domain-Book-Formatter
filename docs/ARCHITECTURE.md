# Architecture

How the Public-Domain Book Reprint Tool is put together, and what is / isn't
verifiable without the system toolchain. See [`SPEC.md`](../SPEC.md) for the
product design and [`CLAUDE.md`](../CLAUDE.md) for working conventions.

## Process model (Electron)

```
┌─────────────── main process (Node) ───────────────┐    ┌──── renderer (React) ────┐
│ src/main         window, lifecycle, IPC handlers   │    │ src/renderer             │
│ src/main/export  export orchestration entry points │◀──▶│  store/  ReviewContext   │
│ src/main/profile-store  userData style profiles    │IPC │  components/  the UI      │
│ src/main/asset-access   local-asset:// + path guard│    │  hooks/ utils/           │
└────────────────────────────────────────────────────┘    └──────────────────────────┘
                 ▲ typed bridge (src/preload) exposes window.api
        contract: src/shared/ipc-types.ts  +  src/core/model/types.ts
```

The renderer is sandboxed (contextIsolation on, nodeIntegration off). It only
touches `window.api`. Page images are served via a path-validated
`local-asset://` protocol; pixel crops come through `getPageImage` (base64).

## Layers

| Layer         | Path                                        | Responsibility                                                     | Electron deps? |
| ------------- | ------------------------------------------- | ------------------------------------------------------------------ | -------------- |
| Domain model  | `src/core/model`                            | Types + the **CoordinateMap** backbone (source↔output index)       | none           |
| hOCR          | `src/core/hocr`                             | Parse Tesseract hOCR → word tokens (bbox + confidence)             | none           |
| Project       | `src/core/project`                          | Versioned `ProjectFile`, atomic save/load, migration               | none (node fs) |
| Structure     | `src/core/structure`                        | Heading detection, TOC builder, footnote linking                   | none           |
| Image algos   | `src/core/image`                            | Region detection (OCR-gap heuristic), DPI math                     | none           |
| Style/typeset | `src/core/style`, `src/core/typeset`        | Profiles, LaTeX document builder, KDP validation                   | none           |
| Ornaments     | `src/core/ornament` + `resources/ornaments` | Starter SVG library, ornament resolution                           | none           |
| Tooling       | `src/tooling`                               | Binary wrappers, dependency detector, pipeline, export assembler   | node (spawn)   |
| Pipeline      | `src/pipeline`                              | Staged engine: extract→ocr→image-detect→cleanup→structure→markdown | node           |
| Shell         | `src/main`, `src/preload`                   | Window, IPC, protocol, profile store, export                       | electron       |
| UI            | `src/renderer`                              | React review instrument, image editor, style/export screens        | renderer       |

`src/core` and the pure parts of `src/tooling` are deliberately framework-free so
they're unit-testable in Node with no binaries and no DOM.

## Key data flow

1. **Import**: `runPipeline` (`src/pipeline/pipeline.ts`) renders pages, OCRs them
   (hOCR → words), detects image regions, cleans text, detects headings, and
   assembles the Markdown intermediate — persisting a `ProjectFile`.
2. **Review**: the renderer builds a `CoordinateMap` from the persisted entries;
   panes sync by shared `data-token-id`; edits/tags/flags update the store and
   re-save.
3. **Export**: `assembleAndExport` (`src/tooling/export/assemble.ts`) →
   Pandoc body fragment → `buildLatexDocument` (`src/core/typeset`) → ornament
   SVG→PDF → XeLaTeX → parse page count + warnings → `validateKdp`.

## Verification matrix

| Concern                                                                                | How it's verified here                                      | Needs a real machine for                         |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Domain logic, parsing, persistence, structure, image ops, LaTeX generation, validation | **Vitest unit tests** (228) + generated-output assertions   | —                                                |
| External tools (Tesseract/Pandoc/XeLaTeX/pdftoppm/rsvg)                                | Wrappers tested via **mock `CommandRunner`** (argv + order) | actually running OCR/typeset (install the tools) |
| Type safety                                                                            | `npm run typecheck` (whole tree)                            | —                                                |
| Bundling                                                                               | `npm run build` (electron-vite)                             | —                                                |
| App UI behavior                                                                        | not automated (no display)                                  | manual run / future Playwright-electron          |
| Windows installer                                                                      | `electron-builder.yml` config only                          | Windows/CI runner with the Electron binary       |

## Extending safely

- Add a pipeline stage: implement the `Stage` contract in `src/pipeline/stages`,
  insert into `DEFAULT_STAGES`, keep the output-offset convention.
- Change `ProjectFile`: bump `CURRENT_SCHEMA_VERSION` + extend `migrate()`.
- Add an IPC method: extend `IpcChannel` + `BridgeApi` (shared), the preload
  bridge, and a main handler — all three or it won't type-check.
- Add an image op: add the kind to `ImageEditOpKind`, implement it in the engine
  `apply-ops`, expose a constructor in `engine/ops.ts`.
