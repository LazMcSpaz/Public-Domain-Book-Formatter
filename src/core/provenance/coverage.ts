/**
 * How much of a page its largest image covers, read off the page's own
 * drawing instructions.
 *
 * This is the structural half of "is this page a photograph?". A scanned leaf
 * is one image drawn across the page with invisible text laid over it; a
 * typeset leaf draws glyphs and, at most, a decorative header. Judging the
 * *text* cannot tell the two apart — good OCR of a clean scan is made of
 * `chirnrgeon` and `thc`, shaped exactly like words — but the drawing
 * instructions can, and they are a fact about the file rather than a guess
 * about its contents.
 *
 * Pure on purpose. It walks an operator list as pdf.js hands one back
 * (`fnArray`, `argsArray`) but takes the opcode numbers and the matrix
 * multiply as arguments, because pdf.js ships two builds — the browser's and
 * the legacy one Node can load — and the walk must be the same code under
 * both. The browser measures a scan as it comes in; `scripts/shape.mjs`
 * measures every book already on the shelf without opening a tab. Two copies
 * of this loop would agree until somebody fixed one of them.
 *
 * The drawn size of an image is the **current transformation matrix** at the
 * moment it is painted: an image is always drawn into the unit square, so the
 * matrix's determinant is the area it covers. A form XObject carries its own
 * matrix and pdf.js delivers it as its own opcode rather than as a
 * `transform`; missing it is not a rounding error — one book paints its scans
 * inside a form scaled roughly 2:1, so every leaf measured as twice page size
 * and 45% visible, including the ones that render perfectly.
 *
 * One image across the page is not the only shape a scan takes. Acrobat's
 * Paper Capture cuts the photograph into strips, one per line of type and one
 * per smudge, and lays its OCR invisibly over them. _The Structure of Magic_
 * Vol. I paints forty-odd such strips a leaf, none larger than a tenth of the
 * page, so the largest-image test called every leaf typeset while a render
 * showed a librarian's handwritten call number. What the two shapes share is
 * that **nothing on the page is drawn as visible type**: the text is all
 * invisible, and the ink is all pictures. So the walk counts glyphs by
 * whether they print, and `isPhotograph` asks both questions.
 *
 * Capture's other mode is the one this must *not* call a photograph. It
 * redraws every word it recognised in a font and keeps a bitmap only of the
 * words it could not: on Lakoff's pamphlet about half the glyphs print. A
 * crop of such a leaf shows the OCR's own reading wherever it was confident,
 * which is the hypothesis handed back to the adjudicator, so the page is
 * reported as partly pixels (`hiddenShare`) and left to a person to declare.
 */

/** The opcode numbers the walk needs, as the loaded pdf.js build defines them. */
export interface CoverageOps {
  save: number
  restore: number
  transform: number
  formBegin: number
  formEnd: number
  /** Every opcode that paints an image: XObject, mask, inline. */
  image: readonly number[]
  /** `setTextRenderingMode`. */
  textMode: number
  /** Every opcode that shows text; its glyphs are the first array argument. */
  text: readonly number[]
}

/** `pdfjs.Util.transform`: the product of two 2×3 matrices, in PDF order. */
export type MatrixMultiply = (m1: number[], m2: number[]) => number[]

const IDENTITY = [1, 0, 0, 1, 0, 0]

/** What a page draws, as far as deciding whether it is a photograph needs. */
export interface PageInk {
  /** Share of the page the largest image covers. */
  largest: number
  /** Images painted, of any size. */
  images: number
  /** Glyphs drawn in a mode that prints. */
  visibleGlyphs: number
  /** Glyphs drawn invisibly (modes 3 and 7): an OCR layer's signature. */
  hiddenGlyphs: number
}

/** Text rendering modes that put no ink on the page. */
const INVISIBLE_MODES = new Set([3, 7])

function glyphCount(args: unknown): number {
  if (!Array.isArray(args)) return 0
  const glyphs = args.find((a) => Array.isArray(a))
  if (!Array.isArray(glyphs)) return 0
  // pdf.js hands glyph objects and, between them, numbers for the spacing.
  return glyphs.filter((g) => typeof g === 'object' && g !== null).length
}

/**
 * Walk a page's drawing instructions once: the largest image and the glyphs,
 * by whether they print.
 *
 * The text rendering mode is graphics state, so it is saved and restored with
 * the matrix; a form starts from the state it was painted in.
 */
export function pageInk(
  fnArray: readonly number[],
  argsArray: readonly unknown[],
  area: number,
  ops: CoverageOps,
  multiply: MatrixMultiply
): PageInk {
  const safeArea = Math.max(1, area)
  const ink: PageInk = { largest: 0, images: 0, visibleGlyphs: 0, hiddenGlyphs: 0 }
  let ctm: number[] = [...IDENTITY]
  let mode = 0
  const stack: { ctm: number[]; mode: number }[] = []

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i] as number
    if (fn === ops.save) {
      stack.push({ ctm: [...ctm], mode })
      continue
    }
    if (fn === ops.restore || fn === ops.formEnd) {
      const top = stack.pop()
      ctm = top?.ctm ?? [...IDENTITY]
      mode = top?.mode ?? 0
      continue
    }
    if (fn === ops.transform) {
      const m = argsArray[i]
      if (Array.isArray(m)) ctm = multiply(ctm, m as number[])
      continue
    }
    if (fn === ops.formBegin) {
      stack.push({ ctm: [...ctm], mode })
      const args = argsArray[i]
      const matrix = Array.isArray(args) ? (args as unknown[])[0] : undefined
      if (Array.isArray(matrix)) ctm = multiply(ctm, matrix as number[])
      continue
    }
    if (fn === ops.textMode) {
      const args = argsArray[i]
      const m = Array.isArray(args) ? (args as unknown[])[0] : undefined
      if (typeof m === 'number') mode = m
      continue
    }
    if (ops.text.includes(fn)) {
      const n = glyphCount(argsArray[i])
      if (INVISIBLE_MODES.has(mode)) ink.hiddenGlyphs += n
      else ink.visibleGlyphs += n
      continue
    }
    if (!ops.image.includes(fn)) continue
    ink.images += 1
    const determinant = Math.abs((ctm[0] ?? 0) * (ctm[3] ?? 0) - (ctm[1] ?? 0) * (ctm[2] ?? 0))
    ink.largest = Math.max(ink.largest, determinant / safeArea)
  }
  return ink
}

/**
 * The share of the page covered by the largest image drawn on it.
 *
 * `area` is the page's own width × height in the same units the matrices are
 * in — pdf.js's default viewport at scale 1. Returns 0 for a page that draws
 * no image at all, and can exceed 1 for one drawn larger than the page and
 * clipped, which is what a scan placed inside a scaled form looks like.
 */
export function largestImageCoverage(
  fnArray: readonly number[],
  argsArray: readonly unknown[],
  area: number,
  ops: CoverageOps,
  multiply: MatrixMultiply
): number {
  return pageInk(fnArray, argsArray, area, ops, multiply).largest
}

/**
 * Two thirds rather than nearly all: a scan is often placed with a margin, and
 * a decorative header on a born-digital page never reaches it.
 */
export const SCANNED_COVERAGE = 0.66

/**
 * Visible glyphs a scan in pieces may still draw, as a share of its hidden
 * ones: a folio or a running head Capture happened to set in a font must not
 * turn a leaf of photographed strips into type. One in twenty.
 */
export const VISIBLE_GLYPH_ALLOWANCE = 0.05

/** The share of a page's glyphs that are drawn invisibly, or null with no text. */
export function hiddenShare(ink: PageInk): number | null {
  const total = ink.hiddenGlyphs + ink.visibleGlyphs
  return total === 0 ? null : ink.hiddenGlyphs / total
}

/**
 * Whether the page is a photograph of paper.
 *
 * One image across most of it, or — a scan cut into pieces — pictures and an
 * invisible text layer with next to no visible type beside them. A page of
 * type that also carries an invisible layer, or a page of pictures and type,
 * is neither: its visible words were drawn by somebody's font.
 */
export function isPhotograph(ink: PageInk): boolean {
  if (ink.largest >= SCANNED_COVERAGE) return true
  return (
    ink.images > 0 &&
    ink.hiddenGlyphs > 0 &&
    ink.visibleGlyphs <= ink.hiddenGlyphs * VISIBLE_GLYPH_ALLOWANCE
  )
}
