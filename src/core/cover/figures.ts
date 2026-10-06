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

export type GroundFigure =
  | 'isis-winged'
  | 'isis-winged-plain'
  | 'arcade'
  | 'arcade-detailed'
  | 'all-seeing-eye'
  | 'all-seeing-eye-radiant'

export const GROUND_FIGURES: readonly GroundFigure[] = [
  'isis-winged',
  'isis-winged-plain',
  'arcade',
  'arcade-detailed',
  'all-seeing-eye',
  'all-seeing-eye-radiant'
]

/** The id a ground figure is placed under, for the renderer to find. */
export const GROUND_FIGURE_ID = '__ground-figure__'

/** Where each figure's artwork lives, relative to the app. */
export const FIGURE_SRC: Readonly<Record<GroundFigure, string>> = {
  'isis-winged': '/devices/isis-winged-solid.svg',
  'isis-winged-plain': '/devices/isis-winged.svg',
  arcade: '/devices/arcade.svg',
  'arcade-detailed': '/devices/arcade-detailed.svg',
  'all-seeing-eye': '/devices/all-seeing-eye-ground.svg',
  'all-seeing-eye-radiant': '/devices/all-seeing-eye-radiant.svg'
}

export const FIGURE_LABEL: Readonly<Record<GroundFigure, string>> = {
  'isis-winged': 'Isis, winged — the massed silhouette',
  'isis-winged-plain': 'Isis, winged — the engraved trace',
  arcade: 'An arcade of horseshoe arches',
  'arcade-detailed': 'An arcade of horseshoe arches — the fuller cut',
  'all-seeing-eye': 'The all-seeing eye — Manly P. Hall’s own device',
  'all-seeing-eye-radiant': 'The all-seeing eye, its rays carried to the edges'
}

export const FIGURE_NOTE: Readonly<Record<GroundFigure, string>> = {
  'isis-winged':
    'Solid shapes, which is what a ground at five per cent needs: a mass holds its tint where a mesh of fine lines breaks up into dots.',
  'isis-winged-plain':
    'The full trace, feather by feather. Better where the figure prints stronger than about a tenth; at five per cent the hatching averages out and the silhouette is the honest choice.',
  arcade:
    'A receding colonnade rather than a figure: it fills the board edge to edge and draws the eye down the middle, where a figure holds one shape in the centre. Its proportions are almost the front panel’s own, so it prints nearly whole.',
  'arcade-detailed':
    'The same arcade with the fainter stonework kept. More ink, which reads better at the lowest tints; it goes muddy sooner where the figure prints stronger.',
  'all-seeing-eye':
    'Traced from the cover of Hall’s own magazine, March 1924: a fan of fine rays, seven seven-pointed stars, an open eye. Its own emblem, so it prints stronger than a ground — at a few per cent the rays merge into a grey wash, which is what the paper does on the wrappers and what the trace exists to avoid.',
  'all-seeing-eye-radiant':
    'Hall\u2019s eye and his seven stars, with the engraving\u2019s own 133 rays carried out to the edges of the board, so the whole cover is the radiance rather than a half-disc at the foot. The rays leave at the angles, widths and spacing the press set them, cut into the same dashes and wandering as far off true. The fan\u2019s own hatching is not printed: it is an ellipse, reaching twice as far at the sides as at the foot, and under the carried rays that is a flat lozenge round the eye \u2014 the shape a reader sees and the one thing this is for.'
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
export function figureFade(geometry: CoverGeometry, foldEdge: 'left' | 'right' | null): FigureFade {
  const bleed = geometry.bleedIn
  return {
    leftIn: foldEdge === 'left' ? 0 : bleed,
    rightIn: foldEdge === 'right' ? 0 : bleed,
    topIn: bleed,
    bottomIn: bleed,
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
