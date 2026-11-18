# 0016: Report, never drop

Status: inherited · Date: 2026-11-18

## Decision

Anything the layout engine cannot place is reported, never silently dropped and never replaced by a stand-in. Notes that cannot be placed travel as `notesDropped`, pictures as `imagesDropped` and `missingImages`, from the engine to the export screen. A note whose mark is nowhere in the body is collected as an endnote. A placement the engine cannot honour falls back and says so, and a bare-mark declaration with nothing to attach to is reported (`bareMarksMissed`). Nothing is drawn in place of a missing picture.

## Why (plain English)

A missing footnote or picture is otherwise found by a reader after the book is printed and sold. A grey placeholder box in a book for sale is worse than a gap the owner was told about. Silence is the worst failure: a contents page once shipped with no page numbers beside a report saying "warnings: 0".

## What we gave up

A clean-looking export report: some exports carry warnings the owner must read.

## Rule for agents

When adding any fallback, make it report. Never drop a note, picture, declaration or placement silently, and never draw a placeholder. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1423–1425, 1870–1875, 3009–3061; docs/ARCHITECTURE.md ("Ornaments and endnotes").
