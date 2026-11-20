/**
 * The ground figure's companion on the back, the fade at its edges, the
 * wrap across the whole sheet, and the clamp on its tint.
 *
 * Pure: rectangles and numbers.
 */
import { pt, type CoverGeometry, type Rect } from './geometry'
import { FIGURE_ANCHOR_X } from './figures-frame'
import {
  DEFAULT_FIGURE_OPACITY,
  type GroundFigure,
  MAX_FIGURE_OPACITY,
  MIN_FIGURE_OPACITY
} from './figures'

/**
 * The companion ground on the back and the spine, and why it fades.
 *
 * The front's figure stops dead at the fold, which leaves the back a plain
 * board — and a plain board beside a figured one reads as an unfinished cover
 * rather than a restrained one. The obvious repair is to carry the picture
 * across the whole wrap, and it is the one thing this module exists to refuse:
 * the fold creeps by up to an eighth of an inch, so two halves of one scene
 * meeting at it will not meet on the printed copy.
 *
 * So the companion is a *second* printing of the same artwork, mirrored, in its
 * own box, whose tint **falls to nothing before it reaches the fold**. Nothing
 * has to register, because nothing meets: at the fold both sides are the bare
 * ground, and where the fold actually lands decides nothing a reader can see.
 * That is the same bargain the allover patterns strike, reached the other way
 * round — they survive the fold by having no alignment, this survives it by
 * having no ink there.
 *
 * Mirrored because the two panels are then a pair opening from the spine, which
 * is what a bound board does, and because the fade makes the join moot: the
 * question "do the two arcades line up?" is never put.
 */
export const GROUND_FIGURE_BACK_ID = '__ground-figure-back__'

/**
 * The back panel, out to the bleed on three edges, stopping at the back fold.
 *
 * The **mirror of the front's box**, and that is the whole of why it stops
 * short of the spine rather than crossing it. Covering is a scale, so a box
 * that included the spine would be a quarter wider than the front's and draw
 * the same arcade a quarter larger — measured, 8.06 inches of artwork against
 * 6.43 — and two panels of one binding showing one picture at two sizes is
 * plainly wrong at a glance, whatever the tint. Equal boxes are equal scales by
 * construction, with nothing to keep in step.
 *
 * What the spine loses is a faint gradient of picture. What it gains is being
 * clean under the type it carries, which is the one thing printed on it.
 */
export function backFigureFrame(geometry: CoverGeometry): Rect {
  return { x: 0, y: 0, width: geometry.spine.x, height: geometry.fullHeightIn }
}

/** The same rectangle in points, which is what the composer places in. */
export function backFigureFramePt(geometry: CoverGeometry): {
  xPt: number
  yPt: number
  widthPt: number
  heightPt: number
} {
  const frame = backFigureFrame(geometry)
  return {
    xPt: pt(frame.x),
    yPt: pt(frame.y),
    widthPt: pt(frame.width),
    heightPt: pt(frame.height)
  }
}

/**
 * How far a figure's tint takes to climb from nothing to full, in inches.
 *
 * Spent at **every** trim edge, not only at the fold, and the reason is what a
 * reader sees rather than what the fold needs. A figure faded on one side and
 * cut square on the other three announces that the fade is a repair: the eye
 * meets three hard edges and one soft one and asks what is wrong with that
 * side. Ringed, the same fade is a vignette — the figure sits in the middle of
 * the board and dissolves into the ground wherever it runs out, which is a
 * thing bindings have done for as long as they have had grounds.
 *
 * It costs nothing at the trim and gains something: a tint that has already
 * reached nothing by the trim line cannot show a trim that wandered, where a
 * picture bled to the edge at full strength ends in a band whose width is
 * whatever the guillotine did that morning.
 *
 * The fold is the one edge whose fade is load-bearing, and that one was
 * measured. With only the back's companion faded, a column scan of the sheet
 * read 4.8 points of spread across the back, zero for the six tenths of an
 * inch before the fold, and 4.8 again the instant it crossed — the fade had
 * moved the one visible join rather than removed it.
 *
 * Three quarters of an inch is the floor rather than a preference: a tint
 * dropping from full to nothing across much less is a soft edge, and a soft
 * edge is still an edge.
 */
export const FIGURE_FADE_IN = 0.75

/**
 * Where a figure's tint reaches nothing, as an inset from each edge of its own
 * box, with the width of the ramp back to full.
 *
 * Insets rather than one number because a figure's box is not its trim: three
 * of its edges carry the bleed the printer cuts off, and the fourth is the
 * fold, which is already a trim edge. Reaching nothing at the **trim** on all
 * four is what makes the four look alike on the book in a reader's hands.
 */
export interface FigureFade {
  leftIn: number
  rightIn: number
  topIn: number
  bottomIn: number
  widthIn: number
}

/**
 * The fade for a figure whose box meets the fold on the named edge.
 *
 * `left` for the front's, whose box starts at the fold; `right` for the back's
 * companion, whose box ends at it.
 */
export function figureFade(
  geometry: CoverGeometry,
  foldEdge: 'left' | 'right' | null,
  toEdge = false
): FigureFade {
  // Run to the trim: the cut edges' ramp is set a whole ramp-width outside the
  // box, so the tint is full at the edge and the fade never shows. The fold
  // edge keeps its own whatever is asked (see `groundFigureToEdge`).
  const trim = toEdge ? -FIGURE_FADE_IN : geometry.bleedIn
  return {
    leftIn: foldEdge === 'left' ? 0 : trim,
    rightIn: foldEdge === 'right' ? 0 : trim,
    topIn: trim,
    bottomIn: trim,
    widthIn: FIGURE_FADE_IN
  }
}

/**
 * The whole cover sheet, for a figure the editor has asked to run across it.
 *
 * This is the one case the rule at the head of this module lets through, and
 * it is worth being exact about why, because the rule itself has not moved. A
 * figure stops at the fold because a scene printed as two boxes either side of
 * a fold that creeps by an eighth of an inch is two halves that do not meet on
 * the printed copy. A figure printed as ONE box across the whole sheet has no
 * seam to misregister: it is a single picture on a single sheet, and a fold
 * that lands an eighth of an inch out moves the crease, not the artwork.
 *
 * What it does cost is said rather than hidden: the figure is positioned
 * against the sheet, so a fold that creeps carries the front panel with it and
 * the subject sits up to an eighth of an inch off the panel's centre line. On
 * a radiance, whose rays cross the fold as straight lines, that is invisible.
 * On a figure with a face in it, it would not be, which is why this is a
 * choice a look makes rather than the default.
 */
export function wrapFigureFrame(geometry: CoverGeometry): Rect {
  return {
    x: 0,
    y: 0,
    width: geometry.fullWidthIn,
    height: geometry.fullHeightIn
  }
}

/** The same rectangle in points, which is what the composer places in. */
export function wrapFigureFramePt(geometry: CoverGeometry): {
  xPt: number
  yPt: number
  widthPt: number
  heightPt: number
} {
  const frame = wrapFigureFrame(geometry)
  return {
    xPt: pt(frame.x),
    yPt: pt(frame.y),
    widthPt: pt(frame.width),
    heightPt: pt(frame.height)
  }
}

/**
 * Where the anchor should land in a wrapping figure's box, as a fraction of it.
 *
 * The FRONT panel's centre line, not the sheet's, which would put the eye on
 * the spine. The same argument `backAnchorTarget` makes for the companion.
 */
export function wrapAnchorTarget(geometry: CoverGeometry): number {
  const width = geometry.fullWidthIn
  if (width <= 0) return 0.5
  return (geometry.front.x + geometry.front.width / 2) / width
}

/**
 * Where the anchor should land in the companion's box, as a fraction of it.
 *
 * The back *panel's* centre line — not the box's, which includes the spine.
 */
export function backAnchorTarget(geometry: CoverGeometry): number {
  const frame = backFigureFrame(geometry)
  if (frame.width <= 0) return 0.5
  return (geometry.back.x + geometry.back.width / 2) / frame.width
}

/** The anchor of a mirrored figure: the same point of a picture flipped. */
export function backAnchorX(figure: GroundFigure): number {
  return 1 - FIGURE_ANCHOR_X[figure]
}

/** Clamp a requested opacity into what a press will hold. */
export function figureOpacity(requested: number): number {
  if (!Number.isFinite(requested)) return DEFAULT_FIGURE_OPACITY
  return Math.min(MAX_FIGURE_OPACITY, Math.max(MIN_FIGURE_OPACITY, requested))
}
