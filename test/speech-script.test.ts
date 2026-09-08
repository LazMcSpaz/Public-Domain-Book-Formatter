/**
 * A chapter as a script: what gets read, in what order, and what is refused.
 *
 * The refusals matter more than the readings. A paragraph dropped from a
 * printed page is visible; a paragraph dropped from six hours of audio is not,
 * and the listener has no way to know anything was there.
 */
import { describe, expect, it } from 'vitest'
import {
  chapterBlocks,
  chapterNotes,
  expectedSeconds,
  readChapter,
  withoutSilentMarks
} from '@core/speech'
import type { Pronunciation } from '@core/speech'
import type { BookDocument } from '@core/assemble'

const block = (id: string, kind: string, text: string, pages = [0]) =>
  ({ id, kind, text, sourcePages: pages }) as BookDocument['blocks'][number]

function bookOf(overrides: Partial<BookDocument> = {}): BookDocument {
  return {
    blocks: [],
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    ...overrides
  } as BookDocument
}

const TWO_CHAPTERS = bookOf({
  blocks: [
    block('p1b0', 'heading', 'CHAPTER I.'),
    block('p1b1', 'heading', 'WHAT IS THE HUMAN AURA?'),
    block('p1b2', 'paragraph', 'The above question is frequently asked.'),
    block('p2b0', 'paragraph', 'The dictionaries define the word aura.', [2]),
    block('p3b0', 'heading', 'CHAPTER II.', [3]),
    block('p3b1', 'heading', 'THE PRANA-AURA.', [3]),
    block('p3b2', 'paragraph', 'A second chapter begins.', [3])
  ],
  chapters: [
    { id: 'p1b0', title: 'WHAT IS THE HUMAN AURA?', label: 'CHAPTER I.', level: 1 },
    { id: 'p3b0', title: 'THE PRANA-AURA.', label: 'CHAPTER II.', level: 1 }
  ] as BookDocument['chapters']
})

describe('chapterBlocks', () => {
  it('slices from one chapter opening to the next', () => {
    expect(chapterBlocks(TWO_CHAPTERS, 0).map((b) => b.id)).toEqual([
      'p1b0',
      'p1b1',
      'p1b2',
      'p2b0'
    ])
  })

  it('runs the last chapter to the end of the book', () => {
    expect(chapterBlocks(TWO_CHAPTERS, 1).map((b) => b.id)).toEqual(['p3b0', 'p3b1', 'p3b2'])
  })

  it('keeps both headings of a two-line opening', () => {
    // Counting headings rather than slicing on the entry's own id would start
    // every chapter one block late and drop its number line.
    const first = chapterBlocks(TWO_CHAPTERS, 0)
    expect(first.filter((b) => b.kind === 'heading')).toHaveLength(2)
  })

  it('is empty for a chapter that is not there', () => {
    expect(chapterBlocks(TWO_CHAPTERS, 9)).toEqual([])
  })
})

describe('readChapter', () => {
  it('reads the headings, then the prose, with silence between', () => {
    const script = readChapter(TWO_CHAPTERS, 0)
    expect(script.pieces.map((p) => p.kind)).toEqual([
      'heading',
      'pause',
      'heading',
      'pause',
      'paragraph',
      'pause',
      'paragraph'
    ])
    // Longer after a heading than between paragraphs, or a chapter opens as if
    // its title were the first sentence of it.
    const [afterHeading, betweenParagraphs] = script.pieces
      .filter((p) => p.kind === 'pause')
      .slice(1)
      .map((p) => p.seconds ?? 0)
    expect(afterHeading).toBeGreaterThan(betweenParagraphs)
  })

  it('writes a chapter number out, and only in a heading', () => {
    const book = bookOf({
      blocks: [
        block('p1b0', 'heading', 'CHAPTER I.'),
        block('p1b1', 'paragraph', 'I have seen it myself, and I say so.')
      ],
      chapters: [{ id: 'p1b0', title: 'A', level: 1 }] as BookDocument['chapters']
    })
    const said = readChapter(book, 0).pieces.filter((p) => p.text)
    expect(said[0].text).toBe('CHAPTER One.')
    expect(said[1].text).toBe('I have seen it myself, and I say so.')
  })

  it('applies the pronunciation list to prose and headings alike', () => {
    const list: Pronunciation[] = [
      { word: 'Siddhis', say: 'siddees', expect: 'x', dialect: 'en', sounds: 'SID-eez' }
    ]
    const book = bookOf({
      blocks: [
        block('p1b0', 'heading', 'THE SIDDHIS'),
        block('p1b1', 'paragraph', 'The Siddhis are not a fifth.')
      ],
      chapters: [{ id: 'p1b0', title: 'A', level: 1 }] as BookDocument['chapters']
    })
    const said = readChapter(book, 0, list).pieces.filter((p) => p.text)
    expect(said[0].text).toBe('THE siddees')
    expect(said[1].text).toBe('The siddees are not a fifth.')
  })

  it('reports a block it cannot read rather than dropping it', () => {
    const book = bookOf({
      blocks: [
        block('p1b0', 'heading', 'CHAPTER I.'),
        block('p1b1', 'table', 'red | courage\nblue | calm'),
        block('p1b2', 'paragraph', ''),
        block('p1b3', 'paragraph', 'Real prose.')
      ],
      chapters: [{ id: 'p1b0', title: 'A', level: 1 }] as BookDocument['chapters']
    })
    const script = readChapter(book, 0)
    expect(script.unread.map((u) => u.id)).toEqual(['p1b1', 'p1b2'])
    expect(script.unread[0].why).toMatch(/table/u)
    expect(script.pieces.filter((p) => p.kind === 'paragraph')).toHaveLength(1)
  })

  it('accounts for every block, as a script piece or as unread', () => {
    // The invariant the whole module exists for, asserted rather than assumed.
    const book = bookOf({
      blocks: [
        block('p1b0', 'heading', 'CHAPTER I.'),
        block('p1b1', 'paragraph', 'One.'),
        block('p1b2', 'table', 'a | b'),
        block('p1b3', 'quote', 'Two.'),
        block('p1b4', 'caption', 'Three.'),
        block('p1b5', 'paragraph', '   ')
      ],
      chapters: [{ id: 'p1b0', title: 'A', level: 1 }] as BookDocument['chapters']
    })
    const script = readChapter(book, 0)
    const accounted = new Set([
      ...script.pieces.flatMap((p) => (p.id ? [p.id] : [])),
      ...script.unread.map((u) => u.id)
    ])
    expect([...accounted].sort()).toEqual(['p1b0', 'p1b1', 'p1b2', 'p1b3', 'p1b4', 'p1b5'])
  })

  it('reads the chapter notes at the end, announced', () => {
    const book = bookOf({
      blocks: [
        block('p1b0', 'heading', 'CHAPTER I.'),
        block('p1b1', 'paragraph', 'Prose with a mark in it.')
      ],
      chapters: [{ id: 'p1b0', title: 'A', level: 1 }] as BookDocument['chapters'],
      footnotes: [
        {
          id: 'n1',
          originalMarker: '1',
          text: 'Roentgen, in 1895.',
          pageIndex: 0,
          orphaned: false,
          anchor: { blockId: 'p1b1', at: 4 }
        }
      ] as BookDocument['footnotes']
    })
    const script = readChapter(book, 0)
    const kinds = script.pieces.map((p) => p.kind)
    expect(kinds.slice(-3)).toEqual(['note-intro', 'pause', 'note'])
    expect(script.pieces.at(-3)?.text).toMatch(/A note to this chapter/u)
  })

  it('leaves another chapter notes to that chapter', () => {
    const book = bookOf({
      blocks: [
        block('p1b0', 'heading', 'CHAPTER I.'),
        block('p1b1', 'paragraph', 'One.'),
        block('p9b0', 'heading', 'CHAPTER II.', [9]),
        block('p9b1', 'paragraph', 'Two.', [9])
      ],
      chapters: [
        { id: 'p1b0', title: 'A', level: 1 },
        { id: 'p9b0', title: 'B', level: 1 }
      ] as BookDocument['chapters'],
      footnotes: [
        { id: 'n1', originalMarker: '1', text: 'First.', pageIndex: 0, orphaned: false },
        { id: 'n2', originalMarker: '2', text: 'Second.', pageIndex: 9, orphaned: false }
      ] as BookDocument['footnotes']
    })
    expect(chapterNotes(book, chapterBlocks(book, 0)).map((n) => n.id)).toEqual(['n1'])
    expect(chapterNotes(book, chapterBlocks(book, 1)).map((n) => n.id)).toEqual(['n2'])
  })
})

describe('withoutSilentMarks', () => {
  it('takes out the glossary circle, which is a degree sign', () => {
    // Measured on this shelf's own text: `occultism°` is read as
    // "occultism degrees", so a book marking a hundred headwords gains a
    // hundred spoken words the author never wrote.
    expect(withoutSilentMarks('the student of occultism° by some one')).toBe(
      'the student of occultism by some one'
    )
  })

  it('leaves alone everything a reader would actually say', () => {
    const line = 'He wrote — in 1875 — of "the aura," its colors, and Vicq d\'Azyr.'
    expect(withoutSilentMarks(line)).toBe(line)
  })
})

describe('readChapter, on marked text', () => {
  it('never hands a glossary mark to the voice', () => {
    const book = bookOf({
      blocks: [
        block('p1b0', 'heading', 'CHAPTER I.'),
        block('p1b1', 'paragraph', 'The dictionaries define the word aura\u00b0 as an emanation.')
      ],
      chapters: [{ id: 'p1b0', title: 'A', level: 1 }] as BookDocument['chapters']
    })
    const said = readChapter(book, 0).pieces.filter((p) => p.text)
    expect(said.some((p) => (p.text ?? '').includes('\u00b0'))).toBe(false)
    expect(said[1].text).toBe('The dictionaries define the word aura as an emanation.')
  })
})

describe('expectedSeconds', () => {
  it('counts the silence as well as the words', () => {
    const script = readChapter(TWO_CHAPTERS, 0)
    const silence = script.pieces.reduce((n, p) => n + (p.seconds ?? 0), 0)
    expect(expectedSeconds(script)).toBeCloseTo(script.words / 2.6 + silence, 5)
    expect(expectedSeconds(script)).toBeGreaterThan(silence)
  })
})
