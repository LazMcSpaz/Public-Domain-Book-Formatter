/**
 * Where a ground figure prints on the front, and how its picture is scaled
 * and shifted to sit there.
 *
 * Pure: rectangles and numbers.
 */
import { pt, type CoverGeometry, type Rect } from './geometry'
import { type GroundFigure } from './figures'

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

/**
 * Where a figure goes when it is held inside the frame rather than bled.
 *
 * The frame's own inner edge, less the clearance it keeps from type, so the
 * picture stands in the same box a centred line of type would. A figure that
 * met the rule exactly would read as having been pushed under it.
 */
export function framedFigureFrame(
  geometry: CoverGeometry,
  frameInsetIn: number,
  clearanceIn: number
): Rect {
  const front = geometry.front
  const inset = frameInsetIn + clearanceIn
  return {
    x: front.x + inset,
    y: front.y + inset,
    width: Math.max(0, front.width - inset * 2),
    height: Math.max(0, front.height - inset * 2)
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
  // The doorway, which the plate already centres: Knapp drew it square on.
  'candidate-at-the-gates': 0.5,
  // The sitter's own centre: the photograph is composed square on.
  sinnett: 0.5,
  // A field, not a figure: any part of it is as good a centre as another.
  'mahatma-hands': 0.5,
  // The circle's centre, measured by a least-squares fit to its ink and made
  // the box's centre by padding the viewBox, as the eye's pupil is.
  'chain-of-globes': 0.5,
  // The circle's centre again, placed at the centre of its box by the
  // transform that turns and sizes it.
  'chain-of-globes-wide': 0.5,
  // A seal is a disc, drawn concentric in its own box.
  'theosophical-seal': 0.5,
  // Exactly the centre, and not by luck: the artwork's box is padded until the
  // measured axis is its centre, so the number the library carries is the one
  // value that cannot drift from the file. See `public/devices/README.md`.
  'all-seeing-eye': 0.5,
  // The radiance is built about the pupil and its box struck symmetrically
  // round it, so the same holds and for the same reason.
  'all-seeing-eye-radiant': 0.5,
  'isis-winged': 0.514,
  'isis-winged-plain': 0.514,
  // The doorway the colonnade recedes into: the centre line splits its
  // opening, and in a one-point perspective that is the same line the arch
  // apex above it stands on.
  //
  // Three measurements were wrong before this one, all the same way. A band's
  // ink centroid, the widest run clearing half a band's peak, and the largest
  // connected mass each answered with the colonnade rather than the doorway —
  // every band across this picture crosses piers, arch profiles and floor
  // tiles too, and at this threshold the whole picture is one connected shape.
  // What separates the doorway from all of it is that it is **solid**: ink on
  // every row of its band, where a pier is ink only at its edges. Measured
  // that way on the rendered cover, with the picture and the number taken from
  // the same pixels so they cannot disagree, and landed to within half a pixel
  // of the centre line on a twelve-hundred-pixel render.
  arcade: 0.519,
  'arcade-detailed': 0.519
}

/**
 * How much larger than covering requires a figure is drawn.
 *
 * Covering is the *minimum* scale that fills the box, so a figure whose
 * proportions match the panel's is drawn at very nearly its own size and has
 * no overflow — and a picture with no overflow cannot be moved, because every
 * pixel of slack is already spent on filling the box. The arcade is that case:
 * its proportions are within half a per cent of a 6×9 front panel's, which
 * leaves four pixels of travel on a twelve-hundred-pixel render, so an anchor
 * asking for ten gets four and the difference is invisible to everything
 * except the eye that asked.
 *
 * So a figure that needs to be positioned says how much room to leave. It is
 * not simply always 1.1, because the room is paid for out of the picture: at
 * 1.05 the arcade gives up about a quarter of an inch off the top and the foot
 * and a third of an inch across, which it can afford because its edges are
 * wall and ceiling, and a figure whose subject runs to its own edge could not.
 *
 * 1.03 was measured and does honour the arcade's anchor — by about half a
 * thousandth of an inch, which is no margin at all: a re-traced file or a
 * nudged anchor would put it over, and a clamped anchor prints a cover that is
 * slightly wrong and raises nothing. The extra two per cent is that margin,
 * and the test that checks each figure's anchor against its artwork on disk is
 * what would say so.
 */
export const FIGURE_ZOOM: Readonly<Record<GroundFigure, number>> = {
  // Nothing to move: the anchor is the picture's own centre.
  'candidate-at-the-gates': 1,
  sinnett: 1,
  'mahatma-hands': 1,
  'chain-of-globes': 1,
  'chain-of-globes-wide': 1,
  'theosophical-seal': 1,
  // Nothing to move: the anchor is the box's own centre.
  'all-seeing-eye': 1,
  'all-seeing-eye-radiant': 1,
  // Half again as wide as the panel already: all the slack anyone could want.
  'isis-winged': 1,
  'isis-winged-plain': 1,
  arcade: 1.05,
  'arcade-detailed': 1.05
}

/**
 * The scale at which a picture covers a box, times whatever room the figure
 * asks for beyond it.
 */
export function coverScale(
  boxWidth: number,
  boxHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  zoom = 1
): number {
  if (naturalWidth <= 0 || naturalHeight <= 0) return 1
  const cover = Math.max(boxWidth / naturalWidth, boxHeight / naturalHeight)
  return cover * Math.max(1, zoom)
}

/**
 * Where to draw a covered picture so its anchor lands on the box's centre.
 *
 * Clamped to the edges, and that is the whole reason this is a function rather
 * than a subtraction: a ground pulled far enough across to satisfy its anchor
 * would come away from the trim on the other side and leave a band of bare
 * cover down one edge — the one failure a bleeding ground exists to prevent.
 * An anchor that cannot be honoured is honoured as far as it goes.
 *
 * `targetX` is where in the *box* the anchor should land, and it is 0.5 for
 * every figure on the front, whose box is the front panel. The companion on the
 * back needs it: its box is the back panel **and the spine**, so the middle of
 * the box is not the middle of the panel a reader looks at, and centring on the
 * box would set the back's arcade three quarters of an inch off the panel it
 * prints on.
 */
export function coverOffsetX(
  boxWidth: number,
  drawWidth: number,
  anchorX: number,
  targetX = 0.5
): number {
  const wanted = boxWidth * targetX - anchorX * drawWidth
  return Math.min(0, Math.max(boxWidth - drawWidth, wanted))
}
