# 0048: Playwright drives a headless browser for the agent and the checks

Status: inherited · Date: 2026-11-18

## Decision

Playwright (`^1.62.1`) with its Chromium drives the app headlessly: `scripts/drive.mjs`, the agent's door into the app (0006); `scripts/screenshot-flow.mjs` and the other screenshot scripts; and the `npm run check:*` measurements (install, outbox, crop, proposals, held, cache, queue). It is a development dependency; the app never loads it.

## Why (plain English)

Rendering, OCR and layout need a real browser. A headless one lets a session use the same engine the owner sees, so nothing needs a second renderer (0003), and lets interface changes be checked by screenshot instead of shipped blind. Some faults can only be measured in a real page.

## What we gave up

A Node-only path, refused in 0003. Chromium does not reproduce every Safari fault (the iPad's cache fault could not be shown in it), so some checks play the faulty behaviour with a stub instead.

## Rule for agents

Reach the browser through `drive.mjs` verbs rather than one-off scripts. Check interface changes with the screenshot scripts before shipping. On Windows, Chromium must first be installed with `node node_modules/playwright/cli.js install chromium`. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 44–55, 336–345, 1192–1206, 1487–1520, 2068–2073.
