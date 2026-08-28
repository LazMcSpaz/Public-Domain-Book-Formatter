import { describe, it, expect } from 'vitest'
import { findMatches, sweepText } from '@core/edits'
import { normalizeMarkup, type TranscribedBlock } from '@core/transcribe'

const asBlock = (text: string): TranscribedBlock =>
  normalizeMarkup<TranscribedBlock>({ kind: 'paragraph', text })

describe('findMatches — searching what a reader sees', () => {
  it('finds every occurrence, with context', () => {
    const hits = findMatches('The occulist met the occulist again.', 'occulist')
    expect(hits).toHaveLength(2)
    expect(hits[0]!.context).toContain('[occulist]')
  })

  it('reads through the tags: a phrase crossing an emphasis edge still matches', () => {
    expect(findMatches('the <i>astral body</i>', 'the astral')).toHaveLength(1)
    expect(findMatches('he <i>belleves</i> it', 'belleves')).toHaveLength(1)
  })

  it('is case-insensitive by default, exact when asked', () => {
    expect(findMatches('Astral, astral.', 'astral')).toHaveLength(2)
    expect(findMatches('Astral, astral.', 'astral', true)).toHaveLength(1)
  })

  it('does not count overlapping matches twice', () => {
    expect(findMatches('aaaa', 'aa')).toHaveLength(2)
  })
})

describe('sweepText — replacing without damaging the emphasis', () => {
  it('replaces every occurrence and says how many', () => {
    const { text, count } = sweepText('belleves and belleves', 'belleves', 'believes')
    expect(text).toBe('believes and believes')
    expect(count).toBe(2)
  })

  it('keeps the marking when the match sits inside a run', () => {
    const { text } = sweepText('he <i>belleves it</i>', 'belleves', 'believes')
    expect(text).toBe('he <i>believes it</i>')
    const block = asBlock(text)
    expect(block.text).toBe('he believes it')
    expect(block.emphasis).toEqual([1, 2])
  })

  it('re-balances a match that crosses a run edge, keeping the rest marked', () => {
    // "the astral" swallows the <i> that opens the run; without re-balancing,
    // "body" would silently lose its italics.
    const { text } = sweepText('the <i>astral body</i>', 'the astral', 'an astral')
    const block = asBlock(text)
    expect(block.text).toBe('an astral body')
    expect(block.emphasis).toEqual([2])
  })

  it('re-balances the mirror case, where the match swallows the closer', () => {
    const { text } = sweepText('<i>the astral</i> body', 'astral body', 'astral form')
    const block = asBlock(text)
    expect(block.text).toBe('the astral form')
    // "the" was italic before the match and stays italic after it — and
    // nothing new becomes italic, which is what the lenient parser would do
    // if the swallowed closer were simply dropped.
    expect(block.emphasis).toEqual([0])
  })

  it('cancels a run wholly inside the match rather than re-opening it', () => {
    const { text } = sweepText('read <i>this</i> now', 'read this now', 'read that now')
    expect(asBlock(text).text).toBe('read that now')
    // Omitted rather than stored empty — normalizeMarkup's convention.
    expect(asBlock(text).emphasis ?? []).toEqual([])
  })

  it('reads a marked replacement by the same convention as everywhere else', () => {
    const { text } = sweepText(
      'the corpus hermeticum',
      'corpus hermeticum',
      '<i>Corpus Hermeticum</i>'
    )
    const block = asBlock(text)
    expect(block.text).toBe('the Corpus Hermeticum')
    expect(block.emphasis).toEqual([1, 2])
  })

  it('does nothing for an empty query or an identity replacement', () => {
    expect(sweepText('text', '', 'x').count).toBe(0)
    expect(sweepText('text', 'text', 'text').count).toBe(0)
  })
})
