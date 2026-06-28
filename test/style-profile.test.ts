import { describe, it, expect } from 'vitest'
import type { PerBookConfig, StyleProfile } from '@core/model'
import {
  DEFAULT_STYLE_PROFILES,
  defaultStyleProfile,
  resolveStyle,
  normalizeStyleProfile,
  mergeStyle
} from '@core/style'

const config: PerBookConfig = {
  title: 'A Book',
  author: 'An Author',
  isbn: null,
  editionDate: null,
  trimSize: '5x8'
}

describe('defaults', () => {
  it('ships several profiles and a primary default', () => {
    expect(DEFAULT_STYLE_PROFILES.length).toBeGreaterThanOrEqual(3)
    expect(defaultStyleProfile().id).toBe(DEFAULT_STYLE_PROFILES[0]!.id)
  })

  it('returns a mutation-safe copy', () => {
    const a = defaultStyleProfile()
    a.margins.top = 99
    expect(defaultStyleProfile().margins.top).not.toBe(99)
    expect(DEFAULT_STYLE_PROFILES[0]!.margins.top).not.toBe(99)
  })
})

describe('resolveStyle', () => {
  it('uses default profile when null', () => {
    const r = resolveStyle(null, config)
    expect(r.bodyFont).toBe(defaultStyleProfile().bodyFont)
  })

  it('lets per-book trimSize win over the profile', () => {
    const profile = defaultStyleProfile()
    expect(profile.trimSize).toBe('6x9')
    const r = resolveStyle(profile, config)
    expect(r.trimSize).toBe('5x8')
  })

  it('does not mutate the input profile', () => {
    const profile = defaultStyleProfile()
    resolveStyle(profile, config)
    expect(profile.trimSize).toBe('6x9')
  })

  it('keeps profile trim when config trim is blank', () => {
    const r = resolveStyle(defaultStyleProfile(), { ...config, trimSize: '' })
    expect(r.trimSize).toBe('6x9')
  })
})

describe('normalizeStyleProfile', () => {
  it('backfills all fields from defaults on garbage input', () => {
    const p = normalizeStyleProfile(null)
    expect(p.id).toBe(defaultStyleProfile().id)
    expect(p.margins.inner).toBe(defaultStyleProfile().margins.inner)
  })

  it('keeps valid provided fields and backfills missing ones', () => {
    const p = normalizeStyleProfile({
      id: 'mine',
      name: 'Mine',
      bodyFontSize: 12,
      margins: { top: 1 }
    })
    expect(p.id).toBe('mine')
    expect(p.name).toBe('Mine')
    expect(p.bodyFontSize).toBe(12)
    expect(p.margins.top).toBe(1)
    // backfilled
    expect(p.margins.bottom).toBe(defaultStyleProfile().margins.bottom)
    expect(p.bodyFont).toBe(defaultStyleProfile().bodyFont)
  })

  it('rejects invalid enum values and falls back', () => {
    const p = normalizeStyleProfile({
      pageNumber: 'wherever',
      runningHeads: { verso: 'nope', recto: 'author' }
    })
    expect(p.pageNumber).toBe(defaultStyleProfile().pageNumber)
    expect(p.runningHeads.verso).toBe(defaultStyleProfile().runningHeads.verso)
    expect(p.runningHeads.recto).toBe('author')
  })

  it('coerces ornament fields to string|null', () => {
    const p = normalizeStyleProfile({ ornaments: { chapterOpener: 'foo.pdf', pageNumber: 5 } })
    expect(p.ornaments.chapterOpener).toBe('foo.pdf')
    expect(p.ornaments.pageNumber).toBeNull()
    expect(p.ornaments.sectionDivider).toBeNull()
  })
})

describe('mergeStyle', () => {
  it('applies scalar and nested patches without mutating base', () => {
    const base = defaultStyleProfile()
    const patched = mergeStyle(base, {
      bodyFontSize: 13,
      margins: { ...base.margins, top: 2 },
      headingStyle: { ...base.headingStyle, smallCaps: false }
    })
    expect(patched.bodyFontSize).toBe(13)
    expect(patched.margins.top).toBe(2)
    // unspecified nested keys preserved
    expect(patched.margins.bottom).toBe(base.margins.bottom)
    expect(patched.headingStyle.smallCaps).toBe(false)
    expect(patched.headingStyle.centered).toBe(base.headingStyle.centered)
    // base untouched
    expect(base.bodyFontSize).not.toBe(13)
    expect(base.margins.top).not.toBe(2)
  })

  it('returns a fresh object', () => {
    const base = defaultStyleProfile()
    const out: StyleProfile = mergeStyle(base, {})
    expect(out).not.toBe(base)
    expect(out.margins).not.toBe(base.margins)
  })
})
