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

  it('changes only the word that differs, so a run the phrase reaches into is untouched', () => {
    // "the astral" reaches into the italic run, but only "the" changes:
    // "astral" and "body" keep their italics. An unmarked replacement cannot
    // tell "make this roman" from "I did not type the tags", so it never
    // strips a run it did not change.
    const { text } = sweepText('the <i>astral body</i>', 'the astral', 'an astral')
    const block = asBlock(text)
    expect(block.text).toBe('an astral body')
    expect(block.emphasis).toEqual([1, 2])
  })

  it('the mirror case: the changed word is outside the run and the run stays whole', () => {
    const { text } = sweepText('<i>the astral</i> body', 'astral body', 'astral form')
    const block = asBlock(text)
    expect(block.text).toBe('the astral form')
    expect(block.emphasis).toEqual([0, 1])
  })

  it('a run wholly inside the phrase keeps its marking through the change', () => {
    const { text } = sweepText('read <i>this</i> now', 'read this now', 'read that now')
    expect(asBlock(text).text).toBe('read that now')
    expect(asBlock(text).emphasis).toEqual([1])
  })

  it('still re-balances when the changed characters themselves cross a run edge', () => {
    // Nothing is shared at either end here, so the whole match is spliced and
    // the <i> it swallowed is re-opened after it, keeping "body" italic.
    const { text } = sweepText('the <i>astral body</i>', 'the astral', 'one ethereal')
    const block = asBlock(text)
    expect(block.text).toBe('one ethereal body')
    expect(block.emphasis).toEqual([2])
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

describe('accent folding in find', () => {
  it('finds an accented word from a search typed without the accent, and the reverse', () => {
    const markup = '<b>Purânas</b> and the Puranas and <i>Neïth</i>'
    expect(findMatches(markup, 'puranas').map((m) => m.at)).toHaveLength(2)
    expect(findMatches(markup, 'Purânas').map((m) => m.at)).toHaveLength(2)
    expect(findMatches(markup, 'neith')).toHaveLength(1)
  })

  it('keeps every offset where it was, because the fold preserves length', () => {
    const markup = 'Bhûmi is the earth; Bhumi again'
    const [first, second] = findMatches(markup, 'bhumi')
    expect(first?.at).toBe(0)
    expect(second?.at).toBe('Bhûmi is the earth; '.length)
  })

  it('still respects match-case, which does not fold', () => {
    expect(findMatches('Purânas', 'puranas', true)).toHaveLength(0)
    expect(findMatches('Purânas', 'Purânas', true)).toHaveLength(1)
  })
})

describe('sweepText keeps the runs a phrase spans', () => {
  it('a stop added after an italic tag stays inside the run, and the bold headword survives', () => {
    const text = '<b>Lakshmi</b> <i>(Sk.)</i> “ Prosperity ”, fortune'
    const { text: out, count } = sweepText(
      text,
      'Lakshmi (Sk.) “ Prosperity ”',
      'Lakshmi (Sk.). “ Prosperity ”'
    )
    expect(count).toBe(1)
    expect(out).toBe('<b>Lakshmi</b> <i>(Sk.).</i> “ Prosperity ”, fortune')
  })

  it('a letter changed inside a phrase leaves the runs either side of it', () => {
    const text = '<b>Kriyasakti</b> <i>(Gk.).</i> The power'
    const { text: out } = sweepText(text, 'Kriyasakti (Gk.).', 'Kriyasakti (Sk.).')
    expect(out).toBe('<b>Kriyasakti</b> <i>(Sk.).</i> The power')
  })

  it('a deletion inside an italic run keeps the run', () => {
    const text = '<b>Mutham</b> or <i>Mattam. (Sk.).</i> Temples'
    const { text: out } = sweepText(text, 'Mattam. (Sk.).', 'Mattam (Sk.).')
    expect(out).toBe('<b>Mutham</b> or <i>Mattam (Sk.).</i> Temples')
  })

  it('a whole-word replacement still re-balances a crossed run', () => {
    const { text: out } = sweepText('the <i>astral body</i> is', 'the astral', 'an astral')
    expect(out).toBe('an <i>astral body</i> is')
  })

  it('a change inside a word is spliced as the whole word, so no tag lands mid-word', () => {
    const { text: out } = sweepText(
      'to the <i>Bodhisvattvas</i> and',
      'Bodhisvattvas',
      'Bodhisattvas'
    )
    expect(out).toBe('to the <i>Bodhisattvas</i> and')
    const { text: two } = sweepText('An’ancient <i>King</i>', 'An’ancient King', 'An ancient King')
    expect(two).toBe('An ancient <i>King</i>')
  })
})
