# 0030: Front matter is replaced, not transcribed

Status: inherited · Date: 2026-11-18

## Decision

The original title page, copyright page, contents and index are not reproduced. Title and copyright pages are sources of metadata (title, author, year), offered prefilled at the export gate. The scanned contents and index are discarded, because their page numbers belong to the original printing; the contents is regenerated with the page numbers this edition prints (`src/core/pages`, `src/core/layout/toc.ts`). An analytical contents, which describes each chapter in a paragraph, keeps its prose, matched to the chapters and set with this edition's numbers (`src/core/pages/synopsis.ts`), and page references inside it are re-pointed at this edition.

## Why (plain English)

The old page numbers describe pages this edition does not have, so printing them would mislead every reader. The descriptive prose of an analytical contents, though, is real editorial work and worth keeping.

## What we gave up

A facsimile of the original front matter and its pagination.

## Rule for agents

Never print the scanned contents' or index's page numbers. Keep an analytical contents' prose only when its parse comes back regular (`synopsisLooksSound`). A reference no page answers prints without a number and is reported, never guessed. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1866–1869, 2490–2515, 3307–3347.
