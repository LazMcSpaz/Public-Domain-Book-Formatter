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
  backAnchorTarget,
  backAnchorX,
  backFigureFrame,
  coverFromAnswers,
  defaultLook,
  FIGURE_FADE_IN,
  GROUND_FIGURE_BACK_ID,
  lookQuestions,
  normalizeLook,
  type CoverInterviewState
} from '@core/cover'
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
      expect(FIGURE_SRC[figure], figure).toMatch(/^\/devices\/.+\.svg$/)
      expect(FIGURE_LABEL[figure]?.length, figure).toBeGreaterThan(0)
      expect(FIGURE_NOTE[figure]?.length, figure).toBeGreaterThan(0)
      expect(FIGURE_ANCHOR_X[figure], figure).toBeGreaterThan(0)
      expect(FIGURE_ZOOM[figure], figure).toBeGreaterThanOrEqual(1)
    }
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

function interviewState(doc: CoverDocument): CoverInterviewState {
  return {
    doc,
    pageCountMeasured: true,
    bankedLooks: [],
    plates: [],
    hasReplicateToken: false,
    replicateAvailable: null
  }
}

describe('the figure has its own colour', () => {
  it('falls back to the look it came from, not to the shipped default', () => {
    // A look banked before this role existed had its figure drawn in whatever
    // ink it carried. Taking the default here would repaint every one of them.
    const look = normalizeLook({ ...defaultLook(), palette: { ink: '#ffffff' } })
    expect(look.palette.figure).toBe('#ffffff')
    expect(look.palette.figure).not.toBe(defaultLook().palette.figure)
  })

  it('keeps a stated figure colour apart from the ink', () => {
    const look = normalizeLook({
      ...defaultLook(),
      palette: { ink: '#ffffff', figure: '#f0d890' }
    })
    expect(look.palette.ink).toBe('#ffffff')
    expect(look.palette.figure).toBe('#f0d890')
  })

  it('refuses a colour that is not one', () => {
    const look = normalizeLook({ ...defaultLook(), palette: { ink: '#ffffff', figure: 'gold' } })
    expect(look.palette.figure).toBe('#ffffff')
  })

  it('is asked for only once there is a figure to colour', () => {
    const noFigure = lookQuestions(interviewState(cover(() => {})))
    expect(noFigure.some((q) => q.id === 'cover-figure-ink')).toBe(false)
    expect(noFigure.some((q) => q.id === 'cover-figure-opacity')).toBe(false)

    const withFigure = lookQuestions(interviewState(cover((d) => (d.look.groundFigure = 'arcade'))))
    expect(withFigure.some((q) => q.id === 'cover-figure-ink')).toBe(true)
    expect(withFigure.some((q) => q.id === 'cover-figure-opacity')).toBe(true)
  })

  it('reads the answer back onto the figure alone', () => {
    const base = cover((d) => {
      d.look.groundFigure = 'arcade'
      d.look.palette.ink = '#ffffff'
    })
    const next = coverFromAnswers(base, { 'cover-figure-ink': '#f0d890' })
    expect(next.look.palette.figure).toBe('#f0d890')
    expect(next.look.palette.ink).toBe('#ffffff')
  })
})

describe('the companion on the back', () => {
  const geometry = coverGeometry({ trimSize: '6x9', pageCount: 690, paper: 'bw-white' })

  function backOf(doc: CoverDocument) {
    return composeCover(doc, { measurer }).items.find(
      (i) => i.kind === 'image' && i.id === GROUND_FIGURE_BACK_ID
    )
  }

  it('is drawn in a box the mirror of the front’s, so the two are one scale', () => {
    // The fault this pins is not an error but a picture a quarter larger on one
    // panel than on the other, which no count would report.
    const back = backFigureFrame(geometry)
    const front = figureFrame(geometry)
    expect(back.width).toBeCloseTo(front.width, 6)
    expect(back.height).toBeCloseTo(front.height, 6)
  })

  it('starts at the sheet’s edge and stops at the back fold', () => {
    const back = backFigureFrame(geometry)
    expect(back.x).toBe(0)
    expect(back.y).toBe(0)
    expect(back.x + back.width).toBeCloseTo(geometry.spine.x, 6)
  })

  it('leaves the spine to its type', () => {
    const back = backFigureFrame(geometry)
    expect(back.x + back.width).toBeLessThanOrEqual(geometry.spine.x + 1e-9)
    expect(figureFrame(geometry).x).toBeGreaterThanOrEqual(
      geometry.spine.x + geometry.spineIn - 1e-9
    )
  })

  it('has faded to nothing well before the fold', () => {
    // The gap between the two pictures: the back's fade, the whole spine, and
    // the front's fade. Nothing within it can be seen to be out of register.
    const quiet = FIGURE_FADE_IN + geometry.spineIn + FIGURE_FADE_IN
    expect(quiet).toBeGreaterThan(2)
    expect(FIGURE_FADE_IN).toBeGreaterThanOrEqual(0.75)
  })

  it('aims at the back panel’s centre line, not the box’s', () => {
    const target = backAnchorTarget(geometry)
    const frame = backFigureFrame(geometry)
    expect(target * frame.width).toBeCloseTo(geometry.back.x + geometry.back.width / 2, 6)
  })

  it('mirrors the figure’s own anchor', () => {
    for (const f of GROUND_FIGURES) {
      expect(backAnchorX(f)).toBeCloseTo(1 - FIGURE_ANCHOR_X[f], 9)
    }
  })

  it('puts the mirrored anchor where the target asks', () => {
    // The arithmetic the mirrored draw depends on: a source point a fraction a
    // from its own left lands 1 - a from the drawn rectangle's left.
    const boxWidth = 600
    const drawWidth = 700
    const anchor = 0.3
    // Reachable within the clamp: an anchor the picture cannot deliver without
    // coming away from an edge is honoured only as far as it goes, which is a
    // different property and is pinned above.
    const target = 0.7
    const mirrored = 1 - anchor
    const x = coverOffsetX(boxWidth, drawWidth, mirrored, target)
    // A mirrored draw puts a source point `anchor` from its own left at
    // `1 - anchor` from the drawn rectangle's left.
    expect(x + drawWidth * mirrored).toBeCloseTo(boxWidth * target, 6)
  })

  it('is placed only when asked for, and only under a figure', () => {
    expect(backOf(cover((d) => (d.look.groundFigure = 'arcade')))).toBeUndefined()
    expect(backOf(cover((d) => (d.look.groundFigureBack = true)))).toBeUndefined()
    const both = backOf(
      cover((d) => {
        d.look.groundFigure = 'arcade'
        d.look.groundFigureBack = true
      })
    )
    expect(both).toBeDefined()
  })

  it('prints at the same tint as the figure it companions', () => {
    const doc = cover((d) => {
      d.look.groundFigure = 'arcade'
      d.look.groundFigureBack = true
      d.look.groundFigureOpacity = 0.08
    })
    const items = composeCover(doc, { measurer }).items
    const front = items.find((i) => i.kind === 'image' && i.id === GROUND_FIGURE_ID)
    const back = backOf(doc)
    expect(front?.kind).toBe('image')
    expect(back?.kind).toBe('image')
    if (front?.kind !== 'image' || back?.kind !== 'image') return
    expect(back.opacity).toBe(0.08)
    expect(back.opacity).toBe(front.opacity)
  })

  it('goes under the spine’s own type', () => {
    const doc = cover((d) => {
      d.look.groundFigure = 'arcade'
      d.look.groundFigureBack = true
    })
    const items = composeCover(doc, { measurer }).items
    const back = items.findIndex((i) => i.kind === 'image' && i.id === GROUND_FIGURE_BACK_ID)
    const firstText = items.findIndex((i) => i.kind === 'text')
    expect(back).toBeGreaterThanOrEqual(0)
    expect(firstText).toBeGreaterThan(back)
  })

  it('is asked for only once there is a figure, and read back as a flag', () => {
    const none = lookQuestions(interviewState(cover(() => {})))
    expect(none.some((q) => q.id === 'cover-figure-back')).toBe(false)
    const asked = lookQuestions(interviewState(cover((d) => (d.look.groundFigure = 'arcade'))))
    const q = asked.find((qq) => qq.id === 'cover-figure-back')
    expect(q).toBeDefined()
    // A confirm, not a two-option choice: `flag` reads booleans, and a choice
    // answering 'yes' into it is a question that changes nothing.
    expect(q!.type).toBe('confirm')
    const next = coverFromAnswers(
      cover((d) => (d.look.groundFigure = 'arcade')),
      { 'cover-figure-back': true }
    )
    expect(next.look.groundFigureBack).toBe(true)
  })
})
