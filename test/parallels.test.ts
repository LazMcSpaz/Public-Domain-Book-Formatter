import { describe, it, expect } from 'vitest'
import { findParallels, concordanceFor } from '@core/coherence'
import type { BookBlock, BookDocument } from '@core/assemble'

function build(texts: string[]): BookDocument {
  const blocks: BookBlock[] = texts.map((text, i) => ({
    id: `p${i}b0`,
    kind: 'paragraph',
    text,
    sourcePages: [i]
  }))
  return {
    blocks,
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  }
}

/** The passage that made the module, in miniature: one copy damaged, one clean. */
const CLEAN =
  'the Surface Structure is the representation of the actual sounds made by the ' +
  'person speaking or, in the case of a written representation, the words written out above'
const DAMAGED =
  "the Surface Structure' is the representation of the actual sounds made by the " +
  "person speaking or, in the case of a written representation' the words written out above"

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `Paragraph ${i} says something else entirely about the work.`)

describe('a passage the book prints twice', () => {
  it('names the word the two copies point differently', () => {
    const found = findParallels(build([CLEAN, ...filler(3), DAMAGED]))
    expect(found).toHaveLength(1)
    expect(found[0]!.pointing).toEqual([
      { here: 'Structure', there: "Structure'" },
      { here: 'representation,', there: "representation'" }
    ])
  })

  /**
   * The measurement that decided the diff, and the one most easily got wrong.
   *
   * A diff over letters and digits reports these two copies as **identical** —
   * `representation'` and `representation,` are the same word once the
   * punctuation is stripped, and the punctuation is the entire fault. The
   * similarity gate runs on the bare words, because that is what "the same
   * passage" means; the diff must run on the words as the book sets them.
   */
  it('sees a difference that is punctuation and nothing else', () => {
    const found = findParallels(build([CLEAN, ...filler(3), DAMAGED]))
    expect(found[0]!.similarity).toBe(1)
    expect(found[0]!.pointing.length).toBeGreaterThan(0)
  })

  it('says nothing when the two copies agree', () => {
    expect(findParallels(build([CLEAN, ...filler(3), CLEAN]))).toEqual([])
  })

  it('separates a word one copy lacks from a word pointed two ways', () => {
    const found = findParallels(build([CLEAN, ...filler(3), `Truly ${DAMAGED}`]))
    expect(found[0]!.wording).toContainEqual({ here: '', there: 'Truly' })
    expect(found[0]!.pointing).toContainEqual({ here: 'Structure', there: "Structure'" })
  })

  /**
   * The fixture has to **become a candidate** and then be rejected.
   *
   * Written first as two passages with nothing in common, this passed with the
   * similarity floor deleted — they share no shingle, so they were never a
   * pair and the floor was never reached. Two paragraphs that quote the same
   * sentence and otherwise say different things are the shape that
   * discriminates: five shared shingles, and a word agreement near 0.3.
   */
  it('leaves two passages alone that merely quote the same sentence', () => {
    const quoted = 'you can continue to feel the satisfaction of knowing that this is so'
    const found = findParallels(
      build([
        `The client was asked to attend closely to the therapist and was told ${quoted} ` +
          'before the induction proper had even begun in the consulting room that morning.',
        `A wholly separate matter is what the listener already believes, though ${quoted} ` +
          'remains a useful illustration of the pattern under discussion in this chapter.'
      ])
    )
    expect(found).toEqual([])
  })

  /**
   * A formula the book repeats twenty times is not evidence that any two of
   * those blocks are one passage. Without the spread cap every occurrence
   * pairs with every other.
   */
  it('ignores a phrase so common it is the book’s furniture', () => {
    const refrain = 'the Deep Structure of this sentence can be represented as follows here'
    const found = findParallels(
      build(Array.from({ length: 8 }, (_, i) => `${refrain} number ${i}`))
    )
    expect(found).toEqual([])
  })

  /**
   * Same trap: a four-word block makes no eight-word shingle, so the first
   * version of this test passed with the word floor deleted. A ten-word block
   * makes exactly three shingles — enough to pair — and is still under the
   * floor, which is what actually exercises it.
   */
  it('is silent on a passage too short for a repeat to mean anything', () => {
    const brief = 'He went out again into the cold and shut the door'
    // Eleven words: four shingles, so it pairs — and it must *differ*, or the
    // guard against a pair with nothing to report excludes it first and the
    // floor is again never reached.
    expect(findParallels(build([brief, `${brief},`]))).toEqual([])
  })
})

describe('the concordance handed to a reader with no pixels', () => {
  const doc = build([CLEAN, ...filler(3), DAMAGED])

  it('carries the block, its neighbours and its parallels', () => {
    const [w] = concordanceFor([{ blockId: 'p0b0', quote: 'written representation,' }], doc)
    expect(w!.block).toBe(CLEAN)
    expect(w!.before).toBeNull()
    expect(w!.after).toContain('Paragraph 0')
    expect(w!.parallels).toHaveLength(1)
    expect(w!.parallels[0]!.blockId).toBe('p4b0')
  })

  /**
   * The strip that `crops` performs is the point of that verb and of this one.
   * Shown a proposed reading a model confirms; shown the evidence it reads.
   */
  it('carries no hypothesis, whatever the caller knows', () => {
    const [w] = concordanceFor([{ blockId: 'p0b0', quote: 'written representation,' }], doc)
    expect(Object.keys(w!).sort()).toEqual([
      'after',
      'before',
      'block',
      'blockId',
      'parallels',
      'quote'
    ])
    expect(JSON.stringify(w)).not.toContain('expected')
    expect(JSON.stringify(w)).not.toContain('why')
  })

  /** Read from the damaged side, the differences must point back the other way. */
  it('names the differences from the side being read', () => {
    const [w] = concordanceFor([{ blockId: 'p4b0', quote: "Structure' is" }], doc)
    expect(w!.parallels[0]!.differences).toContainEqual({
      here: "Structure'",
      there: 'Structure'
    })
  })

  it('gives a block with no parallel an empty list rather than nothing', () => {
    const [w] = concordanceFor([{ blockId: 'p1b0', quote: 'Paragraph 0' }], doc)
    expect(w!.parallels).toEqual([])
    expect(w!.block).toContain('Paragraph 0')
  })
})
