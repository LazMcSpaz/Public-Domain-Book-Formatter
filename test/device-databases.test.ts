import { afterEach, describe, expect, it, vi } from 'vitest'
import { onNewerAppOpened, storedFileKeys } from '@platform/browser/run-store'
import {
  NOTES_DB,
  NOTES_STORE,
  databaseNotes,
  deviceNotesSize,
  forgetDeviceNotes,
  onNotesForgotten
} from '@platform/browser/note-store'

/**
 * How the two databases on the device are opened: the app's main one
 * (`run-store.ts`: runs, kept scans, readings, the outbox) and the Workroom's
 * own (`note-store.ts`: a copy of the status notes). A stand-in for IndexedDB
 * lets each event be fired by hand, in the order a busy browser can fire them;
 * `npm run check:device-db` does the same in a real one.
 */

type Handler = ((event?: unknown) => void) | null

interface FakeRequest {
  result?: unknown
  error?: { name: string } | null
  onupgradeneeded: Handler
  onsuccess: Handler
  onerror: Handler
  onblocked: Handler
}

/** IndexedDB as far as the opens go: every open recorded, every event fired by the test. */
function fakeIndexedDB(): { opens: { name: string; version?: number; request: FakeRequest }[] } {
  const opens: { name: string; version?: number; request: FakeRequest }[] = []
  vi.stubGlobal('indexedDB', {
    open: (name: string, version?: number) => {
      const request: FakeRequest = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null
      }
      opens.push(version === undefined ? { name, request } : { name, version, request })
      return request
    }
  })
  return { opens }
}

/** A request that answers on a later turn, as IndexedDB's do. */
function answer<T>(value: () => T): { result?: T; onsuccess?: () => void } {
  const request: { result?: T; onsuccess?: () => void } = {}
  setTimeout(() => {
    request.result = value()
    request.onsuccess?.()
  }, 0)
  return request
}

/** A connection whose stores hold `rows` (key, value); counts its closes. */
function fakeDb(rows: Record<string, [string, unknown][]>) {
  const db = {
    closed: 0,
    onversionchange: null as ((event: { newVersion: number | null }) => void) | null,
    created: [] as { name: string; keyPath: unknown }[],
    close: () => void db.closed++,
    objectStoreNames: { contains: (name: string) => name in rows },
    createObjectStore: (name: string, options: { keyPath: unknown }) => {
      db.created.push({ name, keyPath: options.keyPath })
      rows[name] = []
    },
    transaction: (name: string) => {
      // A closed connection refuses, as a real one does.
      if (db.closed > 0) throw new Error('InvalidStateError')
      const store = rows[name]
      if (!store) throw new Error('NotFoundError')
      const tx = {
        objectStore: () => ({
          getAllKeys: () => answer(() => store.map(([key]) => key)),
          getAll: () => answer(() => store.map(([, value]) => value)),
          count: () => answer(() => store.length),
          clear: () => answer(() => void store.splice(0))
        })
      }
      Object.defineProperty(tx, 'oncomplete', {
        set: (fn: () => void) => void setTimeout(fn, 0)
      })
      return tx
    }
  }
  return db
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the app’s main database', () => {
  it('is opened at its own version, 7, as on main', () => {
    const { opens } = fakeIndexedDB()
    void storedFileKeys()
    expect(opens).toEqual([{ name: 'pdbf', version: 7, request: expect.anything() }])
  })

  it('opens a database a newer build has raised, at the version it has', async () => {
    const { opens } = fakeIndexedDB()
    const keys = storedFileKeys()
    const first = opens[0]!.request
    first.error = { name: 'VersionError' }
    first.onerror?.()
    expect(opens).toHaveLength(2)
    expect(opens[1]).toEqual({ name: 'pdbf', request: expect.anything() })
    const db = fakeDb({ files: [['made-up-key', {}]] })
    opens[1]!.request.result = db
    opens[1]!.request.onsuccess?.()
    expect(await keys).toEqual(['made-up-key'])
    expect(db.closed).toBe(1)
  })

  it('closes a connection that succeeds after its open was answered “blocked”', async () => {
    const { opens } = fakeIndexedDB()
    const keys = storedFileKeys()
    const request = opens[0]!.request
    request.onblocked?.()
    expect(await keys).toEqual([])
    // The tab in the way closes, and the open carries on to a connection.
    const db = fakeDb({ files: [] })
    request.result = db
    request.onsuccess?.()
    expect(db.closed).toBe(1)
  })

  it('lets go at once when a newer version opens it, and tells the owner', async () => {
    const { opens } = fakeIndexedDB()
    const heard = vi.fn()
    const stop = onNewerAppOpened(heard)
    const keys = storedFileKeys()
    const db = fakeDb({ files: [['made-up-key', {}]] })
    opens[0]!.request.result = db
    opens[0]!.request.onsuccess?.()
    expect(db.onversionchange).not.toBeNull()
    db.onversionchange!({ newVersion: 8 })
    expect(db.closed).toBe(1)
    expect(heard).toHaveBeenCalledTimes(1)
    await keys
    // A database being deleted is not a newer version: closed, not announced.
    db.onversionchange!({ newVersion: null })
    expect(heard).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('the Workroom’s own database', () => {
  it('is a database of its own, at version 1, with one store of notes by sha', async () => {
    const { opens } = fakeIndexedDB()
    const size = deviceNotesSize()
    expect(opens.map((o) => [o.name, o.version])).toEqual([[NOTES_DB, 1]])
    expect(NOTES_DB).not.toBe('pdbf')
    const rows: Record<string, [string, unknown][]> = {}
    const db = fakeDb(rows)
    const request = opens[0]!.request
    request.result = db
    request.onupgradeneeded?.()
    expect(db.created).toEqual([{ name: NOTES_STORE, keyPath: 'sha' }])
    rows[NOTES_STORE]!.push(['abc', { sha: 'abc', text: 'made up' }])
    request.onsuccess?.()
    expect(await size).toEqual({ notes: 1, bytes: (3 + 7) * 2 })
  })

  it('keeps nothing when it is blocked, and closes a connection that comes late', async () => {
    const { opens } = fakeIndexedDB()
    const load = databaseNotes().load()
    const request = opens[0]!.request
    request.onblocked?.()
    expect(await load).toBeNull()
    const db = fakeDb({ [NOTES_STORE]: [] })
    request.result = db
    request.onsuccess?.()
    expect(db.closed).toBe(1)
  })

  it('lets go at once when another tab asks for a newer version of it', async () => {
    const { opens } = fakeIndexedDB()
    const load = databaseNotes().load()
    const db = fakeDb({ [NOTES_STORE]: [] })
    opens[0]!.request.result = db
    opens[0]!.request.onsuccess?.()
    db.onversionchange!({ newVersion: 2 })
    expect(db.closed).toBe(1)
    expect(await load).toBeNull()
  })

  it('is the only database Forget opens, and every open Workroom is told first', async () => {
    const { opens } = fakeIndexedDB()
    const told = vi.fn()
    const stop = onNotesForgotten(told)
    const forgot = forgetDeviceNotes()
    expect(told).toHaveBeenCalledTimes(1)
    const rows: Record<string, [string, unknown][]> = {
      [NOTES_STORE]: [
        ['abc', { sha: 'abc', text: 'made up' }],
        ['def', { sha: 'def', text: 'made up too' }]
      ]
    }
    opens[0]!.request.result = fakeDb(rows)
    opens[0]!.request.onsuccess?.()
    expect(await forgot).toBe(2)
    expect(rows[NOTES_STORE]).toEqual([])
    expect(opens.map((o) => o.name)).toEqual([NOTES_DB])
    stop()
  })
})
