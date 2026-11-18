# 0002: The core stays pure

Status: inherited · Date: 2026-11-18

## Decision

`src/core` holds the book logic as plain TypeScript with no browser features (no `window`, no `document`) and no Node features (no `node:` imports). Work that needs a browser lives in `src/platform/browser`; the React screens live in `src/app`.

## Why (plain English)

Pure code can be tested in seconds without a browser, and the same functions run inside the app, inside the driver and inside the Node shelf scripts. A check written this way does not care whether a person, a model or a script produced what it checks. One browser-only call in the core would break the Node scripts; one Node-only call would break the app.

## What we gave up

Convenience: a core function cannot fetch, draw or read a file itself, so callers pass data in. The old text also said `src/platform/browser` is the only place browser features appear. The code disagrees: `src/app` uses `localStorage` and `navigator` directly (App.tsx, Settings.tsx and others). The rule that actually holds, and that this record keeps, is about `src/core` only.

## Rule for agents

Never import `node:` modules or use browser globals in `src/core`. Prefer a pure function in `src/core` when adding a check. This was checked clean on 18 November 2026, but nothing enforces it: `eslint.config.mjs` gives all of `src/**` browser globals and sets no import limits, so check by hand. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 44–64, 1833–1855; harness/sorting/part-4.md, contradictions 5 and 7.
