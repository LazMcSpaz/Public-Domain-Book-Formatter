import { afterEach, describe, expect, it } from 'vitest'
import { memoryNoteCache, readWorkNotes } from '@platform/browser/shelf-notes'
import { noteAsk, serializeStatusNote, startNote } from '@core/work'
import { statusNotePath } from '@core/sync'
import { API, blobsIn, config, note, sha, shelfOf, stubGitHub } from './fixtures/notes-github'

/**
 * The Workroom's reader against a stand-in for GitHub (`fixtures/notes-github.ts`):
 * one trees request lists every note with its blob sha, and a note is fetched
 * only when its sha is new. The books and jobs are made up. The copy kept on
 * the device is `workroom-device-notes.test.ts`.
 */
const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
})

describe('reading the status notes', () => {
  it('lists every note with one request and fetches each once, every read marked', async () => {
    const shelf = shelfOf(
      note('aaaa1111', 'Nobody-TheLanternOfDust-abc123'),
      note('bbbb2222', null)
    )
    const seen = stubGitHub(() => shelf)
    const read = await readWorkNotes(config, memoryNoteCache())
    expect(read.notes.map((n) => n.id).sort()).toEqual(['aaaa1111', 'bbbb2222'])
    expect(read.unreadable).toEqual([])
    expect(read).toMatchObject({ listed: 2, fetched: 2 })
    const trees = seen.filter((s) => s.url.includes('/git/trees/'))
    expect(trees).toHaveLength(1)
    expect(trees[0]!.url.startsWith(`${API}/git/trees/main:work/runs?recursive=1&unshared=`)).toBe(
      true
    )
    expect(blobsIn(seen)).toHaveLength(2)
    expect(blobsIn(seen).every((s) => s.accept.includes('raw'))).toBe(true)
    // The shelf connection's rules: a unique mark on every read, and no-store.
    const marks = seen.map((s) => new URL(s.url).searchParams.get('unshared'))
    expect(marks.every(Boolean)).toBe(true)
    expect(new Set(marks).size).toBe(marks.length)
    expect(seen.every((s) => s.cache === 'no-store')).toBe(true)
  })

  it('fetches nothing again when nothing changed: one request in all', async () => {
    const shelf = shelfOf(
      note('aaaa1111', 'Nobody-TheLanternOfDust-abc123'),
      note('bbbb2222', null)
    )
    const seen = stubGitHub(() => shelf)
    const cache = memoryNoteCache()
    await readWorkNotes(config, cache)
    seen.length = 0
    const again = await readWorkNotes(config, cache)
    expect(seen).toHaveLength(1)
    expect(again).toMatchObject({ listed: 2, fetched: 0 })
    expect(again.notes).toHaveLength(2)
  })

  it('fetches only the notes that are new or changed', async () => {
    const first = note('aaaa1111', 'Nobody-TheLanternOfDust-abc123')
    const second = note('bbbb2222', null)
    let shelf = shelfOf(first, second)
    const seen = stubGitHub(() => shelf)
    const cache = memoryNoteCache()
    await readWorkNotes(config, cache)
    const asked = noteAsk(first, {
      now: '2026-10-02T11:00:00Z',
      what: 'Rule the four questions in chapter two',
      links: [{ label: 'Questions sheet', path: 'books/Nobody-TheLanternOfDust-abc123/queries.md' }]
    })
    const added = note('cccc3333', 'Someone-AnInventedBook-xyz789', 'Read the last batch')
    shelf = shelfOf(asked, second, added)
    seen.length = 0
    const read = await readWorkNotes(config, cache)
    const fetched = blobsIn(seen).map((s) => s.url.split('/git/blobs/')[1]!.split('?')[0])
    expect(fetched.sort()).toEqual(
      [sha(serializeStatusNote(asked)), sha(serializeStatusNote(added))].sort()
    )
    expect(read.fetched).toBe(2)
    expect(read.notes.find((n) => n.id === 'aaaa1111')?.state).toBe('waiting')
    expect(read.notes).toHaveLength(3)
  })

  it('reports a malformed note with the reason and still reads the rest', async () => {
    const shelf = shelfOf(note('aaaa1111', 'Nobody-TheLanternOfDust-abc123'))
    shelf.set('work/runs/2026-10/2026-10-02-no-book-reader-zzzz9999.json', '{ "format": "status-no')
    stubGitHub(() => shelf)
    const read = await readWorkNotes(config, memoryNoteCache())
    expect(read.notes.map((n) => n.id)).toEqual(['aaaa1111'])
    expect(read.unreadable).toHaveLength(1)
    expect(read.unreadable[0]!.path).toBe(
      'work/runs/2026-10/2026-10-02-no-book-reader-zzzz9999.json'
    )
    expect(read.unreadable[0]!.problems[0]).toMatch(/not JSON/u)
  })

  it('passes over files that are not notes, and reads an old month as well as a new one', async () => {
    const old = startNote({
      id: 'dddd4444',
      role: 'checker',
      book: 'Nobody-TheLanternOfDust-abc123',
      stage: 'checking',
      job: 'Check the text',
      now: '2025-03-01T08:00:00Z'
    })
    const shelf = shelfOf(old, note('aaaa1111', null))
    shelf.set('work/runs/README.md', 'not a note')
    stubGitHub(() => shelf)
    const read = await readWorkNotes(config, memoryNoteCache())
    expect(read.notes.map((n) => n.id).sort()).toEqual(['aaaa1111', 'dddd4444'])
    expect(read.listed).toBe(2)
  })

  it('reads an empty shelf as no notes, not as a failure', async () => {
    const seen = stubGitHub(() => new Map())
    const read = await readWorkNotes(config, memoryNoteCache())
    expect(read).toEqual({ notes: [], unreadable: [], listed: 0, fetched: 0 })
    // The repository was asked about, so a token that cannot see it is named as that.
    expect(seen.some((s) => s.url.startsWith(`${API}?`) || s.url === API)).toBe(true)
  })

  it('names a shelf the token cannot see, rather than showing an empty board', async () => {
    stubGitHub(
      () => new Map(),
      (url) =>
        url.pathname === '/repos/someone/shelf' ? new Response('{}', { status: 404 }) : null
    )
    await expect(readWorkNotes(config, memoryNoteCache())).rejects.toThrow(/no such repository/u)
  })

  it('names a branch the shelf does not have, rather than showing an empty board', async () => {
    const shelf = shelfOf(note('aaaa1111', null))
    const seen = stubGitHub(() => shelf)
    const wrong = { ...config, branch: 'mian' }
    const read = readWorkNotes(wrong, memoryNoteCache())
    await expect(read).rejects.toThrow(/no branch called “mian”.*usual branch is “main”/u)
    await expect(read).rejects.toMatchObject({ name: 'NoSuchBranch' })
    expect(seen.some((s) => s.url.startsWith(`${API}/git/ref/heads/mian?unshared=`))).toBe(true)
  })

  it('keeps nothing whose bytes do not match its fingerprint, and asks again next time', async () => {
    const shelf = shelfOf(note('aaaa1111', null))
    const seen = stubGitHub(
      () => shelf,
      (url) => (url.pathname.includes('/git/blobs/') ? new Response('{"tampered": true}') : null)
    )
    const cache = memoryNoteCache()
    const read = await readWorkNotes(config, cache)
    expect(read.notes).toEqual([])
    expect(read.unreadable[0]!.problems[0]).toMatch(/fingerprint/u)
    // Asked for, and not kept: nothing was fetched.
    expect(read.fetched).toBe(0)
    seen.length = 0
    await readWorkNotes(config, cache)
    expect(blobsIn(seen)).toHaveLength(1)
  })

  it('reads a listing GitHub cut short month by month', async () => {
    const a = note('aaaa1111', null)
    const shelf = shelfOf(a)
    const text = serializeStatusNote(a)
    const name = statusNotePath(a).split('/').pop()!
    const seen = stubGitHub(
      () => shelf,
      (url) => {
        const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
        if (url.pathname.endsWith('/git/trees/main:work/runs')) {
          return body({ sha: 'runs-tree', truncated: true, tree: [] })
        }
        if (url.pathname.endsWith('/git/trees/runs-tree')) {
          return body({ sha: 'runs-tree', tree: [{ path: '2026-10', type: 'tree', sha: 'm10' }] })
        }
        if (url.pathname.endsWith('/git/trees/m10')) {
          return body({ sha: 'm10', tree: [{ path: name, type: 'blob', sha: sha(text) }] })
        }
        return null
      }
    )
    const read = await readWorkNotes(config, memoryNoteCache())
    expect(read.notes.map((n) => n.id)).toEqual(['aaaa1111'])
    expect(seen.filter((s) => s.url.includes('/git/trees/'))).toHaveLength(3)
  })
})
