/**
 * `groundFigureOnRule`: a framed figure set on the frame's inner rule.
 *
 * Measured against the frame the composer actually strikes (its fill items),
 * not against the constants the composer was written with, so a frame whose
 * lines move and a box that does not follow them fails here.
 */
import { describe, expect, it } from 'vitest'
import { fixedWidthMeasurer } from '@core/layout'
import {
  composeCover,
  coverGeometry,
  defaultCover,
  defaultLook,
  FRAME_CLEARANCE_IN,
  frameStrokeIn,
  GROUND_FIGURE_ID,
  normalizeLook,
  pt,
  type CoverDocument,
  type CoverImageItem,
  type FrameStyle
} from '@core/cover'

const measurer = fixedWidthMeasurer()

function cover(frame: FrameStyle, patch: (doc: CoverDocument) => void = () => {}): CoverDocument {
  const doc = defaultCover('7x10', 320)
  doc.content.title = 'A Made-Up Title'
  doc.content.author = 'A. N. Author'
  doc.look.arrangement = 'label'
  doc.look.frontFrame = frame
  doc.look.groundFigure = 'arcade'
  doc.look.groundFigureInFrame = true
  patch(doc)
  return doc
}

function composed(doc: CoverDocument) {
  return composeCover(doc, { measurer })
}

function figure(doc: CoverDocument): CoverImageItem {
  const item = composed(doc).items.find((i) => i.kind === 'image' && i.id === GROUND_FIGURE_ID)
  expect(item).toBeDefined()
  return item as CoverImageItem
}

/**
 * Where the ink of the frame's innermost line stops, on the left and at the
 * foot of the front panel, read off the fills the composer drew.
 */
function innerRuleEdges(doc: CoverDocument): { left: number; foot: number } {
  const { items, geometry } = composed(doc)
  const panel = {
    x: pt(geometry.front.x),
    y: pt(geometry.front.y),
    width: pt(geometry.front.width),
    height: pt(geometry.front.height)
  }
  const accent = doc.look.palette.accent
  const fills = items.filter(
    (i) => i.kind === 'fill' && i.color === accent && i.id === undefined && i.xPt >= panel.x
  )
  // Left verticals: tall, thin and in the left half of the panel.
  const lefts = fills.filter(
    (i) => i.kind === 'fill' && i.heightPt > panel.height / 2 && i.xPt < panel.x + panel.width / 2
  )
  // Foot horizontals: wide, thin and in the lower half.
  const feet = fills.filter(
    (i) => i.kind === 'fill' && i.widthPt > panel.width / 2 && i.yPt > panel.y + panel.height / 2
  )
  expect(lefts.length).toBeGreaterThan(0)
  expect(feet.length).toBeGreaterThan(0)
  const inner = lefts.reduce((a, b) =>
    b.kind === 'fill' && a.kind === 'fill' && b.xPt > a.xPt ? b : a
  )
  const lowest = feet.reduce((a, b) =>
    b.kind === 'fill' && a.kind === 'fill' && b.yPt < a.yPt ? b : a
  )
  if (inner.kind !== 'fill' || lowest.kind !== 'fill') throw new Error('not fills')
  return { left: inner.xPt + inner.widthPt, foot: lowest.yPt }
}

describe('groundFigureOnRule', () => {
  it('is off unless a cover asks, and a spec can ask for it', () => {
    expect(defaultLook().groundFigureOnRule).toBe(false)
    expect(normalizeLook({}).groundFigureOnRule).toBe(false)
    expect(normalizeLook({ groundFigureOnRule: true }).groundFigureOnRule).toBe(true)
  })

  for (const frame of ['double', 'plain'] as const) {
    it(`sets the framed figure's box on the inner edge of a ${frame} frame's inner rule`, () => {
      const doc = cover(frame, (d) => (d.look.groundFigureOnRule = true))
      const box = figure(doc)
      const edges = innerRuleEdges(doc)
      expect(box.xPt).toBeCloseTo(edges.left, 6)
      expect(box.yPt + box.heightPt).toBeCloseTo(edges.foot, 6)
    })
  }

  it('leaves a framed figure the clearance a line of type keeps when it is off', () => {
    const doc = cover('double')
    const box = figure(doc)
    const edges = innerRuleEdges(doc)
    // The box stands the clearance inside the frame's outer line, which is
    // inside the inner rule by the frame's own strokes less the clearance.
    const gap = pt(FRAME_CLEARANCE_IN) - pt(frameStrokeIn('double'))
    expect(box.xPt - edges.left).toBeCloseTo(gap, 6)
    expect(edges.foot - (box.yPt + box.heightPt)).toBeCloseTo(gap, 6)
  })

  it('changes nothing for a figure that is not held in the frame', () => {
    const bled = (onRule: boolean) =>
      figure(
        cover('double', (d) => {
          d.look.groundFigureInFrame = false
          d.look.groundFigureOnRule = onRule
        })
      )
    expect(bled(true)).toEqual(bled(false))
  })

  it('measures each frame by the lines it strikes', () => {
    const geometry = coverGeometry({ trimSize: '7x10', pageCount: 320, paper: 'bw-cream' })
    expect(geometry.front.width).toBeGreaterThan(0)
    expect(frameStrokeIn('none')).toBe(0)
    expect(frameStrokeIn('plain')).toBeLessThan(frameStrokeIn('double'))
  })
})
