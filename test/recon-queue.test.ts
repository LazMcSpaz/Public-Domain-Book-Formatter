import { describe, expect, it } from 'vitest'
import {
  booksNeedingRecon,
  newReconQueue,
  parseReconQueue,
  pickedByDefault,
  queueFailed,
  queueFinished,
  queueMove,
  queueRemaining,
  queueRemove,
  type ShelfAbout
} from '../src/core/sync'

function card(key: string, over: Partial<ShelfAbout> = {}): ShelfAbout {
  return {
    key,
    fileName: `${key}.pdf`,
    savedAt: '2026-09-20T12:00:00.000Z',
    pageCount: 100,
    notes: 0,
    corrections: 0,
    marked: 0,
    facts: 0,
    complete: false,
    read: 0,
    queries: null,
    scanPath: `scans/${key}.pdf`,
    ...over
  }
}

describe('booksNeedingRecon', () => {
  it('owes a reading to a book with a scan, unfinished, with none on the shelf', () => {
    const books = [
      card('a'),
      card('b', { scanPath: null }),
      card('c', { complete: true }),
      card('d'),
      card('e', { scanPath: 'scans/e.epub' })
    ]
    expect(booksNeedingRecon(books, new Set(['d'])).map((b) => b.key)).toEqual(['a'])
  })
})

describe('the queue', () => {
  it('walks its books in order, past a failure, and forgets none', () => {
    let q = newReconQueue(['a', 'b', 'c', 'a'])
    expect(q.keys).toEqual(['a', 'b', 'c'])
    q = queueFinished(q, 'a')
    q = queueFailed(q, 'b', 'the scan would not open')
    expect(queueRemaining(q)).toEqual(['c'])
    q = queueFinished(q, 'c')
    expect(queueRemaining(q)).toEqual([])
    expect(q.failed).toEqual([{ key: 'b', reason: 'the scan would not open' }])
  })

  it('survives being written down and read back', () => {
    const q = queueFinished(newReconQueue(['a', 'b'], new Date('2026-09-27T00:00:00Z')), 'a')
    expect(parseReconQueue(JSON.parse(JSON.stringify(q)))).toEqual(q)
    expect(parseReconQueue({ keys: 'a' })).toBeNull()
    expect(parseReconQueue(null)).toBeNull()
  })
})

describe('controlling the queue', () => {
  it('ticks a new book and leaves a mostly transcribed one to the editor', () => {
    expect(pickedByDefault(card('new', { pageCount: 248, read: 1 }))).toBe(true)
    expect(pickedByDefault(card('nearly', { pageCount: 102, read: 94 }))).toBe(false)
    expect(pickedByDefault(card('empty', { pageCount: 0, read: 0 }))).toBe(true)
  })

  it('takes a waiting book out, and leaves a settled one in the record', () => {
    let q = queueFinished(newReconQueue(['a', 'b', 'c']), 'a')
    q = queueRemove(q, 'b')
    expect(queueRemaining(q)).toEqual(['c'])
    expect(queueRemove(q, 'a')).toBe(q)
  })

  it('reorders among the books still to read, past a settled one', () => {
    let q = queueFinished(newReconQueue(['a', 'b', 'c', 'd']), 'b')
    q = queueMove(q, 'c', -1)
    expect(queueRemaining(q)).toEqual(['c', 'a', 'd'])
    q = queueMove(q, 'd', 1)
    expect(queueRemaining(q)).toEqual(['c', 'a', 'd'])
    q = queueMove(q, 'c', 1)
    expect(queueRemaining(q)).toEqual(['a', 'c', 'd'])
    expect(q.done).toEqual(['b'])
  })
})
