import { describe, it, expect } from 'vitest'
import { commutes, entriesBetween, mergeOutbox, summarize, type OutboxEntry } from '@core/sync'
import type { BookEdit } from '@core/edits'

const highlight = (id: string, tag: 'note' | 'intro' = 'note'): BookEdit => ({
  kind: 'highlight',
  highlightId: id,
  blockId: 'p2b0',
  quote: 'a candle flame',
  from: 10,
  to: 24,
  tag,
  madeAt: '2026-09-07T10:00:00.000Z'
})

const entry = (over: Partial<OutboxEntry> & { edit: BookEdit }): OutboxEntry => ({
  id: 'q1',
  bookKey: 'book',
  madeAt: '2026-09-07T10:00:00.000Z',
  saw: null,
  ...over
})

describe('what can be merged without asking', () => {
  it('is exactly the two channels that are messages about the book', () => {
    expect(commutes(highlight('h1'))).toBe(true)
    expect(commutes({ kind: 'memo', memoId: 'm', blockId: 'p1b0', at: 0, text: 'x' })).toBe(true)
    expect(commutes({ kind: 'text', blockId: 'p1b0', text: 'x' })).toBe(false)
  })
})

describe('two devices marking one book cannot conflict', () => {
  it('folds a queued highlight into a shelf that has gained others', () => {
    // The property the whole queue rests on. Each mark is keyed by its own id,
    // so a shelf that moved under us is not a problem to solve — the marks
    // simply both survive.
    const onShelf = [highlight('elsewhere')]
    const result = mergeOutbox(onShelf, [entry({ edit: highlight('here') })])
    expect(result.conflicts).toEqual([])
    expect(result.edits).toHaveLength(2)
    expect(result.applied).toHaveLength(1)
  })

  it('re-sending a batch whose response was lost changes nothing', () => {
    // A flush that succeeded and never got its answer back is retried. Every
    // entry is already on the shelf, and applying it again must be a no-op
    // rather than a duplicate or a conflict — otherwise a dropped connection
    // strands the reading forever.
    //
    // The correction is the one that matters here: highlights take the
    // commuting path and would pass whatever the retry rule did, so a batch of
    // marks alone tests nothing about this.
    const queued = [
      entry({ edit: highlight('h1') }),
      entry({ id: 'q2', edit: { kind: 'text', blockId: 'p1b0', text: 'Sent once.' } })
    ]
    const first = mergeOutbox([], queued)
    const again = mergeOutbox(first.edits, queued)
    expect(again.edits).toEqual(first.edits)
    expect(again.conflicts).toEqual([])
    expect(again.applied).toHaveLength(2)
  })

  it('keeps the later wording when one mark was edited twice here', () => {
    const first = entry({ id: 'q1', edit: highlight('h1'), madeAt: '2026-09-07T10:00:00.000Z' })
    const second = entry({
      id: 'q2',
      edit: { ...(highlight('h1') as object), tag: 'intro' } as BookEdit,
      madeAt: '2026-09-07T11:00:00.000Z'
    })
    // Handed over newest-first on purpose: the merge sorts by when they were
    // made, not by how they came out of the store, and a store is under no
    // obligation to return them in order. Folded in backwards, the earlier
    // wording would win and the editor's second thought would be lost.
    const result = mergeOutbox([], [second, first])
    expect(result.edits).toHaveLength(1)
    expect((result.edits[0] as { tag: string }).tag).toBe('intro')
  })
})

describe('a correction that does not commute', () => {
  const correction: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'The corrected words.' }

  it('goes up when the shelf still holds what it was made against', () => {
    const result = mergeOutbox([], [entry({ edit: correction, saw: null })])
    expect(result.conflicts).toEqual([])
    expect(result.edits).toEqual([correction])
  })

  it('is reported, not forced, when that passage changed elsewhere', () => {
    // Two devices retyping one block genuinely disagree and there is no correct
    // answer to pick. Forcing ours would delete somebody's work in silence.
    const theirs: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'Their words.' }
    const result = mergeOutbox([theirs], [entry({ edit: correction, saw: null })])
    expect(result.applied).toEqual([])
    expect(result.edits).toEqual([theirs])
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]!.onShelf).toEqual(theirs)
    expect(result.conflicts[0]!.why).toMatch(/changed elsewhere/u)
  })

  it('goes up when it was made against the version the shelf still has', () => {
    const base: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'The old words.' }
    const result = mergeOutbox([base], [entry({ edit: correction, saw: base })])
    expect(result.conflicts).toEqual([])
    expect(result.edits).toEqual([correction])
  })

  it('does not confuse two kinds of edit on one block', () => {
    // A `split` and a `text` are both about p1b0 and are not the same change.
    // Judging by the block alone would call one a conflict with the other.
    const split: BookEdit = { kind: 'split', blockId: 'p1b0', at: 5 }
    const result = mergeOutbox([split], [entry({ edit: correction, saw: null })])
    expect(result.conflicts).toEqual([])
    expect(result.edits).toContainEqual(correction)
    expect(result.edits).toContainEqual(split)
  })

  it('never drops a conflicted entry', () => {
    // It stays queued, which is what `applied` decides: a flush clears only
    // what it applied, so a correction nobody could take is still on the device
    // and still reported rather than lost.
    const theirs: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'Their words.' }
    const result = mergeOutbox([theirs], [entry({ edit: correction })])
    expect(result.applied).not.toContainEqual(expect.objectContaining({ edit: correction }))
    expect(result.conflicts[0]!.entry.edit).toEqual(correction)
  })
})

describe('what the interface has to be able to say', () => {
  it('counts what is on this device only, and how old it is', () => {
    const summary = summarize([
      entry({ id: 'a', edit: highlight('h1'), madeAt: '2026-09-05T09:00:00.000Z' }),
      entry({ id: 'b', edit: highlight('h2'), madeAt: '2026-09-07T09:00:00.000Z' }),
      entry({
        id: 'c',
        edit: { kind: 'text', blockId: 'p1b0', text: 'x' },
        madeAt: '2026-09-06T09:00:00.000Z'
      })
    ])
    expect(summary).toEqual({ waiting: 3, marks: 2, oldest: '2026-09-05T09:00:00.000Z' })
  })

  it('says nothing is waiting when nothing is', () => {
    expect(summarize([])).toEqual({ waiting: 0, marks: 0, oldest: null })
  })
})

describe('a mark taken off must not come back', () => {
  it('removes it from the shelf rather than re-adding it', () => {
    // Without this the queue could only ever add: a highlight cleared on a
    // tablet that was offline would return on the next flush, because the shelf
    // still holds it and nothing said otherwise. Silently wrong, which is the
    // one outcome worth building machinery to prevent.
    const onShelf = [highlight('h1'), highlight('h2')]
    const result = mergeOutbox(onShelf, [entry({ edit: highlight('h1'), remove: true })])
    expect(result.conflicts).toEqual([])
    expect(result.edits).toEqual([highlight('h2')])
    expect(result.applied).toHaveLength(1)
  })

  it('leaves the queue when it was already gone from both sides', () => {
    // Removed here and removed there. Nothing to do, and treating it as a
    // conflict would strand the entry on the device for ever.
    const result = mergeOutbox([], [entry({ edit: highlight('h1'), remove: true })])
    expect(result.applied).toHaveLength(1)
    expect(result.conflicts).toEqual([])
    expect(result.edits).toEqual([])
  })

  it('reports a correction withdrawn here that was changed elsewhere', () => {
    const base: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'The old words.' }
    const theirs: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'Their words.' }
    const result = mergeOutbox([theirs], [entry({ edit: base, saw: base, remove: true })])
    expect(result.applied).toEqual([])
    expect(result.edits).toEqual([theirs])
    expect(result.conflicts[0]!.why).toMatch(/changed elsewhere/u)
  })

  it('withdraws a correction the shelf still holds unchanged', () => {
    const base: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'The old words.' }
    const result = mergeOutbox([base], [entry({ edit: base, saw: base, remove: true })])
    expect(result.conflicts).toEqual([])
    expect(result.edits).toEqual([])
  })
})

describe('what to send, worked out from the list the app already keeps', () => {
  const AT = '2026-09-07T12:00:00.000Z'
  const between = (prev: BookEdit[], next: BookEdit[], queued: OutboxEntry[] = []) =>
    entriesBetween(prev, next, queued, 'book', AT)

  it('queues a mark that was just made', () => {
    const [only] = between([], [highlight('h1')])
    expect(only!.edit).toEqual(highlight('h1'))
    expect(only!.saw).toBeNull()
    expect(only!.remove).toBeUndefined()
  })

  it('queues a removal when a mark was taken off', () => {
    const [only] = between([highlight('h1')], [])
    expect(only!.remove).toBe(true)
    expect(only!.edit).toEqual(highlight('h1'))
  })

  it('queues nothing when nothing changed', () => {
    const list = [highlight('h1'), { kind: 'text', blockId: 'p1b0', text: 'x' } as BookEdit]
    expect(between(list, list)).toEqual([])
  })

  it('holds one entry per target rather than one per keystroke', () => {
    // The same block corrected twice is one thing to send, not two. A queue
    // that grew a record per keystroke would be a queue nobody could flush.
    const first: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'One.' }
    const second: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'Two.' }
    const a = between([], [first])
    const b = between([first], [second], a)
    expect(b).toHaveLength(1)
    expect(a[0]!.id).toBe(b[0]!.id)
  })

  it('keeps the base it was first queued against when it replaces an entry', () => {
    // The field means "what the shelf held when this target was first touched
    // here". Overwriting it with our own second version would compare the shelf
    // against a state it never had, and report a conflict that does not exist.
    const onShelf: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'From the shelf.' }
    const mine: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'Mine.' }
    const mineAgain: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'Mine, again.' }
    const first = between([onShelf], [mine])
    expect(first[0]!.saw).toEqual(onShelf)
    const second = between([mine], [mineAgain], first)
    expect(second[0]!.saw).toEqual(onShelf)
    // And it merges cleanly against the shelf it was actually made against.
    expect(mergeOutbox([onShelf], second).conflicts).toEqual([])
  })

  it('does not mistake two kinds of edit on one block for each other', () => {
    const text: BookEdit = { kind: 'text', blockId: 'p1b0', text: 'x' }
    const split: BookEdit = { kind: 'split', blockId: 'p1b0', at: 3 }
    expect(between([text], [text, split])).toHaveLength(1)
    expect(between([text], [text, split])[0]!.edit).toEqual(split)
  })
})
