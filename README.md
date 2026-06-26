# Public-Domain Book Reprint Tool

A Windows desktop application that turns public-domain book PDFs (including old
scans) into print-ready [KDP](https://kdp.amazon.com/) interiors. It automates
the bulk of OCR, cleanup, and typesetting, then provides a comfortable
side-by-side review surface to bring output to publishable quality.

See [`SPEC.md`](./SPEC.md) for the full design.

> **Status:** foundation in progress (SPEC §12 Phase 1 + the architectural
> backbone). The review UI, image editor, tagging, templates, and install
> wizard are not built yet.

## Architecture

```
src/
  shared/     Types shared across processes (the IPC contract)
  main/       Electron main process (window, lifecycle, IPC handlers)
  preload/    contextBridge API exposed to the renderer
  renderer/   UI (the side-by-side review instrument; placeholder for now)
  core/       Domain engine — no Electron/Node-UI deps
    model/    The backbone: hOCR coordinate mapping, document model, honest flags
    project/  Versioned project file + atomic save/load (save/resume)
    hocr/     hOCR/TSV parsing into per-word tokens with bbox + confidence
  tooling/    External tool integration (Tesseract, OCRmyPDF, Pandoc, XeLaTeX)
    deps/     Locate + version-check system binaries (install-wizard foundation)
    wrappers/ Per-binary wrappers over a cancellable spawn helper
  pipeline/   Stage runner: extract → OCR → image-detect → cleanup → structure → markdown
test/         Vitest unit tests + fixtures
```

The single most important internal structure is the **hOCR coordinate map**
(`src/core/model/coordinate-map.ts`): every OCR'd word keeps its source-image
bounding box, its position in the formatted output, and its true OCR confidence.
This powers hover-sync, scroll-sync, click-to-jump, confidence tinting, and
source-image-on-hover.

## Toolchain

The app shell is **Electron + TypeScript**, built with
[`electron-vite`](https://electron-vite.org/) and tested with
[Vitest](https://vitest.dev/).

It orchestrates mature external tools (installed at the system level, verified by
the dependency detector): **Tesseract** / **OCRmyPDF** for OCR, **pdftoppm** for
page extraction, **Pandoc** + **XeLaTeX** for typesetting. These are not bundled
as packages; the eventual Windows install wizard installs/verifies them.

## Development

```bash
npm install        # install JS dependencies
npm run dev        # launch the app in development
npm run typecheck  # type-check the whole tree
npm test           # run the unit test suite
npm run build      # build main/preload/renderer bundles
```

> The OCR/typesetting system binaries are not required to run the test suite —
> the engine is unit-tested against fixtures, and the dependency detector
> reports missing tools rather than failing.
