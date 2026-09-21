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
}

/** `pdfjs.Util.transform`: the product of two 2×3 matrices, in PDF order. */
export type MatrixMultiply = (m1: number[], m2: number[]) => number[]

const IDENTITY = [1, 0, 0, 1, 0, 0]

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
  const safeArea = Math.max(1, area)
  let largest = 0
  let ctm: number[] = [...IDENTITY]
  const stack: number[][] = []

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    if (fn === ops.save) {
      stack.push([...ctm])
      continue
    }
    if (fn === ops.restore) {
      ctm = stack.pop() ?? [...IDENTITY]
      continue
    }
    if (fn === ops.transform) {
      const m = argsArray[i]
      if (Array.isArray(m)) ctm = multiply(ctm, m as number[])
      continue
    }
    if (fn === ops.formBegin) {
      stack.push([...ctm])
      const args = argsArray[i]
      const matrix = Array.isArray(args) ? (args as unknown[])[0] : undefined
      if (Array.isArray(matrix)) ctm = multiply(ctm, matrix as number[])
      continue
    }
    if (fn === ops.formEnd) {
      ctm = stack.pop() ?? [...IDENTITY]
      continue
    }
    if (!ops.image.includes(fn as number)) continue
    const determinant = Math.abs((ctm[0] ?? 0) * (ctm[3] ?? 0) - (ctm[1] ?? 0) * (ctm[2] ?? 0))
    largest = Math.max(largest, determinant / safeArea)
  }
  return largest
}

/**
 * Two thirds rather than nearly all: a scan is often placed with a margin, and
 * a decorative header on a born-digital page never reaches it.
 */
export const SCANNED_COVERAGE = 0.66
