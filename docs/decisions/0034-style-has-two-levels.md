# 0034: Style has two levels: the reusable look and the book's facts

Status: inherited · Date: 2026-11-18

## Decision

A saved style profile is the reusable look (trim size, margins, faces and sizes, heading style, running heads, ornaments), which can be banked once and offered on every later book; the imprint and copyright holder ride along with it. Per-book facts (title, ISBN, edition statement, publication date, chapter structure) never travel with a saved look. Which fields may be banked is fixed in code by `BANKED_STYLE_KEYS` (`src/core/style/saved-profile.ts`).

## Why (plain English)

Book two in a series should look right with one question instead of five. But a field that slipped into the saved look by accident, such as a title, would print the wrong name on the next book's title page.

## What we gave up

Copying all settings freely from one book to the next.

## Rule for agents

When adding a field to `StyleProfile`, decide which level it belongs to and add it to `BANKED_STYLE_KEYS` or leave it out; `test/saved-profile.test.ts` fails until someone decides. Never bank the ISBN, edition statement or publication date. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2131–2139; SPEC.md §7 ("Two-level separation").
