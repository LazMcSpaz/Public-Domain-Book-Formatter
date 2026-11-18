# 0007: Propose from sense, accept from pixels

Status: inherited · Date: 2026-11-18

## Decision

A model, or any reader, may propose a reading from sense, but only the scan's pixels may accept it. A pass that reads without pixels outputs findings (a place, a reason, and a hypothesis marked as one), never replacement text. Reading is staged, and each stage checks the one before: the free OCR reading first (recon), triage by measurement, small batches of leaves read by subagents that each see the images and their OCR, a checkpoint after every batch, the book checked against itself, a sense read that outputs findings only, each finding checked against the crop by a reader who has not seen the hypothesis, and finally the editor's decision. A leaf is read as `draft`, look, correct, `transcribe`, and never typed out from the image.

## Why (plain English)

Given garbled text and no picture, a model writes fluent, confident, partly invented prose, and nothing downstream can tell; for a reprint that is the one failure that cannot be repaired. Comparing an image with an existing text ("where do they differ?") cannot invent a paragraph. A session that has read hundreds of pages of one author is exactly where fluent invention appears, so no single pass is trusted.

## What we gave up

Speed: a "clean this up" step that hands back corrected prose would be much quicker. The checking reader is shown the crop before the hypothesis, because a model shown both tends to agree rather than read, so each finding costs a second look.

## Rule for agents

Never add a pass whose output is text. Never type a leaf out from its render. A finding becomes an edit only after a reader with the crop has said what the paper says. Do not collapse the stages into one pass. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 199–242, 1762–1769, 1876–1898; docs/HANDOFF.md §3 and §6.
