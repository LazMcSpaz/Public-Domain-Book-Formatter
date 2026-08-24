import { describe, it, expect } from 'vitest'
import {
  answerFor,
  outstanding,
  settled,
  unapplied,
  rulingsMarkdown,
  toMention,
  queriesMarkdown,
  type RaisedQuery,
  type Ruling
} from '@core/queries'
import { noteOnTheText } from '@core/annotate'

const query = (over: Partial<RaisedQuery> = {}): RaisedQuery => ({
  pageIndex: 12,
  quote: 'radioative',
  why: 'The compositor dropped the c; the page is unambiguous.',
  kind: 'printers-error',
  ...over
})

const ruling = (over: Partial<Ruling> = {}): Ruling => ({
  pageIndex: 12,
  quote: 'radioative',
  kind: 'printers-error',
  decision: 'corrected',
  correction: 'radioactive',
  decidedOn: '2026-08-24',
  ...over
})

describe('finding the ruling that settles a query', () => {
  it('matches the leaf and the words', () => {
    expect(answerFor(query(), [ruling()])?.correction).toBe('radioactive')
  })

  it('does not settle the same words on a different leaf', () => {
    expect(answerFor(query({ pageIndex: 40 }), [ruling()])).toBeNull()
  })

  it('ignores case and surrounding space, which a quote picks up either way', () => {
    expect(answerFor(query({ quote: ' Radioative ' }), [ruling()])).not.toBeNull()
  })

  it('leaves a query nothing has been said about', () => {
    expect(answerFor(query({ quote: 'belleves' }), [ruling()])).toBeNull()
  })
})

/**
 * The reason most editorial decisions are made once: a book that prints
 * `colour` beside `color` will do it forty more times, and asking forty times
 * is how a sheet stops being read.
 */
describe('a standing ruling', () => {
  const standing = ruling({
    pageIndex: null,
    quote: 'British/American spelling',
    kind: 'inconsistent',
    decision: 'noted',
    correction: undefined,
    covers: ['centre', 'colors', 'colour'],
    mention: true
  })

  it('settles every query whose words it names, on any leaf', () => {
    for (const [leaf, quote] of [
      [8, 'the centre of the aura'],
      [31, 'astral colors'],
      [64, 'the colour of fear']
    ] as const) {
      expect(answerFor(query({ pageIndex: leaf, quote, kind: 'inconsistent' }), [standing])).toBe(
        standing
      )
    }
  })

  it('settles nothing of another kind, however the words fall', () => {
    expect(answerFor(query({ quote: 'the centre', kind: 'printers-error' }), [standing])).toBeNull()
  })

  /**
   * Explicit rather than inferred, on purpose: a policy that worked out for
   * itself which questions it had answered would quietly settle one nobody had
   * read.
   */
  it('settles nothing it was not told to cover', () => {
    expect(answerFor(query({ quote: 'realise', kind: 'inconsistent' }), [standing])).toBeNull()
  })

  it('yields to a ruling made on the spot, which was made looking at the leaf', () => {
    const onTheSpot = ruling({ pageIndex: 8, quote: 'the centre', kind: 'inconsistent' })
    expect(
      answerFor(query({ pageIndex: 8, quote: 'the centre', kind: 'inconsistent' }), [
        standing,
        onTheSpot
      ])
    ).toBe(onTheSpot)
  })

  it('is not confused by an empty cover, which would otherwise match everything', () => {
    const sloppy = ruling({ pageIndex: null, covers: ['', '  '], kind: 'inconsistent' })
    expect(answerFor(query({ kind: 'inconsistent' }), [sloppy])).toBeNull()
  })
})

describe('what is still waiting', () => {
  const raised = [
    query(),
    query({ pageIndex: 11, quote: 'man visible', kind: 'printers-error' }),
    query({ pageIndex: 8, quote: 'the centre', kind: 'inconsistent' })
  ]

  it('drops the settled ones', () => {
    expect(outstanding(raised, [ruling()]).map((q) => q.pageIndex)).toEqual([11, 8])
  })

  it('hands back each settled query beside what settled it', () => {
    const pairs = settled(raised, [ruling()])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.query.pageIndex).toBe(12)
    expect(pairs[0]!.ruling.correction).toBe('radioactive')
  })

  it('leaves everything waiting when nothing has been ruled', () => {
    expect(outstanding(raised, [])).toHaveLength(3)
  })
})

/**
 * The deterministic cross-check this module is shaped around. A `corrected`
 * ruling is a decision that has not happened until an edit lands, and the gap
 * between deciding and applying is where a book quietly keeps the error its
 * editor is certain was fixed.
 */
describe('rulings the book has not caught up with', () => {
  it('flags a correction the text does not carry', () => {
    expect(unapplied([ruling()], 'a radioative emanation of the aura')).toHaveLength(1)
  })

  it('says nothing once the text reads the corrected way', () => {
    expect(unapplied([ruling()], 'a radioactive emanation of the aura')).toEqual([])
  })

  it('still flags it when both readings are in the book', () => {
    // One occurrence mended and another missed is the commonest way a
    // correction half-lands, and the one a plain "is the new word there?" test
    // would call finished.
    expect(unapplied([ruling()], 'radioactive here, radioative there')).toHaveLength(1)
  })

  it('has no opinion about a ruling that changes nothing', () => {
    expect(unapplied([ruling({ decision: 'as-printed', correction: undefined })], '')).toEqual([])
  })

  it('flags a correction that never said what it should read', () => {
    expect(unapplied([ruling({ correction: '' })], 'anything')).toHaveLength(1)
  })
})

describe('the record for the shelf', () => {
  it('groups by what was decided and says when', () => {
    const md = rulingsMarkdown({ title: 'The Human Aura', fileName: 'aura.pdf' }, [
      ruling({ because: 'A plain compositor’s slip.' }),
      ruling({
        pageIndex: null,
        quote: 'British/American spelling',
        kind: 'inconsistent',
        decision: 'noted',
        correction: undefined
      })
    ])
    expect(md).toContain('## Set right')
    expect(md).toContain('## Kept, and told to the reader')
    expect(md).toContain('`radioactive`')
    expect(md).toContain('2026-08-24')
    // A standing ruling names no leaf, and says so rather than printing a number
    // that would read as leaf zero.
    expect(md).toContain('*standing*')
  })

  it('says so when nothing has been decided yet', () => {
    expect(rulingsMarkdown({ title: 'A Book', fileName: 'b.pdf' }, [])).toContain(
      'Nothing has been ruled on yet.'
    )
  })

  it('escapes a pipe, which a table would otherwise break on', () => {
    const md = rulingsMarkdown({ title: 'A Book', fileName: 'b.pdf' }, [ruling({ quote: 'a | b' })])
    expect(md).toContain('a \\| b')
  })
})

describe('the queries sheet, once some are answered', () => {
  const book = { title: 'The Human Aura', fileName: 'aura.pdf' }
  const raised = [query(), query({ pageIndex: 11, quote: 'man visible' })]

  it('shows only what is waiting', () => {
    const md = queriesMarkdown(book, raised, [ruling()])
    expect(md).toContain('man visible')
    expect(md).not.toContain('radioative')
    expect(md).toContain('1 decision waiting')
  })

  it('points at the rulings rather than pretending nothing was asked', () => {
    expect(queriesMarkdown(book, raised, [ruling()])).toContain('rulings.md')
  })

  it('empties as it is answered', () => {
    const all = raised.map((q) => ruling({ pageIndex: q.pageIndex, quote: q.quote }))
    const md = queriesMarkdown(book, raised, all)
    expect(md).toContain('Nothing is waiting on you.')
    expect(md).toContain('2 have been ruled on')
  })

  it('reads exactly as it did when nothing has been ruled', () => {
    expect(queriesMarkdown(book, raised)).not.toContain('rulings.md')
  })
})

/**
 * A reprint that silently mends its original is not being faithful, and one
 * that silently keeps an obvious error looks careless. Either way the fix is to
 * say what was done, once, in the note on the text.
 */
describe('what the introduction owes the reader', () => {
  const rulings = [
    ruling({ mention: true }),
    ruling({
      pageIndex: null,
      quote: 'British/American spelling',
      kind: 'inconsistent',
      decision: 'noted',
      correction: undefined,
      mention: true
    }),
    ruling({ pageIndex: 40, quote: 'a stray comma', mention: false })
  ]

  it('carries only what the editor marked', () => {
    const { kept, corrected } = toMention(rulings)
    expect(corrected).toHaveLength(1)
    expect(kept).toHaveLength(1)
    expect([...kept, ...corrected].some((r) => r.quote === 'a stray comma')).toBe(false)
  })

  it('separates what the reader will see from what they will not', () => {
    const { kept, corrected } = toMention(rulings)
    expect(kept[0]!.decision).toBe('noted')
    expect(corrected[0]!.decision).toBe('corrected')
  })
})

/**
 * The note on the text, as the introduction prompt receives it.
 *
 * Structural rather than remembered: the writer is handed what this edition
 * decided, so an introduction cannot silently omit it — which is the failure
 * this whole channel exists to prevent, arriving one step later.
 */
describe('the note on the text', () => {
  const rulings: Ruling[] = [
    ruling({ mention: true, because: 'A plain slip of the setting.' }),
    ruling({
      pageIndex: null,
      quote: 'British/American spelling',
      kind: 'inconsistent',
      decision: 'noted',
      correction: undefined,
      because: 'The copy-text mixes the two, and that is the book’s own habit.',
      mention: true
    })
  ]

  it('says nothing when the edition decided nothing worth telling', () => {
    expect(noteOnTheText([])).toEqual([])
    expect(noteOnTheText([ruling({ mention: false })])).toEqual([])
  })

  it('puts what was kept before what was corrected', () => {
    const text = noteOnTheText(rulings).join('\n')
    expect(text.indexOf('Kept as the original printed it')).toBeLessThan(text.indexOf('Set right'))
  })

  it('carries the reasoning, which is what makes the note worth reading', () => {
    expect(noteOnTheText(rulings).join('\n')).toContain('the book’s own habit')
  })

  /**
   * A note on the text is two or three sentences, not a list of errata. The
   * places are given to the writer so the note can be truthful about how many;
   * the instruction is to count them, not to print them.
   */
  it('tells the writer not to name the individual places', () => {
    const text = noteOnTheText(rulings).join('\n')
    expect(text).toContain('do not name them')
    expect(text).toContain('Do not list the individual places')
  })
})
