import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceNoteCache, readWorkNotes } from '@platform/browser/shelf-notes'
import { OLD_NOTES_KEY, forgetOldNoteCopy, type DeviceNotes } from '@platform/browser/note-store'
import { notesFailure } from '@platform/browser/notes-failure'
import { NoAnswer } from '@platform/browser/shelf-fetch'
import { ShelfError } from '@platform/browser/shelf'
import { blobsIn, config, note, shelfOf, stubGitHub } from './fixtures/notes-github'

/**
 * The Workroom's copy of the notes kept on the device. It lives in the app's
 * database (`note-store.ts`), never in `localStorage`, which holds the shelf's
 * token and the API key and is small on a phone: a cache that filled it once
 * stopped the token being saved. The database itself is exercised in a real
 * browser by `npm run check:workroom`; here a stand-in for it shows what the
 * cache asks of it. The books are made up.
 */

/**
 * A stand-in for the database: notes by sha, every write counted, and
 * `forget()` doing what Settings' button does (empty it, tell every cache).
 */
function fakeDevice(): DeviceNotes & {
  kept: Map<string, string>
  saves: number
  forget: () => void
} {
  const listeners = new Set<() => void>()
  const device = {
    kept: new Map<string, string>(),
    saves: 0,
    load: () => Promise.resolve(new Map(device.kept)),
    save: (add: ReadonlyMap<string, string>, keep: ReadonlySet<string>) => {
      device.saves++
      for (const sha of [...device.kept.keys()]) if (!keep.has(sha)) device.kept.delete(sha)
      for (const [sha, text] of add) if (keep.has(sha)) device.kept.set(sha, text)
      return Promise.resolve(true)
    },
    onForget: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    forget: () => {
      for (const listener of listeners) listener()
      device.kept.clear()
    }
  }
  return device
}

/** A `localStorage` that records every write. */
function recordingStorage(): Storage & { writes: string[] } {
  const items = new Map<string, string>()
  const writes: string[] = []
  return {
    writes,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(k)
      items.set(k, v)
    },
    removeItem: (k: string) => void items.delete(k),
    clear: () => items.clear(),
    key: (i: number) => [...items.keys()][i] ?? null,
    get length() {
      return items.size
    }
  }
}

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
  vi.unstubAllGlobals()
})

describe('the copy of the notes kept on the device', () => {
  it('goes to the database, never to localStorage', async () => {
    const storage = recordingStorage()
    vi.stubGlobal('localStorage', storage)
    const device = fakeDevice()
    stubGitHub(() => shelfOf(note('aaaa1111', null), note('bbbb2222', null)))
    const cache = deviceNoteCache(device)
    await readWorkNotes(config, cache)
    await cache.saved()
    expect(device.kept.size).toBe(2)
    expect(storage.writes).toEqual([])
  })

  it('serves a reopened app from the device, trimmed to what the shelf lists', async () => {
    const device = fakeDevice()
    const shelf = shelfOf(note('aaaa1111', null), note('bbbb2222', null))
    const seen = stubGitHub(() => shelf)
    const first = deviceNoteCache(device)
    await readWorkNotes(config, first)
    await first.saved()
    seen.length = 0
    const reopened = deviceNoteCache(device)
    const read = await readWorkNotes(config, reopened)
    expect(blobsIn(seen)).toHaveLength(0)
    expect(read.notes).toHaveLength(2)
    shelf.delete([...shelf.keys()][0]!)
    await readWorkNotes(config, reopened)
    await reopened.saved()
    expect(device.kept.size).toBe(1)
  })

  it('writes only after a read that changed something', async () => {
    const device = fakeDevice()
    stubGitHub(() => shelfOf(note('aaaa1111', null)))
    const cache = deviceNoteCache(device)
    await readWorkNotes(config, cache)
    await readWorkNotes(config, cache)
    await readWorkNotes(config, cache)
    await cache.saved()
    expect(device.saves).toBe(1)
  })

  it('never lets a refused write break the screen, and tries it again after the next read', async () => {
    const device = fakeDevice()
    let refuse = true
    const save = device.save
    device.save = (add, keep) =>
      refuse ? Promise.reject(new Error('QuotaExceededError')) : save(add, keep)
    stubGitHub(() => shelfOf(note('aaaa1111', null)))
    const cache = deviceNoteCache(device)
    const read = await readWorkNotes(config, cache)
    await cache.saved()
    expect(read.notes).toHaveLength(1)
    expect(device.kept.size).toBe(0)
    refuse = false
    const again = await readWorkNotes(config, cache)
    await cache.saved()
    expect(again.notes).toHaveLength(1)
    expect(device.kept.size).toBe(1)
  })

  it('never waits on a write that does not finish', async () => {
    const device = fakeDevice()
    device.save = () => new Promise<boolean>(() => {})
    stubGitHub(() => shelfOf(note('aaaa1111', null)))
    const read = await readWorkNotes(config, deviceNoteCache(device))
    expect(read.notes).toHaveLength(1)
  })

  it('keeps the notes for this page only on a device with no database', async () => {
    const device = fakeDevice()
    device.load = () => Promise.resolve(null)
    const shelf = shelfOf(note('aaaa1111', null))
    const seen = stubGitHub(() => shelf)
    const cache = deviceNoteCache(device)
    await readWorkNotes(config, cache)
    seen.length = 0
    const again = await readWorkNotes(config, cache)
    await cache.saved()
    expect(again.notes).toHaveLength(1)
    expect(blobsIn(seen)).toHaveLength(0)
    expect(device.saves).toBe(0)
  })

  it('reads the shelf when the device cannot even be read', async () => {
    const device = fakeDevice()
    device.load = () => Promise.reject(new Error('the database is broken'))
    stubGitHub(() => shelfOf(note('aaaa1111', null)))
    const read = await readWorkNotes(config, deviceNoteCache(device))
    expect(read.notes).toHaveLength(1)
  })

  it('drops the page’s copy when the owner forgets the device copy, and reads the shelf again', async () => {
    const device = fakeDevice()
    const seen = stubGitHub(() => shelfOf(note('aaaa1111', null), note('bbbb2222', null)))
    const cache = deviceNoteCache(device)
    await readWorkNotes(config, cache)
    await cache.saved()
    device.forget()
    seen.length = 0
    const again = await readWorkNotes(config, cache)
    await cache.saved()
    expect(again.notes).toHaveLength(2)
    expect(blobsIn(seen)).toHaveLength(2)
    expect(device.kept.size).toBe(2)
  })

  it('lets no write queued before the forget put the notes back', async () => {
    const device = fakeDevice()
    const save = device.save
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    // The first write lands at once and answers late, as a slow commit does.
    device.save = (add, keep) => {
      const done = save(add, keep)
      return device.saves === 1 ? gate.then(() => done) : done
    }
    const shelf = shelfOf(note('aaaa1111', null))
    stubGitHub(() => shelf)
    const cache = deviceNoteCache(device)
    await readWorkNotes(config, cache)
    const late = note('bbbb2222', null)
    for (const [path, text] of shelfOf(late)) shelf.set(path, text)
    await readWorkNotes(config, cache)
    device.forget()
    release()
    await cache.saved()
    expect(device.saves).toBe(1)
    expect(device.kept.size).toBe(0)
  })

  it('shows every note from a read that was on its way when the copy was forgotten', async () => {
    const device = fakeDevice()
    stubGitHub(() =>
      shelfOf(note('aaaa1111', null), note('bbbb2222', null), note('cccc3333', null))
    )
    // The third note answers late, and the owner forgets the copy meanwhile,
    // after the first two are already in the page's copy.
    const github = globalThis.fetch
    let blobs = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/git/blobs/') && ++blobs === 3) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        device.forget()
      }
      return github(input, init)
    }) as typeof fetch
    const read = await readWorkNotes(config, deviceNoteCache(device))
    expect(blobs).toBe(3)
    expect(read.notes).toHaveLength(3)
  })

  it('removes the first version’s copy from localStorage, and nothing else', () => {
    const storage = recordingStorage()
    storage.setItem(OLD_NOTES_KEY, JSON.stringify({ abc: 'a note' }))
    storage.setItem('pdbf.shelf', '{"repo":"someone/shelf"}')
    forgetOldNoteCopy(storage)
    expect(storage.getItem(OLD_NOTES_KEY)).toBeNull()
    expect(storage.getItem('pdbf.shelf')).not.toBeNull()
    expect(() => forgetOldNoteCopy(null)).not.toThrow()
  })
})

describe('a failed read, in words', () => {
  it('says a rejected token, never “could not reach the shelf”, beside the light', () => {
    const failure = notesFailure(new ShelfError('That token was rejected by GitHub.', 401))
    expect(failure.light).toBe('the shelf refused the token')
    expect(failure.band).toMatch(/token was rejected/u)
  })

  it('says no answer as that', () => {
    const failure = notesFailure(new NoAnswer('Failed to fetch'))
    expect(failure.light).toBe('could not reach the shelf')
    expect(failure.band).toMatch(/got no answer/u)
  })

  it('names a missing branch beside the light too', async () => {
    stubGitHub(() => new Map())
    const err = await readWorkNotes({ ...config, branch: 'mian' }, deviceNoteCache(null)).catch(
      (e: unknown) => e
    )
    expect(notesFailure(err).light).toBe('no such branch on the shelf')
  })
})
