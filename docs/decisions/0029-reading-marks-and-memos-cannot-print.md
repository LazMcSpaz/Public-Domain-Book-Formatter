# 0029: Reading marks and memos cannot print

Status: inherited · Date: 2026-11-18

## Decision

Two kinds of edit are messages about the book, not changes to it: a `highlight` (a passage the editor marked while reading, with a tag and his words) and a `memo` (a note the editor leaves for the assistant, shown on screen as a comment). Both live in the ordinary edit list and travel in `book.json`, but `applyEdits` skips them, so there is no path from either to a printed page; `correctsTheBook` is the one rule that says so. A highlight is located by its quoted words, and its stored offset only chooses between two occurrences; if they disagree the words win and the disagreement is reported. A memo is answered by recording what was done (`drive.mjs memos resolve`) and stays until the editor clears it.

## Why (plain English)

A note to the assistant appearing in a book for sale is the one failure this must make impossible, so it is impossible by construction rather than filtered out at export. Every later correction shifts the characters in a block, so an offset alone would silently come to point at a different sentence. A memo that vanishes reports nothing; one that says what was done can be checked in ten seconds.

## What we gave up

Simpler offset-only anchors. A highlight whose passage was retyped is reported `lost`, with its words kept, rather than silently moved.

## Rule for agents

Never give a highlight or a memo a path into the document. Locate quotations through `findQuote` (`src/core/annotate/schema.ts`); never write a second searcher. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2620–2707; docs/PLAN-editor.md ("The memo"); docs/PLAN-reading.md ("Anchored by the quote, disambiguated by the offset").
