# 0025: The voice card is the source; the writing agent is its copy

Status: inherited · Date: 2026-11-18

## Decision

The editor's voice card (`voice/<pen-name>.json` on the shelf, read by `scripts/voice.mjs` and by the app) is the source of the editor's voice. `.claude/agents/etsu.md` is the same card compiled into a writing subagent, and is how introductions, notes and glossaries are written: brief it with the book's verified facts and it returns prose in the voice. Where another document, such as `docs/PROCESS-glossary.md`, disagrees with the card, the card wins.

## Why (plain English)

The card is the file the app reads, and it travels with the shelf even where this repository is absent. A writer that holds the rules produces a draft in the voice, rather than one argued into it afterwards. The agent lives in this repository because sessions that run the checks start here, and agent definitions load only when a session starts.

## What we gave up

A single file: two copies must be kept saying the same thing. A fine-tuned model was never used and should not be; the voice is a card plus examples.

## Rule for agents

Change the card first (`voice.mjs set` or `avoid`), then update `.claude/agents/etsu.md` to say the same; never change only one. An agent added mid-session can be used only from the next session. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 178–197, 2168–2182; harness/sorting/part-7.md ("Standing rules inside live files").
