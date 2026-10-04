/**
 * Optical margins — hanging the punctuation that makes an edge look ragged.
 *
 * A justified block of text is flush at both margins by *measurement*, and
 * still looks crooked, because the eye aligns on the mass of a glyph rather
 * than on its box. A line ending in a comma or a full stop reads as short: the
 * mark is mostly white space, so the ink stops early. A line beginning with an
 * opening quotation mark reads as indented for the same reason.
 *
 * Every book printed before phototypesetting fixed this by hanging the
 * punctuation past the margin, and it is the single cheapest thing that makes
 * set text look set rather than typed.
 *
 * ## Why this runs after breaking, not during it
 *
 * The alternative — telling the line breaker that punctuation has less width —
 * changes where the lines break, which changes the page count, which changes
 * the contents page. This shifts already-placed glyphs by a fraction of an em
 * and cannot move a break, so the layout is identical with it on or off and
 * only the last glyph of some lines moves. That property is worth more than
 * the small extra correctness of the other approach.
 *
 * Pure: runs in, runs out.
 */
import type { TextMeasurer } from './measure'
import type { FontRef, TextRun } from './types'

/**
 * How much of its own width each mark hangs past the margin.
 *
 * These are the traditional values, and the reasoning behind each is the same:
 * roughly the proportion of the glyph's box that is white. A hyphen is nearly
 * all ink and hangs least; a full stop is nearly all air and hangs most.
 */
const HANG_RIGHT: Record<string, number> = {
  '.': 0.7,
  ',': 0.7,
  ';': 0.45,
  ':': 0.45,
  '!': 0.3,
  '?': 0.3,
  '-': 0.55,
  '–': 0.5,
  '—': 0.4,
  '’': 0.6,
  "'": 0.6,
  '”': 0.55,
  '"': 0.55,
  ')': 0.3,
  ']': 0.3
}

/** Opening marks hang back off the left margin by the same reasoning. */
const HANG_LEFT: Record<string, number> = {
  '‘': 0.6,
  "'": 0.6,
  '“': 0.55,
  '"': 0.55,
  '(': 0.3,
  '[': 0.3,
  '¡': 0.4,
  '¿': 0.4
}

/**
 * Move a line's edge glyphs so the *ink* lines up with the margin.
 *
 * Both edges are handled independently: a line can end in a full stop and begin
 * with a quotation mark, and both should hang.
 *
 * The runs are returned unchanged — the same array — when nothing hangs, so the
 * common case allocates nothing and a caller can rely on identity to tell
 * whether anything moved.
 */
export function hangPunctuation(
  runs: readonly TextRun[],
  measurer: TextMeasurer,
  font: FontRef,
  options: {
    flushRight: boolean
    /**
     * `joined[i]` is true where run `i` is the next stretch of the same word
     * as run `i - 1` — a word set in two faces, `<i>un</i>spiritual`. Such
     * runs move together: the shift is shared out between *words*, because a
     * share falling between two stretches of one word would open a gap in it.
     * Absent, every run is a word of its own, as it always was.
     */
    joined?: readonly boolean[]
  }
): readonly TextRun[] {
  if (runs.length === 0) return runs

  const first = runs[0]!
  const last = runs[runs.length - 1]!

  const openMark = [...first.text][0] ?? ''
  const closeMark = [...last.text].pop() ?? ''

  const leftRatio = HANG_LEFT[openMark] ?? 0
  // Only a line that actually reaches the right margin has an edge to align
  // against. The short last line of a paragraph does not, and hanging its full
  // stop would shove the final word rightwards into a visible gap — an
  // artifact in the middle of the measure, which is worse than the raggedness
  // this exists to fix.
  const rightRatio = options.flushRight ? (HANG_RIGHT[closeMark] ?? 0) : 0
  if (leftRatio === 0 && rightRatio === 0) return runs

  const out = [...runs]

  /**
   * Spread a shift across the line instead of dumping it in one place.
   *
   * Hanging a mark means the run it belongs to moves, and a moved run has to
   * take its space from somewhere. Moving the last word alone put the whole
   * shift into the last word space — which on a hyphenated line break is
   * `0.55` of a hyphen, about three-quarters of a word space, and reads as a
   * typing error: `if he be well  in-formed`. It was visible on every
   * hyphenated line of every justified page.
   *
   * Sharing it out proportionally puts a fraction of it into each of the
   * line's spaces, where it is invisible, and keeps the edge that is *not*
   * hanging exactly where the breaker put it. No break moves and no line
   * changes width, which is the property this module exists to preserve.
   */
  /** Which word each run belongs to, counting from 0 along the line. */
  const wordOf: number[] = []
  for (let i = 0; i < out.length; i++) {
    wordOf.push(i === 0 ? 0 : wordOf[i - 1]! + (options.joined?.[i] ? 0 : 1))
  }
  const words = (wordOf[wordOf.length - 1] ?? 0) + 1
  const spread = (shift: number, towardsTheEnd: boolean): void => {
    if (words === 1) {
      for (let i = 0; i < out.length; i++) {
        out[i] = { ...out[i]!, xPt: out[i]!.xPt + (towardsTheEnd ? shift : -shift) }
      }
      return
    }
    for (let i = 0; i < out.length; i++) {
      // 0 at the first word, 1 at the last. A right hang moves the last word
      // by the whole shift and the first not at all; a left hang, the reverse.
      const along = wordOf[i]! / (words - 1)
      const share = towardsTheEnd ? along : along - 1
      out[i] = { ...out[i]!, xPt: out[i]!.xPt + shift * share }
    }
  }

  // The mark hangs left of the margin and the first *letter* lands on it. The
  // right edge stays flush, which shifting the whole line did not do.
  if (leftRatio > 0) spread(measurer.widthOf(openMark, font, first.sizePt) * leftRatio, false)

  // The last *letter* lands where the margin is and the mark overhangs, which
  // is what hanging punctuation means: the ink lines up, the box does not.
  if (rightRatio > 0) spread(measurer.widthOf(closeMark, font, last.sizePt) * rightRatio, true)

  return out
}
