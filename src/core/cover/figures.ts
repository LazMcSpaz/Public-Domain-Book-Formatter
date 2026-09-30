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

export type GroundFigure = 'isis-winged' | 'isis-winged-plain' | 'arcade' | 'arcade-detailed'

export const GROUND_FIGURES: readonly GroundFigure[] = [
  'isis-winged',
  'isis-winged-plain',
  'arcade',
  'arcade-detailed'
]

/** The id a ground figure is placed under, for the renderer to find. */
export const GROUND_FIGURE_ID = '__ground-figure__'

/** Where each figure's artwork lives, relative to the app. */
export const FIGURE_SRC: Readonly<Record<GroundFigure, string>> = {
  'isis-winged': '/devices/isis-winged-solid.svg',
  'isis-winged-plain': '/devices/isis-winged.svg',
  arcade: '/devices/arcade.svg',
  'arcade-detailed': '/devices/arcade-detailed.svg'
}

export const FIGURE_LABEL: Readonly<Record<GroundFigure, string>> = {
  'isis-winged': 'Isis, winged — the massed silhouette',
  'isis-winged-plain': 'Isis, winged — the engraved trace',
  arcade: 'An arcade of horseshoe arches',
  'arcade-detailed': 'An arcade of horseshoe arches — the fuller cut'
}

export const FIGURE_NOTE: Readonly<Record<GroundFigure, string>> = {
  'isis-winged':
    'Solid shapes, which is what a ground at five per cent needs: a mass holds its tint where a mesh of fine lines breaks up into dots.',
  'isis-winged-plain':
    'The full trace, feather by feather. Better where the figure prints stronger than about a tenth; at five per cent the hatching averages out and the silhouette is the honest choice.',
  arcade:
    'A receding colonnade rather than a figure: it fills the board edge to edge and draws the eye down the middle, where a figure holds one shape in the centre. Its proportions are almost the front panel’s own, so it prints nearly whole.',
  'arcade-detailed':
    'The same arcade with the fainter stonework kept. More ink, which reads better at the lowest tints; it goes muddy sooner where the figure prints stronger.'
}

/**
 * How strongly a figure prints, and the range the question offers.
 *
 * The floor is the press's, not a taste. Five per cent is where a
 * print-on-demand press is *relied* on to hold a tint, and `patterns.ts` says
 * so; three is where it stops being reliable and starts depending on the
 * machine, the stock and the day. It is the floor rather than the
 * recommendation because the editor asked for three with the risk stated, and
 * on a question of this kind the editor decides and a printed proof settles
 * it. Below three there is nothing to argue about: it will not print.
 *
 * The ceiling is the design's — past a fifth the figure stops being a ground
 * and starts competing with the title, which is a different cover and should
 * be asked for as one.
 */
export const MIN_FIGURE_OPACITY = 0.03
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

/**
 * Where a figure's own subject sits across its artwork, as a fraction of the
 * width, and what should therefore land on the panel's centre line.
 *
 * A figure is not centred by its bounding box. Isis is a symmetrical statue
 * photographed very slightly off-axis, so her wing tips put the box's centre
 * 2.7 per cent of the width to the left of the sun disc on her head — a fifth
 * of an inch on a 6-inch cover, which is plainly visible when a device is
 * printed above the title on that same centre line and the two do not agree.
 *
 * Measured on the **rendered cover** rather than on the artwork, and the first
 * attempt is worth recording because it was wrong in a way that looked right.
 * The obvious measurement is the ink centroid of the artwork's topmost band,
 * on the reasoning that the top of the figure is the crown and nothing else.
 * It is not: her wing tips rise as high as her horns do, so that band is the
 * *wings*, and it answered 0.522 — an overshoot that put the disc a hundredth
 * of the cover left of centre instead of right of it. Restricted to the middle
 * third the same band is empty until a tenth of the way down, which is what
 * says the wings were what it had been reading.
 *
 * So the anchor is fitted against the thing it is for: the disc's position on
 * the finished cover, measured at two anchors and solved for the one that puts
 * it on the centre line. 0.517 of the cover uncorrected, 0.500 at 0.514 —
 * confirmed by eye with the tint stretched, where the horns straddle the
 * centre rather than sitting to one side of it.
 */
export const FIGURE_ANCHOR_X: Readonly<Record<GroundFigure, number>> = {
  'isis-winged': 0.514,
  'isis-winged-plain': 0.514,
  // The dark doorway the colonnade recedes into, measured in the middle band
  // where it is the only mass. It is all but centred already, and on a 6×9 the
  // arcade's proportions are so near the panel's that there is barely a
  // fortieth of an inch of overflow to spend — so this asks for a shift the
  // clamp mostly refuses, which is the clamp doing its job rather than failing
  // to. The number is here for the trim where it is not true.
  arcade: 0.495,
  'arcade-detailed': 0.495
}

/**
 * Where to draw a covered picture so its anchor lands on the box's centre.
 *
 * Clamped to the edges, and that is the whole reason this is a function rather
 * than a subtraction: a ground pulled far enough across to satisfy its anchor
 * would come away from the trim on the other side and leave a band of bare
 * cover down one edge — the one failure a bleeding ground exists to prevent.
 * An anchor that cannot be honoured is honoured as far as it goes.
 */
export function coverOffsetX(boxWidth: number, drawWidth: number, anchorX: number): number {
  const wanted = boxWidth / 2 - anchorX * drawWidth
  return Math.min(0, Math.max(boxWidth - drawWidth, wanted))
}

/** Clamp a requested opacity into what a press will hold. */
export function figureOpacity(requested: number): number {
  if (!Number.isFinite(requested)) return DEFAULT_FIGURE_OPACITY
  return Math.min(MAX_FIGURE_OPACITY, Math.max(MIN_FIGURE_OPACITY, requested))
}
