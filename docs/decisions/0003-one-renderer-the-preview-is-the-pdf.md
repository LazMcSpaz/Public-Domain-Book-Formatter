# 0003: One renderer: the preview is the PDF

Status: inherited · Date: 2026-11-18

## Decision

There is one layout engine (`layout()` in `src/core/layout`) and one way of drawing a page: pdf-lib writes real PDF bytes, and every preview of a page shows those bytes as rendered by pdf.js. The design gate's sample pages and the page browser are pictures of the very file that will be uploaded.

## Why (plain English)

If the preview were drawn by a different engine, approving it would mean approving a lookalike, and the printed book could differ in its line breaks, page count or footnote placement. With one engine, what the owner approves on screen is the book. Because `layout()` is pure, re-flowing after a change is simply running it again.

## What we gave up

The original XeLaTeX path, now removed. A Node-only layout platform that would let an agent lay out a book without starting a browser: it was considered and refused, because the driver already runs a browser headlessly. The reading and editing columns are set in a browser font and do not claim to be the page; they may show facts from the engine ("page 47 begins here") but never an imitation of it.

## Rule for agents

Never add a second renderer, a Node layout path or an approximate preview. Lay books out through the browser via `scripts/drive.mjs`. Raise it with the owner only if something truly cannot be done this way. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 72–78, 1976–1980, 2086–2095; docs/PLAN-layout-preview.md ("The idea"); docs/PLAN-editor.md ("The line, restated once"); docs/ARCHITECTURE.md ("One layout, two consumers").
