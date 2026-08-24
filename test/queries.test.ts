import { describe, it, expect } from 'vitest'
import { collectQueries, countQueries, queriesMarkdown } from '@core/queries'
import { parsePageTranscription, carriesDraftNotes } from '@core/transcribe'
import type { PageTranscription } from '@core/transcribe'

const page = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  role: 'body',
  blocks: [{ kind: 'paragraph', text: 'The skeptical person who “belleves only the evidence' }],
  uncertain: [],
  furniture: {},
  ...over
})

const query = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  quote: 'belleves',
  why: 'Set with two l’s. At 600 DPI both strokes are ascender height, against the x-height dotless i of “skeptical” in the same line.',
  kind: 'printers-error',
  ...over
})

/**
 * The rule the channel exists for: a decision that belongs to the editor is
 * raised, never taken — and never lost.
 */
describe('what a query is allowed to be', () => {
  it('travels with the leaf it was raised on', () => {
    const parsed = parsePageTranscription(page({ queries: [query()] }), 6)
    expect(parsed.queries).toHaveLength(1)
    expect(parsed.queries![0]!.quote).toBe('belleves')
  })

  it('is absent on the overwhelming majority of leaves', () => {
    expect(parsePageTranscription(page(), 6).queries).toBeUndefined()
  })

  it('refuses a query with no words to point at', () => {
    expect(() => parsePageTranscription(page({ queries: [query({ quote: '  ' })] }), 6)).toThrow(
      /which words/
    )
  })

  it('refuses a query with no reason', () => {
    expect(() => parsePageTranscription(page({ queries: [query({ why: '' })] }), 6)).toThrow(
      /reason/
    )
  })

  it('refuses a kind the channel does not take', () => {
    expect(() => parsePageTranscription(page({ queries: [query({ kind: 'typo' })] }), 6)).toThrow(
      /not a kind of query/
    )
  })

  /**
   * The whole reason there is no such field. A suggestion sitting beside a
   * question is an answer in all but name, and the answer is the editor's.
   */
  it('refuses a proposed fix outright', () => {
    expect(() =>
      parsePageTranscription(page({ queries: [query({ expected: 'believes' })] }), 6)
    ).toThrow(/not a field/)
  })
})

/**
 * The parser used to build a fresh object from the fields it knew and drop the
 * rest without a word — so a reader who did the right thing and attached a
 * query got a green report and no record.
 */
describe('a field this schema does not have is refused, never dropped', () => {
  it('refuses an unknown field on a page', () => {
    expect(() => parsePageTranscription(page({ notes: 'see leaf 12' }), 6)).toThrow(/"notes"/)
  })

  it('refuses an unknown field on a block', () => {
    expect(() =>
      parsePageTranscription(page({ blocks: [{ kind: 'paragraph', text: 'x', indent: true }] }), 6)
    ).toThrow(/"indent"/)
  })

  it('says why it refused rather than only that it did', () => {
    expect(() => parsePageTranscription(page({ queries2: [] }), 6)).toThrow(/green report/)
  })

  it('still takes every field the schema really has', () => {
    const parsed = parsePageTranscription(
      page({
        pageIndex: 6,
        metadata: { title: 'A Book' },
        blocks: [
          {
            kind: 'heading',
            text: 'A HEAD',
            level: 2,
            marker: '*',
            continuesPrevious: true,
            continuesNext: true
          }
        ]
      }),
      6
    )
    expect(parsed.blocks[0]!.level).toBe(2)
    expect(parsed.metadata?.title).toBe('A Book')
  })
})

/**
 * A draft is the left-hand column of a transcription, not a transcription. A
 * batch still carrying `structural` has very likely not been checked — which is
 * not refusable, because a reader may have checked it and left the list alone,
 * but must never be silent.
 */
describe('a batch that still looks like a draft', () => {
  it('is noticed', () => {
    expect(carriesDraftNotes(page({ structural: ['the role is a guess'] }))).toBe(true)
    expect(carriesDraftNotes(page({ words: 498 }))).toBe(true)
  })

  it('is not refused, because it may have been checked', () => {
    expect(() => parsePageTranscription(page({ structural: ['a guess'] }), 6)).not.toThrow()
  })

  it('is not confused with a corrected batch', () => {
    expect(carriesDraftNotes(page())).toBe(false)
  })
})

describe('the sheet a person reads', () => {
  const read = (): PageTranscription[] => [
    parsePageTranscription(page({ queries: [query()] }), 6),
    parsePageTranscription(
      page({
        queries: [
          query({ quote: 'vestigal', kind: 'unclear', why: 'A period spelling, kept as printed.' }),
          query({ quote: 'Baillie', kind: 'inconsistent', why: 'Spelled Bailly on leaf 40.' })
        ]
      }),
      2
    )
  ]

  it('gathers every query with the leaf it came from, oldest first', () => {
    const raised = collectQueries(read())
    expect(raised.map((q) => q.pageIndex)).toEqual([2, 2, 6])
  })

  it('counts by kind without pretending a count is the sheet', () => {
    expect(countQueries(collectQueries(read()))).toEqual({
      'printers-error': 1,
      unclear: 1,
      inconsistent: 1
    })
  })

  it('says plainly that the book carries every one of them as printed', () => {
    const sheet = queriesMarkdown({ title: 'A Book', fileName: 'a.pdf' }, collectQueries(read()))
    expect(sheet).toMatch(/as printed/)
    expect(sheet).toContain('belleves')
    expect(sheet).toContain('Printer’s errors')
  })

  /** No proposed fix appears anywhere, because none was ever collected. */
  it('offers no answer', () => {
    const sheet = queriesMarkdown({ title: 'A Book', fileName: 'a.pdf' }, collectQueries(read()))
    expect(sheet).not.toMatch(/believes/)
  })

  it('says nothing is waiting when nothing is', () => {
    expect(queriesMarkdown({ title: 'A Book', fileName: 'a.pdf' }, [])).toMatch(
      /Nothing is waiting on you/
    )
  })

  it('does not let a quote break the table it sits in', () => {
    const sheet = queriesMarkdown({ title: 'A Book', fileName: 'a.pdf' }, [
      { pageIndex: 1, quote: 'a | b', why: 'has a pipe\nand a newline', kind: 'unclear' }
    ])
    const row = sheet.split('\n').find((l) => l.startsWith('| 1 |'))!
    // Split on *unescaped* pipes only — an escaped one is content, and the
    // point of the escape is that a reader's quotation cannot silently add a
    // column to the sheet.
    expect(row.split(/(?<!\\)\|/u)).toHaveLength(5)
    expect(row).toContain('a \\| b')
  })
})
