import { describe, it, expect } from 'vitest'
import { assembleBook, type BookDocument } from '@core/assemble'
import {
  applyEdits,
  findMatches,
  sweepText,
  synopsesOf,
  withEdit,
  type BookEdit
} from '@core/edits'
import {
  contentsPages,
  fixedWidthMeasurer,
  layout,
  layoutWithToc,
  synopsisWithPages,
  type LaidOutBook,
  type LaidOutPage,
  type LayoutOptions,
  type PositionedLine
} from '@core/layout'
import { unapplied, type Ruling } from '@core/queries'
import { migrateSavedRun } from '@core/project'
import { defaultStyleProfile } from '@core/style'
import type { PageRole } from '@core/pages'
import type { PageTranscription, TranscribedBlock } from '@core/transcribe'

/**
 * The page references in an analytical contents, set to this edition's pages.
 *
 * The shape is *The Mahatma Letters*' (1923): each letter a paragraph, its
 * topics closed by `; <page of the 1923 printing>.` What the editor asked for
 * is the numbers updated, and "updated" has an exact meaning — the page of
 * this edition on which the first word of that 1923 page falls.
 */

const measurer = fixedWidthMeasurer(0.5)
const EDITION = { title: 'The Letters', author: 'A Compiler' }
const options: LayoutOptions = { edition: EDITION }

function leaf(
  pageIndex: number,
  blocks: TranscribedBlock[],
  role: PageRole = 'body',
  folio?: string
): PageTranscription {
  return {
    pageIndex,
    role,
    blocks,
    uncertain: [],
    furniture: folio === undefined ? {} : { folio }
  }
}
const p = (text: string): TranscribedBlock => ({ kind: 'paragraph', text })
const h = (text: string, level = 1): TranscribedBlock => ({ kind: 'heading', text, level })
/** `count` words of their own, so a word on a page says where it came from. */
const run = (prefix: string, count: number): string =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(' ')

/**
 * Leaf 0 is the contents, leaves 1 and 2 are blank, and the body begins on
 * leaf 3 as the original's page 1 — so the original's page n is leaf n + 2,
 * which nothing here is told: it is read off the folios the leaves print.
 * Letter I is one paragraph across three leaves, so the original's page 3
 * opens in the middle of it, on `zanzibar`. Leaf 7 opens a section and letter
 * II under it — `SECTION II` is set small over the section's title, as one
 * opening — and prints no folio, as a chapter opening often does not.
 */
function letters(): PageTranscription[] {
  return [
    leaf(
      0,
      [
        h('CONTENTS'),
        p('Page'),
        p('Introduction - - - - - - - - - - - - 1'),
        p(
          'Letter No. I.—The opening topics re-received; 1. The zanzibar qeustion ' +
            'raised—its consequences; 3. Remarks; 4.'
        ),
        p('Letter No. II.—The second letter, which runs over two pages, in full; 5-6.')
      ],
      'table-of-contents',
      'v'
    ),
    leaf(1, [], 'blank'),
    leaf(2, [], 'blank'),
    leaf(3, [h('LETTER No. I'), p(run('alpha', 400))], 'body', '1'),
    leaf(4, [p(run('beta', 400))], 'body', '2'),
    leaf(5, [p(`zanzibar ${run('gamma', 400)}.`)], 'body', '3'),
    leaf(6, [p(`Delta ${run('delta', 300)}.`)], 'body', '4'),
    leaf(
      7,
      [
        h('SECTION II'),
        h('THE SECOND PART'),
        h('LETTER No. II', 2),
        p(`Epsilon ${run('epsilon', 300)}`)
      ],
      'body'
    ),
    leaf(8, [p(`${run('zeta', 300)}.`)], 'body', '6')
  ]
}

const lines = (page: LaidOutPage): PositionedLine[] =>
  page.items.filter((i): i is PositionedLine => i.kind === 'line')
const runsOn = (page: LaidOutPage): string[] =>
  lines(page).flatMap((l) => l.runs.map((r) => r.text))
const contentsText = (book: LaidOutBook): string =>
  book.pages
    .filter((pg) => pg.kind === 'contents')
    .flatMap(runsOn)
    .join(' ')
/** The body page that sets a word — the contents may name it too. */
const pageWith = (book: LaidOutBook, word: string): LaidOutPage =>
  book.pages.find((pg) => pg.section === 'body' && runsOn(pg).includes(word))!

describe('a reference set to the page its first word fell on', () => {
  const doc = assembleBook(letters())
  const book = layoutWithToc(doc, defaultStyleProfile(), measurer, options)
  const letterOne = doc.chapters.find((c) => c.title === 'LETTER No. I')!

  it('attaches each letter’s description, references and all', () => {
    expect(letterOne.synopsis).toMatch(/^The opening topics re-received; 1\./)
    expect(letterOne.synopsisSource).toMatchObject({ id: 'p0b3', pages: [0] })
    expect(letterOne.synopsisSource!.references!.map((r) => [r.from, r.to])).toEqual([
      [1, 1],
      [3, 3],
      [4, 4]
    ])
    expect(doc.synopsesUnmatched).toEqual([])
  })

  /**
   * The case the whole mechanism exists for. The original's page 3 begins
   * with `zanzibar`, eight hundred words into a paragraph that opened two
   * leaves earlier — so the page that paragraph opens on and the page
   * `zanzibar` was set on are different pages, and only the second is right.
   */
  it('is the page that word was set on, not the page its paragraph opened on', () => {
    const zanzibar = pageWith(book, 'zanzibar')
    const opened = book.blockPages.find((b) => b.blockId === 'p3b1')!
    expect(opened.folio).not.toBe(zanzibar.folio)
    expect(contentsText(book)).toContain(`raised—its consequences; ${zanzibar.folio}.`)
  })

  it('sets a page that opens a chapter to the chapter’s page', () => {
    const opening = book.chapterPages.find((c) => c.title === 'LETTER No. I')!
    expect(contentsText(book)).toContain(
      `re-received; ${book.pages[opening.pageIndex]!.folio}. The zanzibar`
    )
  })

  /**
   * The original's page 5 begins with `SECTION II`, which the layout sets as
   * the line over the section's title and records no page for. It is on the
   * page of the opening it belongs to.
   */
  it('sets a page that opens on a number line to the page of its opening', () => {
    const section = book.chapterPages.find((c) => c.title === 'THE SECOND PART')!
    const folio = book.pages[section.pageIndex]!.folio
    expect(book.blockPages.some((b) => b.blockId === 'p7b0')).toBe(false)
    expect(contentsText(book)).toMatch(new RegExp(`in full; ${folio}(-\\d+)?\\.`, 'u'))
  })

  it('writes a range the way the book does, and one that falls on one page as that page', () => {
    const from = pageWith(book, 'Epsilon').folio!
    const to = pageWith(book, 'zeta0').folio!
    const expected =
      from === to ? from : `${from}-${to.slice([...from].findIndex((c, i) => c !== to[i]))}`
    expect(contentsText(book)).toContain(`two pages, in full; ${expected}.`)
  })

  /**
   * The original's page 9 is past the last leaf this scan carries, so no leaf
   * says where it is. The reference is printed without a number — never with
   * the 1923 one, never with a guess — and the export says which it was.
   */
  it('reports a reference to a page the book never prints, and prints no number for it', () => {
    const pages = letters()
    pages[0]!.blocks[4] = p(
      'Letter No. II.—The second letter, which runs over two pages, in full; 5-6. Postscript; 9.'
    )
    const short = layoutWithToc(assembleBook(pages), defaultStyleProfile(), measurer, options)
    expect(contentsText(short)).toMatch(/in full; \d+(-\d+)?\. Postscript\./u)
    expect(short.warnings.map((w) => w.text)).toContainEqual(
      expect.stringMatching(/1 page reference in the original contents .*LETTER No\. II \(9\)/u)
    )
    expect(book.warnings.some((w) => /cannot place/u.test(w.text))).toBe(false)
  })

  /**
   * A numbered page with no text on it — here the original's page 4 is left
   * blank — sends a reader to what comes next, which is where its matter
   * would be found: the page the next leaf's text begins on.
   */
  it('sends a page with no text of its own to where the next text begins', () => {
    const pages = letters()
    pages[6] = leaf(6, [], 'blank', '4')
    const doc4 = assembleBook(pages)
    const laid = layoutWithToc(doc4, defaultStyleProfile(), measurer, options)
    const next = laid.chapterPages.find((c) => c.title === 'LETTER No. II')!.pageIndex
    expect(contentsPages(doc4, laid).pageOfFolio(4)).toBe(next)
  })

  /** A numbered plate's page is the page its picture was set on. */
  it('sends a page that holds only a picture to the page the picture was set on', () => {
    const pages = letters()
    pages[6] = leaf(6, [{ kind: 'caption', text: 'The plate.' }], 'plate', '4')
    const doc4 = assembleBook(pages, {
      illustrations: [{ id: 'plate', pageIndex: 6, sourceWidth: 600, sourceHeight: 400 }]
    })
    const laid = layoutWithToc(doc4, defaultStyleProfile(), measurer, options)
    const set = laid.imagesPlaced.find((i) => i.id === 'plate')!
    const next = laid.chapterPages.find((c) => c.title === 'LETTER No. II')!.pageIndex
    expect(set.pageIndex).not.toBe(next)
    expect(contentsPages(doc4, laid).pageOfFolio(4)).toBe(set.pageIndex)
  })

  it('prints nothing of the original’s numbers', () => {
    // The 1923 `; 3.` would send the reader to the wrong page.
    const text = contentsText(book)
    expect(text).not.toContain('raised—its consequences; 3.')
  })

  it('takes nothing from the leader lines above the first entry', () => {
    expect(doc.chapters.filter((c) => c.synopsis !== undefined)).toHaveLength(2)
  })
})

/**
 * How the letters find their chapters. The body heads each letter with its
 * number alone (`LETTER No. XVI`), so the contents' label is the only name the
 * two share; some headings carry a note's mark; and a letter the body prints
 * in parts is described once.
 */
describe('matching a letter’s description to the letter', () => {
  const contents = leaf(
    0,
    [
      h('CONTENTS'),
      p('Letter No. I.—The first letter, which is described at some length here; 1.'),
      p('Letter No. III.—“ Brooch ” phenomenon—postal address in N.W.P.—Pillow incidents; 2.'),
      p('Letter No. X.—The philosophy of the Mahatmas with regard to God; 3.'),
      p('Letter No. XCIX.—From A. O. Hume to K.H., a letter the body never prints; 4.')
    ],
    'table-of-contents'
  )
  const doc = assembleBook([
    contents,
    leaf(1, [h('LETTER No. I'), p('First letter text.')], 'body', '1'),
    leaf(
      2,
      [h('LETTER No. IIIa.'), p('Part a.'), h('LETTER No. IIIb.'), p('Part b.')],
      'body',
      '2'
    ),
    leaf(3, [h('LETTER No. X¹'), p('Tenth letter text.')], 'body', '3'),
    leaf(4, [h('* * *'), p('After a break.')], 'body', '4')
  ])
  const titled = (title: string) => doc.chapters.find((c) => c.title === title)!

  it('finds a letter by its label, the one name both pages give it', () => {
    expect(titled('LETTER No. I').synopsis).toMatch(/^The first letter/)
  })

  it('finds a heading that carries a note’s mark', () => {
    expect(titled('LETTER No. X¹').synopsis).toMatch(/^The philosophy/)
  })

  it('describes a letter printed in parts under its first part', () => {
    expect(titled('LETTER No. IIIa.').synopsis).toMatch(/^“ Brooch ” phenomenon/)
    expect(titled('LETTER No. IIIb.').synopsis).toBeUndefined()
  })

  /**
   * A letter named by its number has no title, and a heading with no letters
   * in it has no name: the two must not meet on the empty string, where the
   * break would take whichever description happened to be keyed there last.
   */
  it('gives a heading with no name no description', () => {
    expect(titled('* * *').synopsis).toBeUndefined()
  })

  it('reports the one nothing claimed, with where it came from', () => {
    expect(doc.synopsesUnmatched).toEqual([
      expect.objectContaining({
        label: 'Letter No. XCIX',
        source: expect.objectContaining({ id: 'p0b4', pages: [0] })
      })
    ])
  })
})

/**
 * The preface and introduction stand above the letters in the original's
 * contents, set with dashes for leaders. The body prints both as chapters and
 * the contents lists the body's chapters, so each is listed once — the leader
 * lines are not entries, and nothing of them is printed beside the body's own.
 */
describe('the front matter the original contents also lists', () => {
  const doc = assembleBook([
    leaf(0, [h('COMPILER’S PREFACE'), p(run('preface', 200))], 'preface', 'v'),
    leaf(1, [h('INTRODUCTION'), p(run('intro', 200))], 'preface', 'vi'),
    leaf(
      2,
      [
        h('CONTENTS'),
        p('Page'),
        p('Compiler’s Preface - - - - - - - - - - - 6'),
        p('Introduction - - - - - - - - - - - - 8'),
        h('SECTION I', 2),
        h('THE OCCULT WORLD SERIES', 2),
        p('Letter No. I.—London newspaper Test; 1. Solomons of Science; 2.')
      ],
      'table-of-contents',
      'vii'
    ),
    leaf(3, [h('LETTER No. I'), p(run('alpha', 300))], 'body', '1'),
    leaf(4, [p(run('beta', 300))], 'body', '2')
  ])
  const book = layoutWithToc(doc, defaultStyleProfile(), measurer, options)

  it('is listed once, as the body’s chapter', () => {
    const text = contentsText(book)
    expect(text.match(/COMPILER’S PREFACE/gu) ?? []).toHaveLength(1)
    expect(text.match(/INTRODUCTION/gu) ?? []).toHaveLength(1)
    expect(text).not.toMatch(/Preface -|Introduction -/u)
  })
})

/**
 * Forty letters, each closing ten groups on a page, and an introduction of the
 * editor's own after the contents. Pass one is measured with no numbers, so
 * the descriptions are shorter than the ones printed and the contents is
 * shorter too — which moves the introduction's roman folio, which the contents
 * prints. The old guard compared the page counts and would have thrown the
 * numbered contents away.
 */
describe('a contents whose numbers change its length', () => {
  const body: PageTranscription[] = []
  const contents: TranscribedBlock[] = [h('CONTENTS')]
  let folio = 1
  for (let n = 1; n <= 40; n++) {
    const groups = Array.from({ length: 10 }, (_, g) => `Topic ${n}.${g}—more of it; ${folio + g}.`)
    contents.push(p(`Letter No. ${n}.—${groups.join(' ')}`))
    for (let g = 0; g < 10; g++, folio++) {
      const leafIndex = folio + 4
      body.push(
        leaf(
          leafIndex,
          g === 0
            ? [h(`LETTER No. ${n}`), p(`${run(`l${n}g${g}w`, 60)}.`)]
            : [p(`${run(`l${n}g${g}w`, 60)}.`)],
          'body',
          String(folio)
        )
      )
    }
  }
  const assembled = assembleBook([
    leaf(0, contents.slice(0, 15), 'table-of-contents', 'v'),
    leaf(1, contents.slice(15, 30), 'table-of-contents', 'vi'),
    leaf(2, contents.slice(30), 'table-of-contents', 'vii'),
    ...body
  ])
  const intro: BookEdit = {
    kind: 'section',
    sectionId: 'intro',
    placement: 'front',
    title: 'Introduction',
    text: Array.from({ length: 6 }, (_, i) => run(`introduction${i}w`, 80)).join('\n\n')
  }
  const doc = applyEdits(assembled, [intro])

  // Every pass the contents was laid out in, kept to look at.
  const passes: { toc: LayoutOptions['toc']; book: LaidOutBook }[] = []
  const spy: typeof layout = (d, profile, m, o) => {
    const book = layout(d, profile, m, o)
    passes.push({ toc: o.toc, book })
    return book
  }
  const book = layoutWithToc(doc, defaultStyleProfile(), measurer, options, spy)

  it('changes the contents’ length between the passes', () => {
    // The fixture has to trip the old guard, or it tests nothing.
    expect(passes.length).toBeGreaterThan(2)
    expect(passes[1]!.book.pages.length).not.toBe(passes[0]!.book.pages.length)
  })

  it('does not fall back', () => {
    expect(book.warnings.filter((w) => /without page numbers/u.test(w.text))).toEqual([])
  })

  it('prints exactly the numbers its own layout gives', () => {
    const pages = contentsPages(doc, book)
    const text = contentsText(book)
    for (const chapter of doc.chapters.filter((c) => c.synopsisSource)) {
      const refs = chapter.synopsisSource!.references!
      const printed = refs.map((ref) => pages.printed(ref, chapter.synopsis!))
      expect(printed.every((n) => n !== null)).toBe(true)
      const expected = synopsisWithPages(chapter.synopsis!, refs, printed)
      expect(text).toContain(expected.split(/\s+/u).join(' '))
    }
    // And the editor's introduction at the roman folio it really has.
    const at = book.chapterPages.find((c) => c.id === 'intro-title')!
    expect(text).toContain(`Introduction Page ${book.pages[at.pageIndex]!.folio}`)
  })

  /**
   * An engine that never agrees with itself: every pass after the first puts
   * each chapter a page later than the one before. No number can be right,
   * and the contents must say so rather than print numbers nobody checked.
   */
  it('prints no numbers, and says so, when they never agree with the layout', () => {
    let calls = 0
    const drifting: typeof layout = (d, profile, m, o) => {
      const laid = layout(d, profile, m, o)
      const shift = calls++
      return {
        ...laid,
        chapterPages: laid.chapterPages.map((c) => ({
          ...c,
          pageIndex: Math.min(c.pageIndex + shift, laid.pages.length - 1)
        }))
      }
    }
    const fallen = layoutWithToc(doc, defaultStyleProfile(), measurer, options, drifting)
    expect(fallen.warnings.some((w) => /without page numbers/u.test(w.text))).toBe(true)
    expect(contentsText(fallen)).not.toMatch(/Page \d/u)
    expect(contentsText(fallen)).not.toMatch(/more of it; \d/u)
  })
})

describe('a correction to the original contents', () => {
  const doc = assembleBook(letters())
  const ruled: Ruling[] = [
    {
      pageIndex: 0,
      quote: 'The opening topics re-received; 1.',
      kind: 'printers-error',
      decision: 'corrected',
      correction: 'The opening topics received; 1.',
      decidedOn: '2026-10-05'
    },
    {
      pageIndex: 0,
      quote: 'The zanzibar qeustion raised',
      kind: 'printers-error',
      decision: 'corrected',
      correction: 'The zanzibar question raised',
      decidedOn: '2026-10-05'
    }
  ]

  /** What `drive.mjs sweep --was … --now …` does to the contents. */
  const sweep = (d: BookDocument, edits: BookEdit[], was: string, now: string): BookEdit[] => {
    let out = edits
    for (const synopsis of synopsesOf(d)) {
      if (findMatches(synopsis.text, was).length === 0) continue
      out = withEdit(out, {
        kind: 'synopsis-text',
        synopsisId: synopsis.id,
        text: sweepText(synopsis.text, was, now).text
      })
    }
    return out
  }

  it('is reported until it lands', () => {
    expect(unapplied(ruled, doc)).toEqual(ruled)
  })

  it('lands through a sweep, over the reading as printed', () => {
    let edits: BookEdit[] = []
    edits = sweep(doc, edits, 're-received', 'received')
    edits = sweep(applyEdits(doc, edits), edits, 'qeustion', 'question')
    expect(edits).toEqual([expect.objectContaining({ kind: 'synopsis-text', synopsisId: 'p0b3' })])
    const fixed = applyEdits(doc, edits)
    const one = fixed.chapters.find((c) => c.title === 'LETTER No. I')!
    expect(one.synopsis).toBe(
      'The opening topics received; 1. The zanzibar question raised—its consequences; 3. ' +
        'Remarks; 4.'
    )
    // The pristine reading is untouched: the page still says what it said.
    expect(doc.chapters.find((c) => c.title === 'LETTER No. I')!.synopsis).toContain('re-received')
    expect(unapplied(ruled, fixed)).toEqual([])
  })

  /**
   * Taking three letters out before the first reference moves every
   * reference's characters; they are read again from the corrected text, so
   * each still names its digits and its page.
   */
  /**
   * A ruling is about its leaf. The same words printed somewhere else are not
   * the fault it settled, and asked of the whole book they read as the fault
   * left standing — the check has to know what the contents leaf prints.
   */
  it('asks the contents leaf what it prints, not the whole book', () => {
    const elsewhere = letters()
    elsewhere[6] = leaf(
      6,
      [p('Delta: the zanzibar qeustion raised again, as printed.')],
      'body',
      '4'
    )
    const both = assembleBook(elsewhere)
    const fixed = applyEdits(both, sweep(both, [], 'qeustion', 'question'))
    expect(fixed.blocks.some((b) => b.text.includes('zanzibar qeustion raised'))).toBe(true)
    expect(unapplied([ruled[1]!], fixed)).toEqual([])
  })

  it('reads the references again from the corrected text', () => {
    const fixed = applyEdits(doc, sweep(doc, [], 're-received', 'received'))
    const one = fixed.chapters.find((c) => c.title === 'LETTER No. I')!
    const refs = one.synopsisSource!.references!
    expect(refs.map((r) => one.synopsis!.slice(r.start, r.end))).toEqual(['1', '3', '4'])
    expect(refs.map((r) => r.from)).toEqual([1, 3, 4])
    const book = layoutWithToc(fixed, defaultStyleProfile(), measurer, options)
    expect(contentsText(book)).toContain(
      `raised—its consequences; ${pageWith(book, 'zanzibar').folio}.`
    )
  })

  it('removes a description it empties', () => {
    const emptied = applyEdits(doc, [{ kind: 'synopsis-text', synopsisId: 'p0b3', text: '' }])
    expect(emptied.chapters.find((c) => c.title === 'LETTER No. I')!.synopsis).toBeUndefined()
  })

  it('leaves a book with none of these edits exactly as it was', () => {
    const memo: BookEdit = { kind: 'memo', memoId: 'm', blockId: 'p3b1', at: 0, text: 'look' }
    expect(applyEdits(doc, [memo]).chapters).toEqual(applyEdits(doc, []).chapters)
    expect(applyEdits(doc, [memo]).synopsesUnmatched).toBe(doc.synopsesUnmatched)
  })

  it('is kept when the run is stored and read back', () => {
    const edit: BookEdit = { kind: 'synopsis-text', synopsisId: 'p0b3', text: 'Fixed; 1.' }
    const restored = migrateSavedRun({
      schemaVersion: 21,
      transcriptions: letters(),
      edits: [edit]
    })
    expect(restored.edits).toEqual([edit])
  })
})
