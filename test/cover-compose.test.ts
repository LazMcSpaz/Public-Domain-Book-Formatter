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
  contains,
  GROUND_IMAGE_ID,
  groundPattern,
  isImageGround,
  PATTERN_OPACITY,
  PRESS_MARK_ID,
  composeCover,
  coverGeometry,
  defaultCover,
  fitArt,
  fitText,
  itemBounds,
  overlaps,
  wrapText,
  BLURB_PT,
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

describe('a volume that binds two works', () => {
  function omnibus(): CoverDocument {
    const doc = defaultCover('6x9', 168)
    doc.content.title = 'The Astral World and The Human Aura'
    doc.content.works = ['The Astral World', 'The Human Aura']
    doc.content.author = 'Swami Panchadasi'
    doc.look.arrangement = 'typographic'
    return doc
  }

  it('sets every work at the same size', () => {
    // The point of the whole branch: two treatises bound together are two
    // treatises. Setting the longer one smaller so it fits would say the
    // shorter one matters more.
    const { items } = composeCover(omnibus(), { measurer })
    const astral = texts(items).find((t) => t.text.toUpperCase().includes('ASTRAL'))!
    const aura = texts(items).find((t) => t.text.toUpperCase().includes('AURA'))!
    expect(astral.sizePt).toBe(aura.sizePt)
  })

  it('joins the works with an italic “and”', () => {
    const { items } = composeCover(omnibus(), { measurer })
    const set = texts(items)
    const conjunction = set.find((t) => t.text === 'and')!
    expect(conjunction.font.style).toBe('italic')
    expect(conjunction.sizePt).toBeLessThan(
      set.find((t) => t.text.toUpperCase().includes('ASTRAL'))!.sizePt
    )
  })

  it('never subordinates the second work to the first', () => {
    // The failure this branch exists to prevent: the second work in `subtitle`,
    // which sets smaller and italic and is a false claim about the book.
    const { items } = composeCover(omnibus(), { measurer })
    const aura = texts(items).find((t) => t.text.toUpperCase().includes('AURA'))!
    expect(aura.font.style).toBe('regular')
  })

  it('says nothing about the count unless the press asks it to', () => {
    // Two titles under one rule with an italic `and` between already say it.
    // A label above them, stacked under a series line, is one line of small
    // capitals too many — so it is off unless a look turns it on.
    const quiet = omnibus()
    expect(
      texts(composeCover(quiet, { measurer }).items).some((t) => t.text.includes('WORKS'))
    ).toBe(false)
  })

  it('counts in words, and counts right, when it is asked to', () => {
    const three = omnibus()
    three.look.announceWorks = true
    three.content.works = ['The Astral World', 'The Human Aura', 'The Inner Consciousness']
    const { items } = composeCover(three, { measurer })
    expect(texts(items).some((t) => t.text === 'THREE WORKS')).toBe(true)
  })

  it('puts no rule above the titles', () => {
    // Closed underneath and open at the top, so the series line above reads as
    // belonging to the cover rather than being boxed in with the titles.
    const doc = omnibus()
    const { items, geometry } = composeCover(doc, { measurer })
    const rules = items.filter((i) => i.kind === 'rule' && i.xPt / 72 > geometry.front.x)
    const firstTitle = texts(items).find((t) => t.text.toUpperCase().includes('ASTRAL'))!
    for (const rule of rules) {
      expect(rule.yPt).toBeGreaterThan(firstTitle.yPt)
    }
  })

  it('leaves an ordinary book exactly as it was', () => {
    const single = omnibus()
    single.content.works = []
    single.content.title = 'The Astral World'
    const { items } = composeCover(single, { measurer })
    expect(texts(items).some((t) => t.text.includes('WORKS'))).toBe(false)
    expect(texts(items).some((t) => t.text === 'and')).toBe(false)
  })

  it('keeps every line of type inside the safe area', () => {
    const { items, geometry } = composeCover(omnibus(), { measurer })
    for (const item of texts(items)) {
      const rect = itemBounds(item)!
      expect(rect.x).toBeGreaterThanOrEqual(geometry.backSafe.x - 1e-6)
      expect(rect.x + rect.width).toBeLessThanOrEqual(
        geometry.front.x + geometry.front.width - 0.25 + 1e-6
      )
    }
  })
})

describe("the press's mark", () => {
  const mark = {
    dataUrl: 'data:image/png;base64,AAAA',
    widthPx: 650,
    heightPx: 650,
    fileName: 'libri-vetus.png'
  }

  it('sits at the foot of the spine, clear of the trim', () => {
    const doc = bookCover((d) => {
      d.look.pressMark = mark
    })
    const { items, geometry } = composeCover(doc, { measurer })
    const placed = items.find((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)!
    if (placed.kind !== 'image') throw new Error('unreachable')
    const rect = itemBounds(placed)!
    expect(rect.y + rect.height).toBeLessThanOrEqual(
      geometry.spine.y + geometry.spine.height - 0.25 + 1e-6
    )
    // Centred across the fold, and inside it.
    expect(rect.x).toBeGreaterThan(geometry.spine.x)
    expect(rect.x + rect.width).toBeLessThan(geometry.spine.x + geometry.spine.width)
    expect(rect.x + rect.width / 2).toBeCloseTo(geometry.spine.x + geometry.spine.width / 2, 6)
  })

  it('never distorts the device', () => {
    const doc = bookCover((d) => {
      d.look.pressMark = { ...mark, widthPx: 300, heightPx: 600 }
    })
    const { items } = composeCover(doc, { measurer })
    const placed = items.find((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)!
    if (placed.kind !== 'image') throw new Error('unreachable')
    expect(placed.heightPt / placed.widthPt).toBeCloseTo(2, 6)
  })

  it('makes room for itself — the spine text stops above it', () => {
    const withMark = bookCover((d) => {
      d.look.pressMark = mark
    })
    const without = bookCover()
    const runOf = (doc: CoverDocument) => {
      const { items } = composeCover(doc, { measurer })
      const spine = texts(items).find((t) => t.rotate === -90)!
      return { start: spine.yPt, length: spine.widthPt }
    }
    // The text is centred in what is left, so it starts higher up the fold.
    expect(runOf(withMark).start).toBeLessThan(runOf(without).start)
  })

  it('is left off a spine too narrow to show it, and says so', () => {
    // A 40-page book has a tenth of an inch of fold. Shrinking the device to
    // fit would print a smudge with a shape it can no longer show, so it is
    // reported instead — the same rule a dropped footnote gets.
    const doc = bookCover((d) => {
      d.pageCount = 40
      d.look.pressMark = mark
    })
    const { items, warnings } = composeCover(doc, { measurer })
    expect(items.some((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)).toBe(false)
    expect(warnings.join(' ')).toMatch(/too narrow to print the press's mark/)
  })

  it('prints once the fold is wide enough', () => {
    const doc = bookCover((d) => {
      d.pageCount = 140
      d.look.pressMark = mark
    })
    const { items, warnings } = composeCover(doc, { measurer })
    expect(items.some((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)).toBe(true)
    expect(warnings.join(' ')).not.toMatch(/press's mark/)
  })

  it('is absent when no press has one', () => {
    const { items } = composeCover(bookCover(), { measurer })
    expect(items.some((i) => i.kind === 'image')).toBe(false)
  })
})

describe('the ground pattern', () => {
  function grounded(pattern: 'laid' | 'aura' | 'guilloche' | 'fleuron'): CoverDocument {
    const doc = bookCover((d) => {
      d.look.groundPattern = pattern
      d.look.ornamentId = BUILTIN_ORNAMENTS[0]!.id
    })
    return doc
  }

  it('runs across the whole wrap, under everything else', () => {
    const { items, geometry } = composeCover(grounded('aura'), {
      measurer,
      ornaments: BUILTIN_ORNAMENTS
    })
    const ground = items.filter((i) => i.kind === 'ornament' && i.opacity !== undefined)
    expect(ground.length).toBeGreaterThan(0)
    // Under the type: the ground is emitted before any text is set.
    const firstText = items.findIndex((i) => i.kind === 'text')
    const firstGround = items.findIndex((i) => i.kind === 'ornament' && i.opacity !== undefined)
    expect(firstGround).toBeLessThan(firstText)
    // And it spans the sheet rather than a panel.
    const art = ground[0]!
    if (art.kind !== 'ornament') throw new Error('unreachable')
    expect(art.art.width).toBeCloseTo(geometry.fullWidthIn * 72, 4)
  })

  it('prints faint enough to be a surface, and not so faint the press loses it', () => {
    for (const pattern of ['laid', 'aura', 'guilloche'] as const) {
      const { items } = composeCover(grounded(pattern), { measurer, ornaments: BUILTIN_ORNAMENTS })
      const ground = items.find((i) => i.kind === 'ornament' && i.opacity !== undefined)!
      if (ground.kind !== 'ornament') throw new Error('unreachable')
      // Below about five per cent a print-on-demand press either drops the tint
      // or mottles it; above about a sixth it stops being a ground.
      expect(ground.opacity!).toBeGreaterThanOrEqual(0.05)
      expect(ground.opacity!).toBeLessThanOrEqual(0.16)
    }
  })

  it('never draws a stroke too fine to survive the press', () => {
    for (const pattern of ['laid', 'aura', 'guilloche'] as const) {
      const { items } = composeCover(grounded(pattern), { measurer, ornaments: BUILTIN_ORNAMENTS })
      const ground = items.find((i) => i.kind === 'ornament' && i.opacity !== undefined)!
      if (ground.kind !== 'ornament') throw new Error('unreachable')
      for (const shape of ground.art.shapes) {
        if (shape.stroke !== undefined) expect(shape.stroke).toBeGreaterThanOrEqual(0.5)
      }
    }
  })

  it('repeats a shipped fleuron without touching its path data', () => {
    // The bug this replaced rewrote coordinates in the `d` string and produced
    // a field of horizontal dashes. The art now travels untouched.
    const { items } = composeCover(grounded('fleuron'), {
      measurer,
      ornaments: BUILTIN_ORNAMENTS
    })
    const ground = items.filter((i) => i.kind === 'ornament' && i.opacity !== undefined)
    expect(ground.length).toBeGreaterThan(20)
    for (const item of ground) {
      if (item.kind !== 'ornament') throw new Error('unreachable')
      expect(item.art.shapes).toEqual(BUILTIN_ORNAMENTS[0]!.shapes)
    }
  })

  it('says so when a fleuron ground has no fleuron to repeat', () => {
    const doc = bookCover((d) => {
      d.look.groundPattern = 'fleuron'
    })
    const { warnings } = composeCover(doc, { measurer })
    expect(warnings.join(' ')).toMatch(/needs an ornament to repeat/)
  })

  it('is absent unless a look asks for one', () => {
    const { items } = composeCover(bookCover(), { measurer, ornaments: BUILTIN_ORNAMENTS })
    expect(items.some((i) => i.kind === 'ornament' && i.opacity !== undefined)).toBe(false)
  })
})

describe('a picture-backed ground', () => {
  function marbled(): CoverDocument {
    return bookCover((d) => {
      d.look.groundPattern = 'marbled'
    })
  }

  it('covers the whole sheet, bleed included', () => {
    const { items, geometry } = composeCover(marbled(), { measurer })
    const ground = items.find((i) => i.kind === 'image' && i.id === GROUND_IMAGE_ID)!
    if (ground.kind !== 'image') throw new Error('unreachable')
    expect(ground.xPt).toBe(0)
    expect(ground.yPt).toBe(0)
    expect(ground.widthPt).toBeCloseTo(geometry.fullWidthIn * 72, 4)
    expect(ground.heightPt).toBeCloseTo(geometry.fullHeightIn * 72, 4)
  })

  it('carries the opacity the pattern asks for', () => {
    const { items } = composeCover(marbled(), { measurer })
    const ground = items.find((i) => i.kind === 'image' && i.id === GROUND_IMAGE_ID)!
    if (ground.kind !== 'image') throw new Error('unreachable')
    expect(ground.opacity).toBe(PATTERN_OPACITY.marbled)
  })

  it('draws no paths — the picture is the pattern', () => {
    // `drawSvgPath` writes one flat fill per path, so a traced raster with
    // gradients in it would come out solid. It goes down the picture path
    // instead, and `groundPattern` says so by returning nothing.
    expect(groundPattern('marbled', 100, 100, BUILTIN_ORNAMENTS[0]!)).toEqual([])
    expect(isImageGround('marbled')).toBe(true)
    expect(isImageGround('guilloche')).toBe(false)
  })

  it('sits under everything else on the sheet', () => {
    const { items } = composeCover(marbled(), { measurer })
    const ground = items.findIndex((i) => i.kind === 'image' && i.id === GROUND_IMAGE_ID)
    const firstText = items.findIndex((i) => i.kind === 'text')
    expect(ground).toBeLessThan(firstText)
  })

  it('leaves its pixel count for the renderer to fill in', () => {
    // A vector source has no pixel count; the size is decided by where it is
    // placed, which only the renderer knows.
    const { items } = composeCover(marbled(), { measurer })
    const ground = items.find((i) => i.kind === 'image' && i.id === GROUND_IMAGE_ID)!
    if (ground.kind !== 'image') throw new Error('unreachable')
    expect(ground.srcWidth).toBe(0)
  })
})

describe('the back cover is set to a readable measure', () => {
  it('sits an inch in from both trimmed edges of the back panel', () => {
    const g = coverGeometry({ trimSize: '6x9', pageCount: 168, paper: 'bw-cream' })
    const frame = blurbFrame(g)
    expect(frame.x - g.back.x).toBeCloseTo(1, 6)
    expect(g.back.x + g.back.width - (frame.x + frame.width)).toBeCloseTo(1, 6)
    expect(frame.width).toBeCloseTo(4, 6)
  })

  it('narrows and centres rather than stretching on a wide trim', () => {
    // An inch either side of an 8.5×11 still leaves six and a half inches,
    // which is a hundred and thirteen characters a line and worse than the
    // problem the inset was added to fix.
    const g = coverGeometry({ trimSize: '8.5x11', pageCount: 200, paper: 'bw-white' })
    const frame = blurbFrame(g)
    expect(frame.width).toBeLessThan(g.back.width - 2)
    const leftGap = frame.x - g.back.x
    const rightGap = g.back.x + g.back.width - (frame.x + frame.width)
    expect(leftGap).toBeCloseTo(rightGap, 6)
  })

  it('keeps the copy clear of the barcode and inside the safe area', () => {
    const g = coverGeometry({ trimSize: '6x9', pageCount: 168, paper: 'bw-cream' })
    const frame = blurbFrame(g)
    expect(overlaps(frame, g.barcode)).toBe(false)
    expect(contains(g.backSafe, frame)).toBe(true)
  })

  it('aligns the imprint with the copy above it', () => {
    const doc = bookCover((d) => {
      d.content.blurb = 'A paragraph of back-cover copy.'
      d.content.imprint = 'Libri Vetus'
    })
    const { items, geometry } = composeCover(doc, { measurer })
    const frame = blurbFrame(geometry)
    const imprint = texts(items).find((t) => t.text === 'Libri Vetus')!
    // Not the safe area: an imprint three quarters of an inch to the left of
    // the only other text on the panel reads as having come adrift from it.
    expect(imprint.xPt / 72).toBeCloseTo(frame.x, 6)
  })
})

describe("the blurb is the editor's own prose, and is set as such", () => {
  /** Every text item inside the blurb's frame, in the order it is drawn. */
  function blurbItems(blurb: string, m = measurer): CoverTextItem[] {
    const doc = bookCover((d) => {
      d.content.blurb = blurb
      d.content.imprint = ''
    })
    const { items, geometry } = composeCover(doc, { measurer: m })
    const frame = blurbFrame(geometry)
    // Bounded in both axes: the front panel's own type sits at some of the
    // same heights, and a y-only filter quietly mixes it in.
    return texts(items).filter(
      (t) =>
        t.yPt / 72 >= frame.y - 0.1 &&
        t.yPt / 72 <= frame.y + frame.height + 0.1 &&
        t.xPt / 72 >= frame.x - 0.1 &&
        t.xPt / 72 <= frame.x + frame.width + 0.1
    )
  }

  it('sets a named book in italic rather than printing its tags', () => {
    const drawn = blurbItems('Five years before <i>The Secret Teachings</i> was published.')
    // No tag survives into anything that gets drawn. The fault this replaces
    // printed the angle brackets, so the whole line came out in one roman run.
    expect(drawn.map((t) => t.text).join('')).not.toMatch(/[<>]/)
    const italic = drawn.filter((t) => t.font.style === 'italic')
    expect(italic.length).toBeGreaterThan(0)
    expect(italic.map((t) => t.text.trim()).join(' ')).toBe('The Secret Teachings')
    // And the words either side of it stay roman.
    const roman = drawn.filter((t) => t.font.style === 'regular')
    expect(roman.map((t) => t.text).join('')).toContain('Five years before')
    expect(roman.map((t) => t.text).join('')).toContain('was published')
  })

  it('draws the runs of a line end to end', () => {
    const drawn = blurbItems('Before <i>Isis Unveiled</i> there was nothing.')
    const line = drawn.filter((t) => Math.abs(t.yPt - drawn[0]!.yPt) < 0.01)
    expect(line.length).toBeGreaterThan(1)
    for (let i = 1; i < line.length; i++) {
      // Each run begins exactly where the last ended, so the writer advances
      // by widths this pass measured and never re-derives a word space.
      expect(line[i]!.xPt).toBeCloseTo(line[i - 1]!.xPt + line[i - 1]!.widthPt, 6)
    }
  })

  it('breaks on the whole line, the emphasis included', () => {
    const bare =
      'A paragraph long enough to break, naming The Secret Teachings of All Ages ' +
      'somewhere in the middle of it, and running on afterwards for a while yet.'
    const marked = bare.replace(
      'The Secret Teachings of All Ages',
      '<i>The Secret Teachings of All Ages</i>'
    )
    const drawn = blurbItems(marked)
    const g = coverGeometry({ trimSize: '6x9', pageCount: 284, paper: 'bw-cream' })
    const frame = blurbFrame(g)

    // A line is several items now, so its width is their sum — and a breaker
    // that measured only the run it started in would set past the measure
    // without any single item doing so.
    const byLine = new Map<number, CoverTextItem[]>()
    for (const t of drawn) byLine.set(t.yPt, [...(byLine.get(t.yPt) ?? []), t])
    expect(byLine.size).toBeGreaterThan(2)
    for (const line of byLine.values()) {
      const width = line.reduce((w, t) => w + t.widthPt, 0)
      expect(width).toBeLessThanOrEqual(frame.width * 72 + 1e-6)
    }

    // Measured against the same text with no tags in it: the fake measurer
    // gives both faces the same advances, so the words must fall identically.
    const lines = [...byLine.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, runs]) =>
        runs
          .map((t) => t.text)
          .join('')
          .trim()
      )
    expect(lines).toEqual(
      wrapText(bare, frame.width * 72, { family: 'x', style: 'regular' }, 10.5, measurer)
    )
  })

  it("turns the editor's typewriter quotes into printer's quotes", () => {
    const drawn = blurbItems('No. 1 calls it "Black Magic pure and simple", and it isn\'t gentle.')
    const set = drawn.map((t) => t.text).join('')
    expect(set).not.toMatch(/["']/)
    expect(set).toContain('\u201cBlack')
    expect(set).toContain('simple\u201d')
    expect(set).toContain('isn\u2019t')
  })

  it('sets a strong run in italic in a face with no bold, and bold in one with', () => {
    // The same refusal the layout engine makes: never a synthesised bold.
    const plain = blurbItems('The rule is <b>never</b> broken.')
    expect(plain.find((t) => t.text.trim() === 'never')!.font.style).toBe('italic')

    const bolder = blurbItems('The rule is <b>never</b> broken.', {
      ...measurer,
      hasBold: () => true
    })
    expect(bolder.find((t) => t.text.trim() === 'never')!.font.style).toBe('bold')
  })
})

describe('the back cover sets its copy at the size the look asks for', () => {
  function blurbText(patch: (doc: CoverDocument) => void): CoverTextItem[] {
    const doc = bookCover((d) => {
      d.content.blurb = 'A paragraph of back-cover copy, long enough to break over two lines.'
      d.content.imprint = ''
      patch(d)
    })
    const { items, geometry } = composeCover(doc, { measurer })
    const frame = blurbFrame(geometry)
    return texts(items).filter(
      (t) => t.xPt / 72 >= frame.x - 0.5 && t.xPt / 72 <= frame.x + frame.width + 0.5
    )
  }

  it('uses the default when the look names none', () => {
    for (const t of blurbText(() => {})) expect(t.sizePt).toBe(BLURB_PT)
  })

  it('sets every run at the asked size, and leads from it', () => {
    const drawn = blurbText((d) => {
      d.look.blurbSizePt = 13.5
    })
    for (const t of drawn) expect(t.sizePt).toBe(13.5)
    const ys = [...new Set(drawn.map((t) => t.yPt))].sort((a, b) => a - b)
    expect(ys.length).toBeGreaterThan(1)
    // The leading is a share of the size, not of the default: a larger size
    // set on the old grid would print its lines through each other.
    expect(ys[1]! - ys[0]!).toBeCloseTo(13.5 * 1.4, 6)
  })

  it('reports copy it had to cut rather than cutting it in silence', () => {
    const doc = bookCover((d) => {
      d.content.blurb = 'Sentence after sentence of back-cover copy. '.repeat(60)
      d.look.blurbSizePt = 13.5
    })
    const { warnings } = composeCover(doc, { measurer })
    expect(warnings.some((w) => /back-cover copy is longer/.test(w))).toBe(true)
    // And a blurb that fits says nothing about its length.
    expect(
      composeCover(bookCover(), { measurer }).warnings.some((w) =>
        /back-cover copy is longer/.test(w)
      )
    ).toBe(false)
  })
})

describe('a frame can be struck round the back-cover copy', () => {
  /** The fills of the blurb's box, by their bounds. */
  function boxAndCopy(style: 'none' | 'plain' | 'double') {
    const doc = bookCover((d) => {
      d.content.blurb = 'A paragraph of back-cover copy, long enough to break over two lines.'
      d.content.imprint = ''
      d.look.blurbBorder = style
      d.look.blurbSizePt = 12
    })
    const { items, geometry } = composeCover(doc, { measurer })
    const frame = blurbFrame(geometry)
    const copy = texts(items).filter(
      (t) => t.xPt / 72 >= frame.x - 0.5 && t.xPt / 72 <= frame.x + frame.width + 0.5
    )
    const rules = items
      .filter((i): i is Extract<typeof i, { kind: 'fill' }> => i.kind === 'fill')
      .filter(
        (f) => f.xPt / 72 > geometry.back.x && f.xPt / 72 < geometry.back.x + geometry.back.width
      )
    return { items, geometry, frame, copy, rules }
  }

  it('draws nothing when none is asked for', () => {
    expect(boxAndCopy('none').rules).toEqual([])
  })

  it('encloses the copy with white around it, and nothing else', () => {
    const { copy, rules, geometry } = boxAndCopy('plain')
    expect(rules.length).toBe(4)
    const left = Math.min(...rules.map((r) => r.xPt))
    const right = Math.max(...rules.map((r) => r.xPt + r.widthPt))
    const top = Math.min(...rules.map((r) => r.yPt))
    const bottom = Math.max(...rules.map((r) => r.yPt + r.heightPt))

    const copyLeft = Math.min(...copy.map((t) => t.xPt))
    const copyRight = Math.max(...copy.map((t) => t.xPt + t.widthPt))
    const copyTop = Math.min(...copy.map((t) => t.yPt - t.ascentPt))
    const copyBottom = Math.max(...copy.map((t) => t.yPt + t.descentPt))
    expect(left).toBeLessThan(copyLeft)
    expect(right).toBeGreaterThan(copyRight)
    expect(top).toBeLessThan(copyTop)
    expect(bottom).toBeGreaterThan(copyBottom)

    // Round the copy, not round the frame it was set in: that frame runs down
    // to the barcode, so a box on it would stand on empty board.
    expect(bottom / 72).toBeLessThan(geometry.barcode.y)
    expect((bottom - top) / 72).toBeLessThan(geometry.backSafe.height / 2)
    // And inside the safe area, which is what the padding has to respect.
    expect(
      contains(geometry.backSafe, {
        x: left / 72,
        y: top / 72,
        width: (right - left) / 72,
        height: (bottom - top) / 72
      })
    ).toBe(true)
  })

  it('draws two rules a side for a double frame', () => {
    expect(boxAndCopy('double').rules.length).toBe(8)
  })

  it('grows with the copy rather than standing at a fixed height', () => {
    const short = boxAndCopy('plain')
    const doc = bookCover((d) => {
      d.content.blurb =
        'A paragraph of back-cover copy, long enough to break over two lines.\n\n'.repeat(3)
      d.content.imprint = ''
      d.look.blurbBorder = 'plain'
      d.look.blurbSizePt = 12
    })
    const { items } = composeCover(doc, { measurer })
    const rules = items.filter((i) => i.kind === 'fill' && i.heightPt < 2)
    const tall = Math.max(...rules.map((r) => ('yPt' in r ? r.yPt : 0)))
    const shortBottom = Math.max(...short.rules.map((r) => r.yPt))
    expect(tall).toBeGreaterThan(shortBottom)
  })
})

describe('the author can be set at the foot', () => {
  /** Where "Amos Root" is drawn, in points down the cover. */
  function authorY(patch: (doc: CoverDocument) => void): number {
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      patch(d)
    })
    const { items } = composeCover(doc, { measurer })
    const line = texts(items).find((t) => t.text.includes('Amos Root'))
    if (!line) throw new Error('the author was not set at all')
    return line.yPt
  }

  it('leaves it in the block under the title by default', () => {
    const { geometry } = composeCover(
      bookCover((d) => (d.look.arrangement = 'label')),
      {
        measurer
      }
    )
    // A label stacks everything near the head, so the author is above the
    // middle of the board — which is the thing the flag moves it out of.
    expect(authorY(() => {})).toBeLessThan((geometry.fullHeightIn * 72) / 2)
  })

  it('sets it exactly where a typographic cover sets it', () => {
    // The invariant rather than a proxy for it: there is one low position on
    // this board and both doors reach it, so a change to that position cannot
    // move the author on one kind of cover and leave it on the other. To
    // within a point, because the two arrangements fit the title to different
    // sizes and the author's size follows the title's, so the baselines sit a
    // fraction apart under a block top that is the same.
    const typographic = texts(composeCover(bookCover(), { measurer }).items).find((t) =>
      t.text.includes('Amos Root')
    )!
    expect(authorY((d) => (d.look.authorAtFoot = true))).toBeCloseTo(typographic.yPt, 0)
  })

  it('changes nothing on a typographic cover, which already sets it low', () => {
    const low = (flag: boolean): number => {
      const doc = bookCover((d) => (d.look.authorAtFoot = flag))
      const line = texts(composeCover(doc, { measurer }).items).find((t) =>
        t.text.includes('Amos Root')
      )!
      return line.yPt
    }
    expect(low(true)).toBeCloseTo(low(false), 9)
  })
})
