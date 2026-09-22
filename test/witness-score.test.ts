import { describe, it, expect } from 'vitest'
import { scoreWitness, scoreWitnesses } from '@core/witness/score'

const truth = 'the aura is seen as a luminous cloud surrounding the body of the person'

describe('scoreWitness — is what a witness raises worth a person’s time?', () => {
  it('a witness that disagrees exactly where the first reader is wrong scores perfectly', () => {
    const first = 'the aura is seen as a lurninous cloud surrounding the body of the persou'
    const witness = truth
    const s = scoreWitness(first, witness, truth)
    expect(s.errors).toBe(2)
    expect(s.raised).toBe(2)
    expect(s.hits).toBe(2)
    expect(s.caught).toBe(2)
    expect(s.missed).toBe(0)
    expect(s.precision).toBe(1)
    expect(s.recall).toBe(1)
  })

  it('counts a disagreement on a word the first reader had right as a false alarm', () => {
    const first = 'the aura is seen as a lurninous cloud surrounding the body of the person'
    const witness = 'the aura is seen as a luminous cloud surrounding the bcdy of the person'
    const s = scoreWitness(first, witness, truth)
    expect(s.errors).toBe(1)
    expect(s.raised).toBe(2)
    expect(s.hits).toBe(1)
    expect(s.precision).toBe(0.5)
    expect(s.recall).toBe(1)
  })

  it('an error both readers make alike is missed, and said so', () => {
    const first = 'the aura is seen as a lurninous cloud surrounding the body of the person'
    const witness = first
    const s = scoreWitness(first, witness, truth)
    expect(s.raised).toBe(0)
    expect(s.precision).toBeNull()
    expect(s.errors).toBe(1)
    expect(s.caught).toBe(0)
    expect(s.missed).toBe(1)
    expect(s.recall).toBe(0)
  })

  it('a line-break hyphen the readers heal differently is not raised', () => {
    const first = 'the aura is seen as a lumi- nous cloud surrounding the body of the person'
    const witness = truth
    const s = scoreWitness(first, witness, truth)
    expect(s.raised).toBe(0)
    expect(s.errors).toBe(0)
    expect(s.recall).toBeNull()
  })

  it('a word the first reader dropped is an error the witness can catch', () => {
    const first = 'the aura is seen as a luminous cloud the body of the person'
    const s = scoreWitness(first, truth, truth)
    expect(s.errors).toBe(1)
    expect(s.caught).toBe(1)
    expect(s.recall).toBe(1)
  })
})

describe('scoreWitnesses — two witnesses together', () => {
  it('counts an error caught by either, once', () => {
    const first = 'the aura is seen as a lurninous cloud surrounding the body of the persou'
    // One witness right about the first word and wrong about the second; the other the reverse.
    const a = 'the aura is seen as a luminous cloud surrounding the body of the persou'
    const b = 'the aura is seen as a lurninous cloud surrounding the body of the person'
    expect(scoreWitness(first, a, truth).caught).toBe(1)
    expect(scoreWitness(first, b, truth).caught).toBe(1)
    const both = scoreWitnesses(first, [a, b], truth)
    expect(both.errors).toBe(2)
    expect(both.caught).toBe(2)
    expect(both.recall).toBe(1)
    expect(both.raised).toBe(2)
  })
})
