import { describe, it, expect } from 'vitest'
import {
  fixedWidthMeasurer,
  frameFor,
  layout,
  leadingFor,
  linesPerFrame,
  trimToPoints,
  type LaidOutBook,
  type LaidOutPage,
  type LayoutEdition,
  type OrnamentItem,
  type PositionedLine
} from '@core/layout'
import { BUILTIN_ORNAMENTS } from '@core/ornament'
import { defaultStyleProfile } from '@core/style'
import type { StyleProfile } from '@core/model'
import type { BookBlock, BookDocument } from '@core/assemble'

const measurer = fixedWidthMeasurer(0.5)

/** Every drawn run on a page — the items that are lines, not rules or pictures. */
const textRuns = (page: LaidOutPage) =>
  page.items.filter((i): i is PositionedLine => i.kind === 'line').flatMap((l) => l.runs)

const EDITION: LayoutEdition = {
  title: 'A Treatise of Airs',
  author: 'Robert Boyle',
  imprint: 'Scratch Press',
  copyrightHolder: 'The Publisher',
  editionDate: '2026',
  isbn: '978-0-00-000000-0',
  notices: ['The original work is in the public domain.']
}

let blockId = 0
function block(kind: BookBlock['kind'], text: string, level?: number): BookBlock {
  return {
    id: `p0b${blockId++}`,
    kind,
    text,
    sourcePages: [0],
    ...(level === undefined ? {} : { level })
  }
}

/** Enough prose to fill roughly a page and a half at the default style. */
const PROSE =
  'The chirurgeon examined the specimen with extraordinary care and reported his findings to the assembled company that evening. '.repeat(
    6
  )

function doc(blocks: BookBlock[], asides: BookBlock[] = []): BookDocument {
  return {
    blocks,
    footnotes: [],
    chapters: [],
    asides,
    illustrations: [],
    sections: [],
    skipped: []
  }
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

const bookText = (book: LaidOutBook): string => book.pages.map(textOf).join(' · ')

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
    // Capped, because the default profile caps its headings and a title page
    // set in upper and lower case beside capped chapter openings reads as two
    // books bound together.
    expect(textOf(book.pages[0]!)).toContain('A TREATISE OF AIRS')
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

  it('sets an emphasised word in italic and its neighbours in roman', () => {
    // The question this answers is the one a user asks looking at the proof
    // editor, where a textarea can show no italics at all: does the emphasis
    // the pass recovered actually reach the set page?
    const emphasised: BookBlock = {
      ...block('paragraph', 'a priest called hpho-bo in the original'),
      emphasis: [3]
    }
    const book = run(doc([emphasised]))
    const runs = book.pages.flatMap((p) => textRuns(p))
    const italic = runs.filter((r) => r.font.style === 'italic')
    expect(italic.map((r) => r.text.trim()).join(' ')).toBe('hpho-bo')
    // And nothing else on the line went italic with it.
    expect(runs.some((r) => r.font.style === 'regular' && r.text.includes('priest'))).toBe(true)
  })

  it('carries an emphasised phrase across every word of it', () => {
    const emphasised: BookBlock = {
      ...block('paragraph', 'how to project the astral body at will'),
      emphasis: [2, 3, 4, 5]
    }
    const book = run(doc([emphasised]))
    const italic = book.pages
      .flatMap((p) => textRuns(p))
      .filter((r) => r.font.style === 'italic')
      .map((r) => r.text.trim())
      .filter(Boolean)
    // A run per word, each positioned on its own — the phrase is italic entire.
    expect(italic).toEqual(['project', 'the', 'astral', 'body'])
  })

  it('does not set emphasis inside matter that is already italic', () => {
    // An epigraph is set italic entire, so an emphasised word inside one would
    // have to go roman to show at all — which is a decision, not a default.
    const emphasised: BookBlock = { ...block('epigraph', 'set wholly in italic'), emphasis: [1] }
    const book = run(doc([emphasised]))
    const styles = new Set(
      book.pages
        .flatMap((p) => textRuns(p))
        .filter((r) => r.text.includes('wholly') || r.text.includes('italic'))
        .map((r) => r.font.style)
    )
    expect([...styles]).toEqual(['italic'])
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

describe('layout — what a page is', () => {
  it('labels front matter, blanks, chapter openers and body pages', () => {
    const book = run(
      doc(
        [block('heading', 'Of the Air', 1), block('paragraph', PROSE)],
        [block('epigraph', 'For my father.')]
      )
    )
    const kinds = book.pages.map((p) => p.kind)
    expect(kinds).toContain('half-title')
    expect(kinds).toContain('title')
    expect(kinds).toContain('copyright')
    expect(kinds).toContain('aside')
    expect(kinds).toContain('blank')
    expect(kinds).toContain('chapter-opener')

    // A blank leaf carries nothing, and is a blank *because* of that.
    for (const page of book.pages.filter((p) => p.kind === 'blank')) {
      expect(lines(page)).toHaveLength(0)
    }
  })

  it('marks the chapter opener as the page the chapter starts on', () => {
    const book = run(doc([block('heading', 'Of the Air', 1), block('paragraph', PROSE)]))
    expect(book.pages[book.chapterPages[0]!.pageIndex]!.kind).toBe('chapter-opener')
  })
})

describe('layout — warnings', () => {
  it('says nothing when every line fits', () => {
    const book = run(doc([block('heading', 'Of the Air', 1), block('paragraph', PROSE)]))
    expect(book.warnings).toEqual([])
  })

  it('reports a line that runs past the margin, and which page it is on', () => {
    // A single word far wider than the measure cannot be broken or squeezed —
    // TeX's overfull hbox, and the one line-quality complaint worth surfacing.
    const monster = 'a'.repeat(400)
    const book = run(doc([block('paragraph', `Short opening. ${monster} And after.`)]))
    expect(book.warnings.length).toBeGreaterThan(0)
    const warning = book.warnings[0]!
    expect(warning.text).toContain('aaaa')
    expect(book.pages[warning.pageIndex]!.section).toBe('body')
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

describe('layout — chapter ornaments', () => {
  const ORNAMENT = BUILTIN_ORNAMENTS.find((o) => o.kind === 'chapter')!.id

  const chapter = () => doc([block('heading', 'Of the Air', 1), block('paragraph', PROSE)])
  const ornamented = (id: string | null = ORNAMENT) =>
    run(chapter(), { ornaments: { ...defaultStyleProfile().ornaments, chapterOpener: id } })

  const ornaments = (page: LaidOutPage): OrnamentItem[] =>
    page.items.filter((i): i is OrnamentItem => i.kind === 'ornament')

  it('sets one beneath the title, on the chapter opener and nowhere else', () => {
    const book = ornamented()
    const openerIndex = book.chapterPages[0]!.pageIndex
    for (const page of book.pages) {
      expect(ornaments(page)).toHaveLength(page.index === openerIndex ? 1 : 0)
    }

    const opener = book.pages[openerIndex]!
    const title = lines(opener).find((l) => l.runs.some((r) => r.text.includes('OF')))!
    expect(ornaments(opener)[0]!.yPt).toBeGreaterThan(title.baselinePt)
  })

  it('carries the art itself, so a renderer needs no lookup table', () => {
    const book = ornamented()
    const art = ornaments(book.pages[book.chapterPages[0]!.pageIndex]!)[0]!.art
    expect(art.id).toBe(ORNAMENT)
    expect(art.shapes.length).toBeGreaterThan(0)
  })

  it('centres it in the measure at a scale derived from its own viewBox', () => {
    const book = ornamented()
    const opener = book.pages[book.chapterPages[0]!.pageIndex]!
    const item = ornaments(opener)[0]!
    const widthPt = item.art.width * item.scale

    // Under half the measure: a full-width flourish competes with the title.
    expect(widthPt).toBeLessThan(opener.frame.widthPt * 0.5)
    const left = item.xPt - opener.frame.xPt
    const right = opener.frame.xPt + opener.frame.widthPt - (item.xPt + widthPt)
    expect(left).toBeCloseTo(right, 6)
  })

  it('holds slots for its full height, so the text below is not drawn over it', () => {
    const book = ornamented()
    const opener = book.pages[book.chapterPages[0]!.pageIndex]!
    const item = ornaments(opener)[0]!
    const bottom = item.yPt + item.art.height * item.scale

    const below = lines(opener)
      .map((l) => l.baselinePt)
      .filter((y) => y > item.yPt)
    expect(below.length).toBeGreaterThan(0)
    for (const baseline of below) expect(baseline).toBeGreaterThanOrEqual(bottom)
  })

  it('pushes the text down the page rather than being drawn behind it', () => {
    const firstBodyBaseline = (book: LaidOutBook): number => {
      const opener = book.pages[book.chapterPages[0]!.pageIndex]!
      return lines(opener).find((l) => l.runs.some((r) => r.text.includes('chirurgeon')))!
        .baselinePt
    }
    const gap = firstBodyBaseline(ornamented()) - firstBodyBaseline(ornamented(null))
    // A whole number of baselines, because the ornament claims grid slots — a
    // fractional gap would mean the body had come off the baseline grid.
    const slots = gap / leadingFor(defaultStyleProfile().bodyFontSize)
    expect(slots).toBeGreaterThan(0)
    expect(slots).toBeCloseTo(Math.round(slots), 6)
  })

  it('draws nothing at all when the profile names an ornament that is gone', () => {
    // A style saved against an older library must still lay the book out; the
    // flourish is decoration, and losing one is not worth losing the chapter.
    const book = ornamented('no-such-ornament')
    expect(book.pages.flatMap(ornaments)).toHaveLength(0)
    expect(bookText(book)).toContain('chirurgeon')
  })

  it('leaves a plain opener plain', () => {
    expect(ornamented(null).pages.flatMap(ornaments)).toHaveLength(0)
  })
})

describe('layout — divisions the editor wrote', () => {
  const PROSE_LONG = 'The author of this treatise is wholly unknown to us today. '.repeat(80)

  const withSection = (placement: 'front' | 'back', text = PROSE_LONG): BookDocument => ({
    ...doc([
      block('heading', 'Of the Air', 1),
      block('paragraph', PROSE),
      block('heading', 'Of Fire', 1),
      block('paragraph', PROSE)
    ]),
    sections: [
      {
        id: 'intro',
        placement,
        title: placement === 'front' ? 'Introduction' : 'Afterword',
        blocks: text.split(/\n\s*\n/).map((t, i) => ({
          id: `intro/b${i}`,
          kind: 'paragraph' as const,
          text: t,
          sourcePages: []
        }))
      }
    ]
  })

  const pagesOf = (book: LaidOutBook, needle: string) =>
    book.pages.filter((p) => textOf(p).includes(needle))

  it('sets an introduction in the front matter, in roman numerals', () => {
    const book = run(withSection('front'))
    const intro = pagesOf(book, 'wholly unknown')
    expect(intro.length).toBeGreaterThan(0)
    for (const page of intro) {
      expect(page.section).toBe('front')
      if (page.folio !== null) expect(page.folio).toMatch(/^[ivxlcdm]+$/)
    }
  })

  it('still numbers the body from one, after however many front pages', () => {
    // The count of front matter is read off the pages rather than captured
    // before the flow, precisely so an introduction cannot shift this.
    const book = run(withSection('front'))
    // The first *printed* body leaf. A blank verso may precede it, and belongs
    // to the front matter it closes rather than to the body it opens.
    expect(book.pages.find((p) => p.section === 'body' && p.folio !== null)!.folio).toBe('1')
  })

  it('puts the introduction before the body, not among it', () => {
    const book = run(withSection('front'))
    const lastIntro = Math.max(...pagesOf(book, 'wholly unknown').map((p) => p.index))
    const firstBody = book.pages.find((p) => p.section === 'body')!.index
    expect(lastIntro).toBeLessThan(firstBody)
  })

  it('flows over as many leaves as it needs — a section is not one page', () => {
    expect(pagesOf(run(withSection('front')), 'wholly unknown').length).toBeGreaterThan(1)
  })

  it('sets an afterword after the body, and keeps arabic numbering running', () => {
    const book = run(withSection('back'))
    const after = pagesOf(book, 'wholly unknown')
    const lastBody = Math.max(...book.pages.filter((p) => p.section === 'body').map((p) => p.index))
    expect(Math.min(...after.map((p) => p.index))).toBeGreaterThan(lastBody)
    for (const page of after) {
      if (page.folio !== null) expect(page.folio).toMatch(/^\d+$/)
    }
  })

  it('opens on a recto with its title, as a division of a book does', () => {
    const book = run(withSection('front'))
    const opener = book.pages.find((p) => textOf(p).includes('INTRODUCTION'))!
    expect(opener.side).toBe('recto')
  })

  it('is left out of a sample, which is asking about body pages', () => {
    const book = layout(withSection('front'), defaultStyleProfile(), measurer, {
      edition: EDITION,
      maxBodyPages: 2
    })
    expect(pagesOf(book, 'wholly unknown')).toEqual([])
  })

  it('changes nothing about a book that has no sections', () => {
    expect(JSON.stringify(run(doc([block('paragraph', PROSE)])))).toBe(
      JSON.stringify(run(doc([block('paragraph', PROSE)])))
    )
  })
})

describe('layout — an aside longer than its page', () => {
  it('carries on to another leaf instead of drawing off the bottom', () => {
    // Every line past the frame used to be placed at a slot the page does not
    // have, and drew below the text block and off the paper. Dedications are
    // two lines, which is why it went unnoticed — but any authored front matter
    // lands in the same code.
    const long = 'A dedication of quite unreasonable length, to everyone concerned. '.repeat(60)
    const book = run(doc([block('paragraph', PROSE)], [block('epigraph', long)]))
    const asides = book.pages.filter((p) => p.kind === 'aside')

    expect(asides.length).toBeGreaterThan(1)
    for (const page of asides) {
      // The aside's own text, not the folio — page furniture legitimately sits
      // below the text frame.
      const text = lines(page).filter((l) => l.runs.some((r) => r.text.includes('dedication')))
      for (const line of text) {
        expect(line.baselinePt).toBeLessThanOrEqual(page.frame.yPt + page.frame.heightPt + 1)
      }
    }
  })

  it('still sets a short aside on one leaf, sunk down the page', () => {
    const book = run(doc([block('paragraph', PROSE)], [block('epigraph', 'For my father.')]))
    const asides = book.pages.filter((p) => p.kind === 'aside')
    expect(asides).toHaveLength(1)
    expect(lines(asides[0]!)[0]!.baselinePt).toBeGreaterThan(asides[0]!.frame.yPt + 50)
  })
})

/**
 * Slots are one *body* leading apart, and a title page sets type at up to 1.6
 * times the body size. Advancing one slot a line put the second line of a
 * two-line title through the descenders of the first — on the title page, which
 * is the first thing anybody opens.
 */
describe('layout — the title page gives its type room', () => {
  it('leaves more than one body leading between two lines of a big title', () => {
    const book = layout(
      doc([block('paragraph', 'Body.')]),
      {
        ...defaultStyleProfile(),
        frontMatter: { halfTitle: false, titlePage: true, copyrightPage: false },
        ornaments: { chapterOpener: null, sectionDivider: null, pageNumber: null }
      },
      measurer,
      {
        edition: {
          ...EDITION,
          title: 'A Course of Advanced Lessons in Clairvoyance and Occult Powers'
        }
      }
    )
    const baselines = lines(book.pages[0]!)
      .filter((l) => l.runs.length > 0)
      .map((l) => l.baselinePt)
      .sort((a, b) => a - b)
    expect(baselines.length).toBeGreaterThan(2)
    const leading = 11 * 1.32
    // The title wraps; every gap inside it is more than one body leading.
    expect(baselines[1]! - baselines[0]!).toBeGreaterThan(leading * 1.2)
  })
})
