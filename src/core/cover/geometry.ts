/**
 * KDP cover geometry — the flat sheet a cover is printed on.
 *
 * A cover is not a page. It is one sheet carrying three panels — back, spine,
 * front, left to right — plus a bleed the printer trims off. Every number here
 * follows from three facts the user supplies (trim size, page count, paper
 * stock) by arithmetic KDP publishes, so this module computes rather than
 * looks up.
 *
 * ## Why computed and not read out of a template file
 *
 * KDP will hand you a template PDF for a given trim and page count, and it is
 * tempting to treat those files as the source of truth. They are a *picture of
 * this arithmetic*: spine = pages × the caliper of one sheet, bleed = an eighth
 * of an inch on every outside edge. Reading the picture instead of doing the
 * sum buys nothing and costs the two things that matter — a page count with no
 * template on hand cannot be covered at all, and a book whose count changes by
 * one page (which happens every time a note is added) needs a new download
 * before it can be re-exported.
 *
 * So the templates are kept as *evidence*, not as input: `test/cover-geometry`
 * asserts this arithmetic against the dimensions KDP's own templates print, and
 * a disagreement fails the suite. That is the same bargain the rest of the app
 * strikes with OCR — an independent witness that catches the thing drifting,
 * rather than a source to copy from.
 *
 * ## The one number that is not arithmetic
 *
 * Where KDP puts the barcode is a fact about their printing, not a derivation,
 * and getting it wrong would put a title under a black rectangle. It is
 * therefore a *keep-out region this module reports* and never a place anything
 * is drawn: the composer avoids it, the validator warns when something lands in
 * it, and being wrong about it costs a warning rather than a print run.
 *
 * Pure: arithmetic and named constants, no I/O.
 */

/**
 * The two bindings KDP prints, which are different objects and not two sizes
 * of one.
 *
 * A **paperback** is one sheet trimmed to the book: three panels at the trim
 * size, an eighth of an inch of bleed cut off every outer edge.
 *
 * A **hardcover** is a case. The printed sheet is glued around boards and its
 * outer margin folds to the inside, so the allowance is a *wrap* of 15 mm
 * rather than a bleed of 3 mm; the boards stand proud of the pages, so each
 * panel is **larger than the trim**; the spine carries two 2 mm boards on top
 * of the paper block; and a 10 mm **hinge** either side of the spine is where
 * the case flexes, which nothing may print in.
 *
 * Getting this wrong is not a warning, it is a box of books with the title
 * folded onto the inside of the board.
 */
import {
  BARCODE_H_IN,
  BARCODE_INSET_BOTTOM_HARDCOVER_IN,
  BARCODE_INSET_IN,
  BARCODE_W_IN,
  BLEED_IN,
  type Binding,
  CASE_BOARD_IN,
  CASE_OVERHANG_H_IN,
  CASE_OVERHANG_W_IN,
  HINGE_IN,
  MIN_PAGES_FOR_SPINE_TEXT,
  PAPER_CALIPER_IN,
  PAPER_LABEL,
  PT_PER_INCH,
  type PaperStock,
  type Rect,
  SAFE_MARGIN_IN,
  SPINE_TEXT_CLEARANCE_IN,
  type TrimSize,
  WRAP_IN
} from './geometry-stock'
export {
  BARCODE_H_IN,
  BARCODE_INSET_BOTTOM_HARDCOVER_IN,
  BARCODE_INSET_IN,
  BARCODE_W_IN,
  BLEED_IN,
  type Binding,
  CASE_BOARD_IN,
  CASE_OVERHANG_H_IN,
  CASE_OVERHANG_W_IN,
  HARDCOVER_PAGE_LIMITS,
  HARDCOVER_TRIMS,
  HINGE_IN,
  MIN_PAGES_FOR_SPINE_TEXT,
  PAGE_LIMITS,
  PAPER_CALIPER_IN,
  PAPER_LABEL,
  PT_PER_INCH,
  type PaperStock,
  type Rect,
  SAFE_MARGIN_IN,
  SPINE_TEXT_CLEARANCE_IN,
  type TrimSize,
  WRAP_IN,
  pageLimitsFor
} from './geometry-stock'

export interface CoverGeometryInput {
  /** Trim token, e.g. `6x9` — the same notation `StyleProfile.trimSize` uses. */
  trimSize: string
  /** The interior's *measured* page count. Not an estimate: this sets the spine. */
  pageCount: number
  paper: PaperStock
  /** Paperback when omitted, which is what every cover was before this existed. */
  binding?: Binding
}

export interface CoverGeometry {
  trim: TrimSize
  pageCount: number
  paper: PaperStock
  binding: Binding
  /** Spine width in inches — pages × caliper. */
  spineIn: number
  /** The whole sheet, bleed or wrap included. */
  fullWidthIn: number
  fullHeightIn: number
  /** The outer allowance: a paperback's bleed, or a hardcover's wrap. */
  bleedIn: number
  /**
   * A panel's size. The trim on a paperback; the trim plus the board's
   * overhang on a hardcover, which is what `back` and `front` are.
   */
  panel: TrimSize
  /** The flexing band either side of the spine. Null on a paperback. */
  hinge: { back: Rect; front: Rect } | null
  /** The three trimmed panels, left to right on the flat sheet. */
  back: Rect
  spine: Rect
  front: Rect
  /** Each panel inset by the safe margin — where text may go. */
  backSafe: Rect
  frontSafe: Rect
  /** The spine, inset by its own (much tighter) clearance. Null when too thin. */
  spineSafe: Rect | null
  /** Where KDP prints the barcode. Nothing may be drawn here. */
  barcode: Rect
  /** Whether this book is thick enough for KDP to accept spine text. */
  spineTextAllowed: boolean
}

/**
 * Parse a trim token strictly.
 *
 * `@core/layout`'s `trimToPoints` falls back to 6×9 on anything it cannot read,
 * which is right for an interior — a body page set at the wrong measure is
 * visibly wrong at the design gate, and the gate is looking at real pages. It
 * is wrong here. A cover is a single sheet nobody proofs against a ruler, and a
 * silent fallback would print a 6×9 cover for a 8.5×11 book: it fits nothing,
 * and the first evidence is a rejected upload or a delivered box of books.
 */
export function parseTrim(token: string): TrimSize | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*$/i.exec(token)
  if (!m) return null
  const widthIn = Number(m[1])
  const heightIn = Number(m[2])
  if (!Number.isFinite(widthIn) || !Number.isFinite(heightIn)) return null
  if (widthIn <= 0 || heightIn <= 0) return null
  return { widthIn, heightIn }
}

/**
 * Spine width for a page count on a stock.
 *
 * Rounded to nothing: KDP's own template generator carries the full product,
 * and rounding to a "nicer" number here would shift both panels by half the
 * error, which is the one place on a cover where a hundredth of an inch shows —
 * the fold lands inside the front cover's artwork.
 */
export function spineWidth(
  pageCount: number,
  paper: PaperStock,
  binding: Binding = 'paperback'
): number {
  const block = Math.max(0, pageCount) * PAPER_CALIPER_IN[paper]
  // The case is the block plus its boards, so a hardcover spine is never the
  // paperback's — on this book the two differ by three sixteenths of an inch,
  // which is most of a line of type.
  return binding === 'hardcover' ? block + CASE_BOARD_IN : block
}

export function inset(rect: Rect, by: number): Rect {
  return {
    x: rect.x + by,
    y: rect.y + by,
    width: Math.max(0, rect.width - by * 2),
    height: Math.max(0, rect.height - by * 2)
  }
}

/** Take a safe area off the hinge, which is inside the panel it belongs to. */
export function clearHinge(safe: Rect, hinge: Rect | null, side: 'left' | 'right'): Rect {
  if (!hinge) return safe
  if (side === 'left') {
    const x = Math.max(safe.x, hinge.x + hinge.width)
    return { x, y: safe.y, width: Math.max(0, safe.x + safe.width - x), height: safe.height }
  }
  const right = Math.min(safe.x + safe.width, hinge.x)
  return { x: safe.x, y: safe.y, width: Math.max(0, right - safe.x), height: safe.height }
}

/**
 * The full flat cover for a book.
 *
 * Throws on an unreadable trim rather than guessing one — see `parseTrim`.
 */
export function coverGeometry(input: CoverGeometryInput): CoverGeometry {
  const trim = parseTrim(input.trimSize)
  if (!trim) {
    throw new Error(
      `Unreadable trim size ${JSON.stringify(input.trimSize)} — expected something like "6x9".`
    )
  }

  const pageCount = Math.max(0, Math.round(input.pageCount))
  const binding: Binding = input.binding ?? 'paperback'
  const hardcover = binding === 'hardcover'
  const spineIn = spineWidth(pageCount, input.paper, binding)

  // The allowance outside the panels: thrown away on a paperback, folded in
  // and glued on a hardcover, and the same arithmetic either way.
  const edgeIn = hardcover ? WRAP_IN : BLEED_IN
  const panel: TrimSize = {
    widthIn: trim.widthIn + (hardcover ? CASE_OVERHANG_W_IN : 0),
    heightIn: trim.heightIn + (hardcover ? CASE_OVERHANG_H_IN : 0)
  }

  const fullWidthIn = edgeIn * 2 + panel.widthIn * 2 + spineIn
  const fullHeightIn = edgeIn * 2 + panel.heightIn

  const back: Rect = { x: edgeIn, y: edgeIn, width: panel.widthIn, height: panel.heightIn }
  const spine: Rect = {
    x: edgeIn + panel.widthIn,
    y: edgeIn,
    width: spineIn,
    height: panel.heightIn
  }
  const front: Rect = {
    x: edgeIn + panel.widthIn + spineIn,
    y: edgeIn,
    width: panel.widthIn,
    height: panel.heightIn
  }

  // The hinge sits inside each panel, against the spine: the back's is at its
  // right edge and the front's at its left, because the sheet reads
  // back | spine | front and the folds are the spine's two sides.
  const hinge = hardcover
    ? {
        back: {
          x: back.x + back.width - HINGE_IN,
          y: back.y,
          width: HINGE_IN,
          height: back.height
        },
        front: { x: front.x, y: front.y, width: HINGE_IN, height: front.height }
      }
    : null

  const spineTextAllowed = pageCount >= MIN_PAGES_FOR_SPINE_TEXT
  const spineUsableWidth = spineIn - SPINE_TEXT_CLEARANCE_IN * 2
  const spineSafe: Rect | null =
    spineTextAllowed && spineUsableWidth > 0
      ? {
          x: spine.x + SPINE_TEXT_CLEARANCE_IN,
          y: spine.y + SAFE_MARGIN_IN,
          width: spineUsableWidth,
          height: Math.max(0, spine.height - SAFE_MARGIN_IN * 2)
        }
      : null

  // The bottom-*right* of the back cover, which on a flat sheet is the corner
  // against the spine: laid out back|spine|front, the back panel's right edge
  // is the fold. (Turn a book over and the spine is on your right; the flat
  // sheet is not mirrored.)
  //
  // On a hardcover the side margin is taken from the *hinge*, not the panel's
  // edge: the hinge lies inside the back board, against the spine, and KDP's
  // quarter inch measured from the board's edge put the right of the symbol
  // 0.14 in into the crease. KDP's previewer drew its hinge line straight
  // through the bars of *The Lost Keys of Masonry*, and a symbol folded every
  // time the book is opened is one that stops scanning.
  const barcodeBottomIn = hardcover ? BARCODE_INSET_BOTTOM_HARDCOVER_IN : BARCODE_INSET_IN
  const barcodeRightEdge = hinge ? hinge.back.x : back.x + back.width
  const barcode: Rect = {
    x: barcodeRightEdge - BARCODE_INSET_IN - BARCODE_W_IN,
    y: back.y + back.height - barcodeBottomIn - BARCODE_H_IN,
    width: BARCODE_W_IN,
    height: BARCODE_H_IN
  }

  return {
    trim,
    pageCount,
    paper: input.paper,
    binding,
    spineIn,
    fullWidthIn,
    fullHeightIn,
    bleedIn: edgeIn,
    back,
    spine,
    front,
    panel,
    hinge,
    // Inset from the cut as always, and on a hardcover pushed off the hinge
    // too: a line centred in a panel that still contains its hinge is a line
    // centred on the wrong box, and it creeps towards the fold.
    backSafe: clearHinge(inset(back, SAFE_MARGIN_IN), hinge?.back ?? null, 'right'),
    frontSafe: clearHinge(inset(front, SAFE_MARGIN_IN), hinge?.front ?? null, 'left'),
    spineSafe,
    barcode,
    spineTextAllowed
  }
}

/** Inches → points, for the PDF writer. */
export function pt(inches: number): number {
  return inches * PT_PER_INCH
}

/** A rectangle in points, same origin (top-left of the sheet). */
export function rectPt(rect: Rect): Rect {
  return {
    x: pt(rect.x),
    y: pt(rect.y),
    width: pt(rect.width),
    height: pt(rect.height)
  }
}

/** Whether two rectangles overlap at all. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Whether `inner` sits entirely within `outer`. */
export function contains(outer: Rect, inner: Rect): boolean {
  const eps = 1e-9
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.width <= outer.x + outer.width + eps &&
    inner.y + inner.height <= outer.y + outer.height + eps
  )
}

/**
 * A one-line description of the sheet, for the interview and the report.
 *
 * The spine is quoted to three decimals because that is the precision the
 * number is *carried* at; quoting two would round 0.6395 to 0.64 and invite
 * someone to design against a spine an eightieth of an inch wider than the one
 * that will be folded.
 */
export function describeGeometry(g: CoverGeometry): string {
  return (
    `${g.fullWidthIn.toFixed(3)} × ${g.fullHeightIn.toFixed(3)} in flat ` +
    `(${g.trim.widthIn}×${g.trim.heightIn} trim, ${g.spineIn.toFixed(3)} in spine ` +
    `for ${g.pageCount} pages on ${PAPER_LABEL[g.paper].toLowerCase()})`
  )
}
