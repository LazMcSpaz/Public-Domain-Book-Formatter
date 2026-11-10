import { describe, expect, it } from 'vitest'
import { bookText, printedTexts, type BookDocument } from '@core/assemble'

/**
 * What the book prints, for a check that reads words.
 *
 * KDP's spell-check of The Mahatma Letters found `deaih-bed`, `crueily` and
 * `physcists` in Barker's analytical contents, after the spelling sheet had
 * been read and every suspect on it cropped: the sheet kept its own list of
 * what the book is, and the contents' descriptions were not on it. These
 * assert the shared list carries every kind of matter the book prints, so a
 * check built on it cannot read less of the book than a reader does.
 */
const doc = {
  sections: [
    {
      placement: 'front',
      label: 'Note',
      title: 'A Note on This Edition',
      blocks: [{ id: 'front/b0', kind: 'paragraph', text: 'Newly set.' }]
    },
    {
      placement: 'back',
      title: 'Glossary',
      blocks: [{ id: 'glossary/b0', kind: 'paragraph', text: 'Akasa.' }]
    }
  ],
  chapters: [
    {
      id: 'p40b0',
      title: 'Letter No. I',
      synopsis: 'Advice to those assisting at a deaih-bed',
      synopsisSource: { pages: [24], references: [] }
    }
  ],
  synopsesUnmatched: [{ synopsis: 'some calculations for physcists', source: { pages: [23] } }],
  blocks: [{ id: 'p40b1', kind: 'paragraph', text: 'The body of the letter.', sourcePages: [40] }],
  asides: [{ id: 'aside-1', kind: 'epigraph', text: 'An epigraph.', sourcePages: [2] }],
  illustrations: [{ caption: 'K.H. crueily drawn' }],
  footnotes: [{ id: 'fn1', text: 'A note of the book.' }],
  skipped: []
} as unknown as BookDocument

describe('printedTexts', () => {
  it('carries the original contents’ descriptions, matched to a chapter or not', () => {
    const texts = printedTexts(doc, { markup: false }).map((t) => t.text)
    expect(texts).toContain('Advice to those assisting at a deaih-bed')
    expect(texts).toContain('some calculations for physcists')
  })

  it('carries the captions, the matter set apart, the notes and both sets of sections', () => {
    const texts = printedTexts(doc, { markup: false }).map((t) => t.text)
    for (const t of [
      'K.H. crueily drawn',
      'An epigraph.',
      'A note of the book.',
      'Newly set.',
      'Akasa.',
      'The body of the letter.'
    ]) {
      expect(texts).toContain(t)
    }
  })

  it('names where each stretch comes from, a block by its id and a note by its number', () => {
    const ids = printedTexts(doc).map((t) => t.id)
    expect(ids).toContain('p40b1')
    expect(ids).toContain('fn1')
    expect(ids.some((id) => id.startsWith('synopsis'))).toBe(true)
  })

  it('is bookText a stretch at a time, so the two cannot disagree', () => {
    expect(
      printedTexts(doc)
        .map((t) => t.text)
        .join('\n')
    ).toBe(bookText(doc))
  })
})
