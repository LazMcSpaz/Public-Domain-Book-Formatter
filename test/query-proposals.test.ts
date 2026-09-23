import { describe, it, expect } from 'vitest'
import {
  MAX_PROPOSALS,
  proposalsFor,
  proposalValue,
  queryQuestions,
  queryKey,
  rulingsFromAnswers,
  usableProposals,
  type QueryProposal,
  type RaisedQuery
} from '@core/queries'
import { defaultAnswers, type Answers, type ChoiceQuestion, type Question } from '@core/wizard'

/**
 * The decision question, narrowed. `Question` is a union and only the choice
 * arm has `options`, so every assertion about what the editor is offered has
 * to go through here rather than through a cast at each site.
 */
const choice = (qs: readonly Question[]): ChoiceQuestion => {
  const first = qs[0]
  if (!first || first.type !== 'choice') throw new Error('the first question is not a choice')
  return first
}
import { CURRENT_SCHEMA_VERSION, migrateSavedRun, mergeBatchIntoRun } from '@core/project'

const query = (over: Partial<RaisedQuery> = {}): RaisedQuery => ({
  pageIndex: 170,
  quote: 'Augiras',
  kind: 'printers-error',
  why: 'The next entry spells the same sage Angiras.',
  ...over
})

const proposal = (over: Partial<QueryProposal> = {}): QueryProposal => ({
  pageIndex: 170,
  quote: 'Augiras',
  decision: 'corrected',
  correction: 'Angiras',
  because: 'The entry two lines down spells it Angiras, and so does the 1892 index.',
  by: 'the reading session',
  ...over
})

describe('what a proposal is matched against', () => {
  /**
   * The leaf alone is not enough, and the failure it causes is the expensive
   * kind: a leaf carrying two queries would offer each one the other's
   * answers, and the editor would file a correction against the wrong passage
   * with nothing on screen to say so.
   */
  it('matches on the leaf and the words, never the leaf alone', () => {
    const here = proposal()
    const elsewhere = proposal({ quote: 'Bardesanes', correction: 'Bardaisan' })
    expect(proposalsFor(query(), [here, elsewhere])).toEqual([here])
    expect(proposalsFor(query({ quote: 'Bardesanes' }), [here, elsewhere])).toEqual([elsewhere])
  })

  it('ignores a proposal made about the same words on another leaf', () => {
    expect(proposalsFor(query(), [proposal({ pageIndex: 171 })])).toEqual([])
  })

  it('shows at most three, because the fourth is below the fold on a phone', () => {
    const many = Array.from({ length: 6 }, (_, i) => proposal({ correction: `Angiras ${i}` }))
    expect(proposalsFor(query(), many)).toHaveLength(MAX_PROPOSALS)
  })
})

describe('the proposals that could be acted on', () => {
  it('drops a correction with no wording, which would file nothing', () => {
    expect(usableProposals([proposal({ correction: '  ' })])).toEqual([])
  })

  it('drops one with no reasoning, which asks for trust rather than judgement', () => {
    expect(usableProposals([proposal({ because: '   ' })])).toEqual([])
  })

  it('keeps an as-printed proposal, which needs no wording', () => {
    const keep = proposal({ decision: 'as-printed', correction: undefined })
    expect(usableProposals([keep])).toEqual([keep])
  })
})

describe('the gate, with proposals to offer', () => {
  /**
   * The promise the whole module is built on, and the one a menu could quietly
   * break. `defaultAnswers` is what seeds the gate, so this asserts against
   * the thing that actually files answers rather than against the question's
   * shape.
   */
  it('selects none of them, so a press of Next files nothing', () => {
    const qs = queryQuestions([query()], [], { proposals: [proposal()] })
    const decision = choice(qs)
    expect(decision.defaultValue).toBeUndefined()
    expect(decision.held).toBeUndefined()
    expect(defaultAnswers(qs)[`${queryKey(query())}-decision`]).toBeUndefined()
  })

  /**
   * Without this a screen whose proposals are all wrong has no honest way
   * forward, which is the forbidden thing wearing a menu's clothes.
   */
  it('offers the three plain decisions underneath, always', () => {
    const qs = queryQuestions([query()], [], { proposals: [proposal()] })
    const values = choice(qs).options.map((o) => o.value)
    expect(values).toContain('as-printed')
    expect(values).toContain('corrected')
    expect(values).toContain('noted')
  })

  it('puts the proposals first, which is the tap the editor asked for', () => {
    const qs = queryQuestions([query()], [], { proposals: [proposal()] })
    expect(choice(qs).options[0]!.value).toBe(proposalValue(0))
  })

  it('says in full what choosing one would file', () => {
    const qs = queryQuestions([query()], [], { proposals: [proposal()] })
    const offered = choice(qs).options[0]!
    expect(offered.label).toContain('Angiras')
    expect(offered.description).toContain('1892 index')
  })

  it('asks exactly what it asked before when there are none', () => {
    const without = queryQuestions([query()], [])
    const withEmpty = queryQuestions([query()], [], { proposals: [] })
    expect(withEmpty).toEqual(without)
  })
})

describe('a proposal the editor picked', () => {
  const key = queryKey(query())
  const pick = (over: Answers = {}): Answers => ({ [`${key}-decision`]: proposalValue(0), ...over })

  it('files the decision, the wording and the reasoning', () => {
    const [ruling] = rulingsFromAnswers([query()], pick(), '2026-09-23', [proposal()])
    expect(ruling!.decision).toBe('corrected')
    expect(ruling!.correction).toBe('Angiras')
    expect(ruling!.because).toContain('1892 index')
  })

  /**
   * A ruling the editor reached unaided and one they accepted from a proposal
   * are different things to a reader auditing this edition later, and the
   * difference is invisible in the filed ruling unless it is written down.
   */
  it('records that it came from a proposal, and whose', () => {
    const [ruling] = rulingsFromAnswers([query()], pick(), '2026-09-23', [proposal()])
    expect(ruling!.because).toContain('the reading session')
  })

  it('lets a typed wording win over the proposal’s', () => {
    const answers = pick({ [`${key}-correction`]: 'Ángiras' })
    const [ruling] = rulingsFromAnswers([query()], answers, '2026-09-23', [proposal()])
    expect(ruling!.correction).toBe('Ángiras')
  })

  it('lets typed reasoning win, and still says where the decision came from', () => {
    const answers = pick({ [`${key}-because`]: 'Because the index agrees' })
    const [ruling] = rulingsFromAnswers([query()], answers, '2026-09-23', [proposal()])
    expect(ruling!.because).toContain('Because the index agrees')
    expect(ruling!.because).toContain('reading proposal')
  })

  /**
   * The options are built from `usableProposals`, so the answers have to be
   * read back through it too. Read the raw list instead and a dropped proposal
   * shifts every answer after it onto its neighbour — the editor taps the
   * second option and the first one's correction is filed.
   */
  it('means the option the editor saw, not the n-th raw proposal', () => {
    const dead = proposal({ correction: '', because: 'no wording, so it files nothing' })
    const real = proposal({ correction: 'Angiras', because: 'the index agrees' })
    const qs = queryQuestions([query()], [], { proposals: [dead, real] })
    const first = choice(qs).options[0]!
    expect(first.label).toContain('Angiras')
    const [ruling] = rulingsFromAnswers(
      [query()],
      { [`${key}-decision`]: first.value },
      '2026-09-23',
      [dead, real]
    )
    expect(ruling!.correction).toBe('Angiras')
  })

  it('files nothing for an option naming a proposal that is not there', () => {
    const answers = { [`${key}-decision`]: proposalValue(4) }
    expect(rulingsFromAnswers([query()], answers, '2026-09-23', [proposal()])).toEqual([])
  })

  it('still files a plain decision typed the old way', () => {
    const answers = { [`${key}-decision`]: 'as-printed' }
    const [ruling] = rulingsFromAnswers([query()], answers, '2026-09-23', [proposal()])
    expect(ruling!.decision).toBe('as-printed')
    expect(ruling!.correction).toBeUndefined()
    expect(ruling!.because ?? '').not.toContain('reading proposal')
  })
})

const leaf = (pageIndex: number) => ({
  pageIndex,
  role: 'body' as const,
  blocks: [],
  uncertain: [],
  furniture: {}
})

describe('proposals on the record', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    key: 'k',
    fileName: 'book.pdf',
    savedAt: '2026-09-23T00:00:00.000Z',
    pageCount: 2,
    leafCount: 2,
    transcriptions: [leaf(0)],
    failures: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    modelId: 'none',
    identityAnswers: {},
    edits: [],
    images: [],
    complete: true,
    adjudicated: {},
    facts: [],
    rulings: [],
    ...over
  })

  it('survives the round trip through the book file', () => {
    const restored = migrateSavedRun(run({ proposals: [proposal()] }))
    expect(restored.proposals).toHaveLength(1)
    expect(restored.proposals[0]!.correction).toBe('Angiras')
  })

  /**
   * A run written before proposals existed restores with none and behaves
   * exactly as it did, which is every query still asked the old way.
   */
  it('restores a v19 run with none rather than refusing it', () => {
    const restored = migrateSavedRun(run({ schemaVersion: 19 }))
    expect(restored.proposals).toEqual([])
  })

  /**
   * Stricter than `parseRulings`, and deliberately. A malformed ruling costs a
   * decision that has to be made again; a malformed proposal puts an option on
   * the editor's screen that does nothing when it is chosen.
   */
  it('drops a stored proposal that could not be acted on', () => {
    const bad = [
      { ...proposal(), correction: '' },
      { ...proposal(), because: '' },
      { ...proposal(), pageIndex: null },
      { ...proposal(), decision: 'ignored' }
    ]
    expect(migrateSavedRun(run({ proposals: bad })).proposals).toEqual([])
  })

  it('is carried across a batch merge rather than blanked', () => {
    const held = migrateSavedRun(run({ proposals: [proposal()] }))
    const merged = mergeBatchIntoRun({
      held,
      parsed: [leaf(1)],
      key: 'k',
      fileName: 'book.pdf',
      pageCount: 2,
      replace: false
    })
    expect(merged.init.proposals).toHaveLength(1)
  })
})
