import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import fontkit from '@pdf-lib/fontkit'
import {
  DEFAULT_SHORT_BOOK,
  hasOwnDesign,
  houseDesignFor,
  houseLookLine,
  inheritDesign,
  isShortBook,
  normalizeStyleProfile,
  parseHouseLook,
  styleQuestions,
  trimForLength,
  type HouseLook
} from '@core/style'
import { appliedLook, initialState } from '@core/wizard'
import type { Answers } from '@core/wizard/questions'
import {
  fixedWidthMeasurer,
  folioBaseline,
  folioPlace,
  frameFor,
  headCapTop,
  runningHeadBaseline,
  type TextMeasurer
} from '@core/layout'
import { validateKdp } from '@core/typeset'
import { findOrnament } from '@core/ornament'
import { BODY_FONTS } from '@core/design'
import { HOUSE_LOOK_PATH, houseLookPath } from '@core/sync'
import type { StyleProfile } from '@core/model'

/**
 * The house look: a file of design answers at the top of the shelf, which a
 * book with no design of its own inherits. This one is made up for the test;
 * it uses the settings the owner decided on, not any book's text.
 */
const HOUSE: Answers = {
  kind: 'nonfiction',
  period: 'victorian',
  chapterOpener: 'ornamented',
  runningHeads: 'chapter',
  font: 'libre-caslon',
  dropCap: false,
  runningHeadVerso: 'author',
  chaptersOpenRecto: true,
  trimSize: '7x10',
  bodyFontSize: '11',
  ornamentChapter: 'chapter-vine',
  contentsDepth: '1',
  ornamentBlank: 'chapter-asterism',
  frontTitleBorder: true,
  sideHeadsFrom: '3',
  contentsLabelLine: true,
  quoteIndentEms: '4',
  smallCapsFont: 'EB Garamond',
  marginInner: '1.125',
  marginOuter: '0.75',
  runningHeadRise: '1.2',
  folioFromFootPt: '24.8',
  avoidShortLastLines: true
}

/** The new settings of the look: none is in a book set before them. */
const NEW_IDS = [
  'marginInner',
  'marginOuter',
  'folioMirrorsHead',
  'runningHeadRise',
  'folioFromFootPt',
  'avoidShortLastLines'
]

/**
 * The house look before the owner lowered its head (19 November 2026): the
 * head at the standard rise, the page number mirrored on it.
 */
const HOUSE_BEFORE: Answers = {
  ...Object.fromEntries(
    Object.entries(HOUSE).filter(([id]) => id !== 'runningHeadRise' && id !== 'folioFromFootPt')
  ),
  folioMirrorsHead: true
}

const file = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 1, name: 'Test house look', design: HOUSE, ...over })

function look(text = file()): HouseLook {
  const parsed = parseHouseLook(text)
  if (!('look' in parsed)) throw new Error(parsed.error)
  return parsed.look
}

/** The style a set of design answers builds, the way `proof` and the gate build it. */
const styleOf = (design: Answers): StyleProfile =>
  appliedLook({ ...initialState(), styleProfiles: [] }, design).style

describe('the house look file', () => {
  it('lives at the top of the shelf, in the shelf map', () => {
    expect(HOUSE_LOOK_PATH).toBe('imprint/house-look.json')
    expect(houseLookPath()).toBe(HOUSE_LOOK_PATH)
  })

  it('lays a file that names no trim out on 7x10, and its short books on 6x9', () => {
    const { trimSize: _drop, ...noTrim } = HOUSE
    void _drop
    const read = look(file({ design: noTrim, shortBook: { underPages: 100, design: {} } }))
    expect(read.design['trimSize']).toBe('7x10')
    expect(read.shortBook?.design['trimSize']).toBe('6x9')
    expect(houseDesignFor(read, 150).design['trimSize']).toBe('7x10')
    expect(houseDesignFor(read, 40).design['trimSize']).toBe('6x9')
  })

  it('reads a look banked before the new settings existed with both of them off', () => {
    // The app lays a published book over the newest banked look on a device,
    // so a look saved before these settings must never turn them on.
    const old = normalizeStyleProfile({ id: 'sp-old', name: 'Banked last year', trimSize: '7x10' })
    expect(old.folioMirrorsHead).toBe(false)
    expect(old.avoidShortLastLines).toBe(false)
    // Nor move its running head or set its page number.
    expect(old.runningHeadRise).toBe(2)
    expect(old.folioFromFootPt).toBe(0)
    // A banked value is kept when it is one a look may set, and refused otherwise.
    const kept = normalizeStyleProfile({ runningHeadRise: 1.2, folioFromFootPt: 24.8 })
    expect([kept.runningHeadRise, kept.folioFromFootPt]).toEqual([1.2, 24.8])
    const odd = normalizeStyleProfile({ runningHeadRise: 3, folioFromFootPt: -4 })
    expect([odd.runningHeadRise, odd.folioFromFootPt]).toEqual([2, 0])
    expect(normalizeStyleProfile({ runningHeadRise: '1.2' }).runningHeadRise).toBe(2)
  })

  it('reads a good file, with the short-book rule defaulting to under 100 pages at 6x9', () => {
    const read = look()
    expect(read.name).toBe('Test house look')
    expect(read.design).toEqual(HOUSE)
    expect(read.shortBook).toEqual(DEFAULT_SHORT_BOOK)
    expect(DEFAULT_SHORT_BOOK).toEqual({ underPages: 100, design: { trimSize: '6x9' } })
    // Written by Windows PowerShell, with a byte-order mark.
    expect(look(`${String.fromCharCode(0xfeff)}${file()}`).design).toEqual(HOUSE)
  })

  it('takes a short-book rule of its own, or none', () => {
    const own = look(file({ shortBook: { underPages: 80, design: { trimSize: '5.5x8.5' } } }))
    expect(own.shortBook).toEqual({ underPages: 80, design: { trimSize: '5.5x8.5' } })
    expect(look(file({ shortBook: null })).shortBook).toBeNull()
  })

  it('refuses a file it cannot read whole, and says why', () => {
    const error = (text: string): string => {
      const parsed = parseHouseLook(text)
      return 'error' in parsed ? parsed.error : 'read'
    }
    expect(error('{')).toMatch(/not JSON/u)
    expect(error(JSON.stringify({ design: HOUSE }))).toMatch(/version/u)
    expect(error(file({ version: 2 }))).toMatch(/newer/u)
    expect(error(file({ version: '1' }))).toMatch(/version`? is "1", not 1/u)
    expect(error(file({ design: { ...HOUSE, marginInnr: '1.125' } }))).toMatch(/marginInnr/u)
    // A look banked in one browser cannot be named from the shelf.
    expect(error(file({ design: { ...HOUSE, profile: 'sp-1' } }))).toMatch(/profile/u)
    expect(error(file({ design: { ...HOUSE, trimSize: ['7x10'] } }))).toMatch(/trimSize/u)
    expect(error(file({ design: {} }))).toMatch(/sets nothing/u)
    expect(error(file({ shortBook: { underPages: 'few' } }))).toMatch(/underPages/u)
  })
})

describe('a book’s own answers always win', () => {
  it('a book with any design answer of its own keeps its own, whole', () => {
    const own = { trimSize: '6x9', bodyFontSize: '12' }
    expect(inheritDesign(own, look())).toEqual({ from: 'book', design: own })
  })

  it('a book with none inherits the house look', () => {
    expect(inheritDesign(undefined, look())).toEqual({ from: 'house', design: HOUSE })
    expect(inheritDesign({}, look())).toEqual({ from: 'house', design: HOUSE })
    // An empty "save as", or the choice of a fresh look, is not a design.
    expect(hasOwnDesign({ saveAs: '' })).toBe(false)
    expect(hasOwnDesign({ profile: 'fresh', saveAs: 'Mine' })).toBe(false)
    expect(inheritDesign({ saveAs: '' }, look()).from).toBe('house')
    expect(inheritDesign({ profile: 'fresh' }, look()).from).toBe('house')
    // Inherited answers written into the book are its own from then on.
    expect(hasOwnDesign({ ...HOUSE, profile: 'fresh' })).toBe(true)
  })

  it('with no house look, the defaults, said as such', () => {
    expect(inheritDesign(undefined, null)).toEqual({ from: 'defaults', design: {} })
  })
})

describe('trim by length', () => {
  it('a book under 100 pages at 7x10 is set 6x9', () => {
    expect(trimForLength(99)).toBe('6x9')
    expect(trimForLength(1)).toBe('6x9')
    expect(trimForLength(100)).toBe('7x10')
    expect(trimForLength(180)).toBe('7x10')
    expect(isShortBook(99)).toBe(true)
    expect(isShortBook(100)).toBe(false)
  })

  it('takes the threshold and the trims as parameters', () => {
    expect(trimForLength(120, { underPages: 150 })).toBe('6x9')
    expect(trimForLength(120, { underPages: 150, short: '5x8', long: '6x9' })).toBe('5x8')
    expect(isShortBook(120, 150)).toBe(true)
  })

  it('the house look’s answers for a short book differ only in the trim', () => {
    const short = houseDesignFor(look(), 84)
    expect(short.short).toBe(true)
    expect(short.design).toEqual({ ...HOUSE, trimSize: '6x9' })
    const long = houseDesignFor(look(), 180)
    expect(long).toEqual({ design: HOUSE, short: false })
    // A house look with no short-book rule sets every book alike.
    expect(houseDesignFor(look(file({ shortBook: null })), 10).short).toBe(false)
  })

  it('says which trim it chose, and why, in one line', () => {
    const line = (pages: number) =>
      houseLookLine({
        look: look(),
        path: HOUSE_LOOK_PATH,
        pagesOnHouseTrim: pages,
        short: pages < 100
      })
    expect(line(180)).toBe(
      'the house look from the shelf (imprint/house-look.json): 7x10, 180 pages'
    )
    expect(line(84)).toBe(
      'the house look from the shelf (imprint/house-look.json): 6x9, a short book (84 pages on 7x10, under 100)'
    )
  })
})

describe('the house look’s page', () => {
  it('builds the agreed look, with side margins half as wide again', () => {
    const style = styleOf(HOUSE)
    expect(style.trimSize).toBe('7x10')
    expect(style.bodyFont).toBe('Libre Caslon Text')
    expect(style.bodyFontSize).toBe(11)
    expect(style.ornaments.chapterOpener).toBe('chapter-vine')
    expect(findOrnament('chapter-vine')?.kind).toBe('chapter')
    expect(style.ornaments.blankPage).toBe('chapter-asterism')
    expect(style.folioMirrorsHead).toBe(false)
    expect(style.runningHeadRise).toBe(1.2)
    expect(style.folioFromFootPt).toBe(24.8)
    expect(style.avoidShortLastLines).toBe(true)
    // The engine's 7x10 nonfiction margins are 0.75 in and 0.5 in, gutter 0.13.
    const was = styleOf(
      Object.fromEntries(
        Object.entries(HOUSE).filter(([id]) => id !== 'marginInner' && id !== 'marginOuter')
      )
    )
    expect(was.margins).toEqual({ inner: 0.75, outer: 0.5, top: 0.75, bottom: 0.75 })
    expect(style.margins).toEqual({ inner: 1.125, outer: 0.75, top: 0.75, bottom: 0.75 })
    expect(style.margins.inner).toBeCloseTo(was.margins.inner * 1.5, 9)
    expect(style.margins.outer).toBeCloseTo(was.margins.outer * 1.5, 9)
    expect(style.gutter).toBe(was.gutter)
    // On the page: the gutter joins the inner margin, on the spine side.
    expect(frameFor(style, 'recto').xPt).toBeCloseTo((1.125 + 0.13) * 72, 6)
    expect(frameFor(style, 'verso').xPt).toBeCloseTo(0.75 * 72, 6)
    expect(frameFor(style, 'recto').widthPt).toBeCloseTo((7 - 1.255 - 0.75) * 72, 6)
  })

  it('a short book is 6x9 with the same house details and the same wider margins', () => {
    const style = styleOf(houseDesignFor(look(), 60).design)
    const long = styleOf(HOUSE)
    expect(style.trimSize).toBe('6x9')
    // The 6x9 defaults are 0.75 in and 0.5 in too, so half as wide again is the same.
    expect(style.margins).toEqual(long.margins)
    expect({ ...style, trimSize: '7x10' }).toEqual(long)
    expect(frameFor(style, 'recto').widthPt).toBeCloseTo((6 - 1.255 - 0.75) * 72, 6)
  })

  it('meets KDP’s inside-margin minimum at every page count KDP prints, on both trims', () => {
    for (const design of [HOUSE, houseDesignFor(look(), 60).design]) {
      const profile = styleOf(design)
      for (const pageCount of [24, 150, 151, 300, 301, 500, 501, 700, 701, 828]) {
        const gutter = validateKdp({ profile, pageCount, warnings: [] }).checks.find(
          (c) => c.id === 'gutter'
        )
        expect(gutter?.level, `${profile.trimSize} ${pageCount}`).toBe('ok')
      }
      // KDP's outside, top and bottom minimum, 0.25 in without bleed.
      expect(
        Math.min(profile.margins.outer, profile.margins.top, profile.margins.bottom)
      ).toBeGreaterThanOrEqual(0.25)
    }
  })

  it('every value it uses is one the gate’s controls offer', () => {
    const style = styleOf(HOUSE)
    // The faces the app offers, as the app hands them over.
    const families = BODY_FONTS.map((f) => ({ value: f.family, label: f.label }))
    for (const q of styleQuestions(style, { families })) {
      if (q.type !== 'choice' || HOUSE[q.id] === undefined) continue
      expect(
        q.options.map((o) => o.value),
        q.id
      ).toContain(String(HOUSE[q.id]))
    }
  })

  it('is settings, not new defaults: a book set before keeps its look', () => {
    // A published book's answers, which name none of the new settings.
    const published = { ...HOUSE }
    for (const id of NEW_IDS) delete published[id]
    const style = styleOf(published)
    expect(style.margins).toEqual({ inner: 0.75, outer: 0.5, top: 0.75, bottom: 0.75 })
    expect(style.folioMirrorsHead).toBe(false)
    expect(style.runningHeadRise).toBe(2)
    expect(style.folioFromFootPt).toBe(0)
    expect(style.avoidShortLastLines).toBe(false)
  })
})

describe('the house look lowers its head and keeps its page number', () => {
  // Libre Caslon Text's own metrics, read the way the app's font table reads
  // them (`fonts.ts`), so the distances are the printed ones.
  const caslon = fontkit.create(
    readFileSync(
      'node_modules/@expo-google-fonts/libre-caslon-text/400Regular/LibreCaslonText_400Regular.ttf'
    )
  )
  const real: TextMeasurer = {
    ...fixedWidthMeasurer(0.5),
    metrics: (_font, sizePt) => {
      const scale = sizePt / caslon.unitsPerEm
      return {
        ascent: caslon.ascent * scale,
        descent: Math.abs(caslon.descent) * scale,
        lineGap: caslon.lineGap * scale,
        capHeight: caslon.capHeight * scale
      }
    },
    hasSmallCaps: () => caslon.availableFeatures.includes('smcp')
  }
  const now = styleOf(HOUSE)
  const before = styleOf(HOUSE_BEFORE)

  it('sets the head 1.2 body sizes over the text, 8.8 pt lower than before', () => {
    expect(frameFor(now, 'recto').yPt - runningHeadBaseline(now)).toBeCloseTo(1.2 * 11, 6)
    expect(frameFor(before, 'recto').yPt - runningHeadBaseline(before)).toBeCloseTo(2 * 11, 6)
    expect(headCapTop(now, real) - headCapTop(before, real)).toBeCloseTo(8.8, 6)
    // The capitals start about 0.47 in below the top edge, 0.34 in before.
    expect(headCapTop(now, real) / 72).toBeCloseTo(0.467, 3)
    expect(headCapTop(before, real) / 72).toBeCloseTo(0.344, 3)
  })

  it('keeps the page number where it was, within 0.1 pt, on both trims', () => {
    for (const trimSize of ['7x10', '6x9']) {
      const n = { ...now, trimSize }
      const b = { ...before, trimSize }
      expect(folioPlace(b, real), trimSize).toMatchObject({ rule: 'mirrorsHead', honoured: true })
      expect(folioPlace(n, real), trimSize).toMatchObject({ rule: 'fromFoot', honoured: true })
      expect(Math.abs(folioBaseline(n, real) - folioBaseline(b, real)), trimSize).toBeLessThan(0.1)
    }
  })
})
