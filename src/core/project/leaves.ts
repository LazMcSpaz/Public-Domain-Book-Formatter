/**
 * Which leaves a verb was asked for, checked against the book it has.
 *
 * Leaves are numbered **from zero** throughout — `leaf 0` is the first page
 * of a scan — and nothing said so anywhere. A batch job asked for `1..N`,
 * got the second page onward, lost the first page of all eleven sections of
 * *The Secret Doctrine*, and shifted every page marker in the reference
 * corpus by one. It reported 720 leaves requested and 720 returned, no gaps,
 * and the damage measure it was run to improve went from 9.17% to 1.36%.
 * Every number was true. The text was wrong, and only a page-by-page
 * comparison against the previous reading found it.
 *
 * So a leaf outside the book is refused **by name**, loudly, before any work
 * starts. The failure this replaces is the worst kind available here: a run
 * that returns nothing for a leaf that does not exist, carries on, and
 * reports a total that matches what was asked for.
 *
 * Pure: no DOM, no I/O.
 */

export interface LeafRangeProblem {
  /** Every leaf asked for that the book does not have, in the order given. */
  outside: number[]
  /** Anything that was not a leaf number at all. */
  notNumbers: string[]
  /** What to print. Empty when there is nothing wrong. */
  message: string
}

/**
 * Check a list of leaf numbers against a page count.
 *
 * `pageCount` is the number of leaves the book has, so the valid range is
 * `0 .. pageCount - 1`. A count of zero means nothing is known about the
 * book yet and nothing is refused — refusing every leaf because the caller
 * could not say how many there are would be worse than the fault this
 * guards, which at least only loses one page at each end.
 */
export function checkLeafRange(
  asked: readonly (number | string)[],
  pageCount: number
): LeafRangeProblem {
  const outside: number[] = []
  const notNumbers: string[] = []
  for (const one of asked) {
    const n = typeof one === 'number' ? one : Number(one)
    if (!Number.isInteger(n)) {
      notNumbers.push(String(one))
      continue
    }
    if (pageCount > 0 && (n < 0 || n >= pageCount)) outside.push(n)
  }

  const parts: string[] = []
  if (notNumbers.length > 0) {
    parts.push(`not leaf numbers: ${notNumbers.join(', ')}`)
  }
  if (outside.length > 0) {
    const last = pageCount - 1
    parts.push(
      `${outside.length === 1 ? 'leaf' : 'leaves'} ${outside.join(', ')} ` +
        `${outside.length === 1 ? 'is' : 'are'} outside this book, which has ${pageCount} ` +
        `${pageCount === 1 ? 'leaf' : 'leaves'} numbered 0 to ${last}. ` +
        `Leaves count from zero here: leaf 0 is the first page, not leaf 1.`
    )
  }
  return { outside, notNumbers, message: parts.join('; ') }
}
