/**
 * The outbox: what has been marked here and has not reached the shelf yet.
 *
 * The editor's rule for the tablet is that **the repository is where the
 * reading lives, and the device only holds what has not got there yet**. So a
 * highlight is written to a queue the instant it is made, and the queue is
 * flushed whenever the app is open and online.
 *
 * ## Why the queue holds edits and never the book
 *
 * A queue holding a snapshot of the whole book would overwrite whatever else
 * had happened to it in the meantime — which on this shelf means silently
 * discarding an afternoon's annotation done from another session. So a flush
 * fetches the current book file, appends what is queued to *its* edit list, and
 * writes it back once: one commit for a reading session, and nothing else lost.
 *
 * What makes that safe is a property that falls out of the edit list rather
 * than one anyone designed for. **Highlights commute.** Each is an independent
 * record keyed by its own id, changes nothing else, and is collapsed by
 * `withEdit` on that id — so two devices adding marks to one book cannot
 * conflict, and re-sending a batch whose response was lost is a no-op rather
 * than a duplicate. Comments are the same. That is why the queue can be a queue
 * and not a merge algorithm.
 *
 * A `text` edit made through "Fix it here" does **not** commute: two devices
 * retyping one block genuinely disagree, and there is no correct answer to pick
 * for them. So each entry records what occupied its target when it was made,
 * and a flush that finds the shelf holding something else **reports it** rather
 * than resolving it. The editor decides, and silence is the failure mode.
 *
 * Pure: array work over two edit lists. The storage and the network are the
 * platform's business.
 */
import { correctsTheBook, editTarget, sameTarget, withEdit, type BookEdit } from '@core/edits'
import { withRuling, type Ruling } from '@core/queries'

/** What every queued change carries, whatever kind it is. */
interface QueuedChange {
  /**
   * Unique per queued change.
   *
   * Not the edit's own id: the same highlight edited twice queues twice, and a
   * flush that failed halfway must be able to tell what it already sent.
   */
  id: string
  /** Which book this belongs to — the run key, as the shelf catalogue uses. */
  bookKey: string
  madeAt: string
}

/** A change to the book itself. */
export interface EditEntry extends QueuedChange {
  edit: BookEdit
  ruling?: never
  /**
   * What occupied this edit's target when the change was made, or null when
   * nothing did. The base a conflict is judged against — see above.
   */
  saw: BookEdit | null
  /**
   * This target should *not* be on the shelf: the editor took the mark off.
   *
   * Without it a queue could only ever add. A highlight removed on a tablet
   * that was offline would then come back on the next flush, because the shelf
   * still holds it and nothing in the queue says otherwise — a wrong result
   * arrived at silently, which is the one outcome this whole design refuses.
   * `edit` still names what is being removed, so the entry reads as a record
   * rather than as a bare identifier.
   */
  remove?: boolean
}

/**
 * The editor's answer to one query, made at the query gate.
 *
 * A ruling is not a change to the book — a `corrected` ruling becomes an
 * ordinary `text` edit later, and keeping the two apart is what lets
 * `unapplied()` be a real check. But it is expensive in exactly the way a
 * reading mark is: an evening of judgement that exists nowhere else, made on a
 * device that may be offline, and worth nothing until it reaches the shelf. So
 * it rides the same queue, for the same reason, and **it commutes for the same
 * reason too**: each ruling is keyed by the query it answers, changes nothing
 * else, and is collapsed on that key by `withRuling`. Two devices ruling on
 * one book cannot conflict, and a re-sent flush is a no-op.
 *
 * A second ruling on the same query is not a disagreement to report — it is
 * the editor changing their mind about their own answer, and the later one
 * wins. That is what makes this different from a `text` edit, where two
 * devices retyping one block genuinely disagree and there is no correct answer
 * to pick. There is no `saw` and no `remove`: a ruling is never made against a
 * base that could have moved, and unruling a query is done by ruling it again.
 */
export interface RulingEntry extends QueuedChange {
  ruling: Ruling
  edit?: never
}

/** One change made on this device, waiting to go up. */
export type OutboxEntry = EditEntry | RulingEntry

/** Whether a queued change is a ruling rather than an edit. */
export function isRuling(entry: OutboxEntry): entry is RulingEntry {
  return entry.ruling !== undefined
}

/**
 * Whether an edit can be merged into any book without asking.
 *
 * The two channels that are messages *about* the book rather than changes to
 * it. `correctsTheBook` is the same rule `applyEdits` and the proof sheet's
 * Undo use, so a fourth non-printing kind cannot be added and quietly miss this
 * one — which is exactly how the apparatus faults recorded in CLAUDE.md
 * happened.
 */
export function commutes(edit: BookEdit): boolean {
  return !correctsTheBook(edit)
}

/** A queued change the shelf could not take, and why. */
export interface OutboxConflict {
  entry: OutboxEntry
  /** What the shelf holds for that target now. */
  onShelf: BookEdit | null
  why: string
}

/** What the shelf holds now: the two lists a flush folds the queue into. */
export interface ShelfState {
  edits: readonly BookEdit[]
  rulings: readonly Ruling[]
}

export interface MergeResult {
  /** The shelf's edit list with everything mergeable folded in. */
  edits: BookEdit[]
  /** The shelf's rulings with every queued ruling folded in. */
  rulings: Ruling[]
  /** The entries that went in — the ones a successful flush may clear. */
  applied: OutboxEntry[]
  /**
   * The entries that did not, kept queued and reported.
   *
   * Never dropped and never forced: a mark or a correction the editor made and
   * that no store ever accepted, with nothing said, is the failure every part
   * of this app is built to avoid.
   */
  conflicts: OutboxConflict[]
}

const same = (a: BookEdit | null, b: BookEdit | null): boolean =>
  a === null || b === null ? a === b : JSON.stringify(a) === JSON.stringify(b)

/**
 * Fold what is queued into the edit list the shelf currently holds.
 *
 * Entries are applied oldest first, so a highlight edited twice on this device
 * ends up with the later wording — `withEdit` collapses them, exactly as it
 * would have if both had been made online.
 */
export function mergeOutbox(shelf: ShelfState, entries: readonly OutboxEntry[]): MergeResult {
  let edits = [...shelf.edits]
  let rulings = [...shelf.rulings]
  const applied: OutboxEntry[] = []
  const conflicts: OutboxConflict[] = []

  const ordered = [...entries].sort((a, b) => a.madeAt.localeCompare(b.madeAt))
  for (const entry of ordered) {
    // A ruling answers a query and touches nothing else, so there is no target
    // on the shelf to disagree with it and nothing to report. See `RulingEntry`.
    if (isRuling(entry)) {
      rulings = withRuling(rulings, entry.ruling)
      applied.push(entry)
      continue
    }
    const onShelf = edits.find((e) => sameTarget(e, entry.edit)) ?? null
    // Already exactly what the shelf holds: a flush whose response was lost,
    // re-sent. Checked before anything else and for every kind, because
    // `withEdit` removes and re-appends, so re-applying a mark that is already
    // up there would shuffle it to the end of the list and make a diff out of
    // nothing — on a shelf whose whole point is that git keeps every version.
    if (!entry.remove && same(onShelf, entry.edit)) {
      applied.push(entry)
      continue
    }
    if (entry.remove) {
      // Already gone — removed here and removed there, or removed twice.
      // Applied rather than conflicted, so the entry leaves the queue.
      if (!onShelf) {
        applied.push(entry)
        continue
      }
      // A removal of something that has since been changed elsewhere is the
      // same disagreement as two corrections, and gets the same answer: report
      // it. Marks are exempt because they commute — one editor taking a mark
      // off is not in conflict with another adding a different one.
      if (!commutes(entry.edit) && !same(onShelf, entry.saw)) {
        conflicts.push({
          entry,
          onShelf,
          why: 'that passage was changed elsewhere after this was removed here'
        })
        continue
      }
      edits = edits.filter((e) => !sameTarget(e, entry.edit))
      applied.push(entry)
      continue
    }
    if (commutes(entry.edit)) {
      edits = withEdit(edits, entry.edit)
      applied.push(entry)
      continue
    }
    if (!same(onShelf, entry.saw)) {
      conflicts.push({
        entry,
        onShelf,
        why: onShelf
          ? 'that passage was changed elsewhere after this correction was made here'
          : 'the change this correction was made against is no longer on the shelf'
      })
      continue
    }
    edits = withEdit(edits, entry.edit)
    applied.push(entry)
  }
  return { edits, rulings, applied, conflicts }
}

/** What the interface has to be able to say about the queue. */
export interface OutboxSummary {
  /** How many changes are on this device only. */
  waiting: number
  /** Of those, how many are marks the editor made while reading. */
  marks: number
  /** Of those, how many are rulings the editor made at the query gate. */
  rulings: number
  /** The oldest thing waiting, so "since Tuesday" can be said rather than "some". */
  oldest: string | null
}

export function summarize(entries: readonly OutboxEntry[]): OutboxSummary {
  const dates = entries.map((e) => e.madeAt).sort()
  return {
    waiting: entries.length,
    marks: entries.filter((e) => e.edit?.kind === 'highlight').length,
    rulings: entries.filter(isRuling).length,
    oldest: dates[0] ?? null
  }
}

/**
 * What changed between two edit lists, as entries for the queue.
 *
 * The app holds one edit list and re-derives the book from it, so the honest
 * way to know what to send is to compare the list before a change with the list
 * after it. Every surface therefore feeds the queue by doing what it already
 * does, and no surface has to remember to enqueue.
 *
 * One entry per target, replacing whatever was queued for it, because
 * `withEdit` collapses on that pair anyway and a queue that grew a record per
 * keystroke would be a queue nobody could flush. When it replaces, **the
 * original `saw` is kept**: that field means "what the shelf held when this
 * target was first touched here", and overwriting it with our own second
 * version would compare the shelf against a state it never had and report a
 * conflict that does not exist.
 *
 * `saw` is taken from the list as it stood, which is the shelf's list whenever
 * the device is in step with it. When it is not, the merge finds the difference
 * and *reports* it rather than resolving it — so the failure mode of this
 * approximation is a conflict raised for the editor to look at, never a change
 * overwritten in silence.
 */
export function entriesBetween(
  previous: readonly BookEdit[],
  next: readonly BookEdit[],
  queued: readonly OutboxEntry[],
  bookKey: string,
  madeAt: string
): EditEntry[] {
  const key = (edit: BookEdit): string => `${edit.kind}:${editTarget(edit)}`
  // Rulings are keyed by the query they answer and never by an edit target, so
  // they are not candidates to be replaced by a change to the book — and asking
  // one for its `edit` would key the whole map on `undefined`.
  const held = new Map(
    queued.filter((entry): entry is EditEntry => !isRuling(entry)).map((e) => [key(e.edit), e])
  )
  const out: EditEntry[] = []

  for (const edit of next) {
    const before = previous.find((e) => sameTarget(e, edit)) ?? null
    if (same(before, edit)) continue
    const id = key(edit)
    out.push({
      id,
      bookKey,
      edit,
      madeAt,
      saw: held.has(id) ? (held.get(id)?.saw ?? null) : before
    })
  }

  for (const edit of previous) {
    if (next.some((e) => sameTarget(e, edit))) continue
    const id = key(edit)
    out.push({
      id,
      bookKey,
      edit,
      madeAt,
      remove: true,
      saw: held.has(id) ? (held.get(id)?.saw ?? null) : edit
    })
  }
  return out
}
