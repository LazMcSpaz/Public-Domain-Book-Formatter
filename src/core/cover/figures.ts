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
export {
  FIGURE_FADE_IN,
  type FigureFade,
  GROUND_FIGURE_BACK_ID,
  backAnchorTarget,
  backAnchorX,
  backFigureFrame,
  backFigureFramePt,
  figureFade,
  figureOpacity,
  wrapAnchorTarget,
  wrapFigureFrame,
  wrapFigureFramePt
} from './figures-back'
export {
  FIGURE_ANCHOR_X,
  FIGURE_ZOOM,
  coverOffsetX,
  coverScale,
  figureFrame,
  figureFramePt,
  framedFigureFrame
} from './figures-frame'

export type GroundFigure =
  | 'isis-winged'
  | 'isis-winged-plain'
  | 'arcade'
  | 'arcade-detailed'
  | 'all-seeing-eye'
  | 'all-seeing-eye-radiant'
  | 'chain-of-globes'
  | 'chain-of-globes-wide'
  | 'theosophical-seal'

export const GROUND_FIGURES: readonly GroundFigure[] = [
  'isis-winged',
  'isis-winged-plain',
  'arcade',
  'arcade-detailed',
  'all-seeing-eye',
  'all-seeing-eye-radiant',
  'chain-of-globes',
  'chain-of-globes-wide',
  'theosophical-seal'
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
  'all-seeing-eye-radiant': '/devices/all-seeing-eye-radiant.svg',
  'chain-of-globes': '/devices/chain-of-globes.svg',
  'chain-of-globes-wide': '/devices/chain-of-globes-wide.svg',
  'theosophical-seal': '/devices/theosophical-seal-no-svastika.svg'
}

export const FIGURE_LABEL: Readonly<Record<GroundFigure, string>> = {
  'chain-of-globes': 'The chain of globes — the diagram from The Mahatma Letters',
  'chain-of-globes-wide': 'The chain of globes, turned and enlarged to run across the spine',
  'theosophical-seal': 'The Theosophical Society’s seal, without the svastika',
  'isis-winged': 'Isis, winged — the massed silhouette',
  'isis-winged-plain': 'Isis, winged — the engraved trace',
  arcade: 'An arcade of horseshoe arches',
  'arcade-detailed': 'An arcade of horseshoe arches — the fuller cut',
  'all-seeing-eye': 'The all-seeing eye — Manly P. Hall’s own device',
  'all-seeing-eye-radiant': 'The all-seeing eye, its rays carried to the edges'
}

export const FIGURE_NOTE: Readonly<Record<GroundFigure, string>> = {
  'theosophical-seal':
    'The Society’s own seal, in the separable form that leaves out the svastika — which the Society has used since the 1880s and which a great many buyers today read as something else. Which form a book carries is the editor’s decision and `public/devices/README.md` says so; this entry is the cautious one.',
  'chain-of-globes':
    'The diagram of the planetary chain that Barker printed in facsimile in 1923: a circle cut into its globes, Globe A to Globe Z with Earth at the foot, the seven rounds numbered at the centre, the descending arc down one side and the ascending arc up the other, and the meridian struck through it all. Traced from the facsimile by `scripts/trace-device.py`, since the scan holds under five inches of drawing and a cover wants more; its box is padded so the circle\u2019s measured centre is the box\u2019s centre, and sized so the circle is about six inches across a seven-inch front. Line, not mass, so it wants a tint toward the stronger end.',
  'chain-of-globes-wide':
    'The same traced diagram for a cover that wraps: drawn in inches on a box the height of a 7 \u00d7 10 paperback sheet and twice as wide as any, its circle centred on the box and 5.9 in in radius, so that centred on the front panel it crosses the spine and runs about an inch and a quarter into the back. Turned 30 degrees clockwise at the editor\u2019s word for The Mahatma Letters. Meant for `groundFigureWrap`; on a larger sheet the composer scales it up by height, so a hardcover carries it proportionally larger.',
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
    'Hall\u2019s eye and his seven stars, with the engraving\u2019s own 133 rays carried out to the edges of the board, so the whole cover is the radiance rather than a half-disc at the foot. The rays leave at the angles, widths and spacing the press set them, cut into the same dashes and wandering as far off true. The engraving\u2019s own hatching is kept \u2014 it is what the device is \u2014 but faded to nothing across its own rim, because what a reader sees as a shape is not the fan\u2019s mass but its edge: a hundred and thirty-three blunt ray-ends and the gaps between them, standing in an arc.'
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
