/**
 * Cover art: the pixels a picture has to have.
 *
 * `requiredPixels` is what stops a cover that looks immaculate on a laptop
 * from printing soft.
 */
import { describe, expect, it } from 'vitest'
import { requiredPixels } from '@core/cover'

describe('requiredPixels', () => {
  it('is the placed size times the DPI, rounded up', () => {
    expect(requiredPixels({ width: 6, height: 9 })).toEqual({
      width: 1800,
      height: 2700,
      megapixels: 4.86
    })
  })

  it('rounds up rather than down', () => {
    // 1799 pixels where 1800 are needed is an afternoon spent finding out why
    // a check fails by a hair.
    expect(requiredPixels({ width: 5.999, height: 1 }).width).toBe(1800)
  })
})
