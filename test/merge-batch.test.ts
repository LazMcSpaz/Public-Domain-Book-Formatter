import { describe, it, expect } from 'vitest'
import {
  mergeBatchIntoRun,
  CARRIED_FIELDS,
  DECIDED_FIELDS,
  createSavedRun,
  type SavedRun
} from '@core/project'
import type { PageTranscription } from '@core/transcribe'

const leaf = (pageIndex: number, text = 'a leaf'): PageTranscription => ({
  pageIndex,
  role: 'body',
  blocks: [{ kind: 'paragraph', text }],
  uncertain: [],
  furniture: {}
})

const run = (over: Partial<Parameters<typeof createSavedRun>[0]> = {}): SavedRun =>
  createSavedRun({
    key: 'book.pdf 100 1',
    fileName: 'book.pdf',
    pageCount: 300,
    transcriptions: [leaf(0), leaf(1)],
    failures: [],
    usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 30 },
    modelId: 'claude-something',
    identityAnswers: { title: 'A Book' },
    ...over
  })

const merge = (over: Partial<Parameters<typeof mergeBatchIntoRun>[0]> = {}) =>
  mergeBatchIntoRun({
    held: null,
    parsed: [leaf(0)],
    key: 'book.pdf 100 1',
    fileName: 'book.pdf',
    pageCount: 0,
    replace: false,
    ...over
  })

/**
 * The test that makes a forgotten field impossible.
 *
 * `images` was dropped on every batch because nobody passed it, and nothing
 * failed. Convention did not catch it and a comment would not have either.
 */
describe('nothing on the held run can be forgotten', () => {
  it('accounts for every field a SavedRun has', () => {
    const fields = Object.keys(run()).sort()
    const accounted = [...CARRIED_FIELDS, ...DECIDED_FIELDS].sort()
    expect(fields).toEqual(accounted)
  })

  it('carries the supplied pictures across a merge', () => {
    const held = run({ images: new Map([['plate-1', new Uint8Array([1, 2, 3])]]) })
    const { init } = merge({ held, parsed: [leaf(5)], pageCount: 300 })
    expect(init.images.get('plate-1')).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('carries an evening of proofreading', () => {
    const held = run({ edits: [{ kind: 'text', blockId: 'p0b0', text: 'corrected' }] })
    const { init } = merge({ held, parsed: [leaf(5)], pageCount: 300 })
    expect(init.edits).toHaveLength(1)
  })

  it('never erases spend that really happened', () => {
    const { init } = merge({ held: run(), parsed: [leaf(5)], pageCount: 300 })
    expect(init.usage.inputTokens).toBe(900)
    expect(init.modelId).toBe('claude-something')
  })

  it('reports no spend and an in-session reading when there was no run before', () => {
    const { init } = merge()
    expect(init.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })
    expect(init.modelId).toBe('in-session')
  })
})

/**
 * `complete` was `transcriptions.length >= pageCount` — a count, not a
 * coverage test — so nine entries landed at indices 5-13 reported a nine-leaf
 * book finished with leaves 0-4 never read.
 */
describe('a book is finished only when every leaf has been read', () => {
  it('is not complete while a leaf is missing, however many entries there are', () => {
    const { report, init } = merge({
      parsed: [leaf(5), leaf(6), leaf(7), leaf(8)],
      pageCount: 9
    })
    expect(report.complete).toBe(false)
    expect(init.complete).toBe(false)
    expect(report.stillMissing).toBe(5)
  })

  it('never reports complete beside a missing leaf', () => {
    const { report } = merge({ parsed: [leaf(0), leaf(2)], pageCount: 3 })
    expect(report.complete).toBe(false)
    expect(report.firstMissing).toEqual([1])
  })

  it('is complete when every leaf is there', () => {
    const { report } = merge({ parsed: [leaf(0), leaf(1), leaf(2)], pageCount: 3 })
    expect(report.complete).toBe(true)
    expect(report.stillMissing).toBe(0)
  })
})

/**
 * The floor bug, which survived being "fixed" because the guess was stored and
 * read back next time as a known number.
 */
describe('a guessed leaf count is never stored', () => {
  it('stores 0 - nobody knows - rather than a floor', () => {
    const { init, report } = merge({ parsed: [leaf(0), leaf(7)], pageCount: 0 })
    expect(init.pageCount).toBe(0)
    expect(report.pageCount).toBeNull()
    expect(report.highestLeaf).toBe(8)
  })

  it('cannot report a book complete when nobody knows how long it is', () => {
    const { report, init } = merge({ parsed: [leaf(0)], pageCount: 0 })
    expect(report.complete).toBe(false)
    expect(init.complete).toBe(false)
  })

  it('says nothing about what is missing rather than saying nothing is', () => {
    // `stillMissing: 0` beside an unknown length reads as "nothing left to do".
    expect(merge({ parsed: [leaf(0)], pageCount: 0 }).report.stillMissing).toBeNull()
  })

  it('does not inherit a stored guess, because none was ever stored', () => {
    const first = merge({ parsed: [leaf(0)], pageCount: 0 })
    const held = run({ ...first.init, transcriptions: first.init.transcriptions })
    const second = mergeBatchIntoRun({
      held,
      parsed: [leaf(5)],
      key: held.key,
      fileName: held.fileName,
      pageCount: 0,
      replace: false
    })
    expect(second.report.complete).toBe(false)
    expect(second.report.pageCount).toBeNull()
  })
})

describe('a batch that cannot mean one thing is refused', () => {
  it('refuses the same leaf twice', () => {
    expect(() => merge({ parsed: [leaf(3, 'one way'), leaf(3, 'another')] })).toThrow(
      /more than once/
    )
  })

  it('refuses a leaf past the end of the book', () => {
    expect(() => merge({ parsed: [leaf(9)], pageCount: 9 })).toThrow(/one place too high/)
  })

  it('allows any leaf when the length is unknown', () => {
    expect(() => merge({ parsed: [leaf(900)], pageCount: 0 })).not.toThrow()
  })
})

describe('merging and replacing', () => {
  it('leaves the other leaves alone', () => {
    const { report } = merge({ held: run(), parsed: [leaf(200)], pageCount: 300 })
    expect(report.transcribed).toBe(3)
    expect(report.landed).toBe(1)
  })

  it('overwrites a leaf read twice across batches, without counting it twice', () => {
    const { report } = merge({ held: run(), parsed: [leaf(1, 'better')], pageCount: 300 })
    expect(report.transcribed).toBe(2)
    expect(report.landed).toBe(1)
  })

  it('says how many leaves replace threw away', () => {
    const { report } = merge({ held: run(), parsed: [leaf(9)], pageCount: 300, replace: true })
    expect(report.discarded).toBe(2)
    expect(report.transcribed).toBe(1)
  })

  it('discards nothing on a merge', () => {
    expect(merge({ held: run(), parsed: [leaf(9)], pageCount: 300 }).report.discarded).toBe(0)
  })
})
