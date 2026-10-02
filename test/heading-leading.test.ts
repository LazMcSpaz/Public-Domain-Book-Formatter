import { describe, it, expect } from 'vitest'
import { layout, fixedWidthMeasurer, leadingFor, type PositionedLine } from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import type { BookBlock, BookDocument } from '@core/assemble'

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

const long =
  'PART SIX — THE ANNIHILATION OF TIME, DISTANCE AND ETERNITY AND OF ALL THE OTHER THINGS'

/** Every line of the named words, where its baseline is actually drawn. */
function drawnBaselines(level: number) {
  const book = layout(
    doc([
      { id: 'p0b0', kind: 'heading', level: 1, text: 'A Chapter', sourcePages: [0] },
      { id: 'p0b1', kind: 'paragraph', text: 'Some prose before it.', sourcePages: [0] },
      { id: 'p0b2', kind: 'heading', level, text: long, sourcePages: [0] },
      { id: 'p0b3', kind: 'paragraph', text: 'Some prose after it.', sourcePages: [0] }
    ]),
    defaultStyleProfile(),
    fixedWidthMeasurer(0.5),
    { edition: { title: 'T', author: 'A', editionDate: '2026' } }
  )
  const lines = book.pages
    .flatMap((p) => p.items)
    .filter((i): i is PositionedLine => i.kind === 'line')
    .filter((l) => l.runs.some((r) => /ANNIHILATION|ETERNITY|THINGS|DISTANCE|TIME/.test(r.text)))
  return lines.map((l) => ({ y: l.baselinePt - (l.runs[0]!.risePt ?? 0), size: l.runs[0]!.sizePt }))
}

/**
 * A head set a little larger than the body took two slots a line, so a head
 * that wrapped had a full blank line through the middle of it — on Hall's
 * pages "THE ANNIHILATION OF TIME, / DISTANCE AND ETERNITY." read as two heads.
 */
describe('a heading that wraps', () => {
  it('sets its lines at its own leading, not at two slots a line', () => {
    const at = drawnBaselines(2)
    expect(at.length).toBeGreaterThan(1)
    const step = at[1]!.y - at[0]!.y
    expect(step).toBeCloseTo(leadingFor(at[0]!.size), 1)
  })

  it('still keeps the lines of a chapter title clear of each other', () => {
    const at = drawnBaselines(1)
    expect(at.length).toBeGreaterThan(1)
    for (let i = 1; i < at.length; i++) {
      expect(at[i]!.y - at[i - 1]!.y).toBeGreaterThanOrEqual(at[i]!.size)
      expect(at[i]!.y - at[i - 1]!.y).toBeCloseTo(leadingFor(at[i]!.size), 1)
    }
  })
})

/**
 * Hall's typescripts head their sections with an underlined word against the
 * left margin, and the engine centred every heading at 1.15 times the body, so
 * "Versatility." and "Poise." read as chapter titles.
 */
describe('a side head', () => {
  const blocks: BookBlock[] = [
    { id: 'p0b0', kind: 'heading', level: 1, text: 'Talks for Teachers', sourcePages: [0] },
    {
      id: 'p0b1',
      kind: 'paragraph',
      text: 'Some prose to set the margin by, long enough to fill a line of the measure and run on into another one.',
      sourcePages: [0]
    },
    { id: 'p0b2', kind: 'heading', level: 2, text: 'Versatility.', sourcePages: [0] },
    {
      id: 'p0b3',
      kind: 'paragraph',
      text: 'It is essential that students learn to be versatile.',
      sourcePages: [0]
    }
  ]
  const run = (sideHeadsFrom: number) => {
    const book = layout(
      doc(blocks),
      { ...defaultStyleProfile(), sideHeadsFrom },
      fixedWidthMeasurer(0.5),
      {
        edition: { title: 'T', author: 'A', editionDate: '2026' }
      }
    )
    const lines = book.pages
      .flatMap((p) => p.items)
      .filter((i): i is PositionedLine => i.kind === 'line')
    const head = lines.find((l) => l.runs.some((r) => /Versatility|VERSATILITY/i.test(r.text)))!
    const body = lines.find((l) => l.runs.some((r) => r.text === 'Some'))!
    return { head: head.runs[0]!, body: body.runs[0]! }
  }

  it('is set flush left at the size of the text when the profile asks', () => {
    const { head, body } = run(2)
    expect(head.sizePt).toBeCloseTo(body.sizePt, 3)
    // the paragraph under a chapter title is set flush, so it marks the margin
    expect(head.xPt).toBeCloseTo(body.xPt, 3)
    expect(head.font.smallCaps ?? false).toBe(false)
  })

  it('is centred and larger, as before, when it does not', () => {
    const { head, body } = run(7)
    expect(head.sizePt).toBeGreaterThan(body.sizePt)
    expect(head.xPt).toBeGreaterThan(body.xPt)
  })
})

/**
 * The Stanzas of Dzyan set each verse at the list's inset and its commentary
 * one step deeper; the printed key says indented text is commentary. At one
 * inset for both, the key described nothing on the page.
 */
describe('the quotation inset', () => {
  const blocks: BookBlock[] = [
    { id: 'p0b0', kind: 'heading', level: 1, text: 'Stanza VII', sourcePages: [0] },
    {
      id: 'p0b1',
      kind: 'verse',
      text: '1. Behold the beginning of sentient formless life.\nFirst the Divine, the One.',
      sourcePages: [0]
    },
    {
      id: 'p0b2',
      kind: 'blockquote',
      text: 'In this verse the origin of sentient life is discussed.',
      sourcePages: [0]
    }
  ]
  const xOf = (quoteIndentEms: number, word: string) => {
    const book = layout(
      doc(blocks),
      { ...defaultStyleProfile(), quoteIndentEms },
      fixedWidthMeasurer(0.5),
      {
        edition: { title: 'T', author: 'A', editionDate: '2026' }
      }
    )
    return book.pages
      .flatMap((p) => p.items)
      .filter((i): i is PositionedLine => i.kind === 'line')
      .flatMap((l) => l.runs)
      .find((r) => r.text === word)!.xPt
  }

  it('sets commentary deeper than verse when the profile asks', () => {
    expect(xOf(4, 'In') - xOf(4, '1.')).toBeGreaterThan(10)
  })

  it('keeps the two at one inset by default', () => {
    expect(defaultStyleProfile().quoteIndentEms).toBe(2)
    // a quotation's ems are 0.94 of the body's, so the two differ by a hair
    expect(Math.abs(xOf(2, 'In') - xOf(2, '1.'))).toBeLessThan(2)
  })
})
