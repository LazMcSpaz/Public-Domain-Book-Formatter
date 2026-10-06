/**
 * Where a contents entry that will not fit one line is cut into two.
 *
 * Left to the paragraph breaker, a wrapped entry broke wherever the measure
 * ran out, so a title could leave a single word under it ("Teacher and Pupil,
 * Part / I") or split a phrase down the middle. A contents is read as a list of
 * names, and a name cut at random reads as a typesetting accident. So an entry
 * that needs two lines is cut where the words themselves allow it, in this
 * order of preference:
 *
 * 1. between its label and its title ("MANUSCRIPT LECTURE No. 3" over
 *    "Teacher and Pupil, Part I"), which is the cut the reader already sees;
 * 2. after punctuation inside the title: a comma, colon, semicolon or dash;
 * 3. anywhere else, the two lines as even as they can be.
 *
 * And never so that the second line is a single word, or the first ends on a
 * word that belongs to what follows it ("of", "the", "and"). An entry that
 * cannot be set on two lines at all comes back null and is left to the
 * breaker. Pure: the caller supplies the measurement.
 */

const BINDS_FORWARD = new Set([
  'a',
  'an',
  'the',
  'of',
  'and',
  'or',
  'to',
  'in',
  'on',
  'for',
  'by',
  'with',
  'at',
  'from',
  'no.',
  'part'
])

export interface ContentsSplitOptions {
  /** Width of a string as the contents sets it. */
  width: (text: string) => number
  /** What the first line may hold. */
  firstWidth: number
  /** What the second line may hold (less any hang). */
  secondWidth: number
  /** How many leading words are the entry's label, or 0. */
  labelWords: number
}

export function contentsSplit(
  text: string,
  options: ContentsSplitOptions
): [string, string] | null {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 2) return null
  let best: { score: number; parts: [string, string] } | null = null
  for (let k = 1; k < words.length; k++) {
    const first = words.slice(0, k).join(' ')
    const second = words.slice(k).join(' ')
    const w1 = options.width(first)
    const w2 = options.width(second)
    if (w1 > options.firstWidth || w2 > options.secondWidth) continue
    const lastOfFirst = words[k - 1]!
    // Balance is the tie-breaker, measured as a share of the line so the
    // preferences below always outweigh it.
    let score = Math.abs(w1 - w2) / Math.max(options.firstWidth, 1)
    if (options.labelWords > 0 && k === options.labelWords) score -= 10
    else if (/[,:;—–]$/.test(lastOfFirst) || /^[—–]/.test(words[k]!)) score -= 5
    if (words.length - k === 1) score += 20
    if (BINDS_FORWARD.has(lastOfFirst.toLowerCase())) score += 20
    if (options.labelWords > 0 && k < options.labelWords) score += 20
    if (!best || score < best.score) best = { score, parts: [first, second] }
  }
  return best ? best.parts : null
}
