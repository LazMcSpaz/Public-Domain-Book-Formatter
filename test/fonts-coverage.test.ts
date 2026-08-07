/**
 * Every glyph the book prints gets a width — the invariant `font-widths.ts`
 * exists to hold.
 *
 * The failure it guards against is the worst kind this app has: silent
 * everywhere except the printed page. pdf-lib writes the PDF's width array from
 * the glyphs a *code point* reaches, so a ligature or a contextual alternate
 * gets no width and prints as a full em of white space, mid-word, with
 * everything after it shoved right. Nothing else catches it — the page count is
 * right, the KDP checks pass, the file opens.
 *
 * This was first written the other way round: assert that no such glyph is ever
 * produced, by keeping the features that make them switched off. That was the
 * old design and it cost every book its ligatures. Now the glyphs are expected,
 * and what is asserted is that each one arrives with a width.
 *
 * Faces are read off disk, like `layout-pdf.test.ts`, so this runs in plain
 * Node — `fonts.ts` itself reaches for `fetch` and Vite's `?url` imports.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument } from 'pdf-lib'
import { LAYOUT_FEATURES } from '@platform/browser/fonts'
import { verifyWidths, widenWidths } from '@platform/browser/font-widths'

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

async function embed(path: string) {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const bytes = new Uint8Array(readFileSync(path))
  const font = await doc.embedFont(bytes, { subset: false, features: LAYOUT_FEATURES })
  return { doc, font }
}

describe('every shipped face, under the features the app lays out with', () => {
  for (const [name, path] of Object.entries(FACES)) {
    it(`${name} prints no glyph without a width`, async () => {
      const { font } = await embed(path)
      widenWidths(font, [PROVOCATION])
      // Named, not counted: the glyph name says what went unmeasured.
      expect(verifyWidths(font, [PROVOCATION])).toEqual([])
    })
  }
})

describe('the check can actually fail', () => {
  /**
   * A guard on the guard. Every assertion above passes trivially if the
   * provocation stopped provoking, or if `verifyWidths` quietly returned
   * nothing. Skipping the widening has to break it — otherwise the suite above
   * is decoration.
   */
  it('reports the orphans when the widening is skipped', async () => {
    const { font } = await embed(FACES['Junicode|regular']!)
    const missing = verifyWidths(font, [PROVOCATION])
    expect(missing.length).toBeGreaterThan(0)
    // The two that put "the dif f erence" on a previewed page.
    expect(missing).toContain('f.rf')
    expect(missing).toContain('i.lf')
  })

  it('finds something to widen on a face with ligatures', async () => {
    const { font } = await embed(FACES['EB Garamond|regular']!)
    const added = widenWidths(font, [PROVOCATION]).added.map((g) => g.name)
    expect(added.length).toBeGreaterThan(0)
    expect(added.some((n) => n?.includes('_'))).toBe(true)
  })
})

describe('a font that ships a glyph it cannot measure', () => {
  /**
   * Crimson Pro's last glyph is named `NULL`, is mapped from U+0000, and its
   * outline record runs past the end of the font's own `glyf` table. fontkit
   * raises "Trying to access beyond buffer length" the moment anything asks how
   * wide it is — and pdf-lib asks, for every glyph in the width array, when the
   * file is saved.
   *
   * So every book set in Crimson Pro failed at the export gate, with a message
   * that named neither the font nor the glyph. It was found on a real book, not
   * by this suite, because nothing here had ever exported in that face.
   */
  const CRIMSON = FACES['Crimson Pro|regular']!

  it('is still broken upstream, so the workaround is still needed', () => {
    // Guards against the workaround outliving its cause: if a later
    // @expo-google-fonts ships a repaired file, this fails and the skipping
    // can go.
    const font = fontkit.create(new Uint8Array(readFileSync(CRIMSON)))
    const nul = font.glyphForCodePoint(0)
    expect(nul).toBeDefined()
    expect(() => nul!.advanceWidth).toThrow()
  })

  it('leaves the unmeasurable glyph out instead of refusing the book', async () => {
    const { font } = await embed(CRIMSON)
    const { dropped } = widenWidths(font, [PROVOCATION])
    expect(dropped.map((g) => g.name)).toContain('NULL')
  })

  it('saves a file, which is the whole point', async () => {
    const { doc, font } = await embed(CRIMSON)
    doc.addPage([600, 200]).drawText(PROVOCATION.slice(0, 80), { x: 20, y: 100, size: 12, font })
    widenWidths(font, [PROVOCATION])
    expect((await doc.save()).length).toBeGreaterThan(1000)
  })

  it('fails loudly if the book actually contained that character', async () => {
    // The skip is only safe because nothing prints U+0000. A book that somehow
    // did would be reported rather than quietly set with a hole — and note the
    // route: laying the text out is what raises, since positioning a glyph
    // reads its advance. `verifyWidths` turns that into a message.
    const { font } = await embed(CRIMSON)
    widenWidths(font, [PROVOCATION])
    const missing = verifyWidths(font, ['a\u0000b'])
    expect(missing).toHaveLength(1)
    expect(missing[0]).toContain('unsettable text')
  })
})

describe('what the reader and the screen reader get', () => {
  const TEXT = 'difference of a gentle fire, offices affixed'

  /** The width the font itself says that string is, which is the truth. */
  function trueWidth(path: string, sizePt: number): number {
    const f = fontkit.create(new Uint8Array(readFileSync(path)))
    let units = 0
    for (const g of f.layout(TEXT, LAYOUT_FEATURES).glyphs) units += g.advanceWidth
    return (units / f.unitsPerEm) * sizePt
  }

  async function render(path: string, widen: boolean) {
    const { doc, font } = await embed(path)
    doc.addPage([600, 200]).drawText(TEXT, { x: 20, y: 100, size: 18, font })
    if (widen) widenWidths(font, [TEXT])
    const bytes = await doc.save()

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const reopened = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise
    const items = (await (await reopened.getPage(1)).getTextContent()).items
    return {
      text: items.map((i) => ('str' in i ? i.str : '')).join(''),
      width: items[0] && 'width' in items[0] ? items[0].width : 0
    }
  }

  const PATH = FACES['EB Garamond|regular']!

  it('sets the line at the width the font says, not a guess', async () => {
    const widened = await render(PATH, true)
    expect(widened.width).toBeCloseTo(trueWidth(PATH, 18), 1)
  })

  it('was measurably wrong before, so the fix is doing something', async () => {
    const asIs = await render(PATH, false)
    // Wider, because each ligature fell back to a full em.
    expect(asIs.width).toBeGreaterThan(trueWidth(PATH, 18) + 5)
  })

  it('copies out as words rather than as line noise', async () => {
    // Not cosmetic: this is what a screen reader reads aloud, what a search
    // matches, and what KDP's own pipeline extracts. Before the widening the
    // same page came out "diβerence of a gentle λre".
    expect((await render(PATH, true)).text).toBe(TEXT)
  })
})
