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
  validateCover,
  defaultCover,
  fitText,
  wrapText,
  stackedLines,
  BLURB_PT,
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

describe('a title can be stacked where the editor stacks it', () => {
  const font = { family: 'x', style: 'regular' as const }

  it('breaks where the newlines are, and sets no newline', () => {
    const lines = stackedLines('The\nManuscript\nLectures', 400, font, 10, measurer)
    expect(lines).toEqual(['The', 'Manuscript', 'Lectures'])
    for (const l of lines) expect(l).not.toMatch(/\n/)
  })

  it('still breaks a stacked line too long for the measure', () => {
    // Fixed-width: 10pt glyphs are 5pt each, so 50pt holds ten characters.
    expect(stackedLines('aaaa bbbb\ncc', 50, font, 10, measurer)).toEqual(['aaaa bbbb', 'cc'])
  })

  it('leaves an unstacked title to the breaker', () => {
    expect(stackedLines('aaaa bbbb cccc', 50, font, 10, measurer)).toEqual(
      wrapText('aaaa bbbb cccc', 50, font, 10, measurer)
    )
  })

  it('fits the size against the stacked lines, not the words', () => {
    // Three short words that would set on one line at a large size. Stacked,
    // they are three lines and the size has to come down to fit the height.
    const box = { widthPt: 400, heightPt: 90 }
    const flat = fitText('The Manuscript Lectures', box, 3, font, measurer)
    const stacked = fitText('The\nManuscript\nLectures', box, 3, font, measurer)
    expect(stacked.lines).toHaveLength(3)
    expect(flat.lines.length).toBeLessThan(3)
    expect(stacked.sizePt).toBeLessThan(flat.sizePt)
  })

  it('sets the title as three lines on the board', () => {
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      d.content.title = 'The\nManuscript\nLectures'
      d.content.subtitle = ''
    })
    const { items } = composeCover(doc, { measurer })
    // The title is whatever is set largest — a size threshold would also catch
    // the author, which is no longer a small line.
    const all = texts(items)
    const biggest = Math.max(...all.map((t) => t.sizePt))
    const title = all.filter((t) => t.sizePt === biggest)
    expect(title.map((t) => t.text)).toEqual(['THE', 'MANUSCRIPT', 'LECTURES'])
  })

  it('flattens it on the spine, where there is no second line to go to', () => {
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      d.look.spineText = true
      d.content.title = 'The\nManuscript\nLectures'
      d.content.author = 'Manly P. Hall'
    })
    const { items, geometry } = composeCover(doc, { measurer })
    const spine = texts(items).filter(
      (t) =>
        t.xPt / 72 >= geometry.spine.x - 0.1 &&
        t.xPt / 72 <= geometry.spine.x + geometry.spine.width + 0.1
    )
    expect(spine.length).toBeGreaterThan(0)
    for (const t of spine) expect(t.text).not.toMatch(/\n/)
    expect(spine.map((t) => t.text).join('')).toContain('The Manuscript Lectures')
  })
})

describe('the back cover sets its copy at the size the look asks for', () => {
  function blurbText(patch: (doc: CoverDocument) => void): CoverTextItem[] {
    const doc = bookCover((d) => {
      d.content.blurb = 'A paragraph of back-cover copy, long enough to break over two lines.'
      d.content.imprint = ''
      patch(d)
    })
    const { items, geometry } = composeCover(doc, { measurer })
    const frame = blurbFrame(geometry)
    return texts(items).filter(
      (t) => t.xPt / 72 >= frame.x - 0.5 && t.xPt / 72 <= frame.x + frame.width + 0.5
    )
  }

  it('uses the default when the look names none', () => {
    for (const t of blurbText(() => {})) expect(t.sizePt).toBe(BLURB_PT)
  })

  it('sets every run at the asked size, and leads from it', () => {
    const drawn = blurbText((d) => {
      d.look.blurbSizePt = 13.5
    })
    for (const t of drawn) expect(t.sizePt).toBe(13.5)
    const ys = [...new Set(drawn.map((t) => t.yPt))].sort((a, b) => a - b)
    expect(ys.length).toBeGreaterThan(1)
    // The leading is a share of the size, not of the default: a larger size
    // set on the old grid would print its lines through each other.
    expect(ys[1]! - ys[0]!).toBeCloseTo(13.5 * 1.4, 6)
  })

  it('reports copy it had to cut rather than cutting it in silence', () => {
    const doc = bookCover((d) => {
      d.content.blurb = 'Sentence after sentence of back-cover copy. '.repeat(60)
      d.look.blurbSizePt = 13.5
    })
    const { warnings } = composeCover(doc, { measurer })
    expect(warnings.some((w) => /back-cover copy is longer/.test(w))).toBe(true)
    // And a blurb that fits says nothing about its length.
    expect(
      composeCover(bookCover(), { measurer }).warnings.some((w) =>
        /back-cover copy is longer/.test(w)
      )
    ).toBe(false)
  })
})

describe('a frame can be struck round the back-cover copy', () => {
  /** The fills of the blurb's box, by their bounds. */
  function boxAndCopy(style: 'none' | 'plain' | 'double') {
    const doc = bookCover((d) => {
      d.content.blurb = 'A paragraph of back-cover copy, long enough to break over two lines.'
      d.content.imprint = ''
      d.look.blurbBorder = style
      d.look.blurbSizePt = 12
    })
    const { items, geometry } = composeCover(doc, { measurer })
    const frame = blurbFrame(geometry)
    const copy = texts(items).filter(
      (t) => t.xPt / 72 >= frame.x - 0.5 && t.xPt / 72 <= frame.x + frame.width + 0.5
    )
    const rules = items
      .filter((i): i is Extract<typeof i, { kind: 'fill' }> => i.kind === 'fill')
      .filter(
        (f) => f.xPt / 72 > geometry.back.x && f.xPt / 72 < geometry.back.x + geometry.back.width
      )
    return { items, geometry, frame, copy, rules }
  }

  it('draws nothing when none is asked for', () => {
    expect(boxAndCopy('none').rules).toEqual([])
  })

  it('encloses the copy with white around it, and nothing else', () => {
    const { copy, rules, geometry } = boxAndCopy('plain')
    expect(rules.length).toBe(4)
    const left = Math.min(...rules.map((r) => r.xPt))
    const right = Math.max(...rules.map((r) => r.xPt + r.widthPt))
    const top = Math.min(...rules.map((r) => r.yPt))
    const bottom = Math.max(...rules.map((r) => r.yPt + r.heightPt))

    const copyLeft = Math.min(...copy.map((t) => t.xPt))
    const copyRight = Math.max(...copy.map((t) => t.xPt + t.widthPt))
    const copyTop = Math.min(...copy.map((t) => t.yPt - t.ascentPt))
    const copyBottom = Math.max(...copy.map((t) => t.yPt + t.descentPt))
    expect(left).toBeLessThan(copyLeft)
    expect(right).toBeGreaterThan(copyRight)
    expect(top).toBeLessThan(copyTop)
    expect(bottom).toBeGreaterThan(copyBottom)

    // Round the copy, not round the frame it was set in: that frame runs down
    // to the barcode, so a box on it would stand on empty board.
    expect(bottom / 72).toBeLessThan(geometry.barcode.y)
    expect((bottom - top) / 72).toBeLessThan(geometry.backSafe.height / 2)
    // And inside the safe area, which is what the padding has to respect.
    expect(
      contains(geometry.backSafe, {
        x: left / 72,
        y: top / 72,
        width: (right - left) / 72,
        height: (bottom - top) / 72
      })
    ).toBe(true)
  })

  it('draws two rules a side for a double frame', () => {
    expect(boxAndCopy('double').rules.length).toBe(8)
  })

  it('grows with the copy rather than standing at a fixed height', () => {
    const short = boxAndCopy('plain')
    const doc = bookCover((d) => {
      d.content.blurb =
        'A paragraph of back-cover copy, long enough to break over two lines.\n\n'.repeat(3)
      d.content.imprint = ''
      d.look.blurbBorder = 'plain'
      d.look.blurbSizePt = 12
    })
    const { items } = composeCover(doc, { measurer })
    const rules = items.filter((i) => i.kind === 'fill' && i.heightPt < 2)
    const tall = Math.max(...rules.map((r) => ('yPt' in r ? r.yPt : 0)))
    const shortBottom = Math.max(...short.rules.map((r) => r.yPt))
    expect(tall).toBeGreaterThan(shortBottom)
  })
})

describe('the author can be set at the foot', () => {
  /** Where "Amos Root" is drawn, in points down the cover. */
  function authorY(patch: (doc: CoverDocument) => void): number {
    const doc = bookCover((d) => {
      d.look.arrangement = 'label'
      patch(d)
    })
    const { items } = composeCover(doc, { measurer })
    const line = texts(items).find((t) => t.text.includes('Amos Root'))
    if (!line) throw new Error('the author was not set at all')
    return line.yPt
  }

  it('leaves it in the block under the title by default', () => {
    const { geometry } = composeCover(
      bookCover((d) => (d.look.arrangement = 'label')),
      {
        measurer
      }
    )
    // A label stacks everything near the head, so the author is above the
    // middle of the board — which is the thing the flag moves it out of.
    expect(authorY(() => {})).toBeLessThan((geometry.fullHeightIn * 72) / 2)
  })

  it('sets it exactly where a typographic cover sets it', () => {
    // The invariant rather than a proxy for it: there is one low position on
    // this board and both doors reach it, so a change to that position cannot
    // move the author on one kind of cover and leave it on the other. To
    // within a point, because the two arrangements fit the title to different
    // sizes and the author's size follows the title's, so the baselines sit a
    // fraction apart under a block top that is the same.
    const typographic = texts(composeCover(bookCover(), { measurer }).items).find((t) =>
      t.text.includes('Amos Root')
    )!
    expect(authorY((d) => (d.look.authorAtFoot = true))).toBeCloseTo(typographic.yPt, 0)
  })

  it('changes nothing on a typographic cover, which already sets it low', () => {
    const low = (flag: boolean): number => {
      const doc = bookCover((d) => (d.look.authorAtFoot = flag))
      const line = texts(composeCover(doc, { measurer }).items).find((t) =>
        t.text.includes('Amos Root')
      )!
      return line.yPt
    }
    expect(low(true)).toBeCloseTo(low(false), 9)
  })
})

/**
 * The engine and the safe-area check must measure a spine the same way.
 *
 * They did not: the size was computed from `ascent - descent`, which is twice
 * the offset from the fold's centre line to the baseline and not a height,
 * while `itemBounds` gives a rotated run `ascent + descent` — 0.709 em
 * against 1.305 for EB Garamond. Four of the ten covers on this shelf were
 * built, measured against their own pixels, committed and pushed, and only
 * caught when the validator was run before handing the files over. A number
 * taken from one definition and tested against another is not measured.
 */
describe('a spine the validator will accept', () => {
  it('keeps every thin-spined cover inside its own safe area', () => {
    for (const pageCount of [80, 120, 158, 200, 300]) {
      const doc = bookCover((d) => {
        d.look.arrangement = 'label'
        d.content.author = 'Amos Root'
        d.pageCount = pageCount
        d.look.spineSizePt = 27
      })
      const composed = composeCover(doc, { measurer })
      const report = validateCover({
        doc,
        composed,
        fileBytes: 1000,
        fontsEmbedded: true,
        pageCountMeasured: true
      })
      const safe = report.checks.find((c) => c.id === 'safe-margin')
      expect(safe?.level, `${pageCount} pages: ${safe?.detail ?? ''}`).toBe('ok')
    }
  })
})
