import { describe, it, expect } from 'vitest'
import {
  asFolio,
  folioFor,
  folioOffset,
  looksLikeSignature,
  namesFolio,
  signatureSheet
} from '@core/draft'

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

/**
 * The printer's signature mark, which checks its own arithmetic.
 *
 * Signature `n` sits on the first leaf of gathering `n`, at folio
 * `sheet × (n − 1) + 1`. So a figure on a folio implies exactly one sheet size,
 * and it is a signature only if that size is one a book is really gathered in.
 * Nothing has to be assumed and nothing has to be voted.
 *
 * The five in *Isis Unveiled* Vol. I are folios 49, 65, 81, 97 and 113 reading
 * 4, 5, 6, 7 and 8 — every one of them giving 16, and no other leaf in 90
 * drafted producing a candidate at all.
 */
describe("the printer's signature mark", () => {
  it('reads the sheet size off the figure and the folio', () => {
    expect(signatureSheet(49, 4)).toBe(16)
    expect(signatureSheet(65, 5)).toBe(16)
    expect(signatureSheet(97, 7)).toBe(16)
    expect(signatureSheet(113, 8)).toBe(16)
  })

  it('takes a book gathered in eights just as readily', () => {
    expect(signatureSheet(9, 2)).toBe(8)
    expect(signatureSheet(33, 5)).toBe(8)
  })

  /**
   * The list is powers of two because a gathering is made by folding. Books
   * gathered in 12s and 24s exist and are deliberately out: with 24 in the
   * list, `signatureSheet(97, 5)` came back a signature, and on a book gathered
   * in 16s that is an ordinary numeral being taken out of the text.
   */
  it('does not admit a gathering size no fold produces', () => {
    expect(signatureSheet(97, 5)).toBeNull() // 24s
    expect(signatureSheet(37, 4)).toBeNull() // 12s
  })

  /** A figure whose arithmetic does not land on a real gathering is a numeral. */
  it('refuses a figure that implies no real sheet', () => {
    expect(signatureSheet(21, 3)).toBeNull() // would need sheets of 10
    expect(signatureSheet(50, 4)).toBeNull() // 49 does not divide by 3
  })

  /**
   * Signature 1 sits on folio 1, where both differences are zero and the
   * arithmetic says nothing at all. A lone `1` at the foot of the first leaf
   * could be anything, so it stays text.
   */
  it('refuses the first gathering, where the arithmetic is empty', () => {
    expect(signatureSheet(1, 1)).toBeNull()
    expect(signatureSheet(17, 1)).toBeNull()
  })

  it('is only a signature if it is a lone figure', () => {
    expect(looksLikeSignature('7', 97)).toBe(16)
    expect(looksLikeSignature('7.', 97)).toBeNull()
    expect(looksLikeSignature('page 7', 97)).toBeNull()
    expect(looksLikeSignature('147', 97)).toBeNull()
  })

  /** Leaf 219 of Isis Vol. I prints `11` and OCR reads it `II`. */
  it('reads a lining figure back through the letters OCR gives it', () => {
    expect(looksLikeSignature('II', 161)).toBe(16)
    expect(looksLikeSignature('1I', 161)).toBe(16)
  })

  /**
   * The fold here is narrower than the folio's on purpose. A signature has no
   * expected value to be checked against before the fold, so a generous one
   * would eat a short word: `Is` folds to `15` under the folio's set, and 15 is
   * the signature of folio 225 in a book gathered in 16s.
   */
  it('does not fold a word into a figure', () => {
    expect(looksLikeSignature('Is', 225)).toBeNull()
    expect(looksLikeSignature('So', 785)).toBeNull()
  })
})
