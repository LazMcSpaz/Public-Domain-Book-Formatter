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

  /**
   * The runtime check above reads `Object.keys` of a built run, so an
   * **optional** field added to `SavedRun` and to `migrateSavedRun` — which
   * builds its own object literal — but not to `createSavedRun` would never
   * appear in it, and would be dropped on every batch in silence. That is
   * exactly how `images` was lost.
   *
   * This one is a compile error instead, driven by the type rather than by an
   * instance. It does not run; it either builds or it does not.
   */
  it('accounts for every field the SavedRun *type* has', () => {
    type Accounted = (typeof CARRIED_FIELDS)[number] | (typeof DECIDED_FIELDS)[number]
    type Unaccounted = Exclude<keyof SavedRun, Accounted>
    const everyFieldIsAccountedFor: Unaccounted extends never ? true : Unaccounted = true
    expect(everyFieldIsAccountedFor).toBe(true)
  })

  /**
   * And this one proves the fields are actually *carried*, not merely named.
   *
   * Naming a field in `CARRIED_FIELDS` was enough to satisfy the check above,
   * while `MergeBatchResult['init']` is hand-written — so a field could be
   * listed and never read off `held`, and the suite stayed green. Four of the
   * eight were in that state: replacing `held?.facts ?? []` with `[]` broke
   * nothing. This walks the list itself, so a name added without the carrying
   * fails here.
   */
  it('carries every field it says it carries', () => {
    const held = run({
      failures: [{ pageIndex: 3, message: 'the leaf would not render' }],
      identityAnswers: { title: 'A Book', author: 'Somebody' },
      edits: [{ kind: 'text', blockId: 'p0b0', text: 'corrected' }],
      images: new Map([['plate-1', new Uint8Array([9, 8, 7])]]),
      adjudicated: { 'p1 spot': { verdict: 'as-printed', reading: 'belleves', note: '' } },
      facts: [{ id: 'f1', sourcePage: 4 } as unknown as SavedRun['facts'][number]]
    })
    const { init } = merge({ held, parsed: [leaf(9)], pageCount: 300 })

    // `images` is a Map on the way in and an array on the way out; everything
    // else compares as it stands.
    const flat = (value: unknown): unknown =>
      value instanceof Map
        ? [...value.entries()]
        : Array.isArray(value) && value.every((v) => v && typeof v === 'object' && 'bytes' in v)
          ? (value as { id: string; bytes: Uint8Array }[]).map((i) => [i.id, i.bytes])
          : value

    for (const field of CARRIED_FIELDS) {
      expect(
        flat((init as unknown as Record<string, unknown>)[field]),
        `CARRIED_FIELDS names "${field}" but the merge does not carry it`
      ).toEqual(flat((held as unknown as Record<string, unknown>)[field]))
    }
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
    // The highest *index*, so leaves 0 and 7 mean the book is at least 8 long.
    expect(report.highestLeaf).toBe(7)
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

/**
 * The count the wizard writes into `pageCount` is how many leaves have been
 * *read*. Taking it for the book length reported sixteen leaves of a three
 * hundred leaf book as finished, and refused correctly-numbered batches with a
 * message blaming the caller for counting from 1. `leafCount` means only the
 * one thing, and an old record migrates to 0 rather than to a guess.
 */
describe('a checkpoint read count is never mistaken for the book length', () => {
  const checkpointed = (): SavedRun =>
    run({
      // What `onCheckpoint` writes: sixteen leaves read of a 300-leaf book.
      pageCount: 16,
      leafCount: 300,
      transcriptions: Array.from({ length: 16 }, (_, i) => leaf(i)),
      complete: false
    })

  it('does not refuse a later batch as if the book ended at the checkpoint', () => {
    const held = checkpointed()
    expect(() =>
      merge({ held, parsed: [leaf(20), leaf(21)], pageCount: held.leafCount })
    ).not.toThrow()
  })

  it('does not call a barely-started book finished', () => {
    const held = checkpointed()
    const { report, init } = merge({ held, parsed: [leaf(16)], pageCount: held.leafCount })
    expect(report.complete).toBe(false)
    expect(init.complete).toBe(false)
    expect(report.stillMissing).toBe(283)
  })

  it('carries the book length forward rather than the read count', () => {
    const held = checkpointed()
    const { init } = merge({ held, parsed: [leaf(16)], pageCount: held.leafCount })
    expect(init.leafCount).toBe(300)
  })

  it('treats a record written before the field existed as unknown, not a guess', () => {
    const old = { ...run(), leafCount: 0 }
    const { report } = merge({ held: old, parsed: [leaf(400)], pageCount: old.leafCount })
    expect(report.complete).toBe(false)
    expect(report.pageCount).toBeNull()
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

/**
 * The types say a summary cannot be passed here. To a JavaScript caller they
 * say nothing at all, and `scripts/drive.mjs` passed one: a `SavedRunSummary`
 * has a key and a fileName and no `transcriptions`, so every carried field read
 * as absent. Twelve landed leaves, two corrections and three rulings went, and
 * the report said `landed: 72` while it happened.
 */
describe('something run-shaped that is not a run', () => {
  it('refuses a summary rather than treating it as an empty book', () => {
    const summary = {
      key: 'book.pdf 100 1',
      fileName: 'book.pdf',
      complete: false,
      savedAt: '2026-08-24T00:00:00.000Z',
      pageCount: 84,
      failedPages: 0
    }
    expect(() => merge({ held: summary as unknown as SavedRun })).toThrow(/not a run/u)
  })

  it('still takes null, which is how a first batch starts a book', () => {
    expect(() => merge({ held: null })).not.toThrow()
  })

  it('still takes a real run', () => {
    expect(() => merge({ held: run() })).not.toThrow()
  })
})
