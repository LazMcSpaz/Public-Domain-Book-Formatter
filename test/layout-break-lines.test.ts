import { describe, it, expect } from 'vitest'
import {
  breakParagraph,
  englishHyphenator,
  fixedWidthMeasurer,
  itemsFromText,
  type BreakParagraphOptions
} from '@core/layout'

const FONT = { family: 'Test', style: 'regular' } as const

/**
 * One character is exactly one point wide at 1pt. Every assertion below is then
 * arithmetic about the engine rather than a fact about EB Garamond — which is
 * the whole point of the `TextMeasurer` seam.
 */
const measurer = fixedWidthMeasurer(1)

function options(over: Partial<BreakParagraphOptions> = {}): BreakParagraphOptions {
  return {
    font: FONT,
    sizePt: 1,
    measurer,
    lineWidths: 15,
    alignment: 'justify',
    ...over
  }
}

const textOf = (line: { words: { text: string }[] }): string =>
  line.words.map((w) => w.text).join(' ')

describe('itemsFromText — the boxes, glue and penalties Knuth–Plass consumes', () => {
  it('models words as boxes and spaces as stretchable glue', () => {
    const items = itemsFromText('aa bb', options())
    expect(items.map((i) => i.type)).toEqual(['box', 'glue', 'box', 'glue', 'penalty'])
    const glue = items[1]
    expect(glue).toMatchObject({ type: 'glue', width: 1 })
    if (glue.type === 'glue') {
      expect(glue.stretch).toBeGreaterThan(0)
      expect(glue.shrink).toBeGreaterThan(0)
    }
  })

  it('ends the paragraph with free-stretching glue and a forced break', () => {
    const items = itemsFromText('aa bb', options())
    const fill = items[items.length - 2]
    const stop = items[items.length - 1]
    // Without these the last line would be stretched to the full measure.
    expect(fill.type).toBe('glue')
    if (fill.type === 'glue') expect(fill.stretch).toBeGreaterThan(1000)
    expect(stop.type).toBe('penalty')
    if (stop.type === 'penalty') expect(stop.cost).toBeLessThanOrEqual(-1000)
  })

  it('models a first-line indent as an empty box, not as glue', () => {
    // Glue could be stretched or broken at; an indent must be neither.
    const items = itemsFromText('aa bb', options({ firstLineIndentPt: 3 }))
    expect(items[0]).toEqual({ type: 'box', width: 3, text: '' })
  })

  it('keeps spaces rigid when the paragraph is set ragged', () => {
    const ragged = itemsFromText('aa bb', options({ alignment: 'left' }))
    const glue = ragged[1]
    expect(glue.type).toBe('glue')
    if (glue.type === 'glue') expect(glue.shrink).toBe(0)
  })

  it('offers a hyphenation point as a flagged penalty carrying the hyphen width', () => {
    const items = itemsFromText('chirurgeon', options({ hyphenate: () => ['chirur', 'geon'] }))
    const penalty = items.find((i) => i.type === 'penalty' && i.width > 0)
    expect(penalty).toMatchObject({ type: 'penalty', width: 1, flagged: true })
  })
})

describe('breakParagraph', () => {
  it('justifies a line to exactly the measure', () => {
    const lines = breakParagraph('aaa bbb ccc ddd eee fff ggg hhh', options())
    const first = lines[0]!
    expect(textOf(first)).toBe('aaa bbb ccc ddd')
    // Four 3-wide words in a 15-wide measure: the three spaces take 1pt each.
    expect(first.words.map((w) => w.xPt)).toEqual([0, 4, 8, 12])
  })

  it('does not stretch the last line of a paragraph', () => {
    const lines = breakParagraph('aaa bbb ccc ddd eee', options())
    const last = lines[lines.length - 1]!
    expect(textOf(last)).toBe('eee')
    expect(last.words[0]!.xPt).toBe(0)
  })

  it('centres a line within its measure', () => {
    const lines = breakParagraph('aaaa', options({ alignment: 'center', lineWidths: 10 }))
    // A 4-wide word in a 10-wide measure sits 3pt in from each side.
    expect(lines[0]!.words[0]!.xPt).toBe(3)
  })

  it('draws a hyphen only where the break was actually taken', () => {
    const lines = breakParagraph(
      'aaaaaa bbbbbbbbbbbb',
      options({
        lineWidths: 8,
        hyphenate: (w) => (w === 'bbbbbbbbbbbb' ? ['bbbbbb', 'bbbbbb'] : [w])
      })
    )
    const hyphenated = lines.filter((l) => l.hyphenated)
    expect(hyphenated.length).toBe(1)
    expect(textOf(hyphenated[0]!).endsWith('-')).toBe(true)
    // …and nowhere else: the fragments that stayed together are one word again.
    expect(lines.some((l) => !l.hyphenated && textOf(l).includes('-'))).toBe(false)
  })

  it('rejoins hyphenation fragments into whole words when the break is not taken', () => {
    const lines = breakParagraph(
      'chirurgeon',
      options({
        lineWidths: 40,
        hyphenate: () => ['chi', 'rur', 'geon']
      })
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]!.words).toHaveLength(1)
    expect(lines[0]!.words[0]!.text).toBe('chirurgeon')
  })

  it('honours per-line widths, which is what makes a drop cap possible', () => {
    // Three short lines beside the initial, then the full measure.
    const lines = breakParagraph(
      'aa bb cc dd ee ff gg hh ii jj kk ll',
      options({
        lineWidths: [5, 5, 5, 20]
      })
    )
    expect(lines[0]!.widthPt).toBe(5)
    expect(lines[3]!.widthPt).toBe(20)
    expect(textOf(lines[0]!)).toBe('aa bb')
  })

  it('does not silently truncate when the width array is shorter than the paragraph', () => {
    // `breakLines` reads lineLengths[i] per line and does not clamp, so a short
    // array used to lose every line past its end. Regression guard: this
    // paragraph is far longer than the two widths given.
    const words = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')
    const lines = breakParagraph(words, options({ lineWidths: [10, 20] }))
    const recovered = lines.flatMap((l) => l.words.map((w) => w.text))
    expect(recovered).toEqual(words.split(' '))
  })

  it('returns nothing for empty or whitespace-only text', () => {
    expect(breakParagraph('', options())).toEqual([])
    expect(breakParagraph('   \n  ', options())).toEqual([])
  })

  it('sets an unbreakable word rather than throwing', () => {
    // A word wider than the measure has no legal break. Loose is acceptable;
    // a crash at the design gate is not.
    const lines = breakParagraph('aaaaaaaaaaaaaaaaaaaaaaaaaaaa', options({ lineWidths: 5 }))
    expect(lines.length).toBeGreaterThan(0)
  })
})

describe('englishHyphenator', () => {
  it('finds TeX-quality break points', () => {
    const hyphenate = englishHyphenator()
    expect(hyphenate('chirurgeon')).toEqual(['chirur', 'geon'])
    expect(hyphenate('extraordinary').join('-')).toBe('ex-tra-or-di-nary')
  })

  it('leaves words with no legal break point alone', () => {
    expect(englishHyphenator()('the')).toEqual(['the'])
  })
})
