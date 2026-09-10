import { describe, it, expect } from 'vitest'
import {
  buildVocabulary,
  healWrappedHyphens,
  lookupKey,
  tally,
  verdictFor,
  vocabularyOf
} from '@core/draft'

const book = (...texts: string[]) => buildVocabulary(texts)

describe('what the book says about a broken word', () => {
  it('joins when the whole word is set elsewhere and the compound never is', () => {
    const v = book('an advanced pupil, and an advanced age')
    expect(verdictFor('ad', 'vanced', v).decision).toBe('join')
  })

  it('keeps the hyphen when the compound is set elsewhere and the join never is', () => {
    const v = book('the thought-transference experiments of the Society')
    expect(verdictFor('thought', 'transference', v).decision).toBe('keep')
  })

  it('abstains when the book sets it both ways', () => {
    const v = book('a reformed church, and the re-formed ranks')
    expect(verdictFor('re', 'formed', v).decision).toBe('unsettled')
  })

  /**
   * The seven the chapter left over. A word the volume happens to set once and
   * only broken has nothing to be weighed against, and guessing it would be
   * exactly the kind of confident invention the propose/accept rule exists to
   * stop.
   */
  it('abstains when the book sets it neither way', () => {
    const verdict = verdictFor('chirur', 'geon', book('nothing relevant here'))
    expect(verdict.decision).toBe('unsettled')
    expect(verdict.because).toMatch(/neither/)
  })

  it('says which words decided it, so the verdict can be checked', () => {
    const v = book('an advanced pupil')
    expect(verdictFor('ad', 'vanced', v).because).toBe(
      'the book sets `advanced` whole elsewhere and never `ad-vanced`'
    )
  })
})

describe('building the vocabulary', () => {
  it('takes the punctuation a sentence puts round a word off', () => {
    expect(vocabularyOf('“Advanced,” he said.').has('advanced')).toBe(true)
  })

  it('keeps a compound whole, because that is the form being asked about', () => {
    expect(vocabularyOf('thought-transference, then').has('thought-transference')).toBe(true)
  })

  it('folds the curly apostrophe, which the book sets both ways', () => {
    expect(lookupKey('To-day’s')).toBe(lookupKey("to-day's"))
  })

  /**
   * The circularity that would make the rule join everything. A broken word
   * contributes `ad` and `vanced`, never `advanced` — otherwise every break
   * would attest its own joined form and the lookup would always say join.
   */
  it('does not let a broken word attest its own joined form', () => {
    const v = vocabularyOf('an ad- vanced pupil')
    expect(v.has('advanced')).toBe(false)
    expect(verdictFor('ad', 'vanced', v).decision).toBe('unsettled')
  })
})

describe('healing a drafted page', () => {
  it('joins, keeps and leaves alone in one pass, and reports each', () => {
    const v = book('an advanced pupil', 'the thought-transference experiments')
    const drafted = 'an ad- vanced pupil tried the thought- transference and the chirur- geon came'
    const { text, verdicts } = healWrappedHyphens(drafted, v)
    expect(text).toBe('an advanced pupil tried the thought-transference and the chirur- geon came')
    expect(tally(verdicts)).toEqual({ join: 1, keep: 1, unsettled: 1 })
  })

  /**
   * The unsettled one is left character for character. A rule that tidied its
   * own abstentions would make them invisible, and the abstentions are the
   * only part of this a person needs to look at.
   */
  it('leaves an unsettled break exactly as it found it', () => {
    const { text } = healWrappedHyphens('the chirur- geon', book())
    expect(text).toBe('the chirur- geon')
  })

  it('never touches a compound that was set whole on one line', () => {
    const v = book('thought-transference')
    const { text, verdicts } = healWrappedHyphens('the thought-transference of it', v)
    expect(text).toBe('the thought-transference of it')
    expect(verdicts).toEqual([])
  })

  /**
   * A hyphen between figures is a range, and a dash standing for a word is not
   * a break. Requiring a letter either side is what keeps both out.
   */
  it('leaves a range of figures and a dash between clauses alone', () => {
    const v = book('anything')
    expect(healWrappedHyphens('from 1877- 1885 and so - on', v).verdicts).toEqual([])
  })

  it('carries a hyphen the book keeps across the line without the space', () => {
    const v = book('self-consciousness is the point')
    expect(healWrappedHyphens('of self- consciousness there', v).text).toBe(
      'of self-consciousness there'
    )
  })
})
