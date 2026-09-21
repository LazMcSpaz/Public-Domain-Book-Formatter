import { describe, it, expect } from 'vitest'
import {
  CLEANUP_PRESETS,
  DEFAULT_CLEANUP,
  cleanupOps,
  pageTones,
  parseCleanupPreset,
  MIN_TONE_SPREAD
} from '@core/image/cleanup'
import { applyOps, sizeAfterOps, type RasterImage } from '@core/image/engine'

/** A histogram with `paperShare` of pixels at `paper` and the rest spread over the ink. */
function histogram(paper: number, ink: number, paperShare = 0.92, total = 10000): number[] {
  const h = new Array<number>(256).fill(0)
  const paperPx = Math.round(total * paperShare)
  h[paper] = paperPx
  // Ink: a soft-edged stroke, most pixels at `ink`, some on the way up to paper.
  const inkPx = total - paperPx
  h[ink] += Math.round(inkPx * 0.6)
  h[Math.min(255, ink + 40)] += Math.round(inkPx * 0.25)
  h[Math.min(255, ink + 90)] += inkPx - Math.round(inkPx * 0.6) - Math.round(inkPx * 0.25)
  return h
}

describe('pageTones — the leaf’s own paper and ink', () => {
  it('finds white paper and black ink on a clean scan', () => {
    expect(pageTones(histogram(250, 20))).toEqual({ paper: 250, ink: 20 })
  })

  it('finds cream, grey and foxed paper alike, each at its own tone', () => {
    expect(pageTones(histogram(228, 30))?.paper).toBe(228)
    expect(pageTones(histogram(170, 25))?.paper).toBe(170)
    expect(pageTones(histogram(196, 60))?.paper).toBe(196)
  })

  it('abstains on a blank leaf rather than stretching noise into speckle', () => {
    const blank = new Array<number>(256).fill(0)
    blank[240] = 9000
    blank[236] = 900
    blank[232] = 100
    expect(pageTones(blank)).toBeNull()
  })

  it('abstains when paper and ink are too close to anchor to', () => {
    expect(pageTones(histogram(120, 120 - MIN_TONE_SPREAD + 1))).toBeNull()
    expect(pageTones(histogram(120, 120 - MIN_TONE_SPREAD))).not.toBeNull()
  })

  it('abstains on an empty histogram', () => {
    expect(pageTones(new Array<number>(256).fill(0))).toBeNull()
  })
})

describe('cleanupOps — preset to op list', () => {
  const tones = { paper: 230, ink: 25 }

  it('off is today’s behaviour, byte for byte: no ops at all', () => {
    expect(cleanupOps('off', tones)).toEqual([])
    expect(cleanupOps('off', null)).toEqual([])
  })

  it('gentle is grayscale then levels anchored to the leaf', () => {
    expect(cleanupOps('gentle', tones)).toEqual([
      { op: 'grayscale', params: {} },
      { op: 'levels', params: { black: 25, white: 230, gamma: 1 } }
    ])
  })

  it('applies no levels to a leaf with no tones to anchor to', () => {
    expect(cleanupOps('gentle', null)).toEqual([{ op: 'grayscale', params: {} }])
  })

  it('despeckle and binarise build on gentle', () => {
    const ops = cleanupOps('gentle+despeckle', tones).map((o) => o.op)
    expect(ops).toEqual(['grayscale', 'levels', 'despeckle'])
    expect(cleanupOps('binarise', tones).map((o) => o.op)).toEqual([
      'grayscale',
      'levels',
      'threshold'
    ])
  })

  /** Rule 2 of the plan: every word box stays in original-page pixels. */
  it('no preset changes the page’s size', () => {
    for (const preset of CLEANUP_PRESETS) {
      for (const t of [tones, null]) {
        expect(sizeAfterOps(2550, 3300, cleanupOps(preset, t))).toEqual({
          width: 2550,
          height: 3300
        })
      }
    }
  })

  it('gentle puts the paper at white and the ink at black, through the real engine', () => {
    // A 3×1 raster: paper, ink, and a mid-tone stroke edge.
    const img: RasterImage = {
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([230, 230, 230, 255, 25, 25, 25, 255, 120, 120, 120, 255])
    }
    const out = applyOps(img, cleanupOps('gentle', tones))
    expect([out.width, out.height]).toEqual([3, 1])
    expect(out.data[0]).toBe(255)
    expect(out.data[4]).toBe(0)
    expect(out.data[8]).toBeGreaterThan(0)
    expect(out.data[8]).toBeLessThan(255)
    // And the source is untouched: the original render is the evidence.
    expect(img.data[0]).toBe(230)
  })

  it('the default is off until the ledger says otherwise', () => {
    expect(DEFAULT_CLEANUP).toBe('off')
    expect(parseCleanupPreset('gentle')).toBe('gentle')
    expect(parseCleanupPreset('sharpen')).toBeNull()
    expect(parseCleanupPreset(undefined)).toBeNull()
  })
})
