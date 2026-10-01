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

const EDITION: LayoutEdition = { title: 'Verses', author: 'A. Poet', editionDate: '2026' }

const doc = (blocks: BookBlock[]): BookDocument => ({
  blocks,
  footnotes: [],
  chapters: [],
  asides: [],
  illustrations: [],
  sections: [],
  skipped: [],
  synopsesUnmatched: []
})

const verse = (text: string, extra: Partial<BookBlock> = {}): BookBlock => ({
  id: 'p0b0',
  kind: 'verse',
  text,
  sourcePages: [0],
  ...extra
})

const run = (blocks: BookBlock[]): LaidOutBook =>
  layout(doc(blocks), defaultStyleProfile(), fixedWidthMeasurer(0.5), { edition: EDITION })

/** The book's lines that carry any of the given words, top to bottom. */
function linesWith(book: LaidOutBook, words: string[]): PositionedLine[] {
  return book.pages.flatMap((p) =>
    p.items.filter(
      (i): i is PositionedLine => i.kind === 'line' && i.runs.some((r) => words.includes(r.text))
    )
  )
}

/**
 * A verse was set as an indented paragraph, so the breaks a reading kept in
 * one ran together: Hall's Stanzas, the quatrains quoted in *Isis*, a notice
 * typed in three stepped lines.
 */
describe('a verse', () => {
  it('keeps each of its lines', () => {
    const book = run([verse('Alpha one\nBeta two\nGamma three')])
    const lines = linesWith(book, ['Alpha', 'Beta', 'Gamma'])
    expect(lines).toHaveLength(3)
    expect(lines.map((l) => l.runs[0]!.text)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('keeps the italics on the words they were on, line by line', () => {
    // Word 3 is `two`, the second word of the second line.
    const book = run([verse('Alpha one\nBeta two\nGamma three', { emphasis: [3] })])
    const runs = linesWith(book, ['two']).flatMap((l) => l.runs)
    expect(runs.find((r) => r.text === 'two')!.font.style).toBe('italic')
    expect(runs.find((r) => r.text === 'Beta')!.font.style).toBe('regular')
  })

  it('sets a line typed with leading space further in', () => {
    const book = run([verse('Alpha one\n  Beta two')])
    const [a, b] = linesWith(book, ['Alpha', 'Beta'])
    expect(b!.runs[0]!.xPt).toBeGreaterThan(a!.runs[0]!.xPt)
  })

  it('turns a line too long for the measure over, indented', () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')
    const book = run([verse(`${long}\nShort`)])
    const set = linesWith(book, ['w0', 'w59'])
    expect(set.length).toBeGreaterThan(1)
    const first = set[0]!.runs[0]!.xPt
    const turned = book.pages
      .flatMap((p) => p.items.filter((i): i is PositionedLine => i.kind === 'line'))
      .find((l) => l.runs[0]?.text.startsWith('w') && l.runs[0].text !== 'w0')!
    expect(turned.runs[0]!.xPt).toBeGreaterThan(first)
  })
})
