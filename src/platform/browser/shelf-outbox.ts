/**
 * Sending the queue up: what was marked here, folded into what is up there.
 *
 * The reading pass happens on a tablet that is not always online, so the marks
 * are queued the instant they are made and this is what empties the queue. It
 * runs when the app is open and has a connection, and never at any other time:
 * iOS does not run a closed web app's code and Safari has no background sync,
 * so a promise that the queue "goes up later on its own" would be a lie the
 * editor only discovers when a reading is gone.
 *
 * The whole book file is fetched, the queue is folded into *its* two lists,
 * and it is written back once: one commit per flush rather than one per mark,
 * and anything done to the book from another session in the meantime survives.
 * `mergeOutbox` decides what may be folded in without asking and what has to be
 * reported instead, and `foldIntoBookText` writes the shelf's own file back
 * with only those two lists changed, so a field the app cannot read is never
 * dropped by a ruling from the tablet. This module does the fetching, the
 * writing and the forgetting, and nothing else.
 *
 * **A failure says which request failed** (`attempt`, in `shelf-attempt.ts`):
 * what it was doing, how much it sent, how long the browser waited and the
 * browser's own words. After a write that got no answer it looks twice more:
 * whether the shelf now holds what was sent (the write landed and only the
 * answer was lost, which counts as sent), and whether reading still works,
 * which tells a dropped connection from a write that was refused or cut off.
 * Nothing leaves the queue until the shelf has it.
 *
 * Browser-only.
 */
import {
  aboutPath,
  bookPath,
  foldIntoBookText,
  isRuling,
  landedRulings,
  rulingsMissingFrom,
  summarize,
  withQueued,
  type FoldedBookText,
  type OutboxConflict,
  type OutboxEntry,
  type ShelfConfig
} from '@core/sync'
import { toBase64, type BookFile } from '@core/project'
import { getText, putFile, putWithSha, shaOf, shelfDirFor } from './shelf'
import { clearQueued, outboxFor } from './run-store'
import { landedFor, rememberLanded } from './landed'
import { catalogueCard } from './shelf-save'
import { attempt, blobSha, ShelfStepError, type ShelfFailure } from './shelf-attempt'

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
  /** The request that failed, when one did. */
  failure?: ShelfFailure
}

/**
 * One flush at a time per book, the next waiting rather than joining.
 *
 * Two overlapping flushes both read a non-empty queue and both write the file:
 * measured, not feared. `check-outbox` caught three writes of `book.json` for
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
 * A book being opened from the shelf, with this device's waiting changes in it.
 *
 * Without this a mark still waiting to go up vanished from the page the next
 * time the book was opened (after a refresh, say), because the page was drawn
 * from the shelf's copy alone. It was still queued; it just could not be seen,
 * which to the editor is the same as lost.
 */
export async function withQueuedChanges(
  file: BookFile
): Promise<{ file: BookFile; waiting: number }> {
  const { file: folded, waiting } = withQueued(file, await outboxFor(file.run.key))
  return { file: folded, waiting }
}

/** "1 ruling", "3 marks", "4 changes". */
function heldInWords(entries: readonly OutboxEntry[]): string {
  const n = entries.length
  const held = summarize(entries)
  const noun = held.rulings === n ? 'ruling' : held.marks === n ? 'mark' : 'change'
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function stillHere(entries: readonly OutboxEntry[]): string {
  const one = entries.length === 1
  return (
    `Your ${heldInWords(entries)} ${one ? 'is' : 'are'} still on this device and ` +
    `will go up on the next try: press “Send to the shelf”, or open the book again.`
  )
}

/**
 * Empty the queue for one book into its file on the shelf.
 *
 * Refuses rather than half-succeeds, and never throws away an entry the shelf
 * did not take. A request that fails comes back as a result with a note that
 * names it, not as a throw: the queue is untouched either way.
 */
async function sendQueue(config: ShelfConfig, bookKey: string): Promise<FlushResult> {
  const queued = await outboxFor(bookKey)
  if (queued.length === 0) {
    return { idle: true, sent: 0, conflicts: [], waiting: 0, note: 'Nothing is waiting to go up.' }
  }

  // Offline is the ordinary case here rather than an error: the queue exists
  // for it. Said plainly, and every entry stays exactly where it is.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const held = summarize(queued)
    return {
      idle: false,
      sent: 0,
      conflicts: [],
      waiting: held.waiting,
      note: `${held.waiting} changes are on this device only: there is no connection yet.`
    }
  }

  try {
    return await sendTo(config, bookKey, queued)
  } catch (err) {
    if (!(err instanceof ShelfStepError)) throw err
    return {
      idle: false,
      sent: 0,
      conflicts: [],
      waiting: queued.length,
      failure: err.failure,
      note: `${err.message} ${stillHere(queued)}`
    }
  }
}

async function sendTo(
  config: ShelfConfig,
  bookKey: string,
  queued: OutboxEntry[]
): Promise<FlushResult> {
  const dir = await attempt('finding the book’s folder on the shelf', null, () =>
    shelfDirFor(config, bookKey)
  )
  const path = bookPath(bookKey, dir)
  const text = await attempt('reading the book from the shelf', null, () => getText(config, path))
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

  let folded: FoldedBookText
  try {
    folded = foldIntoBookText(text, queued, new Date().toISOString())
  } catch (err) {
    return {
      idle: false,
      sent: 0,
      conflicts: [],
      waiting: queued.length,
      note:
        `The book file on ${config.repo} could not be read ` +
        `(${err instanceof Error ? err.message : String(err)}), so nothing was written. ` +
        stillHere(queued)
    }
  }
  const { merged, file } = folded

  // The read has to be *current*, not merely successful.
  //
  // What is written back is the whole rulings list folded over what was read,
  // so a file that arrived short does not miss a ruling, it deletes it, and
  // the queue is cleared afterwards, which makes the deletion permanent and
  // silent. Measured on a real book: two flushes inside GitHub's own
  // `max-age=60` window each took a ruling off the shelf, one of them for good.
  //
  // Refusing costs a minute and keeps every entry queued; writing costs the
  // editor work they will not know is gone. That asymmetry is the whole
  // argument, and it is why this stops rather than repairing: the device knows
  // a ruling is *missing*, not what it said.
  const missing = rulingsMissingFrom(landedFor(bookKey), {
    edits: file.run.edits,
    rulings: file.run.rulings
  })
  if (missing.length > 0) {
    const one = missing.length === 1
    return {
      idle: false,
      sent: 0,
      conflicts: [],
      waiting: queued.length,
      note:
        `${config.repo} answered with a copy of this book that is missing ` +
        `${missing.length} ruling${one ? '' : 's'} it already had, so nothing was ` +
        `written: sending would have deleted ${one ? 'it' : 'them'}. ` +
        stillHere(queued)
    }
  }

  if (merged.applied.length === 0) {
    return {
      idle: false,
      sent: 0,
      conflicts: merged.conflicts,
      waiting: queued.length,
      note: conflictNote(merged.conflicts, config.repo)
    }
  }

  let landedAnyway = false
  if (folded.json !== null) {
    const bytes = new TextEncoder().encode(folded.json)
    const marks = merged.applied.filter((entry) => entry.edit?.kind === 'highlight').length
    const rulings = merged.applied.filter(isRuling).length
    const message =
      rulings > 0 && rulings === merged.applied.length
        ? `${rulings} ${rulings === 1 ? 'query' : 'queries'} ruled on`
        : marks > 0
          ? `${marks} passages marked while reading`
          : `${merged.applied.length} changes from a reading session`
    const sha = await attempt('asking the shelf for the book’s version', null, () =>
      shaOf(config, path)
    )
    try {
      await attempt('writing the book file', bytes.length, () =>
        putWithSha(config, path, toBase64(bytes), message, sha)
      )
    } catch (err) {
      landedAnyway = await landedAfterAll(config, path, bytes, err)
    }
    // The catalogue card, rewritten from the file just written. The shelf lists
    // a book by its card, and its query counts are what say how far the book has
    // got: a flush that filed rulings and left the card alone left *Isis* Vol.
    // II listed as "96 waiting" for two days with every one of them ruled. Never
    // fatal, for the reason `pushBook` gives its sheets: the rulings are up, and
    // the next flush or save writes the card again.
    try {
      const card = catalogueCard(bookKey, folded.json, file.scan?.path ?? null)
      await putFile(
        config,
        aboutPath(bookKey, dir),
        toBase64(new TextEncoder().encode(JSON.stringify(card, null, 2))),
        message
      )
    } catch {
      /* the card can wait for the next write */
    }
  }
  // What the shelf demonstrably holds now, for the next read to be checked
  // against. Before the queue is cleared: if the record will not save, the
  // entries staying queued is the safer of the two ways to be wrong.
  rememberLanded(bookKey, landedRulings(merged.rulings))
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
      (landedAnyway ? ' The shelf took them, although its answer was lost on the way back.' : '') +
      (merged.conflicts.length > 0 ? ` ${conflictNote(merged.conflicts, config.repo)}` : '')
  }
}

/**
 * After a write that got no answer: did it land anyway?
 *
 * True when the shelf now holds exactly the bytes that were sent, which is a
 * write whose answer was lost on the way back. Otherwise the failure is thrown
 * again, saying whether reading still works: if it does, the connection is up
 * and it is this write that did not get through.
 */
async function landedAfterAll(
  config: ShelfConfig,
  path: string,
  bytes: Uint8Array,
  err: unknown
): Promise<boolean> {
  if (!(err instanceof ShelfStepError) || err.failure.kind !== 'no-answer') throw err
  let now: string | null | undefined
  try {
    now = await shaOf(config, path)
  } catch {
    now = undefined
  }
  if (now !== undefined && now === (await blobSha(bytes))) return true
  throw new ShelfStepError({ ...err.failure, readsWork: now !== undefined })
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
