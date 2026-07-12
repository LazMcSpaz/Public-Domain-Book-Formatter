import { describe, it, expect } from 'vitest'
import { createEmptyProject } from '@core/project'
import { reviewReducer } from '../src/renderer/store/ReviewContext'
import { DEFAULT_READING_PREFS, type ReviewState } from '../src/renderer/store/types'

function baseState(): ReviewState {
  const project = createEmptyProject({ pdfPath: '/x.pdf', pageCount: 1 })
  return {
    project,
    projectPath: '/proj',
    coordinateMap: null,
    readingPrefs: DEFAULT_READING_PREFS,
    dirtyTokenIds: new Set<string>(),
    activeTagId: null,
    activeImageRegion: null,
    activeView: 'review',
    isDirty: false
  }
}

describe('reviewReducer TOGGLE_FLAG_RESOLVED', () => {
  it('adds a token id, then removes it on the second toggle', () => {
    const s0 = baseState()
    const s1 = reviewReducer(s0, { type: 'TOGGLE_FLAG_RESOLVED', tokenId: 'p0_w3' })
    expect(s1.project!.resolvedTokenIds).toEqual(['p0_w3'])
    expect(s1.isDirty).toBe(true)

    const s2 = reviewReducer(s1, { type: 'TOGGLE_FLAG_RESOLVED', tokenId: 'p0_w3' })
    expect(s2.project!.resolvedTokenIds).toEqual([])
  })

  it('keeps distinct resolved ids and does not mutate the prior state', () => {
    const s0 = baseState()
    const s1 = reviewReducer(s0, { type: 'TOGGLE_FLAG_RESOLVED', tokenId: 'a' })
    const s2 = reviewReducer(s1, { type: 'TOGGLE_FLAG_RESOLVED', tokenId: 'b' })
    expect(s2.project!.resolvedTokenIds).toEqual(['a', 'b'])
    // s1 was not mutated.
    expect(s1.project!.resolvedTokenIds).toEqual(['a'])
  })

  it('is a no-op when no project is loaded', () => {
    const s0 = { ...baseState(), project: null }
    const s1 = reviewReducer(s0, { type: 'TOGGLE_FLAG_RESOLVED', tokenId: 'a' })
    expect(s1.project).toBeNull()
  })
})
