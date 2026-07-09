import { describe, it, expect } from 'vitest'
import type { CoordinateIndex, Flag, MappingEntry } from '../src/core/model'
import { flagTokenId } from '../src/renderer/utils/flag-token'

/** Minimal CoordinateIndex stub: atOutputOffset returns a fixed entry. */
function stubMap(entry: MappingEntry | null): CoordinateIndex {
  return {
    entries: entry ? [entry] : [],
    atPoint: () => null,
    atOutputOffset: () => entry,
    inOutputRange: () => (entry ? [entry] : []),
    byTokenId: () => entry,
    toJSON: () => (entry ? [entry] : [])
  }
}

const entry: MappingEntry = {
  tokenId: 'resolved',
  pageIndex: 0,
  bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
  output: { start: 10, end: 20 }
}

describe('flagTokenId', () => {
  it('returns the tokenId of an OCR flag directly', () => {
    const flag: Flag = { kind: 'ocr', tokenId: 'ocr-1', confidence: 42 }
    expect(flagTokenId(flag, null)).toBe('ocr-1')
  })

  it('prefers a heuristic flag’s explicit tokenId over its range', () => {
    const flag: Flag = {
      kind: 'heuristic',
      source: 'cleanup',
      label: 'de-hyphenated',
      tokenId: 'heur-1',
      range: { start: 10, end: 20 }
    }
    // Even with a map present, the explicit tokenId wins (no lookup needed).
    expect(flagTokenId(flag, stubMap(entry))).toBe('heur-1')
  })

  it('resolves a heuristic flag’s range through the coordinate map', () => {
    const flag: Flag = {
      kind: 'heuristic',
      source: 'cleanup',
      label: 'probable heading',
      range: { start: 10, end: 20 }
    }
    expect(flagTokenId(flag, stubMap(entry))).toBe('resolved')
  })

  it('returns null for a range-only heuristic flag when nothing resolves', () => {
    const flag: Flag = {
      kind: 'heuristic',
      source: 'cleanup',
      label: 'orphan',
      range: { start: 10, end: 20 }
    }
    expect(flagTokenId(flag, stubMap(null))).toBeNull()
    expect(flagTokenId(flag, null)).toBeNull()
  })

  it('returns null for a heuristic flag with neither tokenId nor range', () => {
    const flag: Flag = { kind: 'heuristic', source: 'cleanup', label: 'bare' }
    expect(flagTokenId(flag, stubMap(entry))).toBeNull()
  })
})
