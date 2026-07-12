/**
 * Pure image-op engine (SPEC §6). Operates on plain `RasterImage` RGBA bytes —
 * no DOM/canvas — so it runs in the renderer (via the raster.ts bridge) *and* in
 * the export process, where the persisted op stack is applied to the cropped
 * illustration before it goes into the PDF.
 */
export * from './types'
export * from './pixels'
export * from './apply-ops'
export * from './ops'
