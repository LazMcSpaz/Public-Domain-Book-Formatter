import { describe, it, expect } from 'vitest'
import { locateQuote, sameWord, quoteTokens, QUOTE_FOUND_AT } from '@core/queries'
import type { LocatableWord } from '@core/queries'

/** A leaf's worth of OCR, laid out left to right so the boxes are readable. */
const leaf = (...texts: string[]): LocatableWord[] =>
  texts.map((text, i) => ({
    id: `w${i}`,
    text,
    bbox: { x0: i * 100, y0: 0, x1: i * 100 + 90, y1: 40 }
  }))

describe('two readers of one page, matched word by word', () => {
  it('forgives the letter OCR got wrong', () => {
    // The case this exists for. Leaf 12 of *Isis Unveiled* was queried over
    // `belleves`, and the query's quote carries the compositor's spelling while
    // OCR carries its own misreading. An exact match fails hardest exactly
    // where a query is.
    expect(sameWord('belleves', 'believes')).toBe(true)
    expect(sameWord('thc', 'the')).toBe(false) // three letters: one edit is most of it
    expect(sameWord('chirnrgeon', 'chirurgeon')).toBe(true)
  })

  it('joins a word one reader truncated', () => {
    expect(sameWord('desecration', 'desecra')).toBe(true)
    expect(sameWord('the', 'thereafter')).toBe(false) // too short to be a prefix match
  })

  /**
   * The pairing a general fuzzy match makes and this must not: two real words
   * a letter apart. Accepting it moves a crop to whatever line the other one
   * happens to sit on.
   */
  it('does not pair two different real words', () => {
    expect(sameWord('their', 'there')).toBe(false)
    expect(sameWord('form', 'from')).toBe(false)
  })
})

describe('finding a quoted phrase on its leaf', () => {
  const words = leaf(
    'It',
    'is',
    'not',
    'the',
    'spirits',
    'of',
    'heaven',
    'that',
    'descend',
    'upon',
    'earth'
  )

  it('hands back the words the phrase sits on, in order', () => {
    const found = locateQuote('the spirits of heaven', words)
    expect(found).not.toBeNull()
    expect(found!.words.map((w) => w.text)).toEqual(['the', 'spirits', 'of', 'heaven'])
    expect(found!.score).toBe(1)
  })

  it('finds it through the punctuation and capitals a reader typed', () => {
    const found = locateQuote('“The Spirits, of Heaven!”', words)
    // What comes back is the OCR words, in the case the page set them.
    expect(found!.words.map((w) => w.text)).toEqual(['the', 'spirits', 'of', 'heaven'])
  })

  it('finds it with a word misread in the middle', () => {
    const misread = leaf('the', 'spirlts', 'of', 'heaven')
    const found = locateQuote('the spirits of heaven', misread)
    expect(found!.words).toHaveLength(4)
    expect(found!.score).toBe(1)
  })

  /**
   * The one outcome that cannot be recovered from. A crop of the wrong three
   * lines is not a weaker version of the right one — the editor rules on it,
   * and nothing downstream can tell.
   */
  it('returns null rather than the likeliest wrong passage', () => {
    // The window has to *score* here, or the floor is not what is being
    // tested: a phrase sharing no word with the leaf scores zero and is
    // refused by the "nothing matched" branch whatever the floor is set to.
    // `the` matches and the other three do not, so this is 1 of 4 — a real
    // best window, below the floor, and exactly the shape that would put a
    // crop of the wrong lines in front of the editor.
    const short = leaf('the', 'quick', 'brown', 'fox')
    expect(locateQuote('the slow green hare', short)).toBeNull()
  })

  it('is null when nothing on the leaf matches at all', () => {
    expect(locateQuote('a passage nowhere on this leaf', leaf('xxxx', 'yyyy'))).toBeNull()
  })

  it('reports how much it found rather than only whether it found it', () => {
    // Two of three: above the floor, and the caller is told it is not certain.
    const found = locateQuote('the spirits of', leaf('the', 'spirits', 'xxxxxxx'))
    expect(found!.score).toBeCloseTo(2 / 3)
    expect(found!.score).toBeGreaterThanOrEqual(QUOTE_FOUND_AT)
  })

  /**
   * A query whose passage runs over the page break is quoted whole and read in
   * halves, so the phrase is longer than the leaf holds. Matching on what is
   * there beats refusing.
   */
  it('matches a phrase longer than the leaf on the part the leaf has', () => {
    const tail = leaf('descend', 'upon', 'earth')
    const found = locateQuote('descend upon earth, and the elements obey', tail)
    expect(found!.words.map((w) => w.text)).toEqual(['descend', 'upon', 'earth'])
  })

  it('is null for an empty quote and for a leaf nothing read', () => {
    expect(locateQuote('', words)).toBeNull()
    expect(locateQuote('the spirits', [])).toBeNull()
    expect(quoteTokens('  “,” ')).toEqual([])
  })
})

/**
 * A query's quote is taken from the book, and the book marks emphasis with
 * `<i>`. OCR reads paper and has no tags in it, so the notation has to come off
 * before a word is compared with anything.
 */
describe('a quote carrying the book’s own markup', () => {
  const words = leaf('know', 'that', 'it', 'means', 'impudicity', 'and', 'so', 'on')

  it('matches through the emphasis tags', () => {
    const found = locateQuote('know that it means <i>impudicity</i>', words)
    expect(found).not.toBeNull()
    expect(found!.words.map((w) => w.text)).toEqual(['know', 'that', 'it', 'means', 'impudicity'])
    expect(found!.score).toBe(1)
  })

  it('does not count a tag as a word', () => {
    expect(quoteTokens('<i>chastity</i>')).toEqual(['chastity'])
    expect(quoteTokens('a <b>bold</b> and <strong>strong</strong> word')).toEqual([
      'a',
      'bold',
      'and',
      'strong',
      'word'
    ])
  })

  /** Only the four the notation uses; a stray `<` is text, not a tag. */
  it('leaves anything that is not the book’s notation alone', () => {
    expect(quoteTokens('where a < b holds')).toEqual(['where', 'a', 'b', 'holds'])
  })
})
