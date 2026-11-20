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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  FIGURE_ZOOM,
  coverScale,
  GROUND_FIGURES,
  isRasterFigure,
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

describe('coverScale', () => {
  it('is the smaller picture’s scale — whichever axis binds', () => {
    // A 200×100 box and a 100×100 picture: width binds, so 2.
    expect(coverScale(200, 100, 100, 100)).toBe(2)
    // Turn it round and height binds.
    expect(coverScale(100, 200, 100, 100)).toBe(2)
  })

  it('leaves room beyond covering when a figure asks for it', () => {
    expect(coverScale(200, 100, 100, 100, 1.05)).toBeCloseTo(2.1, 6)
  })

  it('never draws a picture smaller than covering', () => {
    // A zoom under one would pull the ground off the trim, which is the one
    // thing a bleeding ground exists to prevent.
    expect(coverScale(200, 100, 100, 100, 0.5)).toBe(2)
  })

  it('has nothing to spend when the picture’s proportions are the box’s', () => {
    // The constraint `FIGURE_ZOOM` exists for: a figure shaped like the panel
    // covers it exactly, so there is no overflow and no anchor can move it.
    const scale = coverScale(100, 150, 200, 300)
    const drawWidth = 200 * scale
    expect(drawWidth).toBeCloseTo(100, 6)
    expect(coverOffsetX(100, drawWidth, 0.9)).toBeCloseTo(0, 6)
    // With room asked for, the same anchor moves it.
    const zoomed = 200 * coverScale(100, 150, 200, 300, 1.2)
    expect(coverOffsetX(100, zoomed, 0.9)).toBeLessThan(-1)
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
      // A trace lives in `devices/` as vector. A raster figure is allowed,
      // but only by being on `RASTER_FIGURES` — so admitting one stays a
      // decision somebody wrote down rather than a file name nobody checked.
      if (isRasterFigure(figure)) {
        expect(FIGURE_SRC[figure], figure).toMatch(/^\/figures\/.+\.(jpg|png)$/)
      } else {
        expect(FIGURE_SRC[figure], figure).toMatch(/^\/devices\/.+\.svg$/)
      }
      expect(FIGURE_LABEL[figure]?.length, figure).toBeGreaterThan(0)
      expect(FIGURE_NOTE[figure]?.length, figure).toBeGreaterThan(0)
      expect(FIGURE_ANCHOR_X[figure], figure).toBeGreaterThan(0)
      expect(FIGURE_ZOOM[figure], figure).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps the radiance wider than any panel it can be asked to cover', () => {
    // The radiant eye is the one figure whose vertical placement is the design:
    // its pupil is set under the title rule, and the fraction that puts it
    // there is written into the artwork's own box. That only holds while the
    // picture is WIDER than the panel — covering then scales it to the panel's
    // height and crops the sides, so nothing moves vertically. Let it become
    // narrower than some trim and that trim scales it to the width instead,
    // crops the top and the foot, and the eye slides toward the middle of the
    // board with nothing to say so.
    //
    // 8.5×11 is the widest trim the studio offers; out to the bleed its front
    // panel is 8.625 by 11.25.
    const widest = 8.625 / 11.25
    const file = readFileSync(join('public', FIGURE_SRC['all-seeing-eye-radiant']), 'utf8')
    const [, , w, h] = /viewBox="([-\d.\s]+)"/.exec(file)![1]!.trim().split(/\s+/).map(Number)
    expect(w! / h!).toBeGreaterThan(widest)
  })

  it('fades the engraving out across its own rim rather than ending on it', () => {
    // The shape the editor could see twice is the fan's EDGE: a hundred and
    // thirty-three blunt ray-ends and the gaps between them, standing in an
    // arc. Dropping the hatching removes it and takes the emblem with it — the
    // hatching round the eye and the stars is what the device is — so the ink
    // is faded to nothing across its own rim instead, per angle, and the
    // carried rays run on through.
    //
    // What is checkable is the structure. The engraving enters the artwork
    // exactly once, and that once is under the rim mask; a regression that
    // draws it whole is the state that printed the edge. Measuring the
    // evenness photometrically was tried and will not do it — the stars are
    // holes and the eye is a mass, both legitimately angular, and no assay
    // separates them from a rim.
    const file = readFileSync(join('public', FIGURE_SRC['all-seeing-eye-radiant']), 'utf8')
    const traces = file.match(/fill-rule="evenodd"/g) ?? []
    expect(traces, 'the engraving is drawn once').toHaveLength(1)
    expect(/<mask id="rim"[^>]*>\s*<image /.test(file), 'the rim fade is a raster mask').toBe(true)
    const underMask =
      /<g mask="url\(#rim\)">\s*<g transform="[^"]*">\s*<path[^>]*fill-rule="evenodd"/
    expect(underMask.test(file), 'and it is drawn under that mask').toBe(true)
  })

  it('keeps the seven stars as holes in the ray field', () => {
    // The fault this pins is the one the editor saw twice: the fan's own
    // hatching, printed under the carried rays, is an ellipse reaching twice as
    // far at the sides as at the foot, so the ink it adds makes a flat lozenge
    // round the eye. Fading the join does not touch it, because the join is not
    // what shows.
    //
    // Measuring evenness photometrically was tried and will not do it — the
    // seven stars are holes and the eye is a mass, so they are legitimately
    // angular and no assay separates them from a lozenge. What is checkable is
    // the structure: the trace enters the artwork once, through a clip, and
    // that clip is a fraction of the figure. Everything else drawn is rays.
    // On the paper a star is white: a shape the ink encloses, not ink. So the
    // carried rays are masked out behind all seven, or a ray would cross one.
    // A mask rather than an even-odd subpath, because two overlapping dashes
    // under one star would invert the rule back to ink.
    const file = readFileSync(join('public', FIGURE_SRC['all-seeing-eye-radiant']), 'utf8')
    expect(/<mask id="stars"[^>]*>/.test(file)).toBe(true)
    expect(/<path fill="#141414" mask="url\(#stars\)"/.test(file)).toBe(true)
    const starPath = /<path fill="#000" d="([^"]+)"/.exec(file)
    expect(starPath, 'the stars must be traced into the mask').not.toBeNull()
    expect((starPath![1]!.match(/M/g) ?? []).length, 'all seven of them').toBe(7)
  })

  it('leaves every figure enough room for the anchor it asks for', () => {
    // Against the artwork on disk rather than a number kept beside the anchor,
    // because the thing that decides how much room there is *is* the file's
    // own proportions, and a constant repeating them is a constant that can
    // come to disagree with them.
    //
    // The failure this catches happened: the arcade shipped at a zoom of 1.03,
    // which left its anchor a pixel and a half short on a 6×9, and nothing
    // said so — a clamped anchor prints a cover that is very slightly wrong
    // and raises nothing.
    const box = { width: 6.125, height: 9.25 } // a 6×9 front panel, out to the bleed
    for (const figure of GROUND_FIGURES) {
      // A photograph has no viewBox to measure, and its anchor is its own
      // centre by the rule above, so there is nothing here to check.
      if (isRasterFigure(figure)) {
        expect(FIGURE_ANCHOR_X[figure], figure).toBe(0.5)
        continue
      }
      const file = readFileSync(join('public', FIGURE_SRC[figure]), 'utf8')
      const viewBox = /viewBox="([-\d.\s]+)"/.exec(file)
      expect(viewBox, figure).not.toBeNull()
      const [, , w, h] = viewBox![1]!.trim().split(/\s+/).map(Number)
      expect(w! > 0 && h! > 0, figure).toBe(true)

      const scale = coverScale(box.width, box.height, w!, h!, FIGURE_ZOOM[figure])
      const drawWidth = w! * scale
      const anchor = FIGURE_ANCHOR_X[figure]
      const wanted = box.width / 2 - anchor * drawWidth
      const clamped = coverOffsetX(box.width, drawWidth, anchor)
      // Within a hundredth of an inch of what it asked for — three pixels on a
      // 300 DPI proof, which is not a shift anybody can see.
      expect(Math.abs(clamped - wanted), figure).toBeLessThan(0.01)
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
