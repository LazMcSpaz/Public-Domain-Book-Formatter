/**
 * The Workroom's copy of the status notes on this device, so reopening the
 * app fetches only the notes that changed while it was closed.
 *
 * Kept in the app's own database (`run-store.ts`, the `workroom-notes` store),
 * one record per note keyed by its blob sha, and never in `localStorage`.
 * `localStorage` is shared with the settings the app cannot work without (the
 * shelf's token, the API key), and Safari on an iPhone gives a site about 5 MB
 * of it: a few months of notes would fill it, and then the token could no
 * longer be saved. The first version kept the notes there; its key is removed
 * at start-up (`forgetOldNoteCopy`).
 *
 * A copy and nothing else: a note lost here is fetched again from the shelf.
 * Every call answers rather than throws, and a device with no database (some
 * private browsing) keeps the notes for this page only.
 *
 * Browser-only.
 */
import { WORKROOM_NOTES_STORE, promisify, withStore } from './run-store'

/** Where a note cache keeps its copy between visits. */
export interface DeviceNotes {
  /** Every note kept, by sha; null when this device keeps nothing. */
  load(): Promise<Map<string, string> | null>
  /** Put these notes and remove every note not in `keep`; false when refused. */
  save(add: ReadonlyMap<string, string>, keep: ReadonlySet<string>): Promise<boolean>
}

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

/** The notes kept in the app's database. */
export function databaseNotes(): DeviceNotes {
  return {
    load: async () => {
      const rows = await withStore(
        'readonly',
        (store) => promisify(store.getAll()),
        WORKROOM_NOTES_STORE
      )
      if (rows === null) return null
      const notes = new Map<string, string>()
      for (const row of rows) if (isNoteRecord(row)) notes.set(row.sha, row.text)
      return notes
    },
    save: async (add, keep) => {
      const ok = await withStore(
        'readwrite',
        async (store) => {
          for (const key of await promisify(store.getAllKeys())) {
            if (typeof key !== 'string' || !keep.has(key)) await promisify(store.delete(key))
          }
          for (const [sha, text] of add) {
            if (keep.has(sha)) await promisify(store.put({ sha, text } satisfies NoteRecord))
          }
          return true
        },
        WORKROOM_NOTES_STORE
      )
      return ok === true
    }
  }
}

/** How many notes this device keeps for the Workroom, and their size; null when it will not say. */
export async function deviceNotesSize(): Promise<{ notes: number; bytes: number } | null> {
  const rows = await withStore(
    'readonly',
    (store) => promisify(store.getAll()),
    WORKROOM_NOTES_STORE
  )
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

/** Forget every note this device keeps for the Workroom; how many there were. */
export async function forgetDeviceNotes(): Promise<number> {
  forgetOldNoteCopy()
  const count = await withStore(
    'readwrite',
    async (store) => {
      const n = await promisify(store.count())
      await promisify(store.clear())
      return n
    },
    WORKROOM_NOTES_STORE
  )
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
