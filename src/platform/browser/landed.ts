/**
 * Which rulings this device has seen the shelf accept, per book.
 *
 * The record `rulingsMissingFrom` is checked against. It exists because a flush
 * writes the whole rulings list back over whatever it read, so a stale read
 * deletes work — and the only thing on the device that can say a read *was*
 * stale is a memory of what the shelf held last time it answered.
 *
 * `localStorage`, not the run store, for the reason the review verdicts are
 * there: this is a few hundred bytes of short keys that cost *time* to rebuild
 * rather than money, it is rewritten on every flush, and putting it in the
 * record that holds megabytes of transcription would make a long book stutter
 * on every press of Next.
 *
 * **Losing it is safe and must stay safe.** An empty record makes the guard say
 * nothing, which is exactly the behaviour that shipped before it — so private
 * browsing, a cleared site, or a second device simply gets no net, never a
 * refusal it cannot clear.
 *
 * Browser-only.
 */

const PREFIX = 'pdbf.landed.'

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Storage throws in some private-browsing modes; degrade rather than crash.
    return null
  }
}

/** The ruling keys this device last saw on the shelf for one book. */
export function landedFor(bookKey: string): string[] {
  const raw = store()?.getItem(PREFIX + bookKey)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/**
 * Record what the shelf demonstrably holds, after it has answered.
 *
 * Replaces rather than accumulates: the argument for the whole record is that
 * it describes the file the shelf just took, and a key that has somehow left
 * that file has to be able to leave this too, or a book would refuse to flush
 * for ever over a ruling nobody can produce.
 */
export function rememberLanded(bookKey: string, keys: readonly string[]): void {
  try {
    store()?.setItem(PREFIX + bookKey, JSON.stringify([...keys]))
  } catch {
    // A full or refused quota costs the net, not the flush.
  }
}

/** Forget one book's record — for a device that is being cleared of it. */
export function forgetLanded(bookKey: string): void {
  try {
    store()?.removeItem(PREFIX + bookKey)
  } catch {
    /* nothing to do */
  }
}
