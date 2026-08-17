/**
 * How much a text that arrived ready-made can be trusted.
 *
 * The app used to answer this by file extension: an EPUB was believed
 * completely and a PDF's own text layer was ignored completely. Both are wrong
 * at the edges, and the edges are where the real books are.
 *
 *   - An archive.org EPUB is *machine OCR* with no images attached. Believing
 *     it produces three hundred leaves of `J^? ske5>tlcal` with no warning.
 *   - A born-digital PDF carries flawless text that the app rasterised, OCR'd
 *     for ten minutes, and then paid a model to read back off the pixels.
 *
 * So it is measured instead. Deterministically, with no model involved — this
 * is the same class of check as `verifyPage`, and for the same reason: a
 * judgement about whether text is trustworthy must not itself come from
 * something that can be confidently wrong.
 *
 * ## What is actually measured
 *
 * Word *shape*, because that is what separates typed text from OCR noise
 * regardless of language or period. Real words are letters, optionally with an
 * apostrophe or hyphen. OCR failures are letters mixed with digits and symbols
 * (`nD5eadw`, `1w?p`), case flipping mid-word (`ThA^Ln^Jwti`), and stray
 * punctuation floating between them.
 *
 * Crucially a token also counts as clean if **the book repeats it**. Old books
 * are full of `chirurgeon`, `alembick` and `ſhew`, and a dictionary would call
 * every one of them noise. A word the text uses three times is a word that
 * text means, whatever a dictionary thinks — the same principle the lexicon
 * already runs on.
 *
 * ## What this deliberately cannot see
 *
 * A misreading shaped like a word. `chirnrgeon` for `chirurgeon`, `thc` for
 * `the`, `rnineralls` for `mineralls` — letters only, nothing wrong with their
 * shape, and good OCR of a clean scan is made almost entirely of them. No
 * statistic over word shapes will ever catch that, and one claiming to would be
 * worse than none.
 *
 * So this must never be what decides that a text needs no reading. That
 * decision is **structural**: a scanned page is a picture with invisible text
 * laid over it, and a born-digital page is not — which is a fact about the file
 * rather than a guess about its words. See `looksScanned` in the platform
 * layer. What this is for is describing *damage*, which it sees very well, and
 * warning about a source that has no pixels behind it to fall back on.
 *
 * Pure: text in, a verdict out.
 */

/** What the text is fit for. */
export type TextVerdict =
  /** Typed by a person or produced digitally. Usable as it stands. */
  | 'trustworthy'
  /** Readable but plainly machine-read. Worth having as evidence, not as truth. */
  | 'mixed'
  /** Too damaged to set as a book. */
  | 'garbage'

export interface TextAssessment {
  verdict: TextVerdict
  /** Share of tokens that read as words, 0–1. */
  score: number
  /** Share of tokens carrying symbols no typesetter put there, 0–1. */
  noise: number
  /** Tokens measured. Below `MIN_WORDS` nothing is claimed. */
  words: number
  /** Why, in words a person can act on. Empty when nothing is wrong. */
  signals: string[]
}

/**
 * Below this there is not enough text to say anything.
 *
 * A title page is forty words and every one of them might be in capitals; a
 * verdict from that would be noise dressed as a measurement.
 */
export const MIN_WORDS = 200

/**
 * Thresholds.
 *
 * `trustworthy` is deliberately severe, because what it unlocks is skipping the
 * reading — and text that is 97% right looks fine in a sample and prints three
 * mistakes on every leaf. Good OCR of a clean scan lands around there, which is
 * exactly the case that must *not* pass.
 */
const TRUSTWORTHY_SCORE = 0.985
const TRUSTWORTHY_NOISE = 0.004
const MIXED_SCORE = 0.9

/** Characters that no typesetter put in the middle of a word. */
const JUNK = /[~^«»£†°|\\/<>*_{}[\]@#$%+=]/u

/** Letters only, with the punctuation a real word is allowed to carry. */
const WORDLIKE = /^[\p{L}][\p{L}'’-]*$/u
/** A number, with the separators numbers actually use. */
const NUMBERLIKE = /^[\p{N}][\p{N}.,:/-]*$/u
/** Punctuation on its own — a dash, a bracket, an ellipsis. Says nothing either way. */
const PUNCTUATION_ONLY = /^[^\p{L}\p{N}]+$/u

/** A case flip inside a word: `nD5eadw`, `LfS`, `ThA`. Typing does not do this. */
const CASE_FLIP = /\p{Ll}\p{Lu}/u

export interface AssessOptions {
  /** How many times a token must recur to count as the book's own word. Default 3. */
  vouchedAt?: number
}

/**
 * Measure a text.
 *
 * Takes the whole text rather than a sample: the interesting failures are not
 * evenly spread, and a scan that is clean for forty leaves and unreadable for
 * the next three hundred is exactly the book this exists to catch.
 */
export function assessText(text: string, options: AssessOptions = {}): TextAssessment {
  const vouchedAt = options.vouchedAt ?? 3
  const tokens = text.split(/\s+/u).filter((t) => t.length > 0)

  // What the text says often enough to mean it. Case-folded, because a running
  // head in capitals is the same word as the one in the paragraph below it.
  const counts = new Map<string, number>()
  for (const token of tokens) {
    const key = token.toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, '')
    if (key.length > 1) counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  let measured = 0
  let clean = 0
  let noisy = 0
  let flipped = 0
  let mixedAlnum = 0

  for (const token of tokens) {
    // Bare punctuation is neither evidence for nor against.
    if (PUNCTUATION_ONLY.test(token)) continue
    measured += 1

    const bare = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    const key = bare.toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, '')
    const vouched = key.length > 1 && (counts.get(key) ?? 0) >= vouchedAt

    const hasJunk = JUNK.test(token)
    const flip = CASE_FLIP.test(bare)
    // Letters and digits inside one word: `1DVJ`, `nD5eadw`, `LfS!11`.
    const alnum = /\p{L}/u.test(bare) && /\p{N}/u.test(bare)

    if (hasJunk) noisy += 1
    if (flip) flipped += 1
    if (alnum) mixedAlnum += 1

    const shaped = WORDLIKE.test(bare) || NUMBERLIKE.test(bare)
    // A word the book repeats is the book's own word, whatever its shape — but
    // not if it is carrying symbols, because OCR repeats its mistakes too.
    if ((shaped || vouched) && !hasJunk && !flip && !alnum) clean += 1
  }

  const score = measured === 0 ? 0 : clean / measured
  const noise = measured === 0 ? 0 : noisy / measured

  const signals: string[] = []
  if (measured < MIN_WORDS) signals.push('too little text to judge')
  else {
    if (score < TRUSTWORTHY_SCORE) {
      signals.push(`${Math.round((1 - score) * 100)}% of words don’t read as words`)
    }
    if (noise > TRUSTWORTHY_NOISE) {
      signals.push(`${Math.round(noise * 1000) / 10}% carry stray symbols`)
    }
    if (flipped / measured > 0.005) signals.push('capitals appear inside words')
    if (mixedAlnum / measured > 0.005) signals.push('digits appear inside words')
  }

  const verdict: TextVerdict =
    measured < MIN_WORDS
      ? 'mixed'
      : score >= TRUSTWORTHY_SCORE && noise <= TRUSTWORTHY_NOISE
        ? 'trustworthy'
        : score >= MIXED_SCORE
          ? 'mixed'
          : 'garbage'

  return { verdict, score, noise, words: measured, signals }
}

/** One sentence a person can act on, for the verdict and its reasons. */
export function describeAssessment(a: TextAssessment): string {
  if (a.words < MIN_WORDS) return 'There is too little text here to judge it.'
  if (a.verdict === 'trustworthy') {
    return 'This text reads as typed rather than scanned — it can be used as it stands.'
  }
  const why = a.signals.length > 0 ? ` — ${a.signals.join(', ')}` : ''
  return a.verdict === 'garbage'
    ? `This text reads as poor machine OCR${why}.`
    : `This text reads as machine OCR${why}.`
}
