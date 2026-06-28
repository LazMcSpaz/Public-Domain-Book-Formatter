import { describe, it, expect } from 'vitest'
import { buildToc } from '@core/structure'
import type { StructuralTag } from '@core/model'

const markdown = 'Chapter One body text Chapter Two more body Appendix end'
//                0123456789...
// "Chapter One" = [0,11), "Chapter Two" = [21,32), "Appendix" = [48,56)

function tag(id: string, start: number, end: number, level?: number): StructuralTag {
  return {
    id,
    type: 'heading',
    range: { start, end },
    data: level === undefined ? undefined : { level, confirmed: true }
  }
}

describe('buildToc', () => {
  it('builds entries from heading tags in document order', () => {
    const tags = [
      tag('h2', markdown.indexOf('Chapter Two'), markdown.indexOf('Chapter Two') + 11, 1),
      tag('h1', 0, 11, 1),
      tag('h3', markdown.indexOf('Appendix'), markdown.indexOf('Appendix') + 8, 2)
    ]
    const toc = buildToc(tags, markdown)
    expect(toc.map((e) => e.title)).toEqual(['Chapter One', 'Chapter Two', 'Appendix'])
    expect(toc.map((e) => e.outputOffset)).toEqual([
      0,
      markdown.indexOf('Chapter Two'),
      markdown.indexOf('Appendix')
    ])
  })

  it('defaults level to 1 when data.level is missing', () => {
    const toc = buildToc([tag('h1', 0, 11)], markdown)
    expect(toc[0]!.level).toBe(1)
  })

  it('reads level from data and sets pageNumber null', () => {
    const toc = buildToc([tag('h1', 0, 11, 3)], markdown)
    expect(toc[0]!.level).toBe(3)
    expect(toc[0]!.pageNumber).toBeNull()
  })

  it('ignores non-heading tags', () => {
    const tags: StructuralTag[] = [
      tag('h1', 0, 11, 1),
      { id: 'f1', type: 'footnote', range: { start: 12, end: 16 } }
    ]
    const toc = buildToc(tags, markdown)
    expect(toc.length).toBe(1)
  })

  it('trims and normalizes whitespace in titles', () => {
    const md = 'Pre   Spaced   Heading  Post'
    const start = md.indexOf('Spaced')
    const end = md.indexOf('Heading') + 'Heading'.length
    const toc = buildToc([tag('h1', start - 1, end + 1, 1)], md)
    expect(toc[0]!.title).toBe('Spaced Heading')
  })
})
