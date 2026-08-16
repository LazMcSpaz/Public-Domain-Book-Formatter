/**
 * The region of a scan that shows a word *in its line*.
 *
 * The term grid shows one word cut out of the page, which is enough to read the
 * letters and not always enough to judge them. `mineralls` could be the book's
 * own spelling or OCR doubling an `l`; `Peibles` could be a place or a misread
 * `Peebles`. The sentence around it usually settles the question, and the
 * pixels are right there — the page is already rendered when the crop is taken.
 *
 * ## Why the neighbours and not just padding
 *
 * Widening the box by a fixed number of pixels is simpler and wrong on exactly
 * the pages that matter: an index, a table, a book set in two columns. Padding
 * reaches into the next column and shows the reader words that are nowhere near
 * the one being judged. Growing to the *neighbouring words on the same line*
 * stops at the end of the line, because there is nothing there to include.
 *
 * Pure geometry: boxes in, a box out.
 */

/** The minimum a word box has to carry to be placed on a line. */
export interface BoxLike {
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

const top = (b: BoxLike): number => Math.min(b.bbox.y0, b.bbox.y1)
const bottom = (b: BoxLike): number => Math.max(b.bbox.y0, b.bbox.y1)
const left = (b: BoxLike): number => Math.min(b.bbox.x0, b.bbox.x1)
const right = (b: BoxLike): number => Math.max(b.bbox.x0, b.bbox.x1)

/**
 * Whether two boxes sit on the same printed line.
 *
 * By vertical overlap rather than by baseline, because OCR boxes on one line
 * vary in height — a word with a descender is taller than one without — and
 * comparing centres alone puts a tall word on its own line. Half the smaller
 * box's height of overlap is comfortably more than skew or a stray accent and
 * comfortably less than the leading between two lines.
 */
export function onSameLine(a: BoxLike, b: BoxLike): boolean {
  const overlap = Math.min(bottom(a), bottom(b)) - Math.max(top(a), top(b))
  if (overlap <= 0) return false
  const shorter = Math.min(bottom(a) - top(a), bottom(b) - top(b))
  return shorter > 0 && overlap >= shorter * 0.5
}

export interface ContextBoxOptions {
  /** How many words to take on each side. Default 4. */
  eitherSide?: number
  /** Pixels of breathing room around the result. Default 6. */
  padding?: number
}

/**
 * A box covering the word and a few of its neighbours on the same line.
 *
 * Returns the word's own box, padded, when it has no neighbours — a word alone
 * on its line is its own context, and there is nothing to add.
 */
export function contextBox(
  word: BoxLike,
  pageWords: readonly BoxLike[],
  options: ContextBoxOptions = {}
): { x0: number; y0: number; x1: number; y1: number } {
  const eitherSide = options.eitherSide ?? 4
  const padding = options.padding ?? 6

  const line = pageWords.filter((w) => onSameLine(w, word)).sort((a, b) => left(a) - left(b))

  // Identity is by position, not by reference: the caller may hand in copies.
  const index = line.findIndex((w) => left(w) === left(word) && top(w) === top(word))
  const neighbours =
    index === -1 ? [word] : line.slice(Math.max(0, index - eitherSide), index + eitherSide + 1)

  const span = neighbours.length > 0 ? neighbours : [word]
  return {
    x0: Math.min(...span.map(left)) - padding,
    y0: Math.min(...span.map(top)) - padding,
    x1: Math.max(...span.map(right)) + padding,
    y1: Math.max(...span.map(bottom)) + padding
  }
}
