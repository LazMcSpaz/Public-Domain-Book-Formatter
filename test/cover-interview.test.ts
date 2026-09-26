/**
 * The cover interview.
 *
 * Asserts the app's own rules against the real question set: never ask what
 * isn't relevant yet, never ask what the app already knows, and never let an
 * answer that can spend money be given by accident.
 */
import { describe, expect, it } from 'vitest'
import { defaultAnswers, groupQuestions, missingRequired } from '@core/wizard'
import type { ChoiceQuestion, Question } from '@core/wizard'
import {
  artQuestions,
  coverFromAnswers,
  coverFromInterior,
  coverQuestions,
  defaultCover,
  lookQuestions,
  newSavedCoverLook,
  defaultLook,
  MIN_PAGES_FOR_SPINE_TEXT,
  type CoverInterviewState
} from '@core/cover'

/** Narrow to a choice, so a question that changed kind fails loudly here. */
function choice(questions: readonly Question[], id: string): ChoiceQuestion {
  const found = questions.find((q) => q.id === id)
  if (!found || found.type !== 'choice') throw new Error(`${id} is not a choice question`)
  return found
}

function state(patch: Partial<CoverInterviewState> = {}): CoverInterviewState {
  return {
    doc: defaultCover('6x9', 284),
    pageCountMeasured: true,
    bankedLooks: [],
    plates: [],
    hasReplicateToken: false,
    replicateAvailable: null,
    ...patch
  }
}

describe('the sheet', () => {
  it('confirms a measured page count rather than asking for one', () => {
    const measured = coverQuestions(state()).find((q) => q.id === 'cover-pages')!
    expect(measured.prompt).toMatch(/came to this many pages/)
    expect(measured.help).toMatch(/Measured by the layout engine/)

    const typed = coverQuestions(state({ pageCountMeasured: false })).find(
      (q) => q.id === 'cover-pages'
    )!
    expect(typed.prompt).toMatch(/How many pages/)
    expect(typed.help).toMatch(/proof arrives/)
  })

  it('shows the sheet it is about to build as evidence', () => {
    const trim = coverQuestions(state()).find((q) => q.id === 'cover-trim')!
    expect(trim.evidence?.[0]).toMatchObject({ kind: 'text' })
    expect((trim.evidence![0] as { text: string }).text).toMatch(/spine/)
  })
})

describe('never ask what is not relevant yet', () => {
  it('withdraws the spine question below KDP’s floor', () => {
    const thin = state()
    thin.doc.pageCount = MIN_PAGES_FOR_SPINE_TEXT - 1
    expect(lookQuestions(thin).some((q) => q.id === 'cover-spine-text')).toBe(false)

    const thick = state()
    thick.doc.pageCount = MIN_PAGES_FOR_SPINE_TEXT
    expect(lookQuestions(thick).some((q) => q.id === 'cover-spine-text')).toBe(true)
  })

  it('asks nothing about art when the arrangement has no picture in it', () => {
    const typographic = state()
    typographic.doc.look.arrangement = 'typographic'
    expect(artQuestions(typographic)).toHaveLength(0)
  })

  it('offers the book’s own plates only when there are some', () => {
    expect(artQuestions(state()).find((q) => q.id === 'cover-plate')).toBeUndefined()
    const withPlates = state({
      plates: [
        {
          id: 'p1',
          pageIndex: 12,
          caption: 'The apiary',
          previewUrl: 'blob:x',
          widthPx: 1800,
          heightPx: 2400
        }
      ]
    })
    const q = choice(artQuestions(withPlates), 'cover-plate')
    expect(q.options[0]!.evidence?.[0]).toMatchObject({ kind: 'image' })
    // And the plate is the recommendation when the book has one.
    expect(choice(artQuestions(withPlates), 'cover-art-source').defaultValue).toBe('plate')
  })

  it('withdraws generation when the browser cannot reach Replicate', () => {
    const unreachable = state({ replicateAvailable: false })
    const source = choice(artQuestions(unreachable), 'cover-art-source')
    expect(source.options.map((o) => o.value)).not.toContain('generated')
    // Optimistic until told otherwise, so the door does not flicker into view.
    const unknown = artQuestions(state({ replicateAvailable: null }))
    expect(choice(unknown, 'cover-art-source').options.map((o) => o.value)).toContain('generated')
  })
})

describe('collections', () => {
  it('offers a banked look first when there is one', () => {
    const banked = newSavedCoverLook({ name: 'Blackthorn plain', look: defaultLook() })
    const q = choice(lookQuestions(state({ bankedLooks: [banked] })), 'cover-banked')
    expect(q.defaultValue).toBe(banked.id)
    expect(q.options.at(-1)!.value).toBe('')
  })

  it('does not ask at all on the first book', () => {
    expect(lookQuestions(state()).some((q) => q.id === 'cover-banked')).toBe(false)
  })
})

describe('answers fold back into the cover', () => {
  it('leaves everything unanswered exactly as it was', () => {
    const base = defaultCover('6x9', 284)
    base.content.title = 'Bee Keeping'
    const next = coverFromAnswers(base, { 'cover-accent': '#123456' })
    expect(next.content.title).toBe('Bee Keeping')
    expect(next.look.palette.accent).toBe('#123456')
    expect(next.look.palette.ground).toBe(base.look.palette.ground)
  })

  it('does not mutate the cover it was given', () => {
    const base = defaultCover('6x9', 284)
    coverFromAnswers(base, { 'cover-title': 'Changed', 'cover-ground': '#000000' })
    expect(base.content.title).toBe('')
    expect(base.look.palette.ground).not.toBe('#000000')
  })

  it('refuses a colour that is not one, rather than printing it', () => {
    const next = coverFromAnswers(defaultCover(), { 'cover-ink': 'burnt umber' })
    expect(next.look.palette.ink).toBe(defaultLook().palette.ink)
  })

  it('reads the page count as a number and ignores nonsense', () => {
    expect(coverFromAnswers(defaultCover('6x9', 100), { 'cover-pages': '284' }).pageCount).toBe(284)
    expect(coverFromAnswers(defaultCover('6x9', 100), { 'cover-pages': 'lots' }).pageCount).toBe(
      100
    )
  })

  it('round-trips its own defaults unchanged', () => {
    const s = state()
    const answered = coverFromAnswers(s.doc, defaultAnswers(coverQuestions(s)))
    expect(answered.look).toEqual(s.doc.look)
    expect(answered.paper).toBe(s.doc.paper)
    expect(answered.pageCount).toBe(s.doc.pageCount)
  })
})

describe('the gate is workable one decision at a time', () => {
  it('groups into screens rather than one wall', () => {
    const groups = groupQuestions(coverQuestions(state()))
    expect(groups.length).toBeGreaterThan(3)
    for (const g of groups) expect(g.questions.length).toBeGreaterThan(0)
  })

  it('will not let the sheet be left blank', () => {
    const questions = coverQuestions(state())
    const missing = missingRequired(questions, { 'cover-trim': '', 'cover-pages': '' })
    expect(missing).toContain('cover-trim')
    expect(missing).toContain('cover-pages')
  })
})

describe('coverFromInterior', () => {
  it('arrives knowing everything the book already told the app', () => {
    const doc = coverFromInterior({
      trimSize: '5.5x8.5',
      pageCount: 312,
      title: 'A Treatise on Bee Keeping',
      author: 'Amos Root',
      imprint: 'Blackthorn Press'
    })
    expect(doc.trimSize).toBe('5.5x8.5')
    expect(doc.pageCount).toBe(312)
    expect(doc.content.title).toBe('A Treatise on Bee Keeping')
    expect(doc.look.spineText).toBe(true)
  })

  it('does not promise spine text on a pamphlet', () => {
    const doc = coverFromInterior({
      trimSize: '5x8',
      pageCount: 48,
      title: 'A Short Account',
      author: '',
      imprint: ''
    })
    expect(doc.look.spineText).toBe(false)
  })
})

describe('the picture questions follow the door taken', () => {
  const plates = [
    {
      id: 'p1',
      pageIndex: 12,
      caption: 'The apiary',
      previewUrl: 'blob:x',
      widthPx: 1800,
      heightPx: 2400
    }
  ]

  it('asks nothing about a model or a brief when the picture is being uploaded', () => {
    const ids = artQuestions(state({ artSource: 'upload' })).map((q) => q.id)
    expect(ids).toContain('cover-art-source')
    expect(ids).not.toContain('cover-art-brief')
    expect(ids).not.toContain('cover-art-model')
  })

  it('asks which plate only when a plate is being used', () => {
    expect(artQuestions(state({ plates, artSource: 'plate' })).map((q) => q.id)).toContain(
      'cover-plate'
    )
    expect(artQuestions(state({ plates, artSource: 'generated' })).map((q) => q.id)).not.toContain(
      'cover-plate'
    )
  })

  it('asks the brief only when one is being made', () => {
    const ids = artQuestions(state({ artSource: 'generated' })).map((q) => q.id)
    expect(ids).toContain('cover-art-brief')
    expect(ids).toContain('cover-art-model')
  })

  it('asks nothing further when there is to be no picture', () => {
    const ids = artQuestions(state({ artSource: 'none' })).map((q) => q.id)
    expect(ids).toEqual(['cover-art-source'])
  })
})

describe('an unanswered page count is not a failing cover', () => {
  it('is reported as pending rather than out of range', () => {
    // Opening the studio to a red failure for not having typed anything yet
    // teaches people to ignore the colour.
    const fresh = defaultCover('6x9', 0)
    expect(fresh.pageCount).toBe(0)
  })
})
