import { describe, it, expect } from 'vitest'
import { checkEmphasis } from '@core/coherence'
import type { BookBlock, BookDocument } from '@core/assemble'
import { parseInlineMarkup } from '@core/transcribe/markup'

/** A block written with `<i>` tags, stored as the engine stores it. */
function block(id: string, marked: string, pages = [0]): BookBlock {
  const m = parseInlineMarkup(marked)
  return {
    id,
    kind: 'paragraph',
    text: m.text,
    sourcePages: pages,
    ...(m.emphasis.length ? { emphasis: m.emphasis } : {})
  }
}

function doc(blocks: BookBlock[]): BookDocument {
  return {
    blocks,
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  }
}

describe('italic the paper prints and the book sets roman', () => {
  it('reports a run set in roman, through the slips of the witness’s own OCR', () => {
    const d = doc([
      block(
        'p3b0',
        'The following table, copied from Hellenbach’s Magie der Zahlen, exhibits this law.',
        [3]
      )
    ])
    const r = checkEmphasis(d, [{ page: 3, text: 'Magie der Zahleu,' }])
    expect(r.dropped.map((f) => f.found)).toEqual(['Magie der Zahlen'])
    expect(r.dropped[0]!.blockId).toBe('p3b0')
  })

  it('agrees where the book already sets it in italic', () => {
    const d = doc([
      block('p3b0', 'copied from Hellenbach’s <i>Magie der Zahlen</i>, exhibits', [3])
    ])
    const r = checkEmphasis(d, [{ page: 3, text: 'Magie der Zahlen,' }])
    expect(r.dropped).toEqual([])
    expect(r.agreed).toBe(1)
  })

  it('looks only on the run’s own leaf', () => {
    const d = doc([block('p9b0', 'copied from Hellenbach’s Magie der Zahlen, exhibits', [9])])
    const r = checkEmphasis(d, [{ page: 3, text: 'Magie der Zahlen' }])
    expect(r.dropped).toEqual([])
    expect(r.unplaced).toBe(1)
  })

  it('widens a slipped match to whole words', () => {
    const d = doc([block('p3b0', 'the process is wholly unconscious in the plant', [3])])
    // OCR lost the first letter: the tag must still go round the whole word.
    const r = checkEmphasis(d, [{ page: 3, text: 'nconscious' }])
    expect(r.dropped.map((f) => f.found)).toEqual(['unconscious'])
  })

  it('places a short run by the words read either side of it, and only that one', () => {
    const text =
      'all men know it, each bearing a close analogy in all their properties to the next, in all.'
    const d = doc([block('p3b0', text, [3])])
    const r = checkEmphasis(d, [
      {
        page: 3,
        text: 'all',
        before: 'bearing a close analogy in',
        after: 'their properties to the'
      }
    ])
    expect(r.dropped).toHaveLength(1)
    expect(text.slice(r.dropped[0]!.start, r.dropped[0]!.end)).toBe('all')
    expect(r.dropped[0]!.start).toBe(text.indexOf('all their'))
  })

  it('says nothing of a run that matches twice and has no context to choose', () => {
    const d = doc([block('p3b0', 'the seven rays and again the seven rays', [3])])
    const r = checkEmphasis(d, [{ page: 3, text: 'seven rays' }])
    expect(r.dropped).toEqual([])
    expect(r.ambiguous).toBe(1)
  })

  it('never places a single letter, which is a folio’s p. on every leaf', () => {
    const d = doc([block('p3b0', 'animal into man (p. 85), we need only add', [3])])
    const r = checkEmphasis(d, [
      { page: 3, text: 'p.', before: 'into man (', after: '85), we need' }
    ])
    expect(r.dropped).toEqual([])
  })

  it('refuses a short run its context placed on a word that is not it', () => {
    // The context matches loosely, so it lands where `The` would sit; the
    // page there says `A`, and a tag must not go on it.
    const d = doc([
      block(
        'p3b0',
        'Evil was the servant of the good. A reading of the tiles has now shown it',
        [3]
      )
    ])
    const r = checkEmphasis(d, [
      {
        page: 3,
        text: 'The',
        before: 'the servant of the good.',
        after: 'reading of the tiles has'
      }
    ])
    expect(r.dropped).toEqual([])
  })

  it('is never placed inside a longer word', () => {
    // A running head the book does not print, matched as letters inside a
    // word of the text: `PART` in `particular`, on Vol. II of The Structure
    // of Magic.
    const d = doc([block('p3b0', 'you experienced seeing a particular color or movement', [3])])
    const r = checkEmphasis(d, [{ page: 3, text: 'PART' }])
    expect(r.dropped).toEqual([])
    expect(r.unplaced).toBe(1)
  })

  it('is not placed by its context on words that do not spell it', () => {
    const d = doc([
      block(
        'p3b0',
        'his voice drops at the end of the sentence. Say the following two sentences',
        [3]
      ),
      block('p3b1', 'the sentence, say the words, in a corner of the room', [3])
    ])
    const r = checkEmphasis(d, [
      { page: 3, text: 'PART', before: 'end of the sentence.', after: 'following two' }
    ])
    expect(r.dropped).toEqual([])
  })

  it('takes the best match on the leaf, not the best in each block', () => {
    const d = doc([
      block('p3b0', 'the gods were imprisoned or incarnated', [3]),
      block('p3b1', 'the gods were imprisonment of thought', [3])
    ])
    const r = checkEmphasis(d, [{ page: 3, text: 'imprisoned' }])
    expect(r.dropped.map((f) => [f.blockId, f.found])).toEqual([['p3b0', 'imprisoned']])
  })
})
