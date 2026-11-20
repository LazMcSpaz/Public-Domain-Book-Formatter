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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixedWidthMeasurer } from '@core/layout'
import { defaultLook, figureFade, GROUND_FIGURE_BACK_ID, normalizeLook } from '@core/cover'
import {
  composeCover,
  coverGeometry,
  FIGURE_SRC,
  defaultCover,
  figureFrame,
  GROUND_FIGURE_ID,
  wrapAnchorTarget,
  wrapFigureFrame,
  PT_PER_INCH,
  type CoverDocument,
  type CoverImageItem
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

describe('a figure the editor asks to run across the whole cover', () => {
  const wrap = coverGeometry({ trimSize: '7x10', pageCount: 520, paper: 'bw-white' })

  function wrapped(patch: (doc: CoverDocument) => void = () => {}): CoverDocument {
    const doc = defaultCover('7x10', 520)
    doc.content.title = 'The Collected Manuscripts'
    doc.look.groundFigure = 'all-seeing-eye-radiant'
    doc.look.groundFigureWrap = true
    patch(doc)
    return doc
  }

  it('is placed against the sheet, not the front panel', () => {
    const frame = wrapFigureFrame(wrap)
    expect(frame.x).toBe(0)
    expect(frame.y).toBe(0)
    expect(frame.width).toBeCloseTo(wrap.fullWidthIn, 9)
    expect(frame.height).toBeCloseTo(wrap.fullHeightIn, 9)
  })

  it('aims the subject at the front panel’s centre line, not the sheet’s', () => {
    // The sheet's own middle is the spine. Centring there would put the eye on
    // the fold, which is the one place on a cover nothing may sit.
    const target = wrapAnchorTarget(wrap) * wrap.fullWidthIn
    expect(target).toBeCloseTo(wrap.front.x + wrap.front.width / 2, 9)
    expect(target).toBeGreaterThan(wrap.spine.x + wrap.spine.width)
  })

  it('fades at every edge, there being no fold to stop at', () => {
    const fade = figureFade(wrap, null)
    expect(fade.leftIn).toBeCloseTo(wrap.bleedIn, 9)
    expect(fade.rightIn).toBeCloseTo(wrap.bleedIn, 9)
    // Against the figure that does stop at a fold, where the fold edge is flush.
    expect(figureFade(wrap, 'left').leftIn).toBe(0)
  })

  it('runs to the trim at full tint when asked, and keeps a fold fade regardless', () => {
    // The Mahatma Letters' globes diagram is a line drawing meant to run off
    // the cover, and the fade made it read as cut short. Set a whole ramp
    // outside the box, the fade never shows: full tint at the very edge.
    const edge = figureFade(wrap, null, true)
    for (const inset of [edge.leftIn, edge.rightIn, edge.topIn, edge.bottomIn]) {
      expect(inset).toBeCloseTo(-edge.widthIn, 9)
    }
    // A figure that stops at the fold keeps that edge's fade: the picture must
    // not be cut hard at a fold that creeps.
    const front = figureFade(wrap, 'left', true)
    expect(front.leftIn).toBe(0)
    expect(front.rightIn).toBeCloseTo(-front.widthIn, 9)
    expect(figureFade(wrap, 'right', true).rightIn).toBe(0)
    // And unasked, nothing has moved.
    expect(figureFade(wrap, null).topIn).toBeCloseTo(wrap.bleedIn, 9)
  })

  it('reaches the far edge of the sheet from where the subject stands', () => {
    // The invariant the artwork's proportions exist for, and the reason it is
    // 2.6 wide to tall. A wrapping picture is scaled to the sheet's height, so
    // its own half-width has to carry the rays from the front panel's centre
    // line all the way across the spine and the back. Measured against the file
    // rather than against a number kept beside it.
    const file = readFileSync(join('public', FIGURE_SRC['all-seeing-eye-radiant']), 'utf8')
    const [, , w, h] = /viewBox="([-\d.\s]+)"/.exec(file)![1]!.trim().split(/\s+/).map(Number)
    const frame = wrapFigureFrame(wrap)
    const inchesPerPx = frame.height / h!
    const halfWidthIn = (w! / 2) * inchesPerPx
    const toFarEdgeIn = wrapAnchorTarget(wrap) * frame.width
    expect(halfWidthIn).toBeGreaterThan(toFarEdgeIn)
  })

  it('places one picture over the sheet and no companion behind it', () => {
    // A companion exists to give a plain back something; a picture already over
    // the back has nothing left to give it, and two of them at one tint would
    // print the fan twice.
    const { items, geometry } = composeCover(
      wrapped((d) => (d.look.groundFigureBack = true)),
      { measurer: fixedWidthMeasurer() }
    )
    const figure = items.find((i) => i.kind === 'image' && i.id === GROUND_FIGURE_ID)
    expect(figure?.kind).toBe('image')
    expect((figure as CoverImageItem).widthPt).toBeCloseTo(geometry.fullWidthIn * PT_PER_INCH, 6)
    expect(items.some((i) => i.kind === 'image' && i.id === GROUND_FIGURE_BACK_ID)).toBe(false)
  })

  it('still stops at the fold when the look has not asked', () => {
    const { items, geometry } = composeCover(
      wrapped((d) => {
        d.look.groundFigureWrap = false
        d.look.groundFigureBack = true
      }),
      { measurer: fixedWidthMeasurer() }
    )
    const figure = items.find((i) => i.kind === 'image' && i.id === GROUND_FIGURE_ID)
    expect((figure as CoverImageItem).widthPt).toBeCloseTo(
      figureFrame(geometry).width * PT_PER_INCH,
      6
    )
    expect(items.some((i) => i.kind === 'image' && i.id === GROUND_FIGURE_BACK_ID)).toBe(true)
  })
})

/**
 * Sizes a collection can bank, rather than shares of a fitted title.
 *
 * Measured across this shelf at 7 x 10, all five covers sharing one look:
 * `subtitleRatio` 0.34 printed the subtitle at 10.9 pt on *The Manuscript
 * Lectures* and 16.3 pt on *The Lost Keys of Masonry*, and `AUTHOR_RATIO`
 * printed the author at 16 pt on one and 29.8 pt on the other. Neither
 * number was chosen; both fell out of how many letters the title above them
 * has. A reader along a shelf reads that as two different presses, which is
 * the one thing banking a look exists to prevent.
 */
describe('a subtitle and an author the collection can pin', () => {
  function sizeOfText(doc: CoverDocument, text: string): number {
    const item = composeCover(doc, { measurer }).items.find(
      (i) => i.kind === 'text' && i.text === text
    )
    expect(item?.kind).toBe('text')
    return item?.kind === 'text' ? item.sizePt : 0
  }

  /** Two books of one collection, differing only in how long the title is. */
  const short = (tweak: (d: CoverDocument) => void) =>
    cover((d) => {
      d.content.title = 'Keys'
      d.content.subtitle = 'Annotated'
      d.content.author = 'M. P. Hall'
      d.look.titleCase = 'upper'
      tweak(d)
    })
  const long = (tweak: (d: CoverDocument) => void) =>
    cover((d) => {
      d.content.title = 'The Collected Manuscript Lectures of a Long Winded Author'
      d.content.subtitle = 'Annotated'
      d.content.author = 'M. P. Hall'
      d.look.titleCase = 'upper'
      tweak(d)
    })

  it('sets two different subtitle sizes while the share is what decides', () => {
    // The fault, stated as a measurement rather than as a complaint.
    const a = sizeOfText(
      short((d) => (d.look.subtitleRatio = 0.34)),
      'Annotated'
    )
    const b = sizeOfText(
      long((d) => (d.look.subtitleRatio = 0.34)),
      'Annotated'
    )
    expect(a).not.toBeCloseTo(b, 1)
  })

  it('sets one subtitle size on both once the points are pinned', () => {
    const a = sizeOfText(
      short((d) => (d.look.subtitleSizePt = 15)),
      'Annotated'
    )
    const b = sizeOfText(
      long((d) => (d.look.subtitleSizePt = 15)),
      'Annotated'
    )
    expect(a).toBe(15)
    expect(b).toBe(15)
  })

  it('lets the pinned points beat a share that is also set', () => {
    // Both fields present is not a conflict to refuse: a banked look carries
    // the share from before the points existed, and the newer, more specific
    // answer is the one to honour.
    const doc = short((d) => {
      d.look.titleSizePt = 40
      d.look.subtitleRatio = 0.7
      d.look.subtitleSizePt = 15
    })
    expect(sizeOfText(doc, 'Annotated')).toBe(15)
  })

  it('sets one author size on both once the points are pinned', () => {
    const a = sizeOfText(
      short((d) => (d.look.authorSizePt = 22)),
      'M. P. Hall'
    )
    const b = sizeOfText(
      long((d) => (d.look.authorSizePt = 22)),
      'M. P. Hall'
    )
    expect(a).toBe(22)
    expect(b).toBe(22)
  })

  it('still refuses to print a name too small to read along a shelf', () => {
    // The floor is older than this field and is the reason it exists at all;
    // pinning the points must not be a way round it.
    const doc = short((d) => (d.look.authorSizePt = 4))
    expect(sizeOfText(doc, 'M. P. Hall')).toBeGreaterThanOrEqual(16)
  })

  it('refuses a pinned size that is not a positive number', () => {
    for (const bad of ['15', 0, -1, Number.NaN, null, undefined]) {
      const look = normalizeLook({
        ...defaultLook(),
        subtitleSizePt: bad,
        authorSizePt: bad
      })
      expect(look.subtitleSizePt).toBeNull()
      expect(look.authorSizePt).toBeNull()
    }
  })
})

/**
 * A newline in the subtitle is a hard break, as it is in the title.
 *
 * The body forbids hand breaks because it reflows; a display line does not.
 * The editor's reason here is the same one the edition statement already
 * answers to: "The Legend of Hiram Abiff, Annotated and Illustrated" is two
 * thoughts, and run together on one line under a rule it reads as a caption.
 */
describe('a stacked subtitle', () => {
  const stacked = (subtitle: string) =>
    composeCover(
      cover((d) => {
        d.content.title = 'Keys'
        d.content.subtitle = subtitle
        d.look.titleCase = 'upper'
        d.look.subtitleSizePt = 15
      }),
      { measurer }
    ).items.filter((i) => i.kind === 'text' && i.sizePt === 15)

  it('breaks where the editor typed the break', () => {
    const lines = stacked('The Legend of Hiram Abiff,\nAnnotated and Illustrated')
    expect(lines.map((i) => (i.kind === 'text' ? i.text : ''))).toEqual([
      'The Legend of Hiram Abiff,',
      'Annotated and Illustrated'
    ])
  })

  it('leaves a subtitle with no break on one line', () => {
    const lines = stacked('The Legend of Hiram Abiff')
    expect(lines).toHaveLength(1)
  })

  it('still wraps a stacked line too long for the measure', () => {
    // The break is the editor's, and the measure is still the measure: a
    // segment wider than the board breaks rather than running off it.
    const lines = stacked(
      'Short\nA second segment so long that no seven inch board could ever hope to set it on one single line of fifteen point italic'
    )
    expect(lines.length).toBeGreaterThan(2)
  })
})

/**
 * The edition line is the subtitle slot on a cover that has no subtitle.
 *
 * *The Human Aura and The Astral World* names its two volumes there and *The
 * Theosophical Glossary* says "Illustrated" there. Measured across the shelf
 * with the subtitles pinned at 16 pt, those two set at 15, because the line
 * took a share of the measure and the measure is narrowed by a device above
 * it. Nobody chose that difference and a reader along a shelf can see it.
 */
describe('the edition statement follows the banked subtitle size', () => {
  const editionSize = (pinned: number | null): number => {
    const doc = cover((d) => {
      d.content.title = 'Keys'
      d.content.edition = 'Illustrated'
      d.look.titleCase = 'upper'
      d.look.subtitleSizePt = pinned
    })
    const item = composeCover(doc, { measurer }).items.find(
      (i) => i.kind === 'text' && i.text === 'ILLUSTRATED'
    )
    expect(item?.kind).toBe('text')
    return item?.kind === 'text' ? item.sizePt : 0
  }

  it('sets it at the pinned size', () => {
    expect(editionSize(16)).toBe(16)
    expect(editionSize(13)).toBe(13)
  })

  it('keeps the share of the measure where nothing is pinned', () => {
    const unpinned = editionSize(null)
    expect(unpinned).toBeGreaterThanOrEqual(9)
    expect(unpinned).toBeLessThanOrEqual(16)
    expect(unpinned).not.toBe(13)
  })
})
