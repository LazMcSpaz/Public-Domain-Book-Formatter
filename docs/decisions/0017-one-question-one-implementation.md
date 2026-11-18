# 0017: Two passes that ask one question share one implementation

Status: inherited · Date: 2026-11-18

## Decision

When two parts of the code need the answer to the same question (which characters are a footnote mark, what a chapter's title is without its marks, what the book prints, where a quotation sits in a block, whether an edit changes the book), they call one shared function rather than each working it out. Examples: `footnoteMarkerPattern`, `headingsWithoutMarks`, `printedTexts`, `findQuote`, `correctsTheBook`, `glossaryHeadwords`.

## Why (plain English)

Two passes asking one question with different inputs disagree sooner or later, and nothing reports it. The layout hid table cells from the footnote search while `drive.mjs pairs` did not, so in The Secret Doctrine Vol. I every note after one table printed under the wrong mark. The spelling sheet built its own list of what the book prints and missed the analytical contents, where Amazon's review then found three errors.

## What we gave up

The freedom to write a quick local version. Sometimes the shared function has to be widened to serve a new caller.

## Rule for agents

Before writing logic that answers a question the code already answers, find the existing function and call it; never re-derive it with different inputs. After exporting a book with notes, compare the printed notes with `drive.mjs pairs`. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 532–546, 1274–1295, 2681–2707.
