import { describe, it, expect } from 'vitest'
import { NO_ORNAMENT, applyStyleAnswers, defaultStyleProfile, styleQuestions } from '@core/style'
import { profileFromAnswers } from '@core/design'
import type { StyleProfile } from '@core/model'
import type { Answers } from '@core/wizard'

/**
 * The detailed controls the interview always promised — `design-interview.ts`
 * has said since it was written that they "stay available behind *anything
 * you'd change?* but are never the front door". The front door shipped; this
 * is the rest of it, and these are the properties it has to hold.
 */
const ids = (p: StyleProfile): string[] => styleQuestions(p).map((q) => q.id)

describe('every field of a profile is reachable', () => {
  /**
   * The point of the whole module. Five fields were reachable from *nothing* —
   * the gutter, the folio position, the page-number ornament, and the three
   * front-matter leaves — so they sat at their shipped values for every book
   * ever made. This fails if any of them stops being editable.
   */
  it('covers the fields no question in the interview ever set', () => {
    const editable = ids(defaultStyleProfile())
    for (const id of [
      'gutter',
      'pageNumber',
      'ornamentPage',
      'frontHalfTitle',
      'frontTitlePage',
      'frontCopyrightPage',
      'headingCentered'
    ]) {
      expect(editable, id).toContain(id)
    }
  })

  it('opens showing what is currently set, not a blank form', () => {
    const profile: StyleProfile = {
      ...defaultStyleProfile(),
      trimSize: '7x10',
      gutter: 0.25,
      bodyFontSize: 12.5,
      dropCap: true
    }
    const q = (id: string) => styleQuestions(profile).find((x) => x.id === id)!
    expect((q('trimSize') as { defaultValue: string }).defaultValue).toBe('7x10')
    expect((q('gutter') as { defaultValue: string }).defaultValue).toBe('0.25')
    expect((q('bodyFontSize') as { defaultValue: string }).defaultValue).toBe('12.5')
    expect((q('dropCap') as { defaultValue: boolean }).defaultValue).toBe(true)
  })
})

describe('answers fold back onto the profile', () => {
  const base = defaultStyleProfile()

  it('changes only what was answered', () => {
    // The form hands over the fields the user touched, not all twenty-two. A
    // partial answer set must be a partial edit rather than a reset.
    const next = applyStyleAnswers(base, { gutter: '0.25' })
    expect(next.gutter).toBe(0.25)
    expect(next.trimSize).toBe(base.trimSize)
    expect(next.bodyFont).toBe(base.bodyFont)
    expect(next.frontMatter).toEqual(base.frontMatter)
  })

  it('round-trips: what the questions offer is what applying them gives back', () => {
    const profile: StyleProfile = {
      ...base,
      trimSize: '5.5x8.5',
      gutter: 0.19,
      bodyFontSize: 10.5,
      margins: { inner: 0.85, outer: 0.6, top: 0.5, bottom: 0.75 },
      dropCap: true,
      pageNumber: 'topOuter',
      headingStyle: { smallCaps: false, centered: false, scale: 1.8 },
      runningHeads: { verso: 'chapterTitle', recto: 'author' },
      frontMatter: { titlePage: false, copyrightPage: true, halfTitle: true }
    }
    // Answer every question with its own default — the identity edit.
    const answers: Answers = {}
    for (const q of styleQuestions(profile)) {
      if (q.type === 'term-grid' || q.type === 'page-edit' || q.type === 'discrepancies') continue
      answers[q.id] = q.defaultValue
    }
    expect(applyStyleAnswers(profile, answers)).toEqual(profile)
  })

  it('reads "none" back as no ornament', () => {
    // A choice cannot answer null, so the absence of an ornament travels as a
    // sentinel and has to come back as null or the layout engine draws one.
    const withOrnament: StyleProfile = {
      ...base,
      ornaments: {
        chapterOpener: 'chapter-flourish',
        sectionDivider: null,
        pageNumber: null,
        blankPage: null
      }
    }
    const next = applyStyleAnswers(withOrnament, { ornamentChapter: NO_ORNAMENT })
    expect(next.ornaments.chapterOpener).toBeNull()
  })

  it('ignores a nonsense number rather than writing NaN into the layout', () => {
    const next = applyStyleAnswers(base, { gutter: 'wide' })
    expect(next.gutter).toBe(base.gutter)
  })
})

describe('the edited default is what a new book starts from', () => {
  /**
   * Editing the shipped look is only worth anything if the interview builds on
   * top of it. The five questions set the trim, the faces and the ornaments;
   * everything they do not set — the gutter above all — has to come through.
   */
  it('carries fields the interview never sets through to the finished style', () => {
    const edited: StyleProfile = {
      ...defaultStyleProfile(),
      gutter: 0.32,
      pageNumber: 'topOuter',
      frontMatter: { titlePage: true, copyrightPage: true, halfTitle: true }
    }
    const built = profileFromAnswers(
      { kind: 'novel', period: 'victorian', chapterOpener: 'plain', runningHeads: 'none' },
      undefined,
      edited
    )
    expect(built.gutter).toBe(0.32)
    expect(built.pageNumber).toBe('topOuter')
    expect(built.frontMatter.halfTitle).toBe(true)
  })

  it('still lets the interview decide what the interview is about', () => {
    // The starting point must not override the answers — a book asked to be
    // poetry gets poetry's measure whatever the default trim was.
    const edited: StyleProfile = { ...defaultStyleProfile(), trimSize: '8.5x11', gutter: 0.32 }
    const built = profileFromAnswers(
      { kind: 'poetry', period: 'modern', chapterOpener: 'plain', runningHeads: 'none' },
      undefined,
      edited
    )
    expect(built.trimSize).toBe('5.5x8.5')
    expect(built.gutter).toBe(0.32)
  })
})

describe('the granular knobs, which were constants in the paginator', () => {
  /**
   * Three of the most ordinary things anyone would want to change were not
   * settings at all: the paragraph indent was `const INDENT_EMS = 1.2`,
   * hyphenation was on whenever a hyphenator was supplied, and every chapter
   * opened on a right-hand page whether or not the book could spare the paper.
   */
  it('offers all three', () => {
    const editable = ids(defaultStyleProfile())
    for (const id of [
      'paragraphIndentEms',
      'paragraphSpacingEms',
      'hyphenate',
      'chaptersOpenRecto'
    ]) {
      expect(editable, id).toContain(id)
    }
  })

  it('lets the indent be set to none, which is a real choice and not a missing answer', () => {
    const next = applyStyleAnswers(defaultStyleProfile(), {
      paragraphIndentEms: '0',
      paragraphSpacingEms: '0.6'
    })
    expect(next.paragraphIndentEms).toBe(0)
    expect(next.paragraphSpacingEms).toBe(0.6)
  })
})

describe('per-book tweaks sit on top of the look, not inside it', () => {
  /**
   * The same rule as the proof step's corrections: the thing being edited is
   * left alone and the edits are a layer over it. So a banked look reused on
   * three books stays what it was, and dropping a tweak needs nothing rebuilt.
   */
  it('changes the book without changing the look it came from', async () => {
    const { appliedLook, initialState } = await import('@core/wizard')
    const { newSavedProfile } = await import('@core/style')
    const banked = newSavedProfile({
      name: 'Blackthorn',
      style: { ...defaultStyleProfile(), gutter: 0.13 }
    })
    const state = { ...initialState(), styleProfiles: [banked] }

    const look = appliedLook(state, { profile: banked.id, gutter: '0.25', hyphenate: false })
    expect(look.style.gutter).toBe(0.25)
    expect(look.style.hyphenate).toBe(false)
    // The banked record itself is untouched — that is the whole point.
    expect(banked.style.gutter).toBe(0.13)
    expect(banked.style.hyphenate).toBe(true)
  })

  /**
   * The reason the tweaks live in the design step's answers rather than in a
   * field of their own: answers are what gets written to the review progress
   * and to the book file. A tweak in a separate field survived neither, so a
   * look adjusted at the gate came back plain after a refresh and came back
   * plain on the next device.
   */
  it('takes a tweak from the same answers as the five questions', async () => {
    const { appliedLook, initialState } = await import('@core/wizard')
    const look = appliedLook(initialState(), {
      kind: 'nonfiction',
      period: 'victorian',
      chapterOpener: 'ornamented',
      runningHeads: 'chapter',
      // Not one of the five, and not implied by any of them.
      dropCap: true,
      bodyFontSize: '10.5'
    })
    expect(look.style.ornaments.chapterOpener).not.toBeNull()
    expect(look.style.dropCap).toBe(true)
    expect(look.style.bodyFontSize).toBe(10.5)
  })

  it('drops back to the look when the tweaks are cleared', async () => {
    const { appliedLook, initialState } = await import('@core/wizard')
    const { newSavedProfile } = await import('@core/style')
    const banked = newSavedProfile({ name: 'B', style: { ...defaultStyleProfile(), gutter: 0.13 } })
    const state = { ...initialState(), styleProfiles: [banked] }
    expect(appliedLook(state, { profile: banked.id }).style.gutter).toBe(0.13)
  })
})
