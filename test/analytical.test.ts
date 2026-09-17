import { describe, it, expect } from 'vitest'
import {
  readAnalyticalContents,
  analyticalLooksSound,
  folioToLeaf,
  type AnalyticalBlock
} from '@core/pages'
import { assembleBook } from '@core/assemble'
import { applyEdits } from '@core/edits'
import { layout, layoutWithToc, fixedWidthMeasurer } from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import { parsePageTranscription } from '@core/transcribe'

/** Leaf 11 of *Isis Unveiled* Vol. I, in the shape a reader lands it in. */
const ISIS_LEAF_11: AnalyticalBlock[] = [
  { kind: 'heading', text: 'TABLE OF CONTENTS.' },
  { kind: 'caption', text: 'PAGE' },
  { kind: 'table', cells: [['PREFACE', 'v']] },
  { kind: 'heading', text: 'BEFORE THE VEIL.' },
  {
    kind: 'table',
    cells: [
      ['Dogmatic assumptions of modern science and theology', 'ix'],
      ['Glossary of terms used in this book', 'xxiii']
    ]
  },
  { kind: 'heading', text: 'Volume First.' },
  { kind: 'heading', text: 'THE “INFALLIBILITY” OF MODERN SCIENCE.' },
  { kind: 'heading', text: 'CHAPTER I.' },
  { kind: 'heading', text: 'OLD THINGS WITH NEW NAMES.' },
  {
    kind: 'table',
    cells: [
      ['The Oriental Kabala', '1'],
      ['Ancient traditions supported by modern research', '3'],
      ['The progress of mankind marked by cycles', '5']
    ]
  },
  { kind: 'heading', text: 'CHAPTER II.' },
  { kind: 'heading', text: 'PHENOMENA AND FORCES.' },
  {
    kind: 'table',
    cells: [
      ['The servility of society', '39'],
      ['Prejudice and bigotry of men of science', '40']
    ]
  }
]

describe('readAnalyticalContents', () => {
  it('reads the topics under each chapter, with the folios as printed', () => {
    const groups = readAnalyticalContents(ISIS_LEAF_11)
    const chapters = groups.filter((g) => g.label)
    // The PREFACE entry stands above every heading on this page, so its group
    // is nameless — and nameless is what it should be, rather than picked up
    // under the contents' own title.
    expect(groups[0]?.label).toBe('')
    expect(groups[0]?.title).toBe('')
    expect(chapters.map((g) => g.label)).toEqual(['CHAPTER I.', 'CHAPTER II.'])
    expect(chapters[0]?.title).toBe('OLD THINGS WITH NEW NAMES.')
    expect(chapters[0]?.topics).toEqual([
      { text: 'The Oriental Kabala', originalFolio: '1' },
      { text: 'Ancient traditions supported by modern research', originalFolio: '3' },
      { text: 'The progress of mankind marked by cycles', originalFolio: '5' }
    ])
  })

  /**
   * `CHAPTER I.` and `OLD THINGS WITH NEW NAMES.` are two heading blocks and
   * one chapter opening, exactly as they are in the body. Treating them as two
   * would close a group with no topics under the number and open a second under
   * the name — so every chapter's topics would be filed under a group whose
   * label is empty, and the match to the body's chapters would go by title
   * alone.
   */
  it('takes a run of headings as one chapter opening', () => {
    const groups = readAnalyticalContents(ISIS_LEAF_11)
    expect(groups.every((g) => g.topics.length > 0)).toBe(true)
    expect(groups.find((g) => g.title === 'BEFORE THE VEIL.')?.topics).toHaveLength(2)
    const first = groups.find((g) => g.label === 'CHAPTER I.')
    expect(first?.title).toBe('OLD THINGS WITH NEW NAMES.')
  })

  /**
   * The contents' own title and its column head sit in the heading stream and
   * are not chapters. Left in, the first entries on the page are filed under a
   * group called `TABLE OF CONTENTS.` and match nothing.
   *
   * The volume division is deliberately *not* on this list. An assertion that
   * no group is named `Volume First.` was written and removed: it passes either
   * way on this page, because the division is followed by the first chapter's
   * own headings and overwritten inside the run. Worse, skipping divisions
   * would be wrong — `deriveChapters` puts one in the body's chapter list, so a
   * contents setting entries directly under one has a chapter to match.
   */
  it('passes over the page title and the column head', () => {
    const titles = readAnalyticalContents(ISIS_LEAF_11).map((g) => `${g.label}${g.title}`)
    expect(titles.some((t) => /TABLE OF CONTENTS/u.test(t))).toBe(false)
    expect(titles.some((t) => /^PAGE$/u.test(t))).toBe(false)
  })

  it('reads a contents that came back as prose rather than as columns', () => {
    const groups = readAnalyticalContents([
      { kind: 'heading', text: 'CHAPTER I.' },
      { kind: 'heading', text: 'OLD THINGS WITH NEW NAMES.' },
      {
        kind: 'paragraph',
        text: 'The Oriental Kabala............ 1\nPriceless value of the Vedas...... 12'
      }
    ])
    expect(groups[0]?.topics).toEqual([
      { text: 'The Oriental Kabala', originalFolio: '1' },
      { text: 'Priceless value of the Vedas', originalFolio: '12' }
    ])
  })

  it('keeps a roman folio as roman', () => {
    const groups = readAnalyticalContents([
      { kind: 'heading', text: 'BEFORE THE VEIL.' },
      { kind: 'table', cells: [['Glossary of terms used in this book', 'xxiii']] }
    ])
    expect(groups[0]?.topics[0]?.originalFolio).toBe('xxiii')
  })
})

describe('analyticalLooksSound', () => {
  it('accepts a contents whose folios run forward', () => {
    expect(analyticalLooksSound(readAnalyticalContents(ISIS_LEAF_11))).toBe(true)
  })

  it('accepts two topics sharing a page', () => {
    const groups = readAnalyticalContents([
      { kind: 'heading', text: 'CHAPTER I.' },
      { kind: 'heading', text: 'ONE.' },
      {
        kind: 'table',
        cells: [
          ['a', '100'],
          ['b', '100'],
          ['c', '101']
        ]
      },
      { kind: 'heading', text: 'CHAPTER II.' },
      { kind: 'heading', text: 'TWO.' },
      {
        kind: 'table',
        cells: [
          ['d', '116'],
          ['e', '116']
        ]
      }
    ])
    expect(analyticalLooksSound(groups)).toBe(true)
  })

  /**
   * A parse whose numbers go backwards means the page was not laid out the way
   * this reader assumes, and a contents that sends a reader backwards is worse
   * than the generated list it would replace.
   */
  it('refuses a parse whose folios descend', () => {
    const groups = readAnalyticalContents([
      { kind: 'heading', text: 'CHAPTER I.' },
      { kind: 'heading', text: 'ONE.' },
      {
        kind: 'table',
        cells: [
          ['a', '100'],
          ['b', '3'],
          ['c', '101'],
          ['d', '102']
        ]
      },
      { kind: 'heading', text: 'CHAPTER II.' },
      { kind: 'heading', text: 'TWO.' },
      { kind: 'table', cells: [['e', '116']] }
    ])
    expect(analyticalLooksSound(groups)).toBe(false)
  })

  it('refuses a parse of one group, which names no book', () => {
    expect(
      analyticalLooksSound(
        readAnalyticalContents([
          { kind: 'heading', text: 'CHAPTER I.' },
          { kind: 'heading', text: 'ONE.' },
          {
            kind: 'table',
            cells: [
              ['a', '1'],
              ['b', '2'],
              ['c', '3'],
              ['d', '4']
            ]
          }
        ])
      )
    ).toBe(false)
  })

  /**
   * The front matter's roman numerals and the body's arabic ones are two
   * sequences printed one after the other. Comparing them says nothing, and a
   * check that did would refuse every book of this period: `xxiii` reads as 23
   * and the body's next entry is 1.
   */
  it('does not compare the roman series against the arabic one', () => {
    const groups = readAnalyticalContents([
      { kind: 'heading', text: 'BEFORE THE VEIL.' },
      {
        kind: 'table',
        cells: [
          ['Dogmatic assumptions', 'ix'],
          ['Glossary of terms', 'xxiii']
        ]
      },
      { kind: 'heading', text: 'CHAPTER I.' },
      { kind: 'heading', text: 'OLD THINGS WITH NEW NAMES.' },
      {
        kind: 'table',
        cells: [
          ['The Oriental Kabala', '1'],
          ['Ancient traditions', '3'],
          ['The progress of mankind', '5'],
          ['Ancient cryptic science', '7']
        ]
      }
    ])
    expect(analyticalLooksSound(groups)).toBe(true)
  })
})

/** One transcribed leaf, parsed the way a landed batch is. */
const leaf = (
  pageIndex: number,
  role: string,
  blocks: unknown[],
  folio?: string
): ReturnType<typeof parsePageTranscription> =>
  parsePageTranscription(
    {
      role,
      blocks,
      uncertain: [],
      furniture: folio ? { folio } : {}
    },
    pageIndex
  )

/**
 * The renumbering, end to end: the original's topics reach the contents with
 * **this** edition's page numbers beside them, and the two-pass scheme survives
 * their being there.
 *
 * Built through `assembleBook` rather than by hand, because the whole mechanism
 * is the chain of lookups it performs — the folio the original printed, to the
 * leaf that printed it, to a block of this document — and a fixture that
 * supplied the block ids would be testing nothing but the renderer.
 */
describe('the analytical contents, renumbered', () => {
  /** A book whose contents leaf names pages the body prints under other numbers. */
  function isisShaped(): ReturnType<typeof assembleBook> {
    return assembleBook([
      leaf(0, 'table-of-contents', [
        { kind: 'heading', text: 'TABLE OF CONTENTS.' },
        { kind: 'heading', text: 'CHAPTER I.' },
        { kind: 'heading', text: 'OLD THINGS WITH NEW NAMES.' },
        {
          kind: 'table',
          cells: [
            ['The Oriental Kabala', '1'],
            ['The progress of mankind marked by cycles', '5'],
            ['Ancient cryptic science', '7']
          ]
        },
        { kind: 'heading', text: 'CHAPTER II.' },
        { kind: 'heading', text: 'PHENOMENA AND FORCES.' },
        { kind: 'table', cells: [['The servility of society', '39']] }
      ]),
      leaf(
        1,
        'chapter-opening',
        [
          { kind: 'heading', text: 'CHAPTER I.' },
          { kind: 'heading', text: 'OLD THINGS WITH NEW NAMES.' },
          { kind: 'paragraph', text: 'The Kabala of the East is older than is supposed.' }
        ],
        '1'
      ),
      leaf(2, 'body', [{ kind: 'paragraph', text: 'Cycles mark the progress of mankind.' }], '5'),
      leaf(3, 'body', [{ kind: 'paragraph', text: 'The cryptic science of the ancients.' }], '7'),
      leaf(
        4,
        'chapter-opening',
        [
          { kind: 'heading', text: 'CHAPTER II.' },
          { kind: 'heading', text: 'PHENOMENA AND FORCES.' },
          { kind: 'paragraph', text: 'Society is servile to its own authorities.' }
        ],
        '39'
      )
    ])
  }

  it('carries every topic to the chapter it belongs to, pointing at a real block', () => {
    const book = isisShaped()
    const first = book.chapters.find((c) => c.title === 'OLD THINGS WITH NEW NAMES.')
    expect(first?.topics?.map((t) => t.text)).toEqual([
      'The Oriental Kabala',
      'The progress of mankind marked by cycles',
      'Ancient cryptic science'
    ])
    // The 1877 folios were 1, 5 and 7; the leaves that printed them are 1, 2
    // and 3, and the blocks named are blocks of *those* leaves. Nothing
    // anywhere converted one pagination into the other.
    expect(first?.topics?.map((t) => t.originalFolio)).toEqual(['1', '5', '7'])
    expect(first?.topics?.[0]?.blockId.startsWith('p1b')).toBe(true)
    expect(first?.topics?.[1]?.blockId.startsWith('p2b')).toBe(true)
    expect(first?.topics?.[2]?.blockId.startsWith('p3b')).toBe(true)
    const ids = new Set(book.blocks.map((b) => b.id))
    for (const topic of first?.topics ?? []) expect(ids.has(topic.blockId)).toBe(true)
  })

  it('leaves out a topic whose folio names no leaf this reading has', () => {
    const book = assembleBook([
      leaf(0, 'table-of-contents', [
        { kind: 'heading', text: 'CHAPTER I.' },
        { kind: 'heading', text: 'ONE.' },
        {
          kind: 'table',
          cells: [
            ['Here', '1'],
            ['Nowhere at all', '3'],
            ['There', '5'],
            ['Elsewhere', '7']
          ]
        },
        { kind: 'heading', text: 'CHAPTER II.' },
        { kind: 'heading', text: 'TWO.' },
        { kind: 'table', cells: [['Later', '9']] }
      ]),
      leaf(
        1,
        'chapter-opening',
        [
          { kind: 'heading', text: 'CHAPTER I.' },
          { kind: 'heading', text: 'ONE.' },
          { kind: 'paragraph', text: 'The first page of the first chapter.' }
        ],
        '1'
      ),
      leaf(2, 'body', [{ kind: 'paragraph', text: 'A page in the middle.' }], '5'),
      leaf(3, 'body', [{ kind: 'paragraph', text: 'Another page in the middle.' }], '7'),
      leaf(
        4,
        'chapter-opening',
        [
          { kind: 'heading', text: 'CHAPTER II.' },
          { kind: 'heading', text: 'TWO.' },
          { kind: 'paragraph', text: 'The second chapter opens here.' }
        ],
        '9'
      )
    ])
    const first = book.chapters.find((c) => c.title === 'ONE.')
    // An entry pointing at a page that does not exist is worse than an entry
    // the reader never sees, because the reader trusts it.
    expect(first?.topics?.map((t) => t.text)).toEqual(['Here', 'There', 'Elsewhere'])
  })
})

/**
 * The folios a book does not print, which are the ones a contents most needs.
 *
 * A chapter opening prints no page number — every book of this kind does that —
 * so the page an analytical contents names most often is the page no leaf
 * claims. Before this, the first topic of all fifteen chapters of *Isis
 * Unveiled* Vol. I was dropped for want of a leaf, and so was the first entry
 * under BEFORE THE VEIL.
 */
describe('folioToLeaf', () => {
  const sightings = [
    { pageIndex: 59, folio: null }, // a chapter opening: prints nothing
    { pageIndex: 60, folio: '2' },
    { pageIndex: 61, folio: '3' },
    { pageIndex: 62, folio: '4' },
    { pageIndex: 63, folio: '5' }
  ]

  it('answers straight from a leaf that printed the folio', () => {
    expect(folioToLeaf(sightings)('3')).toBe(61)
  })

  it('fills a folio no leaf printed, from the offset the others agree on', () => {
    expect(folioToLeaf(sightings)('1')).toBe(59)
  })

  it('refuses when the leaves disagree about the offset', () => {
    // A book that renumbers itself partway through. A majority opinion here
    // would send a reader confidently to the wrong page.
    const renumbered = [
      { pageIndex: 10, folio: '1' },
      { pageIndex: 11, folio: '2' },
      { pageIndex: 12, folio: '3' },
      { pageIndex: 40, folio: '1' },
      { pageIndex: 41, folio: '9' }
    ]
    expect(folioToLeaf(renumbered)('7')).toBe(null)
  })

  it('refuses a fill on too few sightings to call it the book’s numbering', () => {
    expect(folioToLeaf([{ pageIndex: 5, folio: '3' }])('1')).toBe(null)
  })

  it('votes the roman series apart from the arabic one', () => {
    const both = [
      { pageIndex: 17, folio: null }, // the PREFACE opening, printing nothing
      { pageIndex: 18, folio: 'vi' },
      { pageIndex: 19, folio: 'vii' },
      { pageIndex: 20, folio: 'viii' },
      { pageIndex: 59, folio: null },
      { pageIndex: 60, folio: '2' },
      { pageIndex: 61, folio: '3' },
      { pageIndex: 62, folio: '4' }
    ]
    const at = folioToLeaf(both)
    // Roman offset 12, arabic offset 58; neither borrowed from the other.
    expect(at('ix')).toBe(21)
    expect(at('1')).toBe(59)
  })

  it('refuses a leaf beyond the book', () => {
    expect(folioToLeaf(sightings)('900')).toBe(null)
  })
})

/**
 * A correction must not throw the recovered contents away.
 *
 * `applyEdits` re-derives the chapter list from the corrected blocks, and the
 * topics are not derivable from a block — they came off the original contents
 * page and were matched to the body once. Carrying them was forgotten, so the
 * analytical contents of this volume was read, matched to fifteen chapters and
 * dropped again on the first correction, in silence. The synopsis had been lost
 * the same way once before, which is the argument for the test naming the
 * *class* rather than the field.
 */
describe('a correction keeps what came off the original contents', () => {
  it('carries every chapter field the blocks cannot recompute', () => {
    const book = assembleBook([
      leaf(0, 'table-of-contents', [
        { kind: 'heading', text: 'CHAPTER I.' },
        { kind: 'heading', text: 'OLD THINGS WITH NEW NAMES.' },
        {
          kind: 'table',
          cells: [
            ['The Oriental Kabala', '1'],
            ['Ancient cryptic science', '7']
          ]
        },
        { kind: 'heading', text: 'CHAPTER II.' },
        { kind: 'heading', text: 'PHENOMENA AND FORCES.' },
        {
          kind: 'table',
          cells: [
            ['The servility of society', '39'],
            ['Prejudice and bigotry', '40']
          ]
        }
      ]),
      leaf(
        1,
        'chapter-opening',
        [
          { kind: 'heading', text: 'CHAPTER I.' },
          { kind: 'paragraph', text: 'The Kabala of the East is older than is supposed.' }
        ],
        '1'
      ),
      leaf(2, 'body', [{ kind: 'paragraph', text: 'The cryptic science of the ancients.' }], '7'),
      leaf(
        3,
        'chapter-opening',
        [
          { kind: 'heading', text: 'CHAPTER II.' },
          { kind: 'paragraph', text: 'Society is servile to its own authorities.' }
        ],
        '39'
      ),
      leaf(
        4,
        'body',
        [{ kind: 'paragraph', text: 'Men of science are not free of bigotry.' }],
        '40'
      )
    ])
    const before = book.chapters.filter((c) => (c.topics?.length ?? 0) > 0)
    expect(before.length).toBe(2)

    const corrected = applyEdits(book, [
      { kind: 'text', blockId: 'p1b1', text: 'The Kabala of the East is older still.' }
    ])
    const after = corrected.chapters.filter((c) => (c.topics?.length ?? 0) > 0)
    expect(after.map((c) => c.topics?.map((t) => t.text))).toEqual(
      before.map((c) => c.topics?.map((t) => t.text))
    )
  })
})

/**
 * The property the whole two-pass contents rests on, asserted with topics on
 * the page: **filling the numbers in must not change the length of the book.**
 *
 * `layoutWithToc` lays the contents out twice — once with the folios blank so
 * the body falls where it finally will, once with the measured numbers — and a
 * difference in page count between them means the contents is describing a book
 * that no longer exists. Its fallback is pass one, which has *no page numbers
 * at all*, and it reports that on the warnings channel.
 *
 * So the test asserts what a reader would see: every topic carries a number,
 * and no warning says the numbers had to be thrown away. A descriptive contents
 * once failed exactly here, shipped numberless and said nothing.
 */
describe('the contents survives having topics on it', () => {
  const measurer = fixedWidthMeasurer(0.5)

  function bookWithTopics(chapters: number, topicsEach: number) {
    const pages = [
      {
        role: 'table-of-contents',
        blocks: [
          { kind: 'heading', text: 'TABLE OF CONTENTS.' },
          ...Array.from({ length: chapters }, (_, c) => [
            { kind: 'heading', text: `CHAPTER ${c + 1}.` },
            { kind: 'heading', text: `THE CHAPTER CALLED ${c + 1}.` },
            {
              kind: 'table',
              cells: Array.from({ length: topicsEach }, (_, t) => [
                `Topic ${c + 1}.${t + 1} concerning a matter set out at some length here`,
                String(c * topicsEach + t + 1)
              ])
            }
          ]).flat()
        ],
        uncertain: [],
        furniture: {}
      },
      ...Array.from({ length: chapters * topicsEach }, (_, n) => {
        const c = Math.floor(n / topicsEach)
        const opens = n % topicsEach === 0
        return {
          role: opens ? 'chapter-opening' : 'body',
          blocks: [
            ...(opens
              ? [
                  { kind: 'heading', text: `CHAPTER ${c + 1}.` },
                  { kind: 'heading', text: `THE CHAPTER CALLED ${c + 1}.` }
                ]
              : []),
            {
              kind: 'paragraph',
              text: `Page ${n + 1} of the body, with enough words on it to take a line or two and no more than that.`
            }
          ],
          uncertain: [],
          furniture: { folio: String(n + 1) }
        }
      })
    ]
    return assembleBook(pages.map((p, i) => parsePageTranscription(p, i)))
  }

  it('numbers every topic, and does not fall back to the numberless pass', () => {
    // Big enough to spill the contents onto a second leaf, because the fault
    // this guards against only shows when the extra lines push a page over.
    const book = bookWithTopics(8, 6)
    expect(book.chapters.some((c) => (c.topics?.length ?? 0) > 0)).toBe(true)

    const laid = layoutWithToc(book, defaultStyleProfile(), measurer, {
      edition: { title: 'Isis Unveiled', author: 'H. P. Blavatsky', editionDate: '2026' }
    })

    expect(laid.warnings.map((w) => w.text).join(' ')).not.toMatch(/without page numbers/u)

    // Every topic printed, and every one of them with a number beside it that
    // is this edition's rather than the original's.
    const contents = laid.pages.filter((p) => p.kind === 'contents')
    expect(contents.length).toBeGreaterThan(1)
    const printed = contents
      .flatMap((p) => p.items)
      .filter((i): i is Extract<typeof i, { kind: 'line' }> => i.kind === 'line')
      .map((l) => l.runs.map((r) => r.text).join(' '))
    const topicLines = contents
      .flatMap((p) => p.items)
      .filter((i): i is Extract<typeof i, { kind: 'line' }> => i.kind === 'line')
      .filter((l) => /^Topic \d+\.\d+/u.test(l.runs.map((r) => r.text).join(' ')))
    expect(topicLines).toHaveLength(48)

    // The number is a run of its own at the end of the line, set flush right.
    // Asserted off the runs rather than off the joined string, because the
    // topic's own text ends in a word and a regex for "ends in digits" over the
    // whole line was answered by nothing at all: it passed with every folio
    // forced to null.
    const numbers = topicLines.map((l) => l.runs[l.runs.length - 1])
    expect(numbers.every((r) => r !== undefined && /^\d+$/u.test(r.text))).toBe(true)

    // And they are *this* edition's numbers. The original's folios were 1 to
    // 48, one per leaf; this edition sets front matter before the body and puts
    // several of those leaves on a page, so the two cannot agree all the way
    // down. An entry still carrying the number the 1877 page printed is the one
    // thing this whole mechanism exists to prevent.
    const asPrinted = numbers.map((r) => Number(r?.text))
    expect(asPrinted.some((n, i) => n !== i + 1)).toBe(true)
    expect(printed.length).toBeGreaterThan(0)
  })

  /**
   * The invariant `layoutWithToc` rests on, asserted directly rather than
   * through it: **a contents laid out with the folios blank is the same length
   * as the same contents with them filled in.**
   *
   * Through `layoutWithToc` it cannot be seen. Its guard compares the whole
   * book's page count, and in a book whose chapters open recto a contents one
   * leaf shorter is absorbed by the blanks that pad each opening to a right-hand
   * page — measured: emitting a topic line only when it had a number changed
   * nothing the guard could detect, while pass one carried no topics at all.
   * So the two layouts are run here and compared where the difference lives.
   */
  it('lays the same contents to the same length with the numbers blank', () => {
    const book = bookWithTopics(8, 6)
    const entries = book.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      ...(chapter.label ? { label: chapter.label } : {}),
      level: chapter.level,
      topics: (chapter.topics ?? []).map((t) => ({
        text: t.text,
        blockId: t.blockId,
        folio: null as string | null
      }))
    }))
    const options = {
      edition: { title: 'Isis Unveiled', author: 'H. P. Blavatsky', editionDate: '2026' }
    }
    const blank = layout(book, defaultStyleProfile(), measurer, {
      ...options,
      toc: entries.map((e) => ({ ...e, folio: null }))
    })
    const filled = layout(book, defaultStyleProfile(), measurer, {
      ...options,
      toc: entries.map((e) => ({
        ...e,
        folio: '9',
        topics: e.topics.map((t) => ({ ...t, folio: '123' }))
      }))
    })
    const contentsPages = (b: typeof blank): number =>
      b.pages.filter((p) => p.kind === 'contents').length
    expect(contentsPages(filled)).toBe(contentsPages(blank))
    expect(filled.pages.length).toBe(blank.pages.length)
  })
})
