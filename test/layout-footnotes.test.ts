import { describe, it, expect } from 'vitest'
import {
  ENDNOTES_TITLE,
  fixedWidthMeasurer,
  layout,
  layoutWithToc,
  prepareFootnotes,
  type LaidOutBook,
  type LaidOutPage,
  type LayoutEdition,
  type PositionedLine
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import { assembleBook } from '@core/assemble'
import type { BookDocument } from '@core/assemble'
import type { StyleProfile } from '@core/model'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'

const measurer = fixedWidthMeasurer(0.5)

const EDITION: LayoutEdition = { title: 'A Treatise of Airs', author: 'Robert Boyle' }

const PROSE =
  'The chirurgeon examined the specimen with extraordinary care and reported his findings to the assembled company that evening. '

function page(pageIndex: number, blocks: TranscribedBlock[]): PageTranscription {
  return { pageIndex, role: 'body', blocks, uncertain: [], furniture: {} }
}

/** Built through the real assembly path, so the tests exercise both. */
function build(pages: PageTranscription[]): BookDocument {
  return assembleBook(pages)
}

function run(doc: BookDocument, over: Partial<StyleProfile> = {}): LaidOutBook {
  return layout(doc, { ...defaultStyleProfile(), ...over }, measurer, { edition: EDITION })
}

const lines = (p: LaidOutPage): PositionedLine[] =>
  p.items.filter((i): i is PositionedLine => i.kind === 'line')

const textOf = (p: LaidOutPage): string =>
  lines(p)
    .map((l) => l.runs.map((r) => r.text).join(' '))
    .join(' · ')

const bookText = (b: LaidOutBook): string => b.pages.map(textOf).join(' · ')

describe('prepareFootnotes — locating and renumbering reference marks', () => {
  it('strips the printed marker and reports the word it rode on', () => {
    const doc = build([
      page(0, [
        { kind: 'paragraph', text: 'The alembick was set on a gentle fire.1 It was watched.' },
        { kind: 'footnote', text: 'See Croll.', marker: '1' }
      ])
    ])
    const prepared = prepareFootnotes(doc.blocks, doc.footnotes)

    // The old mark is gone: it is redrawn during layout at its own size, and
    // leaving it would print the original digit beside the new one.
    expect(prepared.blocks[0]!.text).toContain('gentle fire. It was watched.')
    expect(prepared.blocks[0]!.references).toEqual([{ wordIndex: 7, noteId: 'fn1', mark: '1' }])
  })

  it('does not mistake a numeral in the text for a reference mark', () => {
    const doc = build([
      page(0, [
        { kind: 'paragraph', text: 'Printed in 1662 and again in 1682 with a note.1 Fine.' },
        { kind: 'footnote', text: 'A note.', marker: '1' }
      ])
    ])
    const prepared = prepareFootnotes(doc.blocks, doc.footnotes)
    expect(prepared.blocks[0]!.text).toContain('1662')
    expect(prepared.blocks[0]!.text).toContain('1682')
    expect(prepared.blocks[0]!.references).toHaveLength(1)
  })

  it('renumbers straight through the book, in the order the marks are read', () => {
    // The printed markers restart and use symbols; a new edition should not.
    const doc = build([
      page(0, [
        { kind: 'paragraph', text: 'First claim.* Second claim.1' },
        { kind: 'footnote', text: 'Note on the first.', marker: '*' },
        { kind: 'footnote', text: 'Note on the second.', marker: '1' }
      ]),
      page(1, [
        { kind: 'paragraph', text: 'A later claim.1' },
        { kind: 'footnote', text: 'Note on the later one.', marker: '1' }
      ])
    ])
    const prepared = prepareFootnotes(doc.blocks, doc.footnotes)
    const marks = prepared.blocks.flatMap((b) => b.references.map((r) => r.mark))
    expect(marks).toEqual(['1', '2', '3'])
  })

  it('reports a note whose marker is nowhere in the body', () => {
    const doc = build([
      page(0, [
        { kind: 'paragraph', text: 'No marker appears here at all.' },
        { kind: 'footnote', text: 'Stranded.', marker: '7' }
      ])
    ])
    const prepared = prepareFootnotes(doc.blocks, doc.footnotes)
    expect(prepared.orphans.map((o) => o.text)).toEqual(['Stranded.'])
    expect(prepared.notes.size).toBe(0)
  })
})

describe('layout — footnotes', () => {
  const doc = build([
    page(0, [
      { kind: 'heading', text: 'Of the Air', level: 1 },
      { kind: 'paragraph', text: `${PROSE.repeat(4)}A first observation.1 ${PROSE.repeat(3)}` },
      { kind: 'footnote', text: 'See Croll, Basilica Chymica, lib. ii.', marker: '1' }
    ]),
    page(1, [
      { kind: 'paragraph', text: `${PROSE.repeat(5)}A second observation.2 ${PROSE.repeat(2)}` },
      { kind: 'footnote', text: 'Boyle disputes this.', marker: '2' }
    ])
  ])

  it('sets every note that has a reference', () => {
    const book = run(doc)
    expect(book.notesPlaced).toBe(2)
    expect(book.notesDropped).toEqual([])
    expect(bookText(book)).toContain('Basilica')
    expect(bookText(book)).toContain('Boyle disputes this.')
  })

  it('sets each note on the page its reference landed on', () => {
    const book = run(doc)
    const pageWith = (needle: string): LaidOutPage =>
      book.pages.find((p) => textOf(p).includes(needle))!

    expect(pageWith('A first observation.').index).toBe(pageWith('Basilica').index)
    expect(pageWith('A second observation.').index).toBe(pageWith('Boyle disputes').index)
  })

  it('draws a separator rule above the notes, and only where there are notes', () => {
    const book = run(doc)
    for (const p of book.pages) {
      const rules = p.items.filter((i) => i.kind === 'rule')
      const hasNotes = textOf(p).includes('Basilica') || textOf(p).includes('Boyle disputes')
      expect(rules.length).toBe(hasNotes ? 1 : 0)
    }
  })

  it('keeps the notes below the last line of body text', () => {
    const book = run(doc)
    const p = book.pages.find((x) => textOf(x).includes('Basilica'))!
    const rule = p.items.find((i) => i.kind === 'rule')!
    const bodyBaselines = lines(p)
      .filter((l) => l.runs.some((r) => r.text === 'chirurgeon'))
      .map((l) => l.baselinePt)

    expect(bodyBaselines.length).toBeGreaterThan(0)
    expect(Math.max(...bodyBaselines)).toBeLessThan(rule.yPt)
  })

  it('sets the reference mark smaller than the text and lifted off its baseline', () => {
    const book = run(doc)
    const marks = book.pages
      .flatMap((p) => lines(p))
      .flatMap((l) => l.runs)
      .filter((r) => r.risePt !== undefined && r.risePt > 0)

    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) expect(mark.sizePt).toBeLessThan(defaultStyleProfile().bodyFontSize)
  })

  it('reserves the note space before the line that pulls the note in', () => {
    // The reservation shrinks the body, so a book with notes takes at least as
    // many pages as the same book without them. A page that ignored the
    // reservation would print the notes over its own last lines.
    const withNotes = run(doc)
    const withoutNotes = run({ ...doc, footnotes: [] })
    expect(withNotes.pages.length).toBeGreaterThanOrEqual(withoutNotes.pages.length)
  })

  it('leaves an unreferenced note out, and says so rather than dropping it silently', () => {
    const stranded = build([
      page(0, [
        { kind: 'paragraph', text: PROSE.repeat(2) },
        { kind: 'footnote', text: 'Nothing points at me.', marker: '9' }
      ])
    ])
    const book = run(stranded)
    expect(book.notesPlaced).toBe(0)
    expect(book.notesDropped).toHaveLength(1)
    expect(book.notesDropped[0]!.reason).toMatch(/no reference mark/)
    expect(bookText(book)).not.toContain('Nothing points at me.')
  })

  it('terminates on a note longer than the page, and warns', () => {
    const monster = build([
      page(0, [
        { kind: 'paragraph', text: `A short paragraph with a mark.1 ${PROSE}` },
        { kind: 'footnote', text: PROSE.repeat(40), marker: '1' }
      ])
    ])
    const book = run(monster)
    expect(book.pages.length).toBeGreaterThan(0)
    expect(book.warnings.some((w) => w.text.includes('longer than the page'))).toBe(true)
  })
})

describe('layout — notes with no reference mark', () => {
  const stranded = build([
    page(0, [
      { kind: 'heading', text: 'Of the Air', level: 1 },
      { kind: 'paragraph', text: `${PROSE.repeat(3)}A first observation.1 ${PROSE.repeat(2)}` },
      { kind: 'footnote', text: 'See Croll, Basilica Chymica, lib. ii.', marker: '1' },
      { kind: 'footnote', text: 'Concerning the weight of the aire.', marker: '9' }
    ])
  ])

  const collect = (): LaidOutBook =>
    layout(stranded, defaultStyleProfile(), measurer, {
      edition: EDITION,
      orphanNotes: 'collect'
    })

  it('sets them as a back-matter section rather than dropping them', () => {
    const book = collect()
    expect(book.notesCollected).toBe(1)
    expect(book.notesDropped).toEqual([])
    expect(bookText(book)).toContain('Concerning the weight of the aire.')
  })

  it('heads the section, so a reader can see what those paragraphs are', () => {
    const text = bookText(collect())
    expect(text.toUpperCase()).toContain(ENDNOTES_TITLE.toUpperCase())
  })

  it('keeps the note’s own printed marker — the only clue to where it belonged', () => {
    // Renumbering would be a lie: nothing in the text points at this note, so
    // the "9" the original printer set is all the placement information there is.
    expect(bookText(collect())).toContain('9 Concerning')
  })

  it('leaves the notes that *were* placed at the foot of their page', () => {
    const book = collect()
    expect(book.notesPlaced).toBe(1)
    const foot = book.pages.find((p) => textOf(p).includes('Basilica'))!
    // Same page as the reference, not swept into the back matter.
    expect(textOf(foot)).toContain('A first observation.')
  })

  it('reports them as dropped when the user asked for them to be left out', () => {
    // The gate's other answer. They must not appear in the book — and must not
    // disappear from the report either, which is the failure that matters.
    const book = layout(stranded, defaultStyleProfile(), measurer, {
      edition: EDITION,
      orphanNotes: 'omit'
    })
    expect(book.notesCollected).toBe(0)
    expect(bookText(book)).not.toContain('weight of the aire')
    expect(book.notesDropped).toHaveLength(1)
    expect(book.notesDropped[0]!.reason).toContain('no reference mark')
  })

  it('adds nothing when every note found its reference', () => {
    const clean = build([
      page(0, [
        { kind: 'paragraph', text: `${PROSE}An observation.1 ${PROSE}` },
        { kind: 'footnote', text: 'See Croll.', marker: '1' }
      ])
    ])
    const book = layout(clean, defaultStyleProfile(), measurer, {
      edition: EDITION,
      orphanNotes: 'collect'
    })
    expect(book.notesCollected).toBe(0)
    expect(bookText(book)).not.toContain(ENDNOTES_TITLE.toUpperCase())
  })

  it('lists the collected section in the contents, with a measured number', () => {
    const book = layoutWithToc(stranded, defaultStyleProfile(), measurer, {
      edition: EDITION,
      orphanNotes: 'collect'
    })
    const contents = book.pages.find((p) => p.kind === 'contents')!
    expect(textOf(contents).toUpperCase()).toContain(ENDNOTES_TITLE.toUpperCase())

    // The entry has to carry a folio, or it is an index entry with no index.
    const heading = book.chapterPages.find((c) => c.title === ENDNOTES_TITLE)!
    expect(book.pages[heading.pageIndex]!.folio).not.toBeNull()
  })

  it('gives a book with nothing but stranded notes a contents page anyway', () => {
    // No chapters, so the single-pass shortcut would otherwise skip the
    // contents — and the one section this book has would go unlisted.
    const noChapters = build([
      page(0, [
        { kind: 'paragraph', text: PROSE.repeat(3) },
        { kind: 'footnote', text: 'Nowhere referenced.', marker: '4' }
      ])
    ])
    const book = layoutWithToc(noChapters, defaultStyleProfile(), measurer, {
      edition: EDITION,
      orphanNotes: 'collect'
    })
    expect(book.pages.some((p) => p.kind === 'contents')).toBe(true)
    expect(book.notesCollected).toBe(1)
  })
})

describe('layoutWithToc — a contents page with measured numbers', () => {
  const doc = build([
    page(0, [
      { kind: 'heading', text: 'Of the Air', level: 1 },
      { kind: 'paragraph', text: PROSE.repeat(8) }
    ]),
    page(1, [
      { kind: 'heading', text: 'Of Fire', level: 1 },
      { kind: 'paragraph', text: PROSE.repeat(8) }
    ]),
    page(2, [
      { kind: 'heading', text: 'Of Water', level: 1 },
      { kind: 'paragraph', text: PROSE.repeat(8) }
    ])
  ])

  const withToc = (): LaidOutBook =>
    layoutWithToc(doc, defaultStyleProfile(), measurer, { edition: EDITION })

  it('lists every chapter', () => {
    const contents = withToc().pages.filter((p) => p.kind === 'contents')
    expect(contents).toHaveLength(1)
    const text = textOf(contents[0]!)
    expect(text).toContain('Of the Air')
    expect(text).toContain('Of Fire')
    expect(text).toContain('Of Water')
  })

  it('prints the folio each chapter actually opens on', () => {
    const book = withToc()
    const contents = book.pages.find((p) => p.kind === 'contents')!

    const printed = lines(contents)
      .flatMap((l) => l.runs)
      .filter((r) => /^\d+$/.test(r.text))
      .map((r) => r.text)

    const actual = book.chapterPages.map((c) => book.pages[c.pageIndex]!.folio)
    expect(actual.every((f) => f !== null)).toBe(true)
    expect(printed).toEqual(actual)
  })

  it('sets the folio in a fixed column, which is what makes the second pass safe', () => {
    // If a page number could push a title onto another line, filling the real
    // numbers in would lengthen the contents and move the pages it numbers.
    const book = withToc()
    const contents = book.pages.find((p) => p.kind === 'contents')!
    const folios = lines(contents)
      .flatMap((l) => l.runs)
      .filter((r) => /^\d+$/.test(r.text))

    expect(folios.length).toBeGreaterThan(1)
    const rightEdges = folios.map((r) => r.xPt + measurer.widthOf(r.text, r.font, r.sizePt))
    for (const edge of rightEdges) expect(edge).toBeCloseTo(rightEdges[0]!, 6)
  })

  it('settles: laying out twice gives the same book', () => {
    expect(JSON.stringify(withToc())).toBe(JSON.stringify(withToc()))
  })

  it('adds pages, and still numbers the body from one', () => {
    const plain = layout(doc, defaultStyleProfile(), measurer, { edition: EDITION })
    const book = withToc()
    expect(book.pages.length).toBeGreaterThan(plain.pages.length)
    expect(book.pages.find((p) => p.section === 'body')!.folio).toBe('1')
  })

  it('skips the contents when there is nothing to list', () => {
    const noChapters = build([page(0, [{ kind: 'paragraph', text: PROSE.repeat(3) }])])
    const book = layoutWithToc(noChapters, defaultStyleProfile(), measurer, { edition: EDITION })
    expect(book.pages.some((p) => p.kind === 'contents')).toBe(false)
  })

  it('skips the contents for a sample, which would list a book that isn’t there', () => {
    const book = layoutWithToc(doc, defaultStyleProfile(), measurer, {
      edition: EDITION,
      maxBodyPages: 2
    })
    expect(book.pages.some((p) => p.kind === 'contents')).toBe(false)
  })
})
