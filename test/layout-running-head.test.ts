import { describe, expect, it } from 'vitest'
import { RUNNING_HEAD_RISE, frameFor, runningHeadBaseline } from '@core/layout/frames'
import { PT_PER_INCH } from '@core/layout/types'
import { defaultStyleProfile } from '@core/style/defaults'

describe('running head position', () => {
  it('sits two body sizes above the text block, and never nearer the trim than 0.25in', () => {
    const profile = {
      ...defaultStyleProfile(),
      trimSize: '7x10' as const,
      margins: { top: 0.75, bottom: 0.75, inner: 0.75, outer: 0.5 },
      bodyFontSize: 11
    }
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
})
