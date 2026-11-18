# 0022: The driver cannot spend money or carry keys

Status: inherited · Date: 2026-11-18

## Decision

The app can be operated from outside the tab (by `scripts/drive.mjs`, or by the repository bridge), and three rules are enforced in `src/core/control`. Nothing driven can spend money: paid gates stop at a button naming the price, and the one unquoted spend, a leaf marked `redo`, is refused by name (`advanceOutlook`). No credential travels the channel in either direction (`REDACTED_QUESTIONS`). Being driven is visible: while the bridge is live a panel names the session, the last command and its outcome, with a stop button.

## Why (plain English)

The owner decides what is paid for, and a controller has decided nothing. A snapshot that echoed every answer would publish a key. An app that can be operated remotely and shows no sign of it cannot be told apart from one that has been taken over.

## What we gave up

Unattended paid runs: a driven session reports the price and stops for the owner.

## Rule for agents

Never add a verb or command that spends money, sets or reads a credential, or runs the bridge without the on-screen panel. Evidence crosses the channel as a reference the app resolves, never as a `blob:` URL, which means nothing outside the tab that made it. Do not replace without a new decision record.

## Source

docs/CONTROL.md ("The rules", "Why evidence is a ref and not a URL"); docs/archive/CLAUDE-pre-harness.md lines 2443–2469.
