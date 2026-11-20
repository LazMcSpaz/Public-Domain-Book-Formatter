/**
 * (Split from `cover-figure.test.ts` to keep each file short; shares its fixtures.)
 *
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
  backAnchorTarget,
  backAnchorX,
  backFigureFrame,
  coverFromAnswers,
  defaultLook,
  figureFade,
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
  FIGURE_ANCHOR_X,
  GROUND_FIGURES,
  defaultCover,
  figureFrame,
  GROUND_FIGURE_ID,
  type CoverDocument
} from '@core/cover'

const measurer = fixedWidthMeasurer()

function cover(patch: (doc: CoverDocument) => void = () => {}): CoverDocument {
  const doc = defaultCover('6x9', 400)
  doc.content.title = 'Isis Unveiled'
  doc.content.author = 'H. P. Blavatsky'
  doc.look.arrangement = 'label'
  patch(doc)
  return doc
}

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

describe('the fade rings the figure', () => {
  const geo = coverGeometry({ trimSize: '6x9', pageCount: 690, paper: 'bw-white' })

  it('reaches nothing at the trim on three edges and at the fold on the fourth', () => {
    const front = figureFade(geo, 'left')
    // The fold is already a trim edge, so the front's box starts at zero inset;
    // its other three carry the bleed the printer cuts off.
    expect(front.leftIn).toBe(0)
    expect(front.rightIn).toBe(geo.bleedIn)
    expect(front.topIn).toBe(geo.bleedIn)
    expect(front.bottomIn).toBe(geo.bleedIn)
  })

  it('is the mirror of that on the back’s companion', () => {
    const back = figureFade(geo, 'right')
    expect(back.rightIn).toBe(0)
    expect(back.leftIn).toBe(geo.bleedIn)
    expect(back.topIn).toBe(geo.bleedIn)
    expect(back.bottomIn).toBe(geo.bleedIn)
  })

  it('ramps over the same width on every edge', () => {
    // The property the editor asked for in as many words: a fade on one side
    // and a cut edge on the other three reads as a repair.
    for (const edge of ['left', 'right'] as const) {
      const fade = figureFade(geo, edge)
      expect(fade.widthIn).toBe(FIGURE_FADE_IN)
    }
    expect(FIGURE_FADE_IN).toBeGreaterThanOrEqual(0.75)
  })

  it('still clears the fold by more than the fold can creep', () => {
    // Measured on the sheet: the two fades plus the spine leave the middle
    // plain, so where the fold actually falls decides nothing visible.
    expect(FIGURE_FADE_IN * 2 + geo.spineIn).toBeGreaterThan(2)
  })
})

describe('the subtitle’s size', () => {
  function subtitleSize(doc: CoverDocument): number {
    const item = composeCover(doc, { measurer }).items.find(
      (i) => i.kind === 'text' && i.text === doc.content.subtitle
    )
    expect(item?.kind).toBe('text')
    return item?.kind === 'text' ? item.sizePt : 0
  }

  function titleSize(doc: CoverDocument): number {
    const item = composeCover(doc, { measurer }).items.find(
      (i) => i.kind === 'text' && i.text === doc.content.title.toUpperCase()
    )
    return item?.kind === 'text' ? item.sizePt : 0
  }

  const withSubtitle = (ratio: number | null) =>
    cover((d) => {
      d.content.subtitle = 'Science'
      d.look.titleCase = 'upper'
      d.look.titleSizePt = 26
      d.look.subtitleRatio = ratio
    })

  it('is a share of the title, so a longer title carries it down', () => {
    const doc = withSubtitle(0.7)
    expect(titleSize(doc)).toBe(26)
    expect(subtitleSize(doc)).toBeCloseTo(26 * 0.7, 6)
  })

  it('keeps its small default where nothing is asked for', () => {
    const asked = subtitleSize(withSubtitle(null))
    expect(asked).toBeLessThan(26 * 0.5)
    expect(asked).toBeGreaterThan(0)
  })

  it('refuses a share that is not a positive number', () => {
    for (const bad of ['0.7', 0, -1, Number.NaN, null, undefined]) {
      const look = normalizeLook({ ...defaultLook(), subtitleRatio: bad })
      expect(look.subtitleRatio).toBeNull()
    }
    expect(normalizeLook({ ...defaultLook(), subtitleRatio: 0.7 }).subtitleRatio).toBe(0.7)
  })

  it('is asked for, and the answer reaches the look', () => {
    const q = lookQuestions(interviewState(cover(() => {}))).find(
      (qq) => qq.id === 'cover-subtitle-size'
    )
    expect(q).toBeDefined()
    expect(q!.type).toBe('choice')
    const next = coverFromAnswers(
      cover(() => {}),
      { 'cover-subtitle-size': '0.7' }
    )
    expect(next.look.subtitleRatio).toBe(0.7)
    // And the empty option means the default, not a share of nothing.
    expect(coverFromAnswers(next, { 'cover-subtitle-size': '' }).look.subtitleRatio).toBeNull()
  })
})
