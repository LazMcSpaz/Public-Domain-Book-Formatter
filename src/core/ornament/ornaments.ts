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

/** A rectangle as a closed path. */
function rect(x: number, y: number, w: number, h: number): string {
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`
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
