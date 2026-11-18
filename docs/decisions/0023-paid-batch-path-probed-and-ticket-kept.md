# 0023: The paid batch path is probed, and its ticket kept

Status: inherited · Date: 2026-11-18

## Decision

The Anthropic Message Batches path (a whole book submitted at once, at half price, with the tab free to close) is built, but offered only when a once-per-session probe (`src/platform/browser/batch-reach.ts`) finds the endpoint reachable from a browser. Today it is not. When a batch is submitted, its ticket (`src/core/project/batch-ticket.ts`) is written after each batch is created and before the next page is rendered; a failed ticket write stops the submission; the ticket is deleted only when every page is in the run, and is never capped, evicted or cleared.

## Why (plain English)

A hard-coded "off" would stay wrong the day the API starts allowing browsers, and nothing would notice. A batch id is the only address of work already paid for: everything else the app stores costs time to replace, and this costs money.

## What we gave up

A proxy server that would open the door now (ruled out by 0001). Books are now read in chat sessions without the API (0006), so this path serves wizard users only.

## Rule for agents

Keep the offer behind the probe; never hard-code it on, and never add a proxy. Never cap, evict or clear the batch ticket, including under the "don't keep book data on this device" setting. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2004–2022, 2340–2364.
