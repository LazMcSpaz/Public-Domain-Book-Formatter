/**
 * Conversions between the DOM `ImageData` (canvas) and the engine's plain
 * `RasterImage`. Renderer-only (uses the `ImageData` constructor); the pure op
 * functions in the engine operate on `RasterImage` and stay testable in Node.
 */
import type { RasterImage } from '@core/image'

export function fromImageData(img: ImageData): RasterImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
}

export function toImageData(raster: RasterImage): ImageData {
  // Copy into a fresh ArrayBuffer-backed array (satisfies ImageData's typing and
  // avoids aliasing the engine's buffer into the canvas).
  const buffer = new Uint8ClampedArray(raster.data.length)
  buffer.set(raster.data)
  return new ImageData(buffer, raster.width, raster.height)
}
