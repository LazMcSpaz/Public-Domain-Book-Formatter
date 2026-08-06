/**
 * PDF rendering in the browser (replaces the pdftoppm/pdfinfo binaries).
 *
 * Pages are rendered one at a time and released immediately. This matters: a
 * 300-DPI page is ~19 MB as raw pixels, so a 300-page book held in memory at
 * once would be ~5.8 GB. Streaming one page keeps the working set at ~19 MB
 * regardless of book length.
 *
 * Pinned to pdfjs-dist v4 deliberately — v6 relies on JS features that are not
 * yet in every current browser.
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Points per inch in PDF user space. */
const PDF_POINTS_PER_INCH = 72

export interface RenderedPage {
  pageIndex: number
  canvas: HTMLCanvasElement
  width: number
  height: number
  dpi: number
}

/**
 * Open a PDF for rendering.
 *
 * Accepts a Blob/File as well as raw bytes, and that matters: pdf.js
 * *transfers* the ArrayBuffer it is handed, so the caller's copy comes back
 * detached and every later use throws "Cannot perform Construct on a detached
 * ArrayBuffer". The book is opened more than once in a run — recon reads it,
 * then transcription re-renders pages from it — so the source has to survive.
 *
 * Passing a File is the better path: the bytes stay on disk between phases
 * instead of being pinned in the JS heap for the whole session. A raw
 * ArrayBuffer is copied defensively so it, too, stays usable.
 */
export async function openPdf(source: ArrayBuffer | Blob): Promise<PDFDocumentProxy> {
  const data = source instanceof Blob ? await source.arrayBuffer() : source.slice(0)
  return pdfjs.getDocument({ data }).promise
}

/**
 * Render one page to a fresh canvas at the requested DPI.
 * The caller owns the canvas and should drop its reference when done.
 */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  dpi = 300
): Promise<RenderedPage> {
  const page = await doc.getPage(pageIndex + 1) // pdf.js is 1-based
  const viewport = page.getViewport({ scale: dpi / PDF_POINTS_PER_INCH })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not acquire a 2D canvas context')

  // Scans are opaque; without this, transparent areas OCR as black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  page.cleanup()

  return { pageIndex, canvas, width: canvas.width, height: canvas.height, dpi }
}

/**
 * Crop a region out of a rendered page as a PNG object URL — the evidence shown
 * beside every question in the review grids.
 *
 * Object URLs must be released by the caller (`URL.revokeObjectURL`) once the
 * crop is no longer displayed; a book's worth of un-revoked crops leaks.
 */
export async function cropToObjectUrl(
  source: HTMLCanvasElement,
  box: { x0: number; y0: number; x1: number; y1: number },
  padding = 4
): Promise<string> {
  const x = Math.max(0, Math.floor(Math.min(box.x0, box.x1)) - padding)
  const y = Math.max(0, Math.floor(Math.min(box.y0, box.y1)) - padding)
  const w = Math.min(source.width - x, Math.ceil(Math.abs(box.x1 - box.x0)) + padding * 2)
  const h = Math.min(source.height - y, Math.ceil(Math.abs(box.y1 - box.y0)) + padding * 2)
  if (w <= 0 || h <= 0) throw new Error('Empty crop region')

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Could not acquire a 2D canvas context')
  ctx.drawImage(source, x, y, w, h, 0, 0, w, h)

  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode crop')
  return URL.createObjectURL(blob)
}

/** A region cut out of a page, ready to be embedded. */
export interface CroppedRegion {
  bytes: Uint8Array
  width: number
  height: number
}

/**
 * Crop a region out of a rendered page as PNG *bytes*, for embedding.
 *
 * The object-URL crop above is for showing a human; this one is for the PDF, so
 * it returns bytes rather than a URL and carries its own pixel dimensions —
 * which are what the DPI check divides by, and so must be the dimensions of the
 * data that actually gets embedded rather than of the region that was asked for.
 *
 * PNG rather than JPEG on purpose: these are engravings and line art scanned
 * from old paper, where JPEG's ringing around every black line is exactly the
 * artefact that shows up in print.
 */
export async function cropToPngBytes(
  source: HTMLCanvasElement,
  box: { x0: number; y0: number; x1: number; y1: number }
): Promise<CroppedRegion> {
  const x = Math.max(0, Math.floor(Math.min(box.x0, box.x1)))
  const y = Math.max(0, Math.floor(Math.min(box.y0, box.y1)))
  const w = Math.min(source.width - x, Math.ceil(Math.abs(box.x1 - box.x0)))
  const h = Math.min(source.height - y, Math.ceil(Math.abs(box.y1 - box.y0)))
  if (w <= 0 || h <= 0) throw new Error('Empty crop region')

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Could not acquire a 2D canvas context')
  ctx.drawImage(source, x, y, w, h, 0, 0, w, h)

  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode crop')
  const bytes = new Uint8Array(await blob.arrayBuffer())

  // Release before returning: a book of plates otherwise holds one decoded
  // bitmap per crop until the garbage collector gets round to them.
  c.width = 0
  c.height = 0

  return { bytes, width: w, height: h }
}

export interface InkProfile {
  /** Fraction of the region that is ink rather than paper. */
  fraction: number
  /**
   * The inked part of the region, in source pixels — null when there is none.
   *
   * A maximal empty-of-text rectangle usually reaches out to the margins on
   * every side, so the picture inside it may be a fraction of the box. Cropping
   * to the box would set a small drawing in the middle of a large white
   * rectangle, and then scale that rectangle to the measure — which both looks
   * wrong and throws away resolution, because the printed inches are spent on
   * paper. The tight bounds are what make the crop the picture.
   */
  bounds: { x0: number; y0: number; x1: number; y1: number } | null
}

/**
 * How much of a region is ink rather than paper, and where that ink is.
 *
 * `detectRegions` finds rectangles with no *words* in them, which is not the
 * same as rectangles with a picture in them — the margins, the gap under a
 * chapter title and the foot of a short last page all qualify. Only the pixels
 * can tell those apart, and this is the cheapest question that separates them.
 *
 * Measured against the region's **own** paper tone rather than against white:
 * old scans are cream, grey, foxed and unevenly lit, so a fixed threshold reads
 * a whole blank leaf as ink on one book and misses a faint engraving on the
 * next. Taking the light end of the region as its paper makes the test
 * scale-free, which is what lets one number work across scans.
 *
 * Sampled through a downscale rather than read pixel by pixel: a full-page
 * region at 300 DPI is ~9 megapixels, and neither answer needs them.
 */
export function inkProfile(
  source: HTMLCanvasElement,
  box: { x0: number; y0: number; x1: number; y1: number },
  samples = 128
): InkProfile {
  const empty: InkProfile = { fraction: 0, bounds: null }

  const x = Math.max(0, Math.floor(Math.min(box.x0, box.x1)))
  const y = Math.max(0, Math.floor(Math.min(box.y0, box.y1)))
  const w = Math.min(source.width - x, Math.ceil(Math.abs(box.x1 - box.x0)))
  const h = Math.min(source.height - y, Math.ceil(Math.abs(box.y1 - box.y0)))
  if (w <= 0 || h <= 0) return empty

  const cw = Math.max(1, Math.min(samples, w))
  const ch = Math.max(1, Math.min(samples, h))
  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return empty
  ctx.drawImage(source, x, y, w, h, 0, 0, cw, ch)
  const { data } = ctx.getImageData(0, 0, cw, ch)
  c.width = 0
  c.height = 0

  const luminance = new Float64Array(cw * ch)
  for (let i = 0, n = 0; i < data.length; i += 4, n++) {
    luminance[n] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
  }
  if (luminance.length === 0) return empty

  // The light end of the region is its paper. The 90th percentile rather than
  // the maximum, so one blown-out pixel does not define the page.
  const sorted = Float64Array.from(luminance).sort()
  const paper = sorted[Math.floor(sorted.length * 0.9)] ?? 255

  // A margin of 45 puts the line comfortably below scanner noise and paper
  // mottling, and comfortably above the grey a thin line becomes once the
  // downscale has averaged it with the paper around it.
  const threshold = paper - 45

  let inked = 0
  let minC = cw
  let maxC = -1
  let minR = ch
  let maxR = -1
  for (let r = 0; r < ch; r++) {
    for (let col = 0; col < cw; col++) {
      if (luminance[r * cw + col]! >= threshold) continue
      inked++
      if (col < minC) minC = col
      if (col > maxC) maxC = col
      if (r < minR) minR = r
      if (r > maxR) maxR = r
    }
  }
  if (inked === 0) return empty

  // Back to source pixels, padded by one sample cell in each direction so the
  // downscale's own coarseness cannot shave the edge off a drawing.
  const cellW = w / cw
  const cellH = h / ch
  const bounds = {
    x0: Math.max(x, Math.floor(x + (minC - 1) * cellW)),
    y0: Math.max(y, Math.floor(y + (minR - 1) * cellH)),
    x1: Math.min(x + w, Math.ceil(x + (maxC + 2) * cellW)),
    y1: Math.min(y + h, Math.ceil(y + (maxR + 2) * cellH))
  }

  return { fraction: inked / luminance.length, bounds }
}

/** Downscale a page to a thumbnail object URL (front-matter review, page rail). */
export async function thumbnailToObjectUrl(
  source: HTMLCanvasElement,
  maxWidth = 200
): Promise<string> {
  const scale = Math.min(1, maxWidth / source.width)
  const c = document.createElement('canvas')
  c.width = Math.round(source.width * scale)
  c.height = Math.round(source.height * scale)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Could not acquire a 2D canvas context')
  ctx.drawImage(source, 0, 0, c.width, c.height)
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode thumbnail')
  return URL.createObjectURL(blob)
}
