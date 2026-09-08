import { describe, it, expect } from 'vitest'
import { familyStack, readingStyle } from '@core/style'
import { LEADING_RATIO, frameFor } from '@core/layout'
import type { StyleProfile } from '@core/model'

const profile = (over: Partial<StyleProfile> = {}): StyleProfile =>
  ({
    id: 'p',
    name: 'Test',
    trimSize: '6x9',
    margins: { top: 0.75, bottom: 0.75, inner: 0.75, outer: 0.6 },
    gutter: 0.13,
    bodyFont: 'EB Garamond',
    bodyFontSize: 11,
    headingFont: 'EB Garamond',
    headingStyle: { smallCaps: true, centered: true, scale: 1.3 },
    runningHeads: { verso: 'author', recto: 'title' },
    runningHeadStyle: 'small-caps',
    dropCap: false,
    paragraphIndentEms: 1.2,
    paragraphSpacingEms: 0,
    hyphenate: true,
    opticalMargins: true,
    typographicQuotes: true,
    chaptersOpenRecto: true,
    pageNumber: 'bottom-center',
    contentsSynopsis: true,
    ornaments: {},
    frontMatter: { titlePage: true, copyrightPage: true, halfTitle: false, titleBorder: false },
    ...over
  }) as StyleProfile

describe('the design a reading column is set from', () => {
  it('takes its measure from the engine, in ems of the body size', () => {
    // The one number that makes a screen read like the book. Derived from
    // `frameFor` rather than from a second copy of the trim arithmetic: the
    // measure a reader sees and the measure the book prints must come from one
    // place, or the column stops matching the day a margin changes.
    const p = profile()
    const expected = frameFor(p, 'recto').widthPt / p.bodyFontSize
    expect(readingStyle(p).measureEms).toBeCloseTo(expected, 6)
    // A 6x9 page with these margins is a little over thirty ems — about the
    // sixty-five characters a book sets to the line.
    expect(readingStyle(p).measureEms).toBeGreaterThan(25)
    expect(readingStyle(p).measureEms).toBeLessThan(40)
  })

  it('narrows the measure when the margins widen', () => {
    const wide = profile({ margins: { top: 0.75, bottom: 0.75, inner: 1.5, outer: 1.5 } })
    expect(readingStyle(wide).measureEms).toBeLessThan(readingStyle(profile()).measureEms)
  })

  it('widens it on a larger trim', () => {
    expect(readingStyle(profile({ trimSize: '8.5x11' })).measureEms).toBeGreaterThan(
      readingStyle(profile()).measureEms
    )
  })

  it('uses the engine’s own leading ratio rather than a number that looks right', () => {
    expect(readingStyle(profile()).lineHeight).toBe(LEADING_RATIO)
  })

  it('carries the design decisions the reader can see', () => {
    const p = profile({
      dropCap: true,
      hyphenate: false,
      paragraphIndentEms: 0,
      paragraphSpacingEms: 0.6,
      headingStyle: { smallCaps: false, centered: false, scale: 1.6 }
    })
    const style = readingStyle(p)
    expect(style).toMatchObject({
      dropCap: true,
      hyphenate: false,
      indentEms: 0,
      spacingEms: 0.6,
      headingScale: 1.6,
      headingSmallCaps: false,
      headingCentered: false
    })
  })

  it('sets the body in the face the book will be printed in', () => {
    expect(readingStyle(profile({ bodyFont: 'Cardo' })).bodyFamily).toContain('Cardo')
    expect(readingStyle(profile({ bodyFont: 'IM FELL English' })).bodyFamily).toContain('IM FELL')
  })

  it('gives every face a real fallback, so the column is bookish before the file loads', () => {
    // Substituting a modern for a Garamond is a visible change of book, so each
    // family names its nearest system relative rather than falling to whatever
    // the browser calls "serif".
    for (const family of ['EB Garamond', 'Cardo', 'IM FELL English', 'Junicode']) {
      expect(familyStack(family).split(',').length).toBeGreaterThan(2)
      expect(familyStack(family)).toMatch(/serif$/u)
    }
    // And a face nobody has heard of still gets a stack rather than nothing.
    expect(familyStack("O'Hara Display")).toMatch(/serif$/u)
  })
})
