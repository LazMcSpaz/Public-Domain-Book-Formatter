# 0032: Non-destructive picture editing, no background removal

Status: inherited · Date: 2026-11-18

## Decision

Pictures are retouched without changing their original pixels: crop, straighten, brightness, contrast, levels, despeckle, grey and threshold are stored as a list of operations and re-applied over the original every time (`src/core/image/engine`, `src/app/ImageEditor.tsx`). Only the resulting size is computed in the core (`sizeAfterOps`), because the DPI check divides by it. Background removal is not offered.

## Why (plain English)

With the original untouched, any edit can be undone or changed later and nothing is lost. Background removal is reliable on clean, even paper and unreliable on foxed or unevenly lit scans; without hand touch-up of the selection it is a magic button that quietly eats part of the picture.

## What we gave up

SPEC.md §6 planned a "smart wand" background removal with a tolerance slider and manual touch-up; it was left out. Code note: the core engine still contains a `removeBackground` operation (`src/core/image/engine/ops.ts`, `apply-ops.ts`) that nothing in the app offers. Removing it is a cleanup candidate, not a decision.

## Rule for agents

Do not offer background removal unless the owner asks for it and accepts manual touch-up of the selection. Never write retouches back into the original pixels. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2123–2130; SPEC.md §6; src/app/ImageEditor.tsx (header comment).
