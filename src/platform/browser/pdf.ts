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
  dpi = 300,
  options: { wholeImage?: boolean } = {}
): Promise<RenderedPage> {
  const page = await doc.getPage(pageIndex + 1) // pdf.js is 1-based
  const scale = dpi / PDF_POINTS_PER_INCH

  // Normally the page box *is* the leaf and this is one line. It is not always:
  // a scan can be placed larger than the box it sits in, and then the page
  // shows a window onto the middle of the leaf while the rest is cut off — the
  // render, the word boxes and every crop silently of a fragment. `wholeImage`
  // widens the canvas to whatever is actually drawn and shifts the origin so
  // the overhang lands on it.
  //
  // This adds no resolution: every pixel still comes off the scan at `dpi`, and
  // what changes is how much of the scan is inside the frame. That distinction
  // is the whole of the never-invent-resolution rule.
  let offsetX = 0
  let offsetY = 0
  let viewport = page.getViewport({ scale })
  let width = Math.ceil(viewport.width)
  let height = Math.ceil(viewport.height)

  if (options.wholeImage) {
    const extent = await pageImageExtent(doc, pageIndex)
    if (extent.drawn && extent.clipped) {
      const x0 = Math.min(0, extent.drawn.x0)
      const y0 = Math.min(0, extent.drawn.y0)
      offsetX = -x0 * scale
      offsetY = -y0 * scale
      width = Math.ceil((Math.max(extent.page.width, extent.drawn.x1) - x0) * scale)
      height = Math.ceil((Math.max(extent.page.height, extent.drawn.y1) - y0) * scale)
      viewport = page.getViewport({ scale, offsetX, offsetY })
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
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

/**
 * Render one page to an object URL big enough to *read*.
 *
 * The thumbnails recon keeps are ~200px wide, which is right for picking a page
 * out of a rail and useless for proofreading against — the whole point of the
 * proof sheet is comparing words, and at that size there are no words. Storing
 * legible renders for every page instead is not an option either: a 300-page
 * book at this size would be well over a hundred megabytes held for the session.
 *
 * So it is rendered on demand, one leaf at a time, and released when the user
 * moves on — the same discipline recon follows for the same reason.
 *
 * **The caller must revoke the URL** when it is no longer displayed.
 */
export async function renderPageToObjectUrl(
  source: Blob,
  pageIndex: number,
  dpi = 140
): Promise<string> {
  const doc = await openPdf(source)
  try {
    const rendered = await renderPage(doc, pageIndex, dpi)
    const blob = await new Promise<Blob | null>((resolve) =>
      rendered.canvas.toBlob(resolve, 'image/png')
    )
    rendered.canvas.width = 0
    rendered.canvas.height = 0
    if (!blob) throw new Error('Could not encode the page')
    return URL.createObjectURL(blob)
  } finally {
    await doc.destroy()
  }
}

/**
 * Where the pictures on a page actually land, in page units.
 *
 * `pageMakeup` asks how *much* of the page an image covers, which is the right
 * question for "is this a scan". It cannot answer the other one: whether the
 * image is **inside** the page at all.
 *
 * Two leaves of *The Human Aura* are drawn about three times page size and
 * offset, so the page box shows a window onto the middle of the leaf. Every
 * downstream thing then quietly worked on a fragment: the render is a crop, the
 * word boxes are of a crop, Tesseract read nothing at all off one of them, and
 * the leaf reported as empty — indistinguishable from a blank. That is the
 * failure this module keeps naming in other places and had no name for here.
 *
 * The box comes back in the same units as `getViewport({ scale: 1 })`, with the
 * page's own box as the origin: `x0 < 0` or `x1 > width` means content is being
 * cut off, and by how much.
 */
export interface ImageExtent {
  /** The page's own box, at scale 1. */
  page: { width: number; height: number }
  /** The union of every image drawn, in the same units. Null when none is. */
  drawn: { x0: number; y0: number; x1: number; y1: number } | null
  /** How much of the drawn image the page box actually shows, 0–1. */
  visible: number
  /** True when any part of an image falls outside the page box. */
  clipped: boolean
}

export async function pageImageExtent(
  doc: PDFDocumentProxy,
  pageIndex: number
): Promise<ImageExtent> {
  const page = await doc.getPage(pageIndex + 1)
  try {
    const viewport = page.getViewport({ scale: 1 })
    const size = { width: viewport.width, height: viewport.height }
    const ops = await page.getOperatorList()

    let ctm: number[] = [1, 0, 0, 1, 0, 0]
    const stack: number[][] = []
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]
      if (fn === pdfjs.OPS.save) {
        stack.push([...ctm])
        continue
      }
      if (fn === pdfjs.OPS.restore) {
        ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
        continue
      }
      if (fn === pdfjs.OPS.transform) {
        ctm = pdfjs.Util.transform(ctm, ops.argsArray[i] as number[])
        continue
      }
      // A form XObject carries its own matrix, and pdf.js delivers it as its
      // own opcode rather than as a `transform`. Missing it is not a rounding
      // error: this book paints its scans inside a form scaled roughly 2:1, so
      // every leaf measured as twice page size and 45% visible — including the
      // ones that render perfectly. `pageMakeup` has the same blind spot and
      // survives it only because its threshold is loose.
      if (fn === pdfjs.OPS.paintFormXObjectBegin) {
        stack.push([...ctm])
        const [matrix] = ops.argsArray[i] as [number[], number[]]
        if (Array.isArray(matrix)) ctm = pdfjs.Util.transform(ctm, matrix)
        continue
      }
      if (fn === pdfjs.OPS.paintFormXObjectEnd) {
        ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
        continue
      }
      const isImage =
        fn === pdfjs.OPS.paintImageXObject ||
        fn === pdfjs.OPS.paintImageMaskXObject ||
        fn === pdfjs.OPS.paintInlineImageXObject
      if (!isImage) continue

      // An image is always painted into the unit square, so its four corners
      // through the current matrix are its drawn corners. All four, not two:
      // a rotated or flipped placement has no axis-aligned pair to shortcut to.
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1]
      ].map(([u, v]) => pdfjs.Util.applyTransform([u!, v!], ctm))
      for (const [x, y] of corners) {
        // PDF space has y up and the viewport has y down; the flip is what the
        // page's own transform does, so it is applied here rather than assumed.
        const py = size.height - (y ?? 0)
        box = box
          ? {
              x0: Math.min(box.x0, x ?? 0),
              y0: Math.min(box.y0, py),
              x1: Math.max(box.x1, x ?? 0),
              y1: Math.max(box.y1, py)
            }
          : { x0: x ?? 0, y0: py, x1: x ?? 0, y1: py }
      }
    }

    if (!box) return { page: size, drawn: null, visible: 1, clipped: false }

    const drawnArea = Math.max(1e-6, (box.x1 - box.x0) * (box.y1 - box.y0))
    const shownWidth = Math.max(0, Math.min(box.x1, size.width) - Math.max(box.x0, 0))
    const shownHeight = Math.max(0, Math.min(box.y1, size.height) - Math.max(box.y0, 0))
    return {
      page: size,
      drawn: box,
      visible: (shownWidth * shownHeight) / drawnArea,
      // A hair of overhang is how a scan is normally placed — bled slightly past
      // the trim so no white edge shows. A tenth of the image is not that.
      clipped: (shownWidth * shownHeight) / drawnArea < 0.99
    }
  } finally {
    page.cleanup()
  }
}

/**
 * What a page is made of: pictures, text, or a picture with text laid over it.
 *
 * This is the check that decides whether a PDF needs reading at all, and it is
 * **structural rather than statistical** on purpose. Judging the text layer by
 * how its words look cannot work: good OCR of a clean scan is made of
 * `chirnrgeon` and `thc`, which are shaped exactly like words. But a scanned
 * page *is a photograph* with invisible text placed on top of it, and a
 * born-digital page is not — and that is a fact about the file rather than a
 * guess about its contents.
 *
 * So: does one image cover most of the page? Then whatever text is there was
 * produced by somebody's OCR, and this app should read the pixels itself.
 */
export interface PageMakeup {
  /** True when a single image covers most of the page — i.e. it is a scan. */
  scanned: boolean
  /** Characters of embedded text, whoever produced it. */
  textLength: number
  /** Fraction of the page covered by the largest image drawn on it. */
  imageCoverage: number
}

export async function pageMakeup(doc: PDFDocumentProxy, pageIndex: number): Promise<PageMakeup> {
  const page = await doc.getPage(pageIndex + 1)
  try {
    const viewport = page.getViewport({ scale: 1 })
    const area = Math.max(1, viewport.width * viewport.height)

    const ops = await page.getOperatorList()
    let largest = 0
    // The drawn size of an image is the *current transformation matrix* at the
    // moment it is painted — an image is always drawn into the unit square, so
    // the matrix's determinant is the area it covers. Walking back to find "the
    // transform before the paint" reads the image's own pixel dimensions
    // instead, which is a fact about the file and not about the page.
    let ctm: number[] = [1, 0, 0, 1, 0, 0]
    const stack: number[][] = []

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]
      if (fn === pdfjs.OPS.save) {
        stack.push([...ctm])
        continue
      }
      if (fn === pdfjs.OPS.restore) {
        ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
        continue
      }
      if (fn === pdfjs.OPS.transform) {
        ctm = pdfjs.Util.transform(ctm, ops.argsArray[i] as number[])
        continue
      }
      // A form XObject carries its own matrix, and pdf.js delivers it as its
      // own opcode rather than as a `transform`. Missing it is not a rounding
      // error: this book paints its scans inside a form scaled roughly 2:1, so
      // every leaf measured as twice page size and 45% visible — including the
      // ones that render perfectly. `pageMakeup` has the same blind spot and
      // survives it only because its threshold is loose.
      if (fn === pdfjs.OPS.paintFormXObjectBegin) {
        stack.push([...ctm])
        const [matrix] = ops.argsArray[i] as [number[], number[]]
        if (Array.isArray(matrix)) ctm = pdfjs.Util.transform(ctm, matrix)
        continue
      }
      if (fn === pdfjs.OPS.paintFormXObjectEnd) {
        ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
        continue
      }
      const isImage =
        fn === pdfjs.OPS.paintImageXObject ||
        fn === pdfjs.OPS.paintImageMaskXObject ||
        fn === pdfjs.OPS.paintInlineImageXObject
      if (!isImage) continue
      const determinant = Math.abs((ctm[0] ?? 0) * (ctm[3] ?? 0) - (ctm[1] ?? 0) * (ctm[2] ?? 0))
      largest = Math.max(largest, determinant / area)
    }

    const content = await page.getTextContent()
    const textLength = content.items.reduce(
      (n, item) => n + ('str' in item ? item.str.length : 0),
      0
    )

    // Two thirds rather than nearly all: a scan is often placed with a margin,
    // and a decorative header on a born-digital page never reaches it.
    return { scanned: largest >= 0.66, textLength, imageCoverage: largest }
  } finally {
    page.cleanup()
  }
}

/** What a sample of the book's pages are made of. */
export interface PdfMakeup {
  /** True when most sampled pages are a photograph with text over them. */
  scanned: boolean
  /** Mean characters of embedded text per sampled page. */
  textPerPage: number
  sampled: number
}

/**
 * Whether this PDF is a scan, sampled across the book.
 *
 * Sampled rather than read whole because opening three hundred operator lists
 * to answer a yes/no question costs more than it tells. Evenly spaced, because
 * a scanned book often opens with a typed title page and one such leaf must not
 * make the other three hundred look born-digital.
 */
export async function looksScanned(doc: PDFDocumentProxy, sample = 8): Promise<PdfMakeup> {
  const total = doc.numPages
  const step = Math.max(1, Math.floor(total / Math.min(sample, total)))
  let scannedPages = 0
  let sampled = 0
  let text = 0

  for (let i = 0; i < total && sampled < sample; i += step) {
    const makeup = await pageMakeup(doc, i)
    sampled += 1
    text += makeup.textLength
    if (makeup.scanned) scannedPages += 1
  }

  return { scanned: scannedPages * 2 > sampled, textPerPage: text / Math.max(1, sampled), sampled }
}

/** A word the PDF itself supplied, shaped as everything downstream expects. */
export interface EmbeddedWord {
  id: string
  text: string
  confidence: number
  pageIndex: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * The text a PDF already contains, as words with boxes.
 *
 * Shaped as an OCR word on purpose. Everything downstream — the coordinate map,
 * the lexicon, illustration detection, the cross-checks — is written against
 * word boxes, and text the file itself supplies is simply a *better* source of
 * them than Tesseract. Confidence is 100 because this is not a reading: it is
 * what the file says it says.
 *
 * pdf.js hands back runs rather than words, so a run is split on spaces and its
 * width shared out by character count. That approximates where each word sits,
 * which is all the coordinate map and the ink test need of it.
 */
export async function extractPageWords(
  doc: PDFDocumentProxy,
  pageIndex: number,
  dpi: number
): Promise<{ words: EmbeddedWord[]; text: string }> {
  const page = await doc.getPage(pageIndex + 1)
  const scale = dpi / PDF_POINTS_PER_INCH
  try {
    const viewport = page.getViewport({ scale })
    const content = await page.getTextContent()

    const words: EmbeddedWord[] = []
    const lines: string[] = []
    let n = 0

    for (const item of content.items) {
      if (!('str' in item)) continue
      const raw = item.str
      if (raw.trim().length === 0) {
        if (item.hasEOL) lines.push('\n')
        continue
      }

      const t = pdfjs.Util.transform(viewport.transform, item.transform)
      const x = t[4] ?? 0
      // The transform puts the origin on the baseline; a box wants the top.
      const height = Math.abs(item.height || 10) * scale
      const y = (t[5] ?? 0) - height
      const width = (item.width || 0) * scale
      const perChar = raw.length > 0 ? width / raw.length : 0

      let offset = 0
      for (const part of raw.split(/(\s+)/u)) {
        if (part.trim().length > 0) {
          words.push({
            id: `p${pageIndex}_e${n++}`,
            text: part,
            confidence: 100,
            pageIndex,
            bbox: {
              x0: x + offset * perChar,
              y0: y,
              x1: x + (offset + part.length) * perChar,
              y1: y + height
            }
          })
        }
        offset += part.length
      }
      lines.push(raw)
      if (item.hasEOL) lines.push('\n')
    }

    return {
      words,
      text: lines
        .join(' ')
        .replace(/ *\n */gu, '\n')
        .trim()
    }
  } finally {
    page.cleanup()
  }
}

/**
 * Downscale a page to a thumbnail Blob.
 *
 * The Blob rather than a URL made from it, because a reading that is stored and
 * resumed needs the bytes: an object URL names a Blob in a page that may have
 * been closed since. Callers that only want to show it make the URL themselves.
 */
export async function thumbnailToBlob(source: HTMLCanvasElement, maxWidth = 200): Promise<Blob> {
  const scale = Math.min(1, maxWidth / source.width)
  const c = document.createElement('canvas')
  c.width = Math.round(source.width * scale)
  c.height = Math.round(source.height * scale)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Could not acquire a 2D canvas context')
  ctx.drawImage(source, 0, 0, c.width, c.height)
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode thumbnail')
  return blob
}

/** The Blob behind a live object URL, or null once it has been revoked. */
export async function blobOfUrl(url: string): Promise<Blob | null> {
  try {
    return await (await fetch(url)).blob()
  } catch {
    return null
  }
}

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
