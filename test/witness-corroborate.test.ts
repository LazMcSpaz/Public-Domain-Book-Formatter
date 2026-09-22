import { describe, expect, it } from 'vitest'
import { gradeFlags, summarize, worstFirst } from '@core/witness/corroborate'

/**
 * One sentence, three readings of it. The transcription is the book as read;
 * the two engines each differ from it in a different place, and agree with it
 * everywhere else.
 */
const TRANSCRIPTION = 'the clairvoyant sees the astral light about a living body'

describe('gradeFlags', () => {
  it('corroborates a flag both readers raise the same way', () => {
    const first = 'the clairvoyant sees the astral ligbt about a living body'
    const second = 'the clairvoyant sees the astral ligbt about a living body'
    const flags = gradeFlags(TRANSCRIPTION, first, second)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ first: 'ligbt', second: 'ligbt', verdict: 'corroborated' })
  })

  it('dismisses a flag the second reader does not share', () => {
    // Only the first reader misreads `light`; the second reads the leaf as the
    // transcription has it, so the first is the odd one out.
    const first = 'the clairvoyant sees the astral ligbt about a living body'
    const flags = gradeFlags(TRANSCRIPTION, first, TRANSCRIPTION)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ first: 'ligbt', second: null, verdict: 'dismissed' })
  })

  it('contests a flag the two readers answer differently', () => {
    const first = 'the clairvoyant sees the astral ligbt about a living body'
    const second = 'the clairvoyant sees the astral lirht about a living body'
    const flags = gradeFlags(TRANSCRIPTION, first, second)
    expect(flags[0]).toMatchObject({ first: 'ligbt', second: 'lirht', verdict: 'contested' })
  })

  it('compares both readers against the transcription, not against each other', () => {
    // The two readers differ from the transcription in DIFFERENT places. Graded
    // against each other rather than against the transcription, the indices
    // come from two different word sequences and the pairing is meaningless —
    // here it would marry `ligbt` to whatever the second reader put at its own
    // first disagreement, and call a `dismissed` flag contested.
    const first = 'the clairvoyant sees the astral ligbt about a living body'
    const second = 'the clairvoyant sees the astral light about a livmg body'
    const flags = gradeFlags(TRANSCRIPTION, first, second)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ at: 5, first: 'ligbt', second: null, verdict: 'dismissed' })
  })

  it('grades nothing when there is no second reader, and invents no verdict', () => {
    const first = 'the clairvoyant sees the astral ligbt about a livmg body'
    for (const absent of [null, '', '   ']) {
      const flags = gradeFlags(TRANSCRIPTION, first, absent)
      expect(flags).toHaveLength(2)
      expect(flags.every((f) => f.verdict === 'contested')).toBe(true)
      expect(flags.every((f) => f.second === null)).toBe(true)
    }
  })

  it('ignores the punctuation the two engines argue about as a matter of course', () => {
    const first = 'the clairvoyant sees the astral light, about a living body.'
    expect(gradeFlags(TRANSCRIPTION, first, TRANSCRIPTION)).toEqual([])
  })

  it('keeps the transcription’s word apart from the reader’s', () => {
    // `compareWitnesses(transcription, reader)` puts the TRANSCRIPTION's word
    // in `first` and the reader's in `second`, which reads backwards and was
    // wired backwards the first time. A row that named the transcription's own
    // word as what the reader saw would show the gate two copies of the book.
    const first = 'the clairvoyant sees the astral ligbt about a living body'
    const flags = gradeFlags(TRANSCRIPTION, first, first)
    expect(flags[0]).toMatchObject({ transcription: 'light', first: 'ligbt' })
  })
})

describe('worstFirst', () => {
  const flag = (at: number, verdict: 'corroborated' | 'contested' | 'dismissed') => ({
    at,
    transcription: 'light',
    first: 'ligbt',
    second: verdict === 'dismissed' ? null : 'ligbt',
    verdict
  })

  it('leads with what both readers saw and ends with what only one did', () => {
    const flags = [flag(1, 'dismissed'), flag(2, 'contested'), flag(3, 'corroborated')]
    expect(worstFirst(flags).map((f) => f.at)).toEqual([3, 2, 1])
  })

  it('keeps a leaf in reading order within a verdict, and drops nothing', () => {
    const flags = [flag(9, 'corroborated'), flag(2, 'corroborated'), flag(5, 'corroborated')]
    const sorted = worstFirst(flags)
    expect(sorted.map((f) => f.at)).toEqual([2, 5, 9])
    // Ordering only. A gate that dropped a row here would be two machines
    // voting a reading off the page, which is the one thing this must not do.
    expect(sorted).toHaveLength(flags.length)
  })

  it('does not disturb the array it was given', () => {
    const flags = [flag(1, 'dismissed'), flag(2, 'corroborated')]
    worstFirst(flags)
    expect(flags.map((f) => f.at)).toEqual([1, 2])
  })
})

describe('summarize', () => {
  it('counts each verdict, including the ones that did not happen', () => {
    expect(summarize([])).toEqual({ corroborated: 0, contested: 0, dismissed: 0 })
    const first = 'the clairvoyant sees the astral ligbt about a livmg body'
    const second = 'the clairvoyant sees the astral ligbt about a living body'
    expect(summarize(gradeFlags(TRANSCRIPTION, first, second))).toEqual({
      corroborated: 1,
      contested: 0,
      dismissed: 1
    })
  })
})
