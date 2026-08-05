import { describe, it, expect } from 'vitest'
import { CURRENT_SCHEMA_VERSION, createEmptyProject, migrate } from '@core/project'

/**
 * The project schema and its migrations are pure logic. Storage is platform
 * work (browser: OPFS/IndexedDB) and is tested there, not here.
 */

describe('createEmptyProject', () => {
  it('stamps the current schema version and sane defaults', () => {
    const p = createEmptyProject({ pdfPath: '/in/book.pdf', pageCount: 12 })
    expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(p.source.pdfPath).toBe('/in/book.pdf')
    expect(p.source.pageCount).toBe(12)
    expect(p.pages).toEqual([])
    expect(p.markdown).toBe('')
    expect(p.coordinateMap).toEqual([])
    expect(p.flags).toEqual([])
    expect(p.resolvedTokenIds).toEqual([])
    expect(p.config.trimSize).toBe('6x9')
  })

  it('accepts per-book config overrides', () => {
    const p = createEmptyProject({
      pdfPath: '/x.pdf',
      pageCount: 1,
      config: { title: 'A Title', author: 'An Author' }
    })
    expect(p.config.title).toBe('A Title')
    expect(p.config.author).toBe('An Author')
  })
})

describe('migrate', () => {
  it('fills missing fields with defaults', () => {
    const result = migrate({ schemaVersion: 1, source: { pdfPath: '/m.pdf', pageCount: 5 } })
    expect(result.pages).toEqual([])
    expect(result.coordinateMap).toEqual([])
    expect(result.flags).toEqual([])
    expect(result.config.trimSize).toBe('6x9')
    expect(result.readingProgress).toEqual({ lastPageIndex: 0, approvedPages: [] })
  })

  it('backfills resolvedTokenIds for pre-v4 manifests and keeps valid ones', () => {
    const old = migrate({ schemaVersion: 3, source: { pdfPath: '/o.pdf', pageCount: 1 } })
    expect(old.resolvedTokenIds).toEqual([])

    const v4 = migrate({
      schemaVersion: 4,
      source: { pdfPath: '/n.pdf', pageCount: 1 },
      resolvedTokenIds: ['p0_w1', 7, 'p0_w2']
    })
    expect(v4.resolvedTokenIds).toEqual(['p0_w1', 'p0_w2'])
  })

  it('upgrades a manifest with an absent schemaVersion to current', () => {
    const result = migrate({
      source: { pdfPath: '/old.pdf', pageCount: 2 },
      config: { title: 'Old Book' }
    })
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(result.config.title).toBe('Old Book')
  })

  it('normalizes partial config and readingProgress', () => {
    const result = migrate({
      source: { pdfPath: '/p.pdf' },
      readingProgress: { lastPageIndex: 7, approvedPages: [1, 'bad', 3] }
    })
    expect(result.source.pageCount).toBe(0)
    expect(result.readingProgress.lastPageIndex).toBe(7)
    expect(result.readingProgress.approvedPages).toEqual([1, 3])
  })

  it('rejects manifests that are not plausible projects', () => {
    expect(() => migrate(null)).toThrow()
    expect(() => migrate({ nope: true })).toThrow()
  })

  it('refuses a manifest newer than this build understands', () => {
    expect(() =>
      migrate({ schemaVersion: CURRENT_SCHEMA_VERSION + 1, source: { pdfPath: '/f.pdf' } })
    ).toThrow(/newer than supported/i)
  })
})
