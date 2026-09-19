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

/**
 * How deep the contents goes.
 *
 * A book whose headings are all one level cannot tell the difference, which is
 * why nothing here noticed until a collected volume was set: thirty-two
 * chapters carrying a hundred and fifty sub-headings off the original
 * typescripts, and a contents that ran to four leaves and listed `Manly P.
 * Hall.` and `(To be continued.)` among the chapter titles.
 *
 * Two properties, and only the first is obvious. The entries are filtered, so a
 * deeper heading is left out of the list — and it is still a heading on the
 * page, still opens where it opened, so the body may not move. And the filter
 * runs on the shared entry list rather than inside either pass, which is what
 * keeps the two-pass scheme honest.
 */
describe('layoutWithToc — how deep the contents goes', () => {
  const nested = build(
    Array.from({ length: 12 }, (_, i) =>
      page(i, [
        { kind: 'heading' as const, text: `Chapter the ${i}`, level: 1 },
        { kind: 'paragraph' as const, text: PROSE.repeat(4) },
        { kind: 'heading' as const, text: `A section of ${i}`, level: 2 },
        { kind: 'paragraph' as const, text: PROSE.repeat(4) }
      ])
    )
  )
  const atDepth = (depth: number): LaidOutBook =>
    layoutWithToc(nested, { ...defaultStyleProfile(), contentsDepth: depth }, measurer, {
      edition: EDITION
    })
  const contentsText = (book: LaidOutBook): string =>
    book.pages
      .filter((p) => p.kind === 'contents')
      .map(textOf)
      .join(' ')

  it('lists the sections when it is asked for two levels', () => {
    const text = contentsText(atDepth(2))
    expect(text).toContain('Chapter the 3')
    expect(text).toContain('A section of 3')
  })

  it('leaves them out at one, and lists every chapter still', () => {
    const text = contentsText(atDepth(1))
    expect(text).toContain('Chapter the 3')
    expect(text).not.toContain('A section of')
    expect(text.match(/Page \d+/g) ?? []).toHaveLength(
      nested.chapters.filter((c) => (c.level ?? 1) === 1).length
    )
  })

  it('still sets the sections on the page — only the list is shorter', () => {
    // Set in capitals, as a heading is.
    const body = bookText(atDepth(1))
    expect(body).toContain('A SECTION OF 3')
  })

  it('measures its numbers at either depth, and never falls back', () => {
    for (const depth of [1, 2]) {
      const book = atDepth(depth)
      expect(book.warnings.filter((w) => /without page numbers/.test(w.text))).toHaveLength(0)
      // The numbers describe this book: the chapter really opens on the folio
      // the contents prints for it.
      const listed = contentsText(book)
      const chapter = book.chapterPages.find((c) => c.title === 'Chapter the 5')!
      const folio = book.pages[chapter.pageIndex]!.folio
      expect(listed).toContain(`Chapter the 5 Page ${folio}`)
    }
  })
})

/**
 * An analytical contents: the chapter's own description under its entry.
 *
 * Recovered from the scanned contents, which is otherwise discarded — and
 * discarded only because its page numbers describe a pagination this edition
 * does not have. The prose beside those numbers is editorial work and is the
 * reason such a page is read rather than scanned.
 *
 * The property that matters is the *two-pass* one. The contents is laid out
 * twice, blank folios then measured ones, and the second pass may not change
 * the length of the first or the numbers describe a book that no longer exists.
 * A description is safe there because it comes from the document rather than
 * from a layout — but "safe because I reasoned about it" is how that invariant
 * gets broken later, so it is asserted.
 */
describe('layoutWithToc — descriptions under the entries', () => {
  const described = build([
    page(0, [
      { kind: 'heading', text: 'Of the Air', level: 1 },
      { kind: 'paragraph', text: PROSE.repeat(8) }
    ]),
    page(1, [
      { kind: 'heading', text: 'Of Fire', level: 1 },
      { kind: 'paragraph', text: PROSE.repeat(8) }
    ])
  ])
  described.chapters[0]!.synopsis =
    'What the air is made of, and why the ancients thought otherwise. The bellows and its uses.'
  described.chapters[1]!.synopsis = 'The nature of flame. Whether fire is a substance or a motion.'

  const withSynopses = (on: boolean): LaidOutBook =>
    layoutWithToc(described, { ...defaultStyleProfile(), contentsSynopsis: on }, measurer, {
      edition: EDITION
    })

  // The line separator taken out, because a description wraps and any phrase
  // long enough to be worth searching for straddles a break.
  const flat = (book: LaidOutBook): string =>
    book.pages
      .filter((p) => p.kind === 'contents')
      .map(textOf)
      .join(' ')
      .replace(/ · /g, ' ')

  it('sets each description under its chapter', () => {
    const text = flat(withSynopses(true))
    expect(text).toContain('why the ancients thought otherwise')
    expect(text).toContain('Whether fire is a substance or a motion')
  })

  /**
   * The contents is built from the *raw* document, so it does not pass through
   * the conversion `layout` applies to the body. That went unseen for as long
   * as a contents was a column of capitalised titles — they have no quotes in
   * them — and showed the moment the descriptions arrived, which are prose.
   * A book whose body curls its quotes and whose contents does not is one book
   * set two ways.
   */
  it('curls the quotes in a description, as the body does', () => {
    const quoted = build([
      page(0, [
        { kind: 'heading', text: 'Of the Air', level: 1 },
        { kind: 'paragraph', text: PROSE.repeat(8) }
      ])
    ])
    quoted.chapters[0]!.synopsis =
      'The man who has much to say about "horse sense." What the bellows is for.'
    const book = layoutWithToc(
      quoted,
      { ...defaultStyleProfile(), contentsSynopsis: true },
      measurer,
      { edition: EDITION }
    )
    const text = flat(book)
    expect(text).toContain('\u201chorse sense.\u201d')
    expect(text).not.toContain('"horse sense."')
  })

  /**
   * The property the whole two-pass scheme rests on, asserted end to end: a
   * contents laid out with the folios blank must paginate the book exactly as
   * the same contents with them filled in.
   *
   * It did not. The folio line under a description was emitted only when the
   * number was known, so pass two ran a line per entry longer than pass one.
   * On a short book that absorbs into the same leaf and nothing shows; on a
   * book with enough described chapters it spills, `layoutWithToc` catches the
   * length change and falls back to pass one — which has no numbers in it —
   * and prints a contents page with no page numbers at all.
   *
   * So the fixture has to be big enough to spill. Two chapters would pass this
   * test with the bug still in.
   */
  const many = build(
    Array.from({ length: 40 }, (_, i) => ({
      index: i,
      blocks: [
        { kind: 'heading' as const, text: `Chapter the ${i}`, level: 1 },
        { kind: 'paragraph' as const, text: PROSE.repeat(8) }
      ]
    })).map((p) => page(p.index, p.blocks))
  )
  for (const chapter of many.chapters) {
    chapter.synopsis =
      'What the air is made of, and why the ancients thought otherwise. The bellows ' +
      'and its uses. The nature of flame, and whether fire is a substance or a motion.'
  }

  it('prints the numbers on a contents long enough to spill', () => {
    const book = layoutWithToc(
      many,
      { ...defaultStyleProfile(), contentsSynopsis: true },
      measurer,
      { edition: EDITION }
    )
    const contents = book.pages.filter((p) => p.kind === 'contents')
    expect(contents.length).toBeGreaterThan(1)

    // Every described entry carries its number, and the fallback never fired.
    const printed = contents.map(textOf).join(' ')
    expect(printed.match(/Page \d+/g) ?? []).toHaveLength(many.chapters.length)
    expect(book.warnings.filter((w) => /without page numbers/.test(w.text))).toHaveLength(0)
  })

  /**
   * The fault a proof copy showed and no test did: "CHAPTER VI." over
   * "DISEMBODIED SOULS." at the foot of one leaf, with every word of its
   * description overleaf.
   *
   * A contents page is scanned rather than read, so this is worse here than
   * the same break in the body would be — what the eye is hunting for is the
   * heading, and it finds one standing over nothing. The break test kept the
   * number and the title together and then let the description start wherever
   * it liked.
   */
  it('never leaves a chapter head at the foot of a leaf with its description overleaf', () => {
    const book = layoutWithToc(
      many,
      { ...defaultStyleProfile(), contentsSynopsis: true },
      measurer,
      { edition: EDITION }
    )
    const contents = book.pages.filter((p) => p.kind === 'contents')
    // More than one leaf, which is the only condition under which this can go
    // wrong at all.
    expect(contents.length).toBeGreaterThan(1)

    const isTitle = (l: PositionedLine): boolean => l.runs.some((r) => r.text === 'Chapter')
    const isFolio = (l: PositionedLine): boolean =>
      l.runs.length === 1 && /^Page$/.test(l.runs[0]!.text)

    let heads = 0
    for (const leaf of contents) {
      const ls = lines(leaf)
      ls.forEach((l, k) => {
        if (!isTitle(l)) return
        heads += 1
        // Two lines of description under it, on this leaf, and neither of them
        // the next entry's own head.
        const under = ls.slice(k + 1, k + 3)
        expect(under).toHaveLength(2)
        for (const u of under) expect(isTitle(u)).toBe(false)
      })
      // And the number is never stranded at the head of a leaf, which is the
      // same fault at the other end of the entry.
      if (ls.length > 0) expect(isFolio(ls[0]!)).toBe(false)
    }
    // Every chapter accounted for, so this is not passing on an empty loop.
    expect(heads).toBe(many.chapters.length)
  })

  it('leaves them out when the style says not to', () => {
    const text = flat(withSynopses(false))
    expect(text).toContain('Of the Air')
    expect(text).not.toContain('why the ancients thought otherwise')
  })

  /**
   * An analytical contents centres its chapter titles: the title sits over the
   * paragraph describing it, and the pair reads as one thing. A plain list of
   * names and numbers does not — there the eye runs down a column of first
   * letters, and centring would take that column away.
   */
  /**
   * One page, one axis.
   *
   * An entry is centred over the measure *less* the folio column, because its
   * number sits in that lane and a title centred through it would run into the
   * digits. The heading was centred over the whole measure, so the two
   * disagreed by half the folio column — 17pt on a 6×9 page, and CONTENTS sat
   * visibly right of every title under it.
   */
  it('sets the heading on the same axis as the entries it heads', () => {
    // The folio shares the entry's line and sits out in its own lane, so it is
    // dropped before the axis is measured — it is furniture, not the title.
    const mid = (l: PositionedLine) => {
      const runs = l.runs.filter((r) => !/^[0-9ivxlc]+$/i.test(r.text))
      const last = runs[runs.length - 1]!
      const left = Math.min(...runs.map((r) => r.xPt))
      return (left + last.xPt + measurer.widthOf(last.text, last.font, last.sizePt)) / 2
    }
    const contentsLines = withSynopses(true)
      .pages.filter((p) => p.kind === 'contents')
      .flatMap((c) => lines(c))
    const heading = contentsLines.find((l) =>
      l.runs.some((r) => /^Contents$|^CONTENTS$/.test(r.text))
    )
    const entry = contentsLines.find((l) => l.runs.some((r) => r.text === 'Air'))
    expect(heading).toBeDefined()
    expect(entry).toBeDefined()
    expect(mid(heading!)).toBeCloseTo(mid(entry!), 0)
  })

  it('centres the chapter titles when the descriptions are set', () => {
    const titleX = (book: LaidOutBook): number => {
      const run = book.pages
        .filter((p) => p.kind === 'contents')
        .flatMap((c) => lines(c))
        .flatMap((l) => l.runs)
        .find((r) => r.text.startsWith('Of'))
      return run!.xPt
    }
    expect(titleX(withSynopses(true))).toBeGreaterThan(titleX(withSynopses(false)))
  })

  /**
   * The property a plain contents actually has, and the reason not to centre
   * one: every entry starts at the same x, so the eye runs down a column of
   * first letters. Centring is a function of each title's width, so it breaks
   * that column — which is the point when there is a description under each,
   * and a loss when there is not.
   */
  it('keeps a plain contents in one column, and a descriptive one out of it', () => {
    const firstLetters = (book: LaidOutBook): number[] =>
      book.pages
        .filter((p) => p.kind === 'contents')
        .flatMap((c) => lines(c))
        .map((l) => l.runs[0])
        .filter((r): r is NonNullable<typeof r> => Boolean(r) && r.text.startsWith('Of'))
        .map((r) => r.xPt)

    const plain = firstLetters(withSynopses(false))
    expect(plain).toHaveLength(2)
    expect(plain[0]).toBeCloseTo(plain[1]!, 6)

    const centred = firstLetters(withSynopses(true))
    expect(centred).toHaveLength(2)
    expect(centred[0]).not.toBeCloseTo(centred[1]!, 3)
  })

  /**
   * The shape this book's own contents has, and the reason for it.
   *
   * Set with the number joined to the title and a lane reserved for the folio,
   * every entry came out both larger and wider than the paragraph it heads, so
   * it stuck out past both edges of its own description.
   */
  it('sets the number over the title, and the folio under the description', () => {
    const contentsLines = withSynopses(true)
      .pages.filter((p) => p.kind === 'contents')
      .flatMap((c) => lines(c))
    const at = (t: string) => contentsLines.findIndex((l) => l.runs.some((r) => r.text === t))

    const label = at('Air') // "Of the Air" is the title; the label is above it
    const folio = contentsLines.findIndex((l) => l.runs.some((r) => /^Page /.test(r.text)))
    expect(label).toBeGreaterThanOrEqual(0)
    expect(folio).toBeGreaterThan(label)

    // The folio sits after the description, not beside the title.
    const titleLine = contentsLines[label]!
    expect(titleLine.runs.some((r) => /^Page |^\d+$/.test(r.text))).toBe(false)

    // And no title reaches wider than the description it heads.
    const width = (l: PositionedLine) => {
      const last = l.runs[l.runs.length - 1]!
      return (
        last.xPt +
        measurer.widthOf(last.text, last.font, last.sizePt) -
        Math.min(...l.runs.map((r) => r.xPt))
      )
    }
    const prose = contentsLines.find((l) => l.runs.some((r) => r.text === 'ancients'))!
    expect(width(titleLine)).toBeLessThan(width(prose))

    // A step above the description rather than level with it, and set in the
    // *same* weight — which is what the original does. Its title reads as a
    // heading because it is letterspaced, and this engine has no tracking, so
    // size carries the whole distinction and a modest step is the honest
    // substitute. Bold was tried and was wrong: the original's description is a
    // heavy old face, so a same-weight title sits level with it, while a light
    // description under a bold title makes the title shout.
    const descSize = prose.runs[0]!.sizePt
    expect(titleLine.runs[0]!.sizePt / descSize).toBeCloseTo(1.053, 2)
    expect(titleLine.runs[0]!.font.style).toBe(prose.runs[0]!.font.style)
  })

  it('still prints the folio each chapter opens on', () => {
    const book = withSynopses(true)
    const contents = book.pages.filter((p) => p.kind === 'contents')
    // A descriptive contents sets the number as "Page 13" on a line of its own
    // under the description, the way this book's own contents does, so the run
    // carries the word as well as the digits.
    const printed = contents
      .flatMap((c) => lines(c))
      .flatMap((l) => l.runs)
      .filter((r) => /^(Page )?\d+$/.test(r.text))
      .map((r) => r.text.replace(/^Page /, ''))
    const actual = book.chapterPages.map((c) => book.pages[c.pageIndex]!.folio)
    for (const folio of actual) expect(printed).toContain(folio)
  })

  /**
   * The guard `layoutWithToc` already keeps, exercised with descriptions in
   * play: filling the numbers in must not move a single page.
   */
  it('does not let the second pass invalidate the first', () => {
    const book = withSynopses(true)
    const contents = book.pages.filter((p) => p.kind === 'contents')
    // More than one leaf of contents here, which is the point — descriptions
    // are long, and the flow across leaves is where a length change would show.
    expect(contents.length).toBeGreaterThan(0)
    const again = withSynopses(true)
    expect(again.pages.length).toBe(book.pages.length)
    expect(again.chapterPages).toEqual(book.chapterPages)
  })
})

/**
 * A numbered series in the contents: the number over the title, never beside it.
 *
 * `deriveChapters` gives a chapter carrying a run-in number line a `label`, and
 * a plain list used to set it by gluing the two into one string and breaking
 * wherever the measure fell. A collected volume of thirty-two numbered lectures
 * came out reading `MANUSCRIPT LECTURE No. 1 The Pros and Cons` on one line and
 * `of the Sex Problem` on the next. The number is not part of the title.
 *
 * And the folio column has to fit what the folio line actually says. It was cut
 * to four digits while the line prints `Page 49`, so a title broken to the
 * measure beside it ran straight through the number on a finished page.
 */
/**
 * A centred heading that wraps is balanced, not filled.
 *
 * Filling puts as much on the first line as the measure takes and leaves the
 * remainder on the second, which on a centred display line reads as a mistake.
 * A finished book carried `SIX MANUSCRIPT LECTURES BY MANLY P.` over `HALL`,
 * and `THE THEORY OF REINCARNATION - PART` over `ONE`, on the same page.
 */
describe('layout — a wrapped display heading', () => {
  const headed = (text: string): LaidOutBook =>
    layout(
      build([
        page(0, [
          { kind: 'heading', text, level: 1 },
          { kind: 'paragraph', text: PROSE }
        ])
      ]),
      defaultStyleProfile(),
      measurer,
      { edition: EDITION }
    )

  /** The words of each line the heading occupies, in order. */
  const headingRows = (book: LaidOutBook, first: string): string[][] => {
    const rows = book.pages
      .flatMap((p) => lines(p))
      .map((l) => l.runs.map((r) => r.text))
      .filter((r) => r.length > 0)
    const at = rows.findIndex((r) => r.includes(first))
    return rows.slice(at, at + 2)
  }

  it('does not leave one word alone on the second line', () => {
    const rows = headingRows(headed('SIX MANUSCRIPT LECTURES BY MANLY P. HALL'), 'SIX')
    expect(rows).toHaveLength(2)
    // The point of balancing: the two lines are within a word of each other,
    // rather than one full line and one orphan.
    expect(rows[1]!.length).toBeGreaterThan(1)
    expect(Math.abs(rows[0]!.length - rows[1]!.length)).toBeLessThanOrEqual(2)
  })

  /**
   * Balancing may not narrow past the longest word in the heading.
   *
   * The first version tested the line count alone, and a width narrower than
   * one word keeps the count: `breakParagraph` cannot break the word, so it
   * sets it on a line of its own that is wider than the measure and reports it
   * overfull. The search accepted that and kept narrowing, which put eight
   * fresh overfull warnings into a real book and set five chapter titles past
   * their own margins.
   */
  it('never narrows past a word it cannot break', () => {
    // Two words long enough that the balancing search can narrow past one of
    // them while still returning two lines. A heading of ordinary words cannot
    // trip this: the line count grows before the measure reaches any of them,
    // which is why the first fixture written here passed with the guard gone.
    const book = headed('PHILOPROGENITIVENESS AND ACQUISITIVENESS')
    // A layout warning carries the offending line's own text, so the fault
    // shows up as the heading's words coming back as warnings.
    expect(book.warnings.map((w) => w.text)).toEqual([])
    const page = book.pages.find((p) =>
      lines(p).some((l) => l.runs.some((r) => r.text === 'PHILOPROGENITIVENESS'))
    )!
    const right = page.frame.xPt + page.frame.widthPt
    for (const line of lines(page)) {
      for (const run of line.runs) {
        expect(run.xPt + measurer.widthOf(run.text, run.font, run.sizePt)).toBeLessThanOrEqual(
          right + 0.01
        )
      }
    }
  })

  it('keeps the heading on the same number of lines it would have filled', () => {
    // Balancing must never buy evenness with an extra line: the search is for
    // the narrowest measure that still returns the natural line count.
    const rows = headingRows(headed('THE THEORY OF REINCARNATION - PART ONE'), 'THE')
    expect(rows).toHaveLength(2)
    expect(rows[1]!.length).toBeGreaterThan(1)
  })
})

describe('layoutWithToc — a numbered entry in a plain contents', () => {
  const numbered = build([
    page(0, [
      { kind: 'heading', text: 'MANUSCRIPT LECTURE No. 6', level: 1 },
      { kind: 'heading', text: 'The Masters, Part I', level: 1 },
      { kind: 'paragraph', text: PROSE.repeat(8) }
    ]),
    page(1, [
      { kind: 'heading', text: 'MANUSCRIPT LECTURE No. 13', level: 1 },
      { kind: 'heading', text: 'The Dangers of New Thought, Metaphysics and Psychology', level: 1 },
      { kind: 'paragraph', text: PROSE.repeat(8) }
    ])
  ])
  const book = (): LaidOutBook =>
    layoutWithToc(numbered, defaultStyleProfile(), measurer, { edition: EDITION })

  const contentsLines = (b: LaidOutBook): PositionedLine[] =>
    b.pages.filter((p) => p.kind === 'contents').flatMap((p) => lines(p))

  it('sets the number on its own line, with the title on the line under it', () => {
    const rows = contentsLines(book()).map((l) => l.runs.map((r) => r.text).join(' '))
    const at = rows.findIndex((r) => r.includes('MANUSCRIPT LECTURE No. 6'))
    expect(at).toBeGreaterThanOrEqual(0)
    // The number line carries the number and nothing else.
    expect(rows[at]).not.toContain('Masters')
    // And the title is the next thing set.
    expect(rows[at + 1]).toContain('The Masters, Part I')
  })

  /**
   * The titles here sweep a range of lengths on purpose.
   *
   * The folio column is sized for the longest folio the contents can print, and
   * a title is broken to the measure that is left, so whether a given title
   * collides depends on where its last line happens to fall. One title proves
   * nothing: the first fixture written for this passed with the fault
   * reinstated, because both of its titles broke well short of the lane. A
   * sweep of lengths puts at least one last line in the band the fault opens.
   */
  const sweep = build(
    Array.from({ length: 22 }, (_, i) =>
      page(i, [
        { kind: 'heading' as const, text: `MANUSCRIPT LECTURE No. ${i + 1}`, level: 1 },
        {
          kind: 'heading' as const,
          // 30 characters, then one more word each time: the last line steps
          // across the measure rather than landing at one width.
          text: `Of the Nature of the Element${' xi'.repeat(i)}`,
          level: 1
        },
        { kind: 'paragraph' as const, text: PROSE.repeat(8) }
      ])
    )
  )

  it('never prints a title through its own page number', () => {
    const laid = layoutWithToc(sweep, defaultStyleProfile(), measurer, { edition: EDITION })
    const rows = laid.pages.filter((p) => p.kind === 'contents').flatMap((p) => lines(p))
    let checked = 0
    for (const line of rows) {
      const folio = line.runs.find((r) => /^Page \d+$/.test(r.text))
      if (!folio) continue
      checked += 1
      for (const run of line.runs) {
        if (run === folio) continue
        const right = run.xPt + measurer.widthOf(run.text, run.font, run.sizePt)
        expect(right).toBeLessThanOrEqual(folio.xPt + 0.01)
      }
    }
    // A test that found no folio line would pass without looking at anything.
    expect(checked).toBeGreaterThanOrEqual(20)
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

    // "Page 13", not a bare 13: the contents presents a page number one way
    // wherever it appears, described entry or not, plain list or not.
    const printed = lines(contents)
      .flatMap((l) => l.runs)
      .filter((r) => /^Page \d+$/.test(r.text))
      .map((r) => r.text.replace(/^Page /, ''))

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
      .filter((r) => /^Page \d+$/.test(r.text))

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

/**
 * A note names books more often than the text around it does, and until the
 * emphasis reached `breakNote` it was the only kind of block in the book that
 * could not italicise one: a tag typed in hope printed as the tag.
 */
describe('a footnote can italicise the book it names', () => {
  it('sets the marked words from a second, italic font', async () => {
    const { applyEdits } = await import('@core/edits')
    const document: BookDocument = {
      blocks: [
        {
          id: 'p0b0',
          kind: 'paragraph',
          text: 'Leadbeater described the plane at length.',
          sourcePages: [0]
        }
      ],
      footnotes: [],
      chapters: [],
      asides: [],
      illustrations: [],
      sections: [],
      skipped: [],
      synopsesUnmatched: []
    }
    const edited = applyEdits(document, [
      {
        kind: 'note',
        noteId: 'n1',
        blockId: 'p0b0',
        at: 11,
        text: 'See <i>The Astral Plane</i> of 1895.'
      }
    ])
    expect(edited.footnotes[0]!.text).toBe('See The Astral Plane of 1895.')
    expect(edited.footnotes[0]!.emphasis).toEqual([1, 2, 3])

    const book = layout(edited, defaultStyleProfile(), measurer, { edition: EDITION })
    const italic = book.pages
      .flatMap((p) => p.items)
      .filter((i): i is PositionedLine => i.kind === 'line')
      .flatMap((l) => l.runs)
      .filter((r) => r.font.style === 'italic')
      .map((r) => r.text)
    expect(italic).toEqual(expect.arrayContaining(['The', 'Astral', 'Plane']))
    // And nothing either side of it went italic with them.
    expect(italic).not.toContain('See')
    expect(italic).not.toContain('1895.')
  })
})
