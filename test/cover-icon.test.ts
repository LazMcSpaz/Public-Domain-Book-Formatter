/**
 * The front-cover icon's arithmetic.
 *
 * Small on purpose, and worth having anyway: every one of these is a mistake
 * that would produce a picture rather than an error, and a picture is what
 * nobody looks at twice. A crop taken at the bleed rather than the trim shows a
 * band the printer throws away; a height computed from the request rather than
 * from the panel stretches the book; a scale computed from the *asked-for*
 * width after the width was clamped cuts the crop short of the edge.
 */
import { describe, expect, it } from 'vitest'
import {
  BLEED_IN,
  coverGeometry,
  DEFAULT_ICON_WIDTH_PX,
  frontIconPlan,
  MAX_ICON_WIDTH_PX,
  MIN_ICON_WIDTH_PX,
  PT_PER_INCH
} from '@core/cover'

const geometry = coverGeometry({ trimSize: '6x9', pageCount: 330, paper: 'bw-cream' })

describe('frontIconPlan', () => {
  it('cuts at the trim, past the back cover and the spine', () => {
    const plan = frontIconPlan(geometry, 600)
    // The front panel starts after bleed + back + spine, and its top edge is
    // the bleed: the eighth of an inch above the trim is not in the picture.
    expect(plan.xPt).toBeCloseTo((BLEED_IN + 6 + geometry.spineIn) * PT_PER_INCH, 6)
    expect(plan.yPt).toBeCloseTo(BLEED_IN * PT_PER_INCH, 6)
  })

  it('takes its proportions from the panel, not from the request', () => {
    const plan = frontIconPlan(geometry, 600)
    expect(plan.widthPx).toBe(600)
    expect(plan.heightPx).toBe(900)
    expect(plan.heightPx / plan.widthPx).toBeCloseTo(9 / 6, 6)
  })

  it('derives the scale from the width it will actually render', () => {
    const plan = frontIconPlan(geometry, MAX_ICON_WIDTH_PX * 4)
    expect(plan.widthPx).toBe(MAX_ICON_WIDTH_PX)
    // The crop is 6 inches wide, so the scale must carry the clamped width
    // across exactly that much of the sheet.
    expect(plan.scale * 6 * PT_PER_INCH).toBeCloseTo(plan.widthPx, 6)
  })

  it('clamps at both ends and survives a number that is not one', () => {
    expect(frontIconPlan(geometry, 1).widthPx).toBe(MIN_ICON_WIDTH_PX)
    expect(frontIconPlan(geometry, Number.NaN).widthPx).toBe(DEFAULT_ICON_WIDTH_PX)
  })

  it('reports the DPI across the printed front rather than rounding it up', () => {
    // 1000 pixels across a 6-inch front is 167 to the inch: fine for a shelf
    // card, half of print standard, and the point of saying so.
    expect(frontIconPlan(geometry, 1000).dpi).toBeCloseTo(1000 / 6, 6)
    expect(frontIconPlan(geometry, 1800).dpi).toBeCloseTo(300, 6)
  })

  it('does not care how thick the book is', () => {
    const thin = coverGeometry({ trimSize: '6x9', pageCount: 100, paper: 'bw-cream' })
    const thick = coverGeometry({ trimSize: '6x9', pageCount: 800, paper: 'bw-cream' })
    const a = frontIconPlan(thin, 600)
    const b = frontIconPlan(thick, 600)
    expect(a.widthPx).toBe(b.widthPx)
    expect(a.heightPx).toBe(b.heightPx)
    // The spine grows, so the panel moves right. Only the offset changes.
    expect(b.xPt).toBeGreaterThan(a.xPt)
  })
})
