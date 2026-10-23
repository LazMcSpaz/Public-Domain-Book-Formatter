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
export type Binding = 'paperback' | 'hardcover'

/** Points per inch — PDF's unit. Same value `@core/layout` uses. */
export const PT_PER_INCH = 72

/**
 * The paper a KDP paperback is printed on, and how thick one sheet is.
 *
 * A "page" is one side of a sheet, which is why these are per-page rather than
 * per-sheet numbers. The values are KDP's published multipliers; the
 * verification test pins them against real templates, because a caliper that
 * drifted by a thousandth of an inch would produce a cover that misses the
 * spine on a long book and nothing here would notice.
 */
export type PaperStock =
  'bw-white' | 'bw-cream' | 'bw-groundwood' | 'standard-color' | 'premium-color'

export const PAPER_CALIPER_IN: Readonly<Record<PaperStock, number>> = {
  'bw-white': 0.002252,
  'bw-cream': 0.0025,
  // Groundwood was missing, and its absence printed a cover 0.049 in narrow.
  // KDP offers it beside white and cream for black-and-white interiors, and
  // the editor's listings were set to it; every cover here assumed white, so
  // *The Manuscript Lectures* came back "expected 15.399, submitted 15.350".
  // Not published as a multiplier, so read off KDP's own calculator: 0.00235
  // reproduces its full-cover width to the thousandth at 24, 100, 158, 474,
  // 486, 489 and 830 pages, and for a case binding too.
  'bw-groundwood': 0.00235,
  'standard-color': 0.002252,
  'premium-color': 0.002347
}

export const PAPER_LABEL: Readonly<Record<PaperStock, string>> = {
  'bw-white': 'Black & white, white paper',
  'bw-cream': 'Black & white, cream paper',
  'bw-groundwood': 'Black & white, groundwood paper',
  'standard-color': 'Standard colour, white paper',
  'premium-color': 'Premium colour, white paper'
}

/**
 * What KDP will print on, per stock: the page counts they accept.
 *
 * Carried here so the interview can say "cream tops out at 776 pages" at the
 * moment the choice is made, rather than letting the user compose a cover for a
 * book that cannot be printed on the paper they picked.
 */
export const PAGE_LIMITS: Readonly<Record<PaperStock, { min: number; max: number }>> = {
  'bw-white': { min: 24, max: 828 },
  'bw-cream': { min: 24, max: 776 },
  // KDP's calculator accepts the full paperback range on groundwood.
  'bw-groundwood': { min: 24, max: 830 },
  'standard-color': { min: 72, max: 600 },
  'premium-color': { min: 24, max: 828 }
}

/** Bleed on every outside edge — the printer trims into this. */
export const BLEED_IN = 0.125

/**
 * The hardcover wrap: how far the sheet runs past the case on every outer edge.
 *
 * 15 mm, and unlike a bleed it is not thrown away — it folds over the board and
 * is glued down inside. Artwork must still reach into it, for the same reason a
 * bleed exists: the fold wanders, and a picture stopping at the board's edge
 * leaves a white line along the turn.
 */
export const WRAP_IN = 15 / 25.4

/**
 * The hinge: the band either side of the spine where the case bends.
 *
 * 10 mm, inside the panel rather than between the panels — it is part of the
 * front and back boards, and it is the one region of a hardcover that moves
 * every time the book is opened. Nothing is set in it, so the safe area starts
 * on its far side.
 */
export const HINGE_IN = 10 / 25.4

/**
 * How far the case board stands proud of the pages, per panel.
 *
 * Measured off KDP's own calculator across every hardcover trim they offer:
 * 5 mm of width and 6 mm of height, the same on 5.5×8.5 as on 8.25×11. It is
 * why a hardcover panel is not the trim size, and why a cover composed at the
 * trim would sit a fifth of an inch small inside its own boards.
 *
 * Written as millimetres over 25.4, like every hardcover constant here,
 * because that is the unit KDP specifies the case in — their table *displays*
 * 0.197 in, and building from the display puts the 7×10 sheet 0.0014 in wide,
 * which the template fixtures catch.
 */
export const CASE_OVERHANG_W_IN = 5 / 25.4
export const CASE_OVERHANG_H_IN = 6 / 25.4

/**
 * What the case adds to the spine, over and above the paper block.
 *
 * 4.8 mm: two 2 mm boards and the material that turns around them. Fitted
 * against KDP's calculator at five page counts on two stocks, and the
 * residual is zero to a thousandth of an inch at every point — the caliper
 * table is the paperback's, and this is a constant added to it.
 */
export const CASE_BOARD_IN = 4.8 / 25.4

/**
 * How far in from a trimmed edge anything that must survive the cut has to sit.
 *
 * Trimming is mechanical and wanders by up to an eighth of an inch, so this is
 * not a design margin — a title 0.1in from the edge is a title that is
 * *sometimes* cut through, which is worse than one that always is, because the
 * proof copy looks fine.
 */
export const SAFE_MARGIN_IN = 0.25

/** The area KDP prints the barcode in, on the back cover. */
export const BARCODE_W_IN = 2
export const BARCODE_H_IN = 1.2
/** How far that area sits in from the back cover's trimmed edges. */
export const BARCODE_INSET_IN = 0.25
/**
 * The same, up from the foot of a hardcover's back board.
 *
 * KDP's calculator gives a hardcover a taller barcode margin than a paperback
 * — 0.375 in against 0.25 — which is the one number of the four on that table
 * that is not shared between the bindings.
 */
export const BARCODE_INSET_BOTTOM_HARDCOVER_IN = 0.375

/**
 * Below this page count KDP will not print spine text.
 *
 * The spine of a thin book is narrower than the wander in the fold, so text on
 * it lands on the front or the back. The composer therefore *withdraws the
 * question* below this count rather than offering a field that prints wrong.
 */
export const MIN_PAGES_FOR_SPINE_TEXT = 79

/** Clearance spine text keeps from each folded edge. */
export const SPINE_TEXT_CLEARANCE_IN = 0.0625

/** A rectangle in inches, measured from the top-left of the whole flat sheet. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface TrimSize {
  widthIn: number
  heightIn: number
}

/** What KDP will print a hardcover at: their own limits, not ours. */
export const HARDCOVER_PAGE_LIMITS = { min: 76, max: 550 }

/** The trims KDP offers in hardcover, as their cover calculator lists them. */
export const HARDCOVER_TRIMS: readonly string[] = ['5.5x8.5', '6x9', '6.14x9.21', '7x10', '8.25x11']

/**
 * What this binding will take on this stock: the tighter of the two.
 *
 * A hardcover is 76–550 whatever the paper, and cream paperbacks stop at 776,
 * so neither limit alone is the answer and reporting the paper's range on a
 * case-bound book is a true sentence about the wrong object.
 */
export function pageLimitsFor(
  paper: PaperStock,
  binding: Binding = 'paperback'
): { min: number; max: number } {
  const stock = PAGE_LIMITS[paper]
  if (binding !== 'hardcover') return stock
  return {
    min: Math.max(stock.min, HARDCOVER_PAGE_LIMITS.min),
    max: Math.min(stock.max, HARDCOVER_PAGE_LIMITS.max)
  }
}

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

function inset(rect: Rect, by: number): Rect {
  return {
    x: rect.x + by,
    y: rect.y + by,
    width: Math.max(0, rect.width - by * 2),
    height: Math.max(0, rect.height - by * 2)
  }
}

/** Take a safe area off the hinge, which is inside the panel it belongs to. */
function clearHinge(safe: Rect, hinge: Rect | null, side: 'left' | 'right'): Rect {
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
  const barcodeBottomIn = hardcover ? BARCODE_INSET_BOTTOM_HARDCOVER_IN : BARCODE_INSET_IN
  const barcode: Rect = {
    x: back.x + back.width - BARCODE_INSET_IN - BARCODE_W_IN,
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
