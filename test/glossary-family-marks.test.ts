import { describe, expect, it } from 'vitest'
import {
  checkGlossaryMarks,
  placeMissingMarks,
  withoutStrayMarks,
  headwordTerms,
  isPersonHeadword,
  type MarkableBlock
} from '@core/annotate'

/**
 * A family entry is circled on the surname where the book first names one of
 * them, as docs/process/glossary.md (G7) says people are matched. The finish
 * check wanted the two words together and reported the entry unmarked.
 */
const para = (id: string, text: string): MarkableBlock => ({ id, kind: 'paragraph', text })

describe('a family entry, matched by surname', () => {
  it('counts a family entry as marked by a circle on the surname, as G7 says', () => {
    // The fault: "Smithers family" circled at "Rev. J. Smithers°" was reported
    // as "glossary mark missing" because the two words were wanted together.
    const heads = ['Smithers family.', 'Fox sisters.']
    const book = [
      para('p1', 'The Rev. J. Smithers° and his daughters sat at the table.'),
      para('p2', 'The Fox° girls heard the rapping first.')
    ]
    expect(isPersonHeadword('Smithers family.')).toBe(true)
    expect(headwordTerms('Smithers family.')).toEqual(['Smithers'])
    // A lower-case first word is not a surname: a "rose family" is botany.
    expect(isPersonHeadword('rose family.')).toBe(false)
    const report = checkGlossaryMarks(heads, book)
    expect(report.marked.map((v) => v.entry)).toEqual(['Smithers family.', 'Fox sisters.'])
    expect(report.unmarked).toEqual([])
    // The circle-placing script reads the same rule: the circle is not a stray.
    expect(withoutStrayMarks(heads, book).removed).toEqual([])
  })

  it('does not count a circle on an unrelated word, a common noun or another man’s first name', () => {
    const report = checkGlossaryMarks(
      ['Smithers family.', 'Fox sisters.'],
      [
        para('p1', 'The Rev. J. Smithers and his daughters° sat at the table.'),
        para('p2', 'A fox° ran past. Fox Talbot° took the picture.')
      ]
    )
    expect(report.marked).toEqual([])
    expect(report.unmarked.map((v) => v.entry)).toEqual(['Smithers family.'])
    // Neither the animal nor Fox Talbot is the family: the book never names it.
    expect(report.absent.map((v) => v.entry)).toEqual(['Fox sisters.'])
    // And the script places the missing circle on the surname.
    const placed = placeMissingMarks(
      ['Smithers family.'],
      [para('p1', 'The Rev. J. Smithers and his daughters sat at the table.')]
    )
    expect(placed.blocks).toEqual([
      { id: 'p1', text: 'The Rev. J. Smithers° and his daughters sat at the table.' }
    ])
  })
})
