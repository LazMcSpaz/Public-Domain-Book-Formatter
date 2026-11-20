/**
 * Banked cover looks: the arrangement, palette, faces and grounds a collection
 * shares, kept on this device so the next volume can start from them.
 *
 * Kept in a database of its own (`pdbf-covers`, one store keyed on the look's
 * own id), opened only here. Never in the app's main database (`run-store.ts`):
 * adding a store there means raising its version, which breaks every tab still
 * open on the old code until it is reloaded (see the note on `DB_VERSION`).
 * The cover branch first did exactly that; it moved here when it came to main.
 *
 * A look is keyed on its own id and not on any book, because a collection is
 * the thing that outlives the book it was first designed for. Uncapped for the
 * same reason as the interior's profiles: evicting one would silently break the
 * set it exists to hold together. Every call answers rather than throws.
 *
 * Browser-only.
 */
import { migrateSavedCoverLook, type SavedCoverLook } from '@core/cover'

export const COVERS_DB = 'pdbf-covers'
const COVERS_DB_VERSION = 1
const COVERS_STORE = 'looks'

function openCoversDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      request = indexedDB.open(COVERS_DB, COVERS_DB_VERSION)
    } catch {
      return resolve(null)
    }
    let answered = false
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(COVERS_STORE)) {
        db.createObjectStore(COVERS_STORE, { keyPath: 'id' })
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

/** One transaction on the looks: null when there is no database or anything fails. */
async function withLooks<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>
): Promise<T | null> {
  const db = await openCoversDb()
  if (!db) return null
  try {
    const tx = db.transaction(COVERS_STORE, mode)
    const result = await fn(tx.objectStore(COVERS_STORE))
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

/** Bank a cover look, replacing one with the same id. */
export async function saveCoverLook(look: SavedCoverLook): Promise<boolean> {
  const ok = await withLooks('readwrite', async (store) => {
    await promisify(store.put(look))
    return true
  })
  return ok === true
}

export async function loadCoverLook(id: string): Promise<SavedCoverLook | null> {
  const raw = await withLooks('readonly', (store) => promisify(store.get(id)))
  if (raw === null || raw === undefined) return null
  return migrateSavedCoverLook(raw)
}

export async function deleteCoverLook(id: string): Promise<void> {
  await withLooks('readwrite', (store) => promisify(store.delete(id)))
}

/** Every banked cover look, newest first: what the cover studio offers. */
export async function listCoverLooks(): Promise<SavedCoverLook[]> {
  const raw = await withLooks('readonly', (store) => promisify(store.getAll()))
  if (!raw) return []
  const out: SavedCoverLook[] = []
  for (const record of raw) {
    const look = migrateSavedCoverLook(record)
    if (look) out.push(look)
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}
