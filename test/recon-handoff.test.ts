import { describe, expect, it } from 'vitest'
import {
  RECON_CACHE_VERSION,
  parseReconHandoff,
  reconHandoff,
  reconHandoffPath,
  reconMisfit,
  type ReconHandoffInput
} from '../src/core/project'

function input(over: Partial<ReconHandoffInput> = {}): ReconHandoffInput {
  return {
    key: 'isis.pdf\u00001000\u00001',
    fileName: 'isis.pdf',
    dpi: 300,
    cleanup: 'off',
    pageCount: 2,
    source: 'ocr',
    words: [
      {
        id: 'p0_w0',
        text: 'ISIS',
        confidence: 91,
        bbox: { x0: 10, y0: 20, x1: 80, y1: 44 },
        pageIndex: 0
      },
      {
        id: 'p1_w0',
        text: 'Veil',
        confidence: 88,
        bbox: { x0: 12, y0: 22, x1: 70, y1: 40 },
        pageIndex: 1,
        italic: true,
        bold: false
      }
    ],
    lexicon: [],
    pageText: ['ISIS', 'Veil'],
    now: new Date('2026-09-27T12:00:00Z'),
    ...over
  }
}

describe('recon handoff', () => {
  it('survives the trip through JSON with every word field intact', () => {
    const sent = reconHandoff(input())
    const back = parseReconHandoff(JSON.parse(JSON.stringify(sent)))
    expect(back).toEqual(sent)
    expect(back.words[1]).toMatchObject({ italic: true, bold: false })
    expect(back.words[0]).not.toHaveProperty('italic')
  })

  it('carries the stamp the receiving cache keys on', () => {
    const back = parseReconHandoff(JSON.parse(JSON.stringify(reconHandoff(input()))))
    expect(back).toMatchObject({
      key: 'isis.pdf\u00001000\u00001',
      dpi: 300,
      cleanup: 'off',
      reconVersion: RECON_CACHE_VERSION,
      pagesDone: 2,
      pageCount: 2
    })
  })

  it('will not build a handoff from a checkpoint', () => {
    expect(() => reconHandoff(input({ pageText: ['ISIS'] }))).toThrow(/1 of 2 leaves/)
  })

  it('refuses a partial reading rather than loading it as the book', () => {
    const sent = { ...reconHandoff(input()), pagesDone: 1 }
    expect(() => parseReconHandoff(sent)).toThrow(/stopped at leaf 1 of 2/)
    const short = { ...reconHandoff(input()), pageText: ['ISIS'] }
    expect(() => parseReconHandoff(short)).toThrow(/partial reading/)
  })

  it('refuses a reading taken under another recon version', () => {
    const old = { ...reconHandoff(input()), reconVersion: RECON_CACHE_VERSION - 1 }
    expect(() => parseReconHandoff(old)).toThrow(/older app/)
  })

  it('refuses what is not a reading, and a word that is not a word', () => {
    expect(() => parseReconHandoff({ hello: 1 })).toThrow(/not a reading/)
    const bad = reconHandoff(input())
    const broken = { ...bad, words: [{ ...bad.words[0], bbox: { x0: 1 } }] }
    expect(() => parseReconHandoff(broken)).toThrow(/Word 0/)
  })

  it('sits beside the book file', () => {
    expect(reconHandoffPath('Blavatsky-IsisUnveiledVolI-vjj34f')).toBe(
      'books/Blavatsky-IsisUnveiledVolI-vjj34f/recon.json.gz'
    )
  })
})

/**
 * A reading's words are filed by leaf number, so a reading of another copy of
 * the scan (another printing, or the same title with four more leaves in
 * front) would put every page turn against the wrong leaf. The page-turn check
 * uses a reading only when it is of the book's own file.
 */
describe('whether a reading is of the book’s own copy', () => {
  const run = { key: 'isis.pdf\u00001000\u00001', fileName: 'isis.pdf', pageCount: 2 }

  it('takes a reading of the same file, whatever its timestamp', () => {
    expect(reconMisfit(reconHandoff(input()), run)).toBeNull()
    expect(reconMisfit(reconHandoff(input({ key: 'isis.pdf\u00001000\u000099' })), run)).toBeNull()
  })

  it('refuses a reading of another file, or of another number of leaves', () => {
    const other = reconHandoff(
      input({ key: 'isis-1906.pdf\u00002000\u00001', fileName: 'isis-1906.pdf' })
    )
    expect(reconMisfit(other, run)).toMatch(/isis-1906\.pdf/)
    const resized = reconHandoff(input({ key: 'isis.pdf\u00001200\u00001' }))
    expect(reconMisfit(resized, run)).toMatch(/1200 bytes/)
    expect(reconMisfit({ ...reconHandoff(input()), pageCount: 6 }, run)).toMatch(/6 leaves/)
  })

  it('refuses a reading that does not say which file it read', () => {
    expect(reconMisfit({ pageCount: 2 }, run)).toMatch(/does not say/)
    expect(reconMisfit({ fileName: 'isis.pdf', pageCount: 2 }, run)).toBeNull()
    expect(reconMisfit({ fileName: 'other.pdf', pageCount: 2 }, run)).toMatch(/other\.pdf/)
  })
})
