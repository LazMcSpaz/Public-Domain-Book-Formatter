/**
 * crop-image — extract the pixels of a word/region bbox from a full-resolution
 * page image, for the source-image-on-hover popover (SPEC §4).
 *
 * The input is a base64 data URL (from `window.api.getPageImage`, NOT a
 * `local-asset://` URL) so the resulting canvas stays untainted and
 * `toDataURL` works. The bbox is in source-image pixel space (top-left origin),
 * matching the natural pixel dimensions of the page image.
 */
import type { BBox } from '@core/model'

/**
 * Load `dataUrl` into an Image and return a PNG data URL of the `bbox` region,
 * optionally expanded by `padding` pixels on every side (clamped to the image).
 */
export function cropImage(dataUrl: string, bbox: BBox, padding = 0): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const maxX = img.naturalWidth || img.width
        const maxY = img.naturalHeight || img.height

        // Normalize + pad, then clamp to the image bounds.
        const left = Math.max(0, Math.min(bbox.x0, bbox.x1) - padding)
        const top = Math.max(0, Math.min(bbox.y0, bbox.y1) - padding)
        const right = Math.min(maxX, Math.max(bbox.x0, bbox.x1) + padding)
        const bottom = Math.min(maxY, Math.max(bbox.y0, bbox.y1) + padding)

        const width = Math.max(1, Math.round(right - left))
        const height = Math.max(1, Math.round(bottom - top))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('cropImage: 2D canvas context unavailable'))
          return
        }
        ctx.drawImage(
          img,
          Math.round(left),
          Math.round(top),
          width,
          height,
          0,
          0,
          width,
          height
        )
        resolve(canvas.toDataURL('image/png'))
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    img.onerror = () => reject(new Error('cropImage: failed to load source image'))
    img.src = dataUrl
  })
}
