/**
 * Where a paid transcription is kept between sittings.
 *
 * IndexedDB rather than `localStorage`: a three-hundred-page book's
 * transcription is a megabyte or two of structured data, well past
 * localStorage's limit, and it should not be serialized through a string on
 * every write. The API key stays in localStorage where it was — it must never
 * travel with a book.
 *
 * Every call degrades to a no-op or `null` rather than throwing. Storage is
 * unavailable in private-browsing modes and can refuse a write when the disk
 * quota is reached; neither is a reason to lose the run the user is in the
 * middle of, and both are reasons to tell them plainly, which the caller does.
 *
 * Browser-only.
 */
import { migrateSavedRun, summarize, type SavedRun, type SavedRunSummary } from '@core/project'

const DB_NAME = 'pdbf'
const DB_VERSION = 1
const STORE = 'runs'

/**
 * How many books' transcriptions to keep, oldest evicted first.
 *
 * Not unbounded: this is the user's disk, and a run they will never reopen is
 * still a megabyte of it. Ten is more books than anyone has in flight at once
 * and small enough that the store never becomes a thing to worry about.
 */
const MAX_RUNS = 10

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      // Private browsing, or storage disabled entirely.
      return resolve(null)
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        // Eviction walks in save order, so it needs an index on it.
        store.createIndex('savedAt', 'savedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>
): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const tx = db.transaction(STORE, mode)
    const result = await fn(tx.objectStore(STORE))
    // Writes are only durable once the transaction commits, so wait for it
    // rather than resolving on the request and letting the tab close mid-flush.
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

/**
 * Store a finished run, evicting the oldest if the cap is reached.
 *
 * Returns false when it could not be written — a full quota, or a browser with
 * storage switched off. The caller says so rather than pretending the work is
 * safe, because the whole point of this module is that the user does not
 * discover the loss later.
 */
export async function saveRun(run: SavedRun): Promise<boolean> {
  const ok = await withStore('readwrite', async (store) => {
    await promisify(store.put(run))

    const keys = await promisify(store.index('savedAt').getAllKeys())
    // `getAllKeys` on the index comes back in ascending savedAt order, so the
    // excess at the front is the oldest.
    const excess = keys.length - MAX_RUNS
    for (let i = 0; i < excess; i++) {
      const key = keys[i]
      if (key !== undefined && key !== run.key) await promisify(store.delete(key))
    }
    return true
  })
  return ok === true
}

/**
 * The run stored for a file, or null when there isn't one.
 *
 * A record that fails to migrate is deleted rather than returned: it cannot be
 * restored and offering it again on every load would be a permanent, useless
 * question.
 */
export async function loadRun(key: string): Promise<SavedRun | null> {
  const raw = await withStore('readonly', (store) => promisify(store.get(key)))
  if (raw === null || raw === undefined) return null
  try {
    return migrateSavedRun(raw)
  } catch {
    void deleteRun(key)
    return null
  }
}

/** The summary of a stored run, for the question that offers it. */
export async function loadRunSummary(key: string): Promise<SavedRunSummary | null> {
  const run = await loadRun(key)
  return run ? summarize(run) : null
}

export async function deleteRun(key: string): Promise<void> {
  await withStore('readwrite', (store) => promisify(store.delete(key)))
}

/** Every stored run, newest first. */
export async function listRuns(): Promise<SavedRunSummary[]> {
  const raw = await withStore('readonly', (store) => promisify(store.getAll()))
  if (!raw) return []
  const runs: SavedRunSummary[] = []
  for (const record of raw) {
    try {
      runs.push(summarize(migrateSavedRun(record)))
    } catch {
      // A record this version cannot read is not worth listing.
    }
  }
  return runs.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}
