/**
 * The real-output test: a PDF is generated, then reopened with pdf.js and
 * checked against what the layout engine said it would be.
 *
 * The page-count assertion is the one that earns its keep. Every other check
 * here can pass while the measurer and the embedder quietly disagree about how
 * wide a word is; if they do, the lines break differently and the page count
 * moves. It is the cheapest available detector of measurement drift, which is
 * the failure this whole design exists to prevent.
 *
 * Fonts are read from `node_modules` rather than fetched, so this runs in the
 * same plain Node environment as the rest of the suite.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import fontkit from '@pdf-lib/fontkit'
import type { TypeFeatures } from '@pdf-lib/fontkit'
import { englishHyphenator, layout, type FontRef, type LayoutEdition } from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import { renderPdf } from '@platform/browser/pdf-out'
import type { FontTable } from '@platform/browser/fonts'
import type { BookBlock, BookDocument } from '@core/assemble'

/** Must match `LAYOUT_FEATURES` in the browser font table — see that file. */
const FEATURES: TypeFeatures = {
  liga: false,
  dlig: false,
  hlig: false,
  clig: false,
  rlig: false
}

const FILES: Record<string, string> = {
  'EB Garamond|regular':
    'node_modules/@expo-google-fonts/eb-garamond/400Regular/EBGaramond_400Regular.ttf',
  'EB Garamond|italic':
    'node_modules/@expo-google-fonts/eb-garamond/400Regular_Italic/EBGaramond_400Regular_Italic.ttf'
}

/**
 * The same measurement the browser font table performs, over the same bytes
 * pdf-lib embeds. Written out here rather than imported because `fonts.ts`
 * reaches for `fetch` and Vite's `?url` imports, neither of which exists in Node.
 */
function diskFontTable(): FontTable {
  const faces = new Map(
    Object.entries(FILES).map(([key, path]) => {
      const bytes = new Uint8Array(readFileSync(path))
      return [key, { bytes, font: fontkit.create(bytes) }]
    })
  )
  const faceFor = (ref: FontRef) =>
    faces.get(`${ref.family}|${ref.style}`) ?? faces.get('EB Garamond|regular')!

  return {
    widthOf(text, ref, sizePt) {
      const face = faceFor(ref)
      let units = 0
      for (const glyph of face.font.layout(text, FEATURES).glyphs) units += glyph.advanceWidth
      return (units / face.font.unitsPerEm) * sizePt
    },
    metrics(ref, sizePt) {
      const face = faceFor(ref)
      const scale = sizePt / face.font.unitsPerEm
      return {
        ascent: face.font.ascent * scale,
        descent: Math.abs(face.font.descent) * scale,
        lineGap: face.font.lineGap * scale
      }
    },
    bytesFor: (ref) => faceFor(ref).bytes,
    resolve: (family) => family,
    substitutions: new Map()
  }
}

const EDITION: LayoutEdition = {
  title: 'A Treatise of Airs',
  author: 'Robert Boyle',
  imprint: 'Scratch Press',
  copyrightHolder: 'The Publisher',
  editionDate: '2026',
  notices: ['The original work is in the public domain.']
}

function block(kind: BookBlock['kind'], text: string, level?: number): BookBlock {
  return { kind, text, sourcePages: [0], ...(level === undefined ? {} : { level }) }
}

const PROSE =
  'The chirurgeon examined the specimen with extraordinary care and reported his findings to the assembled company that evening. '.repeat(
    8
  )

const DOCUMENT: BookDocument = {
  blocks: [
    block('heading', 'Of the Air', 1),
    block('paragraph', PROSE),
    block('paragraph', PROSE),
    block('heading', 'Of Fire', 1),
    block('paragraph', PROSE)
  ],
  footnotes: [],
  chapters: [],
  asides: [],
  skipped: []
}

async function build(trimSize = '6x9') {
  const fonts = diskFontTable()
  const profile = { ...defaultStyleProfile(), trimSize, dropCap: true }
  const book = layout(DOCUMENT, profile, fonts, {
    edition: EDITION,
    hyphenate: englishHyphenator()
  })
  const pdf = await renderPdf(book, fonts, { title: EDITION.title, author: EDITION.author })
  return { book, pdf }
}

/** Reopen with pdf.js — a different library from the one that wrote the file. */
async function reopen(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise
}

/**
 * Every dictionary in the file, as text.
 *
 * pdf-lib packs objects into compressed object streams, so the structural
 * entries are not visible in the raw bytes — they have to be inflated first.
 * Reading the file this way, rather than through pdf-lib's own object graph,
 * keeps the assertion independent of the library that wrote it.
 */
function pdfDictionaries(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1')
  const parts = [raw]
  const streamStart = /stream\r?\n/gu
  let match: RegExpExecArray | null
  while ((match = streamStart.exec(raw)) !== null) {
    const from = match.index + match[0].length
    const to = raw.indexOf('endstream', from)
    if (to < 0) continue
    try {
      parts.push(inflateSync(Buffer.from(raw.slice(from, to), 'latin1')).toString('latin1'))
    } catch {
      // Not a Flate stream — a font program or an image. Nothing to read here.
    }
  }
  return parts.join('\n')
}

/**
 * Extracted text, with runs joined by single spaces. Every word is its own run
 * — that is how justification is carried through — so the raw join is full of
 * doubled spaces that say nothing about correctness.
 */
async function textOfPage(
  reopened: Awaited<ReturnType<typeof reopen>>,
  pageIndex: number
): Promise<string> {
  const content = await (await reopened.getPage(pageIndex + 1)).getTextContent()
  return content.items
    .map((i) => ('str' in i ? i.str : ''))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

describe('renderPdf — the real output', () => {
  it('produces a page for every page the engine laid out', async () => {
    const { book, pdf } = await build()
    const reopened = await reopen(pdf.bytes)
    expect(pdf.pageCount).toBe(book.pages.length)
    expect(reopened.numPages).toBe(book.pages.length)
    await reopened.destroy()
  })

  it('sets the MediaBox to exactly the trim, with no bleed and no crop marks', async () => {
    const { pdf } = await build('6x9')
    const reopened = await reopen(pdf.bytes)
    for (let i = 1; i <= reopened.numPages; i++) {
      const viewport = (await reopened.getPage(i)).getViewport({ scale: 1 })
      expect(viewport.width).toBeCloseTo(432, 6)
      expect(viewport.height).toBeCloseTo(648, 6)
    }
    await reopened.destroy()
  })

  it('follows the trim the style asks for', async () => {
    const { pdf } = await build('5.5x8.5')
    const reopened = await reopen(pdf.bytes)
    const viewport = (await reopened.getPage(1)).getViewport({ scale: 1 })
    expect(viewport.width).toBeCloseTo(396, 6)
    expect(viewport.height).toBeCloseTo(612, 6)
    await reopened.destroy()
  })

  it('embeds its fonts — KDP requires it', async () => {
    const { pdf } = await build()
    expect(pdf.embeddedFamilies).toContain('EB Garamond')

    // A `/FontFile2` entry is the font *program* itself living in the file.
    // Without one the reader substitutes a lookalike and the book reflows on
    // someone else's machine, which is what KDP's rule is actually about.
    expect(pdfDictionaries(pdf.bytes)).toContain('/FontFile2')
  })

  it('writes text that reads back as the book, not as glyph soup', async () => {
    const { book, pdf } = await build()
    const reopened = await reopen(pdf.bytes)

    const opener = book.chapterPages[0]!.pageIndex
    const text = await textOfPage(reopened, opener)

    expect(text).toContain('OF THE AIR')
    expect(text).toContain('chirurgeon')
    // The drop-cap initial is drawn as its own run; the reader must still be
    // able to recover the opening word.
    expect(text).toContain('he chirurgeon')
    await reopened.destroy()
  })

  it('draws every folio the engine placed', async () => {
    const { book, pdf } = await build()
    const reopened = await reopen(pdf.bytes)
    const numbered = book.pages.filter((p) => p.folio !== null)
    expect(numbered.length).toBeGreaterThan(0)
    for (const page of numbered) {
      expect(await textOfPage(reopened, page.index)).toContain(page.folio!)
    }
    await reopened.destroy()
  })

  it('is deterministic: the same book and style give the same page count twice', async () => {
    const a = await build()
    const b = await build()
    expect(b.pdf.pageCount).toBe(a.pdf.pageCount)
  })
})
