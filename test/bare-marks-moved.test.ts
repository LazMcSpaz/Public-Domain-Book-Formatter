import { describe, it, expect } from 'vitest'
import { bareMarksMoved, type BookEdit } from '@core/edits'

const declared: BookEdit[] = [
  { kind: 'bare-mark', blockId: 'p43b2', marker: '*', nth: 2, bare: true }
]

describe('a correction that moves a bare-mark declaration', () => {
  it('names a marker whose count the correction changes', () => {
    // A junk asterisk taken out: the second `*` is now a different mark.
    expect(
      bareMarksMoved(
        declared,
        'p43b2',
        'the K<*ab* and the Anouki* seen',
        'the Kab and the Anouki* seen'
      )
    ).toEqual(['*'])
  })

  it('passes a correction that leaves the marks where they were', () => {
    expect(
      bareMarksMoved(declared, 'p43b2', 'teh Anouki* and Isis*', 'the Anouki* and Isis*')
    ).toEqual([])
  })

  it('counts a doubled mark as one mark, not two of the single', () => {
    // `**` becoming two separate `*` is a change for `*`, though the asterisks are the same.
    expect(bareMarksMoved(declared, 'p43b2', 'one** and two*', 'one** and two*')).toEqual([])
    expect(bareMarksMoved(declared, 'p43b2', 'one** and two*', 'one* * and two*')).toEqual(['*'])
  })

  it('looks only at declarations on the block being corrected', () => {
    expect(bareMarksMoved(declared, 'p44b0', 'a* b*', 'a b')).toEqual([])
  })
})
