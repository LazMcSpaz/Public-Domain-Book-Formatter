/**
 * Image-engine public surface (SPEC §6). Pure op functions (in ops.ts) operate
 * on RasterImage; raster.ts bridges to the DOM canvas; applyOps re-derives an
 * edited image non-destructively from the original.
 */
export * from './types'
export * from './raster'
export * from './apply-ops'
export * from './ops'
