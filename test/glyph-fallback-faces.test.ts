import { readFileSync } from 'node:fs'
import fontkit from '@pdf-lib/fontkit'
import { describe, expect, it } from 'vitest'
import { GLYPH_FALLBACK_FAMILY, faceRuns, type FontRef } from '@core/layout'

/**
 * The engine's fallback is tested against a made-up face in
 * glyph-fallback.test.ts. This holds it against the real faces the house look
 * sets: Libre Caslon Text has no Hebrew and almost no Greek, and Cardo, the
 * fallback, has every letter and mark of both in all three of its styles, so
 * a pointed Hebrew word or a polytonic Greek one comes out of `faceRuns` whole
 * in Cardo and never as a row of boxes. Faces are read off disk, as in
 * fonts-coverage.test.ts.
 */
const G = 'node_modules/@expo-google-fonts'
const FILES: Record<string, string> = {
  'Libre Caslon Text|regular': `${G}/libre-caslon-text/400Regular/LibreCaslonText_400Regular.ttf`,
  'Libre Caslon Text|italic': `${G}/libre-caslon-text/400Regular_Italic/LibreCaslonText_400Regular_Italic.ttf`,
  'Cardo|regular': `${G}/cardo/400Regular/Cardo_400Regular.ttf`,
  'Cardo|italic': `${G}/cardo/400Regular_Italic/Cardo_400Regular_Italic.ttf`,
  'Cardo|bold': `${G}/cardo/700Bold/Cardo_700Bold.ttf`
}
type Face = { hasGlyphForCodePoint(codePoint: number): boolean }
const faces = new Map<string, Face>(
  Object.entries(FILES).map(([key, path]) => [
    key,
    fontkit.create(new Uint8Array(readFileSync(path))) as unknown as Face
  ])
)
const hasGlyph = (font: FontRef, codePoint: number): boolean =>
  faces.get(`${font.family}|${font.style}`)?.hasGlyphForCodePoint(codePoint) ?? true

/** Pointed Hebrew and polytonic Greek, of the kinds these books quote. */
const WORDS = ['שָׁלוֹם', 'אֱלֹהִים', 'יהוה', 'ἀρχῇ', 'ψυχή', 'ᾠδή', 'Ἰησοῦς', 'λόγος', 'ὕδωρ']
const letters = [...new Set(WORDS.join(''))]

describe('Hebrew and Greek in the house look', () => {
  it('the house face lacks them, so the fallback is what prints them', () => {
    const caslon = faces.get('Libre Caslon Text|regular')!
    const lacking = letters.filter((ch) => !caslon.hasGlyphForCodePoint(ch.codePointAt(0)!))
    expect(lacking.length).toBeGreaterThan(letters.length / 2)
  })

  it('Cardo draws every letter and mark of them, in every style it has', () => {
    for (const style of ['regular', 'italic', 'bold']) {
      const cardo = faces.get(`${GLYPH_FALLBACK_FAMILY}|${style}`)!
      const missing = letters.filter((ch) => !cardo.hasGlyphForCodePoint(ch.codePointAt(0)!))
      expect(missing, style).toEqual([])
    }
  })

  it('each word is set whole in Cardo, in the style it was asked in', () => {
    for (const style of ['regular', 'italic'] as const) {
      const book: FontRef = { family: 'Libre Caslon Text', style }
      for (const word of WORDS) {
        const runs = faceRuns(word, 0, undefined, book, hasGlyph)
        expect(runs, `${word} ${style}`).toEqual([
          { from: 0, to: word.length, font: { family: GLYPH_FALLBACK_FAMILY, style }, scale: 1 }
        ])
      }
    }
  })
})
