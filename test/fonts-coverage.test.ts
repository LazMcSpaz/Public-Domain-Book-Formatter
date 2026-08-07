/**
 * The rule the ligature comment in `fonts.ts` is really about, enforced over
 * every face the app can set a book in.
 *
 * **No feature may be left on that can produce a glyph no code point reaches.**
 *
 * pdf-lib's whole-font embedder builds the PDF's width array by walking the
 * font's *character set* and taking the glyph each code point maps to. A glyph
 * arrived at any other way — an `f_i` ligature, or Junicode's contextual `f.rf`
 * — is in that array nowhere, so the reader falls back to the default width of
 * a full em. On paper that is a gaping hole mid-word and every following word
 * shoved right.
 *
 * This was written down twice as a comment about ligatures and still missed the
 * second cause, because `calt` is not a ligature feature and nothing failed
 * until a face that uses it was added. So the test asserts the *property*
 * rather than a list of feature tags: a new face, or a new feature, has to
 * satisfy it without anyone remembering this file exists.
 *
 * Faces are read off disk, like `layout-pdf.test.ts`, so this runs in plain
 * Node — `fonts.ts` itself reaches for `fetch` and Vite's `?url` imports.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import fontkit from '@pdf-lib/fontkit'
import { LAYOUT_FEATURES } from '@platform/browser/fonts'

const G = 'node_modules/@expo-google-fonts'

/** Every face the app ships, matching `FONT_URLS` + `JUNICODE_URLS`. */
const FACES: Record<string, string> = {
  'EB Garamond|regular': `${G}/eb-garamond/400Regular/EBGaramond_400Regular.ttf`,
  'EB Garamond|italic': `${G}/eb-garamond/400Regular_Italic/EBGaramond_400Regular_Italic.ttf`,
  'Cardo|regular': `${G}/cardo/400Regular/Cardo_400Regular.ttf`,
  'Cardo|italic': `${G}/cardo/400Regular_Italic/Cardo_400Regular_Italic.ttf`,
  'IM FELL English|regular': `${G}/im-fell-english/400Regular/IMFellEnglish_400Regular.ttf`,
  'IM FELL English|italic': `${G}/im-fell-english/400Regular_Italic/IMFellEnglish_400Regular_Italic.ttf`,
  'Libre Baskerville|regular': `${G}/libre-baskerville/400Regular/LibreBaskerville_400Regular.ttf`,
  'Libre Baskerville|italic': `${G}/libre-baskerville/400Regular_Italic/LibreBaskerville_400Regular_Italic.ttf`,
  'Libre Caslon Text|regular': `${G}/libre-caslon-text/400Regular/LibreCaslonText_400Regular.ttf`,
  'Libre Caslon Text|italic': `${G}/libre-caslon-text/400Regular_Italic/LibreCaslonText_400Regular_Italic.ttf`,
  'Crimson Pro|regular': `${G}/crimson-pro/400Regular/CrimsonPro_400Regular.ttf`,
  'Crimson Pro|italic': `${G}/crimson-pro/400Regular_Italic/CrimsonPro_400Regular_Italic.ttf`,
  'Junicode|regular': 'public/fonts/junicode/Junicode-Regular.otf',
  'Junicode|italic': 'public/fonts/junicode/Junicode-Italic.otf'
}

/**
 * Prose chosen to provoke every substitution a book face has an opinion about:
 * the f-pairs that drive both ligatures and contextual alternates, an f at a
 * word end and a word start, the long-s this app exists for, and a few of the
 * marks a scan of an old book actually contains.
 */
const PROVOCATION =
  'difference of a gentle fire, the offices affixed to fluffy stuff, ' +
  'a fjord of five fifths, ﬁrst ﬂight, ſtill the ſame, ' +
  'Chapter II — “quoth he,” said Æthelred’s wife; 1st ½ Th ct st'

/** Glyphs pdf-lib can write a width for: those some code point maps to. */
function reachable(font: ReturnType<typeof fontkit.create>): Set<number> {
  const ids = new Set<number>()
  for (const codePoint of font.characterSet) {
    const glyph = font.glyphForCodePoint(codePoint)
    if (glyph) ids.add(glyph.id)
  }
  return ids
}

describe('every shipped face, under the features the app actually lays out with', () => {
  for (const [name, path] of Object.entries(FACES)) {
    it(`${name} produces no glyph pdf-lib cannot write a width for`, () => {
      const font = fontkit.create(new Uint8Array(readFileSync(path)))
      const ids = reachable(font)

      const orphans = font
        .layout(PROVOCATION, LAYOUT_FEATURES)
        .glyphs.filter((g) => !ids.has(g.id))
        .map((g) => g.name ?? String(g.id))

      // Named, not counted: the glyph name says which feature to turn off.
      expect([...new Set(orphans)]).toEqual([])
    })
  }
})

describe('the test can actually fail', () => {
  /**
   * A guard on the guard. Every assertion above passes trivially if the
   * provocation text stopped provoking anything, or if `reachable` quietly
   * returned every glyph in the font. Turning the features back on has to break
   * it — otherwise the suite above is decoration.
   */
  it('catches the orphans when the features are left on', () => {
    const font = fontkit.create(new Uint8Array(readFileSync(FACES['Junicode|regular']!)))
    const ids = reachable(font)
    const orphans = font
      .layout(PROVOCATION, {})
      .glyphs.filter((g) => !ids.has(g.id))
      .map((g) => g.name)

    expect(orphans.length).toBeGreaterThan(0)
    // The two that put "the dif f erence" on a previewed page.
    expect(orphans).toContain('f.rf')
    expect(orphans).toContain('i.lf')
  })
})
