/**
 * The ground pattern — a texture across the whole wrap.
 *
 * ## Why this is drawn rather than generated
 *
 * A full 6×9 wrap is 12.96 × 9.25 inches, which at KDP's 300 DPI is **10.8
 * megapixels**. The largest image models on offer reach about four. So a
 * generated ground would be an upscale stretched across the entire object —
 * and a ground is the worst possible place for softness, because there is no
 * subject for the eye to land on instead. Everything the texture has to be
 * (repeating, faint, exact, identical on every volume of a series) is what
 * vector is for and what generation is worst at.
 *
 * ## The three things that make a faint texture print
 *
 * 1. **It cannot be too faint.** A tint below about 5% of the ink is at the
 *    edge of what a print-on-demand press resolves; below it a tint either
 *    vanishes or mottles, and mottling is much the worse of the two. Nothing
 *    in `PATTERN_OPACITY` goes under that line. Sitting *on* it, as the house
 *    marble does, is a deliberate choice for the faintest possible ground and
 *    is the one value here that only a printed proof can confirm.
 * 2. **The strokes cannot be hairlines.** A 0.2pt rule at 8% opacity breaks up
 *    into dots. Nothing here draws below 0.5pt.
 * 3. **It must not need to line up across the spine.** The cover wraps a fold
 *    that creeps by up to an eighth of an inch, so anything reading as one
 *    continuous picture across the wrap will look misregistered on the printed
 *    copy. Every pattern here is *allover* — no alignment to notice, and
 *    therefore none to get wrong.
 *
 * Pure: path data in points, no DOM.
 */
import type { OrnamentArt, OrnamentShape } from '@core/ornament'

export type GroundPattern =
  'laid' | 'fleuron' | 'aura' | 'guilloche' | 'marbled' | 'lexicon' | 'wave'

export const GROUND_PATTERNS: readonly GroundPattern[] = [
  'laid',
  'fleuron',
  'aura',
  'guilloche',
  'marbled',
  'lexicon',
  'wave'
]

/**
 * The id a picture-backed ground is placed under.
 *
 * Four of the five patterns are drawn here as paths and reach the PDF as
 * vector. `marbled` cannot: it is a *trace of a raster* — seventeen hundred
 * paths and seven gradients — and `drawSvgPath` writes path data with a single
 * flat fill, so every gradient would be lost and the whole sheet would come out
 * solid. It is therefore rendered by the browser, which is a far better SVG
 * renderer than this app will ever contain, at the size it prints.
 */
export const GROUND_IMAGE_ID = '__ground__'

/** Where a picture-backed ground's file lives, relative to the app. */
export const GROUND_IMAGE_SRC: Readonly<Partial<Record<GroundPattern, string>>> = {
  marbled: '/patterns/marbled.svg',
  lexicon: '/patterns/lexicon.svg'
}

/** Whether this ground is a picture rather than drawn paths. */
export function isImageGround(pattern: GroundPattern): boolean {
  return GROUND_IMAGE_SRC[pattern] !== undefined
}

export const PATTERN_LABEL: Readonly<Record<GroundPattern, string>> = {
  laid: 'Laid paper — the chain and laid lines of a handmade sheet',
  fleuron: 'A diaper of fleurons — the printer’s own flowers, in a lattice',
  aura: 'Auric ovoids — the diagram from The Human Aura, as a field',
  guilloche: 'Guilloche — the engine-turned rosette of a share certificate',
  marbled: 'Marbled paper — the swirled endpaper of a bound book',
  lexicon: 'The book’s own text, set as a field and turned',
  wave: 'Flowing bands — the undulating lines of a 1970s poster'
}

export const PATTERN_NOTE: Readonly<Record<GroundPattern, string>> = {
  laid: 'The most restrained of the four and the safest to print: parallel lines with nothing to misregister, and it reads as paper rather than as decoration.',
  fleuron:
    'Period-correct and yours: the same fleurons the interior sets, so the book is patterned with its own ornament.',
  aura: 'From the book itself. Geometric, strange, and unmistakably this series — a texture that came out of the text rather than off a shelf.',
  guilloche:
    'The engraved lathe-work of 1910s commercial printing — banknotes, share certificates, diplomas. Expensive-looking and entirely of the period.',
  marbled:
    'The house pattern. Supplied as artwork rather than drawn here, so it prints as a picture at the resolution the sheet needs rather than as paths.',
  lexicon:
    'The volume’s own words, run together into one field and set at an angle — headwords bold and language tags italic, as the book sets them. Generated per book by `scripts/textground.mjs`, which is why it is artwork rather than paths.',
  wave: 'Parallel lines that undulate in step and drift out of it, so along the sheet they crowd together and open out again. Drawn rather than supplied, so it prints as vector at any size, and allover by construction.'
}

/** How strongly a ground prints, as a fraction of the ink. */
export const PATTERN_OPACITY: Readonly<Record<GroundPattern, number>> = {
  laid: 0.07,
  fleuron: 0.08,
  aura: 0.09,
  guilloche: 0.06,
  // Set at the floor by request. Everything above still applies: this is the
  // lightest a print-on-demand press can be relied on to hold, not a safe
  // middle, and it is the one number here that a proof copy should settle.
  marbled: 0.05,
  // Measured rather than chosen: the field's ink coverage is 12.75%, which is
  // the same order as the laid paper's lines, so it sits in the same band they
  // do. The type is 10pt, whose stems are about 0.8pt, well clear of the
  // hairline floor above; setting it smaller to fit more of the book in is the
  // way to break rule 2.
  lexicon: 0.1,
  // Measured by summing stroked length against the sheet's area on a 6×9
  // wrap: see the note beside `lexicon`. Set after looking at the board.
  wave: 0.14
}

/**
 * What a ground may be turned down or up to, when a book asks.
 *
 * The same bounds the ground figure runs under and for the same two reasons:
 * below three per cent a print-on-demand press stops holding a tint reliably,
 * and past a fifth a ground stops being a ground. The *default* for each
 * pattern stays `PATTERN_OPACITY` — this is the band a book may move inside,
 * not a replacement for the measured values above.
 */
export const MIN_PATTERN_OPACITY = 0.03
export const MAX_PATTERN_OPACITY = 0.2

/**
 * How faint this ground prints: the book's own answer, or the pattern's.
 *
 * `null` is "whatever this pattern was set at", which is what a look banked
 * before the question existed carries — so an old profile keeps exactly the
 * appearance it was banked with rather than silently acquiring a default.
 */
export function patternOpacity(pattern: GroundPattern, requested: number | null): number {
  if (requested === null || !Number.isFinite(requested)) return PATTERN_OPACITY[pattern]
  return Math.min(MAX_PATTERN_OPACITY, Math.max(MIN_PATTERN_OPACITY, requested))
}

const TWO_PI = Math.PI * 2
/** Control-point ratio that makes four cubics indistinguishable from a circle. */
const K = 0.5522847498307936

/** An ellipse as four cubic Béziers, in the ornament's own coordinates. */
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * K
  const ky = ry * K
  return [
    `M ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry}`,
    `C ${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}`,
    'Z'
  ].join(' ')
}

function line(x0: number, y0: number, x1: number, y1: number): string {
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} L ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/**
 * The laid and chain lines of a handmade sheet.
 *
 * Laid lines are the close ones left by the wires of the mould, about twenty to
 * the inch; chain lines are the widely-spaced ones where the wires were sewn
 * down. Getting the two spacings right is the whole effect — evenly spaced
 * lines read as a grid, and a grid reads as a spreadsheet.
 */
function laidPaper(widthPt: number, heightPt: number): OrnamentShape[] {
  const shapes: OrnamentShape[] = []
  const laidSpacing = 72 / 20
  for (let x = 0; x <= widthPt; x += laidSpacing) {
    shapes.push({ d: line(x, 0, x, heightPt), stroke: 0.5 })
  }
  for (let y = 0; y <= heightPt; y += 72 * 1.05) {
    shapes.push({ d: line(0, y, widthPt, y), stroke: 1.1 })
  }
  return shapes
}

/**
 * Concentric ovoids, in a staggered field.
 *
 * The diagram in *The Human Aura* is a figure inside nested ovoid bands. Taken
 * out of the plate and repeated it stops being an illustration and becomes a
 * texture, which is the point: at eight per cent it is a surface, and only a
 * reader who looks closely finds it is the book's own subject.
 */
function auricField(widthPt: number, heightPt: number): OrnamentShape[] {
  const shapes: OrnamentShape[] = []
  const spacingX = 72 * 1.7
  const spacingY = 72 * 2.1
  const rings = 4
  let row = 0
  for (let cy = -spacingY / 2; cy < heightPt + spacingY; cy += spacingY, row += 1) {
    const offset = row % 2 === 0 ? 0 : spacingX / 2
    for (let cx = -spacingX + offset; cx < widthPt + spacingX; cx += spacingX) {
      for (let ring = 1; ring <= rings; ring += 1) {
        const rx = (ring / rings) * 26
        shapes.push({ d: ellipse(cx, cy, rx, rx * 1.42), stroke: 0.7 })
      }
    }
  }
  return shapes
}

/**
 * Engine-turned lathe work, as a share certificate carries.
 *
 * A guilloche is two circles rolled against each other; the closed curve it
 * traces is what a rose engine cut into a printing plate, and it is why
 * banknotes look the way they do. Drawn as a polyline because the curve is
 * parametric — approximating it with Béziers would be more code for a shape
 * printing at six per cent.
 */
function guilloche(widthPt: number, heightPt: number): OrnamentShape[] {
  const shapes: OrnamentShape[] = []
  const spacing = 72 * 2.4
  const outer = 40
  const inner = 11
  const pen = 21
  const steps = 220
  let row = 0
  for (let cy = -spacing / 2; cy < heightPt + spacing; cy += spacing, row += 1) {
    const offset = row % 2 === 0 ? 0 : spacing / 2
    for (let cx = -spacing + offset; cx < widthPt + spacing; cx += spacing) {
      const points: string[] = []
      for (let i = 0; i <= steps; i += 1) {
        const t = (i / steps) * TWO_PI * (inner / gcd(outer, inner))
        // A hypotrochoid: the classic spirograph curve, which is what a rose
        // engine draws.
        const x = (outer - inner) * Math.cos(t) + pen * Math.cos(((outer - inner) / inner) * t)
        const y = (outer - inner) * Math.sin(t) - pen * Math.sin(((outer - inner) / inner) * t)
        points.push(`${(cx + x).toFixed(2)} ${(cy + y).toFixed(2)}`)
      }
      shapes.push({ d: `M ${points.join(' L ')} Z`, stroke: 0.6 })
    }
  }
  return shapes
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * Flowing ribbons, in the manner of a 1970s poster.
 *
 * Filled bands rather than drawn lines, because that is what the look is made
 * of: a stack of stripes put through a warp, so they sweep across the sheet
 * swelling and pinching, and the ground between them is as much of the
 * pattern as the ink.
 *
 * ## How the swell comes out for nothing
 *
 * Take a warped coordinate `u = y + W(x, y)` and fill the stripes of `u`. A
 * band's thickness **in y** is the period divided by `∂u/∂y`, so wherever the
 * warp flattens, the band fattens, and where the warp steepens it draws to a
 * point. None of that is drawn: it falls out of the warp, which is why the
 * pinches land where the sweep is steepest, as they do on a printed poster.
 *
 * ## The one constraint on the numbers
 *
 * `u` has to rise with y everywhere, or a band doubles back and its outline
 * crosses itself — a filled polygon that laps over its neighbour and prints as
 * a blot. Differentiating, that holds exactly while the sum of each term's
 * amplitude times its y-rate stays under 1. At 0.73 a band runs about six and
 * a half times thicker at its widest than at its narrowest, which is the swell
 * the look wants; nearer 1 the thin end vanishes to nothing and the fat end
 * swallows a quarter of the board.
 *
 * Lengths are in inches, so a 6×9 and an 8.25×11 get the same ribbons rather
 * than the same number of them.
 */
/** Distance between one band's leading edge and the next, in warped space. */
export const WAVE_PERIOD_IN = 0.46
/** How much of each period is inked. The rest is the board showing through. */
const WAVE_DUTY = 0.5
const WAVE_STEP_IN = 0.06

/** The warp: how far the stripes are pushed at a point, in inches. */
export function waveOffset(xIn: number, yIn: number): number {
  return 0.55 * Math.sin(xIn * 1.85 + yIn * 1.0) + 0.26 * Math.sin(xIn * 2.9 - yIn * 0.7 + 2.1)
}

/**
 * The y at which the warped coordinate reaches a given level, for one x.
 *
 * `u = y + W(x, y)` rearranges to `y = u - W(x, y)`, and the warp's own slope
 * in y is under 1 by the constraint above, so iterating that is a contraction
 * and settles in a few passes. A bisection would do as well and costs more.
 */
function heightAt(xIn: number, level: number): number {
  let y = level
  for (let i = 0; i < 24; i += 1) y = level - waveOffset(xIn, y)
  return y
}

function ribbons(widthPt: number, heightPt: number): OrnamentShape[] {
  const widthIn = widthPt / 72
  const heightIn = heightPt / 72
  // The warp displaces `u` by at most the sum of the amplitudes, so the bands
  // that can touch the sheet are those whose level falls in this range. Run
  // past it at both ends or the top and bottom edges go bare.
  const reach = 1.2
  const first = Math.floor(-reach / WAVE_PERIOD_IN)
  const last = Math.ceil((heightIn + reach) / WAVE_PERIOD_IN)

  const shapes: OrnamentShape[] = []
  for (let k = first; k <= last; k += 1) {
    const top = k * WAVE_PERIOD_IN
    const bottom = top + WAVE_PERIOD_IN * WAVE_DUTY
    const forward: string[] = []
    const back: string[] = []
    for (let x = -0.3; x <= widthIn + 0.3; x += WAVE_STEP_IN) {
      forward.push(`${(x * 72).toFixed(1)} ${(heightAt(x, top) * 72).toFixed(1)}`)
      back.push(`${(x * 72).toFixed(1)} ${(heightAt(x, bottom) * 72).toFixed(1)}`)
    }
    back.reverse()
    // No stroke: an `OrnamentShape` with none is filled, which is what a
    // ribbon is. A stroked outline would print the band's edges twice.
    shapes.push({ d: `M ${forward.join(' L ')} L ${back.join(' L ')} Z` })
  }
  return shapes
}

/** One piece of the ground, ready to be placed. */
export interface PatternPlacement {
  art: OrnamentArt
  xPt: number
  yPt: number
  scale: number
}

/**
 * The ground for a sheet, as a list of placements.
 *
 * Three of the four are generated here, so they arrive as one piece of art at
 * the origin. The fleuron diaper is different in kind: it repeats a shipped
 * ornament, and the honest way to move a path is **not to touch it**. An
 * earlier draft rewrote the coordinates in the `d` string and produced a field
 * of horizontal dashes — the library's path data has commands this app never
 * writes, and a transformer that assumes every number is half of an x,y pair
 * gets them wrong in silence.
 *
 * So the lattice is a list of positions and the art travels untouched, drawn by
 * the same `x`/`y`/`scale` the renderer already applies to a single ornament.
 * A hundred and twenty items rather than one, which costs nothing, and no
 * bespoke path parser, which is the whole point.
 */
export function groundPattern(
  pattern: GroundPattern,
  widthPt: number,
  heightPt: number,
  fleuron: OrnamentArt | null
): PatternPlacement[] {
  // A picture-backed ground places no paths; the composer emits an image item
  // for it instead. Returning nothing here rather than throwing keeps this a
  // total function over the pattern list.
  if (isImageGround(pattern)) return []

  if (pattern === 'fleuron') {
    if (!fleuron) return []
    const target = 30
    const scale = target / fleuron.width
    const spacingX = 72 * 1.45
    const spacingY = 72 * 1.45
    const out: PatternPlacement[] = []
    let row = 0
    for (let y = -spacingY; y < heightPt + spacingY; y += spacingY, row += 1) {
      const offset = row % 2 === 0 ? 0 : spacingX / 2
      for (let x = -spacingX + offset; x < widthPt + spacingX; x += spacingX) {
        out.push({ art: fleuron, xPt: x, yPt: y, scale })
      }
    }
    return out
  }

  const shapes =
    pattern === 'laid'
      ? laidPaper(widthPt, heightPt)
      : pattern === 'aura'
        ? auricField(widthPt, heightPt)
        : pattern === 'wave'
          ? ribbons(widthPt, heightPt)
          : guilloche(widthPt, heightPt)

  return [
    {
      art: {
        id: `ground-${pattern}`,
        name: PATTERN_LABEL[pattern],
        kind: 'divider',
        width: widthPt,
        height: heightPt,
        shapes
      },
      xPt: 0,
      yPt: 0,
      scale: 1
    }
  ]
}
