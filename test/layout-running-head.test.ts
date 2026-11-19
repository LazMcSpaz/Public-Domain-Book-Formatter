import { describe, expect, it } from 'vitest'
import { RUNNING_HEAD_RISE, frameFor, headRiseOf, runningHeadBaseline } from '@core/layout/frames'
import { fixedWidthMeasurer, headRiseRefused, layout } from '@core/layout'
import { PT_PER_INCH } from '@core/layout/types'
import { DEFAULT_STYLE_PROFILES, defaultStyleProfile } from '@core/style/defaults'
import type { StyleProfile } from '@core/model'
import type { BookDocument } from '@core/assemble'

const sevenByTen = (over: Partial<StyleProfile> = {}): StyleProfile => ({
  ...defaultStyleProfile(),
  trimSize: '7x10',
  margins: { top: 0.75, bottom: 0.75, inner: 0.75, outer: 0.5 },
  bodyFontSize: 11,
  ...over
})

describe('running head position', () => {
  it('sits two body sizes above the text block, and never nearer the trim than 0.25in', () => {
    const profile = sevenByTen()
    const baseline = runningHeadBaseline(profile)
    const frame = frameFor(profile, 'recto')
    // Nearly three lines of air between the head and the first line of text,
    // measured from the top of the text block: a head 1.2 sizes up was found
    // crowded, so a regression to it fails here.
    expect(frame.yPt - baseline).toBeCloseTo(11 * RUNNING_HEAD_RISE, 6)
    expect(frame.yPt - baseline).toBeGreaterThanOrEqual(11 * 2)
    // Capitals of a small-capitals head rise about 0.55 of the size above the
    // baseline; that top edge stays clear of KDP's 0.25in no-print band.
    expect(baseline - 0.55 * 11).toBeGreaterThan(0.25 * PT_PER_INCH)
  })

  it('never rises above 12pt from the trim, whatever the margin', () => {
    const profile = {
      ...defaultStyleProfile(),
      margins: { top: 0.2, bottom: 0.75, inner: 0.75, outer: 0.5 },
      bodyFontSize: 12
    }
    expect(runningHeadBaseline(profile)).toBe(12)
  })

  it('stays at the standard two body sizes in every shipped look', () => {
    for (const p of DEFAULT_STYLE_PROFILES) expect(p.runningHeadRise, p.id).toBe(2)
    expect(RUNNING_HEAD_RISE).toBe(2)
  })
})

describe('a look may lower the running head', () => {
  it('at 1.2 its baseline sits 1.2 body sizes over the text block', () => {
    const profile = sevenByTen({ runningHeadRise: 1.2 })
    expect(frameFor(profile, 'recto').yPt - runningHeadBaseline(profile)).toBeCloseTo(13.2, 6)
    // 8.8pt lower than the standard place: 0.8 of the 11pt body size.
    expect(runningHeadBaseline(profile) - runningHeadBaseline(sevenByTen())).toBeCloseTo(8.8, 6)
  })

  it('keeps the 12pt floor', () => {
    const profile = sevenByTen({
      runningHeadRise: 1.2,
      margins: { ...sevenByTen().margins, top: 0.3 }
    })
    expect(runningHeadBaseline(profile)).toBe(12)
  })

  it('never above the standard rise nor below one body size: those fall back to the standard', () => {
    for (const rise of [2.5, 0.5, 0, -1, Number.NaN]) {
      const profile = sevenByTen({ runningHeadRise: rise })
      expect(headRiseOf(profile), String(rise)).toBe(RUNNING_HEAD_RISE)
      expect(runningHeadBaseline(profile)).toBeCloseTo(54 - 22, 6)
    }
    // A profile made before the setting existed has no rise at all.
    const old: Partial<StyleProfile> = { ...sevenByTen() }
    delete old.runningHeadRise
    expect(runningHeadBaseline(old as StyleProfile)).toBeCloseTo(54 - 22, 6)
  })

  it('a rise refused is said; a rise absent is not', () => {
    const doc: BookDocument = {
      blocks: [
        { id: 'p0b0', kind: 'heading', level: 1, text: 'The First Chapter', sourcePages: [0] },
        { id: 'p0b1', kind: 'paragraph', text: 'The keeper walked. '.repeat(400), sourcePages: [0] }
      ],
      footnotes: [],
      chapters: [],
      asides: [],
      illustrations: [],
      sections: [],
      skipped: [],
      synopsesUnmatched: []
    }
    const warnings = (profile: StyleProfile): string[] =>
      layout(doc, profile, fixedWidthMeasurer(0.5), {
        edition: { title: 'A Book', author: 'An Author', editionDate: '2026' }
      }).warnings.map((w) => w.text)
    expect(warnings(sevenByTen({ runningHeadRise: 3 }))).toContain(headRiseRefused(3))
    expect(warnings(sevenByTen({ runningHeadRise: 1.2 }))).toEqual([])
    const old: Partial<StyleProfile> = { ...sevenByTen() }
    delete old.runningHeadRise
    expect(warnings(old as StyleProfile)).toEqual([])
  })
})
