/**
 * Laid-out pages → PDF bytes.
 *
 * This is a *writer*, not a typesetter: every position it draws at was decided
 * by `@core/layout` and is copied through untouched. That is what makes the
 * design-gate preview trustworthy, because the preview renders these same bytes
 * — there is no second opinion about where anything goes.
 *
 * Two conversions happen here and nowhere else:
 *   - the origin flips, from the engine's top-left (y down) to PDF's
 *     bottom-left (y up);
 *   - font *references* become embedded font *objects*.
 *
 * Browser-only: pdf-lib and fontkit.
 */
import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { FontRef, LaidOutBook, LaidOutPage } from '@core/layout'
import { LAYOUT_FEATURES, type FontTable } from './fonts'

export interface PdfResult {
  bytes: Uint8Array
  pageCount: number
  /** Families that were embedded, for the KDP "fonts embedded" check. */
  embeddedFamilies: string[]
}

export interface RenderPdfOptions {
  title?: string
  author?: string
  /** Called after each page, so a long export can show progress and yield. */
  onPage?: (done: number, total: number) => void | Promise<void>
}

function keyOf(font: FontRef): string {
  return `${font.family}|${font.style}`
}

/**
 * Draw a laid-out book into a PDF.
 *
 * ## Why fonts are embedded whole, not subset
 *
 * The obvious economy here is `embedFont(bytes, { subset: true })` — a book
 * touches a few hundred glyphs of a face that carries thousands. It was tried
 * and it is **not safe**: pdf-lib 1.17.1's subsetter silently corrupts the
 * `glyf`/`loca` tables of three of the six faces this app offers. Rendered
 * side by side against an unsubset embed of the same text:
 *
 *   EB Garamond, Cardo, IM FELL English  →  most letters missing
 *   Libre Baskerville, Libre Caslon, Crimson Pro  →  correct
 *
 * The failure is invisible everywhere it would be caught: the page count is
 * right, the text extracts correctly (the `ToUnicode` map survives), and the
 * KDP checks pass. Only the printed page is wrong — the reader gets a book with
 * holes in the words. For an app whose entire output is a book someone sells,
 * that is the worst failure mode available, and it is not worth a megabyte.
 *
 * The cost of embedding whole is about 900 KB for a regular/italic pair of the
 * larger faces, on a PDF that is otherwise a few megabytes. KDP's interior
 * limit is far above that.
 *
 * Subsetting only the faces that survive it was rejected: it would make
 * correctness depend on which typeface the user picked, and a font update could
 * move a face from one list to the other without anything failing loudly.
 *
 * The whole-font path has a defect of its own — it writes no width for a
 * ligature glyph — which is why `LAYOUT_FEATURES` turns ligatures off. That
 * constant is shared with the measurer so the two cannot disagree; see
 * `fonts.ts` for the full account.
 */
export async function renderPdf(
  book: LaidOutBook,
  fonts: FontTable,
  options: RenderPdfOptions = {}
): Promise<PdfResult> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)

  if (options.title) doc.setTitle(options.title)
  if (options.author) doc.setAuthor(options.author)
  doc.setProducer('Public-Domain Book Formatter')
  doc.setCreator('Public-Domain Book Formatter')

  const embedded = new Map<string, PDFFont>()
  const embeddedFamilies = new Set<string>()

  for (const ref of book.fontsUsed) {
    const bytes = fonts.bytesFor(ref)
    if (!bytes) continue
    // A copy, not the original: the font table shares one buffer across every
    // request for a face, and pdf-lib takes ownership of what it is handed.
    const font = await doc.embedFont(bytes.slice(), {
      subset: false,
      features: LAYOUT_FEATURES
    })
    embedded.set(keyOf(ref), font)
    embeddedFamilies.add(fonts.resolve(ref.family))
  }

  const fallback = embedded.values().next().value ?? (await doc.embedFont('Times-Roman'))

  for (const page of book.pages) {
    drawPage(doc, page, embedded, fallback)
    if (options.onPage) await options.onPage(page.index + 1, book.pages.length)
  }

  return {
    bytes: await doc.save(),
    pageCount: book.pages.length,
    embeddedFamilies: [...embeddedFamilies]
  }
}

function drawPage(
  doc: PDFDocument,
  page: LaidOutPage,
  embedded: Map<string, PDFFont>,
  fallback: PDFFont
): void {
  // The MediaBox *is* the trim. KDP takes a trimmed interior with no crop
  // marks and no bleed box, so the page is exactly the finished leaf.
  const pdfPage: PDFPage = doc.addPage([page.widthPt, page.heightPt])

  for (const item of page.items) {
    if (item.kind === 'rule') {
      pdfPage.drawRectangle({
        x: item.xPt,
        y: page.heightPt - item.yPt - item.thicknessPt,
        width: item.widthPt,
        height: item.thicknessPt
      })
      continue
    }

    for (const run of item.runs) {
      if (run.text.length === 0) continue
      pdfPage.drawText(run.text, {
        x: run.xPt,
        // The engine measures baselines down from the top of the page; PDF
        // measures up from the bottom. This subtraction is the only place the
        // two conventions meet. A raised run — a footnote mark — moves *up*
        // the page, which is a larger y once the axis has been flipped.
        y: page.heightPt - item.baselinePt + (run.risePt ?? 0),
        size: run.sizePt,
        font: embedded.get(keyOf(run.font)) ?? fallback
      })
    }
  }
}
