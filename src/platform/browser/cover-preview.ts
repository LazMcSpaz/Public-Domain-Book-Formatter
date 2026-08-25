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
import { composeCover, PRESS_MARK_ID, validateCover, type CoverValidationReport } from '@core/cover'
import { BUILTIN_ORNAMENTS } from '@core/ornament'
import { fontTableFor } from './fonts'
import { openPdf } from './pdf'
import { renderCoverPdf, type CoverPdfResult } from './cover-pdf'
import { renderPressMark } from './press-mark'

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

  // The press mark is rendered here rather than supplied by the caller,
  // because its pixels depend on where the composer put it: the size is read
  // back off the placed rectangle so the device is drawn at the resolution it
  // prints at, and tinted with the look's own accent.
  const images = new Map(options.images ?? [])
  const markItem = composed.items.find((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)
  if (markItem && markItem.kind === 'image' && doc.look.pressMark) {
    const mark = await renderPressMark({
      dataUrl: doc.look.pressMark.dataUrl,
      widthIn: markItem.widthPt / 72,
      heightIn: markItem.heightPt / 72,
      color: doc.look.palette.accent
    })
    images.set(PRESS_MARK_ID, mark.bytes)
    // The composer sized the item from the *source's* proportions; the raster
    // may have fewer pixels than were asked for, and the writer crops by the
    // source rectangle, so it has to be told what actually came back.
    markItem.srcWidth = mark.widthPx
    markItem.srcHeight = mark.heightPx
  }

  const pdf = await renderCoverPdf(composed, fonts, {
    title: doc.content.title,
    author: doc.content.author,
    images
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
