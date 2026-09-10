import { describe, it, expect } from 'vitest'
import {
  queryQuestions,
  queryKey,
  rulingsFromAnswers,
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
