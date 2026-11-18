# 0027: Correct content, never presentation

Status: inherited · Date: 2026-11-18

## Decision

The proof step and the book editor fix what the page says and what a block is: fix a word, retype a block (heading, footnote, caption), split, merge, drop, move a picture. They deliberately offer no per-paragraph indent, size or spacing, and no manual line or page break. A paragraph needing different treatment gets a different kind, which the style profile then sets consistently. The editor shows the true breaks, measured by the engine, but offers no button to place one.

## Why (plain English)

The book reflows to whatever measure the design gate settles on, so a hand-placed break is a statement about one particular layout and goes stale as soon as anything before it changes. Rules (widow and orphan control, chapters opening on a right-hand page, room for footnotes) survive reflow where hand breaks rot.

## What we gave up

Word-processor control over a single page. An unusual layout needs a new kind or a style rule instead of a quick fix.

## Rule for agents

Never add per-block formatting, manual line or page breaks, or a second store for editor state. Every keystroke in the editor must produce the same edit the proof sheet or `drive.mjs correct` would. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1826–1831; docs/PLAN-editor.md ("The line, restated once", "What was deliberately not built"); docs/ARCHITECTURE.md ("Correcting what was read").
