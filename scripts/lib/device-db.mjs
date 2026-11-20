/**
 * The device's databases, for the browser checks (`check-device-db.mjs`,
 * `workroom-checks.mjs`): the app's main database as `main` builds it, seeded
 * with a made-up record in every store, and a whole picture of every database
 * on the device, to compare before and after.
 *
 * The main database (`pdbf`, `run-store.ts`) holds the owner's runs, kept
 * scans, readings and the outbox of rulings and marks not yet sent. Its shape
 * is written out here, not imported from the app, so a change on a branch
 * cannot move what the checks compare against. Every record is made up.
 */

export const MAIN_DB = 'pdbf'
/** The main database's version on `main`. */
export const MAIN_VERSION = 7
/** The Workroom's own database (`note-store.ts`). */
export const WORKROOM_DB = 'pdbf-workroom'

/** Every store of the main database at version 7, its key, and its indexes, as on `main`. */
export const MAIN_STORES = {
  runs: { keyPath: 'key', indexes: { savedAt: 'savedAt' } },
  profiles: { keyPath: 'id', indexes: {} },
  files: { keyPath: 'key', indexes: {} },
  recon: { keyPath: 'key', indexes: { savedAt: 'savedAt' } },
  batches: { keyPath: 'key', indexes: {} },
  notes: { keyPath: 'key', indexes: {} },
  outbox: { keyPath: 'id', indexes: { bookKey: 'bookKey' } }
}

const BOOK = 'made-up-book.pdf|2026|7'

/** One made-up record in each store; `{ blob: text }` is stored as a Blob, as a kept scan is. */
export function madeUpRecords() {
  return {
    runs: [{ key: BOOK, savedAt: '2026-11-01T09:00:00.000Z', fileName: 'made-up-book.pdf' }],
    profiles: [{ id: 'made-up-look', name: 'A made-up look', savedAt: '2026-11-02T09:00:00.000Z' }],
    files: [
      {
        key: BOOK,
        name: 'made-up-book.pdf',
        lastModified: 7,
        size: 18,
        bytes: { blob: 'made-up scan bytes' }
      }
    ],
    recon: [
      {
        key: BOOK,
        savedAt: '2026-11-03T09:00:00.000Z',
        leaves: [{ index: 0, words: ['made', 'up'] }]
      }
    ],
    batches: [{ key: BOOK, batchId: 'msgbatch_made_up', submittedAt: '2026-11-04T09:00:00.000Z' }],
    notes: [{ key: BOOK, chunks: 2, notes: ['A made-up note.'] }],
    outbox: [
      {
        id: `${BOOK}::ruling::q1`,
        bookKey: BOOK,
        madeAt: '2026-11-05T09:00:00.000Z',
        kind: 'ruling'
      }
    ]
  }
}

/**
 * Seed the main database on the page's origin: created at `version` with
 * `stores` (main's, unless told otherwise) where it is missing or older, and
 * `records` put in. A database already at `version` or newer keeps its
 * version and gains only the records.
 */
export function seedMainDatabase(
  page,
  { version = MAIN_VERSION, stores = MAIN_STORES, records = madeUpRecords() } = {}
) {
  return page.evaluate(
    async ({ name, version, stores, records }) => {
      const asked = (request) =>
        new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      const known = (await indexedDB.databases()).find((d) => d.name === name)
      const request = indexedDB.open(name, Math.max(version, known?.version ?? 0))
      request.onupgradeneeded = () => {
        const db = request.result
        for (const [store, shape] of Object.entries(stores)) {
          if (db.objectStoreNames.contains(store)) continue
          const made = db.createObjectStore(store, { keyPath: shape.keyPath })
          for (const [index, path] of Object.entries(shape.indexes)) made.createIndex(index, path)
        }
      }
      const db = await asked(request)
      for (const [store, rows] of Object.entries(records)) {
        if (!db.objectStoreNames.contains(store)) continue
        const tx = db.transaction(store, 'readwrite')
        for (const row of rows) {
          const value = { ...row }
          for (const [field, v] of Object.entries(value)) {
            if (v && typeof v === 'object' && typeof v.blob === 'string') {
              value[field] = new Blob([v.blob], { type: 'application/pdf' })
            }
          }
          tx.objectStore(store).put(value)
        }
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve
          tx.onerror = () => reject(tx.error)
        })
      }
      db.close()
    },
    { name: MAIN_DB, version, stores, records }
  )
}

/**
 * Every database on the page's origin: its version, and each store's key,
 * indexes and records (a Blob read as its text). Opening one here never
 * changes its version.
 */
export function deviceSnapshot(page) {
  return page.evaluate(async () => {
    const asked = (request) =>
      new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const plain = async (value) => {
      if (value instanceof Blob) return { blob: await value.text() }
      if (ArrayBuffer.isView(value)) {
        return {
          bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
        }
      }
      if (Array.isArray(value)) return Promise.all(value.map(plain))
      if (value && typeof value === 'object') {
        const out = {}
        for (const key of Object.keys(value).sort()) out[key] = await plain(value[key])
        return out
      }
      return value
    }
    const device = {}
    for (const { name } of await indexedDB.databases()) {
      const db = await asked(indexedDB.open(name))
      const stores = {}
      for (const storeName of [...db.objectStoreNames].sort()) {
        const store = db.transaction(storeName).objectStore(storeName)
        const indexes = {}
        for (const index of [...store.indexNames].sort()) {
          const i = store.index(index)
          indexes[index] = { keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry }
        }
        stores[storeName] = {
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
          indexes,
          records: await plain(await asked(store.getAll()))
        }
      }
      device[name] = { version: db.version, stores }
      db.close()
    }
    return device
  })
}

/** What changed in one database between two snapshots, in words; empty when nothing did. */
export function changesIn(name, before, after) {
  const was = before[name]
  const now = after[name]
  if (!was || !now) return [`${name} ${was ? 'is gone' : 'was not there before'}`]
  const changes = []
  if (was.version !== now.version) changes.push(`${name} version ${was.version} → ${now.version}`)
  for (const store of new Set([...Object.keys(was.stores), ...Object.keys(now.stores)])) {
    const a = was.stores[store]
    const b = now.stores[store]
    if (!a || !b) {
      changes.push(`${name} store ${store} ${a ? 'removed' : 'added'}`)
      continue
    }
    const shape = (s) => JSON.stringify([s.keyPath, s.autoIncrement, s.indexes])
    if (shape(a) !== shape(b)) changes.push(`${name} store ${store} reshaped`)
    if (JSON.stringify(a.records) !== JSON.stringify(b.records)) {
      changes.push(
        `${name} store ${store}: ${a.records.length} → ${b.records.length} records, changed`
      )
    }
  }
  return changes
}

/** How many records each store of a snapshot's database holds, for a check's line. */
export function countsOf(snapshot, name) {
  const db = snapshot[name]
  if (!db) return `${name}: none`
  const stores = Object.entries(db.stores).map(([s, v]) => `${s} ${v.records.length}`)
  return `${name} v${db.version}: ${stores.join(', ')}`
}
