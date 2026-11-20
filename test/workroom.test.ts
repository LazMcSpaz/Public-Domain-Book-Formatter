import { describe, expect, it } from 'vitest'
import {
  noteAsk,
  noteDone,
  noteFailed,
  noteHandoff,
  noteProgress,
  startNote,
  workroom,
  type Role,
  type Stage,
  type StatusNote
} from '@core/work'

/**
 * The Workroom's three views, read off a made-up shelf of runs
 * (`src/core/work/workroom.ts`): what waits on the owner, where each book
 * stands, and what each role is doing. Stale and handed-off runs above all:
 * a board that shows dead work as live, or work handed on as lost, is the
 * report this screen must never make.
 */
const NOW = '2026-11-19T14:00:00Z'
const A = 'Made-Up-Book-aaa111'
const B = 'Made-Up-Book-bbb222'
const C = 'Made-Up-Book-ccc333'
const D = 'Made-Up-Book-ddd444'
const E = 'Made-Up-Book-eee555'

const at = (day: number, hour: number) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`

function run(
  id: string,
  role: Role,
  book: string | null,
  stage: Stage | null,
  started: string,
  from: string | null = null
): StatusNote {
  return startNote({ id, role, book, stage, job: `Job of ${id}`, now: started, from })
}

const link = (book: string) => [{ label: 'Questions sheet', path: `books/${book}/queries.md` }]

// Book A: read, handed to the checker, who took it up and now asks the
// owner; Etsu writes beside them.
const r1 = noteHandoff(
  noteProgress(run('reader01', 'reader', A, 'reading', at(19, 9)), {
    now: at(19, 10),
    progress: { done: 20, total: 40, unit: 'leaves' }
  }),
  { now: at(19, 12), role: 'checker', result: 'Read 40 of 40 leaves' }
)
const c1 = noteAsk(run('checkr01', 'checker', A, 'checking', at(19, 12), 'reader01'), {
  now: at(19, 13),
  what: 'Rule on the two queries the check raised',
  links: link(A)
})
const e1 = noteProgress(run('etsuwr01', 'etsu', A, 'writing', at(19, 11)), { now: at(19, 13) })

// Book B: sourced days ago; a reader that went quiet two days ago.
const s1 = noteDone(run('scout001', 'scout', B, 'sourcing', at(15, 9)), {
  now: at(16, 9),
  result: 'Scan found and checked'
})
const r2 = noteProgress(run('reader02', 'reader', B, 'reading', at(17, 9)), { now: at(17, 12) })

// Book C: read, then the check failed, and nothing is live.
const r3 = noteDone(run('reader03', 'reader', C, 'reading', at(18, 9)), {
  now: at(18, 12),
  result: 'Read'
})
const c2 = noteFailed(run('checkr02', 'checker', C, 'checking', at(18, 13), 'reader03'), {
  now: at(18, 15),
  result: 'Page turns broken on leaves 12 and 40'
})

// Book D: handed to the checker an hour ago; no checker has taken it.
const r4 = noteHandoff(run('reader04', 'reader', D, 'reading', at(19, 8)), {
  now: at(19, 13),
  role: 'checker',
  result: 'Read 12 of 12 leaves'
})

// Book E: the managing editor has waited five days on the owner's upload.
const m1 = noteAsk(run('maned001', 'managing-editor', E, 'upload', at(14, 9)), {
  now: at(14, 10),
  what: 'Press upload on KDP',
  links: [{ label: 'Readiness report', path: `books/${E}/readiness.md` }]
})

// Tools work: a builder hands to a reviewer by naming the review's run.
const v1 = run('review01', 'reviewer', null, null, at(19, 12))
const b1 = noteHandoff(run('build001', 'builder', null, null, at(19, 9)), {
  now: at(19, 12),
  role: 'reviewer',
  run: 'review01',
  result: 'Status notes built'
})
// Finished ten days ago: not "recent".
const old = noteDone(run('reader00', 'reader', C, 'reading', at(9, 9)), {
  now: at(9, 10),
  result: 'First batch read'
})

const ALL = [r1, c1, e1, s1, r2, r3, c2, r4, m1, v1, b1, old]
const room = workroom(ALL, NOW)
const book = (name: string) => room.books.find((b) => b.book === name)!
const role = (name: Role) => room.roles.find((r) => r.role === name)!
const ids = (runs: { id: string }[]) => runs.map((r) => r.id)

describe('waiting on you', () => {
  it('lists every waiting run, the longest waiting first, with what and where', () => {
    expect(ids(room.waiting)).toEqual(['maned001', 'checkr01'])
    expect(room.waiting[1]!.owner).toEqual({
      what: 'Rule on the two queries the check raised',
      links: link(A)
    })
  })

  it('never calls a waiting run stale, however long the owner takes', () => {
    expect(room.waiting[0]!.shown).toBe('waiting')
    expect(room.waiting[0]!.quietHours).toBeGreaterThan(24 * 5 - 1)
  })
})

describe('books', () => {
  it('lists each book once, the most recently active first', () => {
    expect(room.books.map((b) => b.book)).toEqual([A, D, C, B, E])
  })

  it('puts a book at its earliest live stage, and says how each stage stands', () => {
    expect(book(A)).toMatchObject({ stage: 'checking', shown: 'waiting', waiting: 1 })
    expect(book(A).stages.map((s) => [s.stage, s.shown, s.latest.id])).toEqual([
      ['reading', 'handed-off', 'reader01'],
      ['checking', 'waiting', 'checkr01'],
      ['writing', 'working', 'etsuwr01']
    ])
    expect(ids(book(A).latest)).toEqual(['checkr01', 'etsuwr01', 'reader01'])
  })

  it('shows a quiet reader as stale, not working, and the book at that stage', () => {
    expect(book(B)).toMatchObject({ stage: 'reading', shown: 'stale' })
    expect(book(B).stages.map((s) => [s.stage, s.shown])).toEqual([
      ['sourcing', 'done'],
      ['reading', 'stale']
    ])
  })

  it('with nothing live, puts a book at its furthest stage and that stage’s outcome', () => {
    expect(book(C)).toMatchObject({ stage: 'checking', shown: 'failed', waiting: 0 })
    expect(book(C).stages[0]).toMatchObject({ stage: 'reading', runs: 2, live: 0 })
    expect(book(D)).toMatchObject({ stage: 'reading', shown: 'handed-off' })
  })
})

describe('roles', () => {
  it('lists all nine roles in order, even those with nothing to show', () => {
    expect(room.roles.map((r) => r.role)).toEqual([
      'managing-editor',
      'scout',
      'reader',
      'typesetter',
      'etsu',
      'etsu-editor',
      'checker',
      'builder',
      'reviewer'
    ])
    expect(role('typesetter')).toMatchObject({ inProgress: [], recent: [], awaiting: [] })
  })

  it('shows each role’s runs in progress, stale ones marked', () => {
    expect(role('reader').inProgress.map((r) => [r.id, r.shown])).toEqual([['reader02', 'stale']])
    expect(ids(role('checker').inProgress)).toEqual(['checkr01'])
    expect(ids(role('etsu').inProgress)).toEqual(['etsuwr01'])
  })

  it('shows runs finished in the last seven days, newest first, and not older ones', () => {
    expect(ids(role('reader').recent)).toEqual(['reader04', 'reader01', 'reader03'])
    expect(ids(role('checker').recent)).toEqual(['checkr02'])
  })

  it('shows work handed to a role that no run has picked up', () => {
    expect(ids(role('checker').awaiting)).toEqual(['reader04'])
    const a = role('reader').recent.find((r) => r.id === 'reader01')!
    expect(a.handoff).toMatchObject({ role: 'checker', pickedUpBy: 'checkr01' })
    expect(a.followedBy).toEqual(['checkr01'])
    expect(room.waiting[1]!.pickedUp).toEqual(['reader01'])
  })

  it('counts a hand-off as picked up when it named the next run', () => {
    expect(role('builder').recent[0]!.handoff).toMatchObject({
      role: 'reviewer',
      pickedUpBy: 'review01'
    })
    expect(role('reviewer').awaiting).toEqual([])
    expect(role('reviewer').inProgress[0]!.pickedUp).toEqual(['build001'])
  })
})

describe('a hand-off is picked up only by its own role, after it', () => {
  // A reader hands the book to the checker at 13:00. Etsu starts from the
  // reader's run (to write while the check runs), and a checker run that
  // started at 12:00, before the hand-off, also names it: neither picks it up.
  const handed = noteHandoff(run('reader09', 'reader', A, 'reading', at(19, 9)), {
    now: at(19, 13),
    role: 'checker',
    result: 'Read 40 of 40 leaves'
  })
  const etsu = run('etsuwr09', 'etsu', A, 'writing', at(19, 13), 'reader09')
  const early = run('checkr08', 'checker', A, 'checking', at(19, 12), 'reader09')
  const view = workroom([handed, etsu, early], NOW)
  const of = (r: Role) => view.roles.find((x) => x.role === r)!

  it('is still handed to the checker, and not picked up', () => {
    expect(ids(of('checker').awaiting)).toEqual(['reader09'])
    const reader = of('reader').recent.find((r) => r.id === 'reader09')!
    expect(reader.handoff).toMatchObject({ role: 'checker', pickedUpBy: null })
    expect(reader.followedBy).toEqual(['checkr08', 'etsuwr09'])
    expect(of('etsu').inProgress[0]!.pickedUp).toEqual([])
  })

  it('is picked up by a checker run that starts at or after the hand-off', () => {
    const checker = run('checkr09', 'checker', A, 'checking', at(19, 13), 'reader09')
    const after = workroom([handed, etsu, early, checker], NOW)
    expect(after.roles.find((x) => x.role === 'checker')!.awaiting).toEqual([])
    const reader = after.roles.find((x) => x.role === 'reader')!.recent[0]!
    expect(reader.handoff).toMatchObject({ pickedUpBy: 'checkr09' })
  })

  it('is not picked up by naming a run of another role', () => {
    const named = noteHandoff(run('reader10', 'reader', A, 'reading', at(19, 9)), {
      now: at(19, 13),
      role: 'checker',
      run: 'etsuwr09',
      result: 'Read'
    })
    const view2 = workroom([named, etsu], NOW)
    expect(ids(view2.roles.find((x) => x.role === 'checker')!.awaiting)).toEqual(['reader10'])
  })
})

describe('the reader’s own rules', () => {
  it('waits longer before calling a run stale when told to', () => {
    const patient = workroom(ALL, NOW, { staleAfterHours: 100 })
    expect(patient.books.find((b) => b.book === B)).toMatchObject({ shown: 'working' })
  })

  it('shows one note per run, the copy changed last', () => {
    const earlier = run('reader02', 'reader', B, 'reading', at(17, 9))
    const twice = workroom([earlier, ...ALL, earlier], NOW)
    const reader = twice.roles.find((r) => r.role === 'reader')!
    expect(reader.inProgress.map((r) => [r.id, r.updatedAt])).toEqual([['reader02', at(17, 12)]])
  })

  it('orders by the moment, however a time is written', () => {
    // As text, 13:00:00.500Z sorts before 13:00:00Z.
    const a = noteProgress(run('readr0a1', 'reader', A, 'reading', at(19, 9)), {
      now: '2026-11-19T13:00:00.500Z'
    })
    const b = noteProgress(run('readr0b1', 'reader', B, 'reading', at(19, 9)), {
      now: '2026-11-19T13:00:00Z'
    })
    const r = workroom([a, b], NOW)
    expect(r.books.map((x) => x.book)).toEqual([A, B])
    expect(ids(r.roles.find((x) => x.role === 'reader')!.inProgress)).toEqual([
      'readr0a1',
      'readr0b1'
    ])
  })

  it('gives each run its place on the shelf', () => {
    expect(room.waiting[1]!.path).toBe(`work/runs/2026-11/2026-11-19-${A}-checker-checkr01.json`)
  })
})
