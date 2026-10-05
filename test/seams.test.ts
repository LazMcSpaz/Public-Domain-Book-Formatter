import { describe, it, expect } from 'vitest'
import { assembleBook, leafStart, type BookBlock, type BookDocument } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { fixedWidthMeasurer, layout, pageOfWord, type LaidOutBook } from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'

/**
 * Where, inside a paragraph joined across leaves, each later leaf begins —
 * and where, inside a paragraph set across pages, each later page begins.
 *
 * The two halves of one question the contents of *The Mahatma Letters* asks:
 * its references name pages of the 1923 printing, most of which open in the
 * middle of a paragraph, and the answer has to be the page of this edition
 * that paragraph's word fell on — not the page the paragraph opened on.
 */

function page(pageIndex: number, blocks: TranscribedBlock[]): PageTranscription {
  return { pageIndex, role: 'body', blocks, uncertain: [], furniture: {} }
}
const para = (text: string, extra: Partial<TranscribedBlock> = {}): TranscribedBlock => ({
  kind: 'paragraph',
  text,
  ...extra
})

const words = (text: string): string[] => text.split(/\s+/u).filter(Boolean)

describe('assembly records where each leaf begins in a joined paragraph', () => {
  it('names the first word the second leaf contributed', () => {
    const doc = assembleBook([
      page(4, [para('the alembick being set upon')]),
      page(5, [para('a gentle fire it was watched.')])
    ])
    const [block] = doc.blocks
    expect(block!.sourcePages).toEqual([4, 5])
    expect(block!.seams).toEqual([{ page: 5, word: 5 }])
    expect(words(block!.text)[5]).toBe('a')
  })

  /**
   * `chirur-` over `geon`: the seam heals a word, and the word it makes began
   * on the earlier leaf. It is still the first word the later leaf holds any of,
   * and counted on the joined text it is one word, not two.
   */
  it('counts a word healed at the seam as the word it makes', () => {
    const doc = assembleBook([
      page(4, [para('Nowe the cunning chirur-')]),
      page(5, [para('geon his art was shown.')])
    ])
    const [block] = doc.blocks
    expect(block!.text).toBe('Nowe the cunning chirurgeon his art was shown.')
    expect(block!.seams).toEqual([{ page: 5, word: 3 }])
    expect(words(block!.text)[3]).toBe('chirurgeon')
  })

  it('carries one seam a leaf through a paragraph that crosses two', () => {
    const doc = assembleBook([
      page(1, [para('one two three')]),
      page(2, [para('four five')]),
      page(3, [para('six seven eight.')])
    ])
    expect(doc.blocks[0]!.seams).toEqual([
      { page: 2, word: 3 },
      { page: 3, word: 5 }
    ])
  })

  it('records none on a paragraph read off one leaf', () => {
    const doc = assembleBook([page(1, [para('A whole thought.'), para('And another.')])])
    expect(doc.blocks.every((b) => b.seams === undefined)).toBe(true)
  })

  it('finds a leaf’s first word in the block that carries it', () => {
    const doc = assembleBook([
      page(1, [para('A whole thought.'), para('the start of')]),
      page(2, [para('something long.'), para('Then more.')])
    ])
    expect(leafStart(doc.blocks, 2)).toEqual({ blockId: 'p1b1', word: 3, exact: true })
    expect(leafStart(doc.blocks, 1)).toEqual({ blockId: 'p1b0', word: 0, exact: true })
    expect(leafStart(doc.blocks, 9)).toBeNull()
  })
})

describe('an edit keeps the seams on the words they named', () => {
  // `one two three` on leaf 1, `four five six seven` on leaf 2: leaf 2 begins
  // at `four`, word 3.
  const doc = (): BookDocument =>
    assembleBook([page(1, [para('one two three')]), page(2, [para('four five six seven.')])])
  const seamWord = (d: BookDocument, id = 'p1b0'): string => {
    const block = d.blocks.find((b) => b.id === id)!
    return words(block.text)[block.seams![0]!.word]!
  }

  it('follows a retyping that adds a word before the seam', () => {
    const edited = applyEdits(doc(), [
      { kind: 'text', blockId: 'p1b0', text: 'one and two three four five six seven.' }
    ])
    expect(edited.blocks[0]!.seams).toEqual([{ page: 2, word: 4 }])
    expect(seamWord(edited)).toBe('four')
  })

  it('leaves it where it was when the change comes after it', () => {
    const edited = applyEdits(doc(), [
      { kind: 'text', blockId: 'p1b0', text: 'one two three four five six, and seven.' }
    ])
    expect(seamWord(edited)).toBe('four')
  })

  it('follows a retyping that takes words away before the seam', () => {
    const edited = applyEdits(doc(), [
      { kind: 'text', blockId: 'p1b0', text: 'three four five six seven.' }
    ])
    expect(seamWord(edited)).toBe('four')
  })

  it('gives each half of a split the seams and the leaves it covers', () => {
    // Split before the seam: the second half opens on leaf 1 and carries it.
    const before = applyEdits(doc(), [{ kind: 'split', blockId: 'p1b0', at: 'one '.length }])
    const [a, b] = before.blocks
    expect(a).toMatchObject({ id: 'p1b0/1', sourcePages: [1] })
    expect(a!.seams).toBeUndefined()
    expect(b).toMatchObject({ id: 'p1b0/2', sourcePages: [1, 2], seams: [{ page: 2, word: 2 }] })
    expect(seamWord(before, 'p1b0/2')).toBe('four')

    // Split after it: the second half opens on leaf 2 and needs no seam.
    const after = applyEdits(doc(), [
      { kind: 'split', blockId: 'p1b0', at: 'one two three four '.length }
    ])
    expect(after.blocks[0]).toMatchObject({ sourcePages: [1, 2], seams: [{ page: 2, word: 3 }] })
    expect(after.blocks[1]!.sourcePages).toEqual([2])
    expect(after.blocks[1]!.seams).toBeUndefined()
    expect(leafStart(after.blocks, 2)).toEqual({ blockId: 'p1b0/1', word: 3, exact: true })
  })

  it('carries the second block’s leaves into a merge', () => {
    // Two paragraphs the reading kept apart across a leaf, merged by hand.
    const apart = assembleBook([
      page(1, [para('The first half ends.')]),
      page(2, [para('The second begins here.')])
    ])
    expect(apart.blocks).toHaveLength(2)
    const merged = applyEdits(apart, [{ kind: 'merge', blockId: 'p1b0' }])
    expect(merged.blocks[0]!.seams).toEqual([{ page: 2, word: 4 }])
    expect(words(merged.blocks[0]!.text)[4]).toBe('The')

    // And a merge of a block that already had one shifts it along.
    const joined = assembleBook([
      page(1, [para('Opening paragraph.')]),
      page(2, [para('a b c')]),
      page(3, [para('d e.')])
    ])
    const both = applyEdits(joined, [{ kind: 'merge', blockId: 'p1b0' }])
    expect(both.blocks[0]!.seams).toEqual([
      { page: 2, word: 2 },
      { page: 3, word: 5 }
    ])
  })
})

/**
 * A paragraph set across a page break: the layout says where it opened and,
 * now, the first word that begins on each page it runs on to.
 */
describe('the layout records where a block runs on to another page', () => {
  const measurer = fixedWidthMeasurer(0.5)
  // Every word its own, so a word on a page says which word of the block it is.
  const text = Array.from({ length: 1500 }, (_, i) => `w${i}`).join(' ')
  const doc: BookDocument = {
    blocks: [
      { id: 'b0', kind: 'heading', level: 1, text: 'Of the Air', sourcePages: [0] },
      { id: 'b1', kind: 'paragraph', text, sourcePages: [0] } as BookBlock
    ],
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  }
  const book: LaidOutBook = layout(doc, defaultStyleProfile(), measurer, {
    edition: { title: 'T', author: 'A' }
  })
  const entry = book.blockPages.find((b) => b.blockId === 'b1')!

  /** The block's words in the order a page prints them. */
  const wordsOn = (pageIndex: number): string[] =>
    book.pages[pageIndex]!.items.flatMap((item) =>
      item.kind === 'line' ? item.runs.map((r) => r.text).filter((t) => /^w\d+$/u.test(t)) : []
    )

  it('names the first word that begins on each later page', () => {
    expect(entry.turns!.length).toBeGreaterThan(1)
    for (const turn of entry.turns!) {
      const here = wordsOn(turn.pageIndex)
      expect(here[0]).toBe(`w${turn.word}`)
      // And the page before ends on the word before it: nothing between.
      const before = wordsOn(turn.pageIndex - 1)
      expect(before[before.length - 1]).toBe(`w${turn.word - 1}`)
      expect(turn.folio).toBe(book.pages[turn.pageIndex]!.folio)
    }
  })

  it('puts a word past a page break on the page it was set on', () => {
    const turn = entry.turns![1]!
    const word = turn.word + 3
    expect(wordsOn(turn.pageIndex)).toContain(`w${word}`)
    expect(pageOfWord(entry, word)).toBe(turn.pageIndex)
    // Not the page the paragraph opened on, which is what was known before.
    expect(pageOfWord(entry, word)).not.toBe(entry.pageIndex)
    expect(pageOfWord(entry, turn.word - 1)).toBe(entry.turns![0]!.pageIndex)
  })
})

/**
 * A word broken by a hyphen at the foot of a page began on that page, and the
 * page after it opens on the rest of it. The turn names the first word that
 * *begins* on the new page — so a page of the original whose first word is the
 * broken one is sent to the page the word began on, where a reader finds it.
 */
describe('a word hyphenated over a page break', () => {
  const text = Array.from({ length: 1500 }, (_, i) => `wordling${i}`).join(' ')
  const doc: BookDocument = {
    blocks: [
      { id: 'b0', kind: 'heading', level: 1, text: 'Of the Air', sourcePages: [0] },
      { id: 'b1', kind: 'paragraph', text, sourcePages: [0] } as BookBlock
    ],
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  }
  const book = layout(doc, defaultStyleProfile(), fixedWidthMeasurer(0.5), {
    edition: { title: 'T', author: 'A' },
    hyphenate: (w) => (w.length > 6 ? [w.slice(0, 4), w.slice(4)] : [w])
  })
  const entry = book.blockPages.find((b) => b.blockId === 'b1')!
  const runsOn = (pageIndex: number): string[] =>
    book.pages[pageIndex]!.items.flatMap((item) =>
      item.kind === 'line' ? item.runs.map((r) => r.text) : []
    )

  it('belongs to the page it began on', () => {
    // The fixture has to break a word over a page, or it tests nothing.
    const broken = entry.turns!.filter((t) => !/^wordling\d+$/u.test(runsOn(t.pageIndex)[0]!))
    expect(broken.length).toBeGreaterThan(0)
    for (const turn of broken) {
      const first = runsOn(turn.pageIndex).find((t) => /^wordling\d+$/u.test(t))
      expect(first).toBe(`wordling${turn.word}`)
      expect(runsOn(turn.pageIndex - 1)).toContain('word-')
      expect(pageOfWord(entry, turn.word - 1)).toBe(turn.pageIndex - 1)
    }
  })
})
