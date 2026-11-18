# 0021: Credentials stay in the browser

Status: inherited · Date: 2026-11-18

## Decision

API keys and the shelf token belong to the owner. They are stored only in his browser's local storage and sent straight to the service they are for. They never enter a log, a model prompt, a commit, a book file or the driver's control channel.

## Why (plain English)

There is no server to keep them on (0001), and every file this app writes ends up in a git repository whose history cannot be taken back. A credential that reached a book file would be published the moment the book was saved. For the same reason the Settings panel says out loud when the connected repository is public.

## What we gave up

Convenience: a key has to be entered on each device, and a session cannot be handed a key through the driver.

## Rule for agents

Never log, prompt with, commit, or write a credential into a book file or the control channel. `test/control-protocol.test.ts` and `test/book-file.test.ts` guard the last two; keep them passing. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1856–1858, 2418–2441, 2443–2469; docs/CONTROL.md ("The rules").
