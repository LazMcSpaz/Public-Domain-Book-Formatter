import { describe, it, expect } from 'vitest'
import {
  fitRunningHead,
  fixedWidthMeasurer,
  hangPunctuation,
  layout,
  type FontRef,
  type LaidOutBook,
  type LaidOutPage,
  type LayoutEdition,
  type PositionedLine,
  type TextRun
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import type { StyleProfile } from '@core/model'
import type { BookBlock, BookDocument } from '@core/assemble'

const measurer = fixedWidthMeasurer(0.5)
const FONT: FontRef = { family: 'EB Garamond', style: 'regular' }

const EDITION: LayoutEdition = {
  title: 'A Treatise of Airs',
  author: 'Robert Boyle',
  editionDate: '2026'
}

let nextId = 0
function block(kind: BookBlock['kind'], text: string): BookBlock {
  return { id: `p0b${nextId++}`, kind, text, sourcePages: [0] }
}

function doc(blocks: BookBlock[]): BookDocument {
  return {
    blocks,
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: []
  }
}

const run = (document: BookDocument, over: Partial<StyleProfile> = {}): LaidOutBook =>
  layout(document, { ...defaultStyleProfile(), ...over }, measurer, { edition: EDITION })

const lines = (page: LaidOutPage): PositionedLine[] =>
  page.items.filter((i): i is PositionedLine => i.kind === 'line')

/** Every line of the book that carries a given word, with its runs. */
function linesSaying(book: LaidOutBook, text: string): PositionedLine[] {
  return book.pages.flatMap((p) => lines(p).filter((l) => l.runs.some((r) => r.text === text)))
}

/**
 * A list item was set flush: "12. The chirurgeon examined…" wrapped with its
 * second line hard under the "1", and nothing showed where one item ended and
 * the next began.
 */
describe('list items hang their markers', () => {
  const item =
    '1. The chirurgeon examined the specimen with extraordinary care and reported his ' +
    'findings to the assembled company that evening, at some length.'

  it('sets the marker to the left of the text it labels', () => {
    const book = run(doc([block('list-item', item)]))
    const set = linesSaying(book, '1.')[0]!
    const wrapped = book.pages
      .flatMap((p) => lines(p))
      .find((l) => l.runs.some((r) => r.text === 'findings'))!

    // The first line starts further left than the lines that follow it — which
    // is the whole of what a hanging indent is.
    expect(set.runs[0]!.xPt).toBeLessThan(wrapped.runs[0]!.xPt)
  })

  it('lines up every wrapped line of the item under the text, not the number', () => {
    const book = run(doc([block('list-item', item)]))
    const body = book.pages
      .flatMap((p) => lines(p))
      .filter((l) => l.runs.some((r) => ['findings', 'assembled', 'evening,'].includes(r.text)))
    expect(body.length).toBeGreaterThan(0)
    const lefts = new Set(body.map((l) => Math.round(l.runs[0]!.xPt * 100)))
    expect(lefts.size).toBe(1)
  })

  it('still sets the item inside the measure', () => {
    const book = run(doc([block('list-item', item)]))
    const page = book.pages.find((p) => lines(p).some((l) => l.runs[0]?.text === '1.'))!
    for (const line of lines(page)) {
      expect(line.runs[0]!.xPt).toBeGreaterThanOrEqual(page.frame.xPt - 1)
    }
  })
})

/**
 * Old books have very long titles. A running head set from one was wider than
 * the text block and ran out into the margin, or off the paper.
 */
describe('a running head is cut to fit', () => {
  const wide = 300

  it('leaves a title that already fits alone', () => {
    expect(fitRunningHead('Hydriotaphia', measurer, FONT, 10, wide)).toBe('Hydriotaphia')
  })

  it('drops the subtitle first, which is what a printer drops first', () => {
    const long =
      'Hydriotaphia: Urne-Buriall, or a Discourse of the Sepulchrall Urnes lately found in Norfolk'
    const fitted = fitRunningHead(long, measurer, FONT, 10, wide)
    expect(fitted).toBe('Hydriotaphia')
  })

  it('truncates at a word boundary, and shows that it did', () => {
    const noColon =
      'Urne Buriall or a Discourse of the Sepulchrall Urnes lately found in Norfolk and elsewhere'
    const fitted = fitRunningHead(noColon, measurer, FONT, 10, 80)
    expect(fitted.endsWith('…')).toBe(true)
    expect(measurer.widthOf(fitted, FONT, 10)).toBeLessThanOrEqual(80)
    // A word boundary, not mid-word.
    expect(fitted.replace('…', '').trim().split(/\s+/).pop()).not.toBe('Discours')
  })

  it('cuts into the word itself when one word is wider than the measure', () => {
    const fitted = fitRunningHead('Antidisestablishmentarianism', measurer, FONT, 10, 40)
    expect(measurer.widthOf(fitted, FONT, 10)).toBeLessThanOrEqual(40)
    expect(fitted.endsWith('…')).toBe(true)
  })

  it('never spills past the text block in a real book', () => {
    const long =
      'Hydriotaphia Urne Buriall or a Discourse of the Sepulchrall Urnes lately found in Norfolk'
    const book = layout(
      doc([block('paragraph', 'The chirurgeon examined it. '.repeat(60))]),
      { ...defaultStyleProfile(), runningHeads: { verso: 'bookTitle', recto: 'bookTitle' } },
      measurer,
      { edition: { ...EDITION, title: long } }
    )

    // The running head is the topmost line on a body page — above the first
    // baseline of the text block.
    const heads = book.pages
      .filter((p) => p.kind === 'body')
      .map((p) => ({ page: p, line: lines(p).find((l) => l.baselinePt < p.frame.yPt) }))
      .filter((h): h is { page: LaidOutPage; line: PositionedLine } => h.line !== undefined)

    expect(heads.length).toBeGreaterThan(0)
    for (const { page, line } of heads) {
      const text = line.runs.map((r) => r.text).join('')
      // Shortened, not spilled — and the full title genuinely did not fit.
      expect(measurer.widthOf(text, FONT, line.runs[0]!.sizePt)).toBeLessThanOrEqual(
        page.frame.widthPt
      )
      expect(text.length).toBeLessThan(long.length)
    }
  })
})

/**
 * A justified block is flush at both margins by measurement and still looks
 * crooked, because the eye aligns on ink rather than on boxes.
 */
describe('optical margins', () => {
  const flush = { flushRight: true }

  const runs = (...texts: string[]): TextRun[] =>
    texts.map((text, i) => ({ text, font: FONT, sizePt: 10, xPt: i * 30 }))

  it('pushes a closing full stop out past the margin', () => {
    const before = runs('The', 'matter', 'therein.')
    const after = hangPunctuation(before, measurer, FONT, flush)
    expect(after[2]!.xPt).toBeGreaterThan(before[2]!.xPt)
    // Only the last word moved; the rest of the line is where the breaker put it.
    expect(after[0]!.xPt).toBe(before[0]!.xPt)
  })

  it('hangs a comma further than a hyphen, because it is more white space', () => {
    const comma = hangPunctuation(runs('a', 'word,'), measurer, FONT, flush)[1]!.xPt
    const hyphen = hangPunctuation(runs('a', 'word-'), measurer, FONT, flush)[1]!.xPt
    expect(comma).toBeGreaterThan(hyphen)
  })

  it('pulls a whole line left when it opens with a quotation mark', () => {
    // The line moves, not the mark alone — moving the mark would open a gap
    // between it and the word it belongs to.
    const before = runs('“The', 'matter')
    const after = hangPunctuation(before, measurer, FONT, flush)
    expect(after[0]!.xPt).toBeLessThan(before[0]!.xPt)
    expect(before[1]!.xPt - after[1]!.xPt).toBeCloseTo(before[0]!.xPt - after[0]!.xPt, 6)
  })

  it('leaves a short last line alone', () => {
    // Hanging here would shove the final word rightwards into a visible gap in
    // the middle of the measure — an artifact worse than the raggedness.
    const before = runs('the', 'end.')
    expect(hangPunctuation(before, measurer, FONT, { flushRight: false })).toBe(before)
  })

  it('does nothing, and allocates nothing, for a line with no punctuation at its edges', () => {
    const before = runs('The', 'matter', 'therein')
    expect(hangPunctuation(before, measurer, FONT, flush)).toBe(before)
  })

  it('can be switched off, and changes no line break when it is on', () => {
    // The property that makes this safe: it runs after breaking, so the page
    // count and the contents are identical either way.
    const prose = 'The chirurgeon examined the specimen with extraordinary care, and reported. '
    const document = doc([block('paragraph', prose.repeat(30))])
    const on = run(document, { opticalMargins: true })
    const off = run(document, { opticalMargins: false })

    expect(on.pages).toHaveLength(off.pages.length)
    const words = (b: LaidOutBook): string =>
      b.pages.flatMap((p) => lines(p).map((l) => l.runs.map((r) => r.text).join(' '))).join('|')
    expect(words(on)).toBe(words(off))

    // But some glyph did move, or the setting does nothing.
    const xs = (b: LaidOutBook): number[] =>
      b.pages.flatMap((p) => lines(p).flatMap((l) => l.runs.map((r) => r.xPt)))
    expect(xs(on)).not.toEqual(xs(off))
  })
})
