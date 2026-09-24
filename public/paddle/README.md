# The second reader's weights

PaddleOCR PP-OCRv6 detection and recognition models, converted to ONNX
Runtime's `.ort` format by the `ppu-paddle-ocr` project and vendored here so
the app fetches nothing at run time — the rule Tesseract's core and language
data already follow. Loaded on demand (`src/platform/browser/second-reader.ts`);
a wizard user who never asks for a second reading downloads none of this.

| Tier    | Files                            | Size   | Dictionary                       |
| ------- | -------------------------------- | ------ | -------------------------------- |
| `tiny`  | `tiny/det.ort`, `tiny/rec.ort`   | 6.4 MB | `tiny/dict.txt` (PP-OCRv6 tiny)  |
| `small` | `small/det.ort`, `small/rec.ort` | 31 MB  | `small/dict.txt` (PP-OCRv6 full) |

**Source:** https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models
(`main`, September 2026), which converts them from
https://www.paddleocr.ai/. Fetched by `node scripts/fetch-paddle-models.mjs
tiny` from the repository's Git LFS host, because the Hugging Face mirror the
package defaults to is unreachable from some networks.

**Licence:** Apache-2.0, in `LICENSE` beside this file (the models
repository's own). The `ppu-paddle-ocr` package that runs them is MIT.

**SHA-256**, as fetched:

```
tiny/det.ort   2816e82d26a09d6af722492f80f3059d458377c084eca88f34d84ddf9b385580
tiny/rec.ort   efc46adf1bde1e05b58748268abb0e71791bfa8616c435676bbca13d1ea47767
tiny/dict.txt  2f3717bbd530b681b6db3be35cc485e8a41a932b9558b833986bf0894eb21f2d
small/det.ort  c21be8d8268f0f45e2693b1d52432a290a56d008f6c1ff28b4baa7c35bab250e
small/rec.ort  40bccd9fa3ae2d14d724bf9d020c8f0edfc801489477b92f7449162a538366df
small/dict.txt 41557512862dfe31970cf22407742b629725461dd84c0d8771bde9c87c2202c8
```

The `small` tier (31 MB, the full dictionary) was fetched the same way on
2026-09-24 (`node scripts/fetch-paddle-models.mjs small`) and vendored for the
measurement in `docs/LEDGER-second-reader.md`, which says what it is worth
against the tiny tier. Same source, same licence.

ONNX Runtime's own WebAssembly (`onnxruntime-web`, 14 MB) is **not** here: it
rides as a Vite asset from `node_modules`, hashed by content, and is fetched
the first time the reader runs.
