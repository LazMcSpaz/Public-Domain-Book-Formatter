import { describe, it, expect } from 'vitest'
import {
  resolveSelectionRange,
  type SelectionEndpoint
} from '../src/renderer/hooks/useSelectionRange'

function ep(dataStart: number, dataEnd: number, offsetWithinElement: number): SelectionEndpoint {
  return { dataStart, dataEnd, offsetWithinElement }
}

describe('resolveSelectionRange (pure offset math)', () => {
  it('returns null when either endpoint is missing', () => {
    expect(resolveSelectionRange(null, ep(0, 5, 0))).toBeNull()
    expect(resolveSelectionRange(ep(0, 5, 0), null)).toBeNull()
    expect(resolveSelectionRange(null, null)).toBeNull()
  })

  it('builds a half-open range from anchor before focus', () => {
    // anchor at word [0,5) offset 2 -> 2; focus at word [10,15) offset 3 -> 13
    expect(resolveSelectionRange(ep(0, 5, 2), ep(10, 15, 3))).toEqual({ start: 2, end: 13 })
  })

  it('normalizes a backwards selection (focus before anchor)', () => {
    expect(resolveSelectionRange(ep(10, 15, 3), ep(0, 5, 2))).toEqual({ start: 2, end: 13 })
  })

  it('clamps the within-element offset to [dataStart, dataEnd]', () => {
    // offset 99 within a 5-char word clamps to dataEnd (5)
    expect(resolveSelectionRange(ep(0, 5, 99), ep(10, 15, 1))).toEqual({ start: 5, end: 11 })
    // a negative-ish underflow can't happen via offsets, but dataStart floor holds
    expect(resolveSelectionRange(ep(20, 25, 0), ep(40, 45, 4))).toEqual({ start: 20, end: 44 })
  })

  it('returns null for a collapsed selection (start === end)', () => {
    expect(resolveSelectionRange(ep(0, 5, 3), ep(0, 5, 3))).toBeNull()
  })

  it('returns null when the resolved range is empty after clamping', () => {
    // both endpoints clamp to the same boundary
    expect(resolveSelectionRange(ep(0, 5, 5), ep(0, 5, 9))).toBeNull()
  })

  it('uses absolute markdown offsets across distant words', () => {
    expect(resolveSelectionRange(ep(100, 110, 4), ep(500, 512, 6))).toEqual({
      start: 104,
      end: 506
    })
  })
})
