/**
 * The shipped ornament library (SPEC §8) — printer's flourishes as vector data.
 *
 * These used to be `.svg` files under `resources/`, converted to PDF at export
 * time so XeLaTeX could `\includegraphics` them. There is no XeLaTeX any more,
 * and pdf-lib draws a path directly, so the art lives here as data instead.
 * That also makes it a *single* source: an SVG file beside a copy of its path
 * data is two things that can disagree, and the one nobody edits is the one
 * that gets drawn.
 *
 * Coordinates are the ornament's own — a viewBox with y running downward, as in
 * SVG. The renderer scales and places; nothing here knows about pages.
 *
 * Pure data, and the two helpers that build it.
 */
import { INK_BOTTLE_HEIGHT, INK_BOTTLE_SHAPES, INK_BOTTLE_WIDTH } from './ink-bottle'

/** One drawable path within an ornament. */
export interface OrnamentShape {
  /** SVG path data, in the ornament's own coordinates. */
  d: string
  /**
   * Stroke width in those same coordinates. Omitted means the path is filled,
   * which is the common case — most of these are solid shapes.
   */
  stroke?: number
  /**
   * How dark this shape prints: 0 is black, 1 is the white of the paper.
   * Omitted means black, which is what every drawn flourish here wants.
   *
   * It exists for the one kind of ornament that is *traced* rather than
   * drawn. A printer's flourish is a few deliberate curves and is solid ink
   * throughout; an ink splotch photographed off a typescript is a blot with
   * ragged holes in it and a spray of half-tone specks around the edge, and a
   * tracer renders that as layers painted over one another — the blot, then
   * the holes in white, then the specks in grey. Drawn without this field
   * every layer prints black, the holes fill in, and a splotch that should
   * look like ink on paper comes out as a solid lozenge.
   *
   * Grey rather than colour on purpose: these books print in one ink.
   */
  grey?: number
}

/** Where an ornament is allowed to appear. */
export type OrnamentKind = 'chapter' | 'divider' | 'page'

export interface OrnamentArt {
  id: string
  name: string
  kind: OrnamentKind
  /** The viewBox, so a renderer can scale the whole thing to a target width. */
  width: number
  height: number
  shapes: readonly OrnamentShape[]
}

/**
 * A circle as four cubic Béziers.
 *
 * SVG's own `<circle>` is not path data at all, and the elliptical-arc command
 * is the one a path parser is least likely to handle well — where four cubics
 * are understood by everything. 0.5523 is the standard control-point ratio that
 * makes them indistinguishable from a circle.
 */
const K = 0.5522847498307936

function circle(cx: number, cy: number, r: number): string {
  const k = r * K
  return [
    `M ${cx - r} ${cy}`,
    `C ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}`,
    `C ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}`,
    `C ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}`,
    `C ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy}`,
    'Z'
  ].join(' ')
}

/** A rectangle as a closed path. */
function rect(x: number, y: number, w: number, h: number): string {
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`
}

/**
 * A five-pointed star, as ten straight segments.
 *
 * The inner radius is the one that makes a star look like a printer's mark
 * rather than a child's drawing: much above 0.42 and the points go stubby,
 * much below and they go spidery and fill in at text size.
 */
function star(cx: number, cy: number, r: number): string {
  const inner = r * 0.42
  const points: string[] = []
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : inner
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    points.push(
      `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`
    )
  }
  return `M ${points[0]} ${points
    .slice(1)
    .map((p) => `L ${p}`)
    .join(' ')} Z`
}

/**
 * The shipped library.
 *
 * Hand-authored rather than lifted from a font or a clip-art set, so nothing
 * here attaches a licence to a book that uses one — which is rather the point
 * of an app for public-domain reprints.
 */
export const BUILTIN_ORNAMENTS: readonly OrnamentArt[] = [
  {
    id: 'chapter-flourish',
    name: 'Chapter-Opener Flourish',
    kind: 'chapter',
    width: 240,
    height: 48,
    shapes: [
      // The central stem, rising to a crowning dot.
      { d: 'M120 24 C120 16 124 12 132 12', stroke: 1.6 },
      { d: 'M120 24 C120 16 116 12 108 12', stroke: 1.6 },
      // Scrollwork running out to each side, mirrored.
      { d: 'M120 24 C140 24 156 18 168 24 C180 30 196 26 210 22', stroke: 1.6 },
      { d: 'M210 22 C214 21 216 24 213 26 C210 28 206 26 208 23', stroke: 1.6 },
      { d: 'M120 24 C100 24 84 18 72 24 C60 30 44 26 30 22', stroke: 1.6 },
      { d: 'M30 22 C26 21 24 24 27 26 C30 28 34 26 32 23', stroke: 1.6 },
      { d: circle(120, 9, 2.2) }
    ]
  },
  {
    id: 'chapter-rule',
    name: 'Rule and Lozenge',
    kind: 'chapter',
    width: 240,
    height: 24,
    shapes: [
      // The plainest of them, and the one that does not date a book: a hairline
      // broken by a lozenge. Sets under any face and stays out of the way of a
      // long title.
      { d: rect(8, 11.4, 96, 1.2) },
      { d: 'M120 6 L127 12 L120 18 L113 12 Z' },
      { d: rect(136, 11.4, 96, 1.2) }
    ]
  },
  {
    id: 'chapter-leaves',
    name: 'Aldus Leaf',
    kind: 'chapter',
    width: 240,
    height: 30,
    shapes: [
      // The printer's aldus leaf, on a stem that tapers to a point either side.
      // Drawn once and mirrored rather than stacked: the first attempt set two
      // pairs of filled ellipses one above the other and they printed as a
      // single black smear at this size, which is the whole risk with a solid
      // ornament — it has to be read at a fifth of the height it is drawn at.
      { d: 'M120 8 C126 12 128 16 120 22 C112 16 114 12 120 8 Z' },
      { d: 'M114 15 C100 9 84 11 74 15 C84 21 100 22 114 15 Z' },
      { d: 'M126 15 C140 9 156 11 166 15 C156 21 140 22 126 15 Z' },
      { d: 'M74 15 C64 15 56 14 46 15 C56 16 64 15 74 15 Z' },
      { d: 'M166 15 C176 15 184 14 194 15 C184 16 176 15 166 15 Z' }
    ]
  },
  {
    id: 'chapter-asterism',
    name: 'Asterism',
    kind: 'chapter',
    width: 240,
    height: 36,
    shapes: [
      // Three stars in a triangle — the mark a nineteenth-century compositor
      // reached for, and the quietest thing here that is still an ornament
      // rather than a rule.
      //
      // 240 wide like the others on purpose. The engine draws every ornament to
      // the same fraction of the measure, so the viewBox is a *scale* and not a
      // size: at 120 these came out twice the height of the flourish and read
      // as three black stars nailed under the title.
      star(120, 9, 7.5),
      star(105, 25, 7.5),
      star(135, 25, 7.5)
    ].map((d) => ({ d }))
  },
  {
    id: 'chapter-wave',
    name: 'Wave and Points',
    kind: 'chapter',
    width: 240,
    height: 28,
    shapes: [
      // A single drawn line rather than a ruled one, with a point at each end
      // to stop it. Reads as hand-cut, which the flourish also does, but
      // without the scrollwork — a lighter version of the same idea.
      { d: 'M28 14 C56 4 84 24 120 14 C156 4 184 24 212 14', stroke: 1.3 },
      { d: circle(24, 14, 2.2) },
      { d: circle(216, 14, 2.2) }
    ]
  },
  {
    id: 'fleuron-center',
    name: 'Centered Fleuron',
    kind: 'divider',
    width: 120,
    height: 60,
    shapes: [
      { d: 'M60 18 C66 26 66 34 60 42 C54 34 54 26 60 18 Z' },
      { d: 'M58 30 C46 22 34 24 24 30 C34 36 46 38 58 30 Z' },
      { d: 'M62 30 C74 22 86 24 96 30 C86 36 74 38 62 30 Z' },
      { d: circle(18, 30, 2.4) },
      { d: circle(102, 30, 2.4) }
    ]
  },
  {
    id: 'section-rule',
    name: 'Thin Section Rule',
    kind: 'divider',
    width: 200,
    height: 16,
    shapes: [
      { d: rect(10, 7.4, 78, 1.2) },
      { d: rect(112, 7.4, 78, 1.2) },
      { d: 'M100 3 L106 8 L100 13 L94 8 Z' }
    ]
  },
  {
    id: 'diamond-divider',
    name: 'Diamond Dinkus',
    kind: 'divider',
    width: 80,
    height: 20,
    shapes: [
      { d: 'M20 4 L26 10 L20 16 L14 10 Z' },
      { d: 'M40 4 L46 10 L40 16 L34 10 Z' },
      { d: 'M60 4 L66 10 L60 16 L54 10 Z' }
    ]
  },
  {
    id: 'page-dingbat',
    name: 'Page-Number Dingbat',
    kind: 'page',
    width: 24,
    height: 24,
    shapes: [
      { d: 'M12 4 C13.4 8 13.4 9.4 12 11 C10.6 9.4 10.6 8 12 4 Z' },
      { d: 'M12 20 C13.4 16 13.4 14.6 12 13 C10.6 14.6 10.6 16 12 20 Z' },
      { d: 'M4 8 C8 8.6 9.2 9.4 10.4 11.2 C8.2 11.6 6.6 10.8 4 8 Z' },
      { d: 'M20 8 C16 8.6 14.8 9.4 13.6 11.2 C15.8 11.6 17.4 10.8 20 8 Z' },
      { d: 'M4 16 C8 15.4 9.2 14.6 10.4 12.8 C8.2 12.4 6.6 13.2 4 16 Z' },
      { d: 'M20 16 C16 15.4 14.8 14.6 13.6 12.8 C15.8 12.4 17.4 13.2 20 16 Z' },
      { d: circle(12, 12, 1.4) }
    ]
  },
  {
    // The odd one out twice over: traced rather than drawn — layered, and grey
    // in places, which is what `OrnamentShape.grey` exists for — and a
    // publisher's device rather than a flourish. Its home is the spine of a
    // cover, and there is no cover machinery here yet, so it is offered where
    // a device can at least be *placed* rather than sat in the file unreachable.
    // See `ink-bottle.ts`.
    id: 'ink-bottle',
    name: 'Ink Bottle (imprint device)',
    kind: 'chapter',
    width: INK_BOTTLE_WIDTH,
    height: INK_BOTTLE_HEIGHT,
    shapes: INK_BOTTLE_SHAPES
  }
]

/** Find an ornament by id, or null when the profile names one that is gone. */
export function findOrnament(
  id: string | null,
  library: readonly OrnamentArt[] = BUILTIN_ORNAMENTS
): OrnamentArt | null {
  if (!id) return null
  return library.find((o) => o.id === id) ?? null
}
