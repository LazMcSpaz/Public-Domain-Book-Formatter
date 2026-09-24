import { describe, it, expect } from 'vitest'
import {
  answerFor,
  standingFor,
  held,
  heldBecause,
  outstanding,
  settled,
  unapplied,
  rulingsMarkdown,
  reviewMarkdown,
  toMention,
  withRuling,
  queriesMarkdown,
  type RaisedQuery,
  type Ruling
} from '@core/queries'
import { type BookBlock, type BookDocument } from '@core/assemble'
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

/**
 * A book made of whatever text a case needs.
 *
 * `unapplied` takes the document rather than a string because the caller that
 * used to build the string got it wrong — see `bookText`. Building a document
 * here rather than passing prose keeps these tests asking the question the
 * caller actually asks.
 */
const book = (over: Partial<BookDocument> = {}): BookDocument => ({
  blocks: [],
  footnotes: [],
  chapters: [],
  asides: [],
  illustrations: [],
  sections: [],
  skipped: [],
  synopsesUnmatched: [],
  ...over
})

const para = (text: string, over: Partial<BookBlock> = {}): BookBlock => ({
  id: 'p12b1',
  kind: 'paragraph',
  text,
  sourcePages: [12],
  ...over
})

const prose = (text: string): BookDocument => book({ blocks: [para(text)] })

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

  /**
   * The editor's ruling on standing rulings, in his words: *pre-filled and
   * held*. A query the ruling reaches is not settled by it — it stays
   * outstanding, arrives at the gate with the ruling's decision filled in,
   * and is filed when a person approves it. The first version of this
   * settled it silently, and the query never reached anyone.
   */
  it('reaches every query whose words it names, on any leaf — and settles none of them', () => {
    for (const [leaf, quote] of [
      [8, 'the centre of the aura'],
      [31, 'astral colors'],
      [64, 'the colour of fear']
    ] as const) {
      const q = query({ pageIndex: leaf, quote, kind: 'inconsistent' })
      expect(standingFor(q, [standing])).toBe(standing)
      expect(answerFor(q, [standing])).toBeNull()
      expect(outstanding([q], [standing])).toEqual([q])
      expect(held([q], [standing])).toEqual([{ query: q, ruling: standing }])
    }
  })

  it('reaches nothing of another kind, however the words fall', () => {
    expect(
      standingFor(query({ quote: 'the centre', kind: 'printers-error' }), [standing])
    ).toBeNull()
  })

  /**
   * Explicit rather than inferred, on purpose: a policy that worked out for
   * itself which questions it had answered would quietly hold one nobody had
   * read.
   */
  it('reaches nothing it was not told to cover', () => {
    expect(standingFor(query({ quote: 'realise', kind: 'inconsistent' }), [standing])).toBeNull()
  })

  it('a ruling made on the spot settles the query, and it is no longer held', () => {
    const onTheSpot = ruling({ pageIndex: 8, quote: 'the centre', kind: 'inconsistent' })
    const q = query({ pageIndex: 8, quote: 'the centre', kind: 'inconsistent' })
    expect(answerFor(q, [standing, onTheSpot])).toBe(onTheSpot)
    expect(held([q], [standing, onTheSpot])).toEqual([])
  })

  it('is not confused by an empty cover, which would otherwise match everything', () => {
    const sloppy = ruling({ pageIndex: null, covers: ['', '  '], kind: 'inconsistent' })
    expect(standingFor(query({ kind: 'inconsistent' }), [sloppy])).toBeNull()
  })

  it('the reasoning an approval carries names the ruling it came from', () => {
    expect(heldBecause(standing)).toMatch(
      /^Under the standing ruling “British\/American spelling” \(2026-/u
    )
    expect(heldBecause(standing)).toContain(standing.because ?? '')
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
    expect(unapplied([ruling()], prose('a radioative emanation of the aura'))).toHaveLength(1)
  })

  it('says nothing once the text reads the corrected way', () => {
    expect(unapplied([ruling()], prose('a radioactive emanation of the aura'))).toEqual([])
  })

  it('still flags it when both readings are in the book', () => {
    // One occurrence mended and another missed is the commonest way a
    // correction half-lands, and the one a plain "is the new word there?" test
    // would call finished.
    expect(unapplied([ruling()], prose('radioactive here, radioative there'))).toHaveLength(1)
  })

  /**
   * The real leaf, and the reason the comparison is made in both notations.
   *
   * Leaf 285 of *Isis Unveiled* Vol. I prints `on acount of the
   * <i>desecration.</i>`. The query was raised by a reader working from the
   * render, in plain prose, and the ruling was written from the query — so the
   * word was mended, the edit landed, and the check went on reporting the
   * ruling outstanding because the tags sat inside the quoted phrase.
   */
  it('finds a correction whose wording straddles an italic the ruling does not quote', () => {
    const italicised = ruling({
      pageIndex: 285,
      quote: 'extinguished on acount of the desecration.',
      correction: 'extinguished on account of the desecration.'
    })
    expect(
      unapplied(
        [italicised],
        prose(
          'but was instantaneously extinguished on account of the <i>desecration.</i> T. Livius'
        )
      )
    ).toEqual([])
  })

  it('still flags it when the book keeps the printed form behind the same markup', () => {
    const italicised = ruling({
      pageIndex: 285,
      quote: 'extinguished on acount of the desecration.',
      correction: 'extinguished on account of the desecration.'
    })
    expect(
      unapplied(
        [italicised],
        book({
          blocks: [
            para('extinguished on account of the <i>desecration.</i>'),
            para('extinguished on acount of the <i>desecration.</i>', { id: 'p12b2' })
          ]
        })
      )
    ).toHaveLength(1)
  })

  /**
   * The one thing stripping the tags cannot see. A ruling whose two forms are
   * the same words and differ only in emphasis would compare equal to itself
   * once stripped, and every such ruling would read as already applied.
   */
  it('reads a ruling about the emphasis alone with the markup left in', () => {
    const setInItalic = ruling({
      pageIndex: 137,
      quote: 'the Catechism of the Religion of Positivism',
      correction: 'the <i>Catechism of the Religion of Positivism</i>'
    })
    expect(
      unapplied(
        [setInItalic],
        prose('exclaims the author of the Catechism of the Religion of Positivism')
      )
    ).toHaveLength(1)
    expect(
      unapplied(
        [setInItalic],
        prose('exclaims the author of the <i>Catechism of the Religion of Positivism</i>')
      )
    ).toEqual([])
  })

  /**
   * A correction that only *adds* something contains the printed form, so
   * "is the old reading still there?" is meaningless — it always is. Asking
   * anyway reported a landed correction as outstanding forever, which is how
   * a check that exists to be believed stops being believed.
   */
  it('says nothing about a correction that only adds to what was printed', () => {
    const closing = ruling({
      pageIndex: 163,
      quote: 'the moment at which he awoke.',
      correction: 'the moment at which he awoke.\u201d'
    })
    expect(
      unapplied([closing], prose('dispatching a messenger, the moment at which he awoke.\u201d'))
    ).toEqual([])
  })

  it('still flags that correction when it never landed', () => {
    const closing = ruling({
      pageIndex: 163,
      quote: 'the moment at which he awoke.',
      correction: 'the moment at which he awoke.\u201d'
    })
    expect(
      unapplied([closing], prose('dispatching a messenger, the moment at which he awoke.'))
    ).toHaveLength(1)
  })

  it('has no opinion about a ruling that changes nothing', () => {
    expect(unapplied([ruling({ decision: 'as-printed', correction: undefined })], book())).toEqual(
      []
    )
  })

  it('flags a correction that never said what it should read', () => {
    expect(unapplied([ruling({ correction: '' })], prose('anything'))).toHaveLength(1)
  })

  /**
   * Measured on *Isis Unveiled*: two of the corrections the editor ruled on
   * were inside footnotes, which assembly pulls out of the block flow, so a
   * check reading `doc.blocks` reported them outstanding after they had been
   * made. Both notes and the editor's own divisions are text a reader sees.
   */
  it('sees a correction that landed in a footnote', () => {
    const note = ruling({
      pageIndex: 89,
      quote: 'the Northen Hemisphere',
      correction: 'the Northern Hemisphere'
    })
    const withNote = book({
      blocks: [para('The note hangs off this sentence.')],
      footnotes: [
        {
          id: 'fn48',
          originalMarker: '*',
          text: 'at the end of the tertiary period, the Northern Hemisphere had changed',
          pageIndex: 89,
          orphaned: false
        }
      ]
    })
    expect(unapplied([note], withNote)).toEqual([])
  })

  it('sees a correction that landed in a division the editor wrote', () => {
    const inIntro = ruling({ quote: 'radioative', correction: 'radioactive' })
    const withIntro = book({
      sections: [
        {
          id: 'introduction',
          placement: 'front',
          title: 'Introduction',
          blocks: [para('a radioactive emanation of the aura', { id: 'introb1' })]
        }
      ]
    })
    expect(unapplied([inIntro], withIntro)).toEqual([])
  })

  /**
   * A ruling's correction is quoted from the text as it is written down, and
   * emphasis is written down as `<i>`. A block's own `text` has it stripped out
   * into word indices, so a correction carrying a tag could never be found —
   * the third false alarm the same book produced.
   */
  it('reads the emphasis back before looking for the words', () => {
    const italic = ruling({
      pageIndex: 67,
      quote: 'the ancient mystics—the <i>Tetractys.</i>',
      correction: 'the ancient mystics—the <i>Tetractys.</i> Amen.'
    })
    const set = book({
      blocks: [para('the ancient mystics—the Tetractys. Amen.', { emphasis: [3] })]
    })
    expect(unapplied([italic], set)).toEqual([])
  })
})

/**
 * The Glossary's rulings, which standing ruling 1 writes as the word put right
 * rather than as the passage. Fifteen of the twenty-six this check reported on
 * that book were already in it, and the eleven that were real were hard to
 * find among them. Each case below is one of the fifteen, with the control
 * that says the check still sees the ruling when it has not landed.
 */
describe('a ruling written as the part that changes', () => {
  const leaf = (page: number, text: string): BookBlock =>
    para(text, { id: `p${page}b0`, sourcePages: [page] })

  it('reads a broken sort transcribed whole as nothing to apply', () => {
    const sort = ruling({ quote: 'suspect the esoteric meaning', correction: 'esoteric' })
    expect(unapplied([sort], prose('none of them seem to suspect the esoteric meaning'))).toEqual(
      []
    )
  })

  it('keeps the pointing the correction does not give', () => {
    const moon = ruling({ quote: 'the Moon, called also Sekhet', correction: 'Moon' })
    expect(
      unapplied([moon], prose('The cat-headed goddess, the Moon, called also Sekhet.'))
    ).toEqual([])
  })

  it('puts the pointing it does give in place of the quote’s', () => {
    const gyn = ruling({ pageIndex: 133, quote: 'teacher or guru,', correction: 'guru.' })
    const mended = book({
      blocks: [
        leaf(133, 'Knowledge acquired under the tuition of an adept teacher or guru.'),
        leaf(368, 'as every teacher or guru, having authority, takes upon himself')
      ]
    })
    expect(unapplied([gyn], mended)).toEqual([])
  })

  it('still flags it on its own leaf when it has not landed', () => {
    const gyn = ruling({ pageIndex: 133, quote: 'teacher or guru,', correction: 'guru.' })
    const unmended = book({
      blocks: [
        leaf(133, 'Knowledge acquired under the tuition of an adept teacher or guru,'),
        leaf(368, 'Knowledge of the guru. And every teacher or guru, having authority')
      ]
    })
    expect(unapplied([gyn], unmended)).toHaveLength(1)
  })

  it('replaces only as much of the quote’s pointing as it has to', () => {
    const tag = ruling({ quote: 'Sraddha (Sk). Lit.,', correction: '(Sk.)' })
    expect(unapplied([tag], prose('Sraddha (Sk.). Lit., faith, respect, reverence.'))).toEqual([])
    expect(unapplied([tag], prose('Sraddha (Sk). Lit., faith, respect, reverence.'))).toHaveLength(
      1
    )
  })

  it('keeps the quote’s pointing outside the reach of the correction’s', () => {
    const tag = ruling({ quote: 'the \u201c(Heb) truth', correction: '(Heb.)' })
    expect(unapplied([tag], prose('the \u201c(Heb.) truth'))).toEqual([])
  })

  it('reads a book that spaces its quotation marks as the ruling does not', () => {
    const god = ruling({ quote: 'commonly translated \u201cGod\u2019,', correction: 'God\u201d' })
    expect(
      unapplied([god], prose('This deity-name is commonly translated \u201c God \u201d , meaning'))
    ).toEqual([])
    expect(
      unapplied([god], prose('This deity-name is commonly translated \u201c God\u2019 , meaning'))
    ).toHaveLength(1)
  })

  it('finds the word through the accent it puts right', () => {
    const they = ruling({ quote: 'Th\u00e8y have a mystic meaning', correction: 'They' })
    expect(unapplied([they], prose('They have a mystic meaning.'))).toEqual([])
    expect(unapplied([they], prose('Th\u00e8y have a mystic meaning.'))).toHaveLength(1)
  })

  it('is not undone by a later ruling on an accent in the same sentence', () => {
    const pandu = ruling({
      quote: 'literally; \u2019the father of the Pandavas',
      correction: 'literally; the father of the Pandavas'
    })
    expect(unapplied([pandu], prose('literally; the father of the P\u00e2ndavas Princes'))).toEqual(
      []
    )
  })

  it('does not mistake a doubled word taken out for a word confirmed', () => {
    const doubled = ruling({ quote: 'the the cat', correction: 'the cat' })
    expect(unapplied([doubled], prose('and the the cat sat'))).toHaveLength(1)
    const single = ruling({ quote: 'of the the', correction: 'the' })
    expect(unapplied([single], prose('the heart of the the matter'))).toHaveLength(1)
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

/**
 * The sheet an independent reader is handed.
 *
 * `queries.md` empties as it is answered and `rulings.md` only ever grows, so a
 * settled question is on one and off the other. That is right for working
 * through them and wrong for checking the work — an auditor wants every query
 * the reading raised, in book order, with what became of it, without holding
 * two files open and matching them by hand.
 */
describe('the review sheet', () => {
  const raised: RaisedQuery[] = [
    query({ pageIndex: 12, quote: 'radioative' }),
    query({ pageIndex: 40, quote: 'practiced deception', kind: 'inconsistent' }),
    query({ pageIndex: 63, quote: 'a passage nobody has ruled on' })
  ]
  const rulings: Ruling[] = [
    ruling({ because: 'The compositor dropped the c.' }),
    {
      pageIndex: null,
      quote: 'practiced / practised',
      kind: 'inconsistent',
      decision: 'as-printed',
      covers: ['practiced', 'practised'],
      because: 'Both were current in 1877.',
      decidedOn: '2026-08-24'
    }
  ]
  const sheet = reviewMarkdown({ title: 'The Astral World', fileName: 'a.pdf' }, raised, rulings)

  it('counts what is settled, what is held, and what is not', () => {
    expect(sheet).toContain(
      '3 raised, 1 settled, 1 held under a standing ruling for approval, 1 still waiting.'
    )
  })

  it('carries every query, settled or not, in leaf order', () => {
    const leaves = [...sheet.matchAll(/^\| (\d+) \|/gmu)].map((m) => Number(m[1]))
    expect(leaves).toEqual([12, 40, 63])
  })

  it('puts the corrected reading beside the words it was made about', () => {
    expect(sheet).toMatch(/\| 12 \|.*`radioative`.*Set right.*`radioactive`.*dropped the c/u)
  })

  it('marks a query still waiting rather than leaving the row blank', () => {
    expect(sheet).toMatch(/\| 63 \|.*\*\*waiting\*\*/u)
  })

  /**
   * A standing ruling holds a query without appearing against any one leaf,
   * so an auditor reading down the leaves would find a row marked held and
   * need to know which ruling holds it and what it would decide.
   */
  it('says when a query is held by a standing ruling, and what it would decide', () => {
    expect(sheet).toMatch(
      /\| 40 \|.*\*\*held\*\* — Kept as printed under the standing ruling “practiced \/ practised”/u
    )
    expect(sheet).toContain('## Standing rulings')
    expect(sheet).toContain('Both were current in 1877.')
  })

  it('says so plainly when nothing was raised', () => {
    expect(reviewMarkdown({ title: 'A', fileName: 'a.pdf' }, [], [])).toContain(
      'Nothing was raised'
    )
  })

  /**
   * The preamble named one book's year. Every sheet this function has ever
   * written says a 1975 typescript is being weighed against "the 1877
   * setting", because the sentence was written while the only book on the
   * shelf was *Isis Unveiled*. A sheet that misdates the book it heads is
   * not a smaller fault for being in the prose rather than in a table.
   */
  it('does not date the original from whichever book it was written for', () => {
    const preamble = reviewMarkdown({ title: 'A', fileName: 'a.pdf' }, [], [])
    expect(preamble).toContain('faithful to\nthe original setting')
    expect(preamble).not.toMatch(/\b1[6-9]\d\d\b/u)
  })
})

/**
 * Ruling on a query a second time.
 *
 * The list is what the shelf holds and what `answerFor` reads, so a duplicate
 * would make the answer depend on which one was looked at first — and appending
 * rather than replacing would make a diff out of nothing on a shelf whose whole
 * point is that git keeps every version.
 */
describe('the editor changing their mind', () => {
  const kept: Ruling = {
    pageIndex: 285,
    quote: 'on acount of the desecration',
    kind: 'printers-error',
    decision: 'as-printed',
    decidedOn: '2026-09-01'
  }

  it('replaces the earlier ruling where it stood', () => {
    const others: Ruling = { ...kept, pageIndex: 400, quote: 'elsewhere' }
    const mended: Ruling = {
      ...kept,
      decision: 'corrected',
      correction: 'on account of the desecration',
      decidedOn: '2026-09-10'
    }
    const out = withRuling([kept, others], mended)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual(mended)
    expect(out[1]).toEqual(others)
  })

  it('appends one that answers a query nothing has answered', () => {
    const fresh: Ruling = { ...kept, pageIndex: 12, quote: 'belleves' }
    expect(withRuling([kept], fresh)).toEqual([kept, fresh])
  })

  /**
   * The same query written with different spacing or case is the same query:
   * a quote is typed by whoever raised it, and `answerFor` already matches on
   * the trimmed lower-cased words. If this did not, the list would grow a
   * second answer that `answerFor` would then pick between arbitrarily.
   */
  it('knows the same query through a difference in case or spacing', () => {
    const same: Ruling = { ...kept, quote: '  On Acount Of The Desecration ', decision: 'noted' }
    const out = withRuling([kept], same)
    expect(out).toHaveLength(1)
    expect(out[0]!.decision).toBe('noted')
  })

  /** A standing ruling names no leaf, so it is never confused with one that does. */
  it('does not mistake a standing ruling for one on a leaf', () => {
    const standing: Ruling = { ...kept, pageIndex: null }
    expect(withRuling([kept], standing)).toHaveLength(2)
  })
})
