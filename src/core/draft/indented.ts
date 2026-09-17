/**
 * A quotation set in from both margins — one block, not a line each.
 *
 * An old book quotes at length by setting the passage narrower than the
 * measure, and every line of it then begins inside the page's left margin.
 * `isIndented` exists to find a *paragraph's first line*, so on such a passage
 * it fires on every line, and the block loop starts a new block at each one.
 * `isCentred` then agrees, because a passage inset on both sides is inset
 * equally on both sides, and each of those one-line blocks comes out as a
 * heading.
 *
 * Measured on _Patterns of the Hypnotic Techniques_ Vol. I, which quotes
 * Erickson on nearly every page: **293 headings** on a book with about twenty
 * chapters, 197 of them between seven and twelve words — which is not the
 * length of a heading, it is the length of a line. A contents built from that
 * would have had hundreds of entries, and every quotation in the book would
 * have printed as a stack of centred fragments.
 *
 * ## The rule, and why two lines are enough
 *
 * **A run of consecutive lines whose left edges agree, and sit inside the
 * measure, is one indented block.**
 *
 * Two lines is enough because an ordinary paragraph has exactly *one*
 * indented line — its first. A second line agreeing with it to the pixel is
 * not a paragraph indent; it is a narrower measure. Nothing about the depth of
 * the inset has to be assumed, which matters because this book quotes at two
 * depths (0.10 of the measure for Erickson, 0.02–0.06 for shorter extracts)
 * and a threshold set from the deeper one would miss the other.
 *
 * Measured over the volume's 8,001 lines: **225 such runs, covering 895
 * lines** — 11% of the book, which is about right for a book of this kind.
 * Run lengths go to fifteen.
 *
 * ## What separates these from a genuinely centred line
 *
 * Alignment, and it separates them completely. Over the 31 runs of two or more
 * lines that the centred test claims on this volume, the spread of their left
 * edges is **0.000 for 25 of them** — a justified block, every line beginning
 * at the same x — and 0.039 or more for the other six, which are real display
 * matter: the Guide's title, a centred line of a diagram, a two-line label.
 * Nothing lands between 0.000 and 0.039, so `ALIGNED_WITHIN` is 0.02.
 *
 * ## What it gets wrong, measured
 *
 * A **hanging indent** looks exactly like this and is not a quotation. Leaf
 * 650 of _Isis Unveiled_ Vol. I sets a numbered list — `1st. Americ,
 * Amerrique…` — whose continuation lines are inset, so two of them come back
 * as `blockquote` where they are the tail of a list item.
 *
 * Two things were tried against it and both are recorded here rather than
 * shipped. **The gap above** does not separate them: a real quotation on this
 * book sits at ordinary leading (1.00 of the stride) and so does the list
 * continuation (0.98). **The depth** does not separate them either, and this
 * is the measurement worth keeping — the median first-line indent is *0.048 of
 * the measure on Isis* and its false positives sit at 0.046–0.048, the same
 * depth, while on _Patterns_ the paragraph indent is about 0.056 and its
 * quotations 0.089–0.14, roughly twice it. A threshold that cleared Isis would
 * have to be set per book from a number neither book states.
 *
 * What makes the cost bearable is that **the block boundaries do not move**:
 * measured on that leaf, the draft has eleven blocks with this rule and eleven
 * without, and only the kind of two of them differs. Nothing is lost,
 * scrambled or joined — a `blockquote` that should be a `paragraph` is one
 * word in the draft for a corrector to change, and `structural` says verse and
 * a list look like this too.
 *
 * ## Where this must not run
 *
 * On a band `./paired` has taken, and that is not a refinement but a
 * correction: the right-hand column of a transcript page is, by construction,
 * a run of consecutive lines whose left edges agree and sit well inside the
 * measure. Measured, leaf 27 offers an eleven-line "indented block" at an
 * inset of 0.441 and leaf 29 a ten-line one at 0.538 — both of them the
 * commentary column, and both nonsense as quotations. The caller skips those
 * bands.
 *
 * Pure: no DOM, no I/O, no network.
 */

import type { DraftLine } from './index'

/** A run of lines set in from the measure, as indices into the line array. */
export interface IndentedBlock {
  /** First line, inclusive. */
  from: number
  /** Last line, exclusive. */
  to: number
  /** How far in it sits, as a share of the measure. */
  inset: number
}

/**
 * How far in a line must begin to count as set in at all.
 *
 * The same number `isIndented` uses for a paragraph's first line, on purpose:
 * this rule does not need a deeper threshold, because what distinguishes a
 * quotation from a paragraph is that the *second* line is indented too.
 */
const INSET_AT_LEAST = 0.015

/**
 * How far two lines' left edges may differ and still be the same block.
 *
 * Measured: a justified indented block holds its left edge to 0.000 of the
 * measure, and the nearest real display matter is 0.039 away. See the header.
 */
const ALIGNED_WITHIN = 0.02

/** An ordinary paragraph indents one line. Two is a narrower measure. */
const MIN_LINES = 2

interface Measure {
  left: number
  right: number
  width: number
}

/**
 * Every run of consecutive lines set in from the measure and agreeing with
 * each other, left to right down the leaf.
 *
 * Returns an empty array for ordinary prose, which is the usual answer.
 */
export function findIndentedBlocks(lines: readonly DraftLine[], measure: Measure): IndentedBlock[] {
  if (measure.width <= 0) return []
  const out: IndentedBlock[] = []
  const insetOf = (line: DraftLine): number => (line.left - measure.left) / measure.width

  let i = 0
  while (i < lines.length) {
    if (insetOf(lines[i]!) <= INSET_AT_LEAST) {
      i++
      continue
    }
    let j = i + 1
    while (
      j < lines.length &&
      insetOf(lines[j]!) > INSET_AT_LEAST &&
      Math.abs(lines[j]!.left - lines[i]!.left) / measure.width <= ALIGNED_WITHIN
    ) {
      j++
    }
    if (j - i >= MIN_LINES) out.push({ from: i, to: j, inset: insetOf(lines[i]!) })
    i = j
  }
  return out
}
