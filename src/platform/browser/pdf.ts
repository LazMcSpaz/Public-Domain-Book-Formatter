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

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
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
