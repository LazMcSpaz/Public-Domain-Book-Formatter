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
    expect(headwordTerms('Smithers family.')).toEqual(['Smithers family', 'Smithers'])
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

  it('still counts a circle on the whole phrase of a term shaped like a family', () => {
    // "Elder Brothers" is a term, not a surname: read only as a name, "Elder"
    // is followed by a capital, the entry went "absent" and the sweep took
    // its right circle out.
    const heads = ['Elder Brothers.', 'Rose family.']
    const book = [
      para('p1', 'The Elder Brothers° of the race watch over it.'),
      para('p2', 'The plant belongs to the Rose family°.')
    ]
    const report = checkGlossaryMarks(heads, book)
    expect(report.marked.map((v) => v.entry)).toEqual(['Elder Brothers.', 'Rose family.'])
    expect(withoutStrayMarks(heads, book).removed).toEqual([])
    // An unmarked use takes its circle on the whole phrase, matched as before.
    const placed = placeMissingMarks(['Elder Brothers.'], [para('p3', 'the elder brothers wait')])
    expect(placed.blocks).toEqual([{ id: 'p3', text: 'the elder brothers° wait' }])
    // The sweep keeps that circle: the phrase is matched as before, not as a name.
    expect(
      withoutStrayMarks(
        ['Elder Brothers.'],
        placed.blocks.map((b) => para(b.id, b.text))
      ).removed
    ).toEqual([])
  })

  it('places a missing circle on whichever the book uses first, the surname or the phrase', () => {
    const surnameFirst = placeMissingMarks(
      ['Smithers family.'],
      [
        para('p1', 'The Rev. J. Smithers and his daughters sat at the table.'),
        para('p2', 'Years later the Smithers family moved away.')
      ]
    )
    expect(surnameFirst.blocks).toEqual([
      { id: 'p1', text: 'The Rev. J. Smithers° and his daughters sat at the table.' }
    ])
    // Where the phrase comes first, it starts with the surname: the circle
    // goes on the surname there, as G7 says.
    const phraseFirst = placeMissingMarks(
      ['Smithers family.'],
      [
        para('p1', 'The Smithers family lived by the church.'),
        para('p2', 'The Rev. J. Smithers sat at the table.')
      ]
    )
    expect(phraseFirst.blocks).toEqual([
      { id: 'p1', text: 'The Smithers° family lived by the church.' }
    ])
  })
})
