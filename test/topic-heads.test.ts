import { describe, expect, it } from 'vitest'
import { deriveChapters, type BookBlock, type BookDocument } from '@core/assemble'
import {
  NO_TOPICS,
  fixedWidthMeasurer,
  layout,
  runningHeadBaseline,
  topicHead,
  topicsAfterHeading,
  topicsOnNewPage,
  type LaidOutBook
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import type { RunningHeadMode, StyleProfile } from '@core/model'

/**
 * Topic running heads: the subheading in force on a page. Made-up text only.
 * Measured with the fixed-width measurer, so every page break is arithmetic;
 * which page a heading falls on is read off the layout's own `blockPages`.
 */

const words = (n: number, word = 'lamp'): string =>
  Array.from({ length: n }, (_, i) => (i % 9 === 0 ? 'Keeper' : word)).join(' ') + '.'

let counter = 0
function block(kind: BookBlock['kind'], text: string, level?: number): BookBlock {
  counter++
  return {
    id: `p${counter}b0`,
    kind,
    text,
    sourcePages: [counter],
    ...(level !== undefined ? { level } : {})
  }
}

function docOf(blocks: BookBlock[]): BookDocument {
  return {
    blocks,
    footnotes: [],
    // As assembly derives them: a run of headings is one chapter.
    chapters: deriveChapters(blocks),
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  }
}

const profileWith = (verso: RunningHeadMode, recto: RunningHeadMode): StyleProfile => ({
  ...defaultStyleProfile(),
  runningHeads: { verso, recto },
  runningHeadStyle: 'plain',
  chaptersOpenRecto: false,
  pageNumber: 'bottomCenter'
})

const edition = { title: 'A Made-Up Book', author: 'A. N. Author', editionDate: '2026' }

function laid(doc: BookDocument, profile: StyleProfile): LaidOutBook {
  return layout(doc, profile, fixedWidthMeasurer(0.5), { edition })
}

/** The running head drawn on each page, by index; null where none is drawn. */
function heads(book: LaidOutBook, profile: StyleProfile): (string | null)[] {
  const y = runningHeadBaseline(profile)
  return book.pages.map((page) => {
    const line = page.items.find((i) => i.kind === 'line' && i.baselinePt === y)
    return line && line.kind === 'line' ? line.runs.map((r) => r.text).join('') : null
  })
}

/** A book of three chapters, each divided its own way. */
function threeChapters() {
  const b = {
    number1: block('heading', 'CHAPTER I.', 1),
    title1: block('heading', 'The First Chapter', 1),
    intro1: block('paragraph', words(900)),
    topicA: block('heading', 'Of the Lamp', 2),
    textA: block('paragraph', words(700)),
    side: block('heading', 'A Side Head.', 3),
    textSide: block('paragraph', words(500)),
    topicB: block('heading', 'Of the Stair', 2),
    textB: block('paragraph', words(20)),
    topicC: block('heading', 'Of the Bell', 2),
    textC: block('paragraph', words(900)),
    title2: block('heading', 'The Second Chapter', 1),
    byline: block('heading', 'By the Keeper', 2),
    intro2: block('paragraph', words(900)),
    topicD: block('heading', 'Of the Water', 2),
    textD: block('paragraph', words(600)),
    title3: block('heading', 'The Third Chapter', 1),
    intro3: block('paragraph', words(300)),
    sideE: block('heading', 'Stone.', 3),
    textE: block('paragraph', words(700)),
    sideF: block('heading', 'Oak.', 3),
    textF: block('paragraph', words(700))
  }
  return { b, doc: docOf(Object.values(b)) }
}

function pageOf(book: LaidOutBook, b: BookBlock): number {
  const found = book.blockPages.find((p) => p.blockId === b.id)
  expect(found, `${b.text} was laid out`).toBeDefined()
  return found!.pageIndex
}

describe('the topic a page shows', () => {
  const { b, doc } = threeChapters()
  const profile = profileWith('topic', 'topic')
  const book = laid(doc, profile)
  const head = heads(book, profile)
  const at = (block: BookBlock) => pageOf(book, block)

  it('shows the chapter title before the chapter’s first topic', () => {
    const opening = at(b.title1)
    expect(head[opening], 'a chapter opening carries no head').toBeNull()
    expect(at(b.topicA)).toBeGreaterThan(opening + 1)
    for (let p = opening + 1; p < at(b.topicA); p++) expect(head[p]).toBe('The First Chapter')
  })

  it('shows the first topic that starts on the page, else the one in force', () => {
    expect(head[at(b.topicA)]).toBe('Of the Lamp')
    // Pages with no topic of their own carry the one in force; a side head
    // under a level-2 topic is not a topic.
    expect(at(b.side)).toBeGreaterThan(at(b.topicA))
    for (let p = at(b.topicA) + 1; p < at(b.topicB); p++) expect(head[p]).toBe('Of the Lamp')
    // Two topics start on one page: the head names the first.
    expect(at(b.topicC)).toBe(at(b.topicB))
    expect(head[at(b.topicB)]).toBe('Of the Stair')
    // The next page carries the last one in force.
    expect(head[at(b.topicB) + 1]).toBe('Of the Bell')
  })

  it('resets at each chapter, and a heading before any text is not a topic', () => {
    const opening = at(b.title2)
    expect(at(b.topicD)).toBeGreaterThan(opening + 1)
    for (let p = opening + 1; p < at(b.topicD); p++) expect(head[p]).toBe('The Second Chapter')
    expect(head[at(b.topicD)]).toBe('Of the Water')
  })

  it('takes side heads as topics in a chapter they alone divide', () => {
    expect(head[at(b.sideE)]).toBe('Stone.')
    expect(head[at(b.sideF)]).toBe('Oak.')
    expect(head[at(b.sideF) - 1]).toBe('Stone.')
  })

  it('puts the chapter on the left and the topic on the right', () => {
    const split = profileWith('chapterTitle', 'topic')
    const splitHeads = heads(laid(doc, split), split)
    const lamp = at(b.topicA)
    for (let p = lamp; p < at(b.topicB); p++) {
      expect(splitHeads[p], `page ${p + 1}`).toBe(
        book.pages[p]!.side === 'verso' ? 'The First Chapter' : 'Of the Lamp'
      )
    }
  })
})

describe('the rule, step by step', () => {
  it('carries the last topic to the next page and clears at a chapter', () => {
    let page = topicsAfterHeading(NO_TOPICS, { title: 'One', level: 2, isTopic: true })
    page = topicsAfterHeading(page, { title: 'Two', level: 2, isTopic: true })
    page = topicsAfterHeading(page, { title: 'Aside', level: 3, isTopic: false })
    expect(topicHead(page, 'Chapter')).toBe('One')
    const next = topicsOnNewPage(page)
    expect(topicHead(next, 'Chapter')).toBe('Two')
    const chapter = topicsAfterHeading(next, { title: 'Chapter Two', level: 1, isTopic: false })
    expect(topicHead(chapter, 'Chapter Two')).toBe('Chapter Two')
    expect(topicHead(topicsOnNewPage(undefined), 'Chapter')).toBe('Chapter')
  })
})

describe('a topic too long for the page', () => {
  const long =
    'Of the Lamp that Burned Through the Long Night in the Keeper’s House Above the Stair and the Water'
  const blocks = [
    block('heading', 'The Long Chapter', 1),
    block('paragraph', words(300)),
    block('heading', long, 2),
    block('paragraph', words(1500))
  ]
  const doc = docOf(blocks)

  it('is shortened at a word, never into the margin, and reported once with its pages', () => {
    const profile = profileWith('chapterTitle', 'topic')
    const book = laid(doc, profile)
    const shortened = book.headsShortened ?? []
    expect(shortened).toHaveLength(1)
    const [entry] = shortened
    expect(entry!.text).toBe(long)
    expect(entry!.setAs.endsWith('…')).toBe(true)
    // Cut at a word: what is kept is the head's own words, whole.
    expect(long.startsWith(entry!.setAs.slice(0, -1))).toBe(true)
    expect(long[entry!.setAs.length - 1]).toBe(' ')
    // On every right-hand page from the topic on, and only those.
    const drawn = heads(book, profile)
    const rectos = entry!.pageIndexes
    expect(rectos.length).toBeGreaterThan(1)
    for (const p of rectos) expect(drawn[p]).toBe(entry!.setAs)
    const frame = book.pages[rectos[0]!]!.frame
    const line = book.pages[rectos[0]!]!.items.find(
      (i) => i.kind === 'line' && i.baselinePt === runningHeadBaseline(profile)
    )
    const run = line?.kind === 'line' ? line.runs[0] : undefined
    expect(run!.xPt).toBeGreaterThanOrEqual(frame.xPt)
    expect(
      run!.xPt + fixedWidthMeasurer(0.5).widthOf(run!.text, run!.font, run!.sizePt)
    ).toBeLessThanOrEqual(frame.xPt + frame.widthPt + 1e-6)
    // And said in the warnings, so the owner can give it a short form.
    const warning = book.warnings.find((w) => w.text.includes(long))
    expect(warning?.pageIndex).toBe(rectos[0])
    expect(warning?.text).toMatch(/short form/u)
  })

  it('a head that fits is not reported', () => {
    const fits = docOf([
      block('heading', 'The Short Chapter', 1),
      block('paragraph', words(300)),
      block('heading', 'Of the Lamp', 2),
      block('paragraph', words(1500))
    ])
    const book = laid(fits, profileWith('chapterTitle', 'topic'))
    expect(book.headsShortened).toEqual([])
    expect(book.warnings).toEqual([])
  })

  it('a book with no topic head reports nothing new, even with a long chapter title', () => {
    const titled = docOf([block('heading', long, 1), block('paragraph', words(1500))])
    const book = laid(titled, profileWith('author', 'chapterTitle'))
    expect('headsShortened' in book).toBe(false)
    expect(book.warnings).toEqual([])
  })
})
