/**
 * Flattening, which KDP asks for in three words: "Flatten all transparencies."
 *
 * Every cover on this shelf went to KDP with live transparency in it — a
 * ground figure as an image with an alpha channel drawn at 12%, a plate at
 * 8%, twenty-nine wave ribbons at 2% each, a press mark with a soft mask —
 * and the editor's uploads failed to process. The writer composites the
 * translucent items and what lies under them into one opaque background and
 * draws everything else on top; these tests are the plan it does it by.
 */
import { describe, expect, it } from 'vitest'
import { fixedWidthMeasurer } from '@core/layout'
import {
  BARCODE_ID,
  composeCover,
  defaultCover,
  flattenPlan,
  isTranslucent,
  type CoverDocument,
  type CoverItem
} from '@core/cover'

const measurer = fixedWidthMeasurer(0.5)

const fill = (x: number, y: number, w: number, h: number, opacity?: number): CoverItem => ({
  kind: 'fill',
  xPt: x,
  yPt: y,
  widthPt: w,
  heightPt: h,
  color: '#336699',
  ...(opacity === undefined ? {} : { opacity })
})
const text = (x: number, y: number, s: string): CoverItem => ({
  kind: 'text',
  text: s,
  font: { family: 'x', style: 'regular' },
  sizePt: 12,
  xPt: x,
  yPt: y,
  color: '#000000',
  widthPt: 60,
  ascentPt: 9,
  descentPt: 3
})
const image = (x: number, y: number, w: number, h: number): CoverItem => ({
  kind: 'image',
  id: 'pic',
  xPt: x,
  yPt: y,
  widthPt: w,
  heightPt: h,
  srcX: 0,
  srcY: 0,
  srcWidth: 100,
  srcHeight: 100
})

describe('what counts as translucent', () => {
  it('counts every image, since a PNG may carry an alpha channel', () => {
    expect(isTranslucent(image(0, 0, 10, 10))).toBe(true)
  })
  it('counts a fill or an ornament with opacity under one', () => {
    expect(isTranslucent(fill(0, 0, 10, 10, 0.02))).toBe(true)
    expect(isTranslucent(fill(0, 0, 10, 10))).toBe(false)
    expect(isTranslucent(fill(0, 0, 10, 10, 1))).toBe(false)
  })
  it('never counts type', () => {
    expect(isTranslucent(text(0, 0, 'Title'))).toBe(false)
  })
})

describe('the plan', () => {
  it('leaves a cover with nothing translucent entirely vector', () => {
    const items = [fill(0, 0, 500, 500), text(10, 10, 'Title')]
    expect(flattenPlan(items)).toEqual({ raster: [], vector: [0, 1] })
  })

  it('puts the ground under a translucent item into the raster with it', () => {
    // The ground is what a 2% ribbon composites against; outside the raster
    // there would be nothing for it to composite with.
    const items = [fill(0, 0, 500, 500), fill(0, 0, 500, 20, 0.02), text(10, 100, 'Title')]
    const plan = flattenPlan(items)
    expect(plan.raster).toEqual([0, 1])
    expect(plan.vector).toEqual([2])
  })

  it('keeps type, rules and the barcode as vectors', () => {
    const bar: CoverItem = { ...fill(400, 400, 2, 50), id: BARCODE_ID } as CoverItem
    const items = [fill(0, 0, 500, 500), image(0, 0, 500, 300), text(10, 350, 'Title'), bar]
    const plan = flattenPlan(items)
    expect(plan.vector).toContain(2)
    expect(plan.vector).toContain(3)
    for (const i of plan.vector) expect(items[i]!.kind).not.toBe('image')
  })

  it('never leaves an image on the vector side', () => {
    // An image drawn as a vector would carry its alpha straight into the file,
    // which is the fault this module exists to remove.
    const items = [fill(0, 0, 500, 500), text(10, 10, 'A'), image(300, 300, 20, 20)]
    const plan = flattenPlan(items)
    for (const i of plan.vector) expect(items[i]!.kind).not.toBe('image')
  })

  it('refuses to lift type above something it was painted under', () => {
    // Drawing the type over the raster would put it on top of a picture that
    // was meant to cover it. Refused, not reordered in silence.
    const items = [fill(0, 0, 500, 500), text(10, 20, 'Hidden'), image(0, 0, 200, 50)]
    expect(() => flattenPlan(items)).toThrow(/cannot be flattened without changing it/)
  })
})

describe('every cover the composer makes can be flattened', () => {
  // The guard above has to be a guard and not a constraint the real covers
  // meet. These are the shapes on the shelf: a wrapped ground figure, a
  // framed plate, a ground pattern, a front device, a barcode.
  const look = (patch: (d: CoverDocument) => void): CoverDocument => {
    const d = defaultCover('7x10', 489)
    d.content = {
      ...d.content,
      title: 'The Lost Keys of Masonry',
      author: 'M. P. Hall',
      subtitle: 'A Subtitle',
      blurb: 'Copy.',
      isbn: '9798164602758'
    }
    patch(d)
    return d
  }
  const cases: [string, (d: CoverDocument) => void][] = [
    [
      'a wrapped ground figure',
      (d) => {
        d.look.groundFigure = 'all-seeing-eye-radiant'
        d.look.groundFigureWrap = true
        d.look.groundFigureOpacity = 0.12
      }
    ],
    [
      'a framed plate',
      (d) => {
        d.look.groundFigure = 'candidate-at-the-gates'
        d.look.groundFigureInFrame = true
        d.look.frontFrame = 'double'
        d.look.groundFigureOpacity = 0.08
      }
    ],
    [
      'a ground pattern',
      (d) => {
        d.look.groundPattern = 'wave'
        d.look.groundPatternOpacity = 0.02
      }
    ],
    [
      'a device on the front and a mark on the spine',
      (d) => {
        const mark = { dataUrl: 'data:,', fileName: 'mark.svg', widthPx: 100, heightPx: 100 }
        d.look.pressMark = mark
        d.look.frontMark = mark
        d.look.markOnFront = true
      }
    ]
  ]
  for (const [name, patch] of cases) {
    it(`flattens ${name}`, () => {
      const composed = composeCover(look(patch), { measurer })
      const plan = flattenPlan(composed.items)
      expect(plan.raster.length).toBeGreaterThan(0)
      for (const i of plan.vector) {
        const item = composed.items[i]!
        expect(item.kind).not.toBe('image')
        if ('opacity' in item) expect(item.opacity ?? 1).toBe(1)
      }
    })
  }
})
