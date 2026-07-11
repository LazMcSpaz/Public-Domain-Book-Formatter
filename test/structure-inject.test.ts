import { describe, it, expect } from 'vitest'
import type { StructuralTag } from '@core/model'
import { injectStructure, confirmedHeadings } from '@core/structure'

function heading(
  id: string,
  start: number,
  end: number,
  level: number,
  confirmed: boolean
): StructuralTag {
  return { id, type: 'heading', range: { start, end }, data: { level, confirmed } }
}

describe('confirmedHeadings', () => {
  it('keeps only confirmed heading tags', () => {
    const tags: StructuralTag[] = [
      heading('a', 0, 5, 1, true),
      heading('b', 6, 9, 1, false),
      { id: 'c', type: 'blockquote', range: { start: 10, end: 20 }, data: { confirmed: true } }
    ]
    expect(confirmedHeadings(tags).map((t) => t.id)).toEqual(['a'])
  })
})

describe('injectStructure', () => {
  it('renders a confirmed heading as an ATX heading of the right level', () => {
    const md = 'CHAPTER ONE\n\nIt was a dark night.'
    const out = injectStructure(md, [heading('h1', 0, 11, 1, true)])
    expect(out).toContain('# CHAPTER ONE')
    expect(out).toContain('It was a dark night.')
    // Level 2 -> "##".
    const out2 = injectStructure(md, [heading('h1', 0, 11, 2, true)])
    expect(out2).toContain('## CHAPTER ONE')
  })

  it('ignores unconfirmed headings', () => {
    const md = 'A Heading\n\nBody.'
    const out = injectStructure(md, [heading('h1', 0, 9, 1, false)])
    expect(out).not.toContain('# A Heading')
    expect(out).toContain('A Heading')
  })

  it('applies multiple headings without corrupting later offsets', () => {
    // Two headings; the second is later in the text. Applying end-first must keep
    // both correct.
    const md = 'One\n\nmiddle text\n\nTwo\n\ntail'
    const tags = [heading('h1', 0, 3, 1, true), heading('h2', 18, 21, 1, true)]
    const out = injectStructure(md, tags)
    expect(out).toContain('# One')
    expect(out).toContain('# Two')
    expect(out).toContain('middle text')
    expect(out).toContain('tail')
  })

  it('collapses whitespace in a heading and skips empty ones', () => {
    const md = 'The   Long\n  Title\n\nBody'
    const out = injectStructure(md, [heading('h1', 0, 18, 1, true)])
    expect(out).toContain('# The Long Title')

    const empty = injectStructure('   \n\nBody', [heading('h1', 0, 3, 1, true)])
    expect(empty).not.toContain('#')
  })

  it('returns the text unchanged when there are no confirmed headings', () => {
    const md = 'Just prose.'
    expect(injectStructure(md, [])).toBe(md)
  })
})
