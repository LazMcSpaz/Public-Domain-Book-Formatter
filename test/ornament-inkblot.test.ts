/**
 * The traced ink blot, as data.
 *
 * `layout-pdf` proves the renderer honours a shape's ink level. These are the
 * checks on the art itself, and both exist because the blot is *generated*
 * from `inkball-single.svg` rather than typed: a regeneration is where the two
 * properties below get quietly lost, and neither failure raises anything.
 */
import { describe, it, expect } from 'vitest'
import { BUILTIN_ORNAMENTS, findOrnament } from '@core/ornament'

const blot = findOrnament('chapter-inkblot', BUILTIN_ORNAMENTS)

/** Every coordinate in a path, as x/y pairs — M, L and C all take pairs. */
function coordinates(d: string): { xs: number[]; ys: number[] } {
  const xs: number[] = []
  const ys: number[] = []
  const numbers = d.match(/-?\d+(?:\.\d+)?/gu) ?? []
  numbers.forEach((n, i) => (i % 2 === 0 ? xs : ys).push(Number(n)))
  return { xs, ys }
}

describe('the typewriter ink blot', () => {
  it('is in the library as a chapter ornament', () => {
    expect(blot).not.toBeNull()
    expect(blot?.kind).toBe('chapter')
  })

  it('is layered — a mass of ink with holes knocked out of it', () => {
    // The property the renderer's grey exists to serve. A blot of one ink is
    // a lozenge, and a trace that came back flat would say so here.
    const greys = (blot?.shapes ?? []).map((s) => s.grey ?? 0)
    expect(greys.some((g) => g > 0.9)).toBe(true)
    expect(greys.some((g) => g < 0.1)).toBe(true)
    expect(greys.some((g) => g > 0.2 && g < 0.8)).toBe(true)
  })

  it('is cropped to its own ink, not to the canvas it was traced on', () => {
    // The source is a 2048 square with the blot sitting off-centre inside it.
    // An ornament is scaled by its width and height, so a blot still carrying
    // that canvas reserves a square of mostly-empty slots on the page and
    // draws itself small and off to one side — which looks like a design
    // choice rather than a bug, and is why it is asserted rather than eyed.
    const xs = (blot?.shapes ?? []).flatMap((s) => coordinates(s.d).xs)
    const ys = (blot?.shapes ?? []).flatMap((s) => coordinates(s.d).ys)
    const tolerance = 1

    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-tolerance)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-tolerance)
    // The ink must actually *reach* the box on all four sides. Merely fitting
    // inside it is what the uncropped canvas also does.
    expect(Math.min(...xs)).toBeLessThan(tolerance)
    expect(Math.min(...ys)).toBeLessThan(tolerance)
    expect(Math.max(...xs)).toBeCloseTo(blot?.width ?? 0, 0)
    expect(Math.max(...ys)).toBeCloseTo(blot?.height ?? 0, 0)
  })

  it('paints no white rectangle over the whole of itself', () => {
    // The trace opens with a full-canvas white background rect. Drawn, it
    // would rub out whatever the blot is set over; it is dropped rather than
    // rendered, and this is what says so.
    const w = blot?.width ?? 0
    const h = blot?.height ?? 0
    for (const shape of blot?.shapes ?? []) {
      if ((shape.grey ?? 0) < 0.9) continue
      const { xs, ys } = coordinates(shape.d)
      const coversAll =
        Math.min(...xs) <= 1 &&
        Math.min(...ys) <= 1 &&
        Math.max(...xs) >= w - 1 &&
        Math.max(...ys) >= h - 1
      expect(coversAll).toBe(false)
    }
  })
})
