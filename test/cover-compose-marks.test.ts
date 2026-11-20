/**
 * (Split from `cover-compose.test.ts` to keep each file short; shares its fixtures.)
 *
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
  GROUND_IMAGE_ID,
  groundPattern,
  isImageGround,
  WAVE_PERIOD_IN,
  waveOffset,
  PATTERN_OPACITY,
  defaultLook,
  FRONT_MARK_ID,
  PRESS_MARK_ID,
  SPINE_TEXT_CLEARANCE_IN,
  composeCover,
  defaultCover,
  type CoverDocument
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

describe('the press mark on a narrow spine', () => {
  const inkball = {
    dataUrl: 'data:image/svg+xml;base64,aaa',
    widthPx: 100,
    heightPx: 100,
    fileName: 'inkball.svg'
  }

  function markOn(pages: number) {
    const doc = defaultCover('6x9', pages)
    // The stock the real books print on. `defaultCover` is cream, which folds
    // thicker per page, and a fixture on cream gave the slim case a 0.44 in
    // spine instead of 0.39 — wide enough that both the old share and the new
    // one cleared the threshold below, so the test passed against the fault.
    doc.paper = 'bw-white'
    doc.content.title = 'A Book'
    doc.content.author = 'A Name'
    doc.look.pressMark = inkball
    const { items, geometry } = composeCover(doc, { measurer })
    const mark = items.find((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)
    // Null where the fold is too narrow to print it legibly: that case is
    // reported as a warning and leaving the mark off is the right answer, so
    // it is a result here rather than a failure.
    if (!mark || mark.kind !== 'image') return { widthIn: null, spineIn: geometry.spineIn }
    return { widthIn: mark.widthPt / 72, spineIn: geometry.spineIn }
  }

  it('fills what a slim fold allows rather than a fixed share of it', () => {
    // A 175-page book folds at about 0.39 in. The mark was taking 0.78 of
    // that, which printed it half the size of the same mark on a 470-page
    // book standing beside it on a shelf.
    const slim = markOn(175)
    expect(slim.spineIn).toBeLessThan(0.45)
    expect(slim.widthIn).not.toBeNull()
    // 0.95 of a 0.269 in fold is 0.256; the old 0.78 gave 0.210.
    expect(slim.widthIn!).toBeGreaterThan(0.25)
  })

  it('leaves a thick spine exactly where it was, because the ceiling binds', () => {
    // The share only governs a narrow fold. Raising it must not grow the mark
    // on the books already approved.
    const fat = markOn(474)
    expect(fat.widthIn).not.toBeNull()
    expect(fat.widthIn!).toBeCloseTo(0.42, 3)
  })

  it('never lets the mark reach the fold', () => {
    let placed = 0
    for (const pages of [120, 175, 300, 474, 800]) {
      const { widthIn, spineIn } = markOn(pages)
      if (widthIn === null) continue
      placed += 1
      expect(widthIn).toBeLessThanOrEqual(spineIn - SPINE_TEXT_CLEARANCE_IN * 2 + 1e-9)
    }
    // And the loop has to have had something to check.
    expect(placed).toBeGreaterThanOrEqual(4)
  })
})

describe('the printer\u2019s mark and the book\u2019s emblem are two things', () => {
  // Deliberately different proportions. The composer records a placed size
  // rather than which file fills it, so a square mark and a tall one are what
  // let this tell them apart at all: asserting that both items merely *exist*
  // passes with the front drawing the press mark, which was the first version
  // of this test and caught nothing.
  const inkball = {
    dataUrl: 'data:image/svg+xml;base64,aaa',
    widthPx: 100,
    heightPx: 100,
    fileName: 'inkball.svg'
  }
  const seal = {
    dataUrl: 'data:image/svg+xml;base64,bbb',
    widthPx: 100,
    heightPx: 250,
    fileName: 'seal.svg'
  }

  it('puts the press mark on the spine and the front mark on the board', () => {
    // They shared a slot, so giving a book the printer's mark on its spine
    // took its own emblem off the front. A publisher prints one device on
    // everything; what belongs on the board is usually the book's.
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      d.look.frontFrame = 'double'
      d.look.pressMark = inkball
      d.look.frontMark = seal
      d.look.markOnFront = true
    })
    const { items } = composeCover(doc, { measurer })
    const spine = items.find((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)
    const front = items.find((i) => i.kind === 'image' && i.id === FRONT_MARK_ID)
    expect(spine).toBeDefined()
    expect(front).toBeDefined()
    if (front?.kind !== 'image') throw new Error('unreachable')
    // The seal is two and a half times as tall as it is wide; the inkball is
    // square. The front item's own proportions say which one was placed.
    expect(front.heightPt / front.widthPt).toBeCloseTo(2.5, 2)
  })

  it('falls back to the press mark when no emblem is given', () => {
    // Every look banked before this has no front mark, and must be unchanged.
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      d.look.pressMark = inkball
      d.look.markOnFront = true
    })
    const { items } = composeCover(doc, { measurer })
    const front = items.find((i) => i.kind === 'image' && i.id === FRONT_MARK_ID)
    if (front?.kind !== 'image') throw new Error('unreachable')
    expect(front.heightPt / front.widthPt).toBeCloseTo(1, 2)
    expect(defaultLook().frontMark).toBeNull()
  })

  it('still carries the spine mark when nothing is on the front', () => {
    const doc = bookCover((d) => {
      d.look.pressMark = inkball
      d.look.markOnFront = false
    })
    const { items } = composeCover(doc, { measurer })
    expect(items.some((i) => i.kind === 'image' && i.id === PRESS_MARK_ID)).toBe(true)
    expect(items.some((i) => i.kind === 'image' && i.id === FRONT_MARK_ID)).toBe(false)
  })
})

describe('the flowing-ribbon ground', () => {
  const W = 12.644 * 72
  const H = 9.25 * 72
  const shapes = () => groundPattern('wave', W, H, null)[0]!.art.shapes

  it('fills its bands rather than stroking them', () => {
    expect(isImageGround('wave')).toBe(false)
    const all = shapes()
    expect(all.length).toBeGreaterThan(10)
    for (const shape of all) {
      // A filled ornament shape carries no stroke; a stroked one would print
      // each ribbon's two edges as lines through the fill.
      expect(shape.stroke).toBeUndefined()
      expect(shape.d.endsWith('Z')).toBe(true)
    }
  })

  it('keeps the warp rising, so no ribbon laps over its neighbour', () => {
    // The whole construction rests on `u = y + W` rising with y: where it
    // does not, a band doubles back, its outline crosses itself, and it
    // prints as a blot lapping the band beside it. Differentiated, that holds
    // while the sum of each term's amplitude times its y-rate is under 1, and
    // the shipped numbers are close enough to the line to be worth walking.
    let worst = Infinity
    const d = 0.004
    for (let x = -0.3; x <= 13; x += 0.08) {
      for (let y = -1.5; y <= 11; y += 0.05) {
        const rise = (y + d + waveOffset(x, y + d) - (y + waveOffset(x, y))) / d
        worst = Math.min(worst, rise)
      }
    }
    expect(worst).toBeGreaterThan(0)
  })

  it('swells and pinches rather than running at one width', () => {
    // The pinch is the look. A band's thickness in y is the period over the
    // warp's rise, so a flat warp would print even stripes and no amount of
    // waviness would rescue it.
    const widths: number[] = []
    for (const shape of shapes().slice(4, 12)) {
      const pts = [...shape.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [+m[1]!, +m[2]!])
      const half = pts.length / 2
      for (let i = 0; i < half; i += 7) {
        const top = pts[i]!
        const bottom = pts[pts.length - 1 - i]!
        if (Math.abs(top[0]! - bottom[0]!) < 1) widths.push(Math.abs(bottom[1]! - top[1]!))
      }
    }
    expect(widths.length).toBeGreaterThan(20)
    expect(Math.max(...widths) / Math.min(...widths)).toBeGreaterThan(3)
  })

  it('leaves no gap along any edge, at any point across it', () => {
    // A ribbon family that stopped at the trim would leave the board bare
    // along part of the cut. Every x has to have ink above the top edge and
    // below the foot.
    const byX = new Map<string, { min: number; max: number }>()
    for (const shape of shapes()) {
      for (const m of shape.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)) {
        const key = Number(m[1]).toFixed(0)
        const y = Number(m[2])
        const seen = byX.get(key)
        if (!seen) byX.set(key, { min: y, max: y })
        else {
          seen.min = Math.min(seen.min, y)
          seen.max = Math.max(seen.max, y)
        }
      }
    }
    expect(byX.size).toBeGreaterThan(100)
    for (const [x, { min, max }] of byX) {
      expect(min, `top edge bare at x=${x}`).toBeLessThan(0)
      expect(max, `foot bare at x=${x}`).toBeGreaterThan(H)
    }
  })

  it('spaces its bands by the period it declares', () => {
    expect(WAVE_PERIOD_IN).toBeGreaterThan(0.2)
    expect(WAVE_PERIOD_IN).toBeLessThan(1)
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
