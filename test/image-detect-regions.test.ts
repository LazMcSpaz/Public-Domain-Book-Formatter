import { describe, it, expect } from 'vitest'
import { detectRegions } from '@core/image'
import type { SourcePage, WordToken } from '@core/model'

function word(id: string, x0: number, y0: number, x1: number, y1: number): WordToken {
  return { id, text: 'w', bbox: { x0, y0, x1, y1 }, pageIndex: 0, confidence: 90 }
}

function page(index: number, width: number, height: number, words: WordToken[]): SourcePage {
  return { index, imagePath: null, width, height, dpi: null, words, regions: [] }
}

describe('detectRegions', () => {
  it('treats a page with no words as one whole-page candidate', () => {
    const p = page(3, 800, 1200, [])
    const regions = detectRegions(p)
    expect(regions.length).toBe(1)
    expect(regions[0]!.id).toBe('p3_r0')
    expect(regions[0]!.pageIndex).toBe(3)
    expect(regions[0]!.bbox).toEqual({ x0: 0, y0: 0, x1: 800, y1: 1200 })
    expect(regions[0]!.accepted).toBeNull()
  })

  it('returns no candidates for a fully-text page', () => {
    const words: WordToken[] = []
    // Fill the whole grid densely with words.
    for (let y = 0; y < 1200; y += 30) {
      for (let x = 0; x < 800; x += 50) {
        words.push(word(`w_${x}_${y}`, x, y, x + 45, y + 25))
      }
    }
    const regions = detectRegions(page(0, 800, 1200, words))
    expect(regions).toEqual([])
  })

  it('finds a large empty rectangle amid text', () => {
    const words: WordToken[] = []
    // Top band of text (rows 0..200), bottom band of text (rows 1000..1200),
    // leaving a big empty middle that is an image region.
    for (let x = 0; x < 800; x += 50) {
      words.push(word(`t_${x}`, x, 20, x + 45, 60))
      words.push(word(`t2_${x}`, x, 100, x + 45, 140))
      words.push(word(`b_${x}`, x, 1040, x + 45, 1080))
      words.push(word(`b2_${x}`, x, 1140, x + 45, 1180))
    }
    const regions = detectRegions(page(2, 800, 1200, words))
    expect(regions.length).toBeGreaterThanOrEqual(1)
    const r = regions[0]!
    expect(r.accepted).toBeNull()
    expect(r.id).toBe('p2_r0')
    // The region should sit in the empty middle band.
    expect(r.bbox.y0).toBeGreaterThan(140)
    expect(r.bbox.y1).toBeLessThan(1060)
    // And it should be a sizeable area.
    const areaFrac = ((r.bbox.x1 - r.bbox.x0) * (r.bbox.y1 - r.bbox.y0)) / (800 * 1200)
    expect(areaFrac).toBeGreaterThan(0.08)
  })

  it('is deterministic', () => {
    const words = [word('a', 0, 0, 100, 40), word('b', 0, 1160, 100, 1200)]
    const p = page(0, 800, 1200, words)
    expect(detectRegions(p)).toEqual(detectRegions(p))
  })

  it('respects a custom minAreaFraction', () => {
    const words: WordToken[] = []
    for (let x = 0; x < 800; x += 50) {
      words.push(word(`t_${x}`, x, 20, x + 45, 60))
      words.push(word(`b_${x}`, x, 1160, x + 45, 1200))
    }
    const p = page(0, 800, 1200, words)
    const loose = detectRegions(p, { minAreaFraction: 0.05 })
    const strict = detectRegions(p, { minAreaFraction: 0.95 })
    expect(loose.length).toBeGreaterThanOrEqual(strict.length)
    expect(strict.length).toBe(0)
  })
})
