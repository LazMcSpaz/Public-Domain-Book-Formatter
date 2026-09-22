/**
 * Which leaves a second reading is worth running on.
 *
 * `PLAN-second-reader.md` asked for the second reading to be offered "on
 * leaves `assessText` flags". Measured against the ground truth before it was
 * built, that rule does not work, and the reason is written into `assess.ts`
 * itself: *"a misreading shaped like a word … no statistic over word shapes
 * will ever catch that"*. The errors a second reader earns its keep on are
 * exactly those — `thc` for `the`, `arc` for `are` — so selecting for them
 * with a measure of word shape is asking a check for the one thing it says it
 * cannot see.
 *
 * Over the 42 proofed leaves of `docs/ledger-data/second-reader`, 214 real
 * errors, taking a quarter of the leaves:
 *
 *   | ordering                        | damage reached |
 *   | ------------------------------- | -------------: |
 *   | an oracle that knew the answers |            68% |
 *   | **noise**                       |        **50%** |
 *   | `assessText`'s score            |            35% |
 *   | at random                       |            24% |
 *   | longest leaves first            |            18% |
 *
 * So the useful half of the assessment is `noise` — the share of tokens
 * carrying symbols no typesetter set — and the `score` it shares a verdict
 * with is barely better than a coin. The verdict is no better: `mixed` leaves
 * average 6.6 real errors and `trustworthy` ones 4.0, so a leaf this app calls
 * trustworthy still carries four.
 *
 * Two things follow, and the second is the more important.
 *
 * **Rank by noise, never by score or verdict.** At half the leaves it reaches
 * 72% against an oracle's 84% and a coin's 59%.
 *
 * **Say what a subset costs.** A quarter of the leaves is half the damage, not
 * "the damaged leaves", and an offer that implies otherwise is worse than one
 * that costs more — it is the check manufacturing confidence, which this
 * repository already names as the failure mode worse than no check. Reading
 * everything is what finds everything, and `SecondReadingPlan` carries both
 * numbers so a caller cannot show one without the other.
 *
 * Pure: no DOM, no I/O.
 */
import { assessText } from '@core/textquality/assess'

/** A leaf as this decision sees it: its index and what the first reader read. */
export interface LeafReading {
  pageIndex: number
  text: string
}

export interface RankedLeaf {
  pageIndex: number
  /** Share of tokens carrying symbols no typesetter set, 0–1. The ranking key. */
  noise: number
  /** Share of tokens that read as words, 0–1. Reported, never ranked on. */
  score: number
  /** Tokens measured. Below `MIN_WORDS` the assessment claims nothing. */
  words: number
}

export interface SecondReadingPlan {
  /** The leaves to read, noisiest first. */
  leaves: number[]
  /** Every leaf ranked, so a caller can widen the selection without re-measuring. */
  ranked: RankedLeaf[]
  /**
   * The share of the book's known damage this selection is expected to reach,
   * 0–1, from the table above. `null` when everything is being read, where the
   * question does not arise.
   *
   * An estimate off four books and 42 leaves, and it is here rather than in a
   * sentence somewhere because the number is the whole point of offering a
   * subset at all.
   */
  expectedRecall: number | null
}

/**
 * What a quarter, a half and three quarters of the leaves reached on the
 * ground-truth set, ranked by noise. Interpolated between, and never above the
 * highest measured point, because nothing was measured past it.
 */
const MEASURED_RECALL: readonly (readonly [share: number, recall: number])[] = [
  [0, 0],
  [0.25, 0.5],
  [0.5, 0.72],
  [0.75, 0.89],
  [1, 1]
]

/** The measured recall at a share of the leaves, linearly between the points. */
export function expectedRecallAt(share: number): number {
  const s = Math.min(1, Math.max(0, share))
  for (let i = 1; i < MEASURED_RECALL.length; i++) {
    const [x0, y0] = MEASURED_RECALL[i - 1]!
    const [x1, y1] = MEASURED_RECALL[i]!
    if (s <= x1) return y0 + ((s - x0) / (x1 - x0)) * (y1 - y0)
  }
  return 1
}

export interface SelectOptions {
  /**
   * The share of leaves to read, 0–1. `1` reads everything, which is the only
   * setting that finds everything and is what a book being set from should
   * have.
   */
  share?: number
}

/**
 * Rank the leaves and choose which to read again.
 *
 * Ties break on the page index, so the plan for one book is the same plan
 * twice — a selection that moved between two runs would make a cache
 * meaningless and two reports of one book impossible to compare.
 */
export function planSecondReading(
  leaves: readonly LeafReading[],
  options: SelectOptions = {}
): SecondReadingPlan {
  const share = Math.min(1, Math.max(0, options.share ?? 1))
  const ranked: RankedLeaf[] = leaves
    .map((leaf) => {
      const a = assessText(leaf.text)
      return { pageIndex: leaf.pageIndex, noise: a.noise, score: a.score, words: a.words }
    })
    .sort((a, b) => b.noise - a.noise || a.pageIndex - b.pageIndex)

  if (share >= 1) {
    return { leaves: ranked.map((r) => r.pageIndex), ranked, expectedRecall: null }
  }
  const take = ranked.length === 0 ? 0 : Math.max(1, Math.round(ranked.length * share))
  return {
    leaves: ranked.slice(0, take).map((r) => r.pageIndex),
    ranked,
    // The recall of what is actually being read, not of what was asked for:
    // `Math.max(1, …)` on a short book can take a third when a quarter was
    // asked, and the number quoted has to describe the selection made.
    expectedRecall: expectedRecallAt(ranked.length === 0 ? 0 : take / ranked.length)
  }
}
