# 0035: Cleaning a page before OCR is built, and off by default

Status: inherited · Date: 2026-11-18

## Decision

The app can clean a scanned page (levels, despeckle, threshold) before the OCR engine reads it (`src/core/image/cleanup.ts`, `src/platform/browser/cleanup.ts`), but the default is `off` (`DEFAULT_CLEANUP`). When a preset is used, the cleaned pixels go to the OCR engine and nowhere else (every crop, thumbnail and piece of evidence comes from the original render), no preset changes the page's size, and the cached reading is refused if it was taken through a different preset.

## Why (plain English)

Measured on 42 leaves from four books against proofed text, no preset beat the raw page: the gentle preset was within noise, despeckling cost 2.5 seconds a leaf for nothing, and turning pages black-and-white made things worse. The errors that remain (columns read across, gutter shadow, unusual typefaces) are not ones cleaning can reach. The paper is the evidence; a cleaned page is an opinion about the paper.

## What we gave up

The gain the plan hoped for, which is not there on this shelf. The machinery is kept because it cost nothing to keep, for a future shelf of foxed or grey scans.

## Rule for agents

Do not change the default without a new measurement on the ground-truth leaves. Never show a cleaned page as evidence, never let a preset change page geometry, and do not add a wizard question for it. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 3164–3185; docs/LEDGER-page-cleanup.md ("The rule, applied", "The decision"); docs/PLAN-page-cleanup.md ("The rules this must keep").
