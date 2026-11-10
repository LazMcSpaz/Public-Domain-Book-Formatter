import { describe, expect, it } from 'vitest'
import { exportPages, type ExportVocabulary } from '@core/coherence'

/**
 * An interior's text with its line-end breaks mended, for the spell-check
 * that reads what KDP reads. Each case is a page shape `pdftotext -layout`
 * produced on The Mahatma Letters, and each failed against a fault this
 * function had or the plain extraction has.
 */
const words = new Set([
  'communicate',
  'conscious',
  'consciousness',
  'disembodied',
  'respective',
  'entities',
  'claret',
  'retribution'
])
const book: ExportVocabulary = {
  known: (w) => words.has(w.toLowerCase()),
  hyphenated: new Set(['self-sacrifice', 'beef-and-claret', 'dis-embodied', 'tong-pa-ngi'])
}
const text = (raw: string): string[] => exportPages(raw, book).map((p) => p.text)

describe('exportPages', () => {
  it('joins a word broken at a line end within the page, dropping the hyphen', () => {
    expect(text('can possibly commu-\nnicate with them')).toEqual([
      'can possibly communicate with them'
    ])
  })

  it('joins a second break on a line the first join made', () => {
    // Blanking the absorbed line left "con-" over a blank, read as the foot
    // of the page: two breaks in a row, and the second stayed apart.
    expect(text('The respective enti-\nties are fully con-\nscious. When all')).toEqual([
      'The respective entities are fully conscious. When all'
    ])
  })

  it('keeps the hyphen of a compound the book prints broken at that place', () => {
    expect(text('a life of self-\nsacrifice and')).toEqual(['a life of self-sacrifice and'])
  })

  it('asks about the whole compound, not its last piece', () => {
    expect(text('a beef-and-\nclaret dinner')).toEqual(['a beef-and-claret dinner'])
  })

  it('asks about the whole compound the next line opens with', () => {
    // The book prints `Tong-pa-ngi`; broken at its first hyphen, asking only
    // about `tong-pa` welded it into `Tongpa-ngi`.
    expect(text('before going into “ Tong-\npa-ngi ”—the state')).toEqual([
      'before going into “ Tong-pa-ngi ”—the state'
    ])
  })

  it('joins a word in capitals broken over a line in capitals', () => {
    expect(text('the LAW OF RET-\n RIBUTION, the Law')).toEqual(['the LAW OF RETRIBUTION, the Law'])
  })

  it('drops the hyphen where the book prints the word whole at that place', () => {
    // The book sets both `dis-embodied` and `disembodied`; `disem-` is the second.
    expect(text('with disem-\nbodied Souls')).toEqual(['with disembodied Souls'])
  })

  it('carries a word broken at the foot of a page past the folio and running head', () => {
    const raw =
      'the two worlds can possibly commu-\n\n                52\n\f' +
      '        PHILOSOPHICAL TEACHINGS\n\n\nnicate with them? However'
    expect(text(raw)).toEqual([
      'the two worlds can possibly 52',
      'PHILOSOPHICAL TEACHINGS communicate with them? However'
    ])
  })

  it('carries past a footnote set under the broken line', () => {
    const raw =
      'the two worlds can possibly commu-\n\n¹ A note of the book.\n            52\n\f' +
      'HEAD\nnicate with them'
    expect(text(raw)[1]).toBe('HEAD communicate with them')
  })

  it('leaves a page-turn fragment in halves when nothing on the next page makes a word', () => {
    const raw = 'it was quite unthink-\n\n   52\n\fHEAD\nwith them'
    expect(text(raw)).toEqual(['it was quite unthink- 52', 'HEAD with them'])
  })

  it('names each page by its place in the file', () => {
    expect(exportPages('one\ftwo', book).map((p) => p.id)).toEqual(['page1', 'page2'])
  })
})
