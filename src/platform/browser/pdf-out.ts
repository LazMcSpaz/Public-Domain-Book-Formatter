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
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { FontRef, LaidOutBook, LaidOutPage } from '@core/layout'
import { LAYOUT_FEATURES, type FontTable } from './fonts'
import { verifyWidths, widenWidths } from './font-widths'

export interface PdfResult {
  bytes: Uint8Array
  pageCount: number
  /** Families that were embedded, for the KDP "fonts embedded" check. */
  embeddedFamilies: string[]
  /** Illustrations the engine placed but whose pixels never arrived. */
  missingImages: string[]
  /**
   * Glyphs the book set that no code point reaches — ligatures and contextual
   * alternates — each of which needed a width written for it by hand. Reported
   * because it is the observable evidence that the repair in `font-widths.ts`
   * did something: an empty list on a book full of "fi" means it did not.
   */
  ligatureGlyphs: string[]
  /**
   * Glyphs the font itself cannot measure, left out of the width array so the
   * book could be built at all. Crimson Pro ships one — a `NULL` glyph whose
   * outline runs past the end of its `glyf` table — and before it was skipped,
   * every book set in that face died at the export gate. Reported rather than
   * swallowed: a font this broken is worth knowing about, and if one of these
   * were ever a glyph the book needed, `renderPdf` raises instead.
   */
  unwritableGlyphs: string[]
}

export interface RenderPdfOptions {
  title?: string
  author?: string
  /** Called after each page, so a long export can show progress and yield. */
  onPage?: (done: number, total: number) => void | Promise<void>
  /**
   * PNG bytes for each placed illustration, keyed by `ImageItem.id`.
   *
   * The engine deliberately carries only the id — see the note on `ImageItem` —
   * so this is where pixels and geometry meet. An id with no entry is reported
   * rather than drawn as a blank: a picture that silently failed to embed
   * leaves a hole in the book that nobody sees until it is printed.
   */
  images?: ReadonlyMap<string, Uint8Array>
}

function keyOf(font: FontRef): string {
  return `${font.family}|${font.style}|${font.smallCaps ? 'sc' : ''}`
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
 * The whole-font path had a defect of its own — it writes no width for a
 * ligature glyph — and the answer to it used to be turning ligatures off.
 * `font-widths.ts` repairs the widths instead, and this module calls it below,
 * after every page is drawn and before the file is saved. The features are back
 * on; see `fonts.ts` for which and why.
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
    // A small-capitals run is the same bytes with `smcp` switched on. pdf-lib
    // applies features per *embedded font*, so the variant is a second embed of
    // the same face rather than a glyph-level draw path — which is what makes
    // real small capitals possible here at all. The file carries the face
    // twice; that is the price, and it is the same price as an italic.
    const font = await doc.embedFont(bytes.slice(), {
      subset: false,
      features: ref.smallCaps ? { ...LAYOUT_FEATURES, smcp: true } : LAYOUT_FEATURES
    })
    embedded.set(keyOf(ref), font)
    embeddedFamilies.add(fonts.resolve(ref.family))
  }

  const fallback = embedded.values().next().value ?? (await doc.embedFont('Times-Roman'))

  // Each illustration is embedded once even if it were placed twice — pdf-lib
  // writes one XObject per `embedPng`, and a book of plates embedded per
  // appearance is a book that carries its own pixels twice.
  const images = new Map<string, PDFImage>()
  const missingImages: string[] = []
  const supplied = options.images
  for (const page of book.pages) {
    for (const item of page.items) {
      if (item.kind !== 'image' || images.has(item.id)) continue
      const bytes = supplied?.get(item.id)
      if (!bytes) {
        if (!missingImages.includes(item.id)) missingImages.push(item.id)
        continue
      }
      images.set(item.id, await doc.embedPng(bytes.slice()))
    }
  }

  // What each face was actually asked to set, gathered as the pages are drawn.
  const drawn = new Map<PDFFont, string[]>()
  for (const page of book.pages) {
    drawPage(doc, page, embedded, fallback, images, drawn)
    if (options.onPage) await options.onPage(page.index + 1, book.pages.length)
  }

  // Widen the width array before saving, while the embedders are still lazy.
  // This is what lets the faces keep their ligatures: see `font-widths.ts`.
  const ligatureGlyphs: string[] = []
  const unwritableGlyphs: string[] = []
  for (const [font, texts] of drawn) {
    const { added, dropped } = widenWidths(font, texts)
    for (const glyph of added) ligatureGlyphs.push(glyph.name ?? String(glyph.id))
    for (const glyph of dropped) unwritableGlyphs.push(glyph.name ?? String(glyph.id))
  }

  // Then prove it, because the failure this prevents is silent on every check
  // except the printed page.
  for (const [font, texts] of drawn) {
    const missing = verifyWidths(font, texts)
    if (missing.length > 0) {
      throw new Error(
        `${missing.length} glyph(s) would print without a width: ${missing.slice(0, 8).join(', ')}. ` +
          'The book was not written, because the page would have holes in it.'
      )
    }
  }

  // Naming the faces costs nothing and is the difference between a lead and a
  // mystery. The one failure this app has had in the wild surfaced as "Trying
  // to access beyond buffer length" and nothing else — no font, no glyph, no
  // page — on a screen whose only other option was to start over.
  let bytes: Uint8Array
  try {
    bytes = await doc.save()
  } catch (cause) {
    const families = [...embeddedFamilies].join(', ') || 'none'
    throw new Error(
      `The PDF could not be written (fonts in use: ${families}). ` +
        `${cause instanceof Error ? cause.message : String(cause)}`
    )
  }

  return {
    bytes,
    ligatureGlyphs: [...new Set(ligatureGlyphs)].sort(),
    unwritableGlyphs: [...new Set(unwritableGlyphs)].sort(),
    pageCount: book.pages.length,
    embeddedFamilies: [...embeddedFamilies],
    missingImages
  }
}

function drawPage(
  doc: PDFDocument,
  page: LaidOutPage,
  embedded: Map<string, PDFFont>,
  fallback: PDFFont,
  images: Map<string, PDFImage>,
  drawn: Map<PDFFont, string[]>
): void {
  // The MediaBox *is* the trim. KDP takes a trimmed interior with no crop
  // marks and no bleed box, so the page is exactly the finished leaf.
  const pdfPage: PDFPage = doc.addPage([page.widthPt, page.heightPt])

  for (const item of page.items) {
    if (item.kind === 'image') {
      const image = images.get(item.id)
      // No pixels: draw nothing at all rather than a placeholder. A grey box in
      // a book for sale is worse than a gap, and `missingImages` is what tells
      // the user about it.
      if (!image) continue
      pdfPage.drawImage(image, {
        x: item.xPt,
        // The engine anchors an image by its top-left corner with y running
        // down; pdf-lib places one by its bottom-left with y running up. Both
        // conversions happen in this one expression.
        y: page.heightPt - item.yPt - item.heightPt,
        width: item.widthPt,
        height: item.heightPt
      })
      continue
    }

    if (item.kind === 'ornament') {
      // pdf-lib draws a path from an anchor with SVG's own downward y, which is
      // the engine's convention too — so only the page flip is needed here.
      const y = page.heightPt - item.yPt
      for (const shape of item.art.shapes) {
        // A traced ornament paints its layers over one another — the blot, the
        // holes knocked out of it in white, the half-tone specks in grey — so
        // the ink level is the shape's, not the renderer's. Drawn ornaments say
        // nothing and get black, which is what they were before this existed.
        const g = shape.grey ?? 0
        const ink = rgb(g, g, g)
        pdfPage.drawSvgPath(shape.d, {
          x: item.xPt,
          y,
          scale: item.scale,
          ...(shape.stroke === undefined
            ? { color: ink }
            : { borderColor: ink, borderWidth: shape.stroke * item.scale })
        })
      }
      continue
    }

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
      const font = embedded.get(keyOf(run.font)) ?? fallback
      // Every string the book prints passes through here, and nowhere else.
      // That is what lets `widenWidths` be complete rather than hopeful.
      const texts = drawn.get(font)
      if (texts) texts.push(run.text)
      else drawn.set(font, [run.text])
      pdfPage.drawText(run.text, {
        x: run.xPt,
        // The engine measures baselines down from the top of the page; PDF
        // measures up from the bottom. This subtraction is the only place the
        // two conventions meet. A raised run — a footnote mark — moves *up*
        // the page, which is a larger y once the axis has been flipped.
        y: page.heightPt - item.baselinePt + (run.risePt ?? 0),
        size: run.sizePt,
        font
      })
    }
  }
}
