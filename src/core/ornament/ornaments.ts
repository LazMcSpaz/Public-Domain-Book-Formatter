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
   * Round the ends of a stroked path, as a pen leaves them. Omitted means the
   * PDF's default square end, which every ornament drawn before this field
   * existed was printed with, so a published book re-exported looks the same.
   */
  cap?: 'round'
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
  shapes: OrnamentShape[]
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

/**
 * Path data mirrored left to right across a 240-wide viewBox (x becomes 240 - x).
 *
 * Absolute commands only (M, L, C, Z), whose numbers come in x, y pairs, which
 * is all the hand-drawn ornaments here use. One half is drawn and the other is
 * made from it, so the two sides cannot drift apart.
 */
function mirrorX(d: string): string {
  let i = 0
  return d.replace(/-?\d+(?:\.\d+)?/g, (n) => (i++ % 2 === 0 ? String(+(240 - +n).toFixed(3)) : n))
}

/** A half-ornament's shapes, followed by their mirror images. */
function bothSides(shapes: OrnamentShape[]): OrnamentShape[] {
  return shapes.flatMap((shape) => [shape, { ...shape, d: mirrorX(shape.d) }])
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
    id: 'chapter-vine',
    name: 'Vine and Bud',
    kind: 'chapter',
    width: 240,
    height: 30,
    shapes: [
      // Chosen by the editor on 19 November 2026 for the house look: finer
      // line work than the Aldus Leaf. A vine runs out from a centre bud,
      // dipping under one leaf and rising over another, and ends in a small
      // three-petal bud with a curl beneath. The vine tapers, heaviest at the
      // centre: three strokes meet where the curve runs level, so the steps
      // do not show. Every stroke stays at least 0.5 pt wide when drawn at
      // the narrowest house measure (6×9), the least a press holds.
      { d: 'M120 9.5 C123.2 12.6 123.2 17.4 120 20.5 C116.8 17.4 116.8 12.6 120 9.5 Z' },
      ...bothSides([
        { d: 'M124.5 15 C136 15 142 20.5 152 20.5', stroke: 1.3, cap: 'round' },
        { d: 'M152 20.5 C162 20.5 166 14.5 176 14.5', stroke: 1.15, cap: 'round' },
        { d: 'M176 14.5 C188 14.5 195 18.5 203 18.5', stroke: 1.02, cap: 'round' },
        { d: 'M147 20.6 C149.2 24.5 153.8 25.9 156.8 25.4 C155.6 22.6 151.6 20.6 147 20.6 Z' },
        { d: 'M172 14.4 C174.2 10.6 178.8 9.2 181.8 9.7 C180.6 12.5 176.6 14.4 172 14.4 Z' },
        { d: 'M203 18.5 C208.5 18.5 211.5 17.4 213.6 16.2', stroke: 0.98, cap: 'round' },
        { d: 'M214.4 15.8 C216.6 14.6 219.4 14.6 221.4 15.8 C219.4 17 216.6 17 214.4 15.8 Z' },
        { d: 'M214.4 15.8 C214.8 13.4 216.6 11.4 219 10.6 C218.6 13 216.8 15 214.4 15.8 Z' },
        { d: 'M214.4 15.8 C216.8 16.4 218.8 18.2 219.6 20.6 C217.2 20 215.2 18.2 214.4 15.8 Z' },
        {
          d: 'M209.5 18 C211.2 20.8 210.6 23.6 208.4 24.4 C206.6 25 205.2 23.4 206.2 22',
          stroke: 0.95,
          cap: 'round'
        }
      ])
    ]
  },
  {
    id: 'chapter-double-hairline',
    name: 'Lozenge and Double Hairline',
    kind: 'chapter',
    width: 240,
    height: 30,
    shapes: [
      // Drawn alongside the vine and kept on file (19 November 2026): an open
      // diamond with a dot, between pairs of hairlines that narrow to points.
      { d: 'M120 8.2 L126.8 15 L120 21.8 L113.2 15 Z', stroke: 1.1 },
      { d: circle(120, 15, 1.35) },
      ...bothSides([
        { d: 'M131 12.85 L214 13.45 L131 13.95 Z' },
        { d: 'M131 16.05 L214 16.55 L131 17.15 Z' }
      ])
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
