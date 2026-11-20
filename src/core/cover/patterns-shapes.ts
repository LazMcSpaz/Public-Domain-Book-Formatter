/**
 * The vector grounds' shapes: laid paper, the auric field, guilloche and
 * ribbons, drawn in points.
 *
 * Pure: shapes out.
 */
import type { OrnamentShape } from '@core/ornament'

export const TWO_PI = Math.PI * 2
/** Control-point ratio that makes four cubics indistinguishable from a circle. */
export const K = 0.5522847498307936

/** An ellipse as four cubic Béziers, in the ornament's own coordinates. */
export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
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

export function line(x0: number, y0: number, x1: number, y1: number): string {
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
export function laidPaper(widthPt: number, heightPt: number): OrnamentShape[] {
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
export function auricField(widthPt: number, heightPt: number): OrnamentShape[] {
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
export function guilloche(widthPt: number, heightPt: number): OrnamentShape[] {
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

export function gcd(a: number, b: number): number {
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
export const WAVE_DUTY = 0.5
export const WAVE_STEP_IN = 0.06

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
export function heightAt(xIn: number, level: number): number {
  let y = level
  for (let i = 0; i < 24; i += 1) y = level - waveOffset(xIn, y)
  return y
}

export function ribbons(widthPt: number, heightPt: number): OrnamentShape[] {
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
