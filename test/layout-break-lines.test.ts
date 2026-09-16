import { describe, it, expect } from 'vitest'
import {
  breakParagraph,
  breakVerse,
  englishHyphenator,
  fixedWidthMeasurer,
  itemsFromText,
  type BreakParagraphOptions,
  type FontRef
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
    expect(items[0]).toEqual({ type: 'box', width: 3, text: '', source: -1 })
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

/**
 * `cross-legged` came out as "cross--" at the margin. The hyphenator hands back
 * `["cross-", "legged"]` — the compound's own hyphen, not a discretionary one —
 * and the breaker added a second of its own on top of it.
 */
describe('a compound breaks at its own hyphen without gaining another', () => {
  const measurer = fixedWidthMeasurer(0.5)
  const font: FontRef = { family: 'EB Garamond', style: 'regular' }

  /** Every line's text, with the drawn hyphen included as the breaker set it. */
  const setAt = (text: string, widthPt: number): string[] =>
    breakParagraph(text, {
      font,
      sizePt: 10,
      measurer,
      lineWidths: widthPt,
      alignment: 'justify',
      hyphenate: (word) => (word === 'cross-legged' ? ['cross-', 'legged'] : [word])
      // The line breaker draws the mark itself; `words` carries it.
    }).map((line) => line.words.map((w) => w.text).join(''))

  it('draws no second hyphen where the word already has one', () => {
    const lines = setAt('A swami sits cross-legged upon it', 65)
    const joined = lines.join('|')
    expect(joined).toContain('cross-')
    expect(joined).not.toContain('cross--')
  })

  it('still draws one where the break is the hyphenator’s own', () => {
    const lines = breakParagraph('an extraordinary thing', {
      font,
      sizePt: 10,
      measurer,
      lineWidths: 55,
      alignment: 'justify',
      hyphenate: (word) => (word === 'extraordinary' ? ['extra', 'ordinary'] : [word])
    }).map((line) => line.words.map((w) => w.text).join(''))
    expect(lines.join('|')).toContain('extra-')
  })
})

describe('a figure set below the line', () => {
  const formula = (over: Partial<BreakParagraphOptions> = {}) =>
    itemsFromText(
      'Na2CO3 means soda',
      options({
        subscripts: [
          { from: 2, to: 3 },
          { from: 5, to: 6 }
        ],
        ...over
      })
    )

  it('cuts the word into its letters and its figures', () => {
    const boxes = formula()
      .filter((i) => i.type === 'box')
      .map((i) => ('text' in i ? i.text : ''))
    expect(boxes.slice(0, 4)).toEqual(['Na', '2', 'CO', '3'])
  })

  it('sets the figures smaller and below the baseline, and the letters neither', () => {
    const boxes = formula()
      .filter((i) => i.type === 'box')
      .map((i) => i as unknown as { text: string; sizePt?: number; risePt?: number })
    const [na, two, co, three] = boxes
    expect(na!.sizePt).toBeUndefined()
    expect(co!.sizePt).toBeUndefined()
    // 0.53 of the type, measured off the 1877 page.
    expect(two!.sizePt).toBeCloseTo(0.53, 5)
    expect(three!.sizePt).toBeCloseTo(0.53, 5)
    // Below, not above: a positive rise is what a footnote's mark uses.
    expect(two!.risePt).toBeLessThan(0)
    // 0.286 of a cap height, and the stub's capital is 0.7 of the em.
    expect(two!.risePt).toBeCloseTo(-0.7 * 0.286, 5)
  })

  it('measures the figures at their own size, so the line is not set too long', () => {
    // One character each at 1pt: the plain letters are 2 + 2, the figures are
    // 0.53 each. A breaker that measured them as full size would make the word
    // 6pt and every line carrying it fractionally too long.
    const width = formula()
      .filter((i) => i.type === 'box')
      .slice(0, 4)
      .reduce((sum, i) => sum + i.width, 0)
    expect(width).toBeCloseTo(2 + 0.53 + 2 + 0.53, 5)
  })

  it('never hyphenates a formula, whatever the hyphenator would do to it', () => {
    const boxes = formula({ hyphenate: englishHyphenator() })
      .filter((i) => i.type === 'box')
      .map((i) => ('text' in i ? i.text : ''))
    expect(boxes.slice(0, 4)).toEqual(['Na', '2', 'CO', '3'])
    // And the words that are not formulae are still hyphenated normally.
    expect(boxes.length).toBeGreaterThan(4)
  })

  it('leaves the figures as runs of their own rather than fusing them back', () => {
    // The merge rule re-joins hyphenation fragments of one word. If it fused a
    // formula's pieces the figures would be drawn as body text at body size.
    const line = breakParagraph(
      'Na2CO3',
      options({
        lineWidths: 40,
        subscripts: [
          { from: 2, to: 3 },
          { from: 5, to: 6 }
        ]
      })
    )[0]!
    expect(line.words.map((w) => w.text)).toEqual(['Na', '2', 'CO', '3'])
    expect(line.words[1]!.risePt).toBeLessThan(0)
    expect(line.words[2]!.risePt).toBeFalsy()
  })

  it('does nothing at all to a paragraph that has no formula in it', () => {
    const plain = itemsFromText('Na2CO3 means soda', options())
    const boxes = plain.filter((i) => i.type === 'box').map((i) => ('text' in i ? i.text : ''))
    expect(boxes[0]).toBe('Na2CO3')
  })
})

describe('breakVerse — the lines the poem actually has', () => {
  const POEM = 'The lights burn blue\nCold fearful drops\nMethought the souls'

  const lineTexts = (lines: { words: { text: string }[] }[]) =>
    lines.map((l) => l.words.map((w) => w.text).join(' '))

  it('sets one line per line, where a paragraph would have run them together', () => {
    // Wide enough that a reflowing breaker would fit the whole poem on one line.
    const wide = options({ lineWidths: 200, alignment: 'left' })
    expect(lineTexts(breakVerse(POEM, wide))).toEqual([
      'The lights burn blue',
      'Cold fearful drops',
      'Methought the souls'
    ])
    expect(lineTexts(breakParagraph(POEM, wide))).toEqual([
      'The lights burn blue Cold fearful drops Methought the souls'
    ])
  })

  it('keeps a stanza break as a line with nothing on it', () => {
    const lines = breakVerse('one two\n\nthree four', options({ lineWidths: 200 }))
    expect(lineTexts(lines)).toEqual(['one two', '', 'three four'])
  })

  it('still wraps a line too long for the measure', () => {
    // One point a character, so 'aaaa bbbb cccc' is 14 against a measure of 9.
    const lines = breakVerse('aaaa bbbb cccc\ndd', options({ lineWidths: 9, alignment: 'left' }))
    expect(lineTexts(lines)).toEqual(['aaaa bbbb', 'cccc', 'dd'])
  })

  it('numbers its lines straight through, as one block', () => {
    expect(breakVerse(POEM, options({ lineWidths: 200 })).map((l) => l.index)).toEqual([0, 1, 2])
  })

  it('re-indexes the words back onto the whole block, so a span still finds them', () => {
    // The last line's words are 7, 8 and 9 of the block and 0, 1 and 2 of
    // their own line. Downstream reads the block's index, so that is what has
    // to come back — unshifted, they would name 'blue', 'Cold' and 'fearful'.
    const lines = breakVerse(POEM, options({ lineWidths: 200 }))
    expect(lines[2]!.words.map((w) => w.sourceIndex)).toEqual([7, 8, 9])
    expect(lines[0]!.words.map((w) => w.sourceIndex)).toEqual([0, 1, 2, 3])
  })

  it('measures each line with the face that line is actually set in', () => {
    // The breaker has to know a line's italics or its length is wrong — and
    // the spans are indexed against the *block*, so slicing them per line is
    // the part that can go wrong silently.
    const wide = fixedWidthMeasurer(1)
    const italicIsWider = {
      ...wide,
      widthOf: (t: string, f: { style: string }, size: number) =>
        wide.widthOf(t, f as never, size) * (f.style === 'italic' ? 4 : 1)
    }
    const spans = [
      { words: new Set([7, 8, 9]), font: { family: 'Test', style: 'italic' as const } }
    ]
    const lines = breakVerse(
      POEM,
      options({ lineWidths: 30, alignment: 'left', measurer: italicIsWider as never, spans })
    )
    // The first two lines fit; the italic third is four times as wide and must
    // wrap. A breaker that handed every line the block's own span set — or
    // none of it — would not split exactly here.
    expect(lineTexts(lines).slice(0, 2)).toEqual(['The lights burn blue', 'Cold fearful drops'])
    expect(lineTexts(lines).length).toBeGreaterThan(3)
  })

  it('gives a line only the reference marks that belong to it', () => {
    const lines = breakVerse(
      POEM,
      options({
        lineWidths: 200,
        attachments: [{ wordIndex: 8, text: '*', sizePt: 0.6, risePt: 0.3 }]
      })
    )
    expect(lines[0]!.words.some((w) => w.text === '*')).toBe(false)
    expect(lines[2]!.words.some((w) => w.text === '*')).toBe(true)
  })

  it('gives a line only the figures that belong to it', () => {
    // 'Na2CO3' on the second line: offsets 21..22 and 24..25 of the block.
    const text = 'the chemist\nNa2CO3 is soda'
    const lines = breakVerse(
      text,
      options({
        lineWidths: 200,
        subscripts: [
          { from: 14, to: 15 },
          { from: 17, to: 18 }
        ]
      })
    )
    expect(lineTexts(lines)[0]).toBe('the chemist')
    expect(lines[1]!.words.map((w) => w.text)).toEqual(['Na', '2', 'CO', '3', 'is', 'soda'])
    expect(lines[1]!.words[1]!.risePt).toBeLessThan(0)
  })
})
