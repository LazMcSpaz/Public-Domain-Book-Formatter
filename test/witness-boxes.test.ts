import { describe, expect, it } from 'vitest'
import { WITNESS_DPI, noWordsMeasured, witnessPages } from '../src/core/image'
// @ts-expect-error — a plain Node module with no types: the driver imports it.
import { duration, reconReport, statusReport } from '../scripts/lib/recon-report.mjs'
// @ts-expect-error — a plain Node module with no types: the driver imports it.
import { progressLine } from '../scripts/lib/drive-ticker.mjs'

/**
 * Recon's boxes in the form the slant witness reads, and the witness's
 * refusal to report success over nothing (cleanup task 18). Synthetic words.
 */

const word = (text: string, pageIndex: number, x0: number, y0: number, x1: number, y1: number) => ({
  text,
  pageIndex,
  bbox: { x0, y0, x1, y1 }
})

describe('witnessPages', () => {
  it('groups by leaf in leaf order, keeping the order each leaf was read in', () => {
    const pages = witnessPages(
      [word('gamma', 2, 0, 0, 5, 5), word('alpha', 0, 1, 1, 9, 9), word('beta', 0, 10, 1, 19, 9)],
      300
    )
    expect(pages.map((p) => p.page)).toEqual([0, 2])
    expect(pages[0]!.words.map((w) => w.text)).toEqual(['alpha', 'beta'])
    expect(pages[0]!.words[0]).toEqual({ text: 'alpha', x0: 1, y0: 1, x1: 9, y1: 9 })
  })

  it('moves boxes to the witness resolution, rounding outwards', () => {
    expect(WITNESS_DPI).toBe(300)
    const [page] = witnessPages([word('delta', 4, 10.4, 20.6, 30.2, 40.5)], 150)
    expect(page!.words[0]).toEqual({ text: 'delta', x0: 20, y0: 41, x1: 61, y1: 81 })
    const [same] = witnessPages([word('delta', 4, 10.4, 20.6, 30.2, 40.5)], 300)
    expect(same!.words[0]).toEqual({ text: 'delta', x0: 10, y0: 20, x1: 31, y1: 41 })
  })

  it('takes only the leaves named, and leaves out blank words', () => {
    const pages = witnessPages(
      [word('one', 0, 0, 0, 1, 1), word(' ', 1, 0, 0, 1, 1), word('two', 1, 0, 0, 1, 1)],
      300,
      [1]
    )
    expect(pages).toEqual([{ page: 1, words: [{ text: 'two', x0: 0, y0: 0, x1: 1, y1: 1 }] }])
  })

  it('refuses a reading with no resolution', () => {
    expect(() => witnessPages([], 0)).toThrow(/0 DPI/)
  })
})

describe('noWordsMeasured', () => {
  const base = {
    from: 'layer' as const,
    first: 0,
    last: 8,
    pagesWithWords: 0,
    pagesUnplaced: 0,
    wordsMeasured: 0
  }

  it('lets a witness that measured anything through, italic found or not', () => {
    expect(noWordsMeasured({ ...base, pagesWithWords: 3, wordsMeasured: 1 })).toBeNull()
  })

  it('fails a scan with no layer and no boxes, naming the door to the boxes', () => {
    const why = noWordsMeasured(base)
    expect(why).toMatch(/no text layer/)
    expect(why).toMatch(/drive\.mjs words --out/)
    expect(why).toMatch(/Nothing was written/)
  })

  it('fails a boxes file with nothing for the pages read', () => {
    expect(noWordsMeasured({ ...base, from: 'words' })).toMatch(/--words file has none/)
  })

  it('fails when --book placed no page', () => {
    expect(noWordsMeasured({ ...base, pagesWithWords: 4, pagesUnplaced: 4 })).toMatch(/--book/)
  })

  it('fails when the boxes hold no ink, naming the render they must be in', () => {
    expect(noWordsMeasured({ ...base, pagesWithWords: 4 })).toMatch(/300-DPI render/)
  })
})

describe('what drive.mjs recon prints', () => {
  it('says time the way a person reads it', () => {
    expect(duration(42_000)).toBe('42s')
    expect(duration(192_000)).toBe('3m 12s')
    expect(duration(3_840_000)).toBe('1h 4m')
  })

  it('reports leaves, words, where the text came from and the time, then how to keep it', () => {
    const r = reconReport(
      {
        action: 'read',
        why: 'Reading every leaf of the scan.',
        notes: [],
        leaves: 9,
        words: 278,
        textFrom: 'OCR of the page images (Tesseract)',
        ms: 7000
      },
      { beside: '/shelf/books/B/recon.json.gz' }
    )
    expect(r).toMatchObject({ reading: 'read', leaves: 9, words: 278, took: '7s' })
    expect(r.textFrom).toMatch(/OCR/)
    expect(Object.keys(r).at(-1)).toBe('keep')
    expect(r.keep).toBe(
      'node scripts/drive.mjs reconexport /shelf/books/B/recon.json.gz keeps this reading on the shelf.'
    )
  })

  it('needs no hint for a reading that came from the shelf', () => {
    const r = reconReport(
      { action: 'import', why: 'loaded', notes: [], leaves: 9, words: 1, ms: 0 },
      { beside: '/b/recon.json.gz' }
    )
    expect(r).toMatchObject({ reading: 'loaded from the shelf', from: '/b/recon.json.gz' })
    expect(r).not.toHaveProperty('keep')
  })

  it('reports a reading under way, and the ticker prints it in one line', () => {
    const s = statusReport(
      { key: 'k', startedAt: 0, resumedFrom: 20, leaf: 28, of: 45, phase: 'ocr' },
      65_000
    )
    expect(s).toEqual({
      reading: 'under way',
      leaf: 28,
      of: 45,
      phase: 'ocr',
      resumedFrom: 20,
      elapsed: '1m 5s'
    })
    expect(progressLine(s)).toBe('recon: leaf 28 of 45 (ocr), 1m 5s so far')
    expect(progressLine(statusReport(null, 0))).toBeNull()
  })
})
