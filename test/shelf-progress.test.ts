import { describe, expect, it } from 'vitest'
import { parseAbout, shelfProgress, type ShelfAbout } from '@core/sync'

const card = (over: Partial<ShelfAbout>): ShelfAbout => ({
  key: 'k',
  fileName: 'book.pdf',
  savedAt: '2026-09-24T00:00:00.000Z',
  pageCount: 100,
  notes: 0,
  corrections: 0,
  marked: 0,
  facts: 0,
  complete: false,
  read: 0,
  queries: null,
  scanPath: null,
  ...over
})

describe('shelfProgress', () => {
  it('a book nobody has read is not started', () => {
    const p = shelfProgress(card({}))
    expect(p.stage).toBe('unread')
    expect(p.fraction).toBe(0)
  })

  it('reading fills the first seven tenths, and says how far', () => {
    const p = shelfProgress(card({ read: 50 }))
    expect(p.stage).toBe('reading')
    expect(p.fraction).toBeCloseTo(0.35)
    expect(p.summary).toBe('Read to leaf 50 of 100.')
    // Every leaf read but the run not marked complete is still "read".
    expect(shelfProgress(card({ read: 100 })).stage).not.toBe('reading')
  })

  it('`complete` outranks a count from before the field existed', () => {
    // A card written before `read` was counted carries 0 and `complete`.
    const p = shelfProgress(card({ complete: true, read: 0, queries: null }))
    expect(p.stage).toBe('deciding')
    expect(p.fraction).toBeCloseTo(0.7)
  })

  it('a card that has not counted its queries never turns green', () => {
    const p = shelfProgress(card({ complete: true, queries: null }))
    expect(p.stage).toBe('deciding')
    expect(p.fraction).toBeLessThan(1)
    expect(p.summary).toMatch(/not counted/u)
  })

  it('decisions fill the last three tenths, held ones named apart', () => {
    const p = shelfProgress(
      card({ complete: true, queries: { raised: 200, waiting: 50, held: 20 } })
    )
    expect(p.stage).toBe('deciding')
    expect(p.fraction).toBeCloseTo(0.7 + 0.3 * 0.75)
    expect(p.summary).toBe('Read; 50 of 200 queries waiting, 20 of them held for approval.')
    const none = shelfProgress(
      card({ complete: true, queries: { raised: 200, waiting: 50, held: 0 } })
    )
    expect(none.summary).toBe('Read; 50 of 200 queries waiting.')
  })

  it('done is read with nothing waiting, whether or not anything was raised', () => {
    const ruled = shelfProgress(
      card({ complete: true, queries: { raised: 9, waiting: 0, held: 0 } })
    )
    expect(ruled.stage).toBe('done')
    expect(ruled.fraction).toBe(1)
    const clean = shelfProgress(
      card({ complete: true, queries: { raised: 0, waiting: 0, held: 0 } })
    )
    expect(clean.stage).toBe('done')
    expect(clean.fraction).toBe(1)
  })

  it('never reports more than the whole or less than none', () => {
    expect(shelfProgress(card({ read: 500 })).fraction).toBeLessThanOrEqual(1)
    expect(shelfProgress(card({ read: -3 })).fraction).toBe(0)
    expect(shelfProgress(card({ pageCount: 0 })).stage).toBe('unread')
  })
})

describe('parseAbout, for the new fields', () => {
  it('a card written before the fields existed still lists, and does not claim to know', () => {
    const about = parseAbout(
      JSON.stringify({ key: 'k', fileName: 'b.pdf', pageCount: 10, complete: true })
    )
    expect(about).not.toBeNull()
    expect(about!.read).toBe(0)
    expect(about!.queries).toBeNull()
  })

  it('reads the counts back', () => {
    const about = parseAbout(
      JSON.stringify({
        key: 'k',
        pageCount: 10,
        read: 4,
        queries: { raised: 3, waiting: 2, held: 1 }
      })
    )
    expect(about!.read).toBe(4)
    expect(about!.queries).toEqual({ raised: 3, waiting: 2, held: 1 })
  })
})
