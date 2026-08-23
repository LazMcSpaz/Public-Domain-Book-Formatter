/**
 * The cover studio's preview.
 *
 * **The preview is the PDF**, exactly as at the design gate: the cover is
 * composed, written to real bytes by `cover-pdf`, and *those bytes* are
 * rasterised with pdf.js. Nothing here approximates a cover in CSS. One
 * renderer is what makes looking at the screen and clicking "download" the same
 * act, and on a cover it matters more than it does inside — an interior has
 * three hundred pages to notice a problem on, and a cover has one chance.
 *
 * It returns the bytes as well as the picture, so the studio's download button
 * hands over the file it just showed rather than building a second one.
 *
 * Browser-only.
 */
import type { ComposedCover, CoverDocument } from '@core/cover'
import { composeCover, validateCover, type CoverValidationReport } from '@core/cover'
import { BUILTIN_ORNAMENTS } from '@core/ornament'
import { fontTableFor } from './fonts'
import { openPdf } from './pdf'
import { renderCoverPdf, type CoverPdfResult } from './cover-pdf'

export interface CoverPreview {
  /** A PNG object URL of the whole flat sheet. **Revoke it** — see `releaseCoverPreview`. */
  url: string
  widthPx: number
  heightPx: number
  bytes: Uint8Array
  composed: ComposedCover
  validation: CoverValidationReport
  pdf: CoverPdfResult
  /** Families asked for but unavailable, mapped to what was used instead. */
  substitutions: [string, string][]
}

export interface CoverPreviewOptions {
  /** Pixels per point. 1 is legible for a whole sheet on screen; 2 for a close look. */
  scale?: number
  /** PNG bytes for the cover's picture, keyed by `CoverArt.id`. */
  images?: ReadonlyMap<string, Uint8Array>
  /** Whether the page count came from the layout engine. Feeds the report. */
  pageCountMeasured?: boolean
  signal?: AbortSignal
}

function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
}

export async function renderCoverPreview(
  doc: CoverDocument,
  options: CoverPreviewOptions = {}
): Promise<CoverPreview> {
  const fonts = await fontTableFor([doc.look.titleFont, doc.look.authorFont, doc.look.bodyFont])
  checkCancelled(options.signal)

  const composed = composeCover(doc, { measurer: fonts, ornaments: BUILTIN_ORNAMENTS })
  const pdf = await renderCoverPdf(composed, fonts, {
    title: doc.content.title,
    author: doc.content.author,
    ...(options.images ? { images: options.images } : {})
  })
  checkCancelled(options.signal)

  const validation = validateCover({
    doc,
    composed,
    fileBytes: pdf.bytes.byteLength,
    fontsEmbedded: pdf.embeddedFamilies.length > 0,
    ...(options.pageCountMeasured === undefined
      ? {}
      : { pageCountMeasured: options.pageCountMeasured })
  })

  const { url, widthPx, heightPx } = await rasterize(pdf.bytes, options.scale ?? 1, options.signal)

  return {
    url,
    widthPx,
    heightPx,
    bytes: pdf.bytes,
    composed,
    validation,
    pdf,
    substitutions: [...fonts.substitutions.entries()]
  }
}

async function rasterize(
  bytes: Uint8Array,
  scale: number,
  signal: AbortSignal | undefined
): Promise<{ url: string; widthPx: number; heightPx: number }> {
  const pdf = await openPdf(bytes.buffer.slice(0) as ArrayBuffer)
  try {
    checkCancelled(signal)
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not acquire a 2D canvas context')
    // Not white: a cover's ground is painted by the composer, and filling white
    // first would hide exactly the failure the bleed check is looking for.
    await page.render({ canvasContext: ctx, viewport }).promise
    page.cleanup()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Could not encode the cover preview')
    return { url: URL.createObjectURL(blob), widthPx: canvas.width, heightPx: canvas.height }
  } finally {
    await pdf.destroy()
  }
}

/** Object URLs leak otherwise — the same rule the page preview runs on. */
export function releaseCoverPreview(preview: CoverPreview | null): void {
  if (!preview) return
  URL.revokeObjectURL(preview.url)
}
