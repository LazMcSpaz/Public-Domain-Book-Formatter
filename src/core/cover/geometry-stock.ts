/**
 * KDP's fixed numbers for a cover: bindings, paper calipers, page limits,
 * bleed, wrap, hinge, safe margins and the barcode box.
 *
 * Pure: numbers only.
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
