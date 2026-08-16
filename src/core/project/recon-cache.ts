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
 */
export const RECON_CACHE_VERSION = 1

/** What a stored reading was made under. */
export interface ReconStamp {
  version: number
  /** The resolution every pixel coordinate in the record is expressed in. */
  dpi: number
  /** How many pages were read, or null for all of them. */
  maxPages: number | null
}

/** What the reading is wanted for now. */
export type ReconWanted = Omit<ReconStamp, 'version'>

/**
 * Whether a stored reading answers the question being asked of it.
 *
 * Takes `unknown` because it is reading a record off disk that may have been
 * written by any past version of this app, or by nothing at all.
 */
export function reconCacheUsable(stored: unknown, wanted: ReconWanted): boolean {
  if (!stored || typeof stored !== 'object') return false
  const s = stored as Partial<ReconStamp>
  if (s.version !== RECON_CACHE_VERSION) return false
  if (s.dpi !== wanted.dpi) return false
  // `undefined` and `null` are not the same answer here: a record written
  // before the field existed cannot claim to be a reading of the whole book.
  if (s.maxPages === undefined) return false
  return (s.maxPages ?? null) === wanted.maxPages
}

/** The stamp to write beside a reading taken under these conditions. */
export function reconStamp(wanted: ReconWanted): ReconStamp {
  return { version: RECON_CACHE_VERSION, dpi: wanted.dpi, maxPages: wanted.maxPages }
}
