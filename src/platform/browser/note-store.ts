/**
 * The Workroom's copy of the status notes on this device, so reopening the
 * app fetches only the notes that changed while it was closed.
 *
 * Kept in a database of its own (`pdbf-workroom`, one store of notes keyed by
 * blob sha), opened only here. Never in the app's main database
 * (`run-store.ts`): that one holds the owner's runs, kept scans, readings and
 * the outbox of rulings and marks not yet sent, and adding a store to it means
 * raising its version, which breaks every tab still open on the old code until
 * it is reloaded. A copy that costs nothing to lose is not worth that risk.
 *
 * Never in `localStorage` either: that is shared with the settings the app
 * cannot work without (the shelf's token, the API key), and Safari on an
 * iPhone gives a site about 5 MB of it. A few months of notes would fill it,
 * and then the token could no longer be saved. The first version kept the
 * notes there; its key is removed at start-up (`forgetOldNoteCopy`).
 *
 * A copy and nothing else: a note lost here is fetched again from the shelf.
 * Every call answers rather than throws, and a device whose browser will not
 * open the database (some private browsing) keeps the notes in memory, for
 * this page only.
 *
 * Browser-only.
 */

/** Where a note cache keeps its copy between visits. */
export interface DeviceNotes {
  /** Every note kept, by sha; null when this device keeps nothing. */
  load(): Promise<Map<string, string> | null>
  /** Put these notes and remove every note not in `keep`; false when refused. */
  save(add: ReadonlyMap<string, string>, keep: ReadonlySet<string>): Promise<boolean>
  /** Be told when the owner forgets the copy (Settings, in any tab); the way to stop. */
  onForget?(listener: () => void): () => void
}

/** The Workroom's own database, and its one store. */
export const NOTES_DB = 'pdbf-workroom'
const NOTES_DB_VERSION = 1
export const NOTES_STORE = 'notes'

/** The key the first version kept the notes under, in `localStorage`. */
export const OLD_NOTES_KEY = 'pdbf.workroom.notes'

interface NoteRecord {
  sha: string
  text: string
}

function isNoteRecord(value: unknown): value is NoteRecord {
  const r = value as Partial<NoteRecord> | null
  return (
    typeof r === 'object' && r !== null && typeof r.sha === 'string' && typeof r.text === 'string'
  )
}

/**
 * The Workroom's database, or null when the browser will not open it. A late
 * success after "blocked" is closed at once, and a connection closes itself
 * when another tab asks for a newer version, so this page never holds one up.
 */
function openNotesDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      request = indexedDB.open(NOTES_DB, NOTES_DB_VERSION)
    } catch {
      return resolve(null)
    }
    let answered = false
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        db.createObjectStore(NOTES_STORE, { keyPath: 'sha' })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      if (answered) return db.close()
      answered = true
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => {
      answered = true
      resolve(null)
    }
    request.onblocked = () => {
      answered = true
      resolve(null)
    }
  })
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/** One transaction on the notes: null when there is no database or anything fails. */
async function withNotes<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>
): Promise<T | null> {
  const db = await openNotesDb()
  if (!db) return null
  try {
    const tx = db.transaction(NOTES_STORE, mode)
    const result = await fn(tx.objectStore(NOTES_STORE))
    if (mode === 'readwrite') {
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      })
    }
    return result
  } catch {
    return null
  } finally {
    db.close()
  }
}

/** The notes kept in the Workroom's database. */
export function databaseNotes(): DeviceNotes {
  return {
    load: async () => {
      const rows = await withNotes('readonly', (store) => promisify(store.getAll()))
      if (rows === null) return null
      const notes = new Map<string, string>()
      for (const row of rows) if (isNoteRecord(row)) notes.set(row.sha, row.text)
      return notes
    },
    save: async (add, keep) => {
      const ok = await withNotes('readwrite', async (store) => {
        for (const key of await promisify(store.getAllKeys())) {
          if (typeof key !== 'string' || !keep.has(key)) await promisify(store.delete(key))
        }
        for (const [sha, text] of add) {
          if (keep.has(sha)) await promisify(store.put({ sha, text } satisfies NoteRecord))
        }
        return true
      })
      return ok === true
    },
    onForget: onNotesForgotten
  }
}

/** How many notes this device keeps for the Workroom, and their size; null when it will not say. */
export async function deviceNotesSize(): Promise<{ notes: number; bytes: number } | null> {
  const rows = await withNotes('readonly', (store) => promisify(store.getAll()))
  if (rows === null) return null
  let notes = 0
  let bytes = 0
  for (const row of rows) {
    if (!isNoteRecord(row)) continue
    notes++
    // UTF-16 in the browser's own store, near enough for a figure to read.
    bytes += (row.sha.length + row.text.length) * 2
  }
  return { notes, bytes }
}

/**
 * Forget every note this device keeps for the Workroom; how many there were.
 * Only the Workroom's database is touched. Every open Workroom, in this tab or
 * another, is told first, so it drops its own copy and nothing it had queued
 * puts the notes back; each reads them from the shelf again.
 */
export async function forgetDeviceNotes(): Promise<number> {
  forgetOldNoteCopy()
  tellForgotten()
  const count = await withNotes('readwrite', async (store) => {
    const n = await promisify(store.count())
    await promisify(store.clear())
    return n
  })
  return count ?? 0
}

/** Remove the first version's copy from `localStorage`, where it could crowd out the settings. */
export function forgetOldNoteCopy(storage: Storage | null = localStore()): void {
  try {
    storage?.removeItem(OLD_NOTES_KEY)
  } catch {
    /* a store that refuses even this holds nothing of ours */
  }
}

function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Telling every open Workroom that the copy was forgotten
// ---------------------------------------------------------------------------

const forgetListeners = new Set<() => void>()
/** Other tabs hear through this; undefined until first needed, null where there is none. */
let channel: BroadcastChannel | null | undefined

function forgetChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel
  channel = null
  try {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null
    channel = new BroadcastChannel(NOTES_DB)
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === 'forgotten') for (const listener of forgetListeners) listener()
    }
  } catch {
    channel = null
  }
  return channel
}

/** Be told when the Workroom's copy is forgotten, here or in another tab; the way to stop. */
export function onNotesForgotten(listener: () => void): () => void {
  forgetChannel()
  forgetListeners.add(listener)
  return () => void forgetListeners.delete(listener)
}

function tellForgotten(): void {
  for (const listener of forgetListeners) listener()
  try {
    forgetChannel()?.postMessage('forgotten')
  } catch {
    /* another tab not told keeps its copy until it is reloaded: a few requests saved */
  }
}
