# 0011: OCR is the independent witness, not the source of truth

Status: inherited · Date: 2026-11-18

## Decision

OCR (Tesseract, and where it helps the PaddleOCR second reader or a scan's own OCR layer) is kept as an independent witness, not as the answer. It catches a reading drifting, and it supplies the box around each word that crops and the coordinate map need. A second digitisation of the same printing (an archive.org reading, a volunteer transcription) is the strongest witness available and is reached for first.

## Why (plain English)

OCR is not a language model, so its mistakes differ from a model's mistakes; where two different kinds of reader agree, the reading is far more trustworthy than either alone. But OCR misreads too, often into word-shaped errors (`thc`, `chirnrgeon`), so its text cannot simply be copied in.

## What we gave up

Trusting either reader alone, which would be cheaper. Running a second engine costs time (about four seconds a leaf for PaddleOCR).

## Rule for agents

Use OCR to find where readings disagree and to locate words; never copy OCR text over a transcription without a reader looking at the pixels. Two readers that share a processing step share its blind spots, so a second reader reads the original render, never a cleaned one. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1863–1865, 1940–1951, 3186–3207; docs/ARCHITECTURE.md ("Why OCR is still here"); docs/LEDGER-second-reader.md ("The engine").
