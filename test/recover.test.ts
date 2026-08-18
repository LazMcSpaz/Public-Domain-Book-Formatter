import { describe, it, expect } from 'vitest'
import {
  findDroppedRuns,
  spliceRun,
  spliceRunInto,
  spotId,
  type DroppedRun
} from '@core/transcribe'
import type { OcrWordLike } from '@core/transcribe'
import { defaultAnswers, initialState, stepById, type WizardState } from '@core/wizard'

/** OCR words from a sentence, all read confidently unless said otherwise. */
function ocr(text: string, confidence = 92): OcrWordLike[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({ text: word, confidence }))
}

const PAGE =
  'The astral and the physical bodies are invariably connected by means of a sort of cord, ' +
  'or cable, along which vital currents pass. Should this cord be severed, death instantly ' +
  'results. The only difference between astral projection and death is that the cord is ' +
  'intact in the former case, and severed in the latter.'

/**
 * The existing check compares the two texts as sets, so it can say "fourteen
 * words are absent" and nothing else — leaving the user an alarming number and
 * one remedy that costs money. Both texts are right there.
 */
describe('finding what was dropped', () => {
  it('recovers a clause dropped from the middle of a page', () => {
    const dropped = 'Should this cord be severed, death instantly results.'
    const transcription = PAGE.replace(` ${dropped}`, '')

    const [run] = findDroppedRuns(transcription, ocr(PAGE))
    expect(run).toBeDefined()
    expect(run!.text).toContain('Should this cord be severed')
    expect(run!.words.length).toBeGreaterThanOrEqual(7)
  })

  it('says where it belongs, in words the transcription actually contains', () => {
    const dropped = 'Should this cord be severed, death instantly results.'
    const transcription = PAGE.replace(` ${dropped}`, '')

    const [run] = findDroppedRuns(transcription, ocr(PAGE))
    // The anchor has to be findable in the text, or the run cannot be put back
    // where it came from.
    expect(transcription).toContain(run!.after)
    expect(transcription).toContain(run!.before)
  })

  it('recovers a tail dropped off the end of the page', () => {
    const transcription = PAGE.slice(0, PAGE.indexOf('The only difference'))
    const [run] = findDroppedRuns(transcription, ocr(PAGE))
    expect(run!.text).toContain('The only difference between astral projection')
  })

  it('finds two separate gaps as two runs, not one', () => {
    const transcription = PAGE.replace(
      ' Should this cord be severed, death instantly results.',
      ''
    ).replace(' intact in the former case, and severed in the latter.', '')
    const runs = findDroppedRuns(transcription, ocr(PAGE))
    expect(runs.length).toBe(2)
  })

  it('says nothing when the transcription has everything', () => {
    expect(findDroppedRuns(PAGE, ocr(PAGE))).toEqual([])
  })

  it('ignores a single word, which is usually OCR seeing things', () => {
    // Being asked about one word a hundred times is how a review stops being
    // read at all.
    const transcription = PAGE.replace(' invariably', '')
    expect(findDroppedRuns(transcription, ocr(PAGE))).toEqual([])
  })

  it('will not offer a run OCR was unsure about', () => {
    const dropped = 'Should this cord be severed, death instantly results.'
    const transcription = PAGE.replace(` ${dropped}`, '')
    const words = ocr(PAGE).map((w) => (dropped.includes(w.text) ? { ...w, confidence: 30 } : w))
    expect(findDroppedRuns(transcription, words)).toEqual([])
  })

  it('carries the confidence, so a garbled run can be seen for what it is', () => {
    const dropped = 'Should this cord be severed, death instantly results.'
    const transcription = PAGE.replace(` ${dropped}`, '')
    const [run] = findDroppedRuns(transcription, ocr(PAGE, 78))
    expect(run!.confidence).toBe(78)
  })

  it('is not upset by words OCR missed that the transcription has', () => {
    // OCR is the noisier reader — that is the whole reason the vision pass
    // exists — so its own omissions must not register as drops.
    const partial = ocr(PAGE).filter((_, i) => i % 7 !== 0)
    expect(findDroppedRuns(PAGE, partial)).toEqual([])
  })

  it('does not let a repeated word swallow the gap between its occurrences', () => {
    const text = 'the cord is one thing and the cord is another thing entirely here'
    const transcription = 'the cord is another thing entirely here'
    const runs = findDroppedRuns(transcription, ocr(text), { minWords: 3 })
    expect(runs.length).toBeGreaterThan(0)
  })
})

describe('putting a run back', () => {
  const run: DroppedRun = {
    words: ['Should', 'this', 'cord', 'be', 'severed.'],
    text: 'Should this cord be severed.',
    confidence: 90,
    tokenIds: [],
    strength: 'strong',
    after: 'along which vital currents pass.',
    before: 'The only difference'
  }

  it('splices it in after the words it followed, not at the end', () => {
    const block =
      'connected by a cord, along which vital currents pass. The only difference is that'
    const fixed = spliceRun(block, run)
    expect(fixed).toBe(
      'connected by a cord, along which vital currents pass. Should this cord be severed. The only difference is that'
    )
  })

  it('hands back null when the anchor is not in this block, so the caller tries the next', () => {
    expect(spliceRun('a completely different paragraph', run)).toBeNull()
  })

  it('puts a run dropped from the very start at the front', () => {
    const opening = { ...run, after: '' }
    expect(spliceRun('the rest of it', opening)).toBe('Should this cord be severed. the rest of it')
  })
})

/**
 * The gate used to report a *count* of missing words and offer one remedy that
 * costs money. Both texts are in hand, so the words themselves can be shown and
 * put back for nothing.
 */
describe('the gate offers the text back', () => {
  const run: DroppedRun = {
    words: ['Should', 'this', 'cord', 'be', 'severed.'],
    text: 'Should this cord be severed.',
    confidence: 90,
    tokenIds: [],
    strength: 'strong',
    after: 'vital currents pass.',
    before: 'The only difference'
  }

  const ready = (droppedRuns: WizardState['droppedRuns']): WizardState => ({
    ...initialState(),
    completed: ['intake', 'recon', 'gate-identity', 'transcribe'],
    findings: [
      {
        code: 'confident-word-missing',
        severity: 'medium',
        pageIndex: 16,
        message: '14 words OCR read clearly are absent from the transcription.'
      }
    ],
    pageText: { 16: 'connected by a cord, along which vital currents pass. The only difference' },
    droppedRuns
  })

  const question = (state: WizardState) =>
    stepById('gate-uncertainties')
      .questions(state)
      .find((q) => q.id === 'page-16')

  /** The gaps question for the same leaf. */
  const gaps = (state: WizardState) =>
    stepById('gate-uncertainties')
      .questions(state)
      .find((q) => q.id === 'page-16-gaps')

  it('shows the missing words themselves, not a count of them', () => {
    const q = gaps(ready({ 16: [run] }))
    expect(q?.type).toBe('discrepancies')
    const rows = q && 'rows' in q ? q.rows : []
    expect(rows.some((r) => 'text' in r && r.text.includes('Should this cord be severed'))).toBe(
      true
    )
  })

  it('says where it goes and how sure OCR was', () => {
    const q = gaps(ready({ 16: [run] }))
    const rows = q && 'rows' in q ? q.rows : []
    const row = rows[0] as { confidence: number; after: string } | undefined
    expect(row?.confidence).toBe(90)
    expect(row?.after).toContain('vital currents pass.')
  })

  /**
   * The change this describe block exists to pin down.
   *
   * The leaf used to carry one blanket "put the missing text back" covering
   * every gap on it, pre-selected. That is the wrong shape twice over: a leaf
   * with eighteen disagreements almost never wants all or none of them, and
   * OCR — the rougher of the two readers — should never be copied over a paid
   * transcription by a default nobody chose.
   */
  it('no longer offers one blanket restore for the whole leaf', () => {
    const q = question(ready({ 16: [run] }))
    const values = q && 'options' in q ? q.options.map((o) => String(o.value)) : []
    expect(values).not.toContain('restore')
    expect(q && 'defaultValue' in q ? q.defaultValue : '').toBe('accept')
  })

  it('pre-selects nothing, so no gap is filled from OCR unasked', () => {
    const q = gaps(ready({ 16: [run] }))
    expect(q ? defaultAnswers([q])[q.id] : null).toEqual({})
  })

  it('carries the word ids, so the gate can show the pixels', () => {
    const q = gaps(ready({ 16: [{ ...run, tokenIds: ['p16_w4', 'p16_w5'] }] }))
    const rows = q && 'rows' in q ? q.rows : []
    expect((rows[0] as { tokenIds: string[] }).tokenIds).toEqual(['p16_w4', 'p16_w5'])
  })

  it('asks nothing when there is nothing to put back', () => {
    expect(gaps(ready({}))).toBeUndefined()
    const q = question(ready({}))
    expect(q && 'defaultValue' in q ? q.defaultValue : '').toBe('accept')
  })
})

describe('spliceRunInto — putting a clause back without losing the italics', () => {
  const run = (after: string, text = 'and of the fixed salt'): DroppedRun => ({
    words: text.split(' '),
    tokenIds: [],
    strength: 'strong',
    text,
    confidence: 90,
    after,
    before: ''
  })

  it('moves emphasis that sits after the join, and leaves the rest alone', () => {
    // Five words go in after word 2. The italic must stay on `alembick`.
    const out = spliceRunInto('Of the alembick being set upon a fire', [2], run('the alembick'))!
    expect(out.text).toBe('Of the alembick and of the fixed salt being set upon a fire')
    expect(out.emphasis).toEqual([2])
  })

  it('shifts emphasis that the inserted words pushed along', () => {
    const out = spliceRunInto('Of the alembick being set upon a fire', [5], run('the alembick'))!
    // `upon` was word 5; five words went in ahead of it.
    expect(out.text.split(' ')[5 + 5]).toBe('upon')
    expect(out.emphasis).toEqual([10])
  })

  it('shifts everything when the clause goes at the very front', () => {
    const out = spliceRunInto('the alembick being set', [1], { ...run(''), text: 'Of these two' })!
    expect(out.text).toBe('Of these two the alembick being set')
    expect(out.emphasis).toEqual([4])
    expect(out.text.split(' ')[4]).toBe('alembick')
  })

  it('says so when the anchor is in another block', () => {
    expect(spliceRunInto('nothing like it here', [], run('the alembick'))).toBeNull()
  })

  it('is what spliceRun is built from, so the two can never disagree', () => {
    const text = 'Of the alembick being set upon a fire'
    expect(spliceRun(text, run('the alembick'))).toBe(
      spliceRunInto(text, undefined, run('the alembick'))!.text
    )
  })
})

/**
 * A verdict has to name the spot it is about, not the row number it sat on.
 *
 * The first scheme was `p9d2` — page nine, third disagreement. That list is
 * recomputed from the transcription and the OCR every time a book is opened,
 * and anything that changes the comparison changes its length: healing
 * hyphenated line breaks removed rows, and every stored verdict past a removed
 * row landed on a different one. On a real book that put a note reading "the
 * word is hyphenated across the line" under a crop of `1s that of`, which is
 * the app describing a picture it is not looking at — the exact failure the
 * whole gate exists to prevent.
 */
describe('the name a verdict is filed under', () => {
  const run = (text: string, after: string, before = ''): DroppedRun => ({
    words: text.split(' '),
    text,
    tokenIds: [],
    strength: 'strong',
    confidence: 90,
    after,
    before
  })

  it('is unchanged when rows ahead of it disappear', () => {
    // The regression, stated as the property that prevents it: the same spot,
    // once third in the list and now first, is still the same spot.
    const spot = run('and of the fixed salt', 'the alembick', 'being set')
    const beforeHealing = [run('pro', 'a'), run('ceed', 'b'), spot]
    const afterHealing = [spot]
    expect(spotId(9, beforeHealing[2]!)).toBe(spotId(9, afterHealing[0]!))
  })

  it('tells two spots on a leaf apart by the words either side of them', () => {
    const a = run('salt', 'the alembick')
    const b = run('salt', 'a gentle fire')
    expect(spotId(9, a)).not.toBe(spotId(9, b))
  })

  it('keeps leaves apart, so a verdict cannot cross pages', () => {
    const spot = run('salt', 'the alembick')
    expect(spotId(9, spot)).not.toBe(spotId(10, spot))
  })

  it('ignores what the alignment ignores — case and punctuation', () => {
    // Two readings of the same spot that differ only in a comma are the same
    // spot, and a verdict bought for one answers the other.
    expect(spotId(3, run('the fixed salt,', 'Of THE alembick'))).toBe(
      spotId(3, run('the Fixed salt', 'of the alembick'))
    )
  })

  it('is not the old positional name, so storage can tell them apart', () => {
    // `spotsFromStored` drops the old scheme on sight. That is only possible
    // while the two shapes cannot be confused for one another.
    expect(spotId(9, run('salt', 'the alembick'))).not.toMatch(/^p\d+d\d+$/)
  })
})
