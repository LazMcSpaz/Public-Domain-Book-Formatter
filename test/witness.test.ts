import { describe, it, expect } from 'vitest'
import { compareWitnesses, joinsSettled } from '@core/witness'

/**
 * Two independent readings of one leaf, and the places they could not agree.
 *
 * The numbers in these tests come from leaf 6 of *The Human Aura* — Tesseract
 * against archive.org's own OCR of the same scan — and from the reading of the
 * pixels that settled it afterwards. They are measurements, not inventions.
 */
describe('where two readers agree, and where they do not', () => {
  it('says nothing when they agree', () => {
    const report = compareWitnesses('the human aura is', 'the human aura is')
    expect(report.disagreements).toEqual([])
    expect(report.agreement).toBe(1)
    expect(report.needEyes).toBe(0)
  })

  /**
   * The commonest disagreement by far, and the one that needs nobody: one
   * reader healed a line-break hyphen and the other did not. Eight of the
   * fourteen disagreements on the real leaf were this.
   */
  it('calls the same letters broken two ways a join, not a disagreement', () => {
    const report = compareWitnesses('a well developed feel ing', 'a welldeveloped feeling')
    // One gap, not two: with no matching word between them the whole run is
    // compared at once, and the letters are the same either way.
    expect(report.disagreements.map((d) => d.kind)).toEqual(['joined'])
    expect(report.needEyes).toBe(0)
  })

  it('hands back what the join settled, without applying it', () => {
    const report = compareWitnesses('the pro jected personality', 'the projected personality')
    expect(joinsSettled(report)).toEqual([{ at: 1, was: 'pro jected', joined: 'projected' }])
  })

  /** One real difference. The paper decides, and this only says where to look. */
  it('calls different letters substantive', () => {
    const report = compareWitnesses(
      'felt in a clear though unusual way',
      'felt in a dear though unusual way'
    )
    expect(report.disagreements).toHaveLength(1)
    expect(report.disagreements[0]).toMatchObject({
      kind: 'substantive',
      first: 'clear',
      second: 'dear'
    })
    expect(report.needEyes).toBe(1)
  })

  /**
   * Where both readers stumbled, marked by the one that has pixels.
   *
   * This replaced a heuristic that tried to judge whether a token *looked*
   * like a word, and which did not survive the data it was built from: on the
   * real leaf, the archive's OCR produced `acquaintaivct`, `iot` and `vfai`,
   * and a vowel-and-cluster test called all three word-shaped. It could not
   * tell garbage from `akasha`, which was its only job. Confidence is a real
   * engine probability and can (SPEC §4).
   */
  it('carries the first reader’s own doubt, so the worst rows sort to the top', () => {
    const report = compareWitnesses('acquaintances for fear ob', 'acquaintaivct iot vfai', {
      confidence: [96, 71, 64, 22]
    })
    expect(report.disagreements[0]).toMatchObject({ kind: 'substantive', confidence: 22 })
  })

  it('says nothing about confidence when the reader kept none', () => {
    const report = compareWitnesses('a clear day', 'a dear day')
    expect(report.disagreements[0]!.confidence).toBeNull()
  })

  it('does not have an opinion about unusual words', () => {
    // This shelf is full of words no dictionary has — `akasha`, `prana`,
    // `Panchadasi`. Nothing here judges whether a word is real; it only says
    // the two readers differed.
    const report = compareWitnesses('the akasha and prana', 'the akasha and pruna')
    expect(report.disagreements[0]!.kind).toBe('substantive')
  })
})

describe('what it counts', () => {
  it('reports agreement against the first reader, which is the one with pixels', () => {
    const report = compareWitnesses('one two three four', 'one two three')
    expect(report.words).toBe(4)
    expect(report.agreeing).toBe(3)
    expect(report.agreement).toBeCloseTo(0.75)
  })

  it('ignores punctuation, which the two engines argue about as a matter of course', () => {
    expect(compareWitnesses('feet, and then', 'feet. and then').needEyes).toBe(0)
  })

  it('survives an empty reading rather than dividing by it', () => {
    const report = compareWitnesses('', 'anything at all')
    expect(report.agreement).toBe(0)
    expect(report.words).toBe(0)
  })
})
