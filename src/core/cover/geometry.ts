/**
 * KDP cover geometry — the flat sheet a paperback cover is printed on.
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
export type PaperStock = 'bw-white' | 'bw-cream' | 'standard-color' | 'premium-color'

export const PAPER_CALIPER_IN: Readonly<Record<PaperStock, number>> = {
  'bw-white': 0.002252,
  'bw-cream': 0.0025,
  'standard-color': 0.002252,
  'premium-color': 0.002347
}

export const PAPER_LABEL: Readonly<Record<PaperStock, string>> = {
  'bw-white': 'Black & white, white paper',
  'bw-cream': 'Black & white, cream paper',
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
  'standard-color': { min: 72, max: 600 },
  'premium-color': { min: 24, max: 828 }
}

/** Bleed on every outside edge — the printer trims into this. */
export const BLEED_IN = 0.125

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

export interface CoverGeometryInput {
  /** Trim token, e.g. `6x9` — the same notation `StyleProfile.trimSize` uses. */
  trimSize: string
  /** The interior's *measured* page count. Not an estimate: this sets the spine. */
  pageCount: number
  paper: PaperStock
}

export interface CoverGeometry {
  trim: TrimSize
  pageCount: number
  paper: PaperStock
  /** Spine width in inches — pages × caliper. */
  spineIn: number
  /** The whole sheet, bleed included. */
  fullWidthIn: number
  fullHeightIn: number
  bleedIn: number
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
export function spineWidth(pageCount: number, paper: PaperStock): number {
  return Math.max(0, pageCount) * PAPER_CALIPER_IN[paper]
}

function inset(rect: Rect, by: number): Rect {
  return {
    x: rect.x + by,
    y: rect.y + by,
    width: Math.max(0, rect.width - by * 2),
    height: Math.max(0, rect.height - by * 2)
  }
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
  const spineIn = spineWidth(pageCount, input.paper)

  const fullWidthIn = BLEED_IN * 2 + trim.widthIn * 2 + spineIn
  const fullHeightIn = BLEED_IN * 2 + trim.heightIn

  const back: Rect = { x: BLEED_IN, y: BLEED_IN, width: trim.widthIn, height: trim.heightIn }
  const spine: Rect = {
    x: BLEED_IN + trim.widthIn,
    y: BLEED_IN,
    width: spineIn,
    height: trim.heightIn
  }
  const front: Rect = {
    x: BLEED_IN + trim.widthIn + spineIn,
    y: BLEED_IN,
    width: trim.widthIn,
    height: trim.heightIn
  }

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
  const barcode: Rect = {
    x: back.x + back.width - BARCODE_INSET_IN - BARCODE_W_IN,
    y: back.y + back.height - BARCODE_INSET_IN - BARCODE_H_IN,
    width: BARCODE_W_IN,
    height: BARCODE_H_IN
  }

  return {
    trim,
    pageCount,
    paper: input.paper,
    spineIn,
    fullWidthIn,
    fullHeightIn,
    bleedIn: BLEED_IN,
    back,
    spine,
    front,
    backSafe: inset(back, SAFE_MARGIN_IN),
    frontSafe: inset(front, SAFE_MARGIN_IN),
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
