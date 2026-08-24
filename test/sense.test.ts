import { describe, it, expect } from 'vitest'
import {
  chunkForSense,
  locateFindings,
  parseSenseFinding,
  parseVerdict,
  scoreSense,
  settle,
  settleAll,
  type SenseFinding,
  type Verdict
} from '@core/coherence'
import type { BookBlock, BookDocument } from '@core/assemble'

const finding = (over: Partial<SenseFinding> = {}): SenseFinding => ({
  blockId: 'p0b1',
  quote: 'a fate that could move mountains',
  kind: 'nonsense',
  why: 'a fate does not move mountains; the idiom belongs to faith',
  expected: 'a faith that could move mountains',
  ...over
})

const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  blockId: 'p0b1',
  quote: 'a fate that could move mountains',
  reads: 'a faith that could move mountains',
  legible: true,
  ...over
})

/**
 * The rule the whole module exists for. A hypothesis is carried so a person can
 * see what was guessed; it is never the source of a character that reaches the
 * book.
 */
describe('a correction comes from the crop, never from the guess', () => {
  it('takes its text from the verdict', () => {
    const settled = settle(finding(), verdict())
    expect(settled.outcome).toBe('corrected')
    expect(settled.correction).toBe('a faith that could move mountains')
  })

  it('takes the verdict even when the verdict disagrees with the guess', () => {
    // The reader with the crop says the paper reads "fete". The hypothesis said
    // "faith". The book gets "fete", and the disagreement is recorded.
    const settled = settle(finding(), verdict({ reads: 'a fete that could move mountains' }))
    expect(settled.correction).toBe('a fete that could move mountains')
    expect(settled.correction).not.toContain('faith')
    expect(settled.hypothesisAgreed).toBe(false)
  })

  it('records when the guess happened to be right, and changes nothing by it', () => {
    const settled = settle(finding(), verdict())
    expect(settled.hypothesisAgreed).toBe(true)
    expect(settled.correction).toBe(settled.verdict!.reads)
  })

  /**
   * A true detection with nothing to change. On the first book here a repeated
   * phrase was flagged, cropped, and turned out to be the author's own
   * rhetoric. That is not a false positive and must not be counted as one.
   */
  it('changes nothing when the paper says what the book already says', () => {
    const settled = settle(finding(), verdict({ reads: 'a fate that could move mountains' }))
    expect(settled.outcome).toBe('as-printed')
    expect(settled.correction).toBeNull()
  })

  it('leaves a finding unresolved when the crop cannot be read', () => {
    const settled = settle(finding(), verdict({ legible: false, reads: '' }))
    expect(settled.outcome).toBe('unreadable')
    expect(settled.correction).toBeNull()
  })

  it('leaves a finding unresolved when no verdict came back at all', () => {
    expect(settle(finding(), null).outcome).toBe('unreadable')
  })

  /** Whole words set in capitals are how this period emphasises; that is a real
   * difference on the page and must never be swallowed as "no change". */
  it('treats a change of case as a correction', () => {
    const settled = settle(
      finding({ quote: 'the real knower' }),
      verdict({ quote: 'the real knower', reads: 'the real KNOWER' })
    )
    expect(settled.outcome).toBe('corrected')
    expect(settled.correction).toBe('the real KNOWER')
  })

  it('ignores whitespace and quote shape when comparing', () => {
    const settled = settle(
      finding({ quote: 'the  “astral”\nbody' }),
      verdict({ quote: 'the  “astral”\nbody', reads: 'the "astral" body' })
    )
    expect(settled.outcome).toBe('as-printed')
  })
})

describe('pairing verdicts to findings', () => {
  /**
   * By block and span, never by position: a short or reordered verdict list
   * would otherwise settle each finding against its neighbour's reading, which
   * produces a plausible correction in the wrong place.
   */
  it('pairs on the span, not the array index', () => {
    const findings = [
      finding({ blockId: 'p0b1', quote: 'first span' }),
      finding({ blockId: 'p0b2', quote: 'second span' })
    ]
    const verdicts = [
      verdict({ blockId: 'p0b2', quote: 'second span', reads: 'SECOND' }),
      verdict({ blockId: 'p0b1', quote: 'first span', reads: 'FIRST' })
    ]
    const settled = settleAll(findings, verdicts)
    expect(settled[0]!.correction).toBe('FIRST')
    expect(settled[1]!.correction).toBe('SECOND')
  })

  it('leaves a finding unresolved when its verdict never came', () => {
    const settled = settleAll([finding()], [])
    expect(settled[0]!.outcome).toBe('unreadable')
  })
})

describe('what a finding is allowed to be', () => {
  it('refuses a kind the pass does not take', () => {
    expect(() => parseSenseFinding({ ...finding(), kind: 'style' }, 0)).toThrow(/not a kind/)
    expect(() => parseSenseFinding({ ...finding(), kind: 'punctuation' }, 0)).toThrow(/not a kind/)
  })

  it('refuses a finding with no quote, because it could never be cropped', () => {
    expect(() => parseSenseFinding({ ...finding(), quote: '' }, 0)).toThrow(/quote/)
  })

  it('refuses a finding with no reason', () => {
    expect(() => parseSenseFinding({ ...finding(), why: '  ' }, 0)).toThrow(/reason/)
  })

  it('takes a finding with no hypothesis — noticing is allowed on its own', () => {
    const parsed = parseSenseFinding({ ...finding(), expected: '' }, 0)
    expect(parsed.expected).toBe('')
  })

  it('refuses a verdict that is legible and says nothing', () => {
    expect(() => parseVerdict({ blockId: 'a', quote: 'b', reads: '', legible: true }, 0)).toThrow()
  })
})

/**
 * A quote that is not in its block is a paraphrase, and a paraphrase cannot be
 * cropped — so it cannot be adjudicated, so it must not be acted on. Unplaced
 * rather than attached at a guess, exactly as an unfindable note anchor is.
 */
describe('locating a finding in the block it names', () => {
  const blocks = new Map([['p0b1', 'It was  a fate that could\nmove mountains, he said.']])

  it('finds a quote that crossed a line break', () => {
    const [located] = locateFindings([finding()], blocks)
    expect(located!.at).not.toBeNull()
  })

  it('refuses a paraphrase rather than guessing where it goes', () => {
    const [located] = locateFindings([finding({ quote: 'something about mountains' })], blocks)
    expect(located!.at).toBeNull()
  })

  it('refuses a quote against a block that is not there', () => {
    const [located] = locateFindings([finding({ blockId: 'nope' })], blocks)
    expect(located!.at).toBeNull()
  })
})

describe('the ledger', () => {
  it('scores corrections against what was judged', () => {
    const settled = [
      settle(finding({ quote: 'one' }), verdict({ quote: 'one', reads: 'won' })),
      settle(finding({ quote: 'two' }), verdict({ quote: 'two', reads: 'too' })),
      settle(finding({ quote: 'three' }), verdict({ quote: 'three', reads: 'three' })),
      settle(finding({ quote: 'four' }), null)
    ]
    const ledger = scoreSense(settled, 1)
    expect(ledger.raised).toBe(5)
    expect(ledger.unplaced).toBe(1)
    expect(ledger.corrected).toBe(2)
    expect(ledger.asPrinted).toBe(1)
    expect(ledger.unreadable).toBe(1)
    // Two corrections out of three actually judged.
    expect(ledger.precision).toBeCloseTo(2 / 3)
  })

  /** A rate over nothing reads as a verdict and is not one. */
  it('reports no precision until something has been adjudicated', () => {
    expect(scoreSense([settle(finding(), null)]).precision).toBeNull()
  })
})

describe('chunking a book for readers who see one chapter each', () => {
  let n = 0
  const block = (text: string, kind: BookBlock['kind'] = 'paragraph'): BookBlock => ({
    id: `b${n++}`,
    kind,
    text,
    sourcePages: [0]
  })

  const built = (): BookDocument => {
    n = 0
    const blocks = [
      block('A preface the book printed itself.'),
      block('LESSON I.', 'heading'),
      block('THE ASTRAL SENSES.', 'heading'),
      block('Panchadasi begins with the ordinary five senses.'),
      block('Panchadasi returns to Panchadasi again and again.'),
      block('LESSON II.', 'heading'),
      block('TELEPATHY.', 'heading'),
      block('The second lesson takes up telepathy.')
    ]
    return {
      blocks,
      footnotes: [],
      chapters: [
        {
          id: 'b1',
          title: 'THE ASTRAL SENSES.',
          label: 'LESSON I.',
          level: 1,
          blockIndex: 1,
          sourcePage: 0
        },
        {
          id: 'b5',
          title: 'TELEPATHY.',
          label: 'LESSON II.',
          level: 1,
          blockIndex: 5,
          sourcePage: 0
        }
      ],
      asides: [],
      illustrations: [],
      sections: [],
      skipped: [],
      synopsesUnmatched: []
    }
  }

  it('gives one chunk per chapter, named as the book names it', () => {
    const { chunks } = chunkForSense(built())
    expect(chunks.map((c) => c.title)).toEqual([
      'Front matter the book printed',
      'THE ASTRAL SENSES.',
      'TELEPATHY.'
    ])
    expect(chunks[1]!.label).toBe('LESSON I.')
  })

  it('keeps the block ids a finding has to name', () => {
    const { chunks } = chunkForSense(built())
    expect(chunks[1]!.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4'])
  })

  it('loses nothing: every block lands in exactly one chunk', () => {
    const document = built()
    const { chunks } = chunkForSense(document)
    const seen = chunks.flatMap((c) => c.blocks.map((b) => b.id))
    expect(seen).toEqual(document.blocks.map((b) => b.id))
  })

  /**
   * Without this each reader meets the book's own vocabulary cold and files it
   * as incoherent, which is the commonest way a sense pass drowns in noise.
   */
  it('carries the vocabulary the book has established', () => {
    const { register } = chunkForSense(built())
    expect(register).toContain('Panchadasi')
  })

  it('leaves the editor’s own sections out — there is no crop behind them', () => {
    const document = built()
    document.sections = [
      {
        id: 'introduction',
        placement: 'front',
        title: 'Before You Begin',
        blocks: [
          {
            id: 'introduction/b0',
            kind: 'paragraph',
            text: 'Written this century.',
            sourcePages: []
          }
        ]
      }
    ]
    const { chunks } = chunkForSense(document)
    expect(chunks.flatMap((c) => c.blocks.map((b) => b.id))).not.toContain('introduction/b0')
  })
})
