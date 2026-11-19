import { describe, expect, it } from 'vitest'
import {
  DESCRIPTIVE_SHARE,
  chapterDivisions,
  divisionCounts,
  isDescriptive,
  looksLikeTopicList,
  opensWithTopicLists,
  topicHeadingIds,
  type BookBlock
} from '@core/assemble'

/**
 * How a book divides its chapters, which decides its running heads. Made-up
 * text only, in the shapes real books take.
 */

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
  block(
    'paragraph',
    'The keeper climbed the stair at evening and lit the lamp, and the light went out over the water to the ships that waited there.'
  )

/** A chapter divided by `subheads` level-2 headings in its text. */
function divided(title: string, subheads: number): BookBlock[] {
  const out = [block('heading', title, 1), prose()]
  for (let i = 0; i < subheads; i++) out.push(block('heading', `Topic ${i + 1}`, 2), prose())
  return out
}

describe('what divides a chapter', () => {
  it('a subheading after some of the chapter’s text is a topic; one before any text is not', () => {
    const blocks = [
      block('heading', 'The Lamp', 1),
      block('heading', 'By the Keeper', 2),
      prose(),
      block('heading', 'Of the Oil', 2),
      prose(),
      block('heading', 'A Side Head.', 3),
      prose()
    ]
    const [chapter] = chapterDivisions(blocks)
    expect(chapter!.topicLevel).toBe(2)
    expect(chapter!.topics.map((t) => t.title)).toEqual(['Of the Oil'])
    expect(topicHeadingIds(blocks)).toEqual(new Set([blocks[3]!.id]))
  })

  it('side heads are the topics of a chapter only they divide', () => {
    const blocks = [
      block('heading', 'The Stair', 1),
      prose(),
      block('heading', 'Stone.', 3),
      prose(),
      block('heading', 'Oak.', 3),
      prose()
    ]
    const [chapter] = chapterDivisions(blocks)
    expect(chapter!.topicLevel).toBe(3)
    expect(chapter!.topics.map((t) => t.title)).toEqual(['Stone.', 'Oak.'])
  })

  it('a topic opened by a number line is one topic, every block of it known', () => {
    const blocks = [
      block('heading', 'The House', 1),
      prose(),
      block('heading', 'SECTION II.', 2),
      block('heading', 'Of the Door', 2),
      prose()
    ]
    expect(chapterDivisions(blocks)[0]!.topics.map((t) => t.title)).toEqual(['Of the Door'])
    expect(topicHeadingIds(blocks)).toEqual(new Set([blocks[2]!.id, blocks[3]!.id]))
  })

  /**
   * The owner's ruling: a chapter that opens straight into its first section
   * shows that section from its first page, as a chapter of letters opening
   * on "Letter No. 1" does.
   */
  it('a heading before any text that opens the first section, like the rest, is a topic', () => {
    const letters = [
      block('heading', 'The Letters', 1),
      block('heading', 'Letter No. 1', 2),
      prose(),
      block('heading', 'Letter No. 2', 2),
      prose(),
      block('heading', 'Letter No. 3', 2),
      prose()
    ]
    const [chapter] = chapterDivisions(letters)
    expect(chapter!.topics.map((t) => t.title)).toEqual([
      'Letter No. 1',
      'Letter No. 2',
      'Letter No. 3'
    ])
    expect(topicHeadingIds(letters).has(letters[1]!.id)).toBe(true)
    const numbered = [
      block('heading', 'The Stanzas', 1),
      block('heading', 'I.', 2),
      prose(),
      block('heading', 'II.', 2),
      prose()
    ]
    expect(chapterDivisions(numbered)[0]!.topics.map((t) => t.title)).toEqual(['I.', 'II.'])
    const parts = [
      block('heading', 'The Keeper', 1),
      block('heading', 'Part One.', 2),
      prose(),
      block('heading', 'Part Two.', 2),
      prose()
    ]
    expect(chapterDivisions(parts)[0]!.topics.map((t) => t.title)).toEqual([
      'Part One.',
      'Part Two.'
    ])
  })

  it('a byline, a title repeated in capitals or a lone part line before the text is never a topic', () => {
    const bylined = [
      block('heading', 'The Lamp', 1),
      block('heading', 'THE LAMP AND THE KEEPER.', 2),
      block('heading', 'By A. N. Author.', 2),
      prose(),
      block('heading', 'Of the Oil', 2),
      prose(),
      block('heading', 'Of the Wick', 2),
      prose()
    ]
    expect(chapterDivisions(bylined)[0]!.topics.map((t) => t.title)).toEqual([
      'Of the Oil',
      'Of the Wick'
    ])
    const partLine = [
      block('heading', 'The Stair', 1),
      block('heading', 'Part One.', 2),
      prose(),
      block('heading', 'The Oil', 2),
      prose()
    ]
    expect(chapterDivisions(partLine)[0]!.topics.map((t) => t.title)).toEqual(['The Oil'])
    // Alike, but not at the level the chapter is divided at.
    const deeper = [
      block('heading', 'The Bell', 1),
      block('heading', 'Of Bells', 2),
      prose(),
      block('heading', 'Of Ropes', 3),
      prose()
    ]
    expect(chapterDivisions(deeper)[0]!.topics.map((t) => t.title)).toEqual(['Of Ropes'])
    // Nothing divides the text: an opening heading alone does not make it divided.
    const undivided = [block('heading', 'The Door', 1), block('heading', 'Of the Door', 2), prose()]
    expect(chapterDivisions(undivided)[0]!.topics).toEqual([])
    expect(divisionCounts(chapterDivisions(undivided)).divided).toBe(0)
  })

  it('a part title with no text of its own is not counted', () => {
    const blocks = [block('heading', 'PART ONE', 1), ...divided('The Lamp', 2)]
    const counts = divisionCounts(chapterDivisions(blocks))
    expect(counts).toEqual({ counted: 1, divided: 1, listed: 0 })
  })
})

describe('a book is descriptive when at least half its chapters are divided', () => {
  const book = (dividedChapters: number, plainChapters: number): BookBlock[] => [
    ...Array.from({ length: dividedChapters }, (_, i) => divided(`Divided ${i}`, 2)).flat(),
    ...Array.from({ length: plainChapters }, (_, i) => divided(`Plain ${i}`, 0)).flat()
  ]
  const counts = (d: number, p: number) => divisionCounts(chapterDivisions(book(d, p)))

  it('is half, the owner’s rule', () => {
    expect(DESCRIPTIVE_SHARE).toBe(0.5)
  })

  it('at exactly half it is; one chapter under half it is not', () => {
    expect(counts(2, 2)).toEqual({ counted: 4, divided: 2, listed: 0 })
    expect(isDescriptive(counts(2, 2))).toBe(true)
    expect(isDescriptive(counts(2, 3))).toBe(false)
    expect(isDescriptive(counts(3, 3))).toBe(true)
    expect(isDescriptive(counts(1, 0))).toBe(true)
  })

  it('takes the share as a parameter', () => {
    expect(isDescriptive(counts(2, 2), 0.75)).toBe(false)
    expect(isDescriptive(counts(3, 1), 0.75)).toBe(true)
  })

  /**
   * A share multiplied out can land just above the count it equals: 0.56 × 25
   * is 14.000000000000002 in floating point, so 14 chapters of 25 fell short
   * of a 56% rule, and 7 of 25 of a 28% one.
   */
  it('meets a share exactly at its boundary, whatever the share', () => {
    const of = (divided: number, counted: number) => ({ counted, divided, listed: 0 })
    expect(isDescriptive(of(14, 25), 0.56)).toBe(true)
    expect(isDescriptive(of(13, 25), 0.56)).toBe(false)
    expect(isDescriptive(of(7, 25), 0.28)).toBe(true)
    expect(isDescriptive(of(7, 10), 0.7)).toBe(true)
    expect(isDescriptive(of(6, 10), 0.7)).toBe(false)
    const listed = (n: number, counted: number) => ({ counted, divided: 0, listed: n })
    expect(opensWithTopicLists(listed(14, 25), 0.56)).toBe(true)
    expect(opensWithTopicLists(listed(13, 25), 0.56)).toBe(false)
  })

  it('a book with no chapter of text is not descriptive', () => {
    expect(isDescriptive({ counted: 0, divided: 0, listed: 0 })).toBe(false)
  })
})

describe('a list of topics under the chapter title', () => {
  const lists = [
    'The Sacred Fire—The Vestal Virgins—The Altar of the Persians—Fire as a Symbol.',
    'The Lamp of the House – The Keeper and the Stair – Water Under Stone – The Bells at Evening.',
    'Origin of the Mysteries. The Rites of the Temple. Initiation at the Gate. The Return of the Light.',
    'Stone - Water - Lamps and Oil - The Long Night.',
    'Introductory—Of the Seven Principles of Man and their Places in Nature—The Lamp—The Stair—Conclusion.'
  ]
  const notLists = [
    // Ordinary prose, however it uses dashes.
    'The keeper climbed the stair—slowly, for he was old—and lit the lamp, and the light went out over the water to the ships that waited for it.',
    'The keeper climbed the stair at evening. He lit the lamp in the high window above the harbour where the boats lay. The light went out over the water.',
    // Dialogue and questions.
    'QUESTION. What is the lamp? ANSWER. It is the light. QUESTION. Who lit it? ANSWER. The keeper.',
    // A motto.
    '“The lamp—the stair—the water—the bell.” —An Old Keeper',
    // A byline, a publication line, a scale.
    'By A. N. AUTHOR.',
    '[Vol. I. No. 4, March, 1880.]',
    'Do—Re—Mi—Fa—So—La—Ti—Do.',
    // A sentence split by a dash only once or twice.
    'Three things—the lamp and the stair—were his.',
    // A glossary entry.
    'Lampas (Lat.). A lamp; a light. Also a torch carried before the keeper at night.'
  ]

  it('is recognised in its usual shapes', () => {
    for (const text of lists) expect(looksLikeTopicList(text), text).toBe(true)
  })

  it('is not mistaken in prose, dialogue, mottoes, bylines, scales or glossary entries', () => {
    for (const text of notLists) expect(looksLikeTopicList(text), text).toBe(false)
  })

  it('a chapter opening with one, after a motto or not, with no subheadings, is counted', () => {
    const list = lists[0]!
    const blocks = [
      block('heading', 'CHAPTER I.', 1),
      block('heading', 'The Fire', 1),
      block('paragraph', list),
      prose(),
      block('heading', 'The Water', 1),
      block('epigraph', '“Water under stone.”'),
      block('paragraph', list),
      prose(),
      block('heading', 'The Stone', 1),
      prose(),
      block('paragraph', list)
    ]
    const divisions = chapterDivisions(blocks)
    expect(divisions.map((d) => d.opensWithTopicList)).toEqual([true, true, false])
    expect(divisionCounts(divisions)).toEqual({ counted: 3, divided: 0, listed: 2 })
  })

  /**
   * Only a paragraph is a list of topics. A motto set as verse, a quotation of
   * four short sentences and a column of maxims each have the shape of one,
   * and each raised the owner's question about a book that has no lists.
   */
  it('a motto in verse, a quotation of short sentences or maxims is not a list of topics', () => {
    const shaped = [
      ['verse', 'Over the Water—Under the Stone—Into the Night—Out of the Day.'],
      ['blockquote', 'Keep the lamp. Climb the stair. Ring the bell. Watch the water.'],
      ['list-item', 'Know the Keeper. Mind the Stair. Trim the Wick. Bar the Door.']
    ] as const
    for (const [kind, text] of shaped) {
      // The shape alone would pass: only the kind of block tells them apart.
      expect(looksLikeTopicList(text), text).toBe(true)
      const first = [block('heading', 'The Lamp', 1), block(kind, text), prose()]
      const afterMotto = [
        block('heading', 'The Stair', 1),
        block('epigraph', '“Water under stone.”'),
        block(kind, text),
        prose()
      ]
      for (const blocks of [first, afterMotto]) {
        expect(chapterDivisions(blocks)[0]!.opensWithTopicList, `${kind} opening`).toBe(false)
      }
    }
  })

  it('a chapter with a list and subheadings is divided, not listed', () => {
    const blocks = [block('heading', 'The Fire', 1), block('paragraph', lists[0]!), prose()]
    blocks.push(block('heading', 'The Altar', 2), prose())
    expect(divisionCounts(chapterDivisions(blocks))).toEqual({ counted: 1, divided: 1, listed: 0 })
  })

  it('a book with lists in at least half its chapters is a question, unless it is descriptive', () => {
    expect(opensWithTopicLists({ counted: 4, divided: 0, listed: 2 })).toBe(true)
    expect(opensWithTopicLists({ counted: 5, divided: 0, listed: 2 })).toBe(false)
    expect(opensWithTopicLists({ counted: 4, divided: 2, listed: 2 })).toBe(false)
    expect(opensWithTopicLists({ counted: 0, divided: 0, listed: 0 })).toBe(false)
  })
})
