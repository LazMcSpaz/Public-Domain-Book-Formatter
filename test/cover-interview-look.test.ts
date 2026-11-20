/**
 * (Split from `cover-interview.test.ts` to keep each file short; shares its fixtures.)
 *
 * The cover interview.
 *
 * Asserts the app's own rules against the real question set: never ask what
 * isn't relevant yet, never ask what the app already knows, and never let an
 * answer that can spend money be given by accident.
 */
import { describe, expect, it } from 'vitest'
import {
  coverFromAnswers,
  defaultCover,
  lookQuestions,
  type CoverInterviewState
} from '@core/cover'

function state(patch: Partial<CoverInterviewState> = {}): CoverInterviewState {
  return {
    doc: defaultCover('6x9', 284),
    pageCountMeasured: true,
    bankedLooks: [],
    plates: [],
    ...patch
  }
}

/**
 * Every option a look question offers must change the look.
 *
 * The per-field transfer tests above each catch one dead reader, and they
 * only catch the fields somebody remembered to write a test for. Two banked
 * sizes were added to `CoverLook` and the suite stayed green with their
 * readers deleted, which is the same hole `frontTitleBorder` fell through:
 * answering a question with its own default proves nothing, because the
 * fallback is the value being described.
 *
 * So the property is stated once, over the whole question set: pick an option
 * that is *not* the default, answer with it alone, and require the look that
 * comes back to differ from the one that went in. A question whose answer is
 * read by nothing cannot pass it, whatever the field is called.
 */
describe('no look question is answered into nothing', () => {
  it('changes the look for every option on every look question', () => {
    const base = state()
    // A figure and a pattern are set so the conditional questions about them
    // are asked at all; a question that is not asked cannot be checked here.
    base.doc.look.groundFigure = 'all-seeing-eye-radiant'
    base.doc.look.groundPattern = 'laid'
    const before = defaultCover('6x9', 284)
    before.look = { ...base.doc.look }

    // A duplicate id is the same fault wearing a disguise: two questions under
    // one id means the first one's reader answers for both, so the second is
    // dead while every option still appears to change something. One was
    // shipped that way while this test was being written.
    const ids = lookQuestions(base).map((q) => q.id)
    expect(ids).toEqual([...new Set(ids)])

    const dead: string[] = []
    for (const question of lookQuestions(base)) {
      if (question.type !== 'choice') continue
      for (const option of question.options) {
        if (option.value === question.defaultValue) continue
        const after = coverFromAnswers(before, { [question.id]: option.value })
        // Key by key, never `JSON.stringify` of the whole look: the reader
        // builds a fresh object literal, so its key order need not match the
        // one `defaultLook` produced, and two equal looks then stringify
        // differently. The first version of this test compared the strings,
        // never matched, and passed against every fault it was written for.
        const changed = (Object.keys(before.look) as (keyof typeof before.look)[]).some(
          (key) => JSON.stringify(after.look[key]) !== JSON.stringify(before.look[key])
        )
        if (!changed) dead.push(`${question.id} = ${option.value || '(blank)'}`)
      }
    }
    expect(dead).toEqual([])
  })
})
