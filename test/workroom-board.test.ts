import { describe, expect, it } from 'vitest'
import {
  bookName,
  isWebLink,
  linkOpens,
  noteAsk,
  noteDone,
  noteProgress,
  shelfLinkFrom,
  stageStrip,
  startNote,
  workroom,
  workroomCounts,
  type Role,
  type Stage,
  type StatusNote
} from '@core/work'
import { notesInRunsTree } from '@core/sync'

/**
 * The small figures the Workroom screen shows beside its views
 * (`src/core/work/board.ts`, `links.ts`, `work-paths.ts`), on made-up books.
 */
const NOW = '2026-11-19T14:00:00Z'
const A = 'Nobody-TheLanternOfDust-abc123'
const B = 'Someone-AnInventedBook-xyz789'
const at = (day: number, hour: number) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`

function run(
  id: string,
  role: Role,
  book: string | null,
  stage: Stage | null,
  started: string
): StatusNote {
  return startNote({ id, role, book, stage, job: `Job of ${id}`, now: started })
}

// Book A: reading done, checking working now, writing begun beside it.
const read1 = noteDone(run('reader01', 'reader', A, 'reading', at(17, 9)), {
  now: at(17, 12),
  result: 'Read 40 of 40 leaves'
})
const check1 = noteProgress(run('checkr01', 'checker', A, 'checking', at(19, 12)), {
  now: at(19, 13)
})
const write1 = noteProgress(run('etsuwr01', 'etsu', A, 'writing', at(19, 10)), { now: at(19, 11) })
// Book B: published, done. A stale typesetter run with no book; one waiting run.
const pub = noteDone(run('managr01', 'managing-editor', B, 'published', at(10, 9)), {
  now: at(10, 10),
  result: 'Working files retired'
})
const stale = run('typset01', 'typesetter', null, null, at(18, 9))
const waits = noteAsk(run('scout001', 'scout', 'Third-MadeUpTitle-qqq111', 'sourcing', at(19, 8)), {
  now: at(19, 9),
  what: 'Choose between two scans',
  links: [{ label: 'Comparison', path: 'books/Third-MadeUpTitle-qqq111/sources.md' }]
})
const all = [read1, check1, write1, pub, stale, waits]

describe('the counts strip', () => {
  it('counts what waits, who works, the books in progress and the week’s finished runs', () => {
    expect(workroomCounts(all, NOW)).toEqual({
      waiting: 1,
      atWork: 2,
      stale: 1,
      booksInProgress: 2,
      doneThisWeek: 1
    })
  })

  it('counts every finished run, past the ten a role column shows', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      noteDone(run(`rd${String(i).padStart(6, '0')}`, 'reader', A, 'reading', at(18, 1)), {
        now: at(18, 2),
        result: 'Read a batch'
      })
    )
    expect(workroomCounts(many, NOW).doneThisWeek).toBe(14)
  })

  it('counts nothing on an empty shelf', () => {
    expect(workroomCounts([], NOW)).toEqual({
      waiting: 0,
      atWork: 0,
      stale: 0,
      booksInProgress: 0,
      doneThisWeek: 0
    })
  })
})

describe('a book’s strip of eight steps', () => {
  const room = workroom(all, NOW)
  const marks = (book: string) =>
    stageStrip(room.books.find((b) => b.book === book)!).map((s) => s.mark)

  it('marks the stages behind, the one it stands at, work begun ahead, and the rest', () => {
    expect(marks(A)).toEqual(['past', 'past', 'now', 'ahead', 'later', 'later', 'later', 'later'])
  })

  it('marks a book published and done as past all through', () => {
    expect(marks(B)).toEqual(Array(8).fill('past'))
  })
})

describe('a book’s name read off its folder', () => {
  it('splits the words, drops the id and takes the author', () => {
    expect(bookName(A)).toEqual({ title: 'The Lantern of Dust', author: 'Nobody' })
    expect(bookName('SomeAuthor-LettersToAPFriendVolII-1x2y3z')).toEqual({
      title: 'Letters to AP Friend Vol II',
      author: 'Some Author'
    })
  })

  it('keeps a folder in another form as its words, guessing nothing more', () => {
    expect(bookName('lantern-vol1-abc123')).toEqual({ title: 'Lantern vol1', author: null })
    expect(bookName('Lantern')).toEqual({ title: 'Lantern', author: null })
  })
})

describe('what a link opens', () => {
  it('opens a book’s questions sheet in the question screen', () => {
    expect(linkOpens(`books/${A}/queries.md`)).toEqual({
      kind: 'queries',
      path: `books/${A}/queries.md`,
      book: A
    })
  })

  it('opens sheets, JSON and pictures in the reading view, and names the rest', () => {
    expect(linkOpens(`books/${A}/readiness.md`).kind).toBe('markdown')
    expect(linkOpens(`books/${A}/about.json`).kind).toBe('json')
    expect(linkOpens('STORAGE.tsv').kind).toBe('text')
    expect(linkOpens(`books/${A}/images/plate.PNG`).kind).toBe('image')
    expect(linkOpens(`books/${A}/interior.pdf`).kind).toBe('other')
    // A questions sheet anywhere but directly in a book's folder is only a sheet.
    expect(linkOpens(`books/${A}/old/queries.md`).kind).toBe('markdown')
  })

  it('reads a link inside a sheet from the sheet’s folder, and never off the shelf', () => {
    const sheet = `books/${A}/ledger.md`
    expect(shelfLinkFrom(sheet, 'queries.md')).toBe(`books/${A}/queries.md`)
    expect(shelfLinkFrom(sheet, '../../RULINGS.md#voice')).toBe('RULINGS.md')
    expect(shelfLinkFrom(sheet, 'My%20Notes.md')).toBe(`books/${A}/My Notes.md`)
    expect(shelfLinkFrom(sheet, '../../../outside.md')).toBeNull()
    expect(shelfLinkFrom(sheet, '.git/config')).toBeNull()
    expect(shelfLinkFrom(sheet, '#a-heading')).toBeNull()
    expect(shelfLinkFrom(sheet, 'https://example.org/a.md')).toBeNull()
    expect(isWebLink('https://example.org/a.md')).toBe(true)
    expect(isWebLink('javascript:alert(1)')).toBe(false)
  })
})

describe('which entries of a work/runs listing are notes', () => {
  it('keeps the .json files directly inside a month folder, from the shelf’s top', () => {
    expect(
      notesInRunsTree([
        { path: '2026-11', type: 'tree', sha: 't1' },
        { path: '2026-11/2026-11-19-no-book-builder-aaaa1111.json', type: 'blob', sha: 's1' },
        { path: '2026-11/notes.txt', type: 'blob', sha: 's2' },
        { path: '2026-11/deeper/2026-11-19-x-reader-bbbb2222.json', type: 'blob', sha: 's3' },
        { path: 'README.json', type: 'blob', sha: 's4' },
        { path: '2025-01/2025-01-02-a-book-reader-cccc3333.json', type: 'blob', sha: 's5' }
      ])
    ).toEqual([
      { path: 'work/runs/2025-01/2025-01-02-a-book-reader-cccc3333.json', sha: 's5' },
      { path: 'work/runs/2026-11/2026-11-19-no-book-builder-aaaa1111.json', sha: 's1' }
    ])
  })
})
