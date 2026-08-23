/**
 * The cover sheet's arithmetic.
 *
 * ## What pins these numbers
 *
 * The module computes rather than reads a template, so something has to keep
 * the constants honest. Three things do, in descending order of strength:
 *
 * 1. **`KDP_TEMPLATE_FIXTURES`** — dimensions taken from real KDP cover
 *    templates. Every row added here is an independent witness against the
 *    caliper table, and rows can be added by anyone with a template PDF and a
 *    ruler in Acrobat. This is the check that would actually catch a wrong
 *    caliper.
 * 2. **KDP's own worked example** — their help pages give 200 pages of cream at
 *    0.5 in of spine, which pins the cream caliper exactly.
 * 3. **Structural assertions** — the relationships between trim, spine and
 *    sheet, which catch a rearranged panel or a dropped bleed.
 *
 * The rows below currently carry (2) and (3). The repository's own KDP
 * templates should be measured into (1) — see `docs/PLAN-cover.md`.
 */
import { describe, expect, it } from 'vitest'
import {
  BARCODE_H_IN,
  BARCODE_W_IN,
  BLEED_IN,
  coverGeometry,
  MIN_PAGES_FOR_SPINE_TEXT,
  parseTrim,
  PAPER_CALIPER_IN,
  spineWidth,
  contains,
  overlaps,
  type PaperStock
} from '@core/cover'

interface TemplateFixture {
  trim: string
  pages: number
  paper: PaperStock
  /** Flat sheet, bleed included, as the template file measures. */
  fullWidthIn: number
  fullHeightIn: number
  spineIn: number
  source: string
}

const KDP_TEMPLATE_FIXTURES: TemplateFixture[] = [
  {
    // KDP's help pages give this one worked through: 200 pages × 0.0025.
    trim: '6x9',
    pages: 200,
    paper: 'bw-cream',
    spineIn: 0.5,
    fullWidthIn: 12.75,
    fullHeightIn: 9.25,
    source: "KDP's published worked example for cream paper"
  }
]

describe('KDP cover templates', () => {
  for (const f of KDP_TEMPLATE_FIXTURES) {
    it(`matches ${f.source} (${f.trim}, ${f.pages}pp, ${f.paper})`, () => {
      const g = coverGeometry({ trimSize: f.trim, pageCount: f.pages, paper: f.paper })
      expect(g.spineIn).toBeCloseTo(f.spineIn, 4)
      expect(g.fullWidthIn).toBeCloseTo(f.fullWidthIn, 4)
      expect(g.fullHeightIn).toBeCloseTo(f.fullHeightIn, 4)
    })
  }
})

describe('parseTrim', () => {
  it('reads the trims the app offers', () => {
    expect(parseTrim('6x9')).toEqual({ widthIn: 6, heightIn: 9 })
    expect(parseTrim('5.5 × 8.5')).toEqual({ widthIn: 5.5, heightIn: 8.5 })
  })

  it('refuses what it cannot read rather than guessing 6×9', () => {
    // The interior's parser falls back, and must: a body page at the wrong
    // measure is visible at the design gate. A cover has no such gate — a
    // silently-6×9 cover for an 8.5×11 book is discovered at the printer.
    expect(parseTrim('quarto')).toBeNull()
    expect(parseTrim('')).toBeNull()
    expect(parseTrim('0x9')).toBeNull()
    expect(() => coverGeometry({ trimSize: 'quarto', pageCount: 100, paper: 'bw-white' })).toThrow(
      /Unreadable trim/
    )
  })
})

describe('spine width', () => {
  it('is pages times the caliper of one page', () => {
    expect(spineWidth(300, 'bw-white')).toBeCloseTo(300 * PAPER_CALIPER_IN['bw-white'], 6)
    expect(spineWidth(300, 'bw-cream')).toBeCloseTo(0.75, 6)
  })

  it('makes cream thicker than white for the same book', () => {
    // The reason paper is asked at all: the same interior gets two different
    // covers, and using the wrong one folds inside the front panel.
    expect(spineWidth(400, 'bw-cream')).toBeGreaterThan(spineWidth(400, 'bw-white'))
  })

  it('is not rounded', () => {
    // Rounding to two places would move both folds by half the error.
    const s = spineWidth(287, 'bw-white')
    expect(s).not.toBe(Number(s.toFixed(2)))
  })
})

describe('the flat sheet', () => {
  const g = coverGeometry({ trimSize: '6x9', pageCount: 284, paper: 'bw-cream' })

  it('is two trims plus the spine plus bleed on each side', () => {
    expect(g.fullWidthIn).toBeCloseTo(6 * 2 + g.spineIn + BLEED_IN * 2, 6)
    expect(g.fullHeightIn).toBeCloseTo(9 + BLEED_IN * 2, 6)
  })

  it('lays the panels out back, spine, front', () => {
    expect(g.back.x).toBeCloseTo(BLEED_IN, 6)
    expect(g.spine.x).toBeCloseTo(g.back.x + g.back.width, 6)
    expect(g.front.x).toBeCloseTo(g.spine.x + g.spine.width, 6)
    expect(g.front.x + g.front.width).toBeCloseTo(g.fullWidthIn - BLEED_IN, 6)
  })

  it('keeps every panel the trim height, inset by the bleed', () => {
    for (const panel of [g.back, g.spine, g.front]) {
      expect(panel.y).toBeCloseTo(BLEED_IN, 6)
      expect(panel.height).toBeCloseTo(9, 6)
    }
  })

  it('puts the safe areas a quarter inch inside their panels', () => {
    expect(contains(g.front, g.frontSafe)).toBe(true)
    expect(g.frontSafe.x - g.front.x).toBeCloseTo(0.25, 6)
    expect(g.frontSafe.width).toBeCloseTo(6 - 0.5, 6)
  })

  it('puts the barcode inside the back cover, clear of the trim', () => {
    expect(contains(g.back, g.barcode)).toBe(true)
    expect(g.barcode.width).toBe(BARCODE_W_IN)
    expect(g.barcode.height).toBe(BARCODE_H_IN)
    // Bottom corner against the spine: turn a book over and the spine is on
    // your right, and the flat sheet is not mirrored.
    expect(g.barcode.x + g.barcode.width).toBeCloseTo(g.back.x + g.back.width - 0.25, 6)
    expect(g.barcode.y + g.barcode.height).toBeCloseTo(g.back.y + g.back.height - 0.25, 6)
    expect(overlaps(g.barcode, g.spine)).toBe(false)
  })
})

describe('spine text eligibility', () => {
  it('is withdrawn below KDP’s floor', () => {
    const thin = coverGeometry({
      trimSize: '5x8',
      pageCount: MIN_PAGES_FOR_SPINE_TEXT - 1,
      paper: 'bw-white'
    })
    expect(thin.spineTextAllowed).toBe(false)
    expect(thin.spineSafe).toBeNull()
  })

  it('is allowed at the floor, with clearance from both folds', () => {
    const g = coverGeometry({
      trimSize: '5x8',
      pageCount: MIN_PAGES_FOR_SPINE_TEXT,
      paper: 'bw-cream'
    })
    expect(g.spineTextAllowed).toBe(true)
    expect(g.spineSafe).not.toBeNull()
    expect(g.spineSafe!.width).toBeLessThan(g.spine.width)
    expect(contains(g.spine, g.spineSafe!)).toBe(true)
  })
})
