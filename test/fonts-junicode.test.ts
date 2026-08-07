/**
 * Junicode, the one face this repository ships itself.
 *
 * Every other family arrives from npm at a pinned version, so a broken one
 * would be somebody else's regression. These `.otf` files were downloaded and
 * committed by hand, which makes them the only fonts in the app that can be
 * replaced by the wrong build without anything noticing. This test is what
 * notices.
 *
 * It also covers the one code path nothing else exercises: these are **CFF**
 * outlines, so pdf-lib writes a `FontFile3` rather than the `FontFile2` every
 * other face takes. That is a different embedder branch, and "the OTF version
 * of the font is fine, surely" is exactly the assumption worth testing rather
 * than making.
 *
 * Read off disk, like `layout-pdf.test.ts`, so this runs in plain Node.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument } from 'pdf-lib'

const DIR = 'public/fonts/junicode'

/** The two the loader actually asks for — see `JUNICODE_URLS` in `fonts.ts`. */
const USED = { regular: `${DIR}/Junicode-Regular.otf`, italic: `${DIR}/Junicode-Italic.otf` }

const bytesOf = (path: string): Uint8Array => new Uint8Array(readFileSync(path))

describe('the vendored files', () => {
  it('has the two faces the loader names, under those exact names', () => {
    // A rename in a later Junicode release is the most likely way this breaks,
    // and it would fail silently: the fetch 404s, the app substitutes EB
    // Garamond and says so, and nobody reads the notice.
    for (const path of Object.values(USED)) expect(existsSync(path), path).toBe(true)
  })

  /**
   * The OFL requires its text to travel with the fonts, and this repository is
   * public — committing the binaries is redistribution. A missing licence file
   * is a licensing failure, not an untidiness.
   */
  it('ships the licence the fonts are under', () => {
    const licence = readFileSync(`${DIR}/OFL.txt`, 'utf8')
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(licence).toContain('Peter S. Baker')
  })

  it('is the static build, not the variable one', () => {
    // A variable font parses and embeds, but as whatever instance the reader
    // guesses — so this fails late, on paper, rather than here.
    for (const path of Object.values(USED)) {
      expect(fontkit.create(bytesOf(path)).variationAxes, path).toEqual({})
    }
  })
})

describe('what this face is for', () => {
  const font = fontkit.create(bytesOf(USED.regular))

  it('carries the archaic glyphs that are the whole reason to offer it', () => {
    // Junicode is chosen over the other six for early-modern and medieval
    // coverage. If a build shipped without these, the face would be a slower EB
    // Garamond — so this asserts the reason, not just the file.
    for (const ch of ['ſ', 'æ', 'þ', 'ð', 'ȝ', 'ę', 'ƿ']) {
      const glyph = font.glyphsForString(ch)[0]
      expect(glyph, `no glyph for ${ch}`).toBeDefined()
      expect(glyph!.id, `notdef for ${ch}`).toBeGreaterThan(0)
    }
  })

  it('has real small capitals, unlike the faces we fake them on', () => {
    // Not used yet — `headingStyle.smallCaps` still sets ordinary capitals, and
    // fixing that needs a glyph-id write path (see docs/PLAN-next.md §4). This
    // records that the raw material is present, so that work is not blocked on
    // rediscovering it.
    const smcp = font.layout('Chapter', { smcp: true }).glyphs.map((g) => g.id)
    const plain = font.layout('Chapter').glyphs.map((g) => g.id)
    expect(smcp).not.toEqual(plain)
  })
})

describe('embedding CFF outlines, which no other face here does', () => {
  it('embeds whole and writes a width for the text it set', async () => {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    // `subset: false` is forced everywhere in this app — see pdf-out.ts — so it
    // is what gets tested. Subsetting corrupts outlines on other faces here.
    const embedded = await doc.embedFont(bytesOf(USED.regular), { subset: false })

    const width = embedded.widthOfTextAtSize('Chapter', 24)
    expect(width).toBeGreaterThan(0)
    // A missing width array shows up as every glyph being a full em wide, which
    // is the "his fi ndingsto the assembled" failure in a different disguise.
    expect(width).toBeLessThan(24 * 'Chapter'.length)

    const page = doc.addPage([300, 200])
    page.drawText('Chapter ſ æ þ', { x: 20, y: 120, size: 24, font: embedded })
    expect((await doc.save()).length).toBeGreaterThan(1000)
  })

  it('round-trips through pdf.js — a different library from the one that wrote it', async () => {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const embedded = await doc.embedFont(bytesOf(USED.regular), { subset: false })
    doc.addPage([300, 200]).drawText('Chapter ſ æ þ', { x: 20, y: 120, size: 24, font: embedded })
    const bytes = await doc.save()

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const reopened = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise
    const content = await (await reopened.getPage(1)).getTextContent()
    const text = content.items.map((i) => ('str' in i ? i.str : '')).join('')

    // The long-s surviving is the point: it proves the encoding carried a
    // character outside WinAnsi, which is the whole reason this face is here.
    expect(text).toBe('Chapter ſ æ þ')
  })
})
