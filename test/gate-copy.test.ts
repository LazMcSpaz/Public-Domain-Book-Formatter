import { describe, it, expect } from 'vitest'
import { STEPS, initialState, stepById, type Question, type WizardState } from '@core/wizard'
import { MODELS } from '@core/transcribe'

/**
 * What every question on every gate has to manage, tested as a rule rather than
 * as a list of strings.
 *
 * The app's premise is that nobody should need to understand its structure to
 * use it: each option arrives with a recommendation and the evidence for it.
 * That premise decays quietly. A question added in a hurry with a four-word
 * description reads fine to whoever wrote it and is unanswerable to anybody
 * else, and nothing fails when it happens.
 *
 * These are the properties, not the prose. The wording can change freely; what
 * cannot change is that a choice explains its options and that the two screens
 * where money is committed say so.
 */

const everyQuestion = (s: WizardState): { step: string; q: Question }[] =>
  STEPS.flatMap((step) => step.questions(s).map((q) => ({ step: step.id, q })))

/** A state rich enough that every gate has something to ask about. */
const populated = (): WizardState => ({
  ...initialState(),
  pageCount: 212,
  pagesProcessed: 212,
  hasApiKey: true,
  completed: ['intake', 'recon', 'gate-identity', 'transcribe', 'gate-uncertainties'],
  lexicon: [
    {
      term: 'chirurgeon',
      count: 9,
      meanConfidence: 91,
      pages: [3, 8],
      variants: [],
      signals: [],
      impact: 4,
      sampleTokenId: 'p3_w12'
    }
  ],
  document: {
    blocks: [
      {
        id: 'p0b0',
        kind: 'paragraph',
        text: 'Of the alembick being set upon a fire.',
        sourcePages: [0]
      }
    ],
    footnotes: [],
    chapters: [{ id: 'p0b0', title: 'Chapter I', level: 1, blockIndex: 0, sourcePage: 0 }],
    asides: [],
    illustrations: [],
    sections: [],
    skipped: []
  }
})

describe('every question can be answered by someone who has not read the code', () => {
  it('gives each option a description, not just a label', () => {
    // A bare label is the app asking the user to guess what it does. The
    // recommendation lives in the description, so an option without one is an
    // option with no argument for or against it.
    const bare: string[] = []
    for (const { step, q } of everyQuestion(populated())) {
      if (q.type !== 'choice' && q.type !== 'multi-choice') continue
      for (const option of q.options) {
        // A picture is its own argument — an illustration candidate shows the
        // pixels and needs no sentence about them.
        if (option.evidence?.length) continue
        if (!option.description || option.description.length < 12) {
          bare.push(`${step}/${q.id}/${option.value}`)
        }
      }
    }
    expect(bare).toEqual([])
  })

  it('gives each question a recommended answer to start from', () => {
    const undecided: string[] = []
    for (const { step, q } of everyQuestion(populated())) {
      if (q.type !== 'choice') continue
      if (q.defaultValue === undefined || q.defaultValue === null || q.defaultValue === '') {
        undecided.push(`${step}/${q.id}`)
      }
    }
    expect(undecided).toEqual([])
  })

  it('says what a question is for, at more than a glance', () => {
    const thin: string[] = []
    for (const { step, q } of everyQuestion(populated())) {
      if (q.type === 'term-grid' || q.type === 'discrepancies') continue
      const help = 'help' in q && typeof q.help === 'string' ? q.help : ''
      if (help.length < 40) thin.push(`${step}/${q.id}`)
    }
    expect(thin).toEqual([])
  })
})

describe('the screens that spend money say so', () => {
  it('names the price on the reading', () => {
    const step = STEPS.find((x) => x.id === 'transcribe')!
    expect(step.blurb).toMatch(/costs real money/i)
  })

  it('says the notes pass is the cheaper one, and why', () => {
    const step = STEPS.find((x) => x.id === 'annotate')!
    expect(step.blurb).toMatch(/no page images/i)
  })

  it('says the free steps are free', () => {
    for (const id of ['recon', 'design']) {
      expect(STEPS.find((x) => x.id === id)!.blurb).toMatch(/free/i)
    }
  })
})

describe('the model is chosen where the work differs', () => {
  const gate = (id: 'transcribe' | 'annotate', s: WizardState): Question[] =>
    stepById(id)!.questions(s)

  const reading = (): WizardState => ({
    ...populated(),
    completed: ['intake', 'recon', 'gate-identity']
  })

  const notes = (): WizardState => ({
    ...populated(),
    completed: ['proof']
  })

  it('asks at the reading, where the job is perception', () => {
    const q = gate('transcribe', reading()).find((x) => x.id === 'model')
    expect(q && 'help' in q ? q.help : '').toMatch(/perception/i)
  })

  it('asks again at the notes, where the job is judgement', () => {
    // Not an inheritance. Someone who read a clean scan on the cheapest model
    // has no reason to write the book's notes on it, and with no page images
    // here the better model costs a fraction of what it costs upstairs.
    const q = gate('annotate', notes()).find((x) => x.id === 'notesModel')
    expect(q && 'help' in q ? q.help : '').toMatch(/judgement/i)
  })

  it('offers the same models in both places', () => {
    const ids = new Set(MODELS.map((m) => m.id))
    for (const [step, id, state] of [
      ['transcribe', 'model', reading()],
      ['annotate', 'notesModel', notes()]
    ] as const) {
      const q = gate(step, state).find((x) => x.id === id)
      const offered = q && 'options' in q ? q.options.map((o) => o.value) : []
      expect(new Set(offered)).toEqual(ids)
    }
  })

  it('recommends where each one earns its price rather than ranking them', () => {
    // "Highest quality / balanced / cheapest" is a price list, and it tells
    // someone holding a foxed 1662 quarto nothing about which to pick.
    const q = gate('transcribe', reading()).find((x) => x.id === 'model')
    const text = q && 'options' in q ? q.options.map((o) => o.description).join(' ') : ''
    expect(text).toMatch(/foxed|long-s|marginalia/i)
    expect(text).toMatch(/clean/i)
  })
})

describe('a decision that is expensive to undo says so', () => {
  it('warns that the spelling policy is baked into what you pay for', () => {
    // The one answer in this app that a later change cannot fix for free: it
    // goes into the instructions for every page, so revisiting it means paying
    // to read the book again.
    const s: WizardState = { ...populated(), completed: ['intake', 'recon'] }
    const q = stepById('gate-identity')!
      .questions(s)
      .find((x) => x.id === 'orthography')
    expect(q && 'help' in q ? q.help : '').toMatch(/read the book\s+again|pay/i)
  })
})
