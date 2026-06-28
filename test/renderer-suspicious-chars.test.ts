import { describe, expect, it } from 'vitest'
import {
  SUSPICIOUS_PATTERNS,
  isSuspiciousCharFlag,
  scanSuspiciousChars
} from '../src/renderer/utils/suspicious-chars'
import type { Flag, OutputRange } from '../src/core/model/types'

/** Pull the range off a flag we expect to be a ranged heuristic flag. */
function rangeOf(flag: Flag): OutputRange {
  if (flag.kind !== 'heuristic' || !flag.range) {
    throw new Error('expected a heuristic flag with a range')
  }
  return flag.range
}

describe('SUSPICIOUS_PATTERNS', () => {
  it('covers the required categories', () => {
    const ids = SUSPICIOUS_PATTERNS.map((p) => p.id)
    expect(ids).toContain('long-s')
    expect(ids).toContain('ligature')
    expect(ids).toContain('double-hyphen')
    expect(ids).toContain('straight-quote')
  })
})

describe('scanSuspiciousChars', () => {
  it('returns no flags for clean text', () => {
    expect(scanSuspiciousChars('A perfectly ordinary sentence.')).toEqual([])
  })

  it('detects the long-s with the correct offset', () => {
    const md = 'the ſun'
    const flags = scanSuspiciousChars(md)
    expect(flags).toHaveLength(1)
    const f = flags[0]!
    expect(f.kind).toBe('heuristic')
    if (f.kind === 'heuristic') {
      expect(f.source).toBe('cleanup')
      expect(f.range).toEqual({ start: 4, end: 5 })
      expect(md.slice(f.range!.start, f.range!.end)).toBe('ſ')
    }
  })

  it('detects leftover ligature codepoints', () => {
    const md = 'oﬃce ﬁle ﬂag'
    const flags = scanSuspiciousChars(md)
    // ﬃ, ﬁ, ﬂ -> three matches.
    expect(flags).toHaveLength(3)
    const r0 = rangeOf(flags[0]!)
    const r1 = rangeOf(flags[1]!)
    const r2 = rangeOf(flags[2]!)
    expect(md.slice(r0.start, r0.end)).toBe('ﬃ')
    expect(md.slice(r1.start, r1.end)).toBe('ﬁ')
    expect(md.slice(r2.start, r2.end)).toBe('ﬂ')
  })

  it('detects a double-hyphen between word chars', () => {
    const md = 'well--known but - alone and -- spaced'
    const flags = scanSuspiciousChars(md)
    expect(flags).toHaveLength(1)
    const r = rangeOf(flags[0]!)
    expect(r).toEqual({ start: 4, end: 6 })
    expect(md.slice(r.start, r.end)).toBe('--')
  })

  it('flags straight quotes only when curly quotes also appear', () => {
    // No curly quotes -> straight quotes are not flagged (avoids noise).
    expect(scanSuspiciousChars('a "plain" \'string\'')).toEqual([])

    // Mixed: curly present, so the lone straight quote is flagged.
    const md = '“curly” and "straight"'
    const flags = scanSuspiciousChars(md)
    const labels = flags.map((f) => (f.kind === 'heuristic' ? f.label : ''))
    expect(labels.some((l) => l.includes('straight quote'))).toBe(true)
    // Both straight double quotes detected.
    expect(flags).toHaveLength(2)
  })

  it('tags produced flags so they can be identified/de-duped', () => {
    const flags = scanSuspiciousChars('the ſun')
    expect(flags.every(isSuspiciousCharFlag)).toBe(true)
  })

  it('is pure: repeated calls yield identical results', () => {
    const md = 'well--known ﬁle ſ'
    expect(scanSuspiciousChars(md)).toEqual(scanSuspiciousChars(md))
  })
})
