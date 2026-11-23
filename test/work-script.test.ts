import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { lstatSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import * as paths from '@core/sync/work-paths'
import * as work from '@core/work'
// @ts-expect-error: plain Node modules with no types, used by the scripts as they are.
import { toolsRefusal } from '../scripts/lib/tools-guard.mjs'
// @ts-expect-error: as above.
import { shelfNotes } from '../scripts/lib/work-shelf.mjs'

/**
 * `scripts/work.mjs`, run as a session runs it, on a made-up shelf in a
 * temporary folder: it writes notes core's parser believes, reads them back
 * as the Workroom's lists, and refuses the tools repository, which is public.
 */
const REPO = fileURLToPath(new URL('..', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'work-notes-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const BOOK = 'Made-Up-Book-abc123'
const shelf = join(dir, 'shelf')
mkdirSync(join(shelf, 'books', BOOK), { recursive: true })
writeFileSync(join(shelf, 'books', BOOK, 'queries.md'), '# Queries (made up)\n')

function cmd(args: string[], at = shelf) {
  const r = spawnSync(process.execPath, ['scripts/work.mjs', ...args, '--shelf', at], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, SHELF: '' }
  })
  return { status: r.status, out: r.stdout, err: r.stderr }
}

const notesOn = (at: string) => {
  const root = join(at, 'work', 'runs')
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap((m) =>
    readdirSync(join(root, m)).map((n) => ({
      path: `work/runs/${m}/${n}`,
      text: readFileSync(join(root, m, n), 'utf8')
    }))
  )
}
const idIn = (out: string) => /Started run ([a-z0-9]{8})/.exec(out)?.[1] ?? ''

describe('work.mjs on a made-up shelf', () => {
  let reader = ''
  let checker = ''
  let scout = ''

  it('starts a run and writes a note core believes, where core says it goes', () => {
    const r = cmd([
      'start',
      ...['--role', 'reader', '--book', BOOK, '--stage', 'reading'],
      ...['--job', 'Read leaves 1 to 40', '--of', '40', '--unit', 'leaves']
    ])
    expect(r.status, r.err).toBe(0)
    reader = idIn(r.out)
    expect(r.out).toMatch(/Commit the note with your work: this command does not commit or push/)
    const files = notesOn(shelf)
    const read = work.readNotes(files)
    expect(read.unreadable).toEqual([])
    expect(read.notes[0]).toMatchObject({ id: reader, state: 'working', progress: { total: 40 } })
    expect(files[0]!.path).toBe(paths.statusNotePath(read.notes[0]!))
  }, 30_000)

  it('notes progress, hands off, and the checker that takes it asks the owner', () => {
    expect(cmd(['progress', reader, '--done', '20']).status).toBe(0)
    const h = cmd([
      'handoff',
      reader,
      '--to',
      'checker',
      '--result',
      'Read 40 of 40',
      '--done',
      '40'
    ])
    expect(h.status, h.err).toBe(0)
    const s = cmd([
      'start',
      ...['--role', 'checker', '--book', BOOK, '--stage', 'checking'],
      ...['--job', 'Check the read text', '--from', reader]
    ])
    expect(s.status, s.err).toBe(0)
    checker = idIn(s.out)
    const a = cmd([
      'ask',
      checker,
      ...['--what', 'Rule on two queries', '--where', `books/${BOOK}/queries.md`]
    ])
    expect(a.status, a.err).toBe(0)
    const read = work.readNotes(notesOn(shelf))
    expect(read.unreadable).toEqual([])
    const asked = read.notes.find((n) => n.id === checker)!
    expect(asked.owner).toEqual({
      what: 'Rule on two queries',
      links: [{ label: 'Questions sheet', path: `books/${BOOK}/queries.md` }]
    })
  }, 60_000)

  it('lists what waits on the owner, the book’s stage and the roles', () => {
    const l = cmd(['list'])
    expect(l.status, l.err).toBe(0)
    expect(l.out).toMatch(/WAITING ON YOU \(1\)\n {2}1\. Rule on two queries/)
    expect(l.out).toContain(`${BOOK}: at checking, waiting on you\n`)
    expect(l.out).toMatch(
      new RegExp(`Reading: handed off to Checker \\(picked up by ${checker}\\)`)
    )
    const j = JSON.parse(cmd(['list', '--json']).out)
    expect(j.waiting.map((r: { id: string }) => r.id)).toEqual([checker])
    const s = cmd(['show', reader])
    expect(s.out).toMatch(/Timeline:\n.*started: 0 of 40 leaves\n.*working: 20 of 40 leaves/)
  }, 60_000)

  it('refuses a link to a file not on the shelf, and a wrong note, writing nothing', () => {
    const before = notesOn(shelf).map((f) => f.text)
    const a = cmd(['ask', checker, '--what', 'Look', '--where', `books/${BOOK}/missing.md`])
    expect(a.status).toBe(1)
    expect(a.err).toMatch(/is not on the shelf .*Write it first/)
    const s = cmd(['start', '--role', 'proofreader', '--book', BOOK, '--stage', 'x', '--job', 'y'])
    expect(s.status).toBe(1)
    expect(s.err).toMatch(
      /Nothing was written:\n {2}- "role" is "proofreader", which is not a role/
    )
    expect(notesOn(shelf).map((f) => f.text)).toEqual(before)
  }, 60_000)

  it('refuses a book not on the shelf, except to a scout at sourcing', () => {
    const job = ['--job', 'Find the scan']
    const r = cmd([
      'start',
      '--role',
      'reader',
      '--book',
      'Not-Here-xyz',
      '--stage',
      'reading',
      ...job
    ])
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/There is no books\/Not-Here-xyz on the shelf/)
    const s = cmd([
      'start',
      '--role',
      'scout',
      '--book',
      'Not-Here-xyz',
      '--stage',
      'sourcing',
      ...job
    ])
    expect(s.status, s.err).toBe(0)
    scout = idIn(s.out)
  }, 60_000)

  it('refuses a hand-off naming a run of another role, writing nothing', () => {
    const e = cmd(['start', '--role', 'etsu', '--book', BOOK, '--stage', 'writing', '--job', 'W'])
    expect(e.status, e.err).toBe(0)
    const etsu = idIn(e.out)
    const before = notesOn(shelf).map((f) => f.text)
    const h = cmd(['handoff', etsu, '--to', 'checker', '--run', scout, '--result', 'Drafted'])
    expect(h.status).toBe(1)
    expect(h.err).toMatch(new RegExp(`Run ${scout} is a scout run, but the work goes to checker`))
    expect(notesOn(shelf).map((f) => f.text)).toEqual(before)
    expect(cmd(['done', etsu, '--result', 'Drafted']).status).toBe(0)
  }, 60_000)

  it('narrows list to one book or one role, in JSON as in text', () => {
    const byBook = JSON.parse(cmd(['list', '--json', '--book', 'Not-Here-xyz']).out)
    expect(byBook.waiting).toEqual([])
    expect(byBook.books.map((b: { book: string }) => b.book)).toEqual(['Not-Here-xyz'])
    const scouts = byBook.roles.find((r: { role: string }) => r.role === 'scout')
    expect(scouts.inProgress.map((r: { id: string }) => r.id)).toEqual([scout])
    const readers = byBook.roles.find((r: { role: string }) => r.role === 'reader')
    expect(readers.recent).toEqual([])

    const byRole = JSON.parse(cmd(['list', '--json', '--role', 'checker']).out)
    expect(byRole.roles.map((r: { role: string }) => r.role)).toEqual(['checker'])
    expect(byRole.waiting.map((r: { id: string }) => r.id)).toEqual([checker])
    expect(byRole.books.map((b: { book: string }) => b.book)).toEqual([BOOK])

    const text = cmd(['list', '--role', 'checker'])
    expect(text.out).toMatch(/Showing only role checker\./)
    expect(text.out).not.toMatch(/Not-Here-xyz/)
  }, 60_000)

  it('refuses list for a role that does not exist, naming the roles', () => {
    for (const json of [[], ['--json']]) {
      const r = cmd(['list', '--role', 'proofreader', ...json])
      expect(r.status).toBe(1)
      expect(r.out).toBe('')
      expect(r.err).toMatch(/"proofreader" is not a role\. Use one of: managing-editor, scout,/)
    }
  }, 30_000)

  it('reports a note it cannot believe, and still lists the rest', () => {
    const month = readdirSync(join(shelf, 'work', 'runs'))[0]!
    const bad = join(shelf, 'work', 'runs', month, `${month}-01-${BOOK}-reader-zzzz9999.json`)
    writeFileSync(bad, '{"format":"status-note","version":1}')
    const l = cmd(['list'])
    expect(l.status).toBe(1)
    expect(l.out).toMatch(/WAITING ON YOU \(1\)/)
    expect(l.err).toMatch(
      /1 note\(s\) could not be read.*\n.*zzzz9999\.json\n {4}- "id" is missing/
    )
    rmSync(bad)
  }, 30_000)
})

describe('work.mjs refuses the tools repository', () => {
  it('as the shelf, though it has a books/ folder', () => {
    // A copy of the tools with a books/ folder (this repository keeps none):
    // only the guard can stop it, and a broken guard writes nowhere near here.
    // A book the copy does not hold, so a broken guard stops on the book.
    const copy = join(dir, 'tools-with-books')
    mkdirSync(join(copy, 'books', BOOK), { recursive: true })
    writeFileSync(join(copy, 'package.json'), readFileSync(join(REPO, 'package.json')))
    const job = ['--book', 'Not-A-Book-zz9', '--stage', 'reading', '--job', 'x']
    const r = cmd(['start', '--role', 'reader', ...job], copy)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/inside the tools repository .* which is public/)
    expect(existsSync(join(copy, 'work'))).toBe(false)
  }, 30_000)

  it('reached through a link from outside', () => {
    const link = join(dir, 'looks-like-a-shelf')
    symlinkSync(REPO, link, 'dir')
    const r = cmd(['list'], link)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/inside the tools repository/)
  }, 30_000)

  it('and a folder that is not a shelf at all', () => {
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    const r = cmd(['list'], empty)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/has no books\/ folder, so it does not look like the shelf/)
  }, 30_000)
})

describe('the guard and the writer under work.mjs', () => {
  it('refuses inside this checkout, inside any copy of the tools, and through a link', () => {
    expect(toolsRefusal(join(REPO, 'not', 'there', 'yet.json'), 'a note')).toMatch(
      /inside the tools repository/
    )
    expect(toolsRefusal(join(dir, 'shelf', 'x.json'), 'a note')).toBeNull()
    const copy = join(dir, 'tools-copy')
    mkdirSync(join(copy, 'deep'), { recursive: true })
    writeFileSync(join(copy, 'package.json'), readFileSync(join(REPO, 'package.json')))
    expect(toolsRefusal(join(copy, 'deep', 'x.json'), 'a note')).toMatch(/tools-copy/)
    expect(toolsRefusal(join(dir, 'looks-like-a-shelf', 'w', 'x.json'), 'a note')).toMatch(
      /inside the tools repository/
    )
  })

  it('never writes a new note over a file already there', () => {
    const { writeNote } = shelfNotes({ work, paths, fail: thrown })
    const note = madeUpNote('dupe0001')
    writeNote(shelf, note, true)
    expect(() => writeNote(shelf, note, true)).toThrow(/already on the shelf; a new run never/)
  })
})

const thrown = (m: string) => {
  throw new Error(m)
}
const madeUpInput = (id: string): work.StartInput => ({
  id,
  role: 'reader',
  book: BOOK,
  stage: 'reading',
  job: 'Read',
  now: '2026-11-19T10:00:00Z'
})
const madeUpNote = (id: string) => work.startNote(madeUpInput(id))

/** A made-up shelf with one book, in the temporary folder. */
function shelfAt(name: string) {
  const at = join(dir, name)
  mkdirSync(join(at, 'books', BOOK), { recursive: true })
  return at
}

/**
 * A copy of the tools in the temporary folder (any folder whose package.json
 * is the tools' own), with an empty subfolder. Never the real checkout: if
 * the guard breaks, the note lands here, where the test sees it.
 */
function toolsCopy(name: string, sub: string) {
  const copy = join(dir, name)
  mkdirSync(join(copy, sub), { recursive: true })
  writeFileSync(join(copy, 'package.json'), readFileSync(join(REPO, 'package.json')))
  return { copy, inside: join(copy, sub) }
}

const startOn = (at: string) =>
  cmd(['start', '--role', 'reader', '--book', BOOK, '--stage', 'reading', '--job', 'Read'], at)

describe('the guard follows links into a subfolder of a tools copy', () => {
  it('refuses a shelf whose work folder links there, and writes nothing', () => {
    const { inside } = toolsCopy('tools-copy-work', join('src', 'deep'))
    const at = shelfAt('shelf-work-linked')
    symlinkSync(inside, join(at, 'work'), 'dir')
    expect(toolsRefusal(join(at, 'work', 'runs', '2026-11', 'x.json'), 'a note')).toMatch(
      /inside the tools repository \(.*tools-copy-work\)/
    )
    const r = startOn(at)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/inside the tools repository .*tools-copy-work/)
    expect(readdirSync(inside)).toEqual([])
  }, 30_000)

  it('refuses a month folder that links there, and writes nothing', () => {
    const { inside } = toolsCopy('tools-copy-month', join('src', 'month'))
    const at = shelfAt('shelf-month-linked')
    mkdirSync(join(at, 'work', 'runs'), { recursive: true })
    symlinkSync(inside, join(at, 'work', 'runs', '2026-11'), 'dir')
    expect(toolsRefusal(join(at, 'work', 'runs', '2026-11', 'x.json'), 'a note')).toMatch(
      /tools-copy-month/
    )
    const { writeNote } = shelfNotes({ work, paths, fail: thrown })
    expect(() => writeNote(at, madeUpNote('month001'), true)).toThrow(
      /inside the tools repository .*tools-copy-month/
    )
    expect(readdirSync(inside)).toEqual([])
  }, 30_000)

  it('refuses a work link into the tools whose target is not there yet', () => {
    const { copy } = toolsCopy('tools-copy-dangling', 'src')
    const at = shelfAt('shelf-dangling-into-tools')
    symlinkSync(join(copy, 'src', 'not-yet'), join(at, 'work'), 'dir')
    expect(toolsRefusal(join(at, 'work', 'runs', 'x.json'), 'a note')).toMatch(
      /tools-copy-dangling/
    )
    const r = startOn(at)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/inside the tools repository/)
    expect(existsSync(join(copy, 'src', 'not-yet'))).toBe(false)
  }, 30_000)
})

describe('the writer under work.mjs', () => {
  it('says plainly that a work link points nowhere, and writes nothing', () => {
    const at = shelfAt('shelf-dangling')
    const nowhere = join(dir, 'nowhere')
    symlinkSync(nowhere, join(at, 'work'), 'dir')
    const r = startOn(at)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/work is a link to .*nowhere, which is not there.*Nothing was written/)
    expect(r.err).not.toMatch(/\n\s+at /)
    expect(existsSync(nowhere)).toBe(false)
  }, 30_000)

  it('starts a run taking over no earlier than the hand-off, when this clock is behind', () => {
    const at = shelfAt('shelf-clock')
    const { writeNote } = shelfNotes({ work, paths, fail: thrown })
    // A reader on a computer whose clock is far ahead handed the book on.
    const ahead = '2099-01-01T10:00:00Z'
    const handed = work.noteHandoff(work.startNote({ ...madeUpInput('ahead001'), now: ahead }), {
      now: ahead,
      role: 'checker',
      result: 'Read'
    })
    writeNote(at, handed, true)
    const job = ['--stage', 'checking', '--job', 'Check', '--from', 'ahead001']
    const s = cmd(['start', '--role', 'checker', '--book', BOOK, ...job], at)
    expect(s.status, s.err).toBe(0)
    expect(s.err).toMatch(/clock is behind run ahead001's last change; the start is stamped 2099/)
    const room = JSON.parse(cmd(['list', '--json', '--role', 'reader'], at).out)
    expect(room.roles[0].recent[0].handoff).toMatchObject({ pickedUpBy: idIn(s.out) })
  }, 30_000)

  it('replaces a link planted at <note>.json.part instead of writing through it', () => {
    const { copy } = toolsCopy('tools-copy-part', 'src')
    const at = shelfAt('shelf-part')
    const s = startOn(at)
    expect(s.status, s.err).toBe(0)
    const id = idIn(s.out)
    const [file] = notesOn(at)
    const note = join(at, ...file!.path.split('/'))
    const planted = join(copy, 'src', 'planted.json')
    symlinkSync(planted, `${note}.part`)
    const p = cmd(['progress', id, '--done', '1', '--of', '2', '--unit', 'leaves'], at)
    expect(p.status, p.err).toBe(0)
    expect(existsSync(planted)).toBe(false)
    expect(lstatSync(note).isSymbolicLink()).toBe(false)
    const read = work.readNotes(notesOn(at))
    expect(read.notes[0]!.progress).toEqual({ done: 1, total: 2, unit: 'leaves' })
  }, 30_000)
})
