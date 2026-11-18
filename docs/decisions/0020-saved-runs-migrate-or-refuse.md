# 0020: Saved runs migrate or refuse

Status: inherited · Date: 2026-11-18

## Decision

The saved transcription record (`SavedRun`, `src/core/project/saved-run.ts`) carries a schema version, `CURRENT_SCHEMA_VERSION` (23 on 18 November 2026). Any change to its shape bumps the version and extends `migrateSavedRun()`, which upgrades older records step by step and throws rather than return a partial run. The cached OCR reading follows the same rule: it is refused if taken at a different DPI, through a different cleaning preset, or by an older cache version (`RECON_CACHE_VERSION`, 4).

## Why (plain English)

A half-restored transcription looks like a book that was read, and prints with holes in it. Refusing tells the owner something is wrong; a partial load hides it until the book is printed.

## What we gave up

Leniency: an old or damaged record is rejected instead of opened as well as possible. Code note: the old text also said only the paid step is saved; that is no longer true, since the OCR reading is cached and the whole book is saved to the shelf (0005).

## Rule for agents

On any shape change to `SavedRun`, bump `CURRENT_SCHEMA_VERSION`, add the migration step and a test. Never make the migration return a partial run. When the cached reading's shape changes, bump `RECON_CACHE_VERSION`. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2023–2031, 2246–2260; harness/sorting/part-4.md, contradiction 2.
