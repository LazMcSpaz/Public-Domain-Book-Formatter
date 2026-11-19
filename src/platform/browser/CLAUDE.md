# src/platform/browser/

Everything the engine needs a browser for: PDF rendering (pdf.js), OCR (Tesseract, PaddleOCR), recon, canvas crops, fonts, writing the PDF (pdf-lib), the page preview, the device store, and the shelf connection with its outbox.

## May use

- `src/core/` (alias `@core`).
- `pdfjs-dist` (v4), `tesseract.js` (its ESM build, default export), `pdf-lib` with `@pdf-lib/fontkit`, the `@expo-google-fonts/*` faces, and `ppu-paddle-ocr` / `onnxruntime-web` loaded lazily.

## Must not

- Import from `src/app/` (`harness/check.py` enforces it). A contract both sides need goes in `src/core/`, as the command surface `control.ts` drives is typed in `@core/control` (`surface.ts`).
- Hold book logic: a decision about the book belongs in `src/core/`, called from here.

## Key files

- `recon.ts`: render, OCR and harvest, one leaf at a time; `releaseRecon`.
- `cleanup.ts`: `recognizeLeaf`, the one read path recon and `drive.mjs ocr … fresh` share.
- `second-reader.ts`: the PaddleOCR second reading.
- `pdf-out.ts`: `renderPdf`; read its comment before changing how fonts are embedded (whole, ligatures off).
- `font-widths.ts`: gives every glyph the book prints a width, and names the ones drawn as boxes.
- `interior.ts`, `preview.ts`: the finished interior and the design-gate preview, both from the engine's own PDF.
- `shelf.ts`, `shelf-save.ts`, `shelf-outbox.ts`, `landed.ts`: reading and writing the shelf repository.
- `shelf-pictures.ts`: `fetchBookPictures` (a book's named pictures) and `keptPicture` (a held picture the shelf already has), both looking where core's `pictureCandidates` says.
- `transport.ts`: `browserTransport`, the `fetch` every model call is handed (the core never reaches the network).
- `run-store.ts`: the device's IndexedDB store of runs and banked looks.

## Folder-specific rules and lessons

- Every shelf read goes through `readUrl` (`shelf.ts`): a unique parameter plus a counter, and `no-store`. Never fetch a shelf path another way.
- One door writes a book to the shelf (`pushBookToShelf`); pictures go to `images/<digest>.png` once, never re-inlined on each save.
- A picture a book names is relative to the book: fetch it only with `fetchBookPictures`, never `getBytes` on the bare name.
- Outbox flushes are chained per book (`shelf-outbox.ts`): one at a time, the next waiting rather than joining.
- Recon renders, uses and releases one page at a time; never hold page canvases (a 300-DPI page is about 19 MB).
- Revoke every object URL you mint for crops and thumbnails; `releaseRecon` frees recon's.
- Cleaned pixels feed only the OCR engine (`recognizeLeaf`); every crop and the second reader use the original render.
