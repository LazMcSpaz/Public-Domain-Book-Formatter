/**
 * Cutting the crop that goes beside a query, with the passage marked.
 *
 * `planQueryCrop` (core) says which whole lines to take and where the passage
 * is among them; this cuts that rectangle out of a rendered leaf, marks the
 * passage and writes where it is into the JPEG (`withCropNote`), so the query
 * screen can open the crop scrolled to it.
 *
 * **The mark never covers the ink.** The editor is reading 1877 type to decide
 * which of two letters the compositor set, so the passage is marked the way a
 * highlighter marks paper: a pale yellow multiplied over the page, which turns
 * white paper yellow and leaves black ink exactly as black as it was. A box
 * drawn over the words, or a colour laid on top, would be drawn over the very
 * thing being judged.
 *
 * Cut from the original render, never a cleaned one (the folder rule): the
 * crop is evidence of what the page prints.
 *
 * Browser-only.
 */
import { withCropNote, type QueryCropPlan } from '@core/queries'

/** A highlighter's yellow: light enough that multiplied over ink it changes nothing. */
const HIGHLIGHT = 'rgb(255, 232, 130)'

/** Mark the passage on a crop already drawn, without touching the ink. */
export function markPassage(
  ctx: CanvasRenderingContext2D,
  passage: QueryCropPlan['passage'],
  dpi: number
): void {
  // A little beyond the words' boxes, which OCR draws tight to the ink.
  const spread = Math.round(dpi / 50)
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = HIGHLIGHT
  for (const box of passage) {
    ctx.fillRect(
      box.x0 - spread,
      box.y0 - spread,
      box.x1 - box.x0 + 2 * spread,
      box.y1 - box.y0 + 2 * spread
    )
  }
  ctx.restore()
}

/**
 * Cut a planned crop out of a rendered leaf, as JPEG bytes carrying their note.
 *
 * JPEG at 0.9 for the reason `queryCropPath` gives: these are a photograph of
 * paper, and a lossless format for lossy pixels bought nothing.
 */
export async function cutQueryCrop(
  leaf: HTMLCanvasElement,
  plan: QueryCropPlan,
  dpi: number
): Promise<Uint8Array> {
  const { crop } = plan
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, crop.x1 - crop.x0)
  canvas.height = Math.max(1, crop.y1 - crop.y0)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser would not draw the crop.')
  ctx.drawImage(
    leaf,
    crop.x0,
    crop.y0,
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height
  )
  markPassage(ctx, plan.passage, dpi)
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.9))
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('This browser would not encode the crop.')
  return withCropNote(new Uint8Array(await blob.arrayBuffer()), { dpi, passage: plan.passage })
}
