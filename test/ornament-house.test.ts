import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUILTIN_ORNAMENTS, findOrnament, type OrnamentArt } from '@core/ornament'

/**
 * The house look's chapter ornament (Vine and Bud) and the one kept on file
 * beside it (Lozenge and Double Hairline), chosen by the editor on 19 November
 * 2026. Their line work has to survive the press at the smallest size the house
 * look prints them, both halves must match, and nothing about the ornaments of
 * books already published may change.
 */

const NEW = ['chapter-vine', 'chapter-double-hairline']

/** The narrowest house measure: 6×9 less the house look's side margins and gutter. */
const NARROWEST_MEASURE_PT = (6 - 1.125 - 0.75 - 0.13) * 72
/** A chapter ornament is drawn this fraction of the measure wide (`paginate.ts`). */
const ORNAMENT_WIDTH_RATIO = 0.45
/** The thinnest line a press reliably holds. */
const THINNEST_PT = 0.5

const art = (id: string): OrnamentArt => {
  const found = findOrnament(id)
  if (!found) throw new Error(`no ornament ${id}`)
  return found
}
const numbers = (d: string): number[] => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
const mirrored = (d: string): string => {
  let i = 0
  return d.replace(/-?\d+(?:\.\d+)?/g, (n) => (i++ % 2 === 0 ? String(+(240 - +n).toFixed(3)) : n))
}

describe('the house chapter ornaments', () => {
  it('are in the library as chapter ornaments, so the design questions offer them', () => {
    for (const id of NEW) {
      expect(art(id).kind).toBe('chapter')
      expect(BUILTIN_ORNAMENTS.filter((o) => o.kind === 'chapter').map((o) => o.id)).toContain(id)
    }
  })

  it('keep every stroke at least 0.5 pt wide at the narrowest house measure', () => {
    for (const id of NEW) {
      const a = art(id)
      const ptPerUnit = (NARROWEST_MEASURE_PT * ORNAMENT_WIDTH_RATIO) / a.width
      for (const shape of a.shapes) {
        if (shape.stroke === undefined) continue
        expect(shape.stroke * ptPerUnit, `${id}: ${shape.d.slice(0, 30)}`).toBeGreaterThanOrEqual(
          THINNEST_PT
        )
      }
    }
  })

  it('stay inside their own box', () => {
    for (const id of NEW) {
      const a = art(id)
      for (const shape of a.shapes) {
        const n = numbers(shape.d)
        const xs = n.filter((_, i) => i % 2 === 0)
        const ys = n.filter((_, i) => i % 2 === 1)
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
        expect(Math.max(...xs)).toBeLessThanOrEqual(a.width)
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
        expect(Math.max(...ys)).toBeLessThanOrEqual(a.height)
      }
    }
  })

  it('are the same on both sides', () => {
    for (const id of NEW) {
      const shapes = art(id).shapes
      // A shape's points as a sorted set, so a centre shape that is its own
      // mirror (drawn in the other order) still matches itself.
      const key = (s: { stroke?: number }, d: string): string => {
        const n = numbers(d)
        const pairs = n.flatMap((v, i) => (i % 2 === 0 ? [`${+v.toFixed(2)} ${n[i + 1]}`] : []))
        return `${s.stroke ?? 'fill'}|${[...new Set(pairs)].sort().join(',')}`
      }
      const keys = new Set(shapes.map((s) => key(s, s.d)))
      for (const s of shapes) {
        const twin = key(s, mirrored(s.d))
        expect(keys.has(twin), `${id}: no mirror for ${s.d.slice(0, 30)}`).toBe(true)
      }
    }
  })

  it('leave every older ornament drawn exactly as before (square line ends)', () => {
    for (const o of BUILTIN_ORNAMENTS.filter((o) => !NEW.includes(o.id))) {
      for (const s of o.shapes) expect(s.cap, o.id).toBeUndefined()
    }
  })

  it('are printed with round line ends only where a shape asks for them', () => {
    const out = readFileSync(new URL('../src/platform/browser/pdf-out.ts', import.meta.url), 'utf8')
    expect(out).toMatch(/shape\.cap === 'round' \? \{ borderLineCap: LineCapStyle\.Round \} : \{\}/)
  })
})
