/**
 * What a laid-out book is made of.
 *
 * Everything here is in **points** (72 to the inch), because that is what a PDF
 * is measured in and converting once at the edge beats converting everywhere.
 * The origin is the **top-left of the page** with y increasing downward, which
 * matches how text flows and how the rest of this codebase describes pages;
 * `pdf-out` flips it to PDF's bottom-left origin at the single point of
 * contact with pdf-lib.
 *
 * These types are the contract between the pure engine and every renderer of
 * it. A `LaidOutPage` carries absolute positions and nothing that needs
 * interpreting: given a font table you can draw it, measure it, or diff two of
 * them, with no knowledge of books, styles, or the wizard.
 *
 * Pure types — no logic, no DOM.
 */

import type { OrnamentArt } from '@core/ornament'

/** Points per inch. The one conversion constant in the layout engine. */
export const PT_PER_INCH = 72

/** Which face of a family a run wants. Kept small on purpose: v1 needs two. */
export type FontStyle = 'regular' | 'italic'

/**
 * A font, named the way the style profile names it. Resolution to actual bytes
 * happens in the platform layer, so the core never holds a font file.
 */
export interface FontRef {
  /** Family name as it appears in `StyleProfile.bodyFont` (e.g. "EB Garamond"). */
  family: string
  style: FontStyle
}

/**
 * One drawable piece of text at an absolute position.
 *
 * A justified line is a sequence of these — one per word — rather than a single
 * string with a word-space adjustment. That is deliberate: the x offsets come
 * out of the line breaker already, so carrying them through means the renderer
 * never re-derives spacing and cannot disagree with the engine about it.
 */
export interface TextRun {
  text: string
  font: FontRef
  sizePt: number
  /** Distance from the left edge of the page to the run's origin. */
  xPt: number
  /**
   * Baseline offset for this run alone, positive = raised off the line.
   *
   * Only a footnote's reference mark uses it. A synthesised superscript — a
   * smaller glyph lifted off the baseline — is how a superscript is set when
   * the face has no dedicated one, and several of the faces here do not: IM
   * FELL English carries ¹²³ and none of ⁰⁴⁵⁶⁷⁸⁹.
   */
  risePt?: number
}

/**
 * A printer's flourish, placed and scaled but not yet drawn.
 *
 * The art travels with the item rather than an id, so a renderer needs no
 * lookup table — the same property that lets a `LaidOutPage` be drawn by
 * anything holding a font table and nothing else.
 */
export interface OrnamentItem {
  kind: 'ornament'
  /** Top-left of the ornament's box, in page coordinates (y downward). */
  xPt: number
  yPt: number
  /** Multiplier from the art's own coordinates to points. */
  scale: number
  art: OrnamentArt
}

/**
 * An illustration, placed and scaled but not yet drawn.
 *
 * Unlike an ornament, this carries an **id rather than the art**. The
 * difference is not an inconsistency: an ornament is a few hundred bytes of
 * path data that the core can hold and a test can assert on, where an
 * illustration is megabytes of scanned pixels that arrive from a canvas. Those
 * would drag the DOM into `src/core`, make a `LaidOutPage` unserializable, and
 * hold a whole book of decoded bitmaps in memory at once — which is the memory
 * rule this codebase is built around. So the renderer resolves the id against
 * the crops it made, and the engine reasons about nothing but the rectangle.
 */
export interface ImageItem {
  kind: 'image'
  /** Matches `Illustration.id`; the renderer looks the pixels up by it. */
  id: string
  /** Top-left of the placed image, in page coordinates (y downward). */
  xPt: number
  yPt: number
  widthPt: number
  heightPt: number
}

/** A horizontal rule — the footnote separator, and page furniture. */
export interface RuleShape {
  kind: 'rule'
  xPt: number
  yPt: number
  widthPt: number
  thicknessPt: number
}

/** A line of set text at an absolute baseline. */
export interface PositionedLine {
  kind: 'line'
  /** Distance from the top of the page to the text baseline. */
  baselinePt: number
  runs: TextRun[]
}

/** Everything that can appear on a page. Extended, not replaced, by later work. */
export type PageItem = PositionedLine | RuleShape | OrnamentItem | ImageItem

/**
 * The rectangle body text flows inside, in page coordinates.
 *
 * Mirrored between verso and recto: the inner (spine) margin is on the right of
 * a left-hand page and the left of a right-hand page, which is what makes a
 * bound book look centred.
 */
export interface PageFrame {
  xPt: number
  yPt: number
  widthPt: number
  heightPt: number
}

/**
 * What a page *is*. Set by the engine, which knows — it built the front matter
 * and it decided where the chapters open. Downstream this saves everyone else
 * guessing from the contents: the preview shows the pages that answer the
 * design questions, and a blank leaf is never mistaken for a failed render.
 */
export type PageKind =
  | 'half-title'
  | 'title'
  | 'copyright'
  | 'contents'
  | 'aside'
  | 'blank'
  | 'chapter-opener'
  | 'body'
  /** A page given over to one illustration, as a printed plate is. */
  | 'plate'

/** Which side of the spread a page falls on. Recto is the right-hand page. */
export type PageSide = 'recto' | 'verso'

/**
 * Where in the book a page sits. Front matter is numbered in roman numerals and
 * is excluded from the arabic sequence, as in any printed book.
 */
export type PageSection = 'front' | 'body' | 'back'

/** One finished page: absolute geometry, absolute contents, nothing to resolve. */
export interface LaidOutPage {
  /** Zero-based index in the finished book. */
  index: number
  widthPt: number
  heightPt: number
  side: PageSide
  section: PageSection
  kind: PageKind
  /** The text-block rectangle used, kept for diagnostics and preview overlays. */
  frame: PageFrame
  items: PageItem[]
  /**
   * The printed folio, already formatted ("vii", "23") — or null when this page
   * carries no page number (blanks, the title page, a chapter opener in styles
   * that suppress it).
   */
  folio: string | null
  /** Chapter this page belongs to, for running heads. Null in front matter. */
  chapterTitle: string | null
}

/** The finished book, plus the facts downstream steps ask of it. */
export interface LaidOutBook {
  pages: LaidOutPage[]
  /** Trim dimensions, so a renderer needn't re-parse the trim token. */
  widthPt: number
  heightPt: number
  /** Where each chapter opens, for a TOC with measured page numbers. */
  chapterPages: { title: string; level: number; pageIndex: number }[]
  /** Fonts actually used, so an embedder knows what to subset. */
  fontsUsed: FontRef[]
  /** Lines that would not fit their measure. Empty is the good case, and real. */
  warnings: LayoutWarning[]
  /** How many footnotes were set at the foot of a page. */
  notesPlaced: number
  /**
   * Notes gathered into a back-matter section because no reference mark for
   * them was found. In the book, just not at the foot of a page.
   */
  notesCollected: number
  /**
   * Notes that were not set, and why. A note dropped without a word is the
   * failure this whole reporting path exists to prevent.
   */
  notesDropped: { id: string; reason: string }[]
  /** Illustrations set into the book, with the resolution each one got. */
  imagesPlaced: PlacedImage[]
  /** Illustrations that could not be set, and why. Same rule as the notes. */
  imagesDropped: { id: string; reason: string }[]
}

/**
 * An illustration as it ended up on the page — the record the KDP check reads.
 *
 * `dpi` is the number that matters and the reason this is reported at all: a
 * scan looks fine on screen at any size, and only the ratio of its source
 * pixels to its *printed* inches says whether it will come out muddy. That
 * ratio does not exist until the engine has decided how big to set it, so it is
 * measured here rather than guessed earlier.
 */
export interface PlacedImage {
  id: string
  pageIndex: number
  widthPt: number
  heightPt: number
  /** Effective resolution at the placed size. KDP wants 300. */
  dpi: number
}

/**
 * A line the engine could not set within its measure — TeX's "overfull hbox".
 *
 * Reported rather than silently accepted: something is physically sticking past
 * the margin, usually an unbreakable word, and the user is the only one who can
 * decide whether it matters. This is what turns the export screen's
 * "typesetting warnings" check from a pending box into a real one.
 */
export interface LayoutWarning {
  pageIndex: number
  /** The offending line, so the user can find it in the book. */
  text: string
}
