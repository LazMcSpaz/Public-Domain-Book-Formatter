import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  bookFolderProblem,
  linkLabel,
  runIdOfPath,
  runsMonthPath,
  shelfPathProblem,
  statusNotePath
} from '@core/sync'
import { readNotes, runIdFrom, serializeStatusNote, startNote, type StatusNote } from '@core/work'

/**
 * Where status notes live on the shelf (`src/core/sync/work-paths.ts`): one
 * file per run, so agents working at the same time never write the same file.
 * The owner asked for exactly that. Made-up books only.
 */
const BOOK = 'Made-Up-Book-abc123'

const note = (over: Partial<Parameters<typeof startNote>[0]> = {}): StatusNote =>
  startNote({
    id: runIdFrom(randomBytes(8)),
    role: 'reader',
    book: BOOK,
    stage: 'reading',
    job: 'Read a batch of leaves',
    now: '2026-11-19T10:00:00Z',
    ...over
  })

describe('a status note’s path', () => {
  it('is work/runs/<month>/<day>-<book>-<role>-<id>.json, from the run’s start in UTC', () => {
    expect(statusNotePath(note({ id: 'abcd1234' }))).toBe(
      `work/runs/2026-11/2026-11-19-${BOOK}-reader-abcd1234.json`
    )
    expect(
      statusNotePath(
        note({ id: 'abcd1234', role: 'builder', book: null, stage: null, job: 'Build x' })
      )
    ).toBe('work/runs/2026-11/2026-11-19-no-book-builder-abcd1234.json')
  })

  it('is sharded by the month the run started, whenever it is updated', () => {
    expect(runsMonthPath('2026-11-30T23:59:59Z')).toBe('work/runs/2026-11')
    expect(runsMonthPath('2026-12-01T00:00:00Z')).toBe('work/runs/2026-12')
    const late = note({ now: '2026-11-30T23:59:59Z' })
    expect(statusNotePath(late)).toMatch(/^work\/runs\/2026-11\/2026-11-30-/)
  })

  it('never collides for parallel runs: same book, same role, same second', () => {
    const paths = new Set<string>()
    const runs = 5000
    for (let i = 0; i < runs; i++) paths.add(statusNotePath(note()))
    expect(paths.size).toBe(runs)
  })

  it('differs whenever the run id does, and only names one run', () => {
    const a = note({ id: 'aaaa1111' })
    const b = note({ id: 'aaaa1112' })
    expect(statusNotePath(a)).not.toBe(statusNotePath(b))
    expect(runIdOfPath(statusNotePath(a))).toBe('aaaa1111')
    expect(runIdOfPath(`C:\\shelf\\${statusNotePath(b).replace(/\//g, '\\')}`)).toBe('aaaa1112')
    expect(runIdOfPath('work/runs/2026-11/README.md')).toBeNull()
  })

  it('refuses a part that cannot go in a name', () => {
    const base = { id: 'abcd1234', role: 'reader', book: BOOK, startedAt: '2026-11-19T10:00:00Z' }
    expect(() => statusNotePath({ ...base, id: 'ABCD1234' })).toThrow(/not a run id/)
    expect(() => statusNotePath({ ...base, book: 'books/x' })).toThrow(/not a book folder/)
    expect(() => statusNotePath({ ...base, book: 'no-book' })).toThrow(/kept for runs with no book/)
    expect(() => statusNotePath({ ...base, startedAt: 'yesterday' })).toThrow(/not a UTC time/)
    expect(bookFolderProblem('..')).toMatch(/not a book folder/)
  })
})

describe('a path on the shelf a note may name', () => {
  it('is relative to the shelf’s top, with forward slashes', () => {
    expect(shelfPathProblem(`books/${BOOK}/queries.md`)).toBeNull()
    expect(shelfPathProblem('RULINGS.md')).toBeNull()
    expect(shelfPathProblem('books/A/notes (draft 2).md')).toBeNull()
  })

  it('never reaches into a .git folder, in any case', () => {
    for (const path of ['.git/config', 'books/x/.git/HEAD', 'books/.GIT/x.md', '.Git']) {
      expect(shelfPathProblem(path), path).toMatch(/reaches into a \.git folder/)
    }
    expect(shelfPathProblem('books/x/.gitignore')).toBeNull()
    expect(shelfPathProblem('.github/notes.md')).toBeNull()
  })

  it('never leaves the shelf or hides a full path', () => {
    expect(shelfPathProblem('../x.md')).toMatch(/"\.\."/)
    expect(shelfPathProblem('/home/x.md')).toMatch(/from the shelf's top/)
    expect(shelfPathProblem('C:/x.md')).toMatch(/from the shelf's top/)
    expect(shelfPathProblem('https://example.com/x')).toMatch(/from the shelf's top/)
    expect(shelfPathProblem('books\\x.md')).toMatch(/forward slashes/)
    expect(shelfPathProblem('a=b.md')).toMatch(/a character a shelf path does not use/)
    expect(shelfPathProblem('')).toMatch(/empty/)
  })

  it('gets a name the owner knows when it is one of the sheets', () => {
    expect(linkLabel(`books/${BOOK}/queries.md`)).toBe('Questions sheet')
    expect(linkLabel(`books/${BOOK}/readiness.md`)).toBe('Readiness report')
    expect(linkLabel(`books/${BOOK}/plate-3.png`)).toBe('plate-3.png')
  })
})

describe('reading many notes at once', () => {
  it('reads the sound ones and reports, with reasons, the rest', () => {
    const good = note({ id: 'good0001' })
    const other = note({ id: 'good0002', role: 'checker', stage: 'checking' })
    const at = (n: StatusNote) => ({ path: statusNotePath(n), text: serializeStatusNote(n) })
    const renamed = { ...at(other), path: at(other).path.replace('-checker-', '-reader-') }
    const copy = {
      path: `work/runs/2026-11/2026-11-19-${BOOK}-reader-good0001.json`,
      text: at(good).text
    }
    const result = readNotes([
      at(good),
      renamed,
      { path: 'work/runs/2026-11/2026-11-19-x-reader-broken01.json', text: '{' },
      copy
    ])
    expect(result.notes.map((n) => n.id)).toEqual(['good0001'])
    const why = Object.fromEntries(result.unreadable.map((u) => [u.path, u.problems.join(' ')]))
    expect(why[renamed.path]).toMatch(/belongs at .*-checker-good0002\.json.*renamed by hand/)
    expect(why['work/runs/2026-11/2026-11-19-x-reader-broken01.json']).toMatch(/not JSON/)
  })

  it('refuses a second note with a run id already read', () => {
    const a = note({ id: 'same0001' })
    const moved = { ...a, book: 'Another-Made-Up-Book-xyz789' }
    const files = [a, moved].map((n) => ({ path: statusNotePath(n), text: serializeStatusNote(n) }))
    const result = readNotes(files)
    expect(result.notes).toHaveLength(1)
    expect(result.unreadable[0]!.problems[0]).toMatch(/Run same0001 is also in .*two notes cannot/)
  })
})
