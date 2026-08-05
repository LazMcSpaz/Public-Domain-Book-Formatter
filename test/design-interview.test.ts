import { describe, it, expect } from 'vitest'
import {
  profileFromAnswers,
  describeProfile,
  fontForPeriod,
  fontById,
  trimForKind,
  BODY_FONTS,
  type DesignAnswers
} from '@core/design'
import { BUILTIN_ORNAMENTS, findOrnament } from '@core/ornament'
import { normalizeStyleProfile } from '@core/style'
import { parseTrimSize } from '@core/typeset'

const base: DesignAnswers = {
  kind: 'novel',
  period: 'early-modern',
  chapterOpener: 'plain',
  runningHeads: 'author-title'
}

const answers = (patch: Partial<DesignAnswers> = {}): DesignAnswers => ({ ...base, ...patch })

describe('font catalogue', () => {
  it('has no duplicate ids', () => {
    const ids = BODY_FONTS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('falls back to a real font for an unknown id rather than throwing', () => {
    const font = fontById('no-such-font')
    expect(BODY_FONTS).toContain(font)
  })

  it('suggests a period-appropriate face for each period', () => {
    expect(fontForPeriod('early-modern').id).toBe('im-fell')
    expect(fontForPeriod('georgian').id).toBe('libre-caslon')
    expect(fontForPeriod('victorian').id).toBe('libre-baskerville')
    expect(fontForPeriod('modern').id).toBe('crimson')
  })
})

describe('trim sizes', () => {
  it('gives verse a narrower measure so lines do not wrap', () => {
    expect(trimForKind('poetry')).toBe('5.5x8.5')
  })

  it('gives picture-heavy and reference books a larger page', () => {
    expect(trimForKind('illustrated')).toBe('7x10')
    expect(trimForKind('reference')).toBe('7x10')
  })

  it('defaults prose to the 6x9 standard', () => {
    expect(trimForKind('novel')).toBe('6x9')
    expect(trimForKind('nonfiction')).toBe('6x9')
  })

  it('produces trims the typesetter can actually parse', () => {
    for (const kind of ['novel', 'nonfiction', 'poetry', 'illustrated', 'reference'] as const) {
      const parsed = parseTrimSize(trimForKind(kind))
      expect(parsed.widthIn).toBeGreaterThan(0)
      expect(parsed.heightIn).toBeGreaterThan(parsed.widthIn)
    }
  })
})

describe('profileFromAnswers', () => {
  it('produces a complete profile from five answers', () => {
    const profile = profileFromAnswers(answers())
    // Round-tripping through the normalizer is the test that nothing is missing:
    // any field left undefined would be silently replaced by a default here.
    expect(normalizeStyleProfile(profile)).toEqual(profile)
  })

  it('uses the period’s typeface when no font is chosen explicitly', () => {
    expect(profileFromAnswers(answers({ period: 'victorian' })).bodyFont).toBe('Libre Baskerville')
  })

  it('lets an explicit font override the period suggestion', () => {
    const profile = profileFromAnswers(answers({ period: 'victorian' }), 'junicode')
    expect(profile.bodyFont).toBe('Junicode')
  })

  it('sets headings in the same family as the body', () => {
    const profile = profileFromAnswers(answers(), 'cardo')
    expect(profile.headingFont).toBe(profile.bodyFont)
  })

  it('derives the trim from the book kind', () => {
    expect(profileFromAnswers(answers({ kind: 'poetry' })).trimSize).toBe('5.5x8.5')
  })

  it('honours an explicit trim override', () => {
    expect(profileFromAnswers(answers({ kind: 'poetry', trimSize: '6x9' })).trimSize).toBe('6x9')
  })

  it('makes the inner margin wider than the outer, for the binding gutter', () => {
    for (const kind of ['novel', 'illustrated'] as const) {
      const m = profileFromAnswers(answers({ kind })).margins
      expect(m.inner).toBeGreaterThan(m.outer)
    }
  })

  it('gives reference books a smaller body size and illustrated books more margin', () => {
    expect(profileFromAnswers(answers({ kind: 'reference' })).bodyFontSize).toBeLessThan(
      profileFromAnswers(answers({ kind: 'novel' })).bodyFontSize
    )
    expect(profileFromAnswers(answers({ kind: 'illustrated' })).margins.inner).toBeGreaterThan(
      profileFromAnswers(answers({ kind: 'novel' })).margins.inner
    )
  })

  it('uses small caps for headings in period books but not modern ones', () => {
    expect(profileFromAnswers(answers({ period: 'georgian' })).headingStyle.smallCaps).toBe(true)
    expect(profileFromAnswers(answers({ period: 'modern' })).headingStyle.smallCaps).toBe(false)
  })
})

describe('profileFromAnswers — running heads', () => {
  it('puts the author on the left page and the title on the right', () => {
    expect(profileFromAnswers(answers({ runningHeads: 'author-title' })).runningHeads).toEqual({
      verso: 'author',
      recto: 'bookTitle'
    })
  })

  it('puts the current chapter on the right when asked', () => {
    expect(profileFromAnswers(answers({ runningHeads: 'chapter' })).runningHeads).toEqual({
      verso: 'bookTitle',
      recto: 'chapterTitle'
    })
  })

  it('clears both sides when the user wants none', () => {
    expect(profileFromAnswers(answers({ runningHeads: 'none' })).runningHeads).toEqual({
      verso: 'none',
      recto: 'none'
    })
  })
})

describe('profileFromAnswers — chapter openers', () => {
  it('leaves a plain opener with no ornament and no drop cap', () => {
    const profile = profileFromAnswers(answers({ chapterOpener: 'plain' }))
    expect(profile.ornaments.chapterOpener).toBeNull()
    expect(profile.dropCap).toBe(false)
  })

  it('selects a real ornament from the shipped library', () => {
    const profile = profileFromAnswers(answers({ chapterOpener: 'ornamented' }))
    expect(profile.ornaments.chapterOpener).not.toBeNull()
    expect(findOrnament(profile.ornaments.chapterOpener!, BUILTIN_ORNAMENTS)?.kind).toBe('chapter')
  })

  it('turns on the drop cap without also adding an ornament', () => {
    const profile = profileFromAnswers(answers({ chapterOpener: 'drop-cap' }))
    expect(profile.dropCap).toBe(true)
    expect(profile.ornaments.chapterOpener).toBeNull()
  })

  it('gives period books a real section divider and modern books the plain fallback', () => {
    const period = profileFromAnswers(answers({ period: 'georgian' }))
    expect(findOrnament(period.ornaments.sectionDivider!, BUILTIN_ORNAMENTS)?.kind).toBe('divider')
    expect(profileFromAnswers(answers({ period: 'modern' })).ornaments.sectionDivider).toBeNull()
  })
})

describe('describeProfile', () => {
  it('summarises the choices in one readable line', () => {
    const text = describeProfile(profileFromAnswers(answers({ kind: 'poetry' })))
    expect(text).toContain('5.5x8.5in')
    expect(text).toContain('IM FELL English')
    expect(text).toContain('running heads')
  })

  it('says so plainly when there are no running heads', () => {
    const text = describeProfile(profileFromAnswers(answers({ runningHeads: 'none' })))
    expect(text).toContain('no running heads')
  })
})

describe('describeProfile — chapter openers', () => {
  it('names the chapter opening the answers produced', () => {
    expect(describeProfile(profileFromAnswers(answers({ chapterOpener: 'plain' })))).toContain(
      'plain chapter openings'
    )
    expect(describeProfile(profileFromAnswers(answers({ chapterOpener: 'ornamented' })))).toContain(
      'ornamented chapter openings'
    )
    expect(describeProfile(profileFromAnswers(answers({ chapterOpener: 'drop-cap' })))).toContain(
      'drop capitals'
    )
  })
})
