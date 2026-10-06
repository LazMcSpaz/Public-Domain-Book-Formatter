import { describe, it, expect } from 'vitest'
import { assembleBook, folioRuns, leafOfFolio } from '@core/assemble'
import type { PageRole } from '@core/pages'
import type { PageTranscription } from '@core/transcribe'

/**
 * Which leaf of the scan carries which page of the original, read off the
 * folios the leaves print — never off an offset one scan happens to have.
 * What a page reference in the original's contents is resolved through.
 */

function leaf(pageIndex: number, role: PageRole = 'body', folio?: string): PageTranscription {
  return {
    pageIndex,
    role,
    blocks: [],
    uncertain: [],
    furniture: folio === undefined ? {} : { folio }
  }
}

/**
 * The contents and two blanks, then the body from leaf 3 as the original's
 * page 1 — page n on leaf n + 2 — with leaf 7, a chapter opening, printing no
 * folio of its own.
 */
const book = [
  leaf(0, 'table-of-contents', 'v'),
  leaf(1, 'blank'),
  leaf(2, 'blank'),
  leaf(3, 'body', '1'),
  leaf(4, 'body', '2'),
  leaf(5, 'body', '3'),
  leaf(6, 'body', '4'),
  leaf(7, 'chapter-opening'),
  leaf(8, 'body', '6')
]

describe('which leaf carries a page of the original', () => {
  const runs = folioRuns(book)

  it('is read off the folios the leaves print', () => {
    expect(leafOfFolio(runs, 1)).toBe(3)
    expect(leafOfFolio(runs, 3)).toBe(5)
    expect(leafOfFolio(runs, 6)).toBe(8)
  })

  it('fills in a leaf that prints no folio between two that agree', () => {
    expect(leafOfFolio(runs, 5)).toBe(7)
  })

  it('gives no answer for a page the book never prints', () => {
    expect(leafOfFolio(runs, 7)).toBeNull()
    expect(leafOfFolio(runs, 0)).toBeNull()
  })

  /**
   * A plate bound in after page 2 moves the offset: page 2 is leaf 4 and page
   * 4 is leaf 7. Page 3 prints no folio and could be leaf 5 or leaf 6 —
   * nothing says which, so there is no answer for it.
   */
  it('does not interpolate across a change of offset', () => {
    const plated = folioRuns([
      leaf(3, 'body', '1'),
      leaf(4, 'body', '2'),
      leaf(5, 'plate'),
      leaf(6, 'body'),
      leaf(7, 'body', '4'),
      leaf(8, 'body', '5')
    ])
    expect(leafOfFolio(plated, 2)).toBe(4)
    expect(leafOfFolio(plated, 4)).toBe(7)
    expect(leafOfFolio(plated, 3)).toBeNull()
  })

  it('takes one folio out of step with both its neighbours for a misreading', () => {
    const misread = folioRuns([leaf(3, 'body', '1'), leaf(4, 'body', '20'), leaf(5, 'body', '3')])
    expect(leafOfFolio(misread, 2)).toBe(4)
    expect(leafOfFolio(misread, 20)).toBeNull()
  })

  it('travels in the document', () => {
    expect(assembleBook(book).folios).toEqual(runs)
  })
})

/**
 * *The Human Aura* and *The Astral World* bound as one volume: each has its
 * own contents and each numbers its pages from 1, so every folio is printed
 * twice. On its own a folio names no leaf; cited from a work's contents it
 * names the leaf in the work that follows that contents.
 */
describe('a volume that binds two works', () => {
  const bound = folioRuns([
    leaf(2, 'table-of-contents'),
    ...Array.from({ length: 10 }, (_, i) => leaf(4 + i, 'body', String(i + 1))),
    leaf(20, 'table-of-contents'),
    ...Array.from({ length: 10 }, (_, i) => leaf(22 + i, 'body', String(i + 1)))
  ])

  it('gives no answer for a folio both works print, with nothing to choose between them', () => {
    expect(leafOfFolio(bound, 5)).toBeNull()
  })

  it('answers from the work whose contents cites it', () => {
    expect(leafOfFolio(bound, 5, 2)).toBe(8)
    expect(leafOfFolio(bound, 5, 20)).toBe(26)
  })
})
