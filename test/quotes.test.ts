import { describe, expect, it } from 'vitest'
import { typographicQuotes } from '@core/layout'

/**
 * Turning typewriter marks into printer's marks.
 *
 * Written against the book that prompted it: a 1916 reprint whose transcription
 * came back with 642 straight double quotes against 229 curly ones, because the
 * model reads a real mark off the paper on one line and types a plain one on
 * the next.
 */
describe('typographic quotes', () => {
  it('opens after a space and closes after a word', () => {
    expect(typographicQuotes('He said "hello" to me.')).toBe('He said “hello” to me.')
  })

  it('opens at the very start of a block', () => {
    expect(typographicQuotes('"We plunged into the jungle."')).toBe('“We plunged into the jungle.”')
  })

  it('handles a quotation inside a quotation', () => {
    // Three pages of the Cazotte supper are dialogue inside dialogue, and the
    // same rule has to serve both levels.
    expect(typographicQuotes(`"'Ah,' said Condorcet, 'let us hear!'"`)).toBe(
      '“‘Ah,’ said Condorcet, ‘let us hear!’”'
    )
  })

  it('makes an apostrophe inside a word a closing mark', () => {
    expect(typographicQuotes("the teacher's statements")).toBe('the teacher’s statements')
    expect(typographicQuotes("don't")).toBe('don’t')
  })

  it('leaves a period elision as an apostrophe, not an opening quote', () => {
    // "'tis" after a space would otherwise open a quotation that never closes.
    expect(typographicQuotes("and 'tis so")).toBe('and ’tis so')
    expect(typographicQuotes("frightening them out of their wits by 'em")).toContain('’em')
  })

  it('steps over an italic tag rather than counting it as a letter', () => {
    // A quotation opening on an italicised word has a tag between the space and
    // the mark. Treating ">" as an ordinary character closes every one of them.
    expect(typographicQuotes('the words <i>"far off"</i> mean')).toBe(
      'the words <i>“far off”</i> mean'
    )
  })

  it('opens after an opening bracket', () => {
    expect(typographicQuotes('(the "astral" body)')).toBe('(the “astral” body)')
  })

  it('leaves marks that are already printer’s marks alone', () => {
    const already = '“Occasional flashes of clairvoyance,” he wrote.'
    expect(typographicQuotes(already)).toBe(already)
  })

  it('is idempotent, because layoutWithToc runs the layout twice', () => {
    const once = typographicQuotes('He said "hello" and \'twas over.')
    expect(typographicQuotes(once)).toBe(once)
  })
})

describe('the whole document', () => {
  it('straightens the contents synopsis, which is prose like any other', async () => {
    const { withTypographicQuotes } = await import('@core/layout')
    const doc = {
      blocks: [],
      footnotes: [],
      chapters: [
        {
          id: 'p0b0',
          title: 'THE ASTRAL SENSES.',
          label: 'LESSON I.',
          level: 1,
          blockIndex: 0,
          sourcePage: 0,
          synopsis: 'The man who has much to say about "horse sense."'
        }
      ],
      asides: [],
      illustrations: [],
      sections: [],
      skipped: [],
      synopsesUnmatched: []
    }
    const out = withTypographicQuotes(doc)
    expect(out.chapters[0]!.synopsis).toBe('The man who has much to say about “horse sense.”')
  })
})

/**
 * Manuscript 43 sets its temperaments down a column with `"` under
 * "temperament" twice — a typist's ditto. Turned as a quotation it opened, and
 * the column printed two quotations nobody closed.
 */
describe('a ditto mark in a table', () => {
  it('is set as a closing mark, while a quotation in a cell still opens', async () => {
    const { withTypographicQuotes } = await import('@core/layout')
    const table = {
      id: 'p0b0',
      kind: 'table' as const,
      text: '',
      sourcePages: [0],
      cells: [
        ['a.', 'The Motive', 'temperament'],
        ['b.', 'The Vital', '"'],
        ['c.', '"called"', ' " ']
      ]
    }
    const doc = {
      blocks: [table],
      footnotes: [],
      chapters: [],
      asides: [],
      illustrations: [],
      sections: [],
      skipped: [],
      synopsesUnmatched: []
    }
    const cells = withTypographicQuotes(doc).blocks[0]!.cells!
    expect(cells[1]![2]).toBe('”')
    expect(cells[2]![2]).toBe(' ” ')
    expect(cells[2]![1]).toBe('“called”')
  })
})
