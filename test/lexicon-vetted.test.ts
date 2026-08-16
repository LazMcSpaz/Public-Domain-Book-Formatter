import { describe, it, expect } from 'vitest'
import { applyTermCorrections, vetLexicon, type LexiconEntry } from '@core/lexicon'
import { buildLexiconBlock } from '@core/transcribe'

function entry(term: string, over: Partial<LexiconEntry> = {}): LexiconEntry {
  return {
    term,
    count: 10,
    meanConfidence: 70,
    pages: [1, 2],
    variants: [],
    signals: ['frequent-unknown'],
    impact: 10,
    sampleTokenId: `${term}-0`,
    ...over
  }
}

/**
 * Gate 1 asks for a verdict on each harvested term and promises, in its own
 * help text, that "confirming a word here fixes it everywhere in the book".
 * The answer used to be read by nothing: the raw harvest went to the model
 * under the heading "these spellings have been confirmed as correct for this
 * book", which was untrue of all of them and actively wrong for the ones the
 * user had just rejected.
 */
describe('vetLexicon — the verdicts finally count', () => {
  const lexicon = [entry('chirurgeon'), entry('alembick'), entry('rn0ther')]

  it('keeps an accepted term as vocabulary', () => {
    const { entries } = vetLexicon(lexicon, { chirurgeon: { action: 'accept' } })
    expect(entries.map((e) => e.term)).toContain('chirurgeon')
  })

  it('drops a rejected term instead of insisting on it', () => {
    // The verdict that was doing harm: `rn0ther` is OCR noise, and sending it
    // as confirmed vocabulary tells the model to reproduce the noise.
    const { entries, ignored } = vetLexicon(lexicon, { rn0ther: { action: 'ignore' } })
    expect(entries.map((e) => e.term)).not.toContain('rn0ther')
    expect(ignored).toEqual(['rn0ther'])
  })

  it('teaches the model the corrected spelling, not the misreading', () => {
    const { entries, corrections } = vetLexicon(lexicon, {
      rn0ther: { action: 'correct', text: 'mother' }
    })
    expect(entries.map((e) => e.term)).toContain('mother')
    expect(entries.map((e) => e.term)).not.toContain('rn0ther')
    expect(corrections).toEqual([{ from: 'rn0ther', to: 'mother' }])
  })

  it('drops the variants of a corrected term, which described the wrong word', () => {
    const withVariants = [entry('rn0ther', { variants: ['rn0thcr', 'm0ther'] })]
    const { entries } = vetLexicon(withVariants, {
      rn0ther: { action: 'correct', text: 'mother' }
    })
    expect(entries[0]!.variants).toEqual([])
  })

  it('treats an unanswered term as accepted', () => {
    // The grid defaults every row to accept, so silence and acceptance mean the
    // same thing. Reading silence as rejection would strip the vocabulary of
    // anyone who pressed continue.
    expect(vetLexicon(lexicon, {}).entries).toHaveLength(3)
  })

  it('ignores a correction that says nothing', () => {
    const { entries, corrections } = vetLexicon(lexicon, {
      chirurgeon: { action: 'correct', text: '   ' },
      alembick: { action: 'correct', text: 'alembick' }
    })
    expect(corrections).toEqual([])
    expect(entries).toHaveLength(3)
  })

  it('makes the prompt honest — what it calls confirmed now has been', () => {
    const { entries } = vetLexicon(lexicon, {
      rn0ther: { action: 'ignore' },
      alembick: { action: 'correct', text: 'alembic' }
    })
    const block = buildLexiconBlock(entries)
    expect(block).toContain('confirmed as correct')
    expect(block).toContain('chirurgeon')
    expect(block).toContain('alembic')
    expect(block).not.toContain('rn0ther')
  })
})

describe('applyTermCorrections — the fix holds through the book', () => {
  const fix = [{ from: 'rn0ther', to: 'mother' }]

  it('replaces the misreading wherever it stands alone', () => {
    const { text, replaced } = applyTermCorrections('The rn0ther and her rn0ther.', fix)
    expect(text).toBe('The mother and her mother.')
    expect(replaced).toBe(2)
  })

  it('follows it into a possessive', () => {
    // Apostrophes are boundaries, which is what makes the commonest shape a
    // term takes in prose — the possessive — correctable.
    expect(applyTermCorrections('her rn0ther’s hand', fix).text).toBe('her mother’s hand')
  })

  it('leaves a longer word that merely contains it alone', () => {
    // The failure a plain substring swap would cause, on every page.
    const { text, replaced } = applyTermCorrections('the rn0therly care', fix)
    expect(text).toBe('the rn0therly care')
    expect(replaced).toBe(0)
  })

  it('follows the case at the start of a sentence', () => {
    // Otherwise a corrected word opens a sentence in lower case.
    expect(applyTermCorrections('Rn0ther knew. The rn0ther knew.', fix).text).toBe(
      'Mother knew. The mother knew.'
    )
  })

  it('does nothing, and allocates nothing, when there is nothing to do', () => {
    const original = 'The alembick being set upon a gentle fire.'
    const { text, replaced } = applyTermCorrections(original, [])
    expect(text).toBe(original)
    expect(replaced).toBe(0)
  })

  it('applies several corrections in one pass', () => {
    const { text } = applyTermCorrections('The rn0ther held the alembick.', [
      { from: 'rn0ther', to: 'mother' },
      { from: 'alembick', to: 'alembic' }
    ])
    expect(text).toBe('The mother held the alembic.')
  })
})
