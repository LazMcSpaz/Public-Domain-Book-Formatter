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
 * dropped by a ruling from the tablet; a fold that cannot keep everything
 * writes nothing, and says so. This module does the fetching, the writing and
 * the forgetting, and nothing else.
 *
 * **What is written over is what was read.** The book is read as bytes, and
 * the blob name of those bytes is checked against the version the shelf names
 * just before the write: a session's push in between used to be written over
 * in silence. When they differ, or GitHub refuses the write because the book
 * moved (409), the flush reads the book again and folds again, a few times at
 * most, and never writes over what it has not read.
 *
 * **What is forgotten is what was sent.** A queued change is keyed by what it
 * is about, so one changed during a slow write replaces it under the same key;
 * the store forgets an entry only while it is still the one that was sent.
 *
 * **A failure says which request failed** (`attempt`, in `shelf-attempt.ts`):
 * what it was doing, how much it sent, how long the browser waited and the
 * browser's own words. After a write that got no answer it looks twice more:
 * whether the shelf now holds what was sent (the write landed and only the
 * answer was lost, which counts as sent), and whether reading still works,
 * which tells a dropped connection from a write that was refused or cut off.
 * Nothing leaves the queue until the shelf has it. The sentences are in
 * `outbox-notes.ts`.
 *
 * Browser-only.
 */
import {
  aboutPath,
  bookPath,
  foldIntoBookText,
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
import { getBytes, putFile, putWithSha, shaOf, shelfDirFor } from './shelf'
import { clearQueued, outboxFor } from './run-store'
import { landedFor, rememberLanded } from './landed'
import { catalogueCard } from './shelf-save'
import { attempt, blobSha, ShelfStepError, type ShelfFailure } from './shelf-attempt'
import {
  SAVED_ELSEWHERE,
  commitMessageFor,
  conflictNote,
  missingNote,
  movedNote,
  notKeptNote,
  notOnShelfNote,
  sentNote,
  stillHere,
  unreadableNote
} from './outbox-notes'

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

/** How many times one flush reads the book: once, and again each time it moved underneath. */
const READS = 3

/** A flush that changed nothing on the shelf: every entry stays queued. */
function held(queued: readonly OutboxEntry[], note: string, failure?: ShelfFailure): FlushResult {
  return {
    idle: false,
    sent: 0,
    conflicts: [],
    waiting: queued.length,
    note,
    ...(failure ? { failure } : {})
  }
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
    const waiting = summarize(queued).waiting
    return held(queued, `${waiting} changes are on this device only: there is no connection yet.`)
  }

  try {
    return await sendTo(config, bookKey, queued)
  } catch (err) {
    if (!(err instanceof ShelfStepError)) throw err
    return held(queued, `${err.message} ${stillHere(queued)}`, err.failure)
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
  for (let round = 1; round <= READS; round++) {
    // Bytes, not text: the blob name of exactly these bytes is what the
    // shelf's version is checked against below.
    const bytes = await attempt('reading the book from the shelf', null, () =>
      getBytes(config, path)
    )
    // Not an error to swallow, and not a reason to drop anything: this queue
    // belongs to a book the shelf has never been given, and sending the whole
    // book is a different action with a different cost.
    if (bytes === null) return held(queued, notOnShelfNote(config.repo, queued.length))

    const folded = foldOrSay(config, bookKey, bytes, queued)
    if (!('merged' in folded)) return folded
    const { merged } = folded
    if (merged.applied.length === 0) {
      return {
        ...held(queued, conflictNote(merged.conflicts, config.repo)),
        conflicts: merged.conflicts
      }
    }
    // Every change already on the shelf: a flush whose answer was lost, sent
    // again. Nothing to write; the entries can go.
    if (folded.json === null) return finish(config, bookKey, folded, false)

    // The version the write replaces must be the one just read. A session's
    // push between the read and here would otherwise be written over, whole.
    const sha = await attempt('asking the shelf for the book’s version', null, () =>
      shaOf(config, path)
    )
    if (sha !== (await blobSha(bytes))) continue
    const sent = await write(config, path, folded, sha, round === READS)
    if (sent === 'moved') continue
    await writeCard(config, bookKey, dir, folded)
    return finish(config, bookKey, folded, sent === 'landed')
  }
  return held(queued, movedNote(config.repo, queued))
}

/**
 * The queue folded into the bytes read, or what to tell the editor instead.
 *
 * Every refusal here leaves the queue as it is. The bytes are decoded strictly:
 * a lenient decoder turns bytes that are not UTF-8 into replacement marks, and
 * the fold would write those marks back over them.
 */
function foldOrSay(
  config: ShelfConfig,
  bookKey: string,
  bytes: Uint8Array,
  queued: OutboxEntry[]
): FoldedBookText | FlushResult {
  let folded: FoldedBookText
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    folded = foldIntoBookText(text, queued, new Date().toISOString())
  } catch (err) {
    return held(queued, unreadableNote(config.repo, err, queued))
  }
  const { file } = folded

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
  if (missing.length > 0) return held(queued, missingNote(config.repo, missing.length, queued))

  // A fold that would have lost a field the tools wrote writes nothing.
  if (!folded.keptEverything) return held(queued, notKeptNote(config.repo, queued))
  return folded
}

/**
 * Write the folded file over the version read. `moved` when GitHub refused it
 * because the book changed meanwhile (409) and another read is allowed;
 * `landed` when the write got no answer but the shelf holds it after all.
 */
async function write(
  config: ShelfConfig,
  path: string,
  folded: FoldedBookText,
  sha: string | null,
  last: boolean
): Promise<'written' | 'landed' | 'moved'> {
  const bytes = new TextEncoder().encode(folded.json ?? '')
  const message = commitMessageFor(folded.merged.applied)
  try {
    await attempt('writing the book file', bytes.length, () =>
      putWithSha(config, path, toBase64(bytes), message, sha)
    )
    return 'written'
  } catch (err) {
    if (err instanceof ShelfStepError && err.failure.status === 409) {
      if (!last) return 'moved'
      throw new ShelfStepError({ ...err.failure, said: SAVED_ELSEWHERE })
    }
    return (await landedAfterAll(config, path, bytes, err)) ? 'landed' : 'written'
  }
}

/**
 * The catalogue card, rewritten from the file just written. The shelf lists a
 * book by its card, and its query counts are what say how far the book has
 * got: a flush that filed rulings and left the card alone left *Isis* Vol. II
 * listed as "96 waiting" for two days with every one of them ruled. Never
 * fatal, for the reason `pushBook` gives its sheets: the rulings are up, and
 * the next flush or save writes the card again.
 */
async function writeCard(
  config: ShelfConfig,
  bookKey: string,
  dir: string,
  folded: FoldedBookText
): Promise<void> {
  if (folded.json === null) return
  try {
    const card = catalogueCard(bookKey, folded.json, folded.file.scan?.path ?? null)
    await putFile(
      config,
      aboutPath(bookKey, dir),
      toBase64(new TextEncoder().encode(JSON.stringify(card, null, 2))),
      commitMessageFor(folded.merged.applied)
    )
  } catch {
    /* the card can wait for the next write */
  }
}

/** After the shelf has the changes: remember what landed and forget what was sent. */
async function finish(
  config: ShelfConfig,
  bookKey: string,
  folded: FoldedBookText,
  landedAnyway: boolean
): Promise<FlushResult> {
  const { merged } = folded
  // What the shelf demonstrably holds now, for the next read to be checked
  // against. Before the queue is cleared: if the record will not save, the
  // entries staying queued is the safer of the two ways to be wrong.
  rememberLanded(bookKey, landedRulings(merged.rulings))
  // Only after the shelf has answered, only what it took, and only while each
  // entry is still the one that was sent. A conflicted entry stays queued: it
  // is a change the editor made that nobody has accepted, and clearing it to
  // tidy the queue is the one thing that would make this channel worse than
  // not having one.
  const changedSince = (await clearQueued(merged.applied)).length
  return {
    idle: false,
    sent: merged.applied.length,
    conflicts: merged.conflicts,
    waiting: merged.conflicts.length + changedSince,
    note: sentNote(config.repo, merged.applied.length, landedAnyway, changedSince, merged.conflicts)
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
