# 0012: Where a page came from decides trust

Status: inherited · Date: 2026-11-18

## Decision

Whether a page's text needs reading is decided by what the page is, not by how its words look. `isPhotograph` (`src/core/provenance/coverage.ts`) asks whether the page is a photograph of paper: one image across most of it, or a scan cut into strips under an invisible text layer. `src/core/textquality` is used only to say how damaged a text is. Each book records its shape (`run.shape`: are there pixels, where the text came from, is there a second digitisation), and `docs/FLOW.md` lists the stages each shape gets. A text layer counts as `typeset` only with positive evidence; otherwise it is `converted`, meaning somebody's OCR. Punctuation damage follows the same logic: on a photographed old page an odd mark is the printer's and is kept, so the sense pass ignores style, punctuation and spelling, while on a converted typescript the same mark came from a program and `checkDamage` finds it.

## Why (plain English)

Good OCR of a clean scan is full of errors shaped exactly like words, so no measure of word shapes can say whether a file's text can be trusted; whether the page is a photograph can. One study book's text layer scored 0.998 "trustworthy" and still needed hundreds of corrections.

## What we gave up

A single quality score for every file. Some books need their shape declared by hand (`shape.mjs --declare`) when nothing can measure it.

## Rule for agents

Decide trust from `isPhotograph` and the recorded shape, never from a text-quality score. Send conversion marks (split words, stray points, stray apostrophes) through `checkDamage`, not the sense pass. Code note: the old text says `looksScanned` asks whether one image covers the page; the code now uses `isPhotograph`, which also accepts strip scans, and this record follows the code. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 731–742, 786–840, 1963–1970, 3116–3143; harness/sorting/part-4.md, contradiction 3.
