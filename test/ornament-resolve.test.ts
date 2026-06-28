import { describe, it, expect } from 'vitest'
import type { OrnamentChoices, OrnamentRef } from '@core/model'
import { BUILTIN_ORNAMENTS, findOrnament, resolveOrnamentPaths } from '@core/ornament'

describe('builtin ornament manifest', () => {
  it('loads a non-empty library of well-formed OrnamentRefs', () => {
    expect(BUILTIN_ORNAMENTS.length).toBeGreaterThanOrEqual(4)
    for (const o of BUILTIN_ORNAMENTS) {
      expect(typeof o.id).toBe('string')
      expect(typeof o.name).toBe('string')
      expect(o.source).toBe('builtin')
      expect(o.file).toMatch(/\.svg$/)
      expect(['page', 'chapter', 'divider']).toContain(o.kind)
    }
  })

  it('finds by id and returns null for unknown ids', () => {
    const first = BUILTIN_ORNAMENTS[0]!
    expect(findOrnament(first.id, BUILTIN_ORNAMENTS)).toBe(first)
    expect(findOrnament('does-not-exist', BUILTIN_ORNAMENTS)).toBeNull()
  })
})

describe('resolveOrnamentPaths', () => {
  const library: OrnamentRef[] = [
    { id: 'opener', name: 'Opener', kind: 'chapter', source: 'builtin', file: 'opener.svg' },
    { id: 'divider', name: 'Divider', kind: 'divider', source: 'builtin', file: 'div.svg' },
    { id: 'folio', name: 'Folio', kind: 'page', source: 'builtin', file: 'folio.svg' }
  ]

  it('maps chosen ids to .pdf paths under the build dir', () => {
    const choices: OrnamentChoices = {
      chapterOpener: 'opener',
      sectionDivider: 'divider',
      pageNumber: 'folio'
    }
    const resolved = resolveOrnamentPaths(choices, library, '/build/out')
    expect(resolved.chapterOpener).toBe('/build/out/opener.pdf')
    expect(resolved.sectionDivider).toBe('/build/out/div.pdf')
    expect(resolved.pageNumber).toBe('/build/out/folio.pdf')
  })

  it('passes null choices and unknown ids through as null', () => {
    const choices: OrnamentChoices = {
      chapterOpener: null,
      sectionDivider: 'nope',
      pageNumber: 'folio'
    }
    const resolved = resolveOrnamentPaths(choices, library, '/build/out')
    expect(resolved.chapterOpener).toBeNull()
    expect(resolved.sectionDivider).toBeNull()
    expect(resolved.pageNumber).toBe('/build/out/folio.pdf')
  })
})
