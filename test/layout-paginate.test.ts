import { describe, it, expect } from 'vitest'
import {
  fixedWidthMeasurer,
  frameFor,
  layout,
  leadingFor,
  linesPerFrame,
  trimToPoints,
  type LaidOutPage,
  type LayoutEdition,
  type PositionedLine
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import type { StyleProfile } from '@core/model'
import type { BookBlock, BookDocument } from '@core/assemble'

const measurer = fixedWidthMeasurer(0.5)

const EDITION: LayoutEdition = {
  title: 'A Treatise of Airs',
  author: 'Robert Boyle',
  imprint: 'Scratch Press',
  copyrightHolder: 'The Publisher',
  editionDate: '2026',
  isbn: '978-0-00-000000-0',
  notices: ['The original work is in the public domain.']
}

function block(kind: BookBlock['kind'], text: string, level?: number): BookBlock {
  return { kind, text, sourcePages: [0], ...(level === undefined ? {} : { level }) }
}

/** Enough prose to fill roughly a page and a half at the default style. */
const PROSE =
  'The chirurgeon examined the specimen with extraordinary care and reported his findings to the assembled company that evening. '.repeat(
    6
  )

function doc(blocks: BookBlock[], asides: BookBlock[] = []): BookDocument {
  return { blocks, footnotes: [], chapters: [], asides, skipped: [] }
}

function run(document: BookDocument, over: Partial<StyleProfile> = {}) {
  return layout(document, { ...defaultStyleProfile(), ...over }, measurer, { edition: EDITION })
}

const lines = (page: LaidOutPage): PositionedLine[] =>
  page.items.filter((i): i is PositionedLine => i.kind === 'line')

const textOf = (page: LaidOutPage): string =>
  lines(page)
    .map((l) => l.runs.map((r) => r.text).join(' '))
    .join(' · ')

describe('frames — trim, margins, gutter', () => {
  it('parses a trim token into points, falling back to 6×9in', () => {
    expect(trimToPoints('6x9')).toEqual({ widthPt: 432, heightPt: 648 })
    expect(trimToPoints('5.5×8.5')).toEqual({ widthPt: 396, heightPt: 612 })
    expect(trimToPoints('nonsense')).toEqual({ widthPt: 432, heightPt: 648 })
  })

  it('mirrors the text block between verso and recto', () => {
    const profile = defaultStyleProfile()
    const recto = frameFor(profile, 'recto')
    const verso = frameFor(profile, 'verso')

    // Same measure on both sides — only the side it sits on changes.
    expect(verso.widthPt).toBeCloseTo(recto.widthPt, 6)
    // The gutter joins the inner margin, which is on the left of a recto.
    expect(recto.xPt).toBeCloseTo((profile.margins.inner + profile.gutter) * 72, 6)
    expect(verso.xPt).toBeCloseTo(profile.margins.outer * 72, 6)
  })

  it('adds the gutter to the inner margin, not to the page', () => {
    const base = frameFor({ ...defaultStyleProfile(), gutter: 0 }, 'recto')
    const gutter = frameFor({ ...defaultStyleProfile(), gutter: 0.25 }, 'recto')
    expect(gutter.xPt - base.xPt).toBeCloseTo(18, 6)
    expect(gutter.widthPt).toBeCloseTo(base.widthPt - 18, 6)
  })

  it('counts baselines with the first one an ascent below the top', () => {
    const frame = { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 }
    // Baselines at 10, 20, … 100: ten fit.
    expect(linesPerFrame(frame, 10, 10)).toBe(10)
    expect(linesPerFrame(frame, 0, 10)).toBe(0)
  })

  it('derives leading from the body size', () => {
    expect(leadingFor(10)).toBeCloseTo(13.2, 6)
  })
})

describe('layout — front matter', () => {
  it('opens with a half-title, its blank verso, a title page, and a copyright page', () => {
    const book = run(doc([block('paragraph', PROSE)]))
    expect(textOf(book.pages[0]!)).toContain('A Treatise of Airs')
    expect(lines(book.pages[1]!)).toHaveLength(0)
    expect(textOf(book.pages[2]!)).toContain('Robert Boyle')
    expect(textOf(book.pages[3]!)).toContain('978-0-00-000000-0')
    expect(textOf(book.pages[3]!)).toContain('public domain')
  })

  it('leaves display pages unnumbered', () => {
    const book = run(doc([block('paragraph', PROSE)]))
    for (const page of book.pages.slice(0, 4)) expect(page.folio).toBeNull()
  })

  it('honours the front-matter toggles', () => {
    const book = run(doc([block('paragraph', PROSE)]), {
      frontMatter: { halfTitle: false, titlePage: true, copyrightPage: false }
    })
    expect(textOf(book.pages[0]!)).toContain('A Treatise of Airs')
    expect(book.pages[0]!.section).toBe('front')
    expect(textOf(book.pages[0]!)).not.toContain('978-')
  })

  it('gives each aside its own page ahead of the body', () => {
    const book = run(doc([block('paragraph', PROSE)], [block('epigraph', 'For my father.')]))
    const aside = book.pages.find((p) => textOf(p).includes('father'))
    expect(aside?.section).toBe('front')
  })

  it('numbers front matter in roman and the body in arabic from one', () => {
    const book = run(doc([block('paragraph', PROSE)], [block('epigraph', 'For my father.')]))
    const aside = book.pages.find((p) => textOf(p).includes('father'))!
    expect(aside.folio).toMatch(/^[ivxlcdm]+$/)
    const firstBody = book.pages.find((p) => p.section === 'body')!
    expect(firstBody.folio).toBe('1')
  })
})

describe('layout — the body', () => {
  it('starts the body, and every chapter, on a recto', () => {
    const book = run(
      doc([
        block('heading', 'Of the Air', 1),
        block('paragraph', PROSE),
        block('heading', 'Of Fire', 1),
        block('paragraph', PROSE)
      ])
    )
    for (const { pageIndex } of book.chapterPages) {
      expect(book.pages[pageIndex]!.side).toBe('recto')
    }
    expect(book.pages.find((p) => p.section === 'body')!.side).toBe('recto')
  })

  it('places every line of every block', () => {
    const document = doc([
      block('heading', 'Of the Air', 1),
      block('paragraph', PROSE),
      block('paragraph', PROSE),
      block('heading', 'An Interlude', 2),
      block('paragraph', PROSE),
      block('blockquote', 'A passage set apart from the surrounding argument.')
    ])
    const book = run(document)
    const set = book.pages.map(textOf).join(' ')
    // The last words of the last block must have survived the flow.
    expect(set).toContain('surrounding argument.')
    expect(set).toContain('An Interlude'.toLocaleUpperCase())
  })

  it('records where each heading actually landed, not where it was reached', () => {
    const book = run(
      doc([
        block('heading', 'Of the Air', 1),
        block('paragraph', PROSE),
        block('paragraph', PROSE),
        block('heading', 'An Interlude', 2)
      ])
    )
    const interlude = book.chapterPages.find((c) => c.title === 'An Interlude')!
    expect(textOf(book.pages[interlude.pageIndex]!)).toContain('AN INTERLUDE')
  })

  it('leaves no orphan or widow line', () => {
    const document = doc([
      block('heading', 'Of the Air', 1),
      ...Array.from({ length: 6 }, () => block('paragraph', PROSE))
    ])
    const book = run(document)
    const bodyPages = book.pages.filter((p) => p.section === 'body')
    // A page whose only content line is furniture would mean a stranded line.
    for (const page of bodyPages) {
      expect(lines(page).length).toBeGreaterThan(1)
    }
  })

  it('never strands a heading at the foot of a page', () => {
    const book = run(
      doc([
        block('heading', 'Of the Air', 1),
        ...Array.from({ length: 4 }, () => block('paragraph', PROSE)),
        block('heading', 'An Interlude', 2),
        block('paragraph', PROSE)
      ])
    )
    const interlude = book.chapterPages.find((c) => c.title === 'An Interlude')!
    const page = book.pages[interlude.pageIndex]!
    const headingLine = lines(page).findIndex((l) =>
      l.runs.some((r) => r.text.includes('INTERLUDE'))
    )
    // Something has to follow it on the same page.
    expect(lines(page).length).toBeGreaterThan(headingLine + 1)
  })
})

describe('layout — page furniture', () => {
  it('puts the chapter title in the running head, not a sub-heading', () => {
    const book = run(
      doc([
        block('heading', 'Of the Air', 1),
        block('paragraph', PROSE),
        block('heading', 'An Interlude', 2),
        block('paragraph', PROSE)
      ]),
      { runningHeads: { verso: 'chapterTitle', recto: 'chapterTitle' } }
    )
    const later = book.pages.filter((p) => p.section === 'body').slice(1)
    for (const page of later) expect(page.chapterTitle).toBe('Of the Air')
  })

  it('suppresses the running head on a chapter opener', () => {
    const book = run(doc([block('heading', 'Of the Air', 1), block('paragraph', PROSE)]), {
      runningHeads: { verso: 'author', recto: 'bookTitle' }
    })
    const opener = book.pages[book.chapterPages[0]!.pageIndex]!
    expect(textOf(opener)).not.toContain('Robert Boyle')
  })

  it('sets a bottom-outer folio on the outer edge of each side', () => {
    const book = run(
      doc([
        block('heading', 'Of the Air', 1),
        ...Array.from({ length: 4 }, () => block('paragraph', PROSE))
      ]),
      { pageNumber: 'bottomOuter' }
    )
    const body = book.pages.filter((p) => p.section === 'body' && p.folio !== null)
    const verso = body.find((p) => p.side === 'verso')!
    const recto = body.find((p) => p.side === 'recto')!
    const folioRun = (p: LaidOutPage) =>
      lines(p).find((l) => l.runs.length === 1 && l.runs[0]!.text === p.folio)!.runs[0]!
    expect(folioRun(verso).xPt).toBeLessThan(verso.widthPt / 2)
    expect(folioRun(recto).xPt).toBeGreaterThan(recto.widthPt / 2)
  })

  it('omits page numbers entirely when the style says none', () => {
    const book = run(doc([block('paragraph', PROSE)]), { pageNumber: 'none' })
    for (const page of book.pages) {
      const numbers = lines(page).filter((l) => l.runs.every((r) => /^[\divxlcdm]+$/.test(r.text)))
      expect(numbers).toHaveLength(0)
    }
  })
})

describe('layout — the properties later work depends on', () => {
  it('is a pure function of its inputs, so it can simply be run twice', () => {
    // The footnote re-flow and the two-pass TOC are both "call it again".
    const document = doc([block('heading', 'Of the Air', 1), block('paragraph', PROSE)])
    const first = run(document)
    const second = run(document)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('reports the trim, so a renderer needn’t re-parse the token', () => {
    const book = run(doc([block('paragraph', PROSE)]), { trimSize: '5.5x8.5' })
    expect(book.widthPt).toBe(396)
    expect(book.heightPt).toBe(612)
    for (const page of book.pages) {
      expect(page.widthPt).toBe(396)
      expect(page.heightPt).toBe(612)
    }
  })

  it('reports every face it drew with, so an embedder knows what to load', () => {
    const book = run(doc([block('paragraph', PROSE), block('caption', 'A plate.')]))
    expect(book.fontsUsed).toContainEqual({ family: 'EB Garamond', style: 'regular' })
    expect(book.fontsUsed).toContainEqual({ family: 'EB Garamond', style: 'italic' })
  })

  it('lays out only a sample when the preview asks for one', () => {
    const document = doc([
      block('heading', 'Of the Air', 1),
      ...Array.from({ length: 20 }, () => block('paragraph', PROSE))
    ])
    const full = layout(document, defaultStyleProfile(), measurer, { edition: EDITION })
    const sample = layout(document, defaultStyleProfile(), measurer, {
      edition: EDITION,
      maxBodyPages: 2
    })
    expect(sample.pages.filter((p) => p.section === 'body')).toHaveLength(2)
    expect(full.pages.length).toBeGreaterThan(sample.pages.length)
    // The sample must be the *same* layout, truncated — not a different one.
    expect(textOf(sample.pages[sample.pages.length - 1]!)).toBe(
      textOf(full.pages[sample.pages.length - 1]!)
    )
  })
})

describe('layout — drop capitals', () => {
  it('sets an initial spanning three lines, at the left edge of the measure', () => {
    const book = run(doc([block('heading', 'Of the Air', 1), block('paragraph', PROSE)]), {
      dropCap: true
    })
    const opener = book.pages[book.chapterPages[0]!.pageIndex]!
    // The initial is by some distance the largest thing on the page — larger
    // than the chapter title, which is the next biggest.
    const initial = lines(opener)
      .flatMap((l) => l.runs)
      .reduce((biggest, r) => (r.sizePt > biggest.sizePt ? r : biggest))

    expect(initial.text).toBe('T')
    // It sits in the text block, not in the margin.
    expect(initial.xPt).toBeCloseTo(opener.frame.xPt, 6)
    // Its cap height spans about three baselines of body text.
    expect(initial.sizePt).toBeGreaterThan(leadingFor(11) * 2)
  })

  it('narrows the lines the initial stands beside — it is not drawn over them', () => {
    const book = run(doc([block('heading', 'Of the Air', 1), block('paragraph', PROSE)]), {
      dropCap: true
    })
    const opener = book.pages[book.chapterPages[0]!.pageIndex]!
    // Body lines, skipping the chapter title.
    const body = lines(opener).filter((l) => !l.runs.some((r) => r.text.includes('OF')))
    const leftEdgeOfText = (l: PositionedLine): number =>
      Math.min(...l.runs.filter((r) => r.sizePt <= 11).map((r) => r.xPt))

    // The three lines beside the initial are indented past it; the fourth is not.
    for (const i of [0, 1, 2]) {
      expect(leftEdgeOfText(body[i]!)).toBeGreaterThan(opener.frame.xPt + 1)
    }
    expect(leftEdgeOfText(body[3]!)).toBeCloseTo(opener.frame.xPt, 6)
  })

  it('leaves the initial out of the text it stands in for', () => {
    const book = run(
      doc([block('heading', 'Of the Air', 1), block('paragraph', 'The chirurgeon waited.')]),
      {
        dropCap: true
      }
    )
    const opener = book.pages[book.chapterPages[0]!.pageIndex]!
    expect(textOf(opener)).toContain('he chirurgeon waited.')
  })
})
