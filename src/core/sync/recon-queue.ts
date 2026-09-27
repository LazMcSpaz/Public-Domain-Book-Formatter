/**
 * Which books on the shelf still want their scan read, and a queue of them
 * that survives the tab.
 *
 * Recon is the free half of the work and the slow half: ten minutes to half an
 * hour a book in a browser. A shelf of five unread scans read one at a time is
 * a morning of coming back to the desk to press the next button, so the editor
 * queues them once and leaves them. Two things make that safe to walk away
 * from, and both are here as plain data so they can be tested:
 *
 *   - **What is owed is measured, not remembered.** A book is owed a reading
 *     when it has a scan on the shelf, is not finished, and has no handed-off
 *     reading beside it. Nothing about "I think I did that one" enters into it.
 *   - **The queue outlives the tab.** It is written down as it moves, so a
 *     reload, a crash or an update to the app offers the rest of it back
 *     rather than forgetting which books were waiting. The leaves inside a
 *     book are the recon checkpoint's business; this only knows books.
 *
 * Pure: no storage and no DOM.
 */
import type { ShelfAbout } from './shelf'

/** Whether a card's scan is one the browser can read. EPUBs are text already. */
export function hasReadableScan(about: Pick<ShelfAbout, 'scanPath'>): boolean {
  return !!about.scanPath && /\.pdf$/i.test(about.scanPath)
}

/**
 * The books whose scan has not been read, in shelf order.
 *
 * `readOnShelf` holds the keys of books with a handed-off reading beside them.
 */
export function booksNeedingRecon(
  books: readonly ShelfAbout[],
  readOnShelf: ReadonlySet<string>
): ShelfAbout[] {
  return books.filter((b) => hasReadableScan(b) && !b.complete && !readOnShelf.has(b.key))
}

export interface ReconQueueFailure {
  key: string
  reason: string
}

export interface ReconQueueState {
  /** Every book the queue was asked to read, in order. */
  keys: string[]
  /** Read and handed on. */
  done: string[]
  /** Given up on, with why. A failure does not stop the books after it. */
  failed: ReconQueueFailure[]
  startedAt: string
}

export function newReconQueue(keys: readonly string[], now = new Date()): ReconQueueState {
  return { keys: [...new Set(keys)], done: [], failed: [], startedAt: now.toISOString() }
}

/** The books still to read, in order. */
export function queueRemaining(state: ReconQueueState): string[] {
  const settled = new Set([...state.done, ...state.failed.map((f) => f.key)])
  return state.keys.filter((k) => !settled.has(k))
}

export function queueFinished(state: ReconQueueState, key: string): ReconQueueState {
  return state.done.includes(key) ? state : { ...state, done: [...state.done, key] }
}

export function queueFailed(state: ReconQueueState, key: string, reason: string): ReconQueueState {
  return {
    ...state,
    failed: [...state.failed.filter((f) => f.key !== key), { key, reason }]
  }
}

/** A stored queue, or null for anything that is not one. */
export function parseReconQueue(raw: unknown): ReconQueueState | null {
  const r = raw as Record<string, unknown> | null
  if (!r || typeof r !== 'object') return null
  const strings = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === 'string')
  if (!strings(r['keys']) || !strings(r['done']) || typeof r['startedAt'] !== 'string') return null
  if (!Array.isArray(r['failed'])) return null
  const failed = (r['failed'] as unknown[]).filter(
    (f): f is ReconQueueFailure =>
      !!f &&
      typeof (f as ReconQueueFailure).key === 'string' &&
      typeof (f as ReconQueueFailure).reason === 'string'
  )
  return { keys: r['keys'], done: r['done'], failed, startedAt: r['startedAt'] }
}
