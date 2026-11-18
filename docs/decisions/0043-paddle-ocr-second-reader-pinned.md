# 0043: PaddleOCR is the second reader, pinned exactly

Status: inherited · Date: 2026-11-18

## Decision

The second OCR reader is PaddleOCR PP-OCRv6, tiny tier by default, run by `ppu-paddle-ocr` 6.6.0 on `onnxruntime-web` 1.30.0, both pinned to exact versions (`src/platform/browser/second-reader.ts`, `drive.mjs second`). It reads the original render, never a cleaned one. Its model weights are kept in `public/paddle/`, fetched once by `scripts/fetch-paddle-models.mjs` with their SHA-256s and licence. Both packages are excluded from Vite's pre-bundling (`vite.config.ts`), `wasmPaths` is set before the engine is imported, and everything loads lazily. For now it is reached from the driver only.

## Why (plain English)

Many scans carry no OCR layer, so those books had only one reader. Measured on 42 leaves, three in five of what PaddleOCR raises are real errors and it catches two in five of Tesseract's; on a book whose own layer is near worthless it was the witness the book lacked. Where a scan's own layer is good, that layer stays the better witness. The special handling exists because pre-bundled, the runtime fails ("no available backend found"), the engine otherwise points itself at a CDN, and some networks refuse the default model host (Hugging Face).

## What we gave up

Automatic upgrades, because of the exact pins. A GitHub Actions job to run it, which proved unnecessary at about four seconds a leaf. It is not the default witness on every book.

## Rule for agents

Keep both versions exact and both out of Vite's `optimizeDeps`. Set `wasmPaths` before importing the engine. Never fetch weights from Hugging Face at run time, and never feed it a cleaned page. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2052–2066, 3186–3207; docs/LEDGER-second-reader.md ("The engine", "The decision"); docs/PLAN-second-reader.md ("Where it runs, and when it moves").
