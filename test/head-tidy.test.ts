import { describe, expect, it } from 'vitest'
import { tidyRunningHead, withoutFinalFullStop, withoutPartLabel } from '@core/layout'

/**
 * What a running head says in a book that tidies its heads (the owner's
 * decision of 19 November 2026): a final full stop dropped from every head,
 * and a leading part label from a topic. Made-up headings in the shapes old
 * books print them.
 */

describe('a final full stop', () => {
  it('is dropped where it ends a sentence', () => {
    const cases: [string, string][] = [
      ['WHAT A KEEPER SHOULD BE.', 'WHAT A KEEPER SHOULD BE'],
      ['Of the Lamp.', 'Of the Lamp'],
      ['Part II.', 'Part II'],
      ['  The Stair.  ', 'The Stair'],
      // Just inside a closing quotation mark or bracket: the mark stays.
      ['“Of the Lamp.”', '“Of the Lamp”'],
      ['The Lamp (concluded.)', 'The Lamp (concluded)']
    ]
    for (const [heading, head] of cases) expect(withoutFinalFullStop(heading), heading).toBe(head)
  })

  it('stays where it is part of what the heading says, or of its last word', () => {
    const kept = [
      'Is the Lamp Lit?',
      'Ring the Bell!',
      'The Word “Lamp”',
      // Initials and words always shortened keep their own full stop.
      'As Told by J. K. L.',
      'Letters to the U.S.A.',
      'Lamps, Stairs, Bells, etc.',
      'A. N. Keeper, Jr.',
      // A heading that is only a figure or a letter is a number.
      '3.',
      'A.',
      // An ellipsis is not a full stop.
      'And so the Lamp...',
      'And so the Lamp…'
    ]
    for (const heading of kept) expect(withoutFinalFullStop(heading), heading).toBe(heading)
  })
})

describe('a leading part label', () => {
  it('is dropped in the forms old books print it', () => {
    const cases: [string, string][] = [
      ['Part II.—Concerning the Lamp', 'Concerning the Lamp'],
      ['PART I.—Concerning the Keeper', 'Concerning the Keeper'],
      ['Part Six — The Long Night', 'The Long Night'],
      ['Part three — the culture of the stair', 'the culture of the stair'],
      ['Part 3: The Bell', 'The Bell'],
      ['Section IV. Of the Water', 'Of the Water'],
      ['Section 12 – The Door', 'The Door'],
      ['Part Two - The Stone', 'The Stone'],
      ['PART XIV.—“The Keeper”', '“The Keeper”']
    ]
    for (const [heading, head] of cases) expect(withoutPartLabel(heading), heading).toBe(head)
  })

  it('stays when it is the whole heading, has no separator, or is not a label', () => {
    const kept = [
      'Part II.',
      'PART TWO',
      'Part II.—',
      'Part One The Keeper',
      'Particulars of the Lamp',
      'Parting — The Lamp',
      'The Lamp, Part II.—Of Oil',
      'Party of Three — The Stair'
    ]
    for (const heading of kept) expect(withoutPartLabel(heading), heading).toBe(heading)
  })
})

describe('a running head, tidied', () => {
  it('drops the part label of a topic, then its full stop', () => {
    expect(tidyRunningHead('Part II.—Concerning the Lamp.', { topic: true })).toBe(
      'Concerning the Lamp'
    )
    expect(tidyRunningHead('Part Three.', { topic: true })).toBe('Part Three')
  })

  it('keeps the part label of anything but a topic', () => {
    expect(tidyRunningHead('Part II.—Concerning the Lamp.', { topic: false })).toBe(
      'Part II.—Concerning the Lamp'
    )
  })
})
