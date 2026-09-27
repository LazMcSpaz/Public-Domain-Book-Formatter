/**
 * The ground figure — one large picture behind the front cover's type.
 *
 * A different thing from the ground *pattern* next door, and the difference is
 * the reason this is its own module rather than another entry in that list.
 *
 * A pattern is **allover**: it repeats, it has no centre, and it therefore has
 * no alignment to notice — which is what lets it run across a fold that creeps
 * by an eighth of an inch. A figure is a picture. It has a top, a middle and a
 * pair of wing tips, and a reader who can see where its centre ought to be can
 * see that the fold has moved it. So a figure prints on the **front panel
 * only**, out to the bleed on three sides and stopping dead at the fold, and
 * the back cover keeps whatever ground it had.
 *
 * Everything in `patterns.ts` about how faint a thing may be still holds: a
 * tint below about five per cent is at the edge of what a print-on-demand
 * press resolves, and under it a ground either vanishes or mottles. The
 * difference is that a figure is a *mass* rather than a mesh of hairlines, so
 * five per cent of it survives where five per cent of a 0.5pt rule does not —
 * which is why this is the one ground that can honestly sit at the floor.
 *
 * Pure: names, proportions and one rectangle. The pixels are the platform's.
 */
import { pt, type CoverGeometry, type Rect } from './geometry'

export type GroundFigure = 'isis-winged' | 'isis-winged-plain'

export const GROUND_FIGURES: readonly GroundFigure[] = ['isis-winged', 'isis-winged-plain']

/** The id a ground figure is placed under, for the renderer to find. */
export const GROUND_FIGURE_ID = '__ground-figure__'

/** Where each figure's artwork lives, relative to the app. */
export const FIGURE_SRC: Readonly<Record<GroundFigure, string>> = {
  'isis-winged': '/devices/isis-winged-solid.svg',
  'isis-winged-plain': '/devices/isis-winged.svg'
}

export const FIGURE_LABEL: Readonly<Record<GroundFigure, string>> = {
  'isis-winged': 'Isis, winged — the massed silhouette',
  'isis-winged-plain': 'Isis, winged — the engraved trace'
}

export const FIGURE_NOTE: Readonly<Record<GroundFigure, string>> = {
  'isis-winged':
    'Solid shapes, which is what a ground at five per cent needs: a mass holds its tint where a mesh of fine lines breaks up into dots.',
  'isis-winged-plain':
    'The full trace, feather by feather. Better where the figure prints stronger than about a tenth; at five per cent the hatching averages out and the silhouette is the honest choice.'
}

/**
 * How strongly a figure prints, and the range the question offers.
 *
 * The floor is the press's, not a taste: below it the tint is not reliably
 * held. The ceiling is the design's — past a fifth the figure stops being a
 * ground and starts competing with the title, which is a different cover and
 * should be asked for as one.
 */
export const MIN_FIGURE_OPACITY = 0.04
export const MAX_FIGURE_OPACITY = 0.2
export const DEFAULT_FIGURE_OPACITY = 0.05

/**
 * Where a ground figure prints: the front panel, out to the bleed.
 *
 * Three edges run past the trim so the cut goes through the picture rather
 * than past it; the fourth is the fold, where it stops. The picture is
 * **covered** into this box rather than fitted — scaled up until it fills and
 * cropped at the sides — which is what puts the wing tips off the edge of the
 * board instead of leaving a margin of bare cover around them.
 */
export function figureFrame(geometry: CoverGeometry): Rect {
  const front = geometry.front
  return {
    x: front.x,
    y: 0,
    width: geometry.fullWidthIn - front.x,
    height: geometry.fullHeightIn
  }
}

/** The same rectangle in points, which is what the composer places in. */
export function figureFramePt(geometry: CoverGeometry): {
  xPt: number
  yPt: number
  widthPt: number
  heightPt: number
} {
  const frame = figureFrame(geometry)
  return {
    xPt: pt(frame.x),
    yPt: pt(frame.y),
    widthPt: pt(frame.width),
    heightPt: pt(frame.height)
  }
}

/** Clamp a requested opacity into what a press will hold. */
export function figureOpacity(requested: number): number {
  if (!Number.isFinite(requested)) return DEFAULT_FIGURE_OPACITY
  return Math.min(MAX_FIGURE_OPACITY, Math.max(MIN_FIGURE_OPACITY, requested))
}
