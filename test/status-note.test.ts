import { describe, expect, it } from 'vitest'
import {
  checkStatusNote,
  noteAsk,
  noteDone,
  noteFailed,
  noteHandoff,
  noteProgress,
  parseStatusNote,
  runIdFrom,
  serializeStatusNote,
  stampFor,
  startNote,
  type StatusNote
} from '@core/work'

/**
 * The status note (`src/core/work/`): the record each run of an agent leaves
 * on the shelf. A note the Workroom shows must be one it can believe, so the
 * parser refuses anything wrong, and says why in plain words. Made-up books
 * only.
 */
const BOOK = 'Made-Up-Book-abc123'
const T0 = '2026-11-19T10:00:00Z'

function fresh(): StatusNote {
  return startNote({
    id: 'abcd1234',
    role: 'reader',
    book: BOOK,
    stage: 'reading',
    job: 'Read leaves 1 to 40',
    now: T0,
    progress: { done: 0, total: 40, unit: 'leaves' }
  })
}

/** The note as plain JSON, changed by `edit`, then checked. */
function problemsAfter(edit: (raw: Record<string, any>) => void, base = fresh()): string[] {
  const raw = JSON.parse(serializeStatusNote(base))
  edit(raw)
  const result = checkStatusNote(raw)
  return result.ok ? [] : result.problems
}

const asked = () =>
  noteAsk(fresh(), {
    now: '2026-11-19T11:00:00Z',
    what: 'Rule on two queries',
    links: [{ label: 'Questions sheet', path: `books/${BOOK}/queries.md` }]
  })

describe('a status note', () => {
  it('round-trips through its file, fields in a fixed order', () => {
    const note = fresh()
    const text = serializeStatusNote(note)
    expect(text.endsWith('}\n')).toBe(true)
    const back = parseStatusNote(text)
    expect(back.ok && back.note).toEqual(note)
    expect(Object.keys(JSON.parse(text)).slice(0, 4)).toEqual(['format', 'version', 'id', 'role'])
  })

  it('reads a note written with a byte-order mark, as Windows editors write it', () => {
    expect(parseStatusNote(`\ufeff${serializeStatusNote(fresh())}`).ok).toBe(true)
  })

  it('keeps every change in its history, oldest first', () => {
    let note = noteProgress(fresh(), {
      now: '2026-11-19T10:30:00Z',
      progress: { done: 20, total: 40, unit: 'leaves' },
      note: 'Halfway'
    })
    note = noteAsk(note, {
      now: '2026-11-19T11:00:00Z',
      what: 'Rule on two queries',
      links: [{ label: 'Questions sheet', path: `books/${BOOK}/queries.md` }]
    })
    expect(note.state).toBe('waiting')
    note = noteProgress(note, { now: '2026-11-19T12:00:00Z', note: 'Owner ruled' })
    expect(note.owner).toBeNull()
    expect(note.progress).toEqual({ done: 20, total: 40, unit: 'leaves' })
    note = noteHandoff(note, {
      now: '2026-11-19T13:00:00Z',
      role: 'checker',
      result: 'Read 40 of 40 leaves',
      progress: { done: 40, total: 40, unit: 'leaves' },
      files: [`books/${BOOK}/book.json`]
    })
    expect(note.history.map((e) => e.state)).toEqual([
      'working',
      'working',
      'waiting',
      'working',
      'handed-off'
    ])
    expect(note.history[2]!.owner?.what).toBe('Rule on two queries')
    expect(note).toMatchObject({
      state: 'handed-off',
      finishedAt: '2026-11-19T13:00:00Z',
      handoff: { role: 'checker', run: null, note: null },
      files: [`books/${BOOK}/book.json`]
    })
    expect(parseStatusNote(serializeStatusNote(note)).ok).toBe(true)
  })

  it('never reopens a finished run', () => {
    const done = noteDone(fresh(), { now: '2026-11-19T11:00:00Z', result: 'Read 40 leaves' })
    expect(() => noteProgress(done, { now: '2026-11-19T12:00:00Z' })).toThrow(
      /already done; a finished run is never reopened.*--from abcd1234/
    )
    const failed = noteFailed(fresh(), { now: T0, result: 'The scan is missing leaf 12' })
    expect(() => noteAsk(failed, { now: T0, what: 'x', links: [] })).toThrow(/already failed/)
  })

  it('stamps a change no earlier than the last, when this clock is behind', () => {
    const note = noteProgress(fresh(), { now: '2026-11-19T12:00:00Z' })
    expect(stampFor(note, '2026-11-19T11:00:00Z')).toBe('2026-11-19T12:00:00Z')
    const next = noteProgress(note, { now: '2026-11-19T11:00:00Z' })
    expect(next.updatedAt).toBe('2026-11-19T12:00:00Z')
    expect(parseStatusNote(serializeStatusNote(next)).ok).toBe(true)
  })

  it('makes run ids of eight lower-case letters and digits', () => {
    expect(runIdFrom([0, 25, 26, 35, 36, 255, 7, 8])).toBe('az09adhi')
    expect(() => runIdFrom([1, 2, 3])).toThrow(/eight random bytes/)
  })
})

describe('the parser refuses a note it cannot believe, with plain reasons', () => {
  it('a role or stage that does not exist, naming the ones that do', () => {
    const p = problemsAfter((n) => {
      n.role = 'proofreader'
      n.stage = 'typesetting'
    })
    expect(p).toContainEqual(expect.stringMatching(/"role" is "proofreader", which is not a role/))
    expect(p.join(' ')).toMatch(/managing-editor, scout, reader, typesetter, etsu, etsu-editor/)
    expect(p).toContainEqual(
      expect.stringMatching(/"stage" is "typesetting", which is not a stage/)
    )
  })

  it('a book with no stage, and a stage with no book', () => {
    expect(problemsAfter((n) => (n.stage = null))).toEqual([
      '"stage" is missing: a run on a book says which stage of it.'
    ])
    expect(problemsAfter((n) => (n.book = null))).toEqual([
      '"stage" is set but "book" is null: only work on a book has a stage.'
    ])
    expect(problemsAfter((n) => (n.book = '../secrets'))).toContainEqual(
      expect.stringMatching(/is not a book folder/)
    )
  })

  it('waiting on the owner without saying what for, or where', () => {
    expect(
      problemsAfter((n) => {
        n.owner = null
        n.history[1].owner = null
      }, asked())
    ).toEqual([
      'The run is waiting on the owner but "owner" does not say what he must do, or where.',
      'history event 2 is waiting on the owner but does not say what for.'
    ])
    expect(problemsAfter((n) => (n.owner.links = []), asked())).toContainEqual(
      expect.stringMatching(/links must list at least one file on the shelf/)
    )
  })

  it('a link that leaves the shelf', () => {
    for (const path of ['../elsewhere/x.md', '/etc/passwd', 'C:\\Users\\x.md', 'books//x.md']) {
      const p = problemsAfter((n) => (n.owner.links[0].path = path), asked())
      expect(p.join(' '), path).toMatch(/is not a path on the shelf/)
    }
  })

  it('an ask on a run that is not waiting', () => {
    expect(
      problemsAfter((n) => (n.owner = { what: 'x', links: [{ label: 'a', path: 'a.md' }] }))
    ).toEqual(['"owner" is set but the run is working: only a waiting run asks the owner.'])
  })

  it('a timeline out of order, or ending somewhere the run is not', () => {
    const later = noteProgress(fresh(), { now: '2026-11-19T11:00:00Z' })
    const p = problemsAfter((n) => {
      n.history[1].at = '2026-11-19T09:00:00Z'
    }, later)
    expect(p).toContainEqual(expect.stringMatching(/The timeline is out of order: history event 2/))
    expect(problemsAfter((n) => (n.state = 'waiting'), fresh())).toContainEqual(
      'The last history event is working but the run is waiting.'
    )
  })

  it('a change after the run finished', () => {
    const done = noteDone(fresh(), { now: '2026-11-19T11:00:00Z', result: 'Read' })
    const p = problemsAfter((n) => {
      n.history.push({ ...n.history[1], at: '2026-11-19T12:00:00Z' })
      n.updatedAt = n.finishedAt = '2026-11-19T12:00:00Z'
    }, done)
    expect(p).toContainEqual(expect.stringMatching(/history event 2 is done, but more follows it/))
  })

  it('a final state without its finish time or result, or a finish time on a live run', () => {
    expect(problemsAfter((n) => (n.finishedAt = '2026-11-19T10:00:00Z'))).toContainEqual(
      '"finishedAt" is set but the run is working.'
    )
    const done = noteDone(fresh(), { now: '2026-11-19T11:00:00Z', result: 'Read' })
    expect(problemsAfter((n) => (n.result = null), done)).toEqual([
      'The run is done but has no "result" line.'
    ])
    const handed = noteHandoff(fresh(), { now: T0, role: 'checker', result: 'Read' })
    expect(problemsAfter((n) => (n.handoff.role = 'nobody'), handed)).toContainEqual(
      expect.stringMatching(/"handoff" role is "nobody", which is not a role/)
    )
  })

  it('progress past its total', () => {
    expect(problemsAfter((n) => (n.progress.done = 41))).toContainEqual(
      '"progress" says 41 of 40: what is done cannot be more than the total.'
    )
  })

  it('a job that is empty, two lines or an essay', () => {
    expect(problemsAfter((n) => (n.job = ''))).toEqual(['"job" must be some plain words.'])
    expect(problemsAfter((n) => (n.job = 'one\ntwo'))).toEqual(['"job" must be one line.'])
    expect(problemsAfter((n) => (n.job = 'x'.repeat(121)))).toEqual([
      '"job" is 121 characters; keep it to 120.'
    ])
  })

  it('an unknown or missing field, a bad time, a bad id', () => {
    expect(problemsAfter((n) => (n.colour = 'red'))).toEqual([
      '"colour" is not a field of a status note (a typo, or a note from newer tools).'
    ])
    expect(problemsAfter((n) => delete n.files)).toEqual(['"files" is missing.'])
    expect(problemsAfter((n) => (n.updatedAt = '19 November 2026'))).toContainEqual(
      '"updatedAt" must be a UTC time such as 2026-11-19T14:05:00Z.'
    )
    expect(problemsAfter((n) => (n.id = 'ABC'))).toContainEqual(
      expect.stringMatching(/"ABC" is not a run id/)
    )
  })

  it('a note from newer tools, or not a note at all', () => {
    expect(problemsAfter((n) => (n.version = 2))).toEqual([
      'This note is version 2 and these tools read version 1: update the tools before reading or writing it.'
    ])
    const notJson = parseStatusNote('{ not json')
    expect(notJson.ok).toBe(false)
    expect(!notJson.ok && notJson.problems[0]).toMatch(/^It is not JSON/)
    expect(checkStatusNote([1, 2])).toEqual({
      ok: false,
      problems: ['A status note is a JSON object; this is not one.']
    })
  })

  it('a change that would make a wrong note throws, and writes nothing', () => {
    expect(() =>
      startNote({ id: 'abcd1234', role: 'reader', book: BOOK, stage: null, job: 'x', now: T0 })
    ).toThrow(/"stage" is missing/)
    expect(() =>
      noteAsk(fresh(), { now: T0, what: 'Look at this', links: [{ label: 'x', path: '/abs' }] })
    ).toThrow(/is not a path on the shelf/)
  })
})
