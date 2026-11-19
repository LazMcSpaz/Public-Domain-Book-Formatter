/**
 * Folding the waiting changes into a book, without losing what the app cannot read.
 *
 * A flush reads the book file off the shelf, folds the queue into its two
 * lists (the edits and the rulings) and writes the file back. It used to write
 * back **the app's own reading** of the file, and the app reads only the fields
 * it knows. Everything else went: measured on the shelf, a ruling sent from the
 * tablet to _Collected Manuscript Lectures_ would have taken the `why` and the
 * `finding` off 404 corrections the tools had written, and five reasons off
 * another book. Nothing said so; the commit message would have read "1 query
 * ruled on".
 *
 * So the file is now patched rather than rewritten. The shelf's own JSON is
 * kept as it was, and only the two lists change. In those, every item the
 * merge left alone is written back as the shelf held it, extra fields and all;
 * an item the queue added or replaced is the queue's. What the app knows is
 * still decided by the app (`mergeOutbox`), so the patch can never mean
 * something different from the merge: the result is read back and compared,
 * and an item that cannot be lined up with the shelf's copy falls back to the
 * app's own list for that one list, which is what every flush did before.
 *
 * Pure: text in, text out.
 */
import {
  BOOK_FILE_VERSION,
  CURRENT_SCHEMA_VERSION,
  parseBookFile,
  type BookFile
} from '@core/project'
import { mergeOutbox, type MergeResult, type OutboxEntry } from './outbox'

/** What folding the queue into a book file came to. */
export interface FoldedBookText {
  /**
   * The book file to write, or null when the queue changes nothing in it.
   *
   * Null with entries applied is a queue whose every change is already on
   * the shelf (a flush whose answer was lost, sent again): the entries can be
   * cleared and nothing needs writing, so no commit that says nothing is made.
   */
  json: string | null
  merged: MergeResult
  /** The book as the app reads it, from the text that was read. */
  file: BookFile
  /**
   * Whether every field the app does not know was kept. False only when an
   * item could not be lined up with the shelf's copy, and then only for the
   * list it is in.
   */
  keptEverything: boolean
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/**
 * Whether the shelf's copy of an item holds everything the app read off it.
 *
 * Every field the app kept must be there with the same value, at every depth;
 * fields the app did not keep may be there too. That is the relation between
 * a stored item and the app's reading of it, so it is the test for "this is
 * the shelf's copy of that item".
 */
export function holds(stored: unknown, read: unknown): boolean {
  if (read === undefined) return true
  if (read === null || typeof read !== 'object') return stored === read
  if (Array.isArray(read)) {
    return (
      Array.isArray(stored) &&
      stored.length === read.length &&
      read.every((item, i) => holds(stored[i], item))
    )
  }
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return false
  const s = stored as Record<string, unknown>
  return Object.entries(read as Record<string, unknown>).every(([k, v]) => holds(s[k], v))
}

/**
 * The shelf's own list with the merge applied.
 *
 * `parsed` is the app's reading of `stored`, and `merged` is what the merge
 * made of `parsed`: an item it left alone is the same object, which is how an
 * untouched item is told from one the queue added or replaced. Items the app
 * could not read at all stay where they were.
 *
 * Null when an item the app read cannot be found in the shelf's list.
 */
function keepStored<T>(stored: unknown, parsed: readonly T[], merged: readonly T[]): Json[] | null {
  const list: unknown[] = Array.isArray(stored) ? stored : []
  const claimed = new Set<number>()
  const storedOf = new Map<T, unknown>()
  let next = 0
  for (const item of parsed) {
    // In order first, which is how the app reads a list; a search only when
    // the app dropped something malformed and the two have drifted apart.
    let at = -1
    for (let i = next; i < list.length && at < 0; i++) {
      if (!claimed.has(i) && holds(list[i], item)) at = i
    }
    for (let i = 0; i < next && at < 0; i++) {
      if (!claimed.has(i) && holds(list[i], item)) at = i
    }
    if (at < 0) return null
    claimed.add(at)
    storedOf.set(item, list[at])
    next = at + 1
  }

  const out: unknown[] = merged.map((item) => (storedOf.has(item) ? storedOf.get(item) : item))
  // What the app could not read, put back after the item it followed.
  let cursor = -1
  list.forEach((item, i) => {
    if (claimed.has(i)) {
      const at = out.indexOf(item)
      if (at >= 0) cursor = at
      return
    }
    out.splice(cursor + 1, 0, item)
    cursor += 1
  })
  return out as Json[]
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Fold the queue into a book file as the shelf holds it.
 *
 * Throws only what `parseBookFile` throws: a file that is not a book file is
 * not one to write over.
 */
export function foldIntoBookText(
  text: string,
  queue: readonly OutboxEntry[],
  savedAt: string
): FoldedBookText {
  const file = parseBookFile(text)
  const merged = mergeOutbox({ edits: file.run.edits, rulings: file.run.rulings }, queue)
  const changes =
    !sameJson(merged.edits, file.run.edits) || !sameJson(merged.rulings, file.run.rulings)
  if (merged.applied.length === 0 || !changes) {
    return { json: null, merged, file, keptEverything: true }
  }

  const raw = JSON.parse(text) as { [key: string]: Json }
  const run = raw['run'] as { [key: string]: Json }
  const edits = keepStored(run['edits'], file.run.edits, merged.edits)
  const rulings = keepStored(run['rulings'], file.run.rulings, merged.rulings)
  run['edits'] = edits ?? (merged.edits as unknown as Json[])
  run['rulings'] = rulings ?? (merged.rulings as unknown as Json[])
  // What the app writes is read as the current shape. Every step between the
  // versions only adds (see `migrateSavedRun`), so an older file saying so is
  // true of it; and an app that predates the newest one refuses the file
  // rather than reading it and dropping what it does not know.
  run['schemaVersion'] = CURRENT_SCHEMA_VERSION
  raw['runSchema'] = CURRENT_SCHEMA_VERSION
  raw['version'] = BOOK_FILE_VERSION
  raw['savedAt'] = savedAt

  let json = JSON.stringify(raw, null, 2) + (text.endsWith('\n') ? '\n' : '')
  let keptEverything = edits !== null && rulings !== null
  // Read back as the app reads it, and held to the merge. A patch that read
  // differently from what the merge decided would be a change nobody made.
  const back = parseBookFile(json)
  if (!sameJson(back.run.edits, merged.edits) || !sameJson(back.run.rulings, merged.rulings)) {
    run['edits'] = merged.edits as unknown as Json[]
    run['rulings'] = merged.rulings as unknown as Json[]
    json = JSON.stringify(raw, null, 2) + (text.endsWith('\n') ? '\n' : '')
    keptEverything = false
  }
  return { json, merged, file, keptEverything }
}

/**
 * A book being opened, with what this device has not sent yet folded in.
 *
 * The shelf's copy is what a book opens from, and a mark waiting in the queue
 * is not in it: opening the book again, after a refresh, drew the page without
 * the mark the editor had just watched appear, although it was still waiting
 * to go up. So the queue is folded in exactly as a flush would fold it, and
 * what a flush could not take (a correction made against a passage that has
 * since changed on the shelf) is left out and reported by the flush, as now.
 */
export function withQueued(
  file: BookFile,
  queue: readonly OutboxEntry[]
): { file: BookFile; waiting: number; conflicts: number } {
  if (queue.length === 0) return { file, waiting: 0, conflicts: 0 }
  const merged = mergeOutbox({ edits: file.run.edits, rulings: file.run.rulings }, queue)
  return {
    file: { ...file, run: { ...file.run, edits: merged.edits, rulings: merged.rulings } },
    waiting: queue.length,
    conflicts: merged.conflicts.length
  }
}
