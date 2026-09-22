import { describe, it, expect } from 'vitest'
import {
  queryQuestions,
  queryKey,
  rulingsFromAnswers,
  approveHeld,
  heldPending,
  type RaisedQuery,
  type Ruling
} from '@core/queries'
import { defaultAnswers, missingRequired, groupQuestions, type Answers } from '@core/wizard'

const query = (over: Partial<RaisedQuery> = {}): RaisedQuery => ({
  pageIndex: 170,
  quote: 'It is not the spirits of heaven',
  kind: 'printers-error',
  why: 'The compositor closes the nested quotation and forgets the enclosing one.',
  ...over
})

describe('the queries, as a gate', () => {
  it('asks one group per query still waiting', () => {
    const qs = queryQuestions([query({ pageIndex: 12 }), query({ pageIndex: 99 })], [])
    expect(groupQuestions(qs)).toHaveLength(2)
  })

  it('shows the passage as printed, and the reason it is hard', () => {
    const [decision] = queryQuestions([query()], [])
    expect(decision!.evidence).toContainEqual({
      kind: 'text',
      text: 'It is not the spirits of heaven',
      label: 'As printed'
    })
    expect(decision!.help).toContain('forgets the enclosing one')
  })

  /**
   * The whole design, and the editor ruled on it directly. Every other question
   * in this app arrives with the recommended answer chosen; this one must not,
   * because a suggestion beside a question is an answer in all but name and
   * `EditorialQuery` is forbidden a proposed fix for that exact reason.
   *
   * The test is "nothing is seeded", not "the default is empty": a default of
   * `''` would seed an answer, and an answer that exists is one a later reader
   * of the state cannot tell from a decision.
   */
  it('chooses nothing for the editor', () => {
    const qs = queryQuestions([query()], [])
    const key = queryKey(query())
    expect(defaultAnswers(qs)[`${key}-decision`]).toBeUndefined()
  })

  /**
   * The other half of the same promise, and a trap the first version walked
   * into. Marking the decision `required` reads as "you must choose before this
   * counts"; what it governs is the *step*, so seventy-nine required questions
   * is a gate that cannot be left until all seventy-nine are settled — the
   * exact opposite of the partial work this gate exists to keep.
   */
  it('lets the editor leave one undecided and come back to it', () => {
    const qs = queryQuestions([query(), query({ pageIndex: 99, quote: 'another' })], [])
    expect(missingRequired(qs, defaultAnswers(qs))).toEqual([])
  })

  /** A wording may be offered, but only as text to type over. */
  it('offers a suggested wording as a placeholder and never as an answer', () => {
    const key = queryKey(query())
    const qs = queryQuestions([query()], [], { suggestions: { [key]: 'the mended reading' } })
    const correction = qs.find((q) => q.id === `${key}-correction`)!
    expect(correction.type).toBe('text')
    expect(correction.type === 'text' && correction.placeholder).toBe('the mended reading')
    expect(defaultAnswers(qs)[`${key}-correction`]).toBe('')
  })

  it('drops a query the editor has already ruled on', () => {
    const ruled: Ruling = {
      pageIndex: 170,
      quote: 'It is not the spirits of heaven',
      kind: 'printers-error',
      decision: 'as-printed',
      decidedOn: '2026-09-10'
    }
    expect(queryQuestions([query()], [ruled])).toEqual([])
  })
})

describe('what a sitting at the gate produced', () => {
  const answer = (key: string, over: Answers = {}): Answers => ({
    [`${key}-decision`]: 'as-printed',
    [`${key}-correction`]: '',
    [`${key}-because`]: 'The sheet stands.',
    ...over
  })

  it('files the ruling the editor gave', () => {
    const key = queryKey(query())
    const [ruling] = rulingsFromAnswers([query()], answer(key), '2026-09-10')
    expect(ruling).toMatchObject({
      pageIndex: 170,
      quote: 'It is not the spirits of heaven',
      kind: 'printers-error',
      decision: 'as-printed',
      because: 'The sheet stands.',
      decidedOn: '2026-09-10'
    })
    expect(ruling).not.toHaveProperty('correction')
  })

  /**
   * Closing the tab half way through must leave the rest waiting. Filing a
   * blank screen as a ruling would settle a question nobody looked at, and
   * `as-printed` is exactly the value a blank would read as — the posture that
   * needs no defence, quietly applied to thirty passages unseen.
   */
  it('produces nothing for a query the editor never reached', () => {
    const a = query({ pageIndex: 12, quote: 'answered' })
    const b = query({ pageIndex: 99, quote: 'never reached' })
    const out = rulingsFromAnswers([a, b], answer(queryKey(a)), '2026-09-10')
    expect(out.map((r) => r.quote)).toEqual(['answered'])
  })

  /**
   * The one combination that would quietly do nothing. A `corrected` ruling
   * with no wording cannot be applied, so `unapplied()` would report it
   * outstanding for good — a check crying wolf — while the query itself looked
   * settled. Dropping it leaves the query waiting, which is true.
   */
  it('refuses a correction with nothing to correct it to', () => {
    const key = queryKey(query())
    const out = rulingsFromAnswers(
      [query()],
      answer(key, { [`${key}-decision`]: 'corrected', [`${key}-correction`]: '   ' }),
      '2026-09-10'
    )
    expect(out).toEqual([])
  })

  it('carries the wording when there is one', () => {
    const key = queryKey(query())
    const [ruling] = rulingsFromAnswers(
      [query()],
      answer(key, {
        [`${key}-decision`]: 'corrected',
        [`${key}-correction`]: '  the mended reading  '
      }),
      '2026-09-10'
    )
    expect(ruling!.decision).toBe('corrected')
    expect(ruling!.correction).toBe('the mended reading')
  })

  it('leaves the reason off rather than filing an empty one', () => {
    const key = queryKey(query())
    const [ruling] = rulingsFromAnswers(
      [query()],
      answer(key, { [`${key}-because`]: '  ' }),
      '2026-09-10'
    )
    expect(ruling).not.toHaveProperty('because')
  })
})

/**
 * The editor's ruling on standing rulings: *pre-filled and held*. A query a
 * standing ruling reaches arrives with the decision filled in and is filed
 * only when a person approves it — never applied unasked.
 */
describe('a query under a standing ruling', () => {
  const standing: Ruling = {
    pageIndex: null,
    quote: 'practiced / practised',
    kind: 'inconsistent',
    decision: 'as-printed',
    covers: ['practiced', 'practised'],
    because: 'Both were current in 1877.',
    decidedOn: '2026-09-10'
  }
  const q = query({ pageIndex: 76, quote: 'mankind practiced deception', kind: 'inconsistent' })
  const key = queryKey(q)

  it('is still asked, with the standing ruling’s decision held on the question', () => {
    const qs = queryQuestions([q], [standing])
    const decision = qs.find((x) => x.id === `${key}-decision`)!
    expect(decision.held).toEqual({
      value: 'as-printed',
      why: 'Pre-filled under the standing ruling “practiced / practised” (2026-09-10): Both were current in 1877.'
    })
    const because = qs.find((x) => x.id === `${key}-because`)!
    expect(because.held?.value).toBe(
      'Under the standing ruling “practiced / practised” (2026-09-10): Both were current in 1877.'
    )
  })

  /**
   * The one property the whole design rests on. Reinstate the fault — put the
   * held value on `defaultValue` — and this fails, because a seeded answer
   * files on the next press of Next with nobody having looked.
   */
  it('seeds nothing: a held answer is not an answer until approved', () => {
    const qs = queryQuestions([q], [standing])
    const seeded = defaultAnswers(qs)
    expect(seeded[`${key}-decision`]).toBeUndefined()
    expect(rulingsFromAnswers([q], seeded, '2026-09-21')).toEqual([])
    expect(heldPending(qs, seeded)).toBe(1)
  })

  it('approving files it as an ordinary ruling that names where it came from', () => {
    const qs = queryQuestions([q], [standing])
    const approved = approveHeld(qs, defaultAnswers(qs))
    expect(heldPending(qs, approved)).toBe(0)
    const [ruling] = rulingsFromAnswers([q], approved, '2026-09-21')
    expect(ruling).toMatchObject({
      pageIndex: 76,
      quote: 'mankind practiced deception',
      decision: 'as-printed',
      because:
        'Under the standing ruling “practiced / practised” (2026-09-10): Both were current in 1877.',
      decidedOn: '2026-09-21'
    })
  })

  it('approving all never overwrites an answer the editor already gave', () => {
    const qs = queryQuestions([q], [standing])
    const mine = {
      ...defaultAnswers(qs),
      [`${key}-decision`]: 'noted',
      [`${key}-because`]: 'Not this one.'
    }
    const approved = approveHeld(qs, mine)
    expect(approved[`${key}-decision`]).toBe('noted')
    expect(approved[`${key}-because`]).toBe('Not this one.')
  })

  it('a corrected standing ruling holds its wording on the correction too', () => {
    const fix: Ruling = { ...standing, decision: 'corrected', correction: 'practised' }
    const qs = queryQuestions([q], [fix])
    expect(qs.find((x) => x.id === `${key}-correction`)!.held?.value).toBe('practised')
    expect(defaultAnswers(qs)[`${key}-correction`]).toBe('')
  })

  it('a query with no standing ruling over it holds nothing', () => {
    const qs = queryQuestions([query()], [standing])
    expect(qs.every((x) => x.held === undefined)).toBe(true)
    expect(heldPending(qs, {})).toBe(0)
  })
})
