/**
 * The ground figure.
 *
 * What is pinned here is where it stops, because that is the decision the
 * module exists to make. A texture may run across the fold: it repeats, so
 * there is no alignment to notice when the fold creeps. A figure has a centre
 * and a pair of wing tips, so it must not — and the consequence of getting it
 * wrong is not an error but a faint picture half-printed on the back cover of
 * a book somebody has already bought.
 */
import { describe, expect, it } from 'vitest'
import { fixedWidthMeasurer } from '@core/layout'
import {
  composeCover,
  coverGeometry,
  coverOffsetX,
  DEFAULT_FIGURE_OPACITY,
  FIGURE_ANCHOR_X,
  FIGURE_LABEL,
  FIGURE_NOTE,
  FIGURE_SRC,
  GROUND_FIGURES,
  defaultCover,
  figureFrame,
  figureOpacity,
  GROUND_FIGURE_ID,
  MAX_FIGURE_OPACITY,
  MIN_FIGURE_OPACITY,
  PT_PER_INCH,
  type CoverDocument,
  type CoverImageItem
} from '@core/cover'

const measurer = fixedWidthMeasurer()
const geometry = coverGeometry({ trimSize: '6x9', pageCount: 400, paper: 'bw-cream' })

function cover(patch: (doc: CoverDocument) => void = () => {}): CoverDocument {
  const doc = defaultCover('6x9', 400)
  doc.content.title = 'Isis Unveiled'
  doc.content.author = 'H. P. Blavatsky'
  doc.look.arrangement = 'label'
  patch(doc)
  return doc
}

const figureOf = (doc: CoverDocument): CoverImageItem | undefined =>
  composeCover(doc, { measurer }).items.find(
    (i): i is CoverImageItem => i.kind === 'image' && i.id === GROUND_FIGURE_ID
  )

describe('figureFrame', () => {
  it('runs out to the bleed on three edges', () => {
    const frame = figureFrame(geometry)
    expect(frame.y).toBe(0)
    expect(frame.height).toBeCloseTo(geometry.fullHeightIn, 6)
    expect(frame.x + frame.width).toBeCloseTo(geometry.fullWidthIn, 6)
  })

  it('stops dead at the fold', () => {
    const frame = figureFrame(geometry)
    expect(frame.x).toBeCloseTo(geometry.front.x, 6)
    // Which is to say: nothing of it is over the spine or the back cover.
    expect(frame.x).toBeGreaterThanOrEqual(geometry.spine.x + geometry.spine.width - 1e-9)
  })

  it('moves with the spine rather than sitting at a fixed inch', () => {
    const thin = figureFrame(coverGeometry({ trimSize: '6x9', pageCount: 100, paper: 'bw-cream' }))
    const thick = figureFrame(coverGeometry({ trimSize: '6x9', pageCount: 800, paper: 'bw-cream' }))
    expect(thick.x).toBeGreaterThan(thin.x)
    // The front panel is the same size on both; only where it starts changes.
    expect(thick.width).toBeCloseTo(thin.width, 6)
  })
})

describe('figureOpacity', () => {
  it('holds the press floor and the design ceiling', () => {
    expect(figureOpacity(0.01)).toBe(MIN_FIGURE_OPACITY)
    expect(figureOpacity(0.9)).toBe(MAX_FIGURE_OPACITY)
    expect(figureOpacity(0.05)).toBe(0.05)
  })

  it('falls back rather than placing a figure at NaN', () => {
    expect(figureOpacity(Number.NaN)).toBe(DEFAULT_FIGURE_OPACITY)
  })
})

describe('coverOffsetX', () => {
  // A 100-wide box holding a 150-wide picture: 50 of overflow to spend.
  it('centres what it is given no anchor for', () => {
    expect(coverOffsetX(100, 150, 0.5)).toBe(-25)
  })

  it('shifts the picture so the anchor lands on the centre line', () => {
    // The anchor sits at 0.6 of the picture, which is 90 from its left edge;
    // putting that at 50 means drawing from -40.
    expect(coverOffsetX(100, 150, 0.6)).toBe(-40)
    // And left of centre pulls it the other way.
    expect(coverOffsetX(100, 150, 0.4)).toBe(-10)
  })

  it('never pulls the picture off an edge, however far the anchor asks', () => {
    // A ground that came away from the trim would leave a band of bare cover,
    // which is the one thing a bleeding ground exists to prevent.
    expect(coverOffsetX(100, 150, 0.95)).toBe(-50)
    expect(coverOffsetX(100, 150, 0.05)).toBe(0)
  })

  it('has nothing to spend when the picture only just covers the box', () => {
    expect(coverOffsetX(100, 100, 0.9)).toBe(0)
  })
})

describe('the figure library', () => {
  it('names a point inside the artwork for every figure', () => {
    for (const [figure, anchor] of Object.entries(FIGURE_ANCHOR_X)) {
      expect(anchor, figure).toBeGreaterThan(0)
      expect(anchor, figure).toBeLessThan(1)
    }
  })

  it('gives every figure artwork, a label and a note', () => {
    // A figure added to the list and left out of one of these tables is a
    // choice the interview offers and the renderer cannot draw — which is a
    // blank front cover rather than an error.
    for (const figure of GROUND_FIGURES) {
      expect(FIGURE_SRC[figure], figure).toMatch(/^\/devices\/.+\.svg$/)
      expect(FIGURE_LABEL[figure]?.length, figure).toBeGreaterThan(0)
      expect(FIGURE_NOTE[figure]?.length, figure).toBeGreaterThan(0)
      expect(FIGURE_ANCHOR_X[figure], figure).toBeGreaterThan(0)
    }
  })
})

describe('the composer', () => {
  it('places nothing when no figure is chosen', () => {
    expect(figureOf(cover())).toBeUndefined()
  })

  it('places it over the front panel, out to the bleed, at the asked-for tint', () => {
    const item = figureOf(
      cover((d) => {
        d.look.groundFigure = 'isis-winged'
        d.look.groundFigureOpacity = 0.05
      })
    )
    expect(item).toBeDefined()
    expect(item!.xPt).toBeCloseTo(geometry.front.x * PT_PER_INCH, 4)
    expect(item!.yPt).toBe(0)
    expect(item!.widthPt).toBeCloseTo((geometry.fullWidthIn - geometry.front.x) * PT_PER_INCH, 4)
    expect(item!.heightPt).toBeCloseTo(geometry.fullHeightIn * PT_PER_INCH, 4)
    expect(item!.opacity).toBe(0.05)
  })

  it('clamps a tint the press could not hold, rather than drawing it', () => {
    const item = figureOf(
      cover((d) => {
        d.look.groundFigure = 'isis-winged'
        d.look.groundFigureOpacity = 0.005
      })
    )
    expect(item!.opacity).toBe(MIN_FIGURE_OPACITY)
  })

  it('lets the editor go below the reliable tint, having been told', () => {
    const item = figureOf(
      cover((d) => {
        d.look.groundFigure = 'isis-winged'
        d.look.groundFigureOpacity = 0.03
      })
    )
    expect(item!.opacity).toBe(0.03)
  })

  it('leaves the pixel count to whatever draws it', () => {
    // A vector source has none until something has rendered it, and a number
    // guessed here would be divided by the DPI check.
    const item = figureOf(cover((d) => (d.look.groundFigure = 'isis-winged')))
    expect(item!.srcWidth).toBe(0)
    expect(item!.srcHeight).toBe(0)
  })

  it('goes under the type, not over it', () => {
    const doc = cover((d) => (d.look.groundFigure = 'isis-winged'))
    const items = composeCover(doc, { measurer }).items
    const figure = items.findIndex((i) => i.kind === 'image' && i.id === GROUND_FIGURE_ID)
    const firstText = items.findIndex((i) => i.kind === 'text')
    expect(figure).toBeGreaterThanOrEqual(0)
    expect(firstText).toBeGreaterThan(figure)
  })
})
