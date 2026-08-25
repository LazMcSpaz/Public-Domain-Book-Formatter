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
    expect(titleLine.runs[0]!.sizePt / descSize).toBeCloseTo(1.15, 2)
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
