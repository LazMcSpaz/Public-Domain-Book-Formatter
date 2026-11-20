/**
 * Composing a cover.
 *
 * Every test here uses `fixedWidthMeasurer`, so a title's width is arithmetic
 * and a failing assertion means the composer changed rather than that EB
 * Garamond did — the same bargain the layout tests strike.
 */
import { describe, expect, it } from 'vitest'
import { fixedWidthMeasurer } from '@core/layout'
import { BUILTIN_ORNAMENTS } from '@core/ornament'
import {
  artFrame,
  blurbFrame,
  composeCover,
  coverGeometry,
  defaultCover,
  fitArt,
  fitText,
  itemBounds,
  overlaps,
  wrapText,
  type CoverDocument,
  type CoverTextItem
} from '@core/cover'

const measurer = fixedWidthMeasurer()

function bookCover(patch: (doc: CoverDocument) => void = () => {}): CoverDocument {
  const doc = defaultCover('6x9', 284)
  doc.content.title = 'A Treatise on Bee Keeping'
  doc.content.author = 'Amos Root'
  doc.content.blurb = 'First published in 1877.\n\nReset and reprinted from the original edition.'
  doc.content.imprint = 'Blackthorn Press'
  doc.look.arrangement = 'typographic'
  patch(doc)
  return doc
}

function texts(items: readonly { kind: string }[]): CoverTextItem[] {
  return items.filter((i): i is CoverTextItem => i.kind === 'text')
}

describe('wrapText', () => {
  it('breaks to the measure and never mid-word', () => {
    // Fixed-width: every glyph is half the point size, so at 10pt a 50pt
    // measure holds ten characters.
    const lines = wrapText('aaaa bbbb cccc', 50, { family: 'x', style: 'regular' }, 10, measurer)
    expect(lines).toEqual(['aaaa bbbb', 'cccc'])
  })

  it('returns nothing for nothing', () => {
    expect(wrapText('   ', 100, { family: 'x', style: 'regular' }, 10, measurer)).toEqual([])
  })
})

describe('fitText', () => {
  it('picks the largest size that stays inside the box and the line budget', () => {
    const font = { family: 'x', style: 'regular' as const }
    const { sizePt, lines } = fitText(
      'Bee Keeping',
      { widthPt: 200, heightPt: 300 },
      1,
      font,
      measurer
    )
    expect(lines).toHaveLength(1)
    expect(measurer.widthOf(lines[0]!, font, sizePt)).toBeLessThanOrEqual(200)
    // One step larger would not fit.
    expect(measurer.widthOf(lines[0]!, font, sizePt + 0.5)).toBeGreaterThan(200)
  })

  it('is deterministic — the preview and the export get the same size', () => {
    const font = { family: 'x', style: 'regular' as const }
    const a = fitText(
      'A Long Enough Title To Wrap',
      { widthPt: 180, heightPt: 200 },
      3,
      font,
      measurer
    )
    const b = fitText(
      'A Long Enough Title To Wrap',
      { widthPt: 180, heightPt: 200 },
      3,
      font,
      measurer
    )
    expect(a).toEqual(b)
  })

  it('sets at the floor rather than dropping words', () => {
    const font = { family: 'x', style: 'regular' as const }
    const { lines } = fitText('word '.repeat(40), { widthPt: 60, heightPt: 40 }, 2, font, measurer)
    expect(lines.join(' ').split(/\s+/)).toHaveLength(40)
  })
})

describe('fitArt', () => {
  const frame = { x: 1, y: 1, width: 4, height: 2 }

  it('crops rather than squashes when covering', () => {
    const fit = fitArt(frame, 1000, 1000, 'cover')!
    expect(fit.dest).toEqual(frame)
    // A square source in a 2:1 frame keeps its full width and loses height.
    expect(fit.srcWidth).toBe(1000)
    expect(fit.srcHeight).toBe(500)
    expect(fit.srcY).toBe(250)
  })

  it('letterboxes rather than squashes when containing', () => {
    const fit = fitArt(frame, 1000, 1000, 'contain')!
    expect(fit.srcWidth).toBe(1000)
    expect(fit.srcHeight).toBe(1000)
    expect(fit.dest.width).toBeCloseTo(fit.dest.height, 6)
    expect(fit.dest.height).toBeCloseTo(2, 6)
  })

  it('never changes the aspect ratio', () => {
    for (const mode of ['cover', 'contain'] as const) {
      const fit = fitArt(frame, 1600, 900, mode)!
      const srcRatio = fit.srcWidth / fit.srcHeight
      const destRatio = fit.dest.width / fit.dest.height
      expect(srcRatio).toBeCloseTo(destRatio, 6)
    }
  })

  it('declines a source with no pixels', () => {
    expect(fitArt(frame, 0, 0, 'cover')).toBeNull()
  })
})

describe('composeCover', () => {
  it('paints the ground out past the trim, or the cut leaves a white edge', () => {
    const { items, geometry } = composeCover(bookCover(), { measurer })
    const ground = items[0]!
    expect(ground.kind).toBe('fill')
    if (ground.kind !== 'fill') throw new Error('unreachable')
    expect(ground.xPt).toBe(0)
    expect(ground.yPt).toBe(0)
    expect(ground.widthPt).toBeCloseTo(geometry.fullWidthIn * 72, 6)
    expect(ground.heightPt).toBeCloseTo(geometry.fullHeightIn * 72, 6)
  })

  it('keeps every line of type inside the safe area', () => {
    const { items, geometry } = composeCover(bookCover(), { measurer })
    for (const item of texts(items)) {
      const rect = itemBounds(item)!
      const inSafe =
        rect.x >= geometry.backSafe.x - 1e-6 &&
        rect.x + rect.width <= geometry.front.x + geometry.front.width - 0.25 + 1e-6
      expect(inSafe).toBe(true)
    }
  })

  it('stops the blurb above the barcode', () => {
    const doc = bookCover((d) => {
      d.content.blurb = 'A long paragraph. '.repeat(120)
    })
    const { items, geometry } = composeCover(doc, { measurer })
    const backText = texts(items).filter((t) => t.xPt / 72 < geometry.spine.x)
    for (const t of backText) {
      const rect = itemBounds(t)!
      // The imprint sits at the foot of the back panel by design, outside the
      // blurb's frame; everything else must clear the barcode.
      if (t.text.includes('Blackthorn')) continue
      expect(overlaps(rect, geometry.barcode)).toBe(false)
    }
    expect(blurbFrame(geometry).height).toBeLessThan(geometry.backSafe.height)
  })

  it('falls back to type when an arrangement wants a picture and there is none', () => {
    const doc = bookCover((d) => {
      d.look.arrangement = 'full-bleed'
    })
    const { warnings, items } = composeCover(doc, { measurer })
    expect(warnings.join(' ')).toMatch(/wants a picture/)
    expect(items.some((i) => i.kind === 'image')).toBe(false)
    // And it still set the title rather than producing a blank front.
    expect(texts(items).some((t) => t.text.toUpperCase().includes('TREATISE'))).toBe(true)
  })

  it('places art and reports the pixels it actually used', () => {
    const doc = bookCover((d) => {
      d.look.arrangement = 'classic-centered'
      d.content.art = {
        id: 'plate-1',
        sourceWidthPx: 2000,
        sourceHeightPx: 3000,
        provenance: { kind: 'plate', pageIndex: 4, caption: 'The apiary' },
        ops: [],
        fit: 'cover'
      }
    })
    const { items, placedArt } = composeCover(doc, { measurer })
    expect(items.some((i) => i.kind === 'image')).toBe(true)
    expect(placedArt).not.toBeNull()
    expect(placedArt!.id).toBe('plate-1')
    // A `cover` fit into a wide frame uses the full width and part of the height.
    expect(placedArt!.usedWidthPx).toBe(2000)
    expect(placedArt!.usedHeightPx).toBeLessThan(3000)
  })

  it('measures the art after the retouching stack, not before', () => {
    const doc = bookCover((d) => {
      d.look.arrangement = 'classic-centered'
      d.content.art = {
        id: 'plate-1',
        sourceWidthPx: 2000,
        sourceHeightPx: 3000,
        provenance: null,
        // Cropping to a quarter of the plate leaves a quarter of the pixels,
        // and the DPI check divides by what survives.
        ops: [{ op: 'crop', params: { x: 0, y: 0, width: 500, height: 750 } }],
        fit: 'contain'
      }
    })
    const { placedArt } = composeCover(doc, { measurer })
    expect(placedArt!.usedWidthPx).toBe(500)
    expect(placedArt!.usedHeightPx).toBe(750)
  })

  it('sets the spine when the book is thick enough, reading downward', () => {
    const { items } = composeCover(bookCover(), { measurer })
    const spine = texts(items).filter((t) => t.rotate === -90)
    expect(spine).toHaveLength(1)
    expect(spine[0]!.text.toUpperCase()).toContain('TREATISE')
    expect(spine[0]!.text).toContain('Amos Root')
  })

  it('leaves a thin book’s spine blank and says why', () => {
    const doc = bookCover()
    doc.pageCount = 40
    const { items, warnings } = composeCover(doc, { measurer })
    expect(texts(items).some((t) => t.rotate === -90)).toBe(false)
    expect(warnings.join(' ')).toMatch(/too narrow/)
  })

  it('draws an ornament from the library and complains about one that is not there', () => {
    const withOrnament = bookCover((d) => {
      d.look.rule = 'ornamented'
      d.look.ornamentId = BUILTIN_ORNAMENTS[0]!.id
    })
    const composed = composeCover(withOrnament, { measurer, ornaments: BUILTIN_ORNAMENTS })
    expect(composed.items.some((i) => i.kind === 'ornament')).toBe(true)
    expect(composed.warnings.join(' ')).not.toMatch(/ornament/)

    const missing = bookCover((d) => {
      d.look.ornamentId = 'no-such-ornament'
    })
    expect(
      composeCover(missing, { measurer, ornaments: BUILTIN_ORNAMENTS }).warnings.join(' ')
    ).toMatch(/not in the library/)
  })

  it('is a pure function of its inputs', () => {
    const doc = bookCover()
    const a = composeCover(doc, { measurer })
    const b = composeCover(doc, { measurer })
    expect(JSON.stringify(a.items)).toBe(JSON.stringify(b.items))
  })

  it('moves everything when the page count changes, because the spine did', () => {
    const thin = composeCover(bookCover(), { measurer })
    const doc = bookCover()
    doc.pageCount = 600
    const thick = composeCover(doc, { measurer })
    expect(thick.geometry.fullWidthIn).toBeGreaterThan(thin.geometry.fullWidthIn)
    expect(thick.geometry.front.x).toBeGreaterThan(thin.geometry.front.x)
  })

  it('honours a fixed title size instead of fitting one', () => {
    const doc = bookCover((d) => {
      d.look.titleSizePt = 21
    })
    const { items } = composeCover(doc, { measurer })
    const title = texts(items).find((t) => t.text.toUpperCase().includes('TREATISE'))
    expect(title!.sizePt).toBe(21)
  })
})

describe('the barcode is a hole, not a suggestion', () => {
  it('is inside the back panel wherever the spine ends up', () => {
    for (const pages of [24, 100, 300, 800]) {
      const g = coverGeometry({ trimSize: '5.5x8.5', pageCount: pages, paper: 'bw-white' })
      expect(overlaps(g.barcode, g.spine)).toBe(false)
      expect(overlaps(g.barcode, g.front)).toBe(false)
    }
  })
})

describe('small capitals are real or they are capitals', () => {
  it('sets full capitals, never scaled-down ones, on a face without smcp', () => {
    // `fixedWidthMeasurer` reports no small capitals, which is the case this
    // guards: the alternative a lesser tool reaches for is capitals at 70% of
    // the size, and it looks exactly like what it is.
    const doc = defaultCover('6x9', 200)
    doc.content.title = 'Bee Keeping'
    doc.look.arrangement = 'typographic'
    doc.look.titleCase = 'small-caps'
    const { items, warnings } = composeCover(doc, { measurer })
    const title = items.filter((i): i is CoverTextItem => i.kind === 'text')[0]!
    expect(title.text).toBe('BEE KEEPING')
    expect(title.font.smallCaps).toBeUndefined()
    expect(warnings.join(' ')).toMatch(/no real small capitals/)
  })
})

describe('artFrame', () => {
  it('reports where a picture would print before there is one', () => {
    const doc = bookCover((d) => {
      d.look.arrangement = 'classic-centered'
    })
    const frame = artFrame(doc, measurer)!
    expect(frame.width).toBeGreaterThan(0)
    // And it is the frame the composer really uses, not a second copy of it.
    const doc2 = bookCover((d) => {
      d.look.arrangement = 'classic-centered'
      d.content.art = {
        id: 'real',
        sourceWidthPx: 2000,
        sourceHeightPx: 3000,
        provenance: null,
        ops: [],
        fit: 'cover'
      }
    })
    expect(composeCover(doc2, { measurer }).placedArt!.rect).toEqual(frame)
  })

  it('is null when the arrangement has no picture in it', () => {
    expect(artFrame(bookCover(), measurer)).toBeNull()
  })
})

describe('a cover with no picture is still designed', () => {
  it('sets the title down the panel and the author near the foot', () => {
    // Type starting at the top safe line with three inches of nothing below it
    // reads as a cover that lost its illustration, not as one that never had a
    // picture in it.
    const { items, geometry } = composeCover(bookCover(), { measurer })
    const front = texts(items).filter((t) => t.xPt / 72 > geometry.front.x && !t.rotate)
    const title = front.find((t) => t.text.toUpperCase().includes('TREATISE'))!
    const author = front.find((t) => t.text.includes('Amos'))!
    const panelTop = geometry.frontSafe.y
    const panelBottom = geometry.frontSafe.y + geometry.frontSafe.height

    expect(title.yPt / 72).toBeGreaterThan(panelTop + geometry.frontSafe.height * 0.1)
    expect(author.yPt / 72).toBeGreaterThan(panelTop + geometry.frontSafe.height * 0.6)
    expect(author.yPt / 72).toBeLessThan(panelBottom)
  })
})
