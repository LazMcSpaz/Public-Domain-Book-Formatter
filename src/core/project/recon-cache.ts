/**
 * When a stored reading of a scan may be used again, and when it must not.
 *
 * The free half of this app — render, OCR, harvest — costs no money and a great
 * deal of time: ten minutes of a phone's battery on a three-hundred-page book,
 * every time it is opened. The app already keeps the half that costs money and
 * throws away the half that costs time, which is exactly backwards for someone
 * who has just reopened a book to fix one word.
 *
 * Storing it is easy. Knowing when it has gone stale is the part worth writing
 * down, because every way of getting it wrong is silent:
 *
 *   - **A different resolution.** Word boxes, crops and the illustration regions
 *     are all in page pixels at the DPI they were rendered at. Reusing them
 *     under a different one puts every box in the wrong place and makes the KDP
 *     image-DPI check divide by a number the pixels never had.
 *   - **A different page limit.** The "try a few pages first" path reads part of
 *     a book. Handing that back as the whole reading produces a book that is
 *     missing its second half and says nothing about it.
 *   - **A different shape of record.** Adding a field and reading an old record
 *     as though it had one is how a restored session ends up with holes.
 *
 * So the stamp is checked rather than trusted, and anything that fails is a
 * miss — never a partial restore. Missing the cache costs time, which is the
 * thing it existed to save; using a wrong one costs correctness.
 *
 * Pure: a stamp in, a verdict out. No storage and no DOM.
 */

/**
 * Bump when the stored shape changes in a way an older record cannot satisfy.
 *
 * There is deliberately no migration path, unlike `SavedRun`. A stale reading is
 * *free to rebuild* — that is the entire premise of caching it — so the honest
 * response to a record this version cannot read is to drop it and read the scan
 * again, not to write code that guesses at what an older one meant.
 *
 * **3**: `OcrWord.italic`. A born-digital file states which face each word is
 * set in, and a record written before that field existed carries no face for
 * any word — which is indistinguishable, downstream, from a book that sets
 * nothing in italic. That is the third failure listed above, and it is the
 * worst kind: a whole volume's emphasis gone with every check still green. It
 * was measured rather than imagined — on _Patterns of the Hypnotic Techniques_
 * Vol. I, whose interspersal chapters mark the buried suggestion by setting it
 * in italic and nothing else, a version-2 record served the reading and the
 * draft came back with not one word marked.
 *
 * **4**: `OcrWord.bold`, for the same reason and with the same failure. The
 * same volume sets a quotation in italic and the portion of it the hypnotist
 * marks with his tonality in bold, and then tells the reader — page 30, in as
 * many words — to notice "the portion of Erickson's communication in bold
 * type". Read through a version-3 record every word comes back with a face for
 * the italic and none for the bold, so that sentence points at nothing on the
 * page and no check anywhere reports it.
 */
import type { CleanupPreset } from '@core/image/cleanup'

export const RECON_CACHE_VERSION = 4

/** What a stored reading was made under. */
export interface ReconStamp {
  version: number
  /** The resolution every pixel coordinate in the record is expressed in. */
  dpi: number
  /** How many pages were read, or null for all of them. */
  maxPages: number | null
  /**
   * Leaves read so far.
   *
   * A *finished* reading has read every leaf it set out to. A **checkpoint** is
   * the same record written partway, so a tab that gets frozen on a phone costs
   * the minutes since the last one rather than the whole book. The two are told
   * apart here and nowhere else: handing a checkpoint back as a finished
   * reading is a book missing its second half in silence, which is the exact
   * failure this field exists to make impossible.
   */
  pagesDone: number
  /** How many there are in total, so a checkpoint knows what it is short of. */
  pageCount: number
  /**
   * How the leaves were cleaned before OCR. Absent on a record written before
   * cleaning existed, which read the raw render — `off`.
   */
  cleanup?: CleanupPreset
}

/** What the reading is wanted for now — the conditions, not the progress. */
export interface ReconWanted {
  dpi: number
  maxPages: number | null
  /** Left out, `off`: the raw render, which is what every reading before this was. */
  cleanup?: CleanupPreset
}

/**
 * Whether a stored reading answers the question being asked of it.
 *
 * Takes `unknown` because it is reading a record off disk that may have been
 * written by any past version of this app, or by nothing at all.
 */
function conditionsMatch(stored: unknown, wanted: ReconWanted): stored is ReconStamp {
  if (!stored || typeof stored !== 'object') return false
  const s = stored as Partial<ReconStamp>
  if (s.version !== RECON_CACHE_VERSION) return false
  if (s.dpi !== wanted.dpi) return false
  // `undefined` and `null` are not the same answer here: a record written
  // before the field existed cannot claim to be a reading of the whole book.
  if (s.maxPages === undefined) return false
  if ((s.maxPages ?? null) !== wanted.maxPages) return false
  // A reading taken through a different cleaning is a different reading: the
  // words and their confidences came off different pixels. Refused exactly
  // as a different DPI is, and for the same reason — a record is only a
  // record of the conditions it was made under.
  if ((s.cleanup ?? 'off') !== (wanted.cleanup ?? 'off')) return false
  return typeof s.pagesDone === 'number' && typeof s.pageCount === 'number'
}

/**
 * Whether a stored reading can be handed back as the reading of this book.
 *
 * Only a *finished* one can. A checkpoint describes part of a book and saying
 * otherwise would produce an edition that stops halfway with nothing said.
 */
export function reconCacheUsable(stored: unknown, wanted: ReconWanted): boolean {
  if (!conditionsMatch(stored, wanted)) return false
  return stored.pagesDone >= stored.pageCount && stored.pageCount > 0
}

/**
 * How many leaves a stored checkpoint lets a fresh run skip, or 0 for none.
 *
 * The same conditions have to hold — a checkpoint taken at another resolution
 * describes pixels this run will not produce — but being unfinished is the
 * whole point rather than a disqualification.
 */
export function reconResumeFrom(stored: unknown, wanted: ReconWanted): number {
  if (!conditionsMatch(stored, wanted)) return 0
  if (stored.pageCount <= 0) return 0
  return Math.max(0, Math.min(stored.pagesDone, stored.pageCount))
}

/** The stamp to write beside a reading taken under these conditions. */
export function reconStamp(
  wanted: ReconWanted,
  progress: { pagesDone: number; pageCount: number }
): ReconStamp {
  return {
    version: RECON_CACHE_VERSION,
    dpi: wanted.dpi,
    maxPages: wanted.maxPages,
    pagesDone: progress.pagesDone,
    pageCount: progress.pageCount,
    cleanup: wanted.cleanup ?? 'off'
  }
}
