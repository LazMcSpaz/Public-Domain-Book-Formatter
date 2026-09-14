/**
 * Finding a query's words on the leaf they were read off.
 *
 * The gate promises the pixels beside every decision, and for a book whose scan
 * is on the device that promise is kept by rendering the leaf. For a book too
 * large for the shelf there is no scan to render, so the crop has to be cut
 * once, in advance, by a session that does have the paper — and cutting it
 * means knowing *where on the leaf* a quoted phrase sits.
 *
 * Nothing in a transcription carries coordinates. OCR does: it boxes every word
 * it reads. So the job is to line a phrase written by a reader up against a
 * sequence of words read by a machine, and hand back the words that match.
 *
 * ## Why this cannot be an exact match
 *
 * The phrase comes off the transcription and the boxes come off OCR, and those
 * are two different readers of one page — which is the whole reason OCR is
 * useful here, and also why they will disagree. Worse, they disagree *most*
 * exactly where a query is: a query is often raised **about** a word OCR got
 * wrong, so insisting on an exact match would fail hardest on the leaves that
 * matter. `belleves` against `believes` has to line up.
 *
 * So words are compared loosely — case and punctuation dropped, a single
 * mistaken letter forgiven, a long shared prefix accepted — and the best run of
 * them wins. What makes that safe rather than sloppy is that the result carries
 * its own **score**: the caller can show a strong match as the crop it asked
 * for and report a weak one rather than printing it as though it were sure.
 *
 * ## What it will not do
 *
 * Guess. Below the floor it returns `null`, and a caller that gets `null` must
 * say so rather than cutting a crop from somewhere plausible. A crop of the
 * wrong three lines is worse than no crop: the editor would rule on it.
 *
 * Pure: no DOM, no I/O.
 */

/** One word as OCR read it, with the box it read it from. */
export interface LocatableWord {
  id: string
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

export interface QuoteLocation {
  /** The OCR words the phrase matched, in reading order. */
  words: LocatableWord[]
  /**
   * How much of the phrase was found, 0 to 1.
   *
   * Reported rather than thresholded away, because the caller is writing
   * evidence and a reader deciding what a page says is owed the difference
   * between "this is the passage" and "this is the likeliest passage".
   */
  score: number
}

/**
 * How much of a phrase has to be found before the match is offered at all.
 *
 * Two thirds. A phrase this app raised a query about is short — a median of
 * about sixty characters on the book this was built for, so ten words — and a
 * page of dense 1877 type holds four hundred. Below two thirds the best window
 * stops being a passage and starts being a coincidence of common words, and the
 * failure it produces is the one kind that cannot be recovered from: a crop of
 * the wrong lines, cut confidently, that an editor then rules on.
 */
export const QUOTE_FOUND_AT = 2 / 3

/** Letters and digits only, folded to lower case. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
}

/**
 * The phrase as words worth matching on.
 *
 * The inline notation comes off first. A query's quote is taken from the
 * book, and the book marks emphasis with `<i>` — so `<i>chastity</i>` would
 * tokenise as `i`, `chastity`, `i`, and a three-word phrase would be asked to
 * match five, two of which are on no page anywhere. Leaf 136 of *Isis
 * Unveiled* is exactly that and came back unplaced.
 *
 * Only the four tags `parseInlineMarkup` reads, as in `stripInlineMarkup`: a
 * general tag-stripper would eat the rest of the line off a passage quoting an
 * inequality.
 */
export function quoteTokens(quote: string): string[] {
  return quote
    .replace(/<\/?(?:i|em|b|strong)>/gi, ' ')
    .split(/\s+/u)
    .map(normalize)
    .filter((w) => w.length > 0)
}

/**
 * Whether two words are near enough to be the same word.
 *
 * The three ways one reader's word and another's differ on a scanned page, and
 * nothing wider. A general fuzzy match would pair `their` with `there` and
 * quietly move a crop a line down the page.
 */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  // A word broken by a line break, or a long word one reader truncated.
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  // One letter misread, dropped or added — `belleves` for `believes`, `thc`
  // for `the`. Only on words long enough that one letter is not most of them.
  return Math.max(a.length, b.length) >= 4 && withinOneEdit(a, b)
}

/** True when one insertion, deletion or substitution turns `a` into `b`. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  let i = 0
  let j = 0
  let slack = 1
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++
      j++
      continue
    }
    if (slack === 0) return false
    slack--
    // A substitution advances both; an insertion advances only the longer.
    if (short.length === long.length) i++
    j++
  }
  // Anything left over on the longer word is the one edit, if it is still owed.
  return long.length - j <= slack
}

/**
 * Where a quoted phrase sits among the words OCR read off one leaf.
 *
 * The words must be in reading order, which is what `flattenWords` hands back.
 * Returns `null` when nothing on the leaf matches well enough to be offered —
 * see the note on guessing, above.
 */
export function locateQuote(quote: string, words: readonly LocatableWord[]): QuoteLocation | null {
  const tokens = quoteTokens(quote)
  if (tokens.length === 0 || words.length === 0) return null

  const read = words.map((w) => normalize(w.text))
  // A phrase longer than the leaf still matches on what the leaf has: a query
  // whose passage runs over the page break is quoted whole and read in halves.
  const span = Math.min(tokens.length, words.length)

  let bestAt = -1
  let bestHits = 0
  for (let start = 0; start + span <= words.length; start++) {
    let hits = 0
    for (let k = 0; k < span; k++) {
      if (read[start + k] !== '' && sameWord(read[start + k]!, tokens[k]!)) hits++
    }
    if (hits > bestHits) {
      bestHits = hits
      bestAt = start
    }
  }

  if (bestAt < 0) return null
  const score = bestHits / span
  if (score < QUOTE_FOUND_AT) return null
  return { words: words.slice(bestAt, bestAt + span), score }
}
