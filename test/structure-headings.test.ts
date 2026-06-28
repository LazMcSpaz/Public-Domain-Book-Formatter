import { describe, it, expect } from 'vitest'
import { detectHeadings } from '@core/structure'
import type { MappingEntry, SourcePage, WordToken } from '@core/model'

/**
 * Build a SourcePage from lines of words. Each line gets a y-band; word height
 * is `h`. `gapBefore` adds vertical whitespace above a line so we can make a
 * line "isolated".
 */
interface LineSpec {
  texts: string[]
  h: number
  gapBefore?: number
}

function buildPage(
  index: number,
  width: number,
  height: number,
  lines: LineSpec[]
): { page: SourcePage; map: MappingEntry[] } {
  const words: WordToken[] = []
  const map: MappingEntry[] = []
  let y = 0
  let wn = 0
  let cursor = 0
  for (const line of lines) {
    y += line.gapBefore ?? 10
    let x = 20
    for (const text of line.texts) {
      const id = `p${index}_w${wn++}`
      const w = text.length * line.h * 0.6
      const bbox = { x0: x, y0: y, x1: x + w, y1: y + line.h }
      words.push({ id, text, bbox, pageIndex: index, confidence: 90 })
      const start = cursor
      const end = start + text.length
      map.push({ tokenId: id, pageIndex: index, bbox, output: { start, end } })
      cursor = end + 1
      x += w + 10
    }
    y += line.h
  }
  const page: SourcePage = {
    index,
    imagePath: null,
    width,
    height,
    dpi: null,
    words,
    regions: []
  }
  return { page, map }
}

describe('detectHeadings', () => {
  it('finds a large, isolated, title-case heading line', () => {
    const { page, map } = buildPage(0, 800, 1200, [
      { texts: ['the', 'quick', 'brown', 'fox', 'ran'], h: 20 },
      { texts: ['Chapter', 'One'], h: 48, gapBefore: 80 },
      { texts: ['then', 'the', 'lazy', 'dog', 'slept'], h: 20, gapBefore: 80 },
      { texts: ['more', 'body', 'text', 'here', 'now'], h: 20 }
    ])
    const markdown = page.words.map((w) => w.text).join(' ')
    const { candidates, flags } = detectHeadings([page], markdown, map)

    expect(candidates.length).toBe(1)
    expect(candidates[0]!.text).toBe('Chapter One')
    expect(candidates[0]!.level).toBe(1)
    expect(candidates[0]!.pageIndex).toBe(0)
    expect(flags.length).toBe(1)
    expect(flags[0]).toMatchObject({
      kind: 'heuristic',
      source: 'structure',
      label: 'probable heading'
    })
    const flag = flags[0]!
    expect(flag.kind).toBe('heuristic')
    if (flag.kind === 'heuristic') {
      expect(flag.range).toEqual(candidates[0]!.range)
    }
  })

  it('maps candidate range to the correct markdown slice', () => {
    const { page, map } = buildPage(0, 800, 1200, [
      { texts: ['body', 'words', 'aplenty', 'here', 'today'], h: 20 },
      { texts: ['BIG', 'TITLE'], h: 50, gapBefore: 100 },
      { texts: ['back', 'to', 'small', 'body', 'words'], h: 20, gapBefore: 100 }
    ])
    const markdown = page.words.map((w) => w.text).join(' ')
    const { candidates } = detectHeadings([page], markdown, map)
    expect(candidates.length).toBe(1)
    const c = candidates[0]!
    expect(markdown.slice(c.range.start, c.range.end)).toBe('BIG TITLE')
  })

  it('returns no candidates for a uniform body-text page', () => {
    const lines: LineSpec[] = []
    for (let i = 0; i < 8; i++) {
      lines.push({ texts: ['this', 'is', 'plain', 'body', 'text', 'line'], h: 20 })
    }
    const { page, map } = buildPage(0, 800, 1200, lines)
    const markdown = page.words.map((w) => w.text).join(' ')
    const { candidates, flags } = detectHeadings([page], markdown, map)
    expect(candidates).toEqual([])
    expect(flags).toEqual([])
  })

  it('assigns coarser levels to smaller headings', () => {
    const { page, map } = buildPage(0, 800, 1600, [
      { texts: ['body', 'text', 'one', 'two', 'three'], h: 20 },
      { texts: ['HUGE', 'HEADING'], h: 60, gapBefore: 120 },
      { texts: ['body', 'text', 'four', 'five', 'six'], h: 20, gapBefore: 120 },
      { texts: ['Smaller', 'Heading'], h: 36, gapBefore: 120 },
      { texts: ['body', 'text', 'seven', 'eight', 'nine'], h: 20, gapBefore: 120 }
    ])
    const markdown = page.words.map((w) => w.text).join(' ')
    const { candidates } = detectHeadings([page], markdown, map)
    expect(candidates.length).toBe(2)
    const huge = candidates.find((c) => c.text === 'HUGE HEADING')!
    const small = candidates.find((c) => c.text === 'Smaller Heading')!
    expect(huge.level).toBe(1)
    expect(small.level).toBeGreaterThan(huge.level)
  })

  it('handles an empty page list', () => {
    const { candidates, flags } = detectHeadings([], '', [])
    expect(candidates).toEqual([])
    expect(flags).toEqual([])
  })
})
