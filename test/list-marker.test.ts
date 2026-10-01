import { describe, it, expect } from 'vitest'
import {
  layout,
  fixedWidthMeasurer,
  type LaidOutBook,
  type LayoutEdition,
  type PositionedLine
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import type { BookBlock, BookDocument } from '@core/assemble'

const EDITION: LayoutEdition = { title: 'Lectures', author: 'M. P. Hall', editionDate: '2026' }

function doc(blocks: BookBlock[]): BookDocument {
  return {
    blocks,
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  }
}

const item = (id: string, text: string, extra: Partial<BookBlock> = {}): BookBlock => ({
  id,
  kind: 'list-item',
  text,
  sourcePages: [0],
  ...extra
})

const run = (blocks: BookBlock[]): LaidOutBook =>
  layout(doc(blocks), defaultStyleProfile(), fixedWidthMeasurer(0.5), { edition: EDITION })

const runs = (book: LaidOutBook) =>
  book.pages.flatMap((p) =>
    p.items.filter((i): i is PositionedLine => i.kind === 'line').flatMap((l) => l.runs)
  )

/**
 * Hall's lectures and *Clairvoyance* store a numbered item's number in
 * `marker`, apart from its words, and nothing printed it: 146 items on the
 * shelf hung their indent with nothing in it.
 */
describe('a numbered list item', () => {
  it('prints a number stored apart from its words', () => {
    const book = run([item('p0b0', 'Most people love flowers.', { marker: '1.' })])
    const all = runs(book).map((r) => r.text)
    expect(all).toContain('1.')
    expect(all.indexOf('1.')).toBeLessThan(all.indexOf('Most'))
  })

  it('keeps the italics on the words they were on', () => {
    const book = run([item('p0b0', 'Most people love flowers.', { marker: '1.', emphasis: [1] })])
    const people = runs(book).find((r) => r.text === 'people')!
    const number = runs(book).find((r) => r.text === '1.')!
    expect(people.font.style).toBe('italic')
    expect(number.font.style).toBe('regular')
  })

  it('does not print a number twice when the words already open with it', () => {
    const book = run([item('p0b0', '1. Most people love flowers.', { marker: '1.' })])
    expect(runs(book).filter((r) => r.text === '1.')).toHaveLength(1)
  })
})
