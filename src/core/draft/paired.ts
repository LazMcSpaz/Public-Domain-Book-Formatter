/**
 * A transcript set beside the commentary on it — two columns whose rows pair.
 *
 * `./columns` cuts a leaf into the printed pages standing on it. This is the
 * question one step in: does *one printed page* set its matter in two columns
 * that answer each other line for line? _Patterns of the Hypnotic Techniques_
 * Vol. I does it for the whole of "Basic Trance Induction, with Commentary" —
 * Erickson's words down the left, what the authors make of each phrase down
 * the right — and read as one column it comes out as this:
 *
 *     . . . tomato seed. . . sprouting index has already been plant. . .
 *     disqualified by Erickson's earlier meta-communication.
 *
 * — two unrelated sentences shuffled together. The pairing *is* the teaching
 * on those pages, so it has to survive into the book as a table rather than
 * being flattened into one column after the other.
 *
 * ## Why this is not a second gutter
 *
 * It cannot be found the way `./columns` finds one, and the reason is in the
 * material. Measured on leaf 27, the left column's lines end anywhere from
 * x=225 to x=780 and the right column's begin anywhere from x=715 to x=869:
 * **they overlap**, so there is no band of the page free of ink and no valley
 * deep enough to trust. The columns are set ragged, not to a rule.
 *
 * What is unambiguous is the gap *inside a line*. Measured over all 231
 * printed pages of that volume, the widest internal gap per line is sharply
 * bimodal: 6,977 lines under one body height — an ordinary word space, which
 * on this page is 17px against a 47px body — and 462 lines over it, the
 * narrowest real column gap being 75px. Nothing sits in between, so
 * `PAIR_GAP_HEIGHTS` is 1.0 with a factor of two of air on each side.
 *
 * ## Deciding per page, and splitting per line
 *
 * A single wide gap is not evidence — a justified line can open up, and a line
 * of a list can be sparse. So the *page* is judged first, on the share of its
 * lines that split, and only a page that clears `PAIR_SHARE` has its lines cut
 * at all. On that volume 11 printed pages of 231 clear it.
 *
 * The cut is then made at a boundary voted by the lines that did split, not at
 * a fixed column edge, because there is no fixed column edge. That is what
 * places the lines with words in only one of the two columns — `learn.. .`
 * with nothing beside it, `been listening.` with nothing before it — which are
 * a third of the page and carry no gap of their own.
 *
 * ## The row that is not a row
 *
 * A page like this is not uniformly two columns. Leaf 27 sets a long
 * quotation **across the full measure**, indented, in the middle of the
 * paired matter. Its lines straddle the boundary and have only word spaces in
 * them, so they are recognised and left as ordinary prose: a run of lines
 * whose text crosses the boundary without a wide gap is not a table row.
 * Without that test the quotation would be chopped down the middle and half of
 * every line filed under the wrong speaker.
 *
 * ## What this guesses, and says it guesses
 *
 * That two columns which pair *by row* rather than running one after the other
 * like a newspaper. Geometry cannot tell those apart, and this reads the page
 * the way the book it was written for sets it. `structural` says so, so
 * whoever checks the draft against the render can see it was a guess. A page
 * of diagrams — a syntactic tree, which this book also has — trips the same
 * measurement and needs cutting as a figure instead; that is named too.
 *
 * Pure: no DOM, no I/O, no network.
 */

import type { DraftLine } from './index'

/**
 * A page carrying some of the signal but not enough to act on — reported so
 * the twelve of them on this volume are looked at rather than passing as
 * prose in silence. See `PAIR_NOTICED`.
 */
export interface PairedNoticed {
  noticed: number
  split: number
  measured: number
}

export interface PairedColumns {
  /** The x the two columns divide at, voted by the lines that split. */
  at: number
  /** How many multi-word lines split, and how many were looked at. */
  split: number
  measured: number
  /** The narrowest gap that counted, for the report. */
  narrowest: number
  /**
   * The gap a division had to clear, in pixels, computed once from this band's
   * own word space. Carried so every later cut uses the same number the
   * decision was made on rather than recomputing it from different inputs.
   */
  gap: number
  /** This band's median word space, for the report. */
  space: number
}

/**
 * How wide an internal gap must be, as a multiple of **this page's own median
 * word space**, to be a column division rather than a space between words.
 *
 * Relative to the word space and not to the body height, and that distinction
 * is the whole of it. Measured in body heights first, this rule fired on
 * ordinary prose in three of the five single-column books here, because how
 * wide a word space is relative to the type is a property of the *setting*:
 * loose in `astral-world` (45px on a 62px body, 0.73) and tight in `isis-vol1`
 * (16px on a 24px body, 0.67) — but a page of prose whose widest gap is twice
 * its own word space is a page of prose in either.
 *
 * Measured per band across all thirty fixture leaves, as the share of lines
 * whose widest gap clears 3× the band's own median space: the one genuinely
 * paired page scores **0.62** and every other band in every book scores
 * **0.00–0.19**. See `PAIR_SHARE`.
 */
const PAIR_GAP_SPACES = 3

/**
 * A floor under that threshold, in body heights, against a degenerate page
 * whose measured word space is near zero.
 *
 * Insurance only: it binds on none of the thirty fixture leaves, where 3× the
 * space is 45–135px against floors of 12–31px.
 */
const PAIR_GAP_MIN_HEIGHTS = 0.5

/**
 * The share of a band's multi-word lines that must split before any line is
 * cut.
 *
 * A page genuinely set in two columns splits most of its lines; a page of
 * prose splits almost none. Measured per band over all thirty fixture leaves
 * of the six books: the one paired band scores **0.62**, and the next highest
 * anywhere — including the other printed page of that same leaf, which is
 * prose — is **0.19**. Nothing lands in between, so 0.4 sits with a factor of
 * one and a half below it and better than three above.
 *
 * Two of those numbers are worth keeping. `patterns-vol1` leaf 27 band 1 is
 * the *other half* of the paired leaf and scores 0.19, so the decision really
 * is per printed page rather than per leaf. And leaf 118 band 0, the sparse
 * appendix list whose ragged white defeated an earlier rule in `./columns`,
 * scores 0.00 here — its white is between lines, not inside them.
 */
const PAIR_SHARE = 0.4

/**
 * Enough of the signal to be worth naming, though not enough to act on.
 *
 * A page can be *part* prose and part paired — the leaf where the induction
 * transcript begins under four paragraphs of introduction is exactly that, and
 * its share is diluted below `PAIR_SHARE` by the prose above. Measured over
 * this volume's 231 printed pages: 11 clear the bar, **12 sit between 0.20 and
 * 0.40**, and 205 are under 0.20.
 *
 * Those twelve are reported and not acted on, and the reason is measured
 * rather than cautious. Deciding per *run* instead of per page was tried, and
 * **23 of the 205 prose bands contain a run whose every line splits** —
 * including the Guide and the Introduction, which are plain prose. A false
 * table silently restructures text that was right; an interleaved transcript
 * is visible in the draft and flagged. So the rule stays per page, and the
 * pages it cannot settle get named instead of passing in silence.
 */
const PAIR_NOTICED = 0.2

/** Below this many lines a share means nothing, so the page is left alone. */
const MIN_LINES = 6

/** A line needs this many words before its internal gaps are evidence. */
const MIN_WORDS_IN_LINE = 3

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** The widest gap between consecutive words on one line, and where it sits. */
function widestGap(line: DraftLine): { width: number; middle: number } | null {
  const words = [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0)
  if (words.length < MIN_WORDS_IN_LINE) return null
  let best: { width: number; middle: number } | null = null
  for (let i = 1; i < words.length; i++) {
    const width = words[i]!.bbox.x0 - words[i - 1]!.bbox.x1
    if (best === null || width > best.width) {
      best = { width, middle: (words[i - 1]!.bbox.x1 + words[i]!.bbox.x0) / 2 }
    }
  }
  return best
}

/** True for the answer that can be acted on, false for one merely noticed. */
export function isPaired(found: PairedColumns | PairedNoticed | null): found is PairedColumns {
  return found !== null && 'at' in found
}

/**
 * Whether this page sets its matter in two columns that pair, and where they
 * divide. `null` — the ordinary answer — means one column; a `PairedNoticed`
 * means the signal was there and too weak to act on.
 */
export function findPairedColumns(
  lines: readonly DraftLine[],
  bodyHeight: number
): PairedColumns | PairedNoticed | null {
  if (lines.length < MIN_LINES) return null

  // Every gap between neighbouring words on this band, so the threshold is set
  // from how *this* page is spaced rather than from how type usually looks.
  // Negative gaps are boxes that touch or overlap, which OCR produces on a
  // tight setting, and they say nothing about the space between words.
  const spaces: number[] = []
  for (const line of lines) {
    const words = [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0)
    for (let i = 1; i < words.length; i++) {
      const gap = words[i]!.bbox.x0 - words[i - 1]!.bbox.x1
      if (gap >= 0) spaces.push(gap)
    }
  }
  if (spaces.length === 0) return null
  const space = median(spaces)
  const threshold = Math.max(space * PAIR_GAP_SPACES, bodyHeight * PAIR_GAP_MIN_HEIGHTS)

  const gaps: { width: number; middle: number }[] = []
  let measured = 0
  for (const line of lines) {
    const gap = widestGap(line)
    if (gap === null) continue
    measured++
    if (gap.width >= threshold) gaps.push(gap)
  }
  if (measured < MIN_LINES) return null
  const share = gaps.length / measured
  if (share < PAIR_SHARE) {
    return share >= PAIR_NOTICED ? { noticed: share, split: gaps.length, measured } : null
  }

  return {
    at: median(gaps.map((g) => g.middle)),
    split: gaps.length,
    measured,
    narrowest: Math.min(...gaps.map((g) => g.width)),
    gap: threshold,
    space
  }
}

/** One line of a paired page, cut at the boundary. */
export interface PairedLine {
  left: string
  right: string
  /**
   * True when the line has words on both sides of the boundary but no gap wide
   * enough to be a column division — a line of full-measure prose crossing it.
   * A run holding one of these is not a table row.
   */
  straddles: boolean
}

/** Cut one line at the boundary, reporting a line that merely crosses it. */
export function splitLine(line: DraftLine, paired: PairedColumns): PairedLine {
  const words = [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0)
  const left: string[] = []
  const right: string[] = []
  for (const w of words) {
    const centre = (w.bbox.x0 + w.bbox.x1) / 2
    ;(centre < paired.at ? left : right).push(w.text)
  }
  const gap = widestGap(line)
  const wide = gap !== null && gap.width >= paired.gap
  return {
    left: left.join(' ').trim(),
    right: right.join(' ').trim(),
    straddles: left.length > 0 && right.length > 0 && !wide
  }
}

/**
 * A run of lines as one row of two cells, or `null` when the run is not a row.
 *
 * `null` is the full-measure case: any line crossing the boundary on nothing
 * but word spaces means the whole run is ordinary prose, however its other
 * lines behave.
 */
export function pairedRow(
  run: readonly DraftLine[],
  paired: PairedColumns
): [string, string] | null {
  const cut = run.map((l) => splitLine(l, paired))
  if (cut.some((c) => c.straddles)) return null
  const left = cut
    .map((c) => c.left)
    .filter((t) => t.length > 0)
    .join(' ')
  const right = cut
    .map((c) => c.right)
    .filter((t) => t.length > 0)
    .join(' ')
  if (left.length === 0 && right.length === 0) return null
  return [left, right]
}
