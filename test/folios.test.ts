import { describe, it, expect } from 'vitest'
import { asFolio, folioFor, folioOffset, namesFolio } from '@core/draft'

describe('reading a number off a scan', () => {
  it('takes a plain number', () => {
    expect(asFolio('43')).toBe('43')
  })

  it('takes the punctuation a running head puts round it off', () => {
    expect(asFolio('43.')).toBe('43')
  })

  /**
   * `THE ALKAHEST NO FICTION. 5I` — this scan's `1` is routinely read as a
   * capital I, and its `8` as a `3`. The fold is applied only when asking
   * whether a token is the *one* number the volume predicts, so it can be
   * generous without touching a word of the book.
   */
  it('folds the letters this scan reads digits as', () => {
    expect(asFolio('5I')).toBe('51')
    expect(asFolio('l0')).toBe('10')
  })

  it('is empty for a word, so a head is never mistaken for its own folio', () => {
    expect(asFolio('THE')).toBe('')
    expect(asFolio('ALKAHEST')).toBe('')
  })
})

describe('does this line carry the number the volume predicts', () => {
  it('finds it as a word at either end of the head', () => {
    expect(namesFolio('THE WISE BARRACHIAS-HASSAN-OGLU. 43', 43)).toBe(true)
    expect(namesFolio('56 THE VEIL OF ISIS.', 56)).toBe(true)
  })

  it('reads it through the digit-shapes OCR confuses', () => {
    expect(namesFolio('THE ALKAHEST NO FICTION. 5I', 51)).toBe(true)
  })

  /**
   * The false positive that would matter: a substring match would make leaf
   * 143's head corroborate leaf 43, and every hundredth leaf would rescue a
   * paragraph of prose into the furniture.
   */
  it('never matches a number inside another', () => {
    expect(namesFolio('SOMETHING. 143', 43)).toBe(false)
    expect(namesFolio('IN THE YEAR 1843 HE WROTE', 43)).toBe(false)
  })
})

const sighting = (pageIndex: number, folio: string) => ({ pageIndex, folio })

describe("voting the volume's own numbering", () => {
  const straight = Array.from({ length: 8 }, (_, i) => sighting(60 + i, String(2 + i)))

  it('votes the offset the leaves agree on', () => {
    const voted = folioOffset(straight)
    expect(voted.offset).toBe(58)
    expect(voted.agreed).toBe(8)
    expect(voted.dissenting).toEqual([])
  })

  /**
   * A plurality and never an average. A folio misread as `63` for `68` is not
   * a small error in the offset — averaging would move the predicted number for
   * every leaf in the book rather than leaving one leaf wrong.
   */
  it('names the leaf that dissents rather than averaging it in', () => {
    const voted = folioOffset([...straight, sighting(126, '63')])
    expect(voted.offset).toBe(58)
    expect(voted.dissenting).toEqual([126])
  })

  /**
   * An offset voted by two leaves is not evidence, and a rule that rescued
   * running heads on it would be inventing furniture across a whole book.
   */
  it('refuses below a quorum, rather than trusting a couple of sightings', () => {
    const voted = folioOffset([sighting(60, '2'), sighting(61, '3')])
    expect(voted.offset).toBeNull()
    expect(voted.votes).toBe(2)
  })

  it('ignores a folio that is not a number at all', () => {
    const voted = folioOffset([...straight, sighting(69, 'fig')])
    expect(voted.offset).toBe(58)
    expect(voted.votes).toBe(8)
  })

  it('predicts a leaf’s folio from the offset it voted', () => {
    expect(folioFor(101, 58)).toBe(43)
  })
})
