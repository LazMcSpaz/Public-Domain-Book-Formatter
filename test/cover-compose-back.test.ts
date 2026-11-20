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
import {
  blurbFrame,
  contains,
  composeCover,
  coverGeometry,
  defaultCover,
  overlaps,
  wrapText,
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

describe('the back cover is set to a readable measure', () => {
  it('sits an inch in from both trimmed edges of the back panel', () => {
    const g = coverGeometry({ trimSize: '6x9', pageCount: 168, paper: 'bw-cream' })
    const frame = blurbFrame(g)
    expect(frame.x - g.back.x).toBeCloseTo(1, 6)
    expect(g.back.x + g.back.width - (frame.x + frame.width)).toBeCloseTo(1, 6)
    expect(frame.width).toBeCloseTo(4, 6)
  })

  it('narrows and centres rather than stretching on a wide trim', () => {
    // An inch either side of an 8.5×11 still leaves six and a half inches,
    // which is a hundred and thirteen characters a line and worse than the
    // problem the inset was added to fix.
    const g = coverGeometry({ trimSize: '8.5x11', pageCount: 200, paper: 'bw-white' })
    const frame = blurbFrame(g)
    expect(frame.width).toBeLessThan(g.back.width - 2)
    const leftGap = frame.x - g.back.x
    const rightGap = g.back.x + g.back.width - (frame.x + frame.width)
    expect(leftGap).toBeCloseTo(rightGap, 6)
  })

  it('keeps the copy clear of the barcode and inside the safe area', () => {
    const g = coverGeometry({ trimSize: '6x9', pageCount: 168, paper: 'bw-cream' })
    const frame = blurbFrame(g)
    expect(overlaps(frame, g.barcode)).toBe(false)
    expect(contains(g.backSafe, frame)).toBe(true)
  })

  it('aligns the imprint with the copy above it', () => {
    const doc = bookCover((d) => {
      d.content.blurb = 'A paragraph of back-cover copy.'
      d.content.imprint = 'Libri Vetus'
    })
    const { items, geometry } = composeCover(doc, { measurer })
    const frame = blurbFrame(geometry)
    const imprint = texts(items).find((t) => t.text === 'Libri Vetus')!
    // Not the safe area: an imprint three quarters of an inch to the left of
    // the only other text on the panel reads as having come adrift from it.
    expect(imprint.xPt / 72).toBeCloseTo(frame.x, 6)
  })
})

describe("the blurb is the editor's own prose, and is set as such", () => {
  /** Every text item inside the blurb's frame, in the order it is drawn. */
  function blurbItems(blurb: string, m = measurer): CoverTextItem[] {
    const doc = bookCover((d) => {
      d.content.blurb = blurb
      d.content.imprint = ''
    })
    const { items, geometry } = composeCover(doc, { measurer: m })
    const frame = blurbFrame(geometry)
    // Bounded in both axes: the front panel's own type sits at some of the
    // same heights, and a y-only filter quietly mixes it in.
    return texts(items).filter(
      (t) =>
        t.yPt / 72 >= frame.y - 0.1 &&
        t.yPt / 72 <= frame.y + frame.height + 0.1 &&
        t.xPt / 72 >= frame.x - 0.1 &&
        t.xPt / 72 <= frame.x + frame.width + 0.1
    )
  }

  it('sets a named book in italic rather than printing its tags', () => {
    const drawn = blurbItems('Five years before <i>The Secret Teachings</i> was published.')
    // No tag survives into anything that gets drawn. The fault this replaces
    // printed the angle brackets, so the whole line came out in one roman run.
    expect(drawn.map((t) => t.text).join('')).not.toMatch(/[<>]/)
    const italic = drawn.filter((t) => t.font.style === 'italic')
    expect(italic.length).toBeGreaterThan(0)
    expect(italic.map((t) => t.text.trim()).join(' ')).toBe('The Secret Teachings')
    // And the words either side of it stay roman.
    const roman = drawn.filter((t) => t.font.style === 'regular')
    expect(roman.map((t) => t.text).join('')).toContain('Five years before')
    expect(roman.map((t) => t.text).join('')).toContain('was published')
  })

  it('draws the runs of a line end to end', () => {
    const drawn = blurbItems('Before <i>Isis Unveiled</i> there was nothing.')
    const line = drawn.filter((t) => Math.abs(t.yPt - drawn[0]!.yPt) < 0.01)
    expect(line.length).toBeGreaterThan(1)
    for (let i = 1; i < line.length; i++) {
      // Each run begins exactly where the last ended, so the writer advances
      // by widths this pass measured and never re-derives a word space.
      expect(line[i]!.xPt).toBeCloseTo(line[i - 1]!.xPt + line[i - 1]!.widthPt, 6)
    }
  })

  it('breaks on the whole line, the emphasis included', () => {
    const bare =
      'A paragraph long enough to break, naming The Secret Teachings of All Ages ' +
      'somewhere in the middle of it, and running on afterwards for a while yet.'
    const marked = bare.replace(
      'The Secret Teachings of All Ages',
      '<i>The Secret Teachings of All Ages</i>'
    )
    const drawn = blurbItems(marked)
    const g = coverGeometry({ trimSize: '6x9', pageCount: 284, paper: 'bw-cream' })
    const frame = blurbFrame(g)

    // A line is several items now, so its width is their sum — and a breaker
    // that measured only the run it started in would set past the measure
    // without any single item doing so.
    const byLine = new Map<number, CoverTextItem[]>()
    for (const t of drawn) byLine.set(t.yPt, [...(byLine.get(t.yPt) ?? []), t])
    expect(byLine.size).toBeGreaterThan(2)
    for (const line of byLine.values()) {
      const width = line.reduce((w, t) => w + t.widthPt, 0)
      expect(width).toBeLessThanOrEqual(frame.width * 72 + 1e-6)
    }

    // Measured against the same text with no tags in it: the fake measurer
    // gives both faces the same advances, so the words must fall identically.
    const lines = [...byLine.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, runs]) =>
        runs
          .map((t) => t.text)
          .join('')
          .trim()
      )
    expect(lines).toEqual(
      wrapText(bare, frame.width * 72, { family: 'x', style: 'regular' }, 10.5, measurer)
    )
  })

  it("turns the editor's typewriter quotes into printer's quotes", () => {
    const drawn = blurbItems('No. 1 calls it "Black Magic pure and simple", and it isn\'t gentle.')
    const set = drawn.map((t) => t.text).join('')
    expect(set).not.toMatch(/["']/)
    expect(set).toContain('\u201cBlack')
    expect(set).toContain('simple\u201d')
    expect(set).toContain('isn’t')
  })

  it('sets a strong run in italic in a face with no bold, and bold in one with', () => {
    // The same refusal the layout engine makes: never a synthesised bold.
    const plain = blurbItems('The rule is <b>never</b> broken.')
    expect(plain.find((t) => t.text.trim() === 'never')!.font.style).toBe('italic')

    const bolder = blurbItems('The rule is <b>never</b> broken.', {
      ...measurer,
      hasBold: () => true
    })
    expect(bolder.find((t) => t.text.trim() === 'never')!.font.style).toBe('bold')
  })
})

/**
 * The fold's own bound on spine type, from the face rather than a constant.
 *
 * It was `0.62` of the safe fold, and measured off a rendered sheet that is
 * two and a third times too careful: the 0.356 in spine of *The Lost Keys of
 * Masonry* used 0.10 in of ink across a fold with 0.231 in to give. The bound
 * is the height of the line's own box now, which is what the same metrics
 * centre it by — at 10.3 pt that box is 0.101 in and the measured ink was
 * 0.10 in, so the two agree to a thousandth.
 */
function foldRoom(
  geometry: { spineSafe?: { width: number } | null },
  m: typeof measurer,
  font: Parameters<typeof measurer.metrics>[0]
): number {
  const at = m.metrics(font, 100)
  const boxPerEm = (at.ascent + at.descent) / 100
  return ((geometry.spineSafe?.width ?? 0) * 72 * 0.95) / boxPerEm
}

describe('the author and the spine are set to be read, not to be found', () => {
  /** The author line on the front, and the line along the fold. */
  function sizes(patch: (doc: CoverDocument) => void = () => {}) {
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      d.content.author = 'Amos Root'
      patch(d)
    })
    const { items, geometry } = composeCover(doc, { measurer })
    const author = texts(items).find((t) => t.text === 'Amos Root' && t.rotate !== -90)
    const spine = texts(items).find((t) => t.rotate === -90)
    return { author, spine, geometry }
  }

  it('sets the author at over half the title', () => {
    const { author } = sizes((d) => {
      d.look.titleSizePt = 30
    })
    // The editor's standing note: the name was coming out a caption on every
    // cover. A reader along a shelf is often looking for it rather than the
    // title, and the size was settled against a rendered search thumbnail.
    expect(author!.sizePt).toBeGreaterThan(30 * 0.6)
  })

  it('never sets it smaller than the floor, whatever the title does', () => {
    const { author } = sizes((d) => {
      d.look.titleSizePt = 16
    })
    expect(author!.sizePt).toBeGreaterThanOrEqual(16)
  })

  it('still scales with the title rather than standing at the floor', () => {
    const small = sizes((d) => {
      d.look.titleSizePt = 30
    })
    const large = sizes((d) => {
      d.look.titleSizePt = 48
    })
    expect(large.author!.sizePt).toBeGreaterThan(small.author!.sizePt)
  })

  it('lets a thick spine use the fold rather than stopping at a fixed size', () => {
    // This asserted 16 pt, which was the backstop doing the binding. Measured
    // across the shelf, three spines of about 1.1 in could each carry 27 to 33
    // pt and every one of them set at 16, leaving two thirds of the fold empty
    // on the part of a book a shelf actually shows. What should decide a spine
    // is the fold and the length of the line, so the backstop is now a size no
    // ordinary fold reaches and the test asks for the property, not the number.
    const { spine, geometry } = sizes((d) => {
      d.pageCount = 477
    })
    const room = foldRoom(geometry, measurer, { family: 'EB Garamond', style: 'regular' })
    expect(spine!.sizePt).toBeGreaterThan(16)
    expect(spine!.sizePt).toBeLessThanOrEqual(room + 1e-6)
  })

  it('sets the collection\u2019s banked spine size where the fold can hold it', () => {
    const { spine } = sizes((d) => {
      d.pageCount = 477
      d.look.spineSizePt = 27
    })
    expect(spine!.sizePt).toBe(27)
  })

  it('uses the fold it has, rather than a fraction of it', () => {
    // The bound above is one-sided: a size smaller than the room is still
    // under the room, so asserting only that passes against the constant it
    // replaced. (It did.) What separates them is how much of the fold the
    // type's own box actually occupies — 0.62 of it under the old constant,
    // and `SPINE_FOLD_MARGIN` of it now. Measured off a rendered sheet, the
    // old one left 0.12 and 0.14 in of bare board either side of a line on a
    // 0.356 in spine.
    const { spine, geometry } = sizes((d) => {
      d.pageCount = 158
    })
    const font = { family: 'EB Garamond', style: 'regular' as const }
    const at = measurer.metrics(font, 100)
    const boxPerEm = (at.ascent + at.descent) / 100
    const boxPt = spine!.sizePt * boxPerEm
    const foldPt = (geometry.spineSafe?.width ?? 0) * 72
    expect(boxPt / foldPt).toBeGreaterThan(0.8)
    expect(boxPt / foldPt).toBeLessThanOrEqual(0.95)
  })

  it('cuts a banked spine size down to a thin fold, and says so', () => {
    // Thin enough that the fold itself binds: at 80 pages on white stock the
    // safe fold is a tenth of an inch and no face fits 27 pt across it.
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      d.content.author = 'Amos Root'
      d.pageCount = 80
      d.look.spineSizePt = 27
    })
    const composed = composeCover(doc, { measurer })
    const spine = composed.items.find((i) => i.kind === 'text' && i.rotate === -90)
    expect(spine?.kind).toBe('text')
    expect(spine!.kind === 'text' && spine!.sizePt).toBeLessThan(27)
    expect(composed.warnings.join(' ')).toMatch(/rather than the collection/)
  })

  it('is still bounded by the thickness on a slimmer book', () => {
    // The ceiling is not what protects a thin spine — the fold's own width is,
    // and raising the one must not reach past the other.
    const { spine, geometry } = sizes((d) => {
      d.pageCount = 120
    })
    const room = foldRoom(geometry, measurer, { family: 'EB Garamond', style: 'regular' })
    expect(spine).toBeDefined()
    expect(spine!.sizePt).toBeLessThanOrEqual(room + 1e-6)
  })
})
