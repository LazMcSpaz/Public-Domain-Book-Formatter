/**
 * The design-gate preview.
 *
 * **The preview is the PDF.** Not a CSS approximation of one: the style is laid
 * out, written to real PDF bytes, and those bytes are rendered by pdf.js — the
 * same library this app already uses to read scans. The round-trip costs a few
 * hundred milliseconds and buys the only guarantee that matters at a gate:
 * what you approve is what you get. A canvas renderer would be faster and would
 * reintroduce the possibility of drift, which is the thing the gate exists to
 * eliminate.
 *
 * Only a sample is laid out. A four-hundred-page book on every radio-button
 * change would make the gate unusable, and four pages answer every question the
 * design interview asks.
 *
 * Browser-only.
 */
import * as pdfjs from 'pdfjs-dist'
import type { BookDocument } from '@core/assemble'
import type { StyleProfile } from '@core/model'
import { englishHyphenator, layout, type LaidOutPage, type LayoutEdition } from '@core/layout'
import { fontTableFor } from './fonts'
import { openPdf } from './pdf'
import { renderPdf } from './pdf-out'

/** Body pages laid out for the preview. Two spreads is enough to judge a style. */
const PREVIEW_BODY_PAGES = 4

/**
 * Which pages the preview shows.
 *
 * Not simply "the first four". A real book opens with a half-title, a blank, a
 * title page and a copyright page — so the first four leaves of the finished
 * PDF are mostly white space, and none of them answers the questions this gate
 * asks. Every one of those questions (typeface, chapter opening, running heads,
 * measure) is settled on a *body* page, with the title page the one piece of
 * front matter worth seeing because the heading face is largest there.
 */
const PREVIEW_KINDS: ReadonlySet<string> = new Set(['title', 'chapter-opener', 'body'])

export interface PreviewPage {
  /** Zero-based index in the finished book, not in the shown sample. */
  index: number
  /** A PNG object URL. **The caller must revoke it** — see `releasePreview`. */
  url: string
  widthPx: number
  heightPx: number
  /** True for a right-hand page, so the pane can lay out spreads correctly. */
  recto: boolean
  folio: string | null
}

export interface PreviewResult {
  pages: PreviewPage[]
  /** Families asked for but unavailable, mapped to what was used instead. */
  substitutions: [string, string][]
}

export interface PreviewOptions {
  edition: LayoutEdition
  /** Pixels per point. 2 is comfortably sharp on a high-DPI display. */
  scale?: number
  signal?: AbortSignal
}

class Cancelled extends Error {}

function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Cancelled('preview cancelled')
}

/**
 * Lay out a sample of the book in a style and render it to page images.
 *
 * Front matter is included because it is most of what the first spreads *are*
 * in a real book, and because the title page is where the heading face is most
 * visible — which is exactly what the period question decides.
 */
export async function renderPreview(
  doc: BookDocument,
  profile: StyleProfile,
  options: PreviewOptions
): Promise<PreviewResult> {
  const fonts = await fontTableFor([profile.bodyFont, profile.headingFont])
  checkCancelled(options.signal)

  const book = layout(doc, profile, fonts, {
    edition: options.edition,
    hyphenate: englishHyphenator(),
    maxBodyPages: PREVIEW_BODY_PAGES
  })
  checkCancelled(options.signal)

  const { bytes } = await renderPdf(book, fonts, {
    title: options.edition.title,
    author: options.edition.author
  })
  checkCancelled(options.signal)

  const shown = book.pages.filter((p) => PREVIEW_KINDS.has(p.kind))
  const pages = await rasterize(bytes, options.scale ?? 2, shown, options.signal)

  return {
    pages,
    substitutions: [...fonts.substitutions.entries()]
  }
}

/** Render the chosen pages of a PDF to PNG object URLs. */
async function rasterize(
  bytes: Uint8Array,
  scale: number,
  shown: readonly LaidOutPage[],
  signal: AbortSignal | undefined
): Promise<PreviewPage[]> {
  // pdf.js detaches the buffer it is given, and these bytes are ours alone at
  // this point — but `openPdf` copies anyway, so the source stays usable.
  const pdf = await openPdf(bytes.buffer.slice(0) as ArrayBuffer)
  const out: PreviewPage[] = []

  try {
    for (const source of shown) {
      checkCancelled(signal)
      const page = await pdf.getPage(source.index + 1)
      const viewport = page.getViewport({ scale })

      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not acquire a 2D canvas context')
      // Paper is white; a PDF page is transparent where nothing is drawn.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      page.cleanup()

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not encode preview page')

      out.push({
        index: source.index,
        url: URL.createObjectURL(blob),
        widthPx: canvas.width,
        heightPx: canvas.height,
        recto: source.side === 'recto',
        folio: source.folio
      })
    }
  } catch (error) {
    // A cancelled or failed render must not leak the pages it already made.
    releasePreview({ pages: out, substitutions: [] })
    throw error
  } finally {
    await pdf.destroy()
  }

  return out
}

/**
 * Revoke a preview's object URLs.
 *
 * Not optional. The gate regenerates the preview on every style change, so a
 * few minutes of a user trying options is dozens of page images; without this
 * they all stay resident for the life of the tab.
 */
export function releasePreview(preview: PreviewResult | null): void {
  if (!preview) return
  for (const page of preview.pages) URL.revokeObjectURL(page.url)
}

/** True when a rejected preview was cancelled rather than broken. */
export function isPreviewCancellation(error: unknown): boolean {
  return error instanceof Cancelled
}

// Re-exported so callers don't need a second import to configure the worker.
export { pdfjs }
