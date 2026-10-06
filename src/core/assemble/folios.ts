/**
 * Which leaf of the scan carries which page of the original.
 *
 * An analytical contents of the older kind closes every group of topics on a
 * page of the edition it was printed in — *The Mahatma Letters* (1923) does it
 * after every group, `; 52-3.` — and a reprint that keeps those references has
 * to send the reader to the page of *this* edition where that matter now
 * stands. The first step is the leaf: the original's page 52 is some leaf of
 * the scan, and the transcription says which, because every leaf read records
 * the folio printed on it (`furniture.folio`).
 *
 * Measured off the leaves, never assumed. *The Mahatma Letters* happens to put
 * page n on leaf n + 43 the length of the book, and that is a fact about one
 * scan: another omits its blank versos, so the offset climbs at every chapter
 * (*Patterns* Vol. II), or binds a plate between two leaves without a folio.
 * So the map is built from what each leaf prints and nothing else:
 *
 *  - **A run** is consecutive printed folios that agree on their offset from
 *    the leaf. Inside a run the leaves between two printed folios are filled
 *    in — a chapter opening that drops its folio is still the page between
 *    the two around it.
 *  - **Where the offset changes** — a plate, an omitted blank — the folios in
 *    the gap belong to no run, and get no answer. A plate is the one page in a
 *    gap the book does not number, and guessing which leaf a missing number is
 *    on is how a reference comes to point at the wrong one.
 *  - **One folio that disagrees with both its neighbours** while they agree
 *    with each other is a misreading, not a new run: `75` read for `57` on one
 *    leaf would otherwise split a run in two and claim a page it never was.
 *  - **A folio the book never prints** — before its first, after its last, or
 *    in a gap — has no leaf. That is an answer the caller must report, never
 *    one to make up.
 *
 * Arabic folios only. Front matter's roman sequence is a different book of
 * pages, and the references this serves are the body's.
 *
 * Pure.
 */
import type { PageTranscription } from '@core/transcribe'

/** Folios `folio` to `folio + length − 1` are on leaves `leaf` to `leaf + length − 1`. */
export interface FolioRun {
  folio: number
  leaf: number
  length: number
}

/** The printed folio of a leaf, where it is an arabic number and nothing else. */
function arabicFolio(page: Pick<PageTranscription, 'furniture'>): number | null {
  const text = page.furniture?.folio?.trim()
  if (!text || !/^\d{1,4}$/u.test(text)) return null
  return Number(text)
}

/** The runs of printed folios in a book's leaves. See the module comment. */
export function folioRuns(
  pages: readonly Pick<PageTranscription, 'pageIndex' | 'furniture'>[]
): FolioRun[] {
  const points = [...pages]
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .flatMap((page) => {
      const folio = arabicFolio(page)
      return folio === null ? [] : [{ leaf: page.pageIndex, folio }]
    })
  const offset = (i: number): number => points[i]!.folio - points[i]!.leaf
  // A misreading: out of step with both neighbours, which are in step.
  const kept = points.filter(
    (_, i) =>
      i === 0 ||
      i === points.length - 1 ||
      offset(i) === offset(i - 1) ||
      offset(i) === offset(i + 1) ||
      offset(i - 1) !== offset(i + 1)
  )
  const runs: FolioRun[] = []
  for (const point of kept) {
    const run = runs[runs.length - 1]
    if (run && point.folio - point.leaf === run.folio - run.leaf && point.folio > run.folio) {
      run.length = point.folio - run.folio + 1
    } else {
      runs.push({ folio: point.folio, leaf: point.leaf, length: 1 })
    }
  }
  return runs
}

/**
 * The leaf that carries a folio of the original, or null where the book
 * never prints it.
 *
 * A volume that binds two works prints each folio twice — *The Human Aura*
 * and *The Astral World* both start again at page 1 — and a folio in two runs
 * is no answer on its own. `after` is the leaf that cites it, the contents
 * leaf a reference was read from, and a work's contents stands before the
 * work: so the run that begins after it, and nearest it, is the one meant.
 * With no such run, or nothing said, two runs are still no answer.
 */
export function leafOfFolio(
  runs: readonly FolioRun[],
  folio: number,
  after?: number
): number | null {
  const found = runs.filter((run) => folio >= run.folio && folio < run.folio + run.length)
  const run =
    found.length === 1
      ? found[0]!
      : after === undefined
        ? undefined
        : found.filter((r) => r.leaf > after).sort((a, b) => a.leaf - b.leaf)[0]
  return run ? run.leaf + (folio - run.folio) : null
}
