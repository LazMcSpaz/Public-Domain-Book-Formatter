import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { symlinkSync, writeFileSync } from 'node:fs'
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
  }, 60_000)

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
    expect(existsSync(join(REPO, 'books'))).toBe(true)
    // A book the tools do not hold, so that with the guard broken the
    // command still stops (on the missing book) before writing anything here.
    const job = ['--book', 'Not-A-Book-zz9', '--stage', 'reading', '--job', 'x']
    const r = cmd(['start', '--role', 'reader', ...job], REPO)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/inside the tools repository .* which is public/)
    expect(existsSync(join(REPO, 'work'))).toBe(false)
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
    const fail = (m: string) => {
      throw new Error(m)
    }
    const { writeNote } = shelfNotes({ work, paths, fail })
    const note = work.startNote({
      id: 'dupe0001',
      role: 'reader',
      book: BOOK,
      stage: 'reading',
      job: 'Read',
      now: '2026-11-19T10:00:00Z'
    })
    writeNote(shelf, note, true)
    expect(() => writeNote(shelf, note, true)).toThrow(/already on the shelf; a new run never/)
  })
})
