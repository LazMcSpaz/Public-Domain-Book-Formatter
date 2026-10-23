import { describe, expect, it } from 'vitest'
import { checkSpelling } from '@core/coherence'

/**
 * The check KDP's reviewer ran and this shelf had not: unknown words, graded
 * by how alone they stand. A dictionary of ten words is enough to pin the
 * rules, because the rules are about company, not vocabulary.
 */
const dictionary = new Set([
  'the',
  'thing',
  'which',
  'see',
  'moving',
  'alive',
  'twisting',
  'turning',
  'level',
  'again',
  'inventor'
])
const block = (id: string, text: string) => ({ id, text })

describe('words no dictionary knows, graded by their company', () => {
  it('lists a word used once and nowhere on the shelf as alone, with its context', () => {
    const report = checkSpelling(
      [
        block('p1', 'twisting and turning a sthough alive'),
        block('p2', 'the thing which we see miving')
      ],
      dictionary
    )
    expect(report.alone.map((s) => s.word)).toEqual(['miving', 'sthough'])
    expect(report.alone[1]).toMatchObject({ blockId: 'p1', count: 1, shelf: 0, capitalised: false })
    expect(report.alone[1]!.context).toContain('a sthough alive')
  })

  it('moves a word the book uses again, or the shelf knows, out of the alone list', () => {
    const shelf = new Map([['arupa', 40]])
    const report = checkSpelling(
      [block('p1', 'the arupa level, and the Devachan, and Devachan again')],
      dictionary,
      shelf
    )
    expect(report.alone).toEqual([])
    expect(report.repeated.map((s) => [s.word, s.count, s.shelf])).toEqual([
      ['arupa', 1, 40],
      ['Devachan', 2, 0]
    ])
  })

  it('reads through markup and counts a word in any capitalisation as one word', () => {
    const report = checkSpelling(
      [
        block('p1', '<i>Whenthe</i> inventor; whenthe again'),
        block('p2', 'see <b>Peterborough</b>')
      ],
      dictionary
    )
    const when = report.repeated.find((s) => s.word === 'Whenthe')!
    expect(when.count).toBe(2)
    expect(when.capitalised).toBe(false)
    expect(report.alone.map((s) => [s.word, s.capitalised])).toEqual([['Peterborough', true]])
  })

  it('leaves short words and anything with digits to the damage check', () => {
    const report = checkSpelling([block('p1', 'the xyz and 4th and co2 and sthough')], dictionary)
    expect(report.alone.map((s) => s.word)).toEqual(['sthough'])
  })

  it('counts the shelf floor as the number of uses below which a word is alone there', () => {
    const shelf = new Map([['whenthe', 2]])
    const low = checkSpelling([block('p1', 'see Whenthe')], dictionary, shelf, { shelfFloor: 3 })
    const high = checkSpelling([block('p1', 'see Whenthe')], dictionary, shelf, { shelfFloor: 2 })
    expect(low.alone.map((s) => s.word)).toEqual(['Whenthe'])
    expect(high.alone).toEqual([])
  })
})
