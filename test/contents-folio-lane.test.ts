import { describe, it, expect } from 'vitest'
import { assembleBook } from '@core/assemble'
import { fixedWidthMeasurer, layoutWithToc, type PositionedLine } from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import type { PageTranscription } from '@core/transcribe'

/**
 * A contents title must stop short of its page number.
 *
 * The number is printed as "Page 143", right-aligned on the title's last line,
 * and the title is broken to the measure less a lane reserved for it. The lane
 * was sized for a bare "8888" after the label grew its "Page ", so a title that
 * ran to the end of its lane ran into the word: on the Hall collection, three
 * entries ("Buddha, the Divine Wanderer", "Mental and Spiritual Alchemy",
 * "Psychology, False and True") printed through their own page numbers.
 *
 * The fixture sweeps title lengths a word at a time, so some last line lands
 * at every distance from the lane's edge, including flush against it.
 */
const measurer = fixedWidthMeasurer(0.5)
const COUNT = 4 * 32

function book(): PageTranscription[] {
  // One-letter words step a line's end by a whole space and letter; the last
  // word's length (one to four letters) fills in between, so across the set
  // a title ends at every half-em from the start of the line to past the lane.
  return Array.from({ length: COUNT }, (_, i) => ({
    pageIndex: i,
    role: 'body' as const,
    uncertain: [],
    furniture: {},
    blocks: [
      {
        kind: 'heading' as const,
        level: 1,
        text: `${'a '.repeat(Math.floor(i / 4))}${'b'.repeat((i % 4) + 1)}`
      },
      { kind: 'paragraph' as const, text: 'Body text. '.repeat(40) }
    ]
  }))
}

describe('a contents title and its page number', () => {
  const laid = layoutWithToc(assembleBook(book()), defaultStyleProfile(), measurer, {
    edition: { title: 'T', author: 'A' }
  })
  const lines = laid.pages
    .filter((p) => p.kind === 'contents')
    .flatMap((p) => p.items.filter((i): i is PositionedLine => i.kind === 'line'))
    .filter((l) => l.runs.some((r) => r.text.startsWith('Page ')))

  it('sets every number', () => {
    expect(lines.length).toBe(COUNT)
  })

  it('never lets the title reach the number on the same line', () => {
    for (const line of lines) {
      const label = line.runs.find((r) => r.text.startsWith('Page '))!
      const title = line.runs.filter((r) => r !== label)
      const end = Math.max(...title.map((r) => r.xPt + measurer.widthOf(r.text, r.font, r.sizePt)))
      expect(end).toBeLessThan(label.xPt)
    }
  })
})
