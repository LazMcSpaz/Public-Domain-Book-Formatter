/**
 * Banking a cover look — the collection.
 *
 * The load-bearing test is `BANKED_COVER_KEYS`: adding a field to `CoverLook`
 * fails the suite until someone has decided whether it belongs to the look or
 * to the book. The accident it prevents is a title riding a banked look onto
 * volume two.
 */
import { describe, expect, it } from 'vitest'
import {
  applyCoverLook,
  BANKED_COVER_KEYS,
  defaultLook,
  describeSavedCoverLook,
  migrateSavedCoverLook,
  newSavedCoverLook,
  normalizeLook,
  type CoverLook
} from '@core/cover'

describe('what may be banked', () => {
  it('names every field of a look, and only fields of a look', () => {
    const keys = Object.keys(defaultLook()).sort()
    expect([...BANKED_COVER_KEYS].sort()).toEqual(keys)
  })

  it('carries nothing about any particular book', () => {
    // The rule, stated as a test: if one of these ever became `title`, `blurb`
    // or `pageCount`, applying a collection's look would rewrite the book.
    const forbidden = ['title', 'subtitle', 'author', 'series', 'blurb', 'pageCount', 'isbn']
    for (const key of BANKED_COVER_KEYS) {
      expect(forbidden).not.toContain(key)
    }
  })
})

describe('newSavedCoverLook', () => {
  it('normalizes what it stores, so a hand-tweaked look and an interviewed one match', () => {
    const partial = { arrangement: 'banded', titleFont: 'Cardo' } as unknown as CoverLook
    const saved = newSavedCoverLook({ name: '  Blackthorn plain  ', look: partial })
    expect(saved.name).toBe('Blackthorn plain')
    expect(saved.look).toEqual(normalizeLook(partial))
    expect(saved.look.palette.ground).toBe(defaultLook().palette.ground)
  })

  it('names an unnamed look rather than storing an empty one', () => {
    expect(newSavedCoverLook({ name: '   ', look: defaultLook() }).name).toBe('Untitled cover look')
  })
})

describe('migrateSavedCoverLook', () => {
  it('backfills a record from an older shape rather than refusing it', () => {
    const restored = migrateSavedCoverLook({
      id: 'cl-1',
      name: 'Old look',
      look: { arrangement: 'plate-window' }
    })
    expect(restored).not.toBeNull()
    expect(restored!.look.arrangement).toBe('plate-window')
    expect(restored!.look.rule).toBe(defaultLook().rule)
  })

  it('refuses something that is not a look at all', () => {
    expect(migrateSavedCoverLook(null)).toBeNull()
    expect(migrateSavedCoverLook({ name: 'no id' })).toBeNull()
  })

  it('drops a value that is no longer an option instead of carrying it through', () => {
    const restored = migrateSavedCoverLook({
      id: 'cl-2',
      look: { arrangement: 'holographic-foil', palette: { ground: 'chartreuse' } }
    })
    expect(restored!.look.arrangement).toBe(defaultLook().arrangement)
    expect(restored!.look.palette.ground).toBe(defaultLook().palette.ground)
  })
})

describe('applyCoverLook', () => {
  it('takes a look and returns a look — nothing about a book can travel through it', () => {
    const banked = newSavedCoverLook({
      name: 'Set',
      look: { ...defaultLook(), arrangement: 'banded' }
    })
    const applied = applyCoverLook(banked)
    expect(applied.arrangement).toBe('banded')
    expect(Object.keys(applied).sort()).toEqual([...BANKED_COVER_KEYS].sort())
  })
})

describe('describeSavedCoverLook', () => {
  it('says enough to tell two looks apart a year later', () => {
    const saved = newSavedCoverLook({
      name: 'Set',
      look: defaultLook(),
      note: 'the ones with plates'
    })
    expect(describeSavedCoverLook(saved)).toContain('the ones with plates')
    expect(describeSavedCoverLook(saved)).toContain(defaultLook().titleFont)
  })
})
