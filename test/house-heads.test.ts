import { describe, expect, it, vi } from 'vitest'
import { deriveChapters, type BookBlock, type BookDocument } from '@core/assemble'
import {
  DEFAULT_TOPIC_HEADS,
  houseHeadsFor,
  houseHeadsForBook,
  houseLookLine,
  houseSettingsLost,
  parseHouseLook,
  styleQuestions,
  defaultStyleProfile,
  type HouseLook
} from '@core/style'
import { appliedLook, initialState, stepById } from '@core/wizard'
import type { Answers } from '@core/wizard/questions'
import type { StyleProfile } from '@core/model'

/**
 * The house look chooses a new book's running heads by its structure: chapter
 * and topic for a descriptive book, the house look's author and chapter for
 * any other, and a question for the owner when the chapters only open with
 * lists of topics. A book's own design answers always win. Made-up books only.
 */

// The layout itself is the engine's (tested in topic-heads.test.ts); here only
// which profile each book is laid out in matters, so the interior is a stub
// that remembers the profile it was handed.
vi.mock('@platform/browser/interior', () => ({
  renderInterior: async (_doc: BookDocument, profile: StyleProfile) => ({
    pageCount: 180,
    profile
  })
}))
const { renderInLook } = await import('@platform/browser/house-look')

const HOUSE: Answers = {
  kind: 'nonfiction',
  period: 'victorian',
  chapterOpener: 'ornamented',
  runningHeads: 'chapter',
  font: 'libre-caslon',
  runningHeadVerso: 'author',
  trimSize: '7x10'
}
const houseFile = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 1, name: 'A made-up house look', design: HOUSE, ...extra })
function look(text = houseFile()): HouseLook {
  const parsed = parseHouseLook(text)
  if (!('look' in parsed)) throw new Error(parsed.error)
  return parsed.look
}
const styleOf = (design: Answers): StyleProfile =>
  appliedLook({ ...initialState(), styleProfiles: [] }, design).style

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
const prose = (): BookBlock =>
  block('paragraph', 'The keeper lit the lamp at evening and watched the water.')
const LIST = 'The Lamp—The Stair—The Water Under Stone—The Bells at Evening.'

function bookOf(chapters: ('divided' | 'plain' | 'listed')[]): BookDocument {
  const blocks: BookBlock[] = []
  chapters.forEach((shape, i) => {
    blocks.push(block('heading', `Chapter ${i + 1}`, 1))
    if (shape === 'listed') blocks.push(block('paragraph', LIST))
    blocks.push(prose())
    if (shape === 'divided') blocks.push(block('heading', 'Of the Lamp', 2), prose())
  })
  return {
    blocks,
    footnotes: [],
    chapters: deriveChapters(blocks),
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  }
}

describe('the house look’s topic-heads rule', () => {
  it('is the owner’s when the file names none: half the chapters, chapter left and topic right', () => {
    expect(look().topicHeads).toEqual(DEFAULT_TOPIC_HEADS)
    expect(DEFAULT_TOPIC_HEADS).toEqual({
      atLeast: 0.5,
      design: { runningHeadVerso: 'chapterTitle', runningHeadRecto: 'topic' }
    })
  })

  it('may be turned off, or given its own share, and a bad one is refused', () => {
    expect(look(houseFile({ topicHeads: null })).topicHeads).toBeNull()
    expect(look(houseFile({ topicHeads: { atLeast: 0.75 } })).topicHeads).toEqual({
      ...DEFAULT_TOPIC_HEADS,
      atLeast: 0.75
    })
    for (const atLeast of [0, 1.5, 'half']) {
      expect(parseHouseLook(houseFile({ topicHeads: { atLeast } }))).toMatchObject({
        error: expect.stringMatching(/atLeast/u)
      })
    }
    expect(
      parseHouseLook(houseFile({ topicHeads: { design: { runningHeadSide: 'topic' } } }))
    ).toMatchObject({ error: expect.stringMatching(/runningHeadSide/u) })
  })

  /**
   * Read strictly, as the rest of the file is: each of these used to be read
   * as the owner's rule, or as heads nobody chose, without a word.
   */
  it('refuses a key it does not have, a rule that says nothing, and a head no question offers', () => {
    const refusal = (topicHeads: unknown): string => {
      const parsed = parseHouseLook(houseFile({ topicHeads }))
      expect('error' in parsed, JSON.stringify(topicHeads)).toBe(true)
      return 'error' in parsed ? parsed.error : ''
    }
    expect(refusal({ atLeast: 0.5, share: 0.6 })).toMatch(/names share, which a topic-heads rule/u)
    expect(refusal({ atleast: 0.5 })).toMatch(/atleast/u)
    expect(refusal({})).toMatch(/says nothing/u)
    expect(refusal({ design: {} })).toMatch(/sets nothing/u)
    // The topic is offered for the right page only.
    expect(refusal({ design: { runningHeadVerso: 'topic' } })).toMatch(
      /`runningHeadVerso` cannot be "topic": the topic is offered for the right page only/u
    )
    expect(refusal({ design: { runningHeadRecto: 'chapter' } })).toMatch(
      /`runningHeadRecto` cannot be "chapter"; it offers .*chapterTitle/u
    )
    expect(refusal({ design: { runningHeadTidy: 'yes' } })).toMatch(/yes or no/u)
    // What the owner's rule says, written out, is still read.
    expect(look(houseFile({ topicHeads: DEFAULT_TOPIC_HEADS })).topicHeads).toEqual(
      DEFAULT_TOPIC_HEADS
    )
  })
})

describe('a book that inherits the house look keeps it whole', () => {
  /**
   * `drive.mjs answers` merges key by key. Two head answers written into a
   * book with no design of its own became its whole design: it stopped
   * inheriting, was laid out in the engine's defaults, and `proof` still said
   * "the book file".
   */
  const house = look()

  it('names every house setting a partial design would lose', () => {
    const heads: Answers = { runningHeadVerso: 'chapterTitle', runningHeadRecto: 'topic' }
    const lost = houseSettingsLost(undefined, heads, house)
    expect(lost).toEqual(Object.keys(house.design).filter((id) => !(id in heads)))
    expect(lost).toContain('font')
    expect(lost).toContain('trimSize')
    // Only a banked look's name and the name to bank under is still no design.
    expect(houseSettingsLost({ profile: 'fresh' }, { ...heads, profile: 'fresh' }, house)).toEqual(
      lost
    )
  })

  it('loses nothing when the inherited answers are written, or the book has a design of its own', () => {
    const inherited: Answers = { ...house.design, runningHeadRecto: 'topic' }
    expect(houseSettingsLost(undefined, inherited, house)).toEqual([])
    expect(houseSettingsLost(HOUSE, { ...HOUSE, runningHeadRecto: 'topic' }, house)).toEqual([])
    expect(houseSettingsLost({}, {}, house)).toEqual([])
    expect(houseSettingsLost(undefined, { runningHeadRecto: 'topic' }, null)).toEqual([])
  })
})

describe('the heads a book inheriting the house look gets', () => {
  it('a descriptive book: the chapter title on the left, the topic on the right', () => {
    const heads = houseHeadsForBook(look(), bookOf(['divided', 'divided', 'plain', 'plain']).blocks)
    expect(heads.verdict).toBe('topic')
    expect(heads.question).toBeNull()
    expect(heads.line).toBe(
      'chapter and topic running heads (2 of 4 chapters divided by subheadings)'
    )
    expect(styleOf({ ...HOUSE, ...heads.design }).runningHeads).toEqual({
      verso: 'chapterTitle',
      recto: 'topic'
    })
  })

  it('any other book: the house look’s own author and chapter', () => {
    const heads = houseHeadsForBook(look(), bookOf(['divided', 'plain', 'plain']).blocks)
    expect(heads.verdict).toBe('house')
    expect(heads.design).toEqual({})
    expect(heads.line).toMatch(/1 of 3 chapters divided by subheadings, under half/u)
    expect(styleOf({ ...HOUSE, ...heads.design }).runningHeads).toEqual({
      verso: 'author',
      recto: 'chapterTitle'
    })
  })

  it('chapters that only open with lists of topics: the house heads, and a question for the owner', () => {
    const heads = houseHeadsForBook(look(), bookOf(['listed', 'listed', 'plain']).blocks)
    expect(heads.verdict).toBe('ask')
    expect(heads.design).toEqual({})
    expect(heads.question).toMatch(/^2 of 3 chapters open with a list of topics/u)
    expect(heads.question).toMatch(/Ask the owner/u)
    expect(heads.question).toMatch(/never guess/u)
  })

  it('a house look with no topic rule gives every book its own heads, and says nothing', () => {
    const heads = houseHeadsFor(look(houseFile({ topicHeads: null })), {
      counted: 4,
      divided: 4,
      listed: 0
    })
    expect(heads).toMatchObject({ verdict: 'house', design: {}, line: '', question: null })
  })

  it('the report line names the heads after the trim', () => {
    const house = look()
    expect(
      houseLookLine({
        look: house,
        path: 'imprint/house-look.json',
        pagesOnHouseTrim: 180,
        short: false,
        heads: 'chapter and topic running heads (2 of 4 chapters divided by subheadings)'
      })
    ).toBe(
      'the house look from the shelf (imprint/house-look.json): 7x10, 180 pages; ' +
        'chapter and topic running heads (2 of 4 chapters divided by subheadings)'
    )
  })
})

describe('laid out through the one door (renderInLook)', () => {
  const profileOf = (design: Answers): StyleProfile => styleOf(design)
  const read = { path: 'imprint/house-look.json', look: look() }
  const options = { edition: { title: 'A Book', author: 'An Author', editionDate: '2026' } }
  const headsOf = (inLook: { profile: StyleProfile }) => inLook.profile.runningHeads

  it('a descriptive book inheriting the house look is laid out with chapter and topic heads', async () => {
    const doc = bookOf(['divided', 'divided', 'plain'])
    const inLook = await renderInLook(doc, { own: null, house: read, profileOf, options })
    expect(inLook.from).toBe('house')
    expect(headsOf(inLook)).toEqual({ verso: 'chapterTitle', recto: 'topic' })
    // Inherited answers carry the heads, so a book that keeps them keeps these.
    expect(inLook.design['runningHeadRecto']).toBe('topic')
    expect(inLook.houseLine).toMatch(/; chapter and topic running heads \(2 of 3/u)
    expect(inLook.headsQuestion).toBeNull()
  })

  it('a book whose chapters open with lists is laid out author and chapter, and the question is handed on', async () => {
    const doc = bookOf(['listed', 'listed', 'listed'])
    const inLook = await renderInLook(doc, { own: null, house: read, profileOf, options })
    expect(headsOf(inLook)).toEqual({ verso: 'author', recto: 'chapterTitle' })
    expect(inLook.headsQuestion).toMatch(/3 of 3 chapters open with a list of topics/u)
  })

  it('a book’s own design answers always win, descriptive or not', async () => {
    const doc = bookOf(['divided', 'divided', 'divided'])
    const own: Answers = { ...HOUSE, runningHeadVerso: 'bookTitle' }
    const inLook = await renderInLook(doc, { own, house: read, profileOf, options })
    expect(inLook.from).toBe('book')
    expect(headsOf(inLook)).toEqual({ verso: 'bookTitle', recto: 'chapterTitle' })
    expect(inLook.headsQuestion).toBeNull()
  })
})

describe('the design questions offer the topic for the right page', () => {
  it('in the detailed controls, in plain words, on the right page only', () => {
    const questions = styleQuestions(defaultStyleProfile())
    const options = (id: string) =>
      (questions.find((q) => q.id === id) as { options: { value: string; label: string }[] })
        .options
    expect(options('runningHeadRecto').find((o) => o.value === 'topic')?.label).toMatch(/topic/iu)
    expect(options('runningHeadVerso').some((o) => o.value === 'topic')).toBe(false)
  })

  it('in the interview, as chapter and topic', () => {
    const questions = stepById('design').questions(initialState())
    const question = questions.find((q) => q.id === 'runningHeads') as
      { options: { value: string; label: string }[] } | undefined
    expect(question?.options.find((o) => o.value === 'chapter-topic')?.label).toBe(
      'Chapter and topic'
    )
    const interview = Object.fromEntries(
      Object.entries(HOUSE).filter(([id]) => id !== 'runningHeadVerso')
    )
    expect(styleOf({ ...interview, runningHeads: 'chapter-topic' }).runningHeads).toEqual({
      verso: 'chapterTitle',
      recto: 'topic'
    })
  })
})
