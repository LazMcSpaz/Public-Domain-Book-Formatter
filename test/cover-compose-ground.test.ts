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
  GROUND_PATTERNS,
  groundPattern,
  isImageGround,
  MAX_PATTERN_OPACITY,
  MIN_PATTERN_OPACITY,
  PATTERN_OPACITY,
  patternOpacity,
  composeCover,
  defaultCover,
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

describe('how faint a ground prints is the pattern’s, until a book says otherwise', () => {
  it('defers to the pattern when the book has not been asked', () => {
    // `null` is the answer a look banked before the question existed carries,
    // and it has to mean "whatever this pattern was measured at" — not a
    // default, which would change the appearance of every such look.
    for (const pattern of GROUND_PATTERNS) {
      expect(patternOpacity(pattern, null)).toBe(PATTERN_OPACITY[pattern])
    }
  })

  it('takes the book’s number when there is one, clamped to what a press holds', () => {
    expect(patternOpacity('laid', 0.12)).toBe(0.12)
    expect(patternOpacity('laid', 0.9)).toBe(MAX_PATTERN_OPACITY)
    expect(patternOpacity('laid', 0.001)).toBe(MIN_PATTERN_OPACITY)
    // Not a number at all is the same as not having been asked.
    expect(patternOpacity('laid', Number.NaN)).toBe(PATTERN_OPACITY.laid)
  })

  it('reaches a drawn ground and a picture-backed one alike', () => {
    const drawn = composeCover(
      bookCover((d) => {
        d.look.groundPattern = 'laid'
        d.look.groundPatternOpacity = 0.13
      }),
      { measurer, ornaments: BUILTIN_ORNAMENTS }
    )
    const paths = drawn.items.find((i) => i.kind === 'ornament' && i.opacity !== undefined)!
    if (paths.kind !== 'ornament') throw new Error('unreachable')
    expect(paths.opacity).toBe(0.13)

    const pictured = composeCover(
      bookCover((d) => {
        d.look.groundPattern = 'marbled'
        d.look.groundPatternOpacity = 0.13
      }),
      { measurer }
    )
    const picture = pictured.items.find((i) => i.kind === 'image' && i.id === GROUND_IMAGE_ID)!
    if (picture.kind !== 'image') throw new Error('unreachable')
    expect(picture.opacity).toBe(0.13)
  })
})

describe('the book’s own text as a ground', () => {
  function lexicon(patch: (d: CoverDocument) => void = () => {}): CoverDocument {
    return bookCover((d) => {
      d.look.groundPattern = 'lexicon'
      patch(d)
    })
  }

  it('is a picture rather than paths, like the marble and for the same reason', () => {
    // Glyph outlines by the thousand, which `drawSvgPath` would write as one
    // flat fill per path; it is rasterised by the browser instead.
    expect(isImageGround('lexicon')).toBe(true)
    expect(groundPattern('lexicon', 100, 100, BUILTIN_ORNAMENTS[0]!)).toEqual([])
  })

  it('runs across the back, the spine and the front as one field', () => {
    // The whole argument for a text ground crossing the fold: it is allover,
    // so there is no subject for a fold that creeps to move. A figure gets its
    // own panel; this does not need one.
    const { items, geometry } = composeCover(lexicon(), { measurer })
    const ground = items.find((i) => i.kind === 'image' && i.id === GROUND_IMAGE_ID)!
    if (ground.kind !== 'image') throw new Error('unreachable')
    expect(ground.xPt).toBe(0)
    expect(ground.widthPt).toBeCloseTo(geometry.fullWidthIn * 72, 4)
    expect(ground.widthPt).toBeGreaterThan(geometry.front.width * 72)
  })

  it('prints faint enough to be a surface', () => {
    const { items } = composeCover(lexicon(), { measurer })
    const ground = items.find((i) => i.kind === 'image' && i.id === GROUND_IMAGE_ID)!
    if (ground.kind !== 'image') throw new Error('unreachable')
    expect(ground.opacity).toBe(PATTERN_OPACITY.lexicon)
    expect(ground.opacity!).toBeLessThanOrEqual(MAX_PATTERN_OPACITY)
    expect(ground.opacity!).toBeGreaterThanOrEqual(MIN_PATTERN_OPACITY)
  })
})

describe('a pinned title size reaches both arrangements', () => {
  it('pins a single title, as it always did', () => {
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      d.look.titleSizePt = 27
    })
    const { items } = composeCover(doc, { measurer })
    // The title, not the largest thing on the sheet: the spine's line is set
    // along the fold and may now be larger than a pinned title, so a max over
    // everything stopped naming the thing this test is about.
    const onFront = texts(items).filter((t) => t.rotate !== -90)
    expect(Math.max(...onFront.map((t) => t.sizePt))).toBe(27)
  })

  it('pins an omnibus too, which it silently did not', () => {
    // `titleSizePt` is documented as setting the title's size. On a volume
    // holding two works it was read by nothing and no warning said so, so a
    // banked look that pinned a size got a fitted one on exactly the book
    // whose title is hardest to fit.
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      d.look.titleSizePt = 27
      d.content.works = ['The Human Aura', 'The Astral World']
    })
    const { items } = composeCover(doc, { measurer })
    const set = texts(items).filter((t) => t.text.includes('ASTRAL') || t.text.includes('AURA'))
    expect(set.length).toBeGreaterThan(0)
    for (const line of set) expect(line.sizePt).toBe(27)
  })

  it('still fits an omnibus when nothing is pinned', () => {
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      d.content.works = ['The Human Aura', 'The Astral World']
    })
    const { items } = composeCover(doc, { measurer })
    const big = Math.max(...texts(items).map((t) => t.sizePt))
    expect(big).toBeGreaterThan(0)
    expect(Number.isFinite(big)).toBe(true)
  })
})

describe('an edition statement stacks where the editor breaks it', () => {
  function stacked(edition: string) {
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      d.content.edition = edition
    })
    return texts(composeCover(doc, { measurer }).items)
  }

  it('sets a newline as two lines, not as a space', () => {
    const two = stacked('Occult Manuals\nVolumes I and II')
    expect(two.some((t) => t.text === 'OCCULT MANUALS')).toBe(true)
    expect(two.some((t) => t.text === 'VOLUMES I AND II')).toBe(true)
    expect(two.some((t) => t.text.includes('MANUALS VOLUMES'))).toBe(false)
  })

  it('stacks downward, and the second line takes its own slot', () => {
    const two = stacked('Occult Manuals\nVolumes I and II')
    const first = two.find((t) => t.text === 'OCCULT MANUALS')!
    const second = two.find((t) => t.text === 'VOLUMES I AND II')!
    expect(second.yPt).toBeGreaterThan(first.yPt)
    expect(second.yPt - first.yPt).toBeGreaterThanOrEqual(first.sizePt)
  })

  it('leaves a single line alone', () => {
    const one = stacked('Illustrated')
    expect(one.filter((t) => t.text === 'ILLUSTRATED').length).toBe(1)
  })
})
