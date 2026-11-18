# 0031: Never invent resolution

Status: inherited · Date: 2026-11-18

## Decision

Picture crops are cut from the scan at the resolution the page is rendered at (`CROP_DPI`, 300, in `src/platform/browser/illustrations.ts`) and placed at exactly that pixel size. A figure's width is set in inches at the size the original printed it, and the KDP image check divides by the placed size.

## Why (plain English)

Rendering a page larger to make the DPI number look better only invents pixels by smoothing. The print is no sharper, and the KDP check that should warn about a low-resolution picture is argued out of its warning.

## What we gave up

Pictures larger than the scan supports. Some pictures carry a low-resolution warning that the owner must accept or fix with a better scan.

## Rule for agents

Never scale a crop up, or render a page larger, to raise its DPI. If a picture is too small, cut it from a better copy of the same printing (`drive.mjs figure cut --from <pdf>`). Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1971–1975, 2973–3008; docs/ARCHITECTURE.md ("Illustrations").
