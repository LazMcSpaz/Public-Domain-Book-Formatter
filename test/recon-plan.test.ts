import { describe, expect, it } from 'vitest'
import {
  ocrGateRefusal,
  ocrReport,
  planRecon,
  reconDoesNotApply,
  reconHandoff,
  reconStatus,
  shelfReadingFor,
  type ReconFacts,
  type ReconHandoffInput
} from '../src/core/project'
import type { BookShape } from '../src/core/provenance'

/**
 * The decisions around the free first reading (cleanup task 17): what
 * `drive.mjs recon` does, what `load` says, and when `transcribe` refuses.
 * Synthetic file names and words only.
 */

const WANTED = { dpi: 300, maxPages: null, cleanup: 'off' as const }
const RUN = { key: 'scan.pdf\u00001000\u00001', fileName: 'scan.pdf', pageCount: 2 }

function handoff(over: Partial<ReconHandoffInput> = {}): ReconHandoffInput {
  return {
    key: 'scan.pdf\u00001000\u000099',
    fileName: 'scan.pdf',
    dpi: 300,
    cleanup: 'off',
    pageCount: 2,
    source: 'ocr',
    words: [
      {
        id: 'p0_w0',
        text: 'alpha',
        confidence: 90,
        bbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
        pageIndex: 0
      }
    ],
    lexicon: [],
    pageText: ['alpha', ''],
    ...over
  }
}
const sent = (over: Partial<ReconHandoffInput> = {}): unknown =>
  JSON.parse(JSON.stringify(reconHandoff(handoff(over))))

function facts(over: Partial<ReconFacts> = {}): ReconFacts {
  return {
    doesNotApply: null,
    finished: null,
    checkpoint: null,
    shelf: { kind: 'absent' },
    scanStored: true,
    fresh: false,
    ...over
  }
}

const shape = (container: BookShape['container']): BookShape => ({
  pixels: false,
  textLayer: 'converted',
  externalText: false,
  container,
  how: 'measured',
  evidence: []
})

describe('whether recon applies to a book', () => {
  it('applies to every PDF, scanned or born-digital', () => {
    expect(reconDoesNotApply({ fileName: 'scan.pdf' })).toBeNull()
    expect(reconDoesNotApply({ fileName: 'digital.pdf', shape: shape('pdf') })).toBeNull()
  })

  it('does not apply to an EPUB, by its shape or its file name', () => {
    expect(reconDoesNotApply({ fileName: 'x.pdf', shape: shape('epub') })).toMatch(/EPUB/)
    expect(reconDoesNotApply({ fileName: 'abc.EPUB', shape: null })).toMatch(/EPUB/)
  })

  it('does not apply to a compilation with no scan of its own', () => {
    expect(reconDoesNotApply({ fileName: 'stand-in.pdf', shape: shape('collection') })).toMatch(
      /compilation/
    )
  })
})

describe("the shelf's recon.json.gz, judged against this scan", () => {
  it('is absent when there is no file', () => {
    expect(shelfReadingFor(null, RUN, WANTED)).toEqual({ kind: 'absent' })
  })

  it('fits when it reads this file at these conditions, whatever the timestamp', () => {
    const r = shelfReadingFor(sent(), RUN, WANTED)
    expect(r.kind).toBe('fits')
  })

  it('is refused, with reconimport’s reasons, when it is a checkpoint or not a reading', () => {
    const partial = { ...(sent() as object), pagesDone: 1 }
    expect(shelfReadingFor(partial, RUN, WANTED)).toMatchObject({
      kind: 'refused',
      why: expect.stringMatching(/partial reading/)
    })
    expect(shelfReadingFor({ hello: 1 }, RUN, WANTED)).toMatchObject({ kind: 'refused' })
  })

  it('is refused when it reads another copy of the scan', () => {
    expect(shelfReadingFor(sent({ key: 'other.pdf\u00001000\u00001' }), RUN, WANTED)).toMatchObject(
      { kind: 'refused', why: expect.stringMatching(/not a reading of this scan.*other\.pdf/) }
    )
    expect(shelfReadingFor(sent(), { ...RUN, pageCount: 3 }, WANTED)).toMatchObject({
      kind: 'refused',
      why: expect.stringMatching(/2 leaves/)
    })
  })

  it('is refused when taken at another resolution or through another cleaning', () => {
    expect(shelfReadingFor(sent({ dpi: 150 }), RUN, WANTED)).toMatchObject({
      kind: 'refused',
      why: expect.stringMatching(/150 DPI/)
    })
    expect(shelfReadingFor(sent({ cleanup: 'gentle' }), RUN, WANTED)).toMatchObject({
      kind: 'refused',
      why: expect.stringMatching(/"gentle" cleaning/)
    })
  })

  it('skips the leaf count when the book’s length is unknown', () => {
    expect(shelfReadingFor(sent(), { ...RUN, pageCount: null }, WANTED).kind).toBe('fits')
  })
})

describe('what drive.mjs recon does', () => {
  const finished = { leaves: 2, words: 10, source: 'ocr' as const }
  const fits = { kind: 'fits' as const, handoff: reconHandoff(handoff()) }

  it('says it does not apply, and does nothing, for a book with no scan', () => {
    const p = planRecon(facts({ doesNotApply: 'an EPUB', finished, shelf: fits }))
    expect(p.action).toBe('not-applicable')
    expect(p.why).toMatch(/do not apply: an EPUB/)
  })

  it('does nothing when a finished reading is cached', () => {
    const p = planRecon(facts({ finished, shelf: fits }))
    expect(p.action).toBe('cached')
    expect(p.why).toMatch(/--fresh/)
  })

  it('loads a fitting shelf reading rather than reading again, scan or none', () => {
    expect(planRecon(facts({ shelf: fits })).action).toBe('import')
    expect(planRecon(facts({ shelf: fits, scanStored: false })).action).toBe('import')
    expect(
      planRecon(facts({ shelf: fits, checkpoint: { pagesDone: 5, pageCount: 9 } })).action
    ).toBe('import')
  })

  it('reads when the shelf file is refused, and says why it was passed over', () => {
    const p = planRecon(facts({ shelf: { kind: 'refused', why: 'it reads other.pdf.' } }))
    expect(p).toMatchObject({ action: 'read', resumeFrom: 0 })
    expect(p.notes).toEqual(['recon.json.gz beside the book was not used: it reads other.pdf.'])
  })

  it('carries on from a checkpoint', () => {
    const p = planRecon(facts({ checkpoint: { pagesDone: 20, pageCount: 45 } }))
    expect(p).toMatchObject({ action: 'read', resumeFrom: 20 })
    expect(p.why).toMatch(/leaf 20 of 45/)
  })

  it('reads every leaf when there is nothing to start from', () => {
    expect(planRecon(facts())).toMatchObject({ action: 'read', resumeFrom: 0 })
  })

  it('refuses to read when the scan is not on this device', () => {
    const p = planRecon(facts({ scanStored: false }))
    expect(p.action).toBe('refuse')
    expect(p.why).toMatch(/drive\.mjs load/)
  })

  it('with --fresh reads from the first leaf, passing over everything, and says so', () => {
    const p = planRecon(
      facts({ fresh: true, finished, shelf: fits, checkpoint: { pagesDone: 20, pageCount: 45 } })
    )
    expect(p).toMatchObject({ action: 'read', resumeFrom: 0 })
    expect(p.notes.join(' ')).toMatch(/cached reading is discarded/)
    expect(p.notes.join(' ')).toMatch(/recon\.json\.gz beside the book was not used/)
  })
})

describe('what load says about the reading', () => {
  const base = { doesNotApply: null, finished: null, checkpoint: null, shelfBeside: false }
  it('names drive.mjs recon when nothing is cached', () => {
    expect(reconStatus(base)).toMatch(/none cached.*drive\.mjs recon/)
    expect(reconStatus({ ...base, shelfBeside: true })).toMatch(/recon\.json\.gz sits beside/)
    expect(reconStatus({ ...base, checkpoint: { pagesDone: 3, pageCount: 9 } })).toMatch(
      /partial: 3 of 9.*carry on/
    )
  })
  it('counts a cached reading and says where its words came from', () => {
    expect(
      reconStatus({ ...base, finished: { leaves: 9, words: 278, source: 'embedded' } })
    ).toMatch(/cached: 9 leaves, 278 words, from the PDF's own text layer/)
  })
  it('says when it does not apply', () => {
    expect(reconStatus({ ...base, doesNotApply: 'an EPUB' })).toBe('does not apply: an EPUB')
  })
})

describe('when transcribe refuses to land a batch', () => {
  const gate = {
    doesNotApply: null,
    reading: { pageCount: 9 },
    leaves: [1, 2],
    withoutCheck: false
  }

  it('refuses with no reading, naming drive.mjs recon and the flag', () => {
    const why = ocrGateRefusal({ ...gate, reading: null })
    expect(why).toMatch(/node scripts\/drive\.mjs recon/)
    expect(why).toMatch(/--without-ocr-check/)
    expect(why).toMatch(/Nothing was written/)
  })

  it('refuses leaves the reading does not reach', () => {
    expect(ocrGateRefusal({ ...gate, leaves: [8, 9, 12] })).toMatch(/leaf 9, 12 outside it/)
  })

  it('lands a batch the reading covers', () => {
    expect(ocrGateRefusal(gate)).toBeNull()
  })

  it('lands anything with the flag', () => {
    expect(ocrGateRefusal({ ...gate, reading: null, withoutCheck: true })).toBeNull()
  })

  it('never blocks a book with no scan', () => {
    expect(ocrGateRefusal({ ...gate, reading: null, doesNotApply: 'an EPUB' })).toBeNull()
  })
})

describe("transcribe's ocr line", () => {
  const base = {
    doesNotApply: null,
    reading: true,
    leaves: 3,
    compared: 3,
    wordless: [] as number[],
    withoutCheck: false
  }
  it('says every leaf was checked only when every leaf was', () => {
    expect(ocrReport(base)).toBe('checked against the cached reading, all 3 leaf(s)')
    expect(ocrReport({ ...base, compared: 2, wordless: [7] })).toBe(
      'NOT CHECKED on 1 of 3 leaf(s): the cached reading has no words for leaf 7'
    )
  })
  it('says NOT CHECKED, and how it landed, with no reading', () => {
    expect(ocrReport({ ...base, reading: false, compared: 0, withoutCheck: true })).toBe(
      'NOT CHECKED: no cached reading on this device (landed with --without-ocr-check)'
    )
  })
  it('says why the check does not apply to a book with no scan', () => {
    expect(ocrReport({ ...base, reading: false, doesNotApply: 'an EPUB' })).toBe(
      'does not apply: an EPUB'
    )
  })
})
