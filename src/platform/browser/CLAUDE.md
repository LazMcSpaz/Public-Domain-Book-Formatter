# src/platform/browser/

Everything the engine needs a browser for: PDF rendering (pdf.js), OCR (Tesseract, PaddleOCR), recon, canvas crops, fonts, writing the PDF (pdf-lib), the page preview, the device store, and the shelf connection with its outbox.

## May use

- `src/core/` (alias `@core`).
- `pdfjs-dist` (v4), `tesseract.js` (its ESM build, default export), `pdf-lib` with `@pdf-lib/fontkit`, the `@expo-google-fonts/*` faces, and `ppu-paddle-ocr` / `onnxruntime-web` loaded lazily.

## Must not

- Import from `src/app/` (`harness/check.py` enforces it). A contract both sides need goes in `src/core/`, as the command surface `control.ts` drives is typed in `@core/control` (`surface.ts`).
- Hold book logic: a decision about the book belongs in `src/core/`, called from here.

## Key files

- `recon.ts`: render, OCR and harvest, one leaf at a time; `releaseRecon`; `BOOK_RECON`, the conditions a whole book is read under.
- `recon-run.ts`: the driver's `recon` and `load` line, carrying out `planRecon` (core) with the app's own recon functions.
- `cleanup.ts`: `recognizeLeaf`, the one read path recon and `drive.mjs ocr … fresh` share.
- `second-reader.ts`: the PaddleOCR second reading.
- `pdf-out.ts`: `renderPdf`; read its comment before changing how fonts are embedded (whole, ligatures off).
- `font-widths.ts`: gives every glyph the book prints a width, and names the ones drawn as boxes.
- `interior.ts`, `preview.ts`: the finished interior and the design-gate preview, both from the engine's own PDF.
- `house-look.ts`: the shelf's house look read, and a book laid out in the look it gets (`renderInLook`), with the running heads its structure gets (`houseHeadsForBook`).
- `shelf.ts`, `shelf-save.ts`, `shelf-outbox.ts`, `landed.ts`: reading and writing the shelf repository.
- `shelf-attempt.ts`: `attempt`, which names, sizes and times a failed shelf request; `blobSha`. `shelf-fetch.ts`: `reach`, the one `fetch` every shelf request makes. `shelf-request.ts`: what every shelf request carries (headers, `no-store`, the `unshared` mark). `outbox-notes.ts`: every sentence a flush shows.
- `shelf-notes.ts`: `readWorkNotes`, the Workroom's reader: every status note listed in one git trees request, fetched by blob sha only when the cache (memory and device) lacks it. `note-store.ts`: the device copy, in a database of its own (`pdbf-workroom`). `notes-failure.ts`: a failed read in words.
- `query-crop.ts`: `cutQueryCrop`, a query's crop cut from the original render with its passage marked.
- `shelf-pictures.ts`: `fetchBookPictures` (a book's named pictures) and `keptPicture` (a held picture the shelf already has), both looking where core's `pictureCandidates` says.
- `transport.ts`: `browserTransport`, the `fetch` every model call is handed (the core never reaches the network).
- `run-store.ts`: the device's main IndexedDB database (`pdbf`, version 7): runs, banked looks, kept scans, readings, the outbox; `onNewerAppOpened` for the reload band.
- `settings.ts`: the settings kept in `localStorage`; a save answers a refusal in words (`device-write.ts`).

## Folder-specific rules and lessons

- Every shelf read goes through `readUrl` (`shelf.ts`): a unique parameter plus a counter, `no-store`, and each path segment encoded (`test/shelf-read-url.test.ts`). Never fetch a shelf path another way. The one exception is the Workroom's git trees and blobs (`shelf-notes.ts` `gitReadUrl`), which carry the same mark and `no-store` from `shelf-request.ts`, and keep a note only if it hashes to its sha (`test/shelf-notes.test.ts`).
- One door writes a book to the shelf (`pushBookToShelf`); pictures go to `images/<digest>.png` once, never re-inlined on each save.
- A picture a book names is relative to the book: fetch it only with `fetchBookPictures`, never `getBytes` on the bare name.
- Outbox flushes are chained per book (`shelf-outbox.ts`): one at a time, the next waiting rather than joining.
- A flush writes the shelf's own file back with only its two lists changed (core `foldIntoBookText`), never the app's reading of it, and every request it makes goes through `attempt` so a failure names itself (`test/shelf-fold.test.ts`, `test/outbox-flush.test.ts`).
- A flush writes only over the version it read (the blob sha of the bytes read, checked before the write), and the store clears a queued entry only while it is still the one sent (`clearQueued`, `npm run check:saves`).
- A query's mark is multiplied over the paper, never drawn over the ink (`check:crop` measures it).
- Recon renders, uses and releases one page at a time; never hold page canvases (a 300-DPI page is about 19 MB).
- `localStorage` is for small records the app needs (the token, the API key, preferences): anything that grows with use goes in IndexedDB, never there; on a phone it is about 5 MB, and full it stops the token being saved (`test/workroom-device-notes.test.ts`, `npm run check:workroom`).
- A cache that costs nothing to lose gets its own database (as `note-store.ts`); never raise the main database's version for one (`npm run check:device-db`).
- A new version of the main database only adds stores and reads version-7 records as they are: older pages keep writing into it (`run-store.ts`).
- Every reader of the recon cache, app or driver, asks with `BOOK_RECON`: `loadReconCache` deletes a record it cannot use (`test/recon-wired.test.ts`).
- Revoke every object URL you mint for crops and thumbnails; `releaseRecon` frees recon's.
- Cleaned pixels feed only the OCR engine (`recognizeLeaf`); every crop and the second reader use the original render.
