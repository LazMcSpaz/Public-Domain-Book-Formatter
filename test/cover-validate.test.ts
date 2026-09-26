/**
 * The checks between a composed cover and a printed one.
 *
 * These are written the way the interior's KDP checks are: the interesting
 * assertion is not that a good cover passes but that each specific way a cover
 * gets ruined is *caught and named*.
 */
import { describe, expect, it } from 'vitest'
import { fixedWidthMeasurer } from '@core/layout'
import {
  composeCover,
  defaultCover,
  MAX_COVER_MB,
  validateCover,
  type ComposedCover,
  type CoverDocument
} from '@core/cover'

const measurer = fixedWidthMeasurer()

function cover(patch: (doc: CoverDocument) => void = () => {}): CoverDocument {
  const doc = defaultCover('6x9', 284)
  doc.content.title = 'A Treatise on Bee Keeping'
  doc.content.author = 'Amos Root'
  doc.content.imprint = 'Blackthorn Press'
  doc.look.arrangement = 'typographic'
  patch(doc)
  return doc
}

function report(doc: CoverDocument, extra: Partial<Parameters<typeof validateCover>[0]> = {}) {
  const composed = composeCover(doc, { measurer })
  return validateCover({ doc, composed, pageCountMeasured: true, fileBytes: 1024, ...extra })
}

function check(r: ReturnType<typeof validateCover>, id: string) {
  const found = r.checks.find((c) => c.id === id)
  if (!found) throw new Error(`no check ${id}`)
  return found
}

describe('validateCover', () => {
  it('passes a plain typographic cover', () => {
    const r = report(cover())
    expect(r.ready).toBe(true)
    expect(check(r, 'bleed').level).toBe('ok')
    expect(check(r, 'safe-margin').level).toBe('ok')
    expect(check(r, 'barcode').level).toBe('ok')
  })

  it('reports an unmeasured page count as pending, never as a tick', () => {
    // The single most consequential fact on a cover. A green tick here on a
    // typed number is the app endorsing a guess about the spine.
    const r = report(cover(), { pageCountMeasured: false })
    expect(check(r, 'spine-source').level).toBe('pending')
    expect(check(r, 'spine-source').detail).toMatch(/did not measure/)
  })

  it('fails a page count the chosen paper cannot be printed on', () => {
    const doc = cover((d) => {
      d.paper = 'bw-cream'
      d.pageCount = 900
    })
    const r = report(doc)
    expect(check(r, 'page-limits').level).toBe('fail')
    expect(r.ready).toBe(false)
  })

  it('fails when nothing is painted into the bleed', () => {
    const doc = cover()
    const composed: ComposedCover = composeCover(doc, { measurer })
    const stripped: ComposedCover = {
      ...composed,
      items: composed.items.filter((i) => i.kind !== 'fill')
    }
    const r = validateCover({ doc, composed: stripped, pageCountMeasured: true })
    expect(check(r, 'bleed').level).toBe('fail')
    expect(r.ready).toBe(false)
  })

  it('fails type that strays outside the safe area', () => {
    const doc = cover()
    const composed = composeCover(doc, { measurer })
    const strayed: ComposedCover = {
      ...composed,
      items: composed.items.map((i) => (i.kind === 'text' ? { ...i, xPt: 2 } : i))
    }
    const r = validateCover({ doc, composed: strayed, pageCountMeasured: true })
    expect(check(r, 'safe-margin').level).toBe('fail')
  })

  it('warns about anything sitting where the barcode prints', () => {
    const doc = cover()
    const composed = composeCover(doc, { measurer })
    const g = composed.geometry
    const intruding: ComposedCover = {
      ...composed,
      items: [
        ...composed.items,
        {
          kind: 'rule',
          xPt: g.barcode.x * 72,
          yPt: (g.barcode.y + 0.5) * 72,
          widthPt: 72,
          thicknessPt: 1,
          color: '#000000'
        }
      ]
    }
    const r = validateCover({ doc, composed: intruding, pageCountMeasured: true })
    expect(check(r, 'barcode').level).toBe('warn')
  })

  it('warns when the picture would print soft, in inches rather than megapixels', () => {
    const doc = cover((d) => {
      d.look.arrangement = 'classic-centered'
      d.content.art = {
        id: 'art',
        sourceWidthPx: 1024,
        sourceHeightPx: 1024,
        provenance: { kind: 'generated', model: 'x/y', prompt: 'a ground', seed: null },
        ops: [],
        fit: 'cover'
      }
    })
    const r = report(doc)
    const dpi = check(r, 'cover-dpi')
    expect(dpi.level).toBe('warn')
    expect(dpi.detail).toMatch(/DPI across/)
    // And it says the honest thing rather than offering to enlarge it.
    expect(dpi.detail).toMatch(/invent pixels/)
  })

  it('passes a picture with the pixels for the size it prints at', () => {
    const doc = cover((d) => {
      d.look.arrangement = 'classic-centered'
      d.content.art = {
        id: 'art',
        sourceWidthPx: 3000,
        sourceHeightPx: 3000,
        provenance: null,
        ops: [],
        fit: 'cover'
      }
    })
    expect(check(report(doc), 'cover-dpi').level).toBe('ok')
  })

  it('warns rather than fails when a thin book cannot carry spine text', () => {
    const doc = cover((d) => {
      d.pageCount = 40
    })
    const r = report(doc)
    expect(check(r, 'spine-text').level).toBe('warn')
    // Nothing here is fatal: the cover prints, the spine is simply blank.
    expect(check(r, 'spine-text').detail).toMatch(/79/)
  })

  it('fails an unembedded face and an oversized file', () => {
    expect(check(report(cover(), { fontsEmbedded: false }), 'cover-fonts').level).toBe('fail')
    const big = report(cover(), { fileBytes: (MAX_COVER_MB + 1) * 1024 * 1024 })
    expect(check(big, 'cover-size').level).toBe('fail')
  })

  it('leaves the file-size check pending until there is a file', () => {
    const doc = cover()
    const r = validateCover({
      doc,
      composed: composeCover(doc, { measurer }),
      pageCountMeasured: true
    })
    expect(check(r, 'cover-size').level).toBe('pending')
    // Pending is not failure — the cover is still composable.
    expect(r.ready).toBe(true)
  })

  it('surfaces what the composer could not honour rather than burying it', () => {
    const doc = cover((d) => {
      d.look.arrangement = 'plate-window'
    })
    const r = report(doc)
    expect(check(r, 'compose-warnings').detail).toMatch(/wants a picture/)
  })
})

describe('a cover nobody has finished yet', () => {
  it('reports an unanswered page count as pending, not as out of range', () => {
    const doc = cover((d) => {
      d.pageCount = 0
    })
    const r = report(doc, { pageCountMeasured: false })
    expect(check(r, 'page-limits').level).toBe('pending')
    expect(check(r, 'spine-source').level).toBe('pending')
    expect(check(r, 'spine-source').detail).toMatch(/No page count yet/)
    // Nothing here is a failure: the sheet is composable, it just has no spine.
    expect(r.ready).toBe(true)
  })
})

describe('the ground is not an intruder', () => {
  it('does not trip the barcode check, drawn or supplied', () => {
    // A ground runs under everything by design. A check that fires on every
    // cover carrying one teaches the reader to skip it.
    for (const pattern of ['guilloche', 'marbled'] as const) {
      const doc = cover((d) => {
        d.look.groundPattern = pattern
      })
      expect(check(report(doc), 'barcode').level).toBe('ok')
    }
  })
})
