/**
 * What the cover composer hands the writer: the placed items, the options it
 * takes and the cover it returns. Split out of `compose.ts`, which says how
 * they are laid out.
 *
 * Pure: types only.
 */
import type { FontRef, TextMeasurer } from '@core/layout'
import type { OrnamentArt } from '@core/ornament'
import { type Hex } from './document'
import { type CoverGeometry, type Rect } from './geometry'

/** A solid rectangle — grounds, bands, and the scrim under type over art. */
export interface FillItem {
  kind: 'fill'
  xPt: number
  yPt: number
  widthPt: number
  heightPt: number
  color: Hex
  /** 0–1. Only the scrim uses it; everything else is opaque. */
  opacity?: number
  /**
   * What drew it, where a check needs to tell one fill from another.
   *
   * Only the barcode uses it: its rectangles sit inside the one area of the
   * sheet where the rule is "nothing may be drawn", and without a name the
   * check would fire on every cover that carries its own.
   */
  id?: string
}

/**
 * The cover's picture, placed.
 *
 * Carries the **source rectangle in pixels** as well as the destination, so a
 * `cover` fit is a crop of the pixels rather than a clip of the drawing. That
 * is not a workaround: cropping in pixels is what makes the effective DPI here
 * the DPI of the pixels *actually printed*, which is the number the KDP check
 * needs. Clipping would divide by a width half the image never occupied.
 */
export interface CoverImageItem {
  kind: 'image'
  id: string
  xPt: number
  yPt: number
  widthPt: number
  heightPt: number
  /** The part of the (post-op) source to draw, in source pixels. */
  srcX: number
  srcY: number
  srcWidth: number
  srcHeight: number
  /**
   * 0–1. Only a picture-backed ground uses it.
   *
   * The cover's artwork is never drawn at partial opacity — a faded plate is a
   * mistake, not a treatment — so this exists for the one case where the
   * picture *is* the texture.
   */
  opacity?: number
}

export interface CoverTextItem {
  kind: 'text'
  text: string
  font: FontRef
  sizePt: number
  /** Left edge of the run; alignment is already resolved into it. */
  xPt: number
  /** The baseline, not the top. */
  yPt: number
  color: Hex
  /**
   * The run's measured advance width.
   *
   * Carried rather than re-measured because the validator has to know whether a
   * line of type crosses the trim, and a validator that measured it itself
   * would be a second opinion about the same string — the thing the whole
   * "one renderer" rule exists to prevent.
   */
  widthPt: number
  /**
   * The run's ink box either side of the baseline, from the face's own metrics.
   *
   * Carried for the same reason as `widthPt`, and it is the difference between
   * a safe-margin check that means something and one that reports every line
   * set at the top of a panel. Deriving it from the point size would be a
   * *second* opinion about how tall the type is, and it would be wrong by
   * whatever the face's ascent is not.
   */
  ascentPt: number
  descentPt: number
  /**
   * Quarter-turn for spine text, anticlockwise in PDF terms.
   *
   * −90 sets the line reading top-to-bottom, which is how an English-language
   * spine reads: shelve the book and the title runs the right way up.
   */
  rotate?: -90
  /** What drew it — only the barcode's digits need naming. See `FillItem.id`. */
  id?: string
}

export interface CoverRuleItem {
  kind: 'rule'
  xPt: number
  yPt: number
  widthPt: number
  thicknessPt: number
  color: Hex
}

export interface CoverOrnamentItem {
  kind: 'ornament'
  xPt: number
  yPt: number
  scale: number
  art: OrnamentArt
  color: Hex
  /**
   * 0–1. Only the ground pattern uses it.
   *
   * A texture across the whole wrap has to sit far enough back that the type in
   * front of it loses nothing, and a press cannot resolve a tint much below
   * five per cent — so this is a narrow, deliberate range rather than a knob.
   */
  opacity?: number
}

export type CoverItem =
  FillItem | CoverImageItem | CoverTextItem | CoverRuleItem | CoverOrnamentItem

export interface ComposeOptions {
  measurer: TextMeasurer
  /** The shipped ornament library, for resolving `look.ornamentId`. */
  ornaments?: readonly OrnamentArt[]
}

export interface PlacedArt {
  id: string
  /** Where it printed, in inches — what the DPI check divides by. */
  rect: Rect
  /** Pixels actually used along each axis, after ops and after the fit crop. */
  usedWidthPx: number
  usedHeightPx: number
}

export interface ComposedCover {
  geometry: CoverGeometry
  items: CoverItem[]
  placedArt: PlacedArt | null
  /**
   * What could not be honoured, in plain language.
   *
   * Same rule as the interior's dropped notes: a cover that quietly lost its
   * subtitle is a cover nobody checks until it is printed.
   */
  warnings: string[]
}
