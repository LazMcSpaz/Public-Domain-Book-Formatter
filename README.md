# Public-Domain Book Reprint Tool

A Windows desktop application that turns public-domain book PDFs (including old
scans) into print-ready [KDP](https://kdp.amazon.com/) interiors. It automates
the bulk of OCR, cleanup, and typesetting, then provides a comfortable
side-by-side review surface to bring output to publishable quality.

See [`SPEC.md`](./SPEC.md) for the full design.

> **Status:** all four SPEC §12 phases are in place —
> **P1** core pipeline + the hOCR coordinate-mapping backbone;
> **P2** the side-by-side review instrument (linked panes, hover/scroll-sync,
> inline editing, confidence tinting, flag review, find-replace);
> **P3** structure & images (right-click semantic tagging, auto TOC,
> image-region detection, the non-destructive image editor + curve editor &
> drag-crop, DPI awareness);
> **P4** polish & packaging (two-level style/profile system, templated
> front/back matter, ornament layer + SVG→PDF, fancyhdr running heads, the
> LaTeX document builder, KDP export validation + final page-count report, and
> the Windows install wizard / first-run dependency bootstrapper).
>
> Live OCR/typesetting and the Windows installer build require the system
> toolchain (Tesseract, Pandoc, TeX Live) on a real machine; the codebase is
> unit-tested against fixtures and generated-output assertions here.

## Architecture

```
src/
  shared/     Types shared across processes (the IPC contract)
  main/       Electron main process (window, lifecycle, IPC handlers)
  preload/    contextBridge API exposed to the renderer
  renderer/   React UI: the side-by-side review instrument (panes, store, hooks)
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
