/**
 * Sending the queue up: what was marked here, folded into what is up there.
 *
 * The reading pass happens on a tablet that is not always online, so the marks
 * are queued the instant they are made and this is what empties the queue. It
 * runs when the app is open and has a connection, and never at any other time —
 * iOS does not run a closed web app's code and Safari has no background sync,
 * so a promise that the queue "goes up later on its own" would be a lie the
 * editor only discovers when a reading is gone.
 *
 * The whole book file is fetched, the queue is merged into *its* edit list, and
 * it is written back once: one commit per flush rather than one per mark, and
 * anything done to the book from another session in the meantime survives.
 * `mergeOutbox` decides what may be folded in without asking and what has to be
 * reported instead; this module does the fetching, the writing and the
 * forgetting, and nothing else.
 *
 * Browser-only.
 */
import { bookPath, mergeOutbox, summarize, type OutboxConflict, type ShelfConfig } from '@core/sync'
import { parseBookFile, serializeBookFile, toBase64 } from '@core/project'
import { getText, putFile } from './shelf'
import { clearQueued, outboxFor } from './run-store'

/** What a flush did, in the words the interface has to be able to say. */
export interface FlushResult {
  /** Nothing was waiting; nothing was sent. */
  idle: boolean
  /** How many queued changes the shelf took. */
  sent: number
  /** The ones it could not, kept queued and named. */
  conflicts: OutboxConflict[]
  /** Still on this device after this, conflicts included. */
  waiting: number
  /** What to tell the editor. Always something; silence is the failure mode. */
  note: string
}

/**
 * One flush at a time per book, the next waiting rather than joining.
 *
 * Two overlapping flushes both read a non-empty queue and both write the file —
 * measured, not feared: `check-outbox` caught three writes of `book.json` for
 * two flushes, because the automatic flush after a change and a press of "Send
 * to the shelf" overlapped. Two writes of identical content is a commit that
 * says nothing on a shelf whose whole point is that git keeps every version,
 * and two writes of *different* content is a lost update, since each reads the
 * blob sha before the other has written.
 *
 * They are chained rather than deduplicated because a second call may have been
 * made for entries the first one had already read past; joining the first
 * promise would report success for work still sitting on the device.
 */
const inFlight = new Map<string, Promise<unknown>>()

export function flushOutbox(config: ShelfConfig, bookKey: string): Promise<FlushResult> {
  const after = (inFlight.get(bookKey) ?? Promise.resolve()).then(
    () => sendQueue(config, bookKey),
    () => sendQueue(config, bookKey)
  )
  inFlight.set(
    bookKey,
    after.catch(() => undefined)
  )
  return after
}

/**
 * Empty the queue for one book into its file on the shelf.
 *
 * Refuses rather than half-succeeds, and never throws away an entry the shelf
 * did not take.
 */
async function sendQueue(config: ShelfConfig, bookKey: string): Promise<FlushResult> {
  const queued = await outboxFor(bookKey)
  if (queued.length === 0) {
    return { idle: true, sent: 0, conflicts: [], waiting: 0, note: 'Nothing is waiting to go up.' }
  }

  // Offline is the ordinary case here rather than an error — the queue exists
  // for it. Said plainly, and every entry stays exactly where it is.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const held = summarize(queued)
    return {
      idle: false,
      sent: 0,
      conflicts: [],
      waiting: held.waiting,
      note: `${held.waiting} changes are on this device only — there is no connection yet.`
    }
  }

  const path = bookPath(bookKey)
  const text = await getText(config, path)
  if (text === null) {
    return {
      idle: false,
      sent: 0,
      conflicts: [],
      waiting: queued.length,
      // Not an error to swallow, and not a reason to drop anything: this queue
      // belongs to a book the shelf has never been given, and sending the whole
      // book is a different action with a different cost.
      note:
        `This book is not on ${config.repo} yet, so ${queued.length} changes cannot go up. ` +
        'Save the whole book to the shelf first.'
    }
  }

  const file = parseBookFile(text)
  const merged = mergeOutbox(file.run.edits, queued)
  if (merged.applied.length === 0) {
    return {
      idle: false,
      sent: 0,
      conflicts: merged.conflicts,
      waiting: queued.length,
      note: conflictNote(merged.conflicts, config.repo)
    }
  }

  const json = serializeBookFile({
    run: { ...file.run, edits: merged.edits },
    answers: file.answers,
    voice: file.voice,
    notesCheckpoint: file.notesCheckpoint,
    scan: file.scan,
    // The pictures were named by whoever pushed the book, and this must not
    // quietly re-inline them: a flush that turned a 788 KB book file back into
    // a 30 MB one would undo the reason a reading session is cheap to send at
    // all, and git would keep every version of it.
    imagePaths: file.imagePaths
  })
  // Read back before it is sent, exactly as the whole-book push does. A file
  // that will not parse looks like a saved book until the day it is needed.
  parseBookFile(json)

  const marks = merged.applied.filter((entry) => entry.edit.kind === 'highlight').length
  await putFile(
    config,
    path,
    toBase64(new TextEncoder().encode(json)),
    marks > 0
      ? `${marks} passages marked while reading`
      : `${merged.applied.length} changes from a reading session`
  )
  // Only after the shelf has answered, and only what it took. A conflicted
  // entry stays queued: it is a change the editor made that nobody has
  // accepted, and clearing it to tidy the queue is the one thing that would
  // make this channel worse than not having one.
  await clearQueued(merged.applied.map((entry) => entry.id))

  return {
    idle: false,
    sent: merged.applied.length,
    conflicts: merged.conflicts,
    waiting: merged.conflicts.length,
    note:
      `${merged.applied.length} changes saved to ${config.repo}.` +
      (merged.conflicts.length > 0 ? ` ${conflictNote(merged.conflicts, config.repo)}` : '')
  }
}

function conflictNote(conflicts: readonly OutboxConflict[], repo: string): string {
  if (conflicts.length === 0) return ''
  const one = conflicts.length === 1
  return (
    `${conflicts.length} ${one ? 'change is' : 'changes are'} still on this device: the same ` +
    `passage was changed on ${repo} after ${one ? 'it was' : 'they were'} corrected here. ` +
    'Nothing has been overwritten either way.'
  )
}
