/**
 * Image-engine types (SPEC §6). The engine is a non-destructive op stack: ops
 * are re-applied over the ORIGINAL pixels every time, so edits never mutate the
 * source and can always be re-derived.
 *
 * The engine works on a plain `RasterImage` (RGBA bytes) rather than the DOM
 * `ImageData` so the pure op functions are unit-testable in Node, where no
 * canvas exists. `raster.ts` converts to/from `ImageData` in the renderer.
 */
import type { ImageEditOp } from '@core/model'

/** A decoded RGBA bitmap: `data.length === width * height * 4`. */
export interface RasterImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** Apply an ordered op list over a source image, returning a new RasterImage. */
export type ApplyOps = (source: RasterImage, ops: readonly ImageEditOp[]) => RasterImage
