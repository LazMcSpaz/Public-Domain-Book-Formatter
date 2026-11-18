# 0014: Guards against silent loss refuse; they do not warn

Status: inherited · Date: 2026-11-18

## Decision

A guard against silently losing work (rulings, edits, italic and bold markup, the voice card) stops and says why; it does not merely print a warning. Where a deliberate override is legitimate there is an explicit flag. Examples in the code: `drive.mjs save` refuses to write over a book whose rulings or edits it would lose (`--force` for a run meant to replace the file); `correct` refuses a replacement that strips every tag from a block (`--bare` when that is meant) or moves a bare-mark declaration (`--marks-checked`); the shelf flush refuses a file missing a ruling the device saw land (`rulingsMissingFrom`); `voiceLosesWork` refuses a voice card that empties the shelf's.

## Why (plain English)

A warning in a run of forty corrections is a line nobody reads. Refusing costs a reload; writing costs work the editor never learns is gone. Each of these guards exists because the loss happened silently first: another book's run written over the Glossary's file (267 rulings replaced by 100), 188 italic runs stripped by plain-text corrections, the editor's voice card replaced by an empty one.

## What we gave up

Some convenience: a session occasionally has to reload, or pass a flag, for a change it meant.

## Rule for agents

Any new guard against losing rulings, edits, markup or prose throws, with an explicit override flag where one is needed, never only a warning. Pass `--force` only when the run is meant to replace the file. Never save a book you did not load this session, and never save while the editor is working in the app. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 273–296, 363–373, 421–437, 949–954, 1122–1133.
