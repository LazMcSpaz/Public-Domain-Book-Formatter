/**
 * The line-break hyphen, settled by the book rather than by the page.
 *
 * A compositor breaking `advanced` at a line end sets `ad-` and `vanced`, and a
 * compositor setting `thought-transference` at a line end sets `thought-` and
 * `transference`. On the paper they are the same two marks. `draft` therefore
 * refused to touch either — "not healed here, because the page cannot settle
 * it" — and counted them instead, which on the first real book was **301 on one
 * leaf-set and 217 in one chapter of _Isis Unveiled_**, every one of them a hand
 * correction. Assembly's own healing runs at page seams only, so anything left
 * alone prints as `ad- vanced` mid-line, past every check: both OCR engines
 * break the lines in the same place, so no second reader disagrees.
 *
 * The page cannot settle it. **The book can.** A book that breaks `advanced`
 * across a line has almost certainly set the whole word somewhere else in three
 * hundred pages, and a book that sets `thought-transference` sets it whole
 * somewhere too. So the question becomes a lookup in the book's own vocabulary,
 * which is free, deterministic and needs no pixels:
 *
 * - the joined form is attested and the hyphenated one is not → **join**
 * - the hyphenated form is attested and the joined one is not → **keep**
 * - both, or neither → **unsettled**, and say so
 *
 * Measured on Chapter I of _Isis Unveiled_ against what six readers with the
 * images actually decided: **210 of 217 settled, 0 disagreements, 7
 * abstentions** — and the seven are the right seven, words the volume happens
 * to set only once and only broken.
 *
 * ## Why this is not the forbidden thing
 *
 * "A model may propose a reading; only pixels may accept one." Nothing here is
 * a reading and nothing here is a model. OCR read the characters; what is in
 * question is whether a mark at a line end is a hyphen the word owns or a hyphen
 * the measure imposed, which is a typographic join and exactly what `joinText`
 * has always done unconditionally at page seams. This only stops that join being
 * a guess. The rule is a pure function over the book's own words, in the class
 * of `checkProposals` and `verifyBook`, and it abstains rather than guessing —
 * which is the property that makes an automatic rule safe to run at all.
 *
 * Pure: no DOM, no I/O, no network.
 */

/**
 * The book's own words, for looking a candidate up.
 *
 * A plain set of lowercased tokens rather than a corpus, because the caller is
 * better placed to say what the book *is*: recon has OCR'd every leaf whether or
 * not it has been read, so a chapter being drafted can be weighed against the
 * whole volume's vocabulary rather than against itself.
 */
export type Vocabulary = ReadonlySet<string>

/** What a candidate is, and what the book made of it. */
export interface HyphenVerdict {
  /** The two halves as the draft has them, e.g. `ad- vanced`. */
  as: string
  /** Left of the hyphen, `ad`. */
  left: string
  /** Right of it, `vanced`. */
  right: string
  decision: 'join' | 'keep' | 'unsettled'
  /** What in the book decided it, in plain language. */
  because: string
}

export interface HealResult {
  text: string
  verdicts: HyphenVerdict[]
}

/**
 * A word split across a line, as the draft leaves it.
 *
 * The space is required: `thought-transference` set whole on one line is not a
 * candidate and must never be touched. Both halves must begin and end in letters
 * — a figure, a date range (`1877- 1885`) and a dash standing for a word are all
 * caught by requiring letters either side, and none of them is a broken word.
 */
const WRAPPED = /(\p{L}[\p{L}\p{M}'’]*)[-­]\s+(\p{L}[\p{L}\p{M}'’]*)/gu

/**
 * Reduce a token to what it is looked up as.
 *
 * Lowercased, with the punctuation a sentence puts round a word taken off, and
 * with the curly apostrophe folded to the straight one — the book sets both and
 * a vocabulary that told them apart would fail to attest `to-day’s` against
 * `to-day's`.
 */
export function lookupKey(token: string): string {
  return token
    .toLowerCase()
    .replace(/[’]/gu, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, '')
}

/**
 * Every lookup key in a stretch of text.
 *
 * **A broken word contributes its halves and not a guess at its whole**, which
 * is what keeps the rule from arguing in a circle: if `ad-` and `vanced` were
 * silently joined on the way into the vocabulary, every break would attest its
 * own joined form and the rule would join everything.
 */
export function vocabularyOf(text: string): Set<string> {
  const words = new Set<string>()
  for (const raw of text.split(/\s+/u)) {
    const key = lookupKey(raw)
    if (key !== '') words.add(key)
  }
  return words
}

/** Merge several texts into one vocabulary. */
export function buildVocabulary(texts: Iterable<string>): Set<string> {
  const all = new Set<string>()
  for (const text of texts) for (const word of vocabularyOf(text)) all.add(word)
  return all
}

/**
 * What the book says about one broken word.
 *
 * Exported so a caller can ask without rewriting anything — a sheet of the
 * unsettled ones is the list worth a person's eyes, and it is the only part of
 * this that needs any.
 */
export function verdictFor(left: string, right: string, vocabulary: Vocabulary): HyphenVerdict {
  const as = `${left}- ${right}`
  const joined = lookupKey(`${left}${right}`)
  const hyphenated = lookupKey(`${left}-${right}`)
  const hasJoined = vocabulary.has(joined)
  const hasHyphenated = vocabulary.has(hyphenated)

  if (hasJoined && !hasHyphenated) {
    return {
      as,
      left,
      right,
      decision: 'join',
      because: `the book sets \`${joined}\` whole elsewhere and never \`${hyphenated}\``
    }
  }
  if (hasHyphenated && !hasJoined) {
    return {
      as,
      left,
      right,
      decision: 'keep',
      because: `the book sets \`${hyphenated}\` elsewhere and never \`${joined}\``
    }
  }
  return {
    as,
    left,
    right,
    decision: 'unsettled',
    because: hasJoined
      ? `the book sets both \`${joined}\` and \`${hyphenated}\``
      : `the book sets neither \`${joined}\` nor \`${hyphenated}\` anywhere else`
  }
}

/**
 * Heal what the book settles, leave what it does not, and report both.
 *
 * An `unsettled` candidate is left **exactly as it was** — `ad- vanced`, space
 * and all — rather than joined on the balance of probability. That is the whole
 * safety of the thing: a rule that guessed the last seven would be a rule whose
 * output nobody could trust the other two hundred and ten of.
 */
export function healWrappedHyphens(text: string, vocabulary: Vocabulary): HealResult {
  const verdicts: HyphenVerdict[] = []
  const healed = text.replace(WRAPPED, (whole, left: string, right: string) => {
    const verdict = verdictFor(left, right, vocabulary)
    verdicts.push(verdict)
    if (verdict.decision === 'join') return `${left}${right}`
    if (verdict.decision === 'keep') return `${left}-${right}`
    return whole
  })
  return { text: healed, verdicts }
}

/** How the verdicts came out, for a line in `structural`. */
export function tally(verdicts: readonly HyphenVerdict[]): {
  join: number
  keep: number
  unsettled: number
} {
  return {
    join: verdicts.filter((v) => v.decision === 'join').length,
    keep: verdicts.filter((v) => v.decision === 'keep').length,
    unsettled: verdicts.filter((v) => v.decision === 'unsettled').length
  }
}
