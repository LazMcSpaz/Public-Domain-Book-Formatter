import { describe, it, expect } from 'vitest'
import {
  claimedCounts,
  correctionRows,
  correctionsHeader,
  correctionsMarkdown,
  isMarkRestoration,
  wordHunks
} from '@core/edits'

const pristine = [
  {
    id: 'p9b7',
    text: 'the <i>two</i> hemispheres of split-brain patients. 2 Observations regarding'
  },
  { id: 'p12b1', text: 'Erick son was a hut not a bad man, and the flower was angry' },
  { id: 'p3b2', text: 'unchanged text here' },
  { id: 'p40b1', text: 'a note on universal grammar. l7 As we said' }
]
const edited = [
  {
    id: 'p9b7',
    text: 'the <i>two</i> hemispheres of split-brain patients.² Observations regarding'
  },
  // Italic put back and two words corrected: the italic must not be a row.
  { id: 'p12b1', text: '<i>Erickson</i> was a but not a bad man, and the flower was angry' },
  { id: 'p3b2', text: 'unchanged <i>text</i> here' },
  { id: 'p40b1', text: 'a note on universal grammar.¹⁷ As we said' }
]

describe('wordHunks', () => {
  it('names each stretch that differs, as ranges into both lists', () => {
    const a = 'one two three four five six'.split(' ')
    const b = 'one 2 three four 5 5b six'.split(' ')
    expect(wordHunks(a, b)).toEqual([
      { i1: 1, i2: 2, j1: 1, j2: 2 },
      { i1: 4, i2: 5, j1: 4, j2: 6 }
    ])
  })
  it('reports nothing for equal lists and everything for disjoint ones', () => {
    expect(wordHunks(['a', 'b'], ['a', 'b'])).toEqual([])
    expect(wordHunks(['a'], ['b', 'c'])).toEqual([{ i1: 0, i2: 1, j1: 0, j2: 2 }])
  })
})

describe('isMarkRestoration', () => {
  it('accepts a plain digit set as its superscript, spaced or closed up', () => {
    expect(isMarkRestoration('patients. 2 Observations', 'patients.² Observations')).toBe(true)
    expect(isMarkRestoration('remarks1 concerning', 'remarks¹ concerning')).toBe(true)
  })
  it('reads an l or an I in the numeral as a 1, and nowhere else', () => {
    expect(isMarkRestoration('grammar. l7 As', 'grammar.¹⁷ As')).toBe(true)
    expect(isMarkRestoration('grammar. l7 AI', 'grammar.¹⁷ As')).toBe(false)
  })
  it('refuses a change that does more than set the mark', () => {
    expect(isMarkRestoration('hut not a', 'but not a')).toBe(false)
    expect(
      isMarkRestoration('trances. For additional study we recommend it. I For', 'trances.¹ For')
    ).toBe(false)
    expect(isMarkRestoration('patients. 3 Observations', 'patients.² Observations')).toBe(false)
  })
})

describe('correctionRows', () => {
  const rows = correctionRows(pristine, edited)

  it('diffs the bare text, so a restored italic is not a correction', () => {
    expect(rows.words.map((r) => r.blockId)).toEqual(['p12b1', 'p12b1'])
    expect(rows.words.some((r) => r.blockId === 'p3b2')).toBe(false)
  })
  it('windows a few words either side, cut with an ellipsis', () => {
    expect(rows.words[0]).toEqual({
      leaf: 12,
      blockId: 'p12b1',
      printed: 'Erick son was a hut…',
      now: 'Erickson was a but…'
    })
  })
  /**
   * Leaf 32 of *Patterns*: `Va rious` joined and the mark set superscript in
   * one title, three words apart. The two windows overlap, so the printed
   * side reads `…rious States of Consciousness 9` against `…Various States of
   * Consciousness⁹`, and judged on the windows the mark was a word change.
   */
  it('judges a mark on the words that changed, not on a window another change sits in', () => {
    const rows = correctionRows(
      [{ id: 'p32b0', text: 'Nature and Character of Va rious States of Consciousness 9' }],
      [{ id: 'p32b0', text: 'Nature and Character of Various States of Consciousness⁹' }]
    )
    expect(rows.words.map((r) => r.now)).toEqual([
      '…and Character of Various States of Consciousness⁹'
    ])
    expect(rows.marks.map((r) => r.now)).toEqual(['…Various States of Consciousness⁹'])
  })

  it('sets the reference marks apart, in leaf order', () => {
    expect(rows.marks.map((r) => [r.leaf, r.blockId])).toEqual([
      [9, 'p9b7'],
      [40, 'p40b1']
    ])
    expect(rows.marks[0].now).toBe('…hemispheres of split-brain patients.² Observations regarding')
  })
})

describe('the corrections file', () => {
  const header =
    '# Corrections applied to *A Book*\n\n' +
    '5 corrections, 0 reference marks restored, and a note.\n\n' +
    'The prose the editor wrote.\n'

  it('keeps the editor’s prose and brings the counts level with the rows', () => {
    const rows = correctionRows(pristine, edited)
    const out = correctionsMarkdown(header, rows)
    expect(
      out.startsWith(
        '# Corrections applied to *A Book*\n\n2 corrections, 2 reference marks restored, and a note.\n'
      )
    ).toBe(true)
    expect(out).toContain('The prose the editor wrote.\n')
    expect(out).toContain(
      '\n**leaf 12** · `p12b1`  \nprinted: Erick son was a hut…  \nnow: Erickson was a but…\n'
    )
    expect(out).toContain('\n## The reference marks\n')
    expect(claimedCounts(out)).toEqual({ words: 2, marks: 2 })
  })
  it('takes the header back off a written file, and only the header', () => {
    const rows = correctionRows(pristine, edited)
    const out = correctionsMarkdown(header, rows)
    expect(correctionsHeader(out, 'ignored')).toBe(
      '# Corrections applied to *A Book*\n\n2 corrections, 2 reference marks restored, and a note.\n\nThe prose the editor wrote.\n'
    )
    // Round trip: the same rows over the recovered header give the same file.
    expect(correctionsMarkdown(correctionsHeader(out, 'ignored'), rows)).toBe(out)
  })
  it('does not keep the marks heading as prose when the word list was empty', () => {
    const only = correctionRows(pristine.slice(0, 1), edited.slice(0, 1))
    const out = correctionsMarkdown(header, only)
    expect(out).toContain('## The reference marks')
    expect(correctionsHeader(out, 'ignored')).not.toContain('## The reference marks')
  })
  it('starts a file for a book that has none', () => {
    expect(correctionsHeader(null, 'A Book')).toBe(
      '# Corrections applied to *A Book*\n\n0 corrections, 0 reference marks restored.\n'
    )
  })
})
