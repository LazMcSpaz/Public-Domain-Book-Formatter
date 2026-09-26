/**
 * The frame round the front cover, and the device over the type.
 *
 * Both are things a reader sees before they read a word, and both fail
 * *quietly* — a frame struck through the title still prints, and a device
 * rasterised for the spine and drawn an inch wide on the board is simply a
 * coarse picture. So what is pinned here is the geometry: where the frame
 * lands, that nothing else lands on it, and that the type is fitted to the
 * space the device leaves rather than to the space there would have been.
 */
import { describe, expect, it } from 'vitest'
import { fixedWidthMeasurer } from '@core/layout'
import {
  composeCover,
  coverGeometry,
  defaultCover,
  FRAME_CLEARANCE_IN,
  FRAME_INSET_IN,
  FRONT_MARK_ID,
  frontTypeArea,
  itemBounds,
  PRESS_MARK_ID,
  PT_PER_INCH,
  type CoverDocument,
  type CoverImageItem,
  type CoverTextItem
} from '@core/cover'

const measurer = fixedWidthMeasurer()
const geometry = coverGeometry({ trimSize: '6x9', pageCount: 284, paper: 'bw-cream' })

const MARK = {
  dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
  widthPx: 400,
  heightPx: 200,
  fileName: 'device.svg'
}

function cover(patch: (doc: CoverDocument) => void = () => {}): CoverDocument {
  const doc = defaultCover('6x9', 284)
  doc.content.title = 'The Secret Doctrine'
  doc.content.author = 'H. P. Blavatsky'
  doc.content.imprint = 'Blackthorn Press'
  doc.look.imprintOnFront = true
  doc.look.arrangement = 'classic-centered'
  patch(doc)
  return doc
}

function compose(doc: CoverDocument) {
  return composeCover(doc, { measurer })
}

describe('frontTypeArea', () => {
  it('is the safe area when nothing is struck round it', () => {
    expect(frontTypeArea(geometry, 'none')).toEqual(geometry.frontSafe)
  })

  it('is what the frame leaves, which is inside the safe area', () => {
    const area = frontTypeArea(geometry, 'plain')
    const inset = FRAME_INSET_IN + FRAME_CLEARANCE_IN
    expect(area.x).toBeCloseTo(geometry.front.x + inset, 6)
    expect(area.width).toBeCloseTo(geometry.front.width - inset * 2, 6)
    // The point of it: narrower than the safe area, not merely different.
    expect(area.width).toBeLessThan(geometry.frontSafe.width)
  })
})

describe('the frame', () => {
  it('is drawn in the accent colour, an eighth inside the safe line', () => {
    const doc = cover((d) => {
      d.look.frontFrame = 'plain'
      d.look.palette.accent = '#c9a227'
    })
    const bars = compose(doc).items.filter((i) => i.kind === 'fill' && i.color === '#c9a227')
    // Four sides.
    expect(bars).toHaveLength(4)
    // `itemBounds` answers in inches, as the geometry does.
    const boxes = bars.map((b) => itemBounds(b)!)
    const left = Math.min(...boxes.map((b) => b.x))
    const top = Math.min(...boxes.map((b) => b.y))
    expect(left).toBeCloseTo(geometry.front.x + FRAME_INSET_IN, 6)
    expect(top).toBeCloseTo(geometry.front.y + FRAME_INSET_IN, 6)
    expect(left).toBeGreaterThan(geometry.frontSafe.x)
  })

  it('strikes a second, thinner line when it is doubled', () => {
    const plain = compose(cover((d) => (d.look.frontFrame = 'plain'))).items.filter(
      (i) => i.kind === 'fill'
    )
    const double = compose(cover((d) => (d.look.frontFrame = 'double'))).items.filter(
      (i) => i.kind === 'fill'
    )
    expect(double.length).toBe(plain.length + 4)
  })

  it('never lets the type touch it', () => {
    // A title long enough to fill the measure is the case that fails: an
    // unframed cover sets it to the safe area, which is outside the border.
    const doc = cover((d) => {
      d.look.frontFrame = 'plain'
      d.content.title = 'A Treatise Upon the Keeping of Bees in the Western Counties'
      d.content.subtitle = 'With Observations on the Management of Hives Through Winter'
    })
    const area = frontTypeArea(geometry, 'plain')
    const inner = {
      left: (geometry.front.x + FRAME_INSET_IN) * PT_PER_INCH,
      right: (geometry.front.x + geometry.front.width - FRAME_INSET_IN) * PT_PER_INCH
    }
    const onFront = compose(doc)
      .items.filter((i): i is CoverTextItem => i.kind === 'text')
      .filter((i) => i.xPt >= geometry.front.x * PT_PER_INCH)
    expect(onFront.length).toBeGreaterThan(2)
    for (const item of onFront) {
      expect(item.xPt).toBeGreaterThan(inner.left)
      expect(item.xPt + item.widthPt).toBeLessThan(inner.right)
    }
    // And the imprint at the foot comes up inside the frame with it.
    const foot = Math.max(...onFront.map((i) => i.yPt))
    expect(foot).toBeLessThanOrEqual((area.y + area.height) * PT_PER_INCH)
  })

  it('is front only, so the barcode is not printed over a border', () => {
    const doc = cover((d) => (d.look.frontFrame = 'double'))
    const composed = compose(doc)
    for (const item of composed.items.filter((i) => i.kind === 'fill')) {
      const box = itemBounds(item)!
      // Everything but the ground, which covers the whole sheet.
      if (box.width >= geometry.fullWidthIn) continue
      expect(box.x).toBeGreaterThanOrEqual(geometry.front.x)
    }
  })
})

describe('the device on the front', () => {
  it('is placed under its own id, not the spine mark’s', () => {
    const doc = cover((d) => {
      d.look.pressMark = MARK
      d.look.markOnFront = true
    })
    const images = compose(doc).items.filter((i): i is CoverImageItem => i.kind === 'image')
    const ids = images.map((i) => i.id)
    expect(ids).toContain(FRONT_MARK_ID)
    // Still on the spine as well: the front is an addition, not a move.
    expect(ids).toContain(PRESS_MARK_ID)
    const front = images.find((i) => i.id === FRONT_MARK_ID)
    const spine = images.find((i) => i.id === PRESS_MARK_ID)
    expect(front!.widthPt).toBeGreaterThan(spine!.widthPt * 2)
  })

  it('keeps the source’s proportions and centres on the panel', () => {
    const doc = cover((d) => {
      d.look.pressMark = MARK
      d.look.markOnFront = true
    })
    const front = compose(doc).items.find(
      (i): i is CoverImageItem => i.kind === 'image' && i.id === FRONT_MARK_ID
    )!
    expect(front.widthPt / front.heightPt).toBeCloseTo(MARK.widthPx / MARK.heightPx, 6)
    const centre = front.xPt + front.widthPt / 2
    expect(centre).toBeCloseTo((geometry.front.x + geometry.front.width / 2) * PT_PER_INCH, 4)
  })

  it('pushes the type down and is charged against its height', () => {
    // A tall device on a label cover, which is where the height budget binds:
    // with a wide one the title's size is settled by the measure and a missing
    // charge would not show. (It did not, in the first version of this test.)
    const tall = { ...MARK, widthPx: 400, heightPx: 600 }
    const block = (d: CoverDocument): void => {
      d.look.arrangement = 'label'
      d.look.pressMark = tall
    }
    const without = compose(cover(block))
    const with_ = compose(
      cover((d) => {
        block(d)
        d.look.markOnFront = true
      })
    )
    const firstLine = (c: typeof without): CoverTextItem =>
      c.items
        .filter((i): i is CoverTextItem => i.kind === 'text')
        .filter((i) => i.xPt >= geometry.front.x * PT_PER_INCH)
        .sort((a, b) => a.yPt - b.yPt)[0]!
    expect(firstLine(with_).yPt).toBeGreaterThan(firstLine(without).yPt)
    // Charged, not merely offset: the title that has to share the block with a
    // device is set no larger than the one that does not.
    const title = (c: typeof without): number =>
      Math.max(
        ...c.items
          .filter((i): i is CoverTextItem => i.kind === 'text')
          .filter((i) => i.xPt >= geometry.front.x * PT_PER_INCH)
          .map((i) => i.sizePt)
      )
    expect(title(with_)).toBeLessThan(title(without))
  })

  it('draws nothing when the look has no mark to draw', () => {
    const doc = cover((d) => (d.look.markOnFront = true))
    const images = compose(doc).items.filter((i): i is CoverImageItem => i.kind === 'image')
    expect(images.map((i) => i.id)).not.toContain(FRONT_MARK_ID)
  })
})
