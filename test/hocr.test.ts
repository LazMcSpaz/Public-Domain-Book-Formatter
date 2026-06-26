import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseHocr, flagsFromPages, decodeEntities } from '@core/hocr'

const __dirname = dirname(fileURLToPath(import.meta.url))
const hocr = readFileSync(join(__dirname, 'fixtures', 'sample.hocr'), 'utf8')

describe('parseHocr', () => {
  const pages = parseHocr(hocr)

  it('parses both ocr_page elements', () => {
    expect(pages).toHaveLength(2)
    expect(pages[0]!.index).toBe(0)
    expect(pages[1]!.index).toBe(1)
  })

  it('derives page width/height from the page bbox', () => {
    expect(pages[0]!.width).toBe(1200)
    expect(pages[0]!.height).toBe(1800)
    expect(pages[1]!.width).toBe(1000)
    expect(pages[1]!.height).toBe(1500)
  })

  it('sets imagePath/dpi/regions defaults', () => {
    for (const p of pages) {
      expect(p.imagePath).toBeNull()
      expect(p.dpi).toBeNull()
      expect(p.regions).toEqual([])
    }
  })

  it('parses the right number of words per page', () => {
    expect(pages[0]!.words).toHaveLength(7)
    expect(pages[1]!.words).toHaveLength(2)
  })

  it('assigns stable per-page ids', () => {
    expect(pages[0]!.words[0]!.id).toBe('p0_w0')
    expect(pages[0]!.words[2]!.id).toBe('p0_w2')
    expect(pages[1]!.words[0]!.id).toBe('p1_w0')
  })

  it('parses bbox correctly regardless of attribute order', () => {
    expect(pages[0]!.words[0]!.bbox).toEqual({ x0: 100, y0: 120, x1: 260, y1: 175 })
    // word_1_5 has x_wconf BEFORE bbox in the title
    const amp = pages[0]!.words[4]!
    expect(amp.bbox).toEqual({ x0: 320, y0: 200, x1: 360, y1: 255 })
    expect(amp.confidence).toBe(77)
  })

  it('parses confidence and defaults to 0 when x_wconf is absent', () => {
    expect(pages[0]!.words[0]!.confidence).toBe(96)
    expect(pages[0]!.words[2]!.confidence).toBe(41)
    // word_1_7 "nofconf" has no x_wconf
    expect(pages[0]!.words[6]!.text).toBe('nofconf')
    expect(pages[0]!.words[6]!.confidence).toBe(0)
  })

  it('decodes XML entities in text', () => {
    expect(pages[0]!.words[4]!.text).toBe('&')
    expect(pages[1]!.words[0]!.text).toBe('Café')
    expect(pages[1]!.words[1]!.text).toBe('naïve')
  })

  it('trims word text', () => {
    expect(pages[0]!.words[0]!.text).toBe('Hello')
  })

  it('returns an empty array for input with no pages', () => {
    expect(parseHocr('<html><body>nothing here</body></html>')).toEqual([])
    expect(parseHocr('')).toEqual([])
  })
})

describe('flagsFromPages', () => {
  const pages = parseHocr(hocr)

  it('flags low-confidence words at the default threshold (60)', () => {
    const flags = flagsFromPages(pages)
    const ids = flags.map((f) => (f.kind === 'ocr' ? f.tokenId : ''))
    // p0_w2 (41), p0_w6 (0, no x_wconf), p1_w1 (55) are below 60
    expect(ids).toContain('p0_w2')
    expect(ids).toContain('p0_w6')
    expect(ids).toContain('p1_w1')
    // confident words are not flagged
    expect(ids).not.toContain('p0_w0')
    expect(ids).not.toContain('p1_w0')
  })

  it('only emits ocr-kind flags carrying a real confidence', () => {
    for (const f of flagsFromPages(pages)) {
      expect(f.kind).toBe('ocr')
      if (f.kind === 'ocr') expect(typeof f.confidence).toBe('number')
    }
  })

  it('honors a custom threshold', () => {
    const flags = flagsFromPages(pages, 90)
    const ids = flags.map((f) => (f.kind === 'ocr' ? f.tokenId : ''))
    expect(ids).toContain('p0_w1') // 88 < 90
    expect(ids).not.toContain('p0_w0') // 96 >= 90
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;')).toBe(
      'a & b <c> "d" \'e\'',
    )
    expect(decodeEntities('&#233; &#x00e9;')).toBe('é é')
  })

  it('leaves unknown entities intact', () => {
    expect(decodeEntities('&unknown;')).toBe('&unknown;')
  })
})
