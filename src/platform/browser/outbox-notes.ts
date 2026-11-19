/**
 * What a flush says: every sentence the outbox shows the editor, in one place.
 *
 * A flush can end a dozen ways, and each one must say what happened, what is
 * still on the device and what to do next, in plain words: silence is the
 * failure mode. Kept apart from the requests in `shelf-outbox.ts` so the order
 * of the requests can be read without the wording in the way.
 *
 * Browser-only by where it lives; nothing here needs more than strings.
 */
import { isRuling, summarize, type OutboxConflict, type OutboxEntry } from '@core/sync'

/** "1 ruling", "3 marks", "4 changes". */
export function heldInWords(entries: readonly OutboxEntry[]): string {
  const n = entries.length
  const held = summarize(entries)
  const noun = held.rulings === n ? 'ruling' : held.marks === n ? 'mark' : 'change'
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** That the queue is untouched, and how it goes up next time. */
export function stillHere(entries: readonly OutboxEntry[]): string {
  const one = entries.length === 1
  return (
    `Your ${heldInWords(entries)} ${one ? 'is' : 'are'} still on this device and ` +
    `will go up on the next try: press “Send to the shelf”, or open the book again.`
  )
}

/** The commit message for what went up. */
export function commitMessageFor(applied: readonly OutboxEntry[]): string {
  const marks = applied.filter((entry) => entry.edit?.kind === 'highlight').length
  const rulings = applied.filter(isRuling).length
  if (rulings > 0 && rulings === applied.length) {
    return `${rulings} ${rulings === 1 ? 'query' : 'queries'} ruled on`
  }
  return marks > 0
    ? `${marks} passages marked while reading`
    : `${applied.length} changes from a reading session`
}

export function conflictNote(conflicts: readonly OutboxConflict[], repo: string): string {
  if (conflicts.length === 0) return ''
  const one = conflicts.length === 1
  return (
    `${conflicts.length} ${one ? 'change is' : 'changes are'} still on this device: the same ` +
    `passage was changed on ${repo} after ${one ? 'it was' : 'they were'} corrected here. ` +
    'Nothing has been overwritten either way.'
  )
}

/** The queue belongs to a book the shelf has never been given. */
export function notOnShelfNote(repo: string, waiting: number): string {
  return (
    `This book is not on ${repo} yet, so ${waiting} changes cannot go up. ` +
    'Save the whole book to the shelf first.'
  )
}

/** The book file would not parse, so it is not one to write over. */
export function unreadableNote(repo: string, err: unknown, queued: readonly OutboxEntry[]): string {
  return (
    `The book file on ${repo} could not be read ` +
    `(${err instanceof Error ? err.message : String(err)}), so nothing was written. ` +
    stillHere(queued)
  )
}

/** The read came back without rulings this device knows the shelf holds. */
export function missingNote(repo: string, missing: number, queued: readonly OutboxEntry[]): string {
  const one = missing === 1
  return (
    `${repo} answered with a copy of this book that is missing ` +
    `${missing} ruling${one ? '' : 's'} it already had, so nothing was ` +
    `written: sending would have deleted ${one ? 'it' : 'them'}. ` +
    stillHere(queued)
  )
}

/**
 * The fold could not keep every field the tools wrote (`foldIntoBookText`).
 *
 * Trying again from the device would stop at the same place, so this says to
 * ask a session rather than to press the button.
 */
export function notKeptNote(repo: string, queued: readonly OutboxEntry[]): string {
  const one = queued.length === 1
  return (
    `Nothing was written: sending would have changed parts of this book’s file on ${repo} ` +
    'that the tools wrote and this app cannot read. ' +
    `Your ${heldInWords(queued)} ${one ? 'is' : 'are'} still on this device, and nothing is ` +
    'lost. Ask a session to look at the book: trying again from here will stop at the same place.'
  )
}

/** The book kept changing on the shelf between the read and the write. */
export function movedNote(repo: string, queued: readonly OutboxEntry[]): string {
  return (
    `The book changed on ${repo} each time this tried to send (a session is probably saving it ` +
    'right now), so nothing was written over it. ' +
    stillHere(queued)
  )
}

/**
 * GitHub refused the write because the book changed after it was read (409).
 *
 * In place of `shelf.ts`'s words for a whole-book save, which offer to save
 * once more and write over the other copy: in a flush that would point the
 * editor at the one action that loses a session's work, when "Send to the
 * shelf" reads the shelf's new copy first and adds the changes to it.
 */
export const SAVED_ELSEWHERE =
  'Another device or a session saved this book a moment ago, so nothing was overwritten. ' +
  '“Send to the shelf” reads the shelf’s new copy first and adds your changes to it.'

/** What a flush that wrote says. */
export function sentNote(
  repo: string,
  sent: number,
  landedAnyway: boolean,
  changedSince: number,
  conflicts: readonly OutboxConflict[]
): string {
  return (
    `${sent} changes saved to ${repo}.` +
    (landedAnyway ? ' The shelf took them, although its answer was lost on the way back.' : '') +
    (changedSince > 0
      ? ` ${changedSince} ${changedSince === 1 ? 'was' : 'were'} changed again on this device ` +
        'while this was being sent; the newer version goes up next.'
      : '') +
    (conflicts.length > 0 ? ` ${conflictNote(conflicts, repo)}` : '')
  )
}
