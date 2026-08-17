/**
 * A page of the scan, as the base64 PNG the API wants.
 *
 * One implementation, used by both doors — the live runner sends these one at a
 * time and the batch submitter packs them into chunks. The size of this image
 * is the largest single lever on what a book costs, so having two renderers
 * would mean two prices for the same page.
 *
 * Browser-only.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { renderPage } from './pdf'

/** Canvas → bare base64 (no data: prefix), which is what the API expects. */
export async function toBase64Png(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode page image')
  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000 // chunked to avoid blowing the argument limit on big pages
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Render one leaf at the DPI that yields the requested long edge.
 *
 * Scaled to *our* setting rather than to the source page's dimensions, so a
 * book of oversized plates costs what a book of octavo leaves costs. Both
 * canvases are released before returning; only the base64 survives, and the
 * caller drops that as soon as it is sent.
 */
export async function renderPageToBase64(
  doc: PDFDocumentProxy,
  pageIndex: number,
  longEdge: number
): Promise<string> {
  const probe = await renderPage(doc, pageIndex, 72)
  const scale = longEdge / Math.max(probe.width, probe.height)
  probe.canvas.width = 0
  probe.canvas.height = 0

  const rendered = await renderPage(doc, pageIndex, Math.max(72, Math.round(72 * scale)))
  try {
    return await toBase64Png(rendered.canvas)
  } finally {
    rendered.canvas.width = 0
    rendered.canvas.height = 0
  }
}
