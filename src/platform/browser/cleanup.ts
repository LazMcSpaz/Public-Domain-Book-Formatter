/**
 * Cleaning a rendered leaf for the OCR engine — the platform half.
 *
 * `@core/image/cleanup` chooses the ops from the leaf's own tones; this file
 * reads those tones off a canvas, applies the ops, and hands the engine the
 * result. It is the **one read path**: recon and `drive.mjs ocr … fresh` both
 * go through `recognizeLeaf`, so the verb measures what recon does.
 *
 * What it must never do is let the cleaned pixels reach anything but the
 * engine. The caller keeps the original canvas and cuts every crop,
 * thumbnail and illustration candidate from that; the cleaned canvas is
 * released here before `recognizeLeaf` returns. And a cleaned canvas whose
 * size differs from the render is refused outright, because every word box
 * the engine returns is in the pixels it was shown and the coordinate map
 * assumes those are the page's.
 */
import { applyOps, luma } from '@core/image/engine'
import { cleanupOps, pageTones, type CleanupPreset } from '@core/image/cleanup'
import type { OcrEngine, OcrPageResult } from './ocr'

/** Width of the downscale the histogram is read through. */
const HISTOGRAM_SAMPLE = 320

/**
 * The leaf's luminance histogram, 256 bins, read through a downscale.
 *
 * A downscale rather than the full render for the reason `inkProfile` uses
 * one: a 300-DPI page is eight million pixels and the histogram of a
 * 320-pixel-wide copy has the same shape to the bin. Drawing into a small
 * canvas averages neighbourhoods, which softens stroke edges a little and
 * moves neither the paper peak nor the ink tail.
 */
export function luminanceHistogram(canvas: HTMLCanvasElement): Uint32Array {
  const scale = Math.min(1, HISTOGRAM_SAMPLE / Math.max(1, canvas.width))
  const w = Math.max(1, Math.round(canvas.width * scale))
  const h = Math.max(1, Math.round(canvas.height * scale))
  const small = document.createElement('canvas')
  small.width = w
  small.height = h
  const ctx = small.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not acquire a 2D canvas context')
  ctx.drawImage(canvas, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  small.width = 0
  small.height = 0
  const bins = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    bins[Math.round(luma(data[i]!, data[i + 1]!, data[i + 2]!))]! += 1
  }
  return bins
}

/**
 * The leaf as the engine should see it, or null when the preset is `off`.
 *
 * A fresh canvas of exactly the render's size. The caller releases it (set
 * both dimensions to 0) as soon as the engine has read it; a 300-DPI page is
 * some 33 MB of pixels and recon runs on phones.
 */
export function cleanedForOcr(
  canvas: HTMLCanvasElement,
  preset: CleanupPreset
): HTMLCanvasElement | null {
  if (preset === 'off') return null
  const ops = cleanupOps(preset, pageTones(luminanceHistogram(canvas)))
  if (ops.length === 0) return null
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not acquire a 2D canvas context')
  const source = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const result = applyOps({ width: source.width, height: source.height, data: source.data }, ops)
  if (result.width !== canvas.width || result.height !== canvas.height) {
    // Rule 2 of the plan, enforced where it would otherwise fail silently:
    // a resized page puts every word box somewhere else.
    throw new Error(
      `Cleaning changed the page's size (${canvas.width}×${canvas.height} → ` +
        `${result.width}×${result.height}); no preset may.`
    )
  }
  const out = document.createElement('canvas')
  out.width = result.width
  out.height = result.height
  const outCtx = out.getContext('2d')
  if (!outCtx) throw new Error('Could not acquire a 2D canvas context')
  outCtx.putImageData(
    new ImageData(new Uint8ClampedArray(result.data), result.width, result.height),
    0,
    0
  )
  return out
}

export interface LeafReading extends OcrPageResult {
  /** The preset the engine read through. */
  cleanup: CleanupPreset
  /** Time spent cleaning, before the engine saw the leaf. 0 for `off`. */
  cleanupMs: number
  /** Time the engine took. */
  ocrMs: number
}

/**
 * Read one leaf: clean it as the preset says, hand the engine the cleaned
 * pixels, and release them. The original canvas is untouched and is what the
 * caller cuts its evidence from.
 */
export async function recognizeLeaf(
  engine: OcrEngine,
  canvas: HTMLCanvasElement,
  pageIndex: number,
  cleanup: CleanupPreset
): Promise<LeafReading> {
  const t0 = performance.now()
  const cleaned = cleanedForOcr(canvas, cleanup)
  const t1 = performance.now()
  try {
    const result = await engine.recognize(cleaned ?? canvas, pageIndex)
    return { ...result, cleanup, cleanupMs: t1 - t0, ocrMs: performance.now() - t1 }
  } finally {
    if (cleaned) {
      cleaned.width = 0
      cleaned.height = 0
    }
  }
}
