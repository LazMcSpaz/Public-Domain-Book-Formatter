/**
 * applyOps — re-derive an edited image from the original by applying an ordered
 * op list (SPEC §6 non-destructive editing).
 *
 * STEP 0 STUB: the real per-op implementations (crop/rotate/levels/curves/
 * grayscale/threshold/despeckle/removeBackground) are added by the
 * core-algorithms work, alongside unit tests on RasterImage fixtures. This stub
 * returns an untouched copy so the engine API + consumers compile.
 */
import type { ImageEditOp } from '@core/model'
import type { RasterImage } from './types'

export function applyOps(source: RasterImage, _ops: readonly ImageEditOp[]): RasterImage {
  return {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.data)
  }
}
