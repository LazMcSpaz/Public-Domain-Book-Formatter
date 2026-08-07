import { describe, it, expect } from 'vitest'
import {
  BANKED_STYLE_KEYS,
  defaultStyleProfile,
  describeSavedProfile,
  emptyImprint,
  migrateSavedProfile,
  newSavedProfile,
  type SavedStyleProfile
} from '@core/style'
import { FRESH_LOOK, appliedLook, initialState, stepById, type WizardState } from '@core/wizard'
import { profileFromAnswers, type DesignAnswers } from '@core/design'
import type { Question } from '@core/wizard'

const ANSWERS: DesignAnswers = {
  kind: 'novel',
  period: 'early-modern',
  chapterOpener: 'drop-cap',
  runningHeads: 'author-title'
}

function bank(name: string, over: Partial<SavedStyleProfile> = {}): SavedStyleProfile {
  return {
    ...newSavedProfile({
      name,
      style: { ...profileFromAnswers(ANSWERS), trimSize: '5.5x8.5', bodyFontSize: 12.5 },
      imprint: { imprint: 'Blackthorn Press', copyrightHolder: 'A. Editor' },
      now: new Date('2026-01-01T00:00:00.000Z')
    }),
    ...over
  }
}

/** A state that has reached the design gate, with `profiles` already banked. */
function atDesign(profiles: SavedStyleProfile[]): WizardState {
  return {
    ...initialState(),
    styleProfiles: profiles,
    completed: [
      'intake',
      'recon',
      'gate-identity',
      'transcribe',
      'gate-uncertainties',
      'gate-structure',
      'proof'
    ]
  }
}

const ids = (qs: Question[]): string[] => qs.map((q) => q.id)

describe('the two-level separation — what may be banked', () => {
  /**
   * The guard the whole module rests on. `StyleProfile` is the reusable half of
   * SPEC §7, so every one of its fields has to be a fact about the *look*. This
   * fails the moment somebody adds a field without deciding which level it
   * belongs to — which is exactly the accident that would print book one's
   * title on book two.
   */
  it('accounts for every field a StyleProfile carries', () => {
    expect(Object.keys(defaultStyleProfile()).sort()).toEqual([...BANKED_STYLE_KEYS].sort())
  })

  it('carries nothing of the first book onto the second', () => {
    // Banked from a session that has book one's facts sitting in state — which
    // is the only way this could ever go wrong. Nothing the user typed about
    // *that* book may end up in the record the next book reads.
    const bookOne: WizardState = {
      ...atDesign([]),
      metadata: { ...initialState().metadata, title: 'Hydriotaphia', author: 'T. Browne' },
      answers: {
        design: { kind: 'novel', period: 'early-modern', font: 'im-fell' },
        export: {
          title: 'Hydriotaphia',
          author: 'T. Browne',
          isbn: '978-1-0000000-0-0',
          originalYear: '1658',
          editionStatement: 'First modern edition.',
          imprint: 'Blackthorn Press'
        }
      }
    }
    const banked = newSavedProfile({
      name: 'Blackthorn',
      style: appliedLook(bookOne, bookOne.answers['design']).style,
      imprint: { imprint: 'Blackthorn Press' }
    })

    const flat = JSON.stringify(banked)
    for (const bookFact of ['Hydriotaphia', 'T. Browne', '978-', '1658', 'First modern edition']) {
      expect(flat).not.toContain(bookFact)
    }
    // The imprint is the deliberate exception — a fact about the publisher.
    expect(flat).toContain('Blackthorn Press')
  })
})

describe('banking and reading back a look', () => {
  it('names an unnamed look rather than saving an empty one', () => {
    expect(newSavedProfile({ name: '   ', style: defaultStyleProfile() }).name).toBe(
      'Untitled look'
    )
  })

  it('keeps the id when told to overwrite, so a top-up is not a second profile', () => {
    const first = bank('Blackthorn')
    const second = newSavedProfile({
      id: first.id,
      name: first.name,
      style: first.style,
      imprint: { ...first.imprint, copyrightHolder: 'Someone Else' }
    })
    expect(second.id).toBe(first.id)
    expect(second.imprint.copyrightHolder).toBe('Someone Else')
  })

  it('round-trips through the store shape', () => {
    const banked = bank('Blackthorn')
    const back = migrateSavedProfile(JSON.parse(JSON.stringify(banked)))
    expect(back).toEqual(banked)
  })

  /**
   * The asymmetry with `migrateSavedRun`, which throws. A half-restored *look*
   * is a margin at the shipped default — visible in the gate's preview and one
   * click from fixed — so refusing the record would discard thirteen good
   * fields to protect the user from one they can see.
   */
  it('backfills a partial record instead of refusing it', () => {
    const back = migrateSavedProfile({
      id: 'sp-1',
      name: 'Half a look',
      style: { bodyFont: 'Cardo' }
    })
    expect(back?.style.bodyFont).toBe('Cardo')
    expect(back?.style.margins).toEqual(defaultStyleProfile().margins)
    expect(back?.imprint).toEqual(emptyImprint())
  })

  it('refuses something that is not a profile at all', () => {
    expect(migrateSavedProfile(null)).toBeNull()
    expect(migrateSavedProfile('a look')).toBeNull()
    expect(migrateSavedProfile({ name: 'no id' })).toBeNull()
  })

  it('describes a look by what distinguishes it', () => {
    expect(describeSavedProfile(bank('Blackthorn'))).toBe(
      '5.5x8.5in · IM FELL English at 12.5pt · Blackthorn Press'
    )
  })
})

describe('the design gate — book one asks five questions, book two asks one', () => {
  it('interviews when nothing has been banked', () => {
    const qs = stepById('design').questions(atDesign([]))
    expect(ids(qs)).toEqual(['kind', 'period', 'font', 'chapterOpener', 'runningHeads', 'saveAs'])
  })

  it('asks only which look to use once one is banked', () => {
    const qs = stepById('design').questions(atDesign([bank('Blackthorn')]))
    expect(ids(qs)).toEqual(['profile'])
  })

  it('recommends the most recent look', () => {
    const older = bank('Older', { id: 'sp-old', savedAt: '2025-01-01T00:00:00.000Z' })
    const newer = bank('Newer', { id: 'sp-new', savedAt: '2026-06-01T00:00:00.000Z' })
    const q = stepById('design').questions(atDesign([newer, older]))[0]!
    expect(q.type === 'choice' && q.defaultValue).toBe('sp-new')
  })

  it('offers a way back to the interview, and asks the five again when taken', () => {
    const state = atDesign([bank('Blackthorn')])
    const q = stepById('design').questions(state)[0]
    expect(q?.type === 'choice' && q.options.some((o) => o.value === FRESH_LOOK)).toBe(true)

    const fresh = { ...state, answers: { design: { profile: FRESH_LOOK } } }
    expect(ids(stepById('design').questions(fresh))).toEqual([
      'profile',
      'kind',
      'period',
      'font',
      'chapterOpener',
      'runningHeads',
      'saveAs'
    ])
  })
})

describe('appliedLook — which style the book is actually set in', () => {
  it('uses a banked look as banked, not rebuilt from five answers', () => {
    // The property that matters: a look hand-tweaked past what the interview
    // can express must survive being reused. `bodyFontSize: 12.5` is no
    // answer's output, so regenerating would silently drop it.
    const banked = bank('Blackthorn')
    const look = appliedLook(atDesign([banked]), { profile: banked.id })
    expect(look.style.bodyFontSize).toBe(12.5)
    expect(look.style.trimSize).toBe('5.5x8.5')
    expect(look.fromProfileId).toBe(banked.id)
  })

  it('brings the publisher’s details with it', () => {
    const banked = bank('Blackthorn')
    expect(appliedLook(atDesign([banked]), { profile: banked.id }).imprint).toEqual({
      imprint: 'Blackthorn Press',
      copyrightHolder: 'A. Editor',
      publicDomainNotice: true
    })
  })

  it('falls back to the interview when the chosen look has gone', () => {
    // Deleted in another tab. Interviewing beats failing at the last gate.
    // `reference` gives 7x10, which the banked look does *not* — so this can
    // tell the fallback apart from a silent reuse.
    const look = appliedLook(atDesign([bank('Blackthorn')]), {
      profile: 'sp-vanished',
      kind: 'reference'
    })
    expect(look.fromProfileId).toBeNull()
    expect(look.style.trimSize).toBe('7x10')
  })

  it('interviews when the user asked to start fresh', () => {
    const look = appliedLook(atDesign([bank('Blackthorn')]), {
      profile: FRESH_LOOK,
      kind: 'reference',
      period: 'modern'
    })
    expect(look.fromProfileId).toBeNull()
    expect(look.style.trimSize).toBe('7x10')
    expect(look.imprint).toEqual(emptyImprint())
  })
})

describe('the export gate — the imprint arrives filled in on book two', () => {
  const exportQuestions = (state: WizardState): Question[] =>
    stepById('export').questions({ ...state, completed: [...state.completed, 'design'] })

  const find = (qs: Question[], id: string): Question => qs.find((q) => q.id === id)!

  /** The prefilled answer, narrowed past the one question kind that has none. */
  const defaultOf = (qs: Question[], id: string): unknown => {
    const q = find(qs, id)
    if (q.type === 'term-grid') throw new Error(`${id} is a term grid, not a field`)
    return q.defaultValue
  }

  it('is empty for a first book', () => {
    const qs = exportQuestions({ ...atDesign([]), answers: { design: {} } })
    expect(defaultOf(qs, 'imprint')).toBe('')
    expect(defaultOf(qs, 'copyrightHolder')).toBe('')
  })

  it('prefills from the look that was reused', () => {
    const banked = bank('Blackthorn')
    const qs = exportQuestions({
      ...atDesign([banked]),
      answers: { design: { profile: banked.id } }
    })
    expect(defaultOf(qs, 'imprint')).toBe('Blackthorn Press')
    expect(defaultOf(qs, 'copyrightHolder')).toBe('A. Editor')
    expect(find(qs, 'imprint').help).toContain('Filled in from the look you reused')
  })

  it('never prefills a fact about the book itself', () => {
    // The ISBN and the edition statement are per-title and per-printing. If a
    // banked look could carry them, book two would ship with book one's ISBN.
    const banked = bank('Blackthorn')
    const qs = exportQuestions({
      ...atDesign([banked]),
      answers: { design: { profile: banked.id } }
    })
    expect(defaultOf(qs, 'isbn')).toBe('')
    expect(defaultOf(qs, 'title')).toBe('')
    expect(defaultOf(qs, 'editionStatement')).toBe('')
  })
})
