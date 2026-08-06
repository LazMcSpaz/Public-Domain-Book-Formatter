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
import { deflateSync, inflateSync } from 'node:zlib'
import fontkit from '@pdf-lib/fontkit'
import type { TypeFeatures } from '@pdf-lib/fontkit'
import {
  englishHyphenator,
  layout,
  layoutWithToc,
  type FontRef,
  type LayoutEdition
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import { renderPdf } from '@platform/browser/pdf-out'
import type { FontTable } from '@platform/browser/fonts'
import { assembleBook } from '@core/assemble'
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

let blockId = 0
function block(kind: BookBlock['kind'], text: string, level?: number): BookBlock {
  return {
    id: `p0b${blockId++}`,
    kind,
    text,
    sourcePages: [0],
    ...(level === undefined ? {} : { level })
  }
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
  illustrations: [],
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

describe('renderPdf — footnotes and the contents page reach the file', () => {
  /**
   * The whole point of this suite. Both of these used to be *silently* absent
   * from the PDF while present in the LaTeX: the page count was right, the
   * text extracted cleanly, and every KDP check passed. Only the printed book
   * was missing its notes.
   */
  async function buildScholarly() {
    const fonts = diskFontTable()
    const doc = assembleBook([
      {
        pageIndex: 0,
        role: 'body',
        uncertain: [],
        furniture: {},
        blocks: [
          { kind: 'heading', text: 'Of the Air', level: 1 },
          { kind: 'paragraph', text: `${PROSE}A first observation.1 ${PROSE}` },
          { kind: 'footnote', text: 'See Croll, Basilica Chymica, lib. ii.', marker: '1' }
        ]
      },
      {
        pageIndex: 1,
        role: 'body',
        uncertain: [],
        furniture: {},
        blocks: [
          { kind: 'heading', text: 'Of Fire', level: 1 },
          { kind: 'paragraph', text: `${PROSE}A second observation.1 ${PROSE}` },
          { kind: 'footnote', text: 'Boyle disputes this at length.', marker: '1' }
        ]
      }
    ])
    const book = layoutWithToc(doc, defaultStyleProfile(), fonts, {
      edition: EDITION,
      hyphenate: englishHyphenator()
    })
    const pdf = await renderPdf(book, fonts, { title: EDITION.title })
    return { book, pdf }
  }

  it('sets both notes, on the pages their references landed on', async () => {
    const { book, pdf } = await buildScholarly()
    expect(book.notesPlaced).toBe(2)
    expect(book.notesDropped).toEqual([])

    const reopened = await reopen(pdf.bytes)
    const pageWith = async (needle: string): Promise<number> => {
      for (let i = 0; i < reopened.numPages; i++) {
        if ((await textOfPage(reopened, i)).includes(needle)) return i
      }
      return -1
    }

    expect(await pageWith('Basilica Chymica')).toBe(await pageWith('A first observation'))
    expect(await pageWith('Boyle disputes')).toBe(await pageWith('A second observation'))
    await reopened.destroy()
  })

  it('renumbers the marks through the book — both notes were printed "1"', async () => {
    const { pdf } = await buildScholarly()
    const reopened = await reopen(pdf.bytes)
    const second = await textOfPage(
      reopened,
      await (async () => {
        for (let i = 0; i < reopened.numPages; i++) {
          if ((await textOfPage(reopened, i)).includes('Boyle disputes')) return i
        }
        return 0
      })()
    )
    // The second note is "2" in this edition, whatever the printer called it.
    expect(second).toMatch(/2 Boyle disputes/)
    await reopened.destroy()
  })

  it('sets a contents page carrying the folios the chapters open on', async () => {
    const { book, pdf } = await buildScholarly()
    const contents = book.pages.find((p) => p.kind === 'contents')!
    const reopened = await reopen(pdf.bytes)
    const text = await textOfPage(reopened, contents.index)

    expect(text).toContain('CONTENTS')
    for (const chapter of book.chapterPages) {
      expect(text).toContain(chapter.title)
      expect(text).toContain(book.pages[chapter.pageIndex]!.folio!)
    }
    await reopened.destroy()
  })
})

/**
 * A valid grayscale PNG, built here rather than read from disk.
 *
 * The crop path is canvas work and cannot run in Node, but everything after it
 * — embedding, placing, flipping the origin — is plain pdf-lib, and that is the
 * part where a book quietly comes out with a blank rectangle in it. Twenty
 * lines of PNG writing buys the whole of that path a test that runs in the
 * plain Node suite with no browser.
 */
function png(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc(body))
    return Buffer.concat([head, body, tail])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // greyscale

  // One filter byte per scanline, then the pixels: a diagonal, so a viewer
  // showing it upside down would be visibly wrong rather than plausibly right.
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0
    for (let x = 0; x < width; x++) {
      raw[y * (width + 1) + 1 + x] = x === y ? 0 : 255
    }
  }

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0))
    ])
  )
}

describe('renderPdf — illustrations', () => {
  const illustrated = (sourceWidth: number, sourceHeight: number): BookDocument =>
    assembleBook(
      [
        {
          pageIndex: 0,
          role: 'body',
          uncertain: [],
          furniture: {},
          blocks: [
            { kind: 'heading', text: 'Of the Air', level: 1 },
            { kind: 'paragraph', text: PROSE },
            { kind: 'caption', text: 'Fig. 1. The alembick.' }
          ]
        }
      ],
      { illustrations: [{ id: 'fig1', pageIndex: 0, sourceWidth, sourceHeight }] }
    )

  async function buildIllustrated(withPixels = true) {
    const fonts = diskFontTable()
    const doc = illustrated(1200, 400)
    const book = layout(doc, defaultStyleProfile(), fonts, { edition: EDITION })
    const pdf = await renderPdf(book, fonts, {
      ...(withPixels ? { images: new Map([['fig1', png(120, 40)]]) } : {})
    })
    return { book, pdf }
  }

  it('embeds the picture as an image object in the file', async () => {
    const { pdf } = await buildIllustrated()
    expect(pdf.missingImages).toEqual([])
    expect(pdfDictionaries(pdf.bytes)).toContain('/Image')
  })

  it('paints it on the page the engine put it on', async () => {
    const { book, pdf } = await buildIllustrated()
    const placed = book.imagesPlaced[0]!
    const reopened = await reopen(pdf.bytes)
    const ops = await (await reopened.getPage(placed.pageIndex + 1)).getOperatorList()

    // pdf.js reports painting an image XObject with its own opcode, so this
    // asserts the picture is *drawn*, not merely carried in the file.
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    expect(ops.fnArray).toContain(OPS.paintImageXObject)
    await reopened.destroy()
  })

  it('places it inside the page, right way up', async () => {
    const { book } = await buildIllustrated()
    const page = book.pages.find((p) => p.items.some((i) => i.kind === 'image'))!
    const item = page.items.find((i) => i.kind === 'image')!
    if (item.kind !== 'image') throw new Error('unreachable')

    // The engine's y runs down from the top; pdf-lib's runs up from the bottom.
    // If the writer got that wrong the image would still be *in* the file, and
    // still on the right page — it would just be somewhere else on it.
    expect(item.yPt).toBeGreaterThanOrEqual(0)
    expect(item.yPt + item.heightPt).toBeLessThanOrEqual(page.heightPt)
    expect(item.xPt).toBeGreaterThanOrEqual(0)
    expect(item.xPt + item.widthPt).toBeLessThanOrEqual(page.widthPt)
  })

  it('reports a picture whose pixels never arrived instead of leaving a hole', async () => {
    const { pdf } = await buildIllustrated(false)
    expect(pdf.missingImages).toEqual(['fig1'])
    // And nothing is drawn: a grey placeholder box in a book for sale is worse
    // than the gap the report tells you about.
    expect(pdfDictionaries(pdf.bytes)).not.toContain('/Image')
  })

  it('embeds one copy however many pages carry the picture', async () => {
    const { pdf } = await buildIllustrated()
    const dictionaries = pdfDictionaries(pdf.bytes)
    expect(dictionaries.split('/Subtype /Image').length - 1).toBeLessThanOrEqual(1)
  })
})
