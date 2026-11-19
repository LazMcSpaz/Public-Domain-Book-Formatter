import { describe, expect, it } from 'vitest'
import {
  FOLIO_NOT_MIRRORED,
  FURNITURE_SIZE_RATIO,
  KDP_TRIM_SAFE_PT,
  bottomFolioBaseline,
  fixedWidthMeasurer,
  folioBaseline,
  folioPlace,
  headCapTop,
  layout,
  runningHeadBaseline,
  type LaidOutPage,
  type PositionedLine,
  type TextMeasurer
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import type { StyleProfile } from '@core/model'
import type { BookDocument } from '@core/assemble'

/**
 * The house look's page number sits exactly as far above the bottom edge as
 * the running head's capitals start below the top edge. The fixed-width
 * measurer's capitals are 0.7 of the size, so every number here is exact.
 */
const measurer = fixedWidthMeasurer(0.5)

const house = (over: Partial<StyleProfile> = {}): StyleProfile => ({
  ...defaultStyleProfile(),
  trimSize: '7x10',
  margins: { top: 0.75, bottom: 0.75, inner: 1.125, outer: 0.75 },
  bodyFontSize: 11,
  runningHeads: { verso: 'author', recto: 'chapterTitle' },
  folioMirrorsHead: true,
  ...over
})

const PROSE =
  'The keeper walked the long hall each night and counted the doors twice before he went back. '.repeat(
    40
  )

const doc: BookDocument = {
  blocks: [
    { id: 'p0b0', kind: 'heading', level: 1, text: 'The First Chapter', sourcePages: [0] },
    { id: 'p0b1', kind: 'paragraph', text: PROSE, sourcePages: [0] },
    { id: 'p0b2', kind: 'paragraph', text: PROSE, sourcePages: [0] }
  ],
  footnotes: [],
  chapters: [],
  asides: [],
  illustrations: [],
  sections: [],
  skipped: [],
  synopsesUnmatched: []
}

const lines = (page: LaidOutPage): PositionedLine[] =>
  page.items.filter((i): i is PositionedLine => i.kind === 'line' && i.runs.length > 0)

/** A body page carrying both a running head and a page number. */
function furniture(profile: StyleProfile) {
  const book = layout(doc, profile, measurer, {
    edition: { title: 'A Book', author: 'An Author', editionDate: '2026' }
  })
  const page = book.pages.find((p) => {
    const ls = lines(p)
    return (
      p.section === 'body' &&
      ls.some((l) => l.baselinePt < p.frame.yPt) &&
      ls.some((l) => l.baselinePt > p.frame.yPt + p.frame.heightPt)
    )
  })!
  const head = lines(page).find((l) => l.baselinePt < page.frame.yPt)!
  const folio = lines(page).find((l) => l.baselinePt > page.frame.yPt + page.frame.heightPt)!
  const text = book.pages.flatMap((p) =>
    lines(p)
      .filter((l) => l.baselinePt > p.frame.yPt && l.baselinePt < p.frame.yPt + p.frame.heightPt)
      .map((l) => `${p.index}@${l.baselinePt}:${l.runs.map((r) => r.text).join(' ')}`)
  )
  return { book, page, head, folio, text }
}

describe('the page number mirrors the running head', () => {
  it('sits as far above the bottom edge as the head’s capitals sit below the top', () => {
    const profile = house()
    const { page, head, folio } = furniture(profile)
    const size = 11 * FURNITURE_SIZE_RATIO
    // The head: two body sizes over the text block, its capitals 0.7 of its size tall.
    expect(head.baselinePt).toBeCloseTo(54 - 22, 6)
    const capTop = head.baselinePt - 0.7 * size
    expect(headCapTop(profile, measurer)).toBeCloseTo(capTop, 6)
    expect(page.heightPt - folio.baselinePt).toBeCloseTo(capTop, 6)
    expect(folio.runs[0]!.text).toMatch(/^\d+$/u)
  })

  it('moves no line of text and no page', () => {
    const on = furniture(house())
    const off = furniture(house({ folioMirrorsHead: false }))
    expect(on.book.pages.length).toBe(off.book.pages.length)
    expect(on.text).toEqual(off.text)
    expect(on.head.baselinePt).toBe(off.head.baselinePt)
    expect(on.folio.baselinePt).not.toBe(off.folio.baselinePt)
  })

  it('is off by default: a book already set keeps its page number where it was', () => {
    expect(defaultStyleProfile().folioMirrorsHead).toBe(false)
    const profile = house({ folioMirrorsHead: false })
    const { folio } = furniture(profile)
    expect(folio.baselinePt).toBeCloseTo(bottomFolioBaseline(profile), 6)
    expect(folio.baselinePt).toBeCloseTo(720 - 54 + 11 * 1.6, 6)
  })

  it('never comes nearer the bottom edge than KDP’s 0.25 in plus the figures’ descent', () => {
    // A top margin so small the head sits 12pt from the top: mirrored, the
    // number would be 5.5pt from the bottom edge, inside the no-print band.
    const profile = house({ margins: { top: 0.4, bottom: 0.75, inner: 1.125, outer: 0.75 } })
    expect(runningHeadBaseline(profile)).toBe(12)
    const descent = 0.25 * 11 * FURNITURE_SIZE_RATIO
    expect(720 - folioBaseline(profile, measurer)).toBeCloseTo(KDP_TRIM_SAFE_PT + descent, 6)
  })

  it('never rises into the text: a deep top and a shallow bottom keep the old place, said', () => {
    // Mirrored, the number would be 42.8pt from the foot, and the text block
    // runs down to 36pt from it: the number would print into the last line.
    const profile = house({ margins: { top: 1, bottom: 0.5, inner: 1.125, outer: 0.75 } })
    const { book, page, folio } = furniture(profile)
    expect(folioPlace(profile, measurer).mirrored).toBe(false)
    expect(folio.baselinePt).toBeCloseTo(bottomFolioBaseline(profile), 6)
    expect(folio.baselinePt).toBeGreaterThan(page.frame.yPt + page.frame.heightPt)
    expect(book.warnings.map((w) => w.text)).toContain(FOLIO_NOT_MIRRORED)
    // The house look's own margins mirror, with nothing to warn about.
    expect(folioPlace(house(), measurer).mirrored).toBe(true)
    expect(furniture(house()).book.warnings).toEqual([])
    expect(furniture(house({ ...profile, folioMirrorsHead: false })).book.warnings).toEqual([])
  })

  it('reads the face’s cap height, and its ascent where the measurer has none', () => {
    expect(measurer.metrics({ family: 'T', style: 'regular' }, 10).ascent).toBe(7.5)
    const noCap: TextMeasurer = {
      ...measurer,
      metrics: (font, size) => {
        const m = measurer.metrics(font, size)
        return { ascent: m.ascent, descent: m.descent, lineGap: m.lineGap }
      }
    }
    const profile = house()
    expect(headCapTop(profile, noCap)).toBeCloseTo(32 - 0.75 * 11 * FURNITURE_SIZE_RATIO, 6)
    expect(headCapTop(profile, measurer)).toBeCloseTo(32 - 0.7 * 11 * FURNITURE_SIZE_RATIO, 6)
  })
})
