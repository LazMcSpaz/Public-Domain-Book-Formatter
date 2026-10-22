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
  'laid' | 'fleuron' | 'aura' | 'guilloche' | 'marbled' | 'lexicon' | 'contour'

export const GROUND_PATTERNS: readonly GroundPattern[] = [
  'laid',
  'fleuron',
  'aura',
  'guilloche',
  'marbled',
  'lexicon',
  'contour'
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
  contour: 'Contour lines — the nested rings of a map, over a landscape that is not anywhere'
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
  contour:
    'Isolines through a made-up landscape: closed rings where it rises, long runs where it falls away. Drawn rather than supplied, so it prints as vector at any size, and allover by construction — there is no summit in the middle for a reader to find.'
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
  // A line map is almost all ground. Measured over a 6×9 wrap by summing the
  // stroked length against the sheet's area, its ink covers 1.6% of it where
  // the laid paper's lines cover 15.2% — a tenth as much — so it carries the
  // highest tint here and still prints far lighter than `laid` at 0.07.
  contour: 0.14
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
 * A landscape that is not anywhere, as a height at a point.
 *
 * **One hill, and its summit is off the board.** An earlier field summed four
 * sinusoids of comparable weight, which is a plain of small bumps: every one
 * of them closes its own ring, and a sheet of little rings reads as a pattern
 * of concentric circles rather than as a map. So the dominant term is a single
 * broad dome whose centre sits outside the sheet, and what crosses the board
 * is the *flank* of it — long arcs that sweep from edge to edge.
 *
 * The waves on top are what make them contours rather than arcs, and they are
 * deliberately slow: at a wavelength of a few inches a line gathers two or
 * three bends crossing the board. Faster waves put a bend every half inch,
 * which is where the small closed rings come back.
 *
 * Lengths are in inches so the look is the same on a 6×9 and an 8.25×11 — a
 * field defined in points would draw a coarser map on a bigger board.
 *
 * Exported for the one test that can tell a contour map from a plausible
 * tangle of lines: every segment of one path has to stand at the same height,
 * which is what being an isoline *means*.
 */
export function contourLandscape(xIn: number, yIn: number): number {
  // The summit, in inches from the sheet's top-left corner. Off the left edge
  // and a little above the middle, so no ring closes inside the board and the
  // arcs open towards the right of the sheet.
  const peakX = -3.2
  const peakY = 3.1
  const dx = xIn - peakX
  const dy = yIn - peakY
  const dome = -(dx * dx + dy * dy) * 0.021

  // Slow swells, at wavelengths of roughly four and eight inches, so a line
  // bends two or three times across a board rather than a dozen.
  const swell =
    1.15 * Math.sin(xIn * 0.47 + 0.6) +
    0.85 * Math.sin(yIn * 0.39 - 0.9) +
    0.45 * Math.sin(xIn * 0.26 + yIn * 0.31 + 1.9)

  return dome + swell
}

/** Where a contour crosses the segment between two sampled corners. */
function crossing(a: number, b: number, level: number): number {
  const span = b - a
  // Parallel to the level: the caller only asks when the two straddle it, and
  // a zero span there would be a division by nothing.
  return Math.abs(span) < 1e-9 ? 0.5 : (level - a) / span
}

/**
 * The isolines of that landscape, by marching squares.
 *
 * The grid is sampled a sixth of an inch apart, which is fine enough that a
 * ring looks drawn rather than facetted and coarse enough that a sheet is tens
 * of thousands of cells rather than millions. Each cell contributes at most
 * two segments, and the segments are emitted as they are found rather than
 * stitched into polylines: a cover prints them identically either way, and the
 * stitching is a quantity of code that would have to be right about floating
 * point to buy nothing but a smaller file.
 *
 * The saddle case — two high corners diagonally opposite — is resolved by the
 * cell's own mean, which is the standard disambiguation and the only one that
 * cannot produce a line that stops in mid air.
 */
function contourMap(widthPt: number, heightPt: number): OrnamentShape[] {
  const stepIn = 1 / 6
  const stepPt = stepIn * 72
  const cols = Math.ceil(widthPt / stepPt) + 1
  const rows = Math.ceil(heightPt / stepPt) + 1

  // Sampled once and reused by every level: the field is the expensive part
  // and it does not depend on which line is being drawn.
  const field: number[] = new Array(cols * rows)
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      field[r * cols + c] = contourLandscape((c * stepPt) / 72, (r * stepPt) / 72)
    }
  }

  const levels: number[] = []
  // The dome drags the field a long way negative towards the far corner, so
  // the levels run much wider than a field of pure swells would need. The
  // step is what sets how close the lines lie: a fifth of the swell's own
  // amplitude puts a few lines on each bend without closing the gaps.
  for (let v = -14; v <= 2.5; v += 0.3) levels.push(v)

  const shapes: OrnamentShape[] = []
  const at = (c: number, r: number): number => field[r * cols + c]!

  for (const level of levels) {
    const parts: string[] = []
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const tl = at(c, r)
        const tr = at(c + 1, r)
        const br = at(c + 1, r + 1)
        const bl = at(c, r + 1)
        let code = 0
        if (tl > level) code |= 8
        if (tr > level) code |= 4
        if (br > level) code |= 2
        if (bl > level) code |= 1
        if (code === 0 || code === 15) continue

        const x0 = c * stepPt
        const y0 = r * stepPt
        // The four edge crossings, named for the side they sit on.
        const top = { x: x0 + crossing(tl, tr, level) * stepPt, y: y0 }
        const right = { x: x0 + stepPt, y: y0 + crossing(tr, br, level) * stepPt }
        const bottom = { x: x0 + crossing(bl, br, level) * stepPt, y: y0 + stepPt }
        const left = { x: x0, y: y0 + crossing(tl, bl, level) * stepPt }

        const draw = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
          parts.push(`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`)
        }

        switch (code) {
          case 1:
          case 14:
            draw(left, bottom)
            break
          case 2:
          case 13:
            draw(bottom, right)
            break
          case 3:
          case 12:
            draw(left, right)
            break
          case 4:
          case 11:
            draw(top, right)
            break
          case 6:
          case 9:
            draw(top, bottom)
            break
          case 7:
          case 8:
            draw(left, top)
            break
          case 5:
          case 10: {
            // The ambiguous pair. Joining the wrong two corners leaves a line
            // that ends nowhere, so the cell's mean decides which way the
            // ridge actually runs.
            const centre = (tl + tr + br + bl) / 4
            const high = centre > level
            if ((code === 5) === high) {
              draw(left, top)
              draw(bottom, right)
            } else {
              draw(left, bottom)
              draw(top, right)
            }
            break
          }
        }
      }
    }
    if (parts.length > 0) shapes.push({ d: parts.join(' '), stroke: 0.6 })
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
        : pattern === 'contour'
          ? contourMap(widthPt, heightPt)
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
