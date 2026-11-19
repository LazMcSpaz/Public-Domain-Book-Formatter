import { describe, expect, it } from 'vitest'
import {
  breakParagraph,
  englishHyphenator,
  fixedWidthMeasurer,
  itemsFromText,
  layout,
  withoutRunts,
  MIN_LAST_LINE_EMS,
  type Alignment,
  type BrokenLine,
  type PositionedLine
} from '@core/layout'
import { defaultStyleProfile } from '@core/style'
import type { BookDocument } from '@core/assemble'

/**
 * No paragraph ends on a scrap when `avoidShortLastLines` is on: "pris-" at
 * the end of one line and "on." alone on the next is the fault. Every width is
 * exact arithmetic with the fixed-width measurer (half an em a character), and
 * the measures were found by searching for ones where the plain breaker makes
 * the fault, so each test shows it happening first.
 */
const measurer = fixedWidthMeasurer(0.5)
const font = { family: 'Test', style: 'regular' as const }
const hyphenate = englishHyphenator()
const TEXT = 'Every night the keeper walked the long stone hall and then went back to the prison.'

const text = (broken: BrokenLine[]): string[] =>
  broken.map((line) => line.words.map((w) => w.text).join(' '))

function broken(alignment: Alignment, width: number, avoid: boolean): BrokenLine[] {
  return breakParagraph(TEXT, {
    font,
    sizePt: 10,
    measurer,
    lineWidths: width,
    alignment,
    hyphenate,
    ...(avoid ? { runts: { minLastLineEms: MIN_LAST_LINE_EMS } } : {})
  })
}

/** A runt: the line before the last hyphenated, or a last line under three ems (30pt). */
function endsOnScrap(lines: BrokenLine[]): boolean {
  const last = text(lines)[lines.length - 1] ?? ''
  return (lines[lines.length - 2]?.hyphenated ?? false) || last.length * 5 < 30
}

describe('a paragraph never ends on a scrap', () => {
  it('justified: the fault happens without the setting, and not with it', () => {
    expect(text(broken('justify', 198, false)).slice(-2)).toEqual([
      'stone hall and then went back to the pris-',
      'on.'
    ])
    const ruled = text(broken('justify', 198, true))
    expect(ruled.slice(-2)).toEqual(['stone hall and then went back to the', 'prison.'])
    // The same words; only a break moved.
    expect(ruled.join(' ')).toBe(TEXT)
  })

  it('the line before the last is not hyphenated, even over a last line long enough', () => {
    const longer = (avoid: boolean): string[] =>
      text(
        breakParagraph(
          'The old keeper counted the doors twice each night and remembered everything.',
          {
            font,
            sizePt: 10,
            measurer,
            lineWidths: 142,
            alignment: 'justify',
            hyphenate,
            ...(avoid ? { runts: { minLastLineEms: MIN_LAST_LINE_EMS } } : {})
          }
        )
      )
    expect(longer(false).slice(-2)).toEqual([
      'doors twice each night and re-',
      'membered everything.'
    ])
    expect(longer(true).slice(-2)).toEqual(['doors twice each night and', 'remembered everything.'])
  })

  it('set ragged: the same', () => {
    expect(text(broken('left', 205, false)).pop()).toBe('on.')
    expect(text(broken('left', 205, true)).pop()).toBe('prison.')
  })

  it('at every measure, either the scrap is gone or the paragraph is exactly as before', () => {
    let mended = 0
    for (let width = 110; width <= 320; width++) {
      for (const alignment of ['justify', 'left'] as const) {
        const plain = broken(alignment, width, false)
        const ruled = broken(alignment, width, true)
        if (!endsOnScrap(plain)) {
          // A paragraph with no runt is never touched.
          expect(text(ruled), `${alignment} ${width}`).toEqual(text(plain))
        } else if (endsOnScrap(ruled)) {
          // Both rules could not be kept inside the spacing limit. Either the
          // gentler one was (the last line long enough, a hyphen above it), or
          // the paragraph is left exactly as it was.
          const short = (text(ruled).pop() ?? '').length * 5 < 30
          if (short) expect(text(ruled), `${alignment} ${width}`).toEqual(text(plain))
        } else {
          mended++
        }
      }
    }
    expect(mended).toBeGreaterThan(5)
  })

  it('makes illegal exactly the breaks that would leave a runt', () => {
    const items = itemsFromText('one two three four five six.', {
      font,
      sizePt: 10,
      measurer,
      lineWidths: 100,
      alignment: 'justify'
    })
    // "six." is 20pt wide, under the 30pt minimum: the space before it may not
    // break, and that is the only break taken away.
    const ruled = withoutRunts(items, 30, 100)
    expect(ruled.length).toBe(items.length + 1)
    const at = ruled.findIndex((item) => item.type === 'penalty' && item.cost >= 1000)
    expect(ruled[at + 2]).toMatchObject({ type: 'box', text: 'six.' })
  })

  it('the gentler rule leaves a hyphen above a last line long enough', () => {
    const items = itemsFromText('walked magnificently.', {
      font,
      sizePt: 10,
      measurer,
      lineWidths: 200,
      alignment: 'justify',
      hyphenate
    })
    const hyphens = (list: typeof items) =>
      list.filter((item) => item.type === 'penalty' && item.flagged && item.cost < 1000).length
    expect(hyphens(items)).toBeGreaterThan(1)
    // Both rules: no hyphen may end the line before the last, since what
    // follows any of them fits on one line.
    expect(hyphens(withoutRunts(items, 30, 200))).toBe(0)
    // The gentler rule: only those leaving less than 30pt after them go.
    const gentle = withoutRunts(items, 30, null)
    expect(hyphens(gentle)).toBeGreaterThan(0)
    expect(hyphens(gentle)).toBeLessThan(hyphens(items))
  })
})

describe('the setting on the page', () => {
  // 217.8pt of measure at 11pt is the 198pt-at-10pt case above, exactly.
  const profile = (avoid: boolean) => ({
    ...defaultStyleProfile(),
    margins: { top: 0.75, bottom: 0.75, inner: 0.75, outer: 2.095 },
    paragraphIndentEms: 0,
    avoidShortLastLines: avoid
  })
  const doc: BookDocument = {
    blocks: [{ id: 'p0b0', kind: 'paragraph', text: TEXT, sourcePages: [0] }],
    footnotes: [],
    chapters: [],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: [],
    synopsesUnmatched: []
  }
  const bodyLines = (avoid: boolean): string[] => {
    const book = layout(doc, profile(avoid), measurer, {
      edition: { title: 'T', author: 'A', editionDate: '2026' },
      hyphenate
    })
    // The text block's lines, not the running head or the folio in the margins.
    return book.pages
      .filter((p) => p.section === 'body')
      .flatMap((p) =>
        p.items.filter(
          (i): i is PositionedLine =>
            i.kind === 'line' &&
            i.runs.length > 0 &&
            i.baselinePt > p.frame.yPt &&
            i.baselinePt < p.frame.yPt + p.frame.heightPt
        )
      )
      .map((l) => l.runs.map((r) => r.text).join(' '))
  }

  it('is off by default, so a book already set keeps its breaks', () => {
    expect(defaultStyleProfile().avoidShortLastLines).toBe(false)
  })

  it('off, the page ends the paragraph on "on."; on, it does not', () => {
    const off = bodyLines(false)
    expect(off.slice(-2)).toEqual(['stone hall and then went back to the pris-', 'on.'])
    const on = bodyLines(true)
    expect(on.slice(-2)).toEqual(['stone hall and then went back to the', 'prison.'])
  })
})
