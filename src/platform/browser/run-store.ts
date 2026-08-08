/**
 * Where a paid transcription is kept between sittings, and where a banked look
 * is kept between books.
 *
 * Two stores, one database, because they are the only two things that outlive a
 * session — but they outlive it for opposite reasons. A run is keyed to the
 * file it came from and capped, because it is expensive and only useful for
 * that book. A profile is keyed to itself and uncapped, because being reusable
 * across books is the whole point of it.
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
import {
  fileKey,
  keyMatchesFile,
  migrateSavedRun,
  summarize,
  type SavedRun,
  type SavedRunSummary
} from '@core/project'
import { migrateSavedProfile, type SavedStyleProfile } from '@core/style'

const DB_NAME = 'pdbf'
/**
 * v2 added the `profiles` store (banked looks, SPEC §7); v3 added `files`, the
 * source PDF itself. The upgrade handler below creates whichever stores are
 * missing rather than switching on the old version, so a database at any
 * version arrives complete.
 */
const DB_VERSION = 3
const STORE = 'runs'
const PROFILE_STORE = 'profiles'
const FILE_STORE = 'files'

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
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        // Keyed on the profile's own id: a look is not tied to a file the way a
        // run is — that is the entire point of banking one.
        db.createObjectStore(PROFILE_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        // Keyed by the run's key, so the scan and the transcription of it are
        // found by the same lookup and evicted by the same decision — but kept
        // in a *separate* store, because a scan is two orders of magnitude
        // larger and must never be able to fail the write that saves the run.
        db.createObjectStore(FILE_STORE, { keyPath: 'key' })
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
  fn: (store: IDBObjectStore) => Promise<T>,
  name: string = STORE
): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const tx = db.transaction(name, mode)
    const result = await fn(tx.objectStore(name))
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

/**
 * The run for a file the user has just opened, by exact identity if possible
 * and by name-and-size if not.
 *
 * The fallback matters more than it looks. The key carries the file's
 * modification time, and that changes when a PDF is re-downloaded, restored
 * from a backup or synced between devices — none of which change the book. A
 * run stranded that way is unreachable forever while still occupying the store,
 * and the user is asked to pay a second time for a transcription they already
 * own.
 *
 * Returns the run and the key it was found under, because the caller must go on
 * saving under *that* key rather than minting a second record for the same book.
 */
export async function findRunForFile(file: {
  name: string
  size: number
  lastModified: number
}): Promise<{ run: SavedRun; key: string } | null> {
  const exact = fileKey(file)
  const direct = await loadRun(exact)
  if (direct) return { run: direct, key: exact }

  const raw = await withStore('readonly', (store) => promisify(store.getAllKeys()))
  for (const key of raw ?? []) {
    if (typeof key !== 'string' || !keyMatchesFile(key, file)) continue
    const run = await loadRun(key)
    if (run) return { run, key }
  }
  return null
}

/** The summary of a stored run, for the question that offers it. */
export async function loadRunSummary(key: string): Promise<SavedRunSummary | null> {
  const run = await loadRun(key)
  return run ? summarize(run) : null
}

export async function deleteRun(key: string): Promise<void> {
  await withStore('readwrite', (store) => promisify(store.delete(key)))
}

// ---------------------------------------------------------------------------
// The scan itself
// ---------------------------------------------------------------------------

/**
 * Keep the source PDF, so reopening a book is a tap rather than an errand.
 *
 * Without this, resuming means finding the same file again in a phone's
 * downloads — and finding the *same* one, since a re-download changes the
 * modification time. The app knew the book was there and still made the user go
 * and fetch it.
 *
 * Deliberately best-effort and deliberately last. A scan is tens or hundreds of
 * megabytes where a transcription is one or two, so this is the write that hits
 * a quota, and it must never be able to take the paid work down with it. The
 * caller stores the run first and treats a `false` here as a convenience lost,
 * not as a failure.
 */
export async function saveSourceFile(key: string, file: File): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const ok = await withStore(
      'readwrite',
      async (store) => {
        await promisify(store.put({ key, name: file.name, lastModified: file.lastModified, bytes }))
        return true
      },
      FILE_STORE
    )
    return ok === true
  } catch {
    return false
  }
}

/**
 * The stored scan for a run, rebuilt as a `File`.
 *
 * The name and modification time are stored with the bytes so the rebuilt file
 * has the same identity it had when it was saved — otherwise `fileKey` would
 * mint a different key for it and the run it belongs to would be lost by the
 * act of reopening it.
 */
export async function loadSourceFile(key: string): Promise<File | null> {
  const raw = await withStore('readonly', (store) => promisify(store.get(key)), FILE_STORE)
  if (!raw || typeof raw !== 'object') return null
  const record = raw as { name?: unknown; lastModified?: unknown; bytes?: unknown }
  const part = record.bytes
  // Blob since the size-reading change; Uint8Array in anything written before.
  if (!(part instanceof Blob) && !(part instanceof Uint8Array)) return null
  const name = typeof record.name === 'string' ? record.name : 'book.pdf'
  const lastModified = typeof record.lastModified === 'number' ? record.lastModified : Date.now()
  return new File([part as BlobPart], name, { type: 'application/pdf', lastModified })
}

/**
 * What each stored scan takes up, without reading any of them.
 *
 * The `size` field is written alongside; where it is missing (a record from
 * before that change) the Blob's own `.size` answers, and only a Uint8Array
 * record has to be measured by its length — which is the one case that costs
 * memory, and the one that ages out.
 */
export async function storedFileSizes(): Promise<Map<string, number>> {
  const raw = await withStore('readonly', (store) => promisify(store.getAll()), FILE_STORE)
  const sizes = new Map<string, number>()
  for (const record of raw ?? []) {
    if (!record || typeof record !== 'object') continue
    const r = record as { key?: unknown; size?: unknown; bytes?: unknown }
    if (typeof r.key !== 'string') continue
    if (typeof r.size === 'number') sizes.set(r.key, r.size)
    else if (r.bytes instanceof Blob) sizes.set(r.key, r.bytes.size)
    else if (r.bytes instanceof Uint8Array) sizes.set(r.key, r.bytes.byteLength)
  }
  return sizes
}

/**
 * Forget every stored scan.
 *
 * What "don't keep scans" has to mean to be worth choosing. Without it the
 * setting was forward-only: someone switching it off on a phone to reclaim
 * space got none back, which is the single thing they wanted.
 */
export async function deleteAllSourceFiles(): Promise<number> {
  const keys = await storedFileKeys()
  for (const key of keys) await deleteSourceFile(key)
  return keys.length
}

/** Which runs have their scan stored, so intake only offers what it can open. */
export async function storedFileKeys(): Promise<string[]> {
  const keys = await withStore('readonly', (store) => promisify(store.getAllKeys()), FILE_STORE)
  return (keys ?? []).filter((k): k is string => typeof k === 'string')
}

export async function deleteSourceFile(key: string): Promise<void> {
  await withStore('readwrite', (store) => promisify(store.delete(key)), FILE_STORE)
}

// ---------------------------------------------------------------------------
// Banked looks (SPEC §7)
// ---------------------------------------------------------------------------

/**
 * Save a look, replacing one with the same id.
 *
 * Uncapped, unlike runs. A profile is a few hundred bytes rather than a
 * megabyte, and evicting one would silently break the series it was banked for
 * — which is the opposite of what it exists to do.
 */
export async function saveProfile(profile: SavedStyleProfile): Promise<boolean> {
  const ok = await withStore(
    'readwrite',
    async (store) => {
      await promisify(store.put(profile))
      return true
    },
    PROFILE_STORE
  )
  return ok === true
}

/** One banked look, or null when it is gone or unreadable. */
export async function loadProfile(id: string): Promise<SavedStyleProfile | null> {
  const raw = await withStore('readonly', (store) => promisify(store.get(id)), PROFILE_STORE)
  if (raw === null || raw === undefined) return null
  return migrateSavedProfile(raw)
}

export async function deleteProfile(id: string): Promise<void> {
  await withStore('readwrite', (store) => promisify(store.delete(id)), PROFILE_STORE)
}

/**
 * Every banked look, newest first — what the design gate offers.
 *
 * Whole records, not summaries. A profile is small, and the design gate needs
 * the style itself to render a preview the moment one is picked; fetching it
 * separately would make a pure question function wait on I/O.
 */
export async function listProfiles(): Promise<SavedStyleProfile[]> {
  const raw = await withStore('readonly', (store) => promisify(store.getAll()), PROFILE_STORE)
  if (!raw) return []
  const out: SavedStyleProfile[] = []
  for (const record of raw) {
    const profile = migrateSavedProfile(record)
    if (profile) out.push(profile)
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
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
