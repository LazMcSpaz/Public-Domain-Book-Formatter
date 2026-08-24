/**
 * Landing a batch of read leaves into a run, and saying true things about it.
 *
 * This logic used to live inside a `page.evaluate` in `scripts/drive.mjs`,
 * which made it untestable by construction — and three of the four bugs found
 * in it were the same shape: **a report field that claimed a check had
 * happened, or that a book was finished, when neither was true.** They were
 * all pure-function-shaped. So this is a pure function, and every one of them
 * is a unit test.
 *
 * Two rules hold everything here up.
 *
 * **Nothing on the held run is dropped.** The run carries an evening of
 * proofreading (`edits`), pictures the editor supplied off their own disk
 * (`images`, which cannot be re-derived from anything the app has), the
 * adjudicated verdicts, and the fact bank. Landing one batch used to build a
 * fresh run and forget `images` entirely, so every batch wiped the plates —
 * and the shelf save then wrote that emptiness back out. `CARRIED_FIELDS` is
 * enforced by a test, so adding a field to `SavedRun` fails the suite until
 * someone decides whether it is carried, and no future field can be forgotten
 * here the way `images` was.
 *
 * **A guessed leaf count is never stored.** `pageCount: 0` means *nobody
 * knows* — not "an empty book". A floor derived from the highest leaf read is
 * fine to report and fatal to persist: stored, it reads back next time as a
 * known number, `complete` goes true, and a book sixteen leaves into three
 * hundred reports itself finished. That is the one wrong answer here, because
 * it is the answer that stops anybody looking.
 *
 * Pure: no DOM, no I/O, no network.
 */
import type { PageTranscription } from '@core/transcribe'
import type { Ruling } from '@core/queries'
import type { SavedRun, SavedFailure, SavedUsage } from './saved-run'
import type { Fact } from '@core/harvest'
import type { BookEdit } from '@core/edits'

/**
 * Everything a merge must carry from the run it is landing into.
 *
 * Enforced by `test/merge-batch.test.ts` against the real `SavedRun`, for the
 * same reason `BANKED_STYLE_KEYS` is: a field added to the run and forgotten
 * here is data destroyed silently on the next batch, and convention is not
 * what stops that — a failing test is.
 */
export const CARRIED_FIELDS = [
  'edits',
  'images',
  'failures',
  'identityAnswers',
  'adjudicated',
  'facts',
  'rulings',
  'usage',
  'modelId'
] as const

/** Fields the merge itself decides, so they are not carried. */
export const DECIDED_FIELDS = [
  'schemaVersion',
  'key',
  'fileName',
  'savedAt',
  'pageCount',
  'leafCount',
  'transcriptions',
  'complete'
] as const

export interface MergeBatchInput {
  /** The run already on this device, or null when this batch starts one. */
  held: SavedRun | null
  /** The batch, already validated through `parsePageTranscription`. */
  parsed: readonly PageTranscription[]
  key: string
  fileName: string
  /**
   * How many leaves the book has — **0 when nobody knows**.
   *
   * Never pass a floor here, and never pass `held.pageCount`: that field means
   * the read count when the wizard wrote it and the book's length when the
   * driver did, and there is no way to tell afterwards which. `held.leafCount`
   * is the one that means only the second thing. Storing a wrong length is
   * what turned a barely-started book into a finished one.
   */
  pageCount: number
  /** Opt-in, explicit: throw every other leaf away. */
  replace: boolean
}

export interface MergeReport {
  /** Distinct leaves this batch put in the run. */
  landed: number
  /** Leaves in the run afterwards. */
  transcribed: number
  /** The book's length, or null when nobody knows. */
  pageCount: number | null
  /**
   * The highest leaf index read — a floor on the book's length, which is
   * therefore `highestLeaf + 1` leaves at least.
   *
   * An index, as its name says, and as every other leaf number in this report
   * and in the errors beside it is. It used to be the count while being named
   * and documented as the index, so landing leaves 0 and 7 told the session
   * `highestLeaf: 8` in a report whose sibling error insists leaves are
   * counted from 0.
   */
  highestLeaf: number
  /** Null when the leaf count is unknown — never 0, which reads as "none left". */
  stillMissing: number | null
  firstMissing: number[]
  complete: boolean
  /** Leaves `replace` threw away. Zero on a merge. */
  discarded: number
}

export interface MergeBatchResult {
  /** Hand this to `createSavedRun`. Built from the held run, so nothing is lost. */
  init: {
    key: string
    fileName: string
    pageCount: number
    leafCount: number
    transcriptions: PageTranscription[]
    failures: readonly SavedFailure[]
    usage: SavedUsage
    modelId: string
    identityAnswers: Record<string, unknown>
    edits: readonly BookEdit[]
    images: Map<string, Uint8Array>
    complete: boolean
    adjudicated: Record<string, { verdict: string; reading: string; note: string }>
    facts: readonly Fact[]
    rulings: readonly Ruling[]
  }
  report: MergeReport
}

/** No API was called for a batch read in a session. */
const IN_SESSION = 'in-session'
const NO_SPEND: SavedUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }

/** How many leaves of the missing list are worth naming in a report. */
const NAME_MISSING = 12

/**
 * Merge a validated batch into a run.
 *
 * Throws on a batch that cannot mean one thing:
 *
 * - **the same leaf twice**, because a batch that says a leaf two ways has no
 *   way to say which reading it means, and the `Map` would silently keep the
 *   last while `landed` counted both;
 * - **a leaf past the end of the book**, when the length is known — that is a
 *   1-based batch against a 0-based book, and merging it puts nine leaves in a
 *   nine-leaf run with the first five never read.
 */
export function mergeBatchIntoRun(input: MergeBatchInput): MergeBatchResult {
  const { held, parsed, key, fileName, pageCount, replace } = input

  // A run, or nothing — never something run-shaped enough to pass.
  //
  // The types say this cannot happen and to a JavaScript caller they say
  // nothing at all. `scripts/drive.mjs` handed this a `SavedRunSummary`, which
  // has a key and a fileName and no `transcriptions`, so every carried field
  // read as absent: twelve landed leaves, two corrections and three rulings
  // were thrown away, and the merge reported `landed: 72` while doing it.
  // Silence was the whole fault, so this is loud.
  if (held !== null && !Array.isArray(held.transcriptions)) {
    throw new Error(
      'The run to merge into has no `transcriptions`, so it is not a run — a summary, ' +
        'or a partly-built record. Merging would replace the whole book with this batch.'
    )
  }

  const seen = new Set<number>()
  for (const page of parsed) {
    if (seen.has(page.pageIndex)) {
      throw new Error(
        `This batch reads leaf ${page.pageIndex} more than once. ` +
          'A batch that says a leaf two ways cannot say which reading it means.'
      )
    }
    seen.add(page.pageIndex)
    if (pageCount > 0 && page.pageIndex >= pageCount) {
      throw new Error(
        `This batch reads leaf ${page.pageIndex}, but the book has ${pageCount} ` +
          '(counted from 0). A batch numbered from 1 lands every leaf one place too high.'
      )
    }
  }

  const before = replace ? [] : (held?.transcriptions ?? [])
  const byIndex = new Map(before.map((t) => [t.pageIndex, t]))
  const discarded = replace ? (held?.transcriptions.length ?? 0) : 0
  for (const page of parsed) byIndex.set(page.pageIndex, page)
  const transcriptions = [...byIndex.values()].sort((a, b) => a.pageIndex - b.pageIndex)

  const highestLeaf = transcriptions.reduce((n, t) => Math.max(n, t.pageIndex), -1)
  const known = pageCount > 0
  const missing: number[] = []
  for (let i = 0; i < pageCount; i++) if (!byIndex.has(i)) missing.push(i)

  return {
    init: {
      key,
      fileName,
      // 0 rather than a floor. See the note at the top of this file.
      pageCount,
      leafCount: pageCount,
      transcriptions,
      // Everything below is the held run's, untouched. See CARRIED_FIELDS.
      failures: held?.failures ?? [],
      // Spend really happened; erasing it would be as false as inventing it.
      // A batch read in session adds nothing to the total.
      usage: held?.usage ?? NO_SPEND,
      modelId: held?.modelId ?? IN_SESSION,
      identityAnswers: held?.identityAnswers ?? {},
      edits: held?.edits ?? [],
      images: new Map((held?.images ?? []).map((i) => [i.id, i.bytes])),
      adjudicated: held?.adjudicated ?? {},
      facts: held?.facts ?? [],
      rulings: held?.rulings ?? [],
      // A book is finished when every leaf has been read — a *coverage* test,
      // never a count. `transcriptions.length >= pageCount` reported a nine-leaf
      // book complete while leaves 0–4 had never been read, because nine
      // entries had landed at indices 5–13.
      complete: known && missing.length === 0
    },
    report: {
      landed: seen.size,
      transcribed: transcriptions.length,
      pageCount: known ? pageCount : null,
      highestLeaf,
      // Null, not 0. With the length unknown there is nothing to subtract, and
      // `stillMissing: 0` beside it reads as "nothing left to do".
      stillMissing: known ? missing.length : null,
      firstMissing: missing.slice(0, NAME_MISSING),
      complete: known && missing.length === 0,
      discarded
    }
  }
}
