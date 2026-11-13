import { describe, it, expect } from 'vitest'
import {
  breakParagraph,
  cachedMeasurer,
  faceRuns,
  fixedWidthMeasurer,
  GLYPH_FALLBACK_FAMILY,
  visualOrder,
  type FontRef,
  type TextMeasurer
} from '@core/layout'

/**
 * _The Theosophical Glossary_ is set in Libre Caslon Text, which has no Greek
 * and no Hebrew, and every Greek word it quotes printed as a row of empty
 * boxes. These tests stand a Latin-only face beside a fallback that has the
 * Greek, the Hebrew and the combining marks, and one symbol no face has.
 */
const BOOK: FontRef = { family: 'Book', style: 'regular' }
const ITALIC: FontRef = { family: 'Book', style: 'italic' }
const SYMBOL = '△'

function measurerWithGlyphs(): TextMeasurer {
  const base = fixedWidthMeasurer(1)
  return {
    ...base,
    hasGlyph(font, codePoint) {
      const ch = String.fromCodePoint(codePoint)
      if (ch === SYMBOL) return false
      if (font.family === GLYPH_FALLBACK_FAMILY) return true
      // The book face: Latin letters, digits and ordinary pointing, and one
      // Greek letter, the mu Libre Caslon carries for the micro sign's sake.
      return codePoint < 0x0300 || ch === 'μ'
    }
  }
}

const has = measurerWithGlyphs().hasGlyph!

describe('a character the book face cannot draw', () => {
  it('is set in the fallback face, in the same style', () => {
    const runs = faceRuns('μάντεις', 0, undefined, BOOK, has)
    expect(runs).toEqual([
      { from: 0, to: 7, font: { family: GLYPH_FALLBACK_FAMILY, style: 'regular' }, scale: 1 }
    ])
    const italic = faceRuns('βαπτίζω', 0, [{ words: new Set([0]), font: ITALIC }], BOOK, has)
    expect(italic?.map((r) => r.font)).toEqual([{ family: GLYPH_FALLBACK_FAMILY, style: 'italic' }])
  })

  it('leaves the letters the book face has in the book face', () => {
    // `Chandramaṇam`: one letter of a bold headword that Libre Caslon's bold lacks.
    const runs = faceRuns('Chandramaṇam', 0, undefined, BOOK, has)
    expect(runs?.map((r) => ['Chandramaṇam'.slice(r.from, r.to), r.font.family])).toEqual([
      ['Chandrama', 'Book'],
      ['ṇ', GLYPH_FALLBACK_FAMILY],
      ['am', 'Book']
    ])
  })

  it('carries a combining mark with its letter, so the mark sits on it', () => {
    // `(F̄)`: a dash over the letter, the Glossary's leaf 121.
    const word = '(F̄)'
    const runs = faceRuns(word, 0, undefined, BOOK, has)
    expect(runs?.map((r) => [word.slice(r.from, r.to), r.font.family])).toEqual([
      ['(', 'Book'],
      ['F̄', GLYPH_FALLBACK_FAMILY],
      [')', 'Book']
    ])
  })

  it('stays put when no face can draw it, for the writer to report', () => {
    const runs = faceRuns(`three ${SYMBOL}`.split(' ')[1]!, 0, undefined, BOOK, has)
    expect(runs).toEqual([{ from: 0, to: 1, font: BOOK, scale: 1 }])
  })

  it('changes nothing for a word the book face can draw', () => {
    expect(faceRuns('Kosmos', 0, undefined, BOOK, has)).toBeNull()
    // And nothing at all when the measurer cannot say.
    expect(faceRuns('μάντεις', 0, undefined, BOOK)).toBeNull()
  })
})

describe('a word in another script stays in one face', () => {
  it('takes the letter the book face happens to have along with the rest', () => {
    // `δαιμονια`, the Glossary's p. 335: Libre Caslon has the mu and nothing
    // else of the alphabet, and printed one letter of six in its own face.
    const runs = faceRuns('δαιμονια', 0, undefined, BOOK, has)
    expect(runs?.map((r) => r.font.family)).toEqual([GLYPH_FALLBACK_FAMILY])
  })

  it('leaves the mu alone where nothing else in the word needed the fallback', () => {
    expect(faceRuns('μ', 0, undefined, BOOK, has)).toBeNull()
  })
})

describe('a word written right to left', () => {
  it('is drawn with its letters in the order they print', () => {
    // The table of the Ineffable Name, leaf 329: the 1892 page sets the yod
    // at the right of every row.
    expect(visualOrder('יהוה')).toBe('הוהי')
    expect(visualOrder('יה')).toBe('הי')
    expect(visualOrder('(יהו),')).toBe('(והי),')
  })

  it('leaves a word that mixes scripts, and every other word, as it is', () => {
    expect(visualOrder('thus—א.')).toBe('thus—א.')
    expect(visualOrder('μάντεις')).toBe('μάντεις')
    expect(visualOrder('Kosmos')).toBe('Kosmos')
  })

  it('reaches the page so', () => {
    const lines = breakParagraph('the name יהוה here', {
      font: BOOK,
      sizePt: 1,
      measurer: cachedMeasurer(measurerWithGlyphs()),
      lineWidths: 100,
      alignment: 'left'
    })
    expect(lines.flatMap((l) => l.words).map((w) => w.text)).toContain('הוהי')
  })
})

describe('through the measurer every export uses', () => {
  it('reaches the fallback past the cache, and draws each stretch in its face', () => {
    // `cachedMeasurer` wraps every real layout; a wrapper that dropped the
    // glyph question made the engine believe the face could draw everything.
    const lines = breakParagraph('the Greek βαπτίζω here', {
      font: BOOK,
      sizePt: 1,
      measurer: cachedMeasurer(measurerWithGlyphs()),
      lineWidths: 100,
      alignment: 'left'
    })
    const words = lines.flatMap((l) => l.words)
    const greek = words.find((w) => w.text === 'βαπτίζω')
    expect(greek?.font).toEqual({ family: GLYPH_FALLBACK_FAMILY, style: 'regular' })
    expect(words.find((w) => w.text === 'Greek')?.font ?? BOOK).toEqual(BOOK)
  })
})
