import { describe, expect, it } from 'vitest'
import { assessText } from '@core/textquality/assess'
import { expectedRecallAt, planSecondReading } from '@core/witness/select'

/** A leaf of plain words, long enough for `assessText` to claim anything. */
const plain = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `word${'x'.repeat(i % 5)}`)

/**
 * A leaf carrying junk characters: noisy, and its score falls with its noise.
 * `^` is in `assess.ts`'s JUNK set and also breaks its WORDLIKE test.
 */
const junky = (words: number, junk: number): string =>
  [...plain(words - junk), ...Array.from({ length: junk }, () => 'som^ething')].join(' ')

/**
 * A leaf whose tokens flip case mid-word. `assessText` scores those as
 * unwordlike — but they carry no junk character, so its noise stays at zero.
 * This is the shape that separates the two measures.
 */
const caseFlipped = (words: number, bad: number): string =>
  [...plain(words - bad), ...Array.from({ length: bad }, () => 'ThAmLnJwti')].join(' ')

describe('planSecondReading', () => {
  it('ranks on noise, not on the score it shares a verdict with', () => {
    // Built so the two measures disagree, which is the whole reason the module
    // names one of them: 10 junk tokens against 30 case flips.
    const noisy = junky(200, 10)
    const unwordlike = caseFlipped(200, 30)
    const a = assessText(noisy)
    const b = assessText(unwordlike)
    // The fixture is only worth anything if it really does separate them.
    expect(a.noise).toBeGreaterThan(b.noise)
    expect(a.score).toBeGreaterThan(b.score)

    const plan = planSecondReading([
      { pageIndex: 7, text: unwordlike },
      { pageIndex: 3, text: noisy }
    ])
    // Noise puts leaf 3 first. Ranking on score — the rule the ledger measured
    // at 35% against a coin's 24% — puts leaf 7 first, and this fails.
    expect(plan.ranked.map((r) => r.pageIndex)).toEqual([3, 7])
  })

  it('reads everything by default, and claims no recall for it', () => {
    const plan = planSecondReading([
      { pageIndex: 1, text: junky(200, 5) },
      { pageIndex: 0, text: caseFlipped(200, 5) }
    ])
    expect(plan.leaves).toHaveLength(2)
    expect(plan.expectedRecall).toBeNull()
  })

  it('takes the noisiest share, and quotes the recall of what it took', () => {
    const leaves = Array.from({ length: 8 }, (_, i) => ({
      pageIndex: i,
      // Leaf 0 noisiest, leaf 7 clean.
      text: junky(200, 8 - i)
    }))
    const plan = planSecondReading(leaves, { share: 0.25 })
    expect(plan.leaves).toEqual([0, 1])
    expect(plan.expectedRecall).toBeCloseTo(0.5, 5)
    expect(plan.ranked).toHaveLength(8)
  })

  it('quotes the recall of the selection made, not of the share asked for', () => {
    // Three leaves at a quarter rounds to one, which is a third of the book —
    // so the number quoted has to be a third's, not a quarter's.
    const leaves = Array.from({ length: 3 }, (_, i) => ({ pageIndex: i, text: junky(200, 3 - i) }))
    const plan = planSecondReading(leaves, { share: 0.25 })
    expect(plan.leaves).toEqual([0])
    expect(plan.expectedRecall).toBeCloseTo(expectedRecallAt(1 / 3), 5)
    expect(plan.expectedRecall).toBeGreaterThan(expectedRecallAt(0.25))
  })

  it('breaks ties on the page index, so one book plans the same way twice', () => {
    const same = plain(220).join(' ')
    const leaves = [5, 2, 9, 1].map((pageIndex) => ({ pageIndex, text: same }))
    expect(planSecondReading(leaves).leaves).toEqual([1, 2, 5, 9])
    expect(planSecondReading([...leaves].reverse()).leaves).toEqual([1, 2, 5, 9])
  })

  it('has nothing to say about no leaves', () => {
    const plan = planSecondReading([], { share: 0.25 })
    expect(plan.leaves).toEqual([])
    expect(plan.ranked).toEqual([])
    expect(plan.expectedRecall).toBe(0)
  })
})

describe('expectedRecallAt', () => {
  it('carries the measured points', () => {
    expect(expectedRecallAt(0.25)).toBeCloseTo(0.5, 5)
    expect(expectedRecallAt(0.5)).toBeCloseTo(0.72, 5)
    expect(expectedRecallAt(0.75)).toBeCloseTo(0.89, 5)
    expect(expectedRecallAt(1)).toBeCloseTo(1, 5)
  })

  it('interpolates between them and never runs past either end', () => {
    expect(expectedRecallAt(0.375)).toBeCloseTo(0.61, 5)
    expect(expectedRecallAt(-1)).toBe(0)
    expect(expectedRecallAt(4)).toBeCloseTo(1, 5)
  })
})
