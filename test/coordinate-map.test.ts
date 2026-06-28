import { describe, it, expect } from 'vitest'
import { createCoordinateMap, CoordinateMap } from '@core/model'
import type { MappingEntry } from '@core/model'

function entry(
  tokenId: string,
  pageIndex: number,
  bbox: { x0: number; y0: number; x1: number; y1: number },
  start: number,
  end: number
): MappingEntry {
  return { tokenId, pageIndex, bbox, output: { start, end } }
}

// A small hand-made map. Output ranges are contiguous except a deliberate gap
// [15,20). One nested bbox (B inside A) on page 0 to test smallest-area wins.
const entries: MappingEntry[] = [
  entry('A', 0, { x0: 0, y0: 0, x1: 100, y1: 100 }, 0, 5),
  entry('B', 0, { x0: 10, y0: 10, x1: 30, y1: 30 }, 5, 10),
  entry('C', 0, { x0: 200, y0: 0, x1: 260, y1: 40 }, 10, 15),
  entry('D', 1, { x0: 0, y0: 0, x1: 50, y1: 50 }, 20, 25)
]

describe('CoordinateMap.atOutputOffset (binary search)', () => {
  const map = createCoordinateMap(entries)

  it('treats start as inclusive and end as exclusive', () => {
    expect(map.atOutputOffset(0)!.tokenId).toBe('A')
    expect(map.atOutputOffset(4)!.tokenId).toBe('A')
    // offset 5 belongs to B (A.end is exclusive)
    expect(map.atOutputOffset(5)!.tokenId).toBe('B')
    expect(map.atOutputOffset(9)!.tokenId).toBe('B')
    expect(map.atOutputOffset(10)!.tokenId).toBe('C')
    expect(map.atOutputOffset(14)!.tokenId).toBe('C')
  })

  it('returns null in gaps and out of bounds', () => {
    expect(map.atOutputOffset(15)).toBeNull() // gap [15,20)
    expect(map.atOutputOffset(19)).toBeNull()
    expect(map.atOutputOffset(-1)).toBeNull()
    expect(map.atOutputOffset(1000)).toBeNull()
  })

  it('finds the last entry after the gap', () => {
    expect(map.atOutputOffset(20)!.tokenId).toBe('D')
    expect(map.atOutputOffset(24)!.tokenId).toBe('D')
    expect(map.atOutputOffset(25)).toBeNull()
  })
})

describe('CoordinateMap.atPoint', () => {
  const map = createCoordinateMap(entries)

  it('hits the token under a point', () => {
    expect(map.atPoint(0, 220, 20)!.tokenId).toBe('C')
    expect(map.atPoint(1, 25, 25)!.tokenId).toBe('D')
  })

  it('returns null when no bbox contains the point', () => {
    expect(map.atPoint(0, 500, 500)).toBeNull()
  })

  it('returns null when page index does not match', () => {
    // (25,25) is inside A and B on page 0 (B smaller -> wins); page 5 has none.
    expect(map.atPoint(0, 25, 25)!.tokenId).toBe('B')
    expect(map.atPoint(5, 25, 25)).toBeNull()
  })

  it('returns the smallest-area containing entry for nested boxes', () => {
    // (20,20) is inside both A (100x100) and B (20x20); B is smaller.
    expect(map.atPoint(0, 20, 20)!.tokenId).toBe('B')
    // (5,5) is inside A only.
    expect(map.atPoint(0, 5, 5)!.tokenId).toBe('A')
  })

  it('treats bbox edges as inclusive', () => {
    expect(map.atPoint(0, 0, 0)!.tokenId).toBe('A')
    expect(map.atPoint(0, 100, 100)!.tokenId).toBe('A')
  })
})

describe('CoordinateMap.inOutputRange', () => {
  const map = createCoordinateMap(entries)

  it('returns all overlapping entries in output order', () => {
    const hits = map.inOutputRange({ start: 3, end: 12 })
    expect(hits.map((e) => e.tokenId)).toEqual(['A', 'B', 'C'])
  })

  it('uses half-open overlap semantics', () => {
    // range [5,5) is empty -> no overlap
    expect(map.inOutputRange({ start: 5, end: 5 })).toEqual([])
    // range [4,5) overlaps A only (A is [0,5))
    expect(map.inOutputRange({ start: 4, end: 5 }).map((e) => e.tokenId)).toEqual(['A'])
    // range [5,6) overlaps B only
    expect(map.inOutputRange({ start: 5, end: 6 }).map((e) => e.tokenId)).toEqual(['B'])
  })

  it('returns empty when the range lands in a gap', () => {
    expect(map.inOutputRange({ start: 16, end: 19 })).toEqual([])
  })
})

describe('CoordinateMap byTokenId & toJSON', () => {
  const map = createCoordinateMap(entries)

  it('looks up by token id', () => {
    expect(map.byTokenId('C')!.output).toEqual({ start: 10, end: 15 })
    expect(map.byTokenId('missing')).toBeNull()
  })

  it('round-trips through toJSON', () => {
    const json = map.toJSON()
    expect(json).toHaveLength(entries.length)
    const rebuilt = createCoordinateMap(json)
    expect(rebuilt.atOutputOffset(5)!.tokenId).toBe('B')
    expect(rebuilt.byTokenId('D')!.tokenId).toBe('D')
  })

  it('exposes entries sorted by output.start', () => {
    const starts = map.entries.map((e) => e.output.start)
    const sorted = [...starts].sort((a, b) => a - b)
    expect(starts).toEqual(sorted)
  })
})

describe('CoordinateMap empty input', () => {
  const map = createCoordinateMap([])

  it('handles all queries gracefully', () => {
    expect(map.entries).toHaveLength(0)
    expect(map.atOutputOffset(0)).toBeNull()
    expect(map.atPoint(0, 0, 0)).toBeNull()
    expect(map.inOutputRange({ start: 0, end: 10 })).toEqual([])
    expect(map.byTokenId('x')).toBeNull()
    expect(map.toJSON()).toEqual([])
  })

  it('is constructible directly via the class', () => {
    expect(new CoordinateMap([])).toBeInstanceOf(CoordinateMap)
  })
})
