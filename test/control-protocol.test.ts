import { describe, it, expect } from 'vitest'
import {
  REDACTED_QUESTIONS,
  advanceOutlook,
  inboxPath,
  parseCommand,
  snapshot,
  validSession
} from '@core/control'
import { STEPS, initialState, type Question, type WizardState } from '@core/wizard'

/**
 * The rules a controller is held to, tested where they are decided.
 *
 * Both of these exist because something outside the tab can now press the
 * app's buttons, and both fail silently if they regress: a leaked key looks
 * like a working session, and an unattended re-read looks like progress until
 * the bill arrives. So neither is asserted against a copy of itself — the
 * redaction list is checked against the gate that actually asks for a key, and
 * the spending rule against the answers the app actually writes.
 */

const everyQuestion = (s: WizardState): Question[] => STEPS.flatMap((step) => step.questions(s))

describe('what may be done unattended', () => {
  it('refuses to leave the uncertainty gate when a leaf is marked to be read again', () => {
    const outlook = advanceOutlook('gate-uncertainties', { 'page-7': 'redo', 'page-9': 'keep' })
    expect(outlook.unattended).toBe(false)
    expect(outlook.refusal).toMatch(/read again/i)
  })

  it('allows the same gate when nothing is being re-read', () => {
    const outlook = advanceOutlook('gate-uncertainties', { 'page-7': 'keep', 'page-9': 'skip' })
    expect(outlook.unattended).toBe(true)
  })

  it('does not promise a price on the transcribe gate branches that are free', () => {
    // Using a reading already paid for, or collecting pages already billed,
    // spends nothing — and a controller told to expect a quote would report a
    // price that never appears and wait for a person with nothing to press.
    expect(advanceOutlook('transcribe', { useSavedRun: 'use' }).effect).toMatch(/free/i)
    expect(advanceOutlook('transcribe', { batchAction: 'collect' }).effect).toMatch(/free/i)
  })

  it('says "2 leaves", not "2 leafves"', () => {
    const outlook = advanceOutlook('gate-uncertainties', { 'page-1': 'redo', 'page-4': 'redo' })
    expect(outlook.effect).toContain('2 leaves')
    expect(outlook.refusal).toContain('2 leaves are')
  })

  it('allows the paid gates, because pressing continue there only quotes', () => {
    for (const step of ['transcribe', 'annotate'] as const) {
      const outlook = advanceOutlook(step, {})
      expect(outlook.unattended).toBe(true)
      // The whole reason these are allowed: the money is behind a second
      // button that names a price. Say so, or the permission is a mystery.
      expect(outlook.effect).toMatch(/quote|cost|price/i)
    }
  })

  /**
   * The guard is only worth anything if it names the answer the app writes.
   * `finishUncertainties` reads `page-<n>` and compares against the string
   * `redo`; if either ever changes, this fails rather than the guard quietly
   * permitting the one thing it exists to stop.
   */
  it('keys off the answer the uncertainty gate really produces', () => {
    const state: WizardState = {
      ...initialState(),
      pageCount: 4,
      completed: ['intake', 'recon', 'gate-identity', 'transcribe'],
      findings: [
        {
          pageIndex: 2,
          code: 'text-dropped',
          severity: 'high',
          message: 'far fewer words than OCR found'
        }
      ]
    }
    const verdicts = everyQuestion(state).filter((q) => /^page-\d+$/.test(q.id))
    expect(verdicts.length).toBeGreaterThan(0)
    for (const q of verdicts) {
      expect(q.type).toBe('choice')
      const options = (q as Extract<Question, { type: 'choice' }>).options.map((o) => o.value)
      expect(options).toContain('redo')
    }
  })
})

describe('credentials do not travel', () => {
  /**
   * Asserted against the gate rather than against the constant: a key question
   * added under another id would pass a test that only compared the set to
   * itself, and would publish a key the first time it was answered.
   */
  it('redacts every question on every gate whose answer is a credential', () => {
    const state: WizardState = { ...initialState(), pageCount: 10, hasApiKey: false }
    const secretish = everyQuestion(state).filter((q) =>
      /api key|token|secret|password/i.test(q.prompt)
    )
    expect(secretish.length).toBeGreaterThan(0)
    for (const q of secretish) expect(REDACTED_QUESTIONS.has(q.id)).toBe(true)
  })

  it('refuses to set one', () => {
    const parsed = parseCommand({ op: 'answer', id: 'apiKey', value: 'sk-ant-real' })
    expect('reason' in parsed).toBe(true)
    expect('reason' in parsed && parsed.reason).toMatch(/credential/i)
  })

  it('keeps one out of the snapshot, prompt and all', () => {
    const { view } = snapshot({
      step: 'transcribe',
      title: 'Read the pages',
      fileName: 'book.pdf',
      pageCount: 10,
      progress: { done: 3, total: 10, pct: 30 },
      questions: [
        {
          id: 'apiKey',
          type: 'text',
          prompt: 'Your Anthropic API key',
          defaultValue: '',
          required: true
        }
      ],
      answers: { apiKey: 'sk-ant-real', model: 'claude-opus-5' },
      missing: []
    })
    expect(JSON.stringify(view)).not.toContain('sk-ant-real')
    expect(view.answers['apiKey']).toBeUndefined()
    expect(view.answers['model']).toBe('claude-opus-5')
    // Still visible as a thing being asked for — a controller has to be able to
    // say "it wants your key" without being able to read or write one.
    expect(view.questions[0]?.redacted).toBe(true)
    expect(view.questions[0]?.prompt).toMatch(/API key/)
  })
})

describe('the snapshot', () => {
  /**
   * An object URL names a Blob in the tab that minted it. Carried across a
   * wire it resolves to nothing while looking exactly like evidence, which is
   * worse than sending no picture at all: every gate here promises the user
   * never decides blind.
   */
  it('replaces object URLs with refs, and keeps the way back to the pixels', () => {
    const { view, images } = snapshot({
      step: 'gate-identity',
      title: 'What is this book?',
      fileName: 'book.pdf',
      pageCount: 8,
      progress: { done: 2, total: 10, pct: 20 },
      questions: [
        {
          id: 'terms',
          type: 'term-grid',
          prompt: 'Do these read correctly?',
          rows: [
            {
              id: 't1',
              reading: 'chirurgeon',
              count: 9,
              cropSrc: 'blob:http://localhost/abc',
              signals: ['rare'],
              pages: [3]
            }
          ]
        }
      ],
      answers: {},
      missing: []
    })
    const json = JSON.stringify(view)
    expect(json).not.toContain('blob:')
    const ref = view.questions[0]?.rows?.[0]?.images?.[0]
    expect(ref?.kind).toBe('image')
    expect(images.get(ref && ref.kind === 'image' ? ref.ref : '')).toBe('blob:http://localhost/abc')
  })

  it('cuts a discrepancy row crop from the page, the way the renderer does', () => {
    const { view, images } = snapshot({
      step: 'gate-uncertainties',
      title: 'Anything wrong here?',
      fileName: 'book.pdf',
      pageCount: 8,
      progress: { done: 4, total: 10, pct: 40 },
      questions: [
        {
          id: 'page-2-gaps',
          type: 'discrepancies',
          prompt: 'Words OCR read that the transcription lacks',
          pageIndex: 2,
          rows: [
            {
              id: 'p2d0',
              tokenIds: ['p2_w14'],
              text: 'sundry',
              confidence: 93,
              strength: 'strong',
              after: 'and other',
              before: 'matters'
            }
          ]
        }
      ],
      answers: {},
      missing: []
    })
    const row = view.questions[0]?.rows?.[0]
    expect(row?.text).toBe('sundry')
    const ref = row?.images?.[0]
    // Deferred rather than cut now: one render per leaf, when the pixels are
    // actually asked for.
    expect(images.get(ref && ref.kind === 'image' ? ref.ref : '')).toBe('words:2:p2_w14')
    // The gap has to read as a place in a sentence, not as a loose word.
    expect(row?.notes?.[0]).toContain('and other')
  })

  it('reports what leaving the gate would do', () => {
    const { view } = snapshot({
      step: 'gate-uncertainties',
      title: 'Anything wrong here?',
      fileName: 'book.pdf',
      pageCount: 8,
      progress: { done: 4, total: 10, pct: 40 },
      questions: [],
      answers: { 'page-3': 'redo' },
      missing: []
    })
    expect(view.advance.unattended).toBe(false)
  })
})

describe('commands off the wire are untrusted', () => {
  it('takes the shapes the wizard accepts', () => {
    expect(parseCommand({ op: 'state' })).toEqual({ command: { op: 'state' } })
    expect(parseCommand({ op: 'answer', id: 'trim', value: '6x9' })).toEqual({
      command: { op: 'answer', id: 'trim', value: '6x9' }
    })
    expect(parseCommand({ op: 'answer', id: 'longS', value: true })).toEqual({
      command: { op: 'answer', id: 'longS', value: true }
    })
    expect(parseCommand({ op: 'answer', id: 'page-2-fix', value: { p2b1: 'the word' } })).toEqual({
      command: { op: 'answer', id: 'page-2-fix', value: { p2b1: 'the word' } }
    })
  })

  /**
   * The term grid is the one gate whose answer is not a map of strings, and it
   * was the one gate a controller could not answer. `validAnswer` took
   * `Record<string, string>` and a verdict is `{ action: 'ignore' }`, so every
   * attempt was refused — and refusing an answer is not refusing the question:
   * an unanswered grid defaults to accepting every row, so OCR noise harvested
   * off an advertisement plate went into the book's confirmed vocabulary with
   * nothing said. Gate 1 promises "confirming a word here fixes it everywhere";
   * from outside the tab it fixed nothing and rejected nothing.
   */
  it('takes a term verdict, which is the one answer that is not a string', () => {
    expect(
      parseCommand({ op: 'answer', id: 'terms', value: { ILL: { action: 'ignore' } } })
    ).toEqual({
      command: { op: 'answer', id: 'terms', value: { ILL: { action: 'ignore' } } }
    })
    expect(
      parseCommand({
        op: 'answer',
        id: 'terms',
        value: { belleves: { action: 'correct', text: 'believes' }, Law: { action: 'accept' } }
      })
    ).toEqual({
      command: {
        op: 'answer',
        id: 'terms',
        value: { belleves: { action: 'correct', text: 'believes' }, Law: { action: 'accept' } }
      }
    })
  })

  /**
   * Widening the shape must not widen it to anything. A verdict is three
   * actions and one optional string; everything else is still an object off
   * the wire.
   */
  it('refuses a verdict that is not one', () => {
    for (const value of [
      { ILL: { action: 'delete' } },
      { ILL: { action: 'correct' } },
      { ILL: { action: 'accept', text: 'x' } },
      { ILL: { action: 'ignore', extra: 'x' } },
      { ILL: { action: 'correct', text: 3 } },
      { ILL: {} }
    ]) {
      const parsed = parseCommand({ op: 'answer', id: 'terms', value })
      expect('reason' in parsed, `should refuse ${JSON.stringify(value)}`).toBe(true)
    }
  })

  it('refuses everything else, with the reason', () => {
    for (const raw of [
      null,
      'advance',
      { op: 'delete-everything' },
      { op: 'answer', value: 'x' },
      { op: 'answer', id: 'trim', value: { nested: { deep: 1 } } },
      { op: 'answer', id: 'trim', value: [1, 2] },
      { op: 'evidence' }
    ]) {
      const parsed = parseCommand(raw)
      expect('reason' in parsed, `should refuse ${JSON.stringify(raw)}`).toBe(true)
    }
  })
})

describe('session names reach a repository path', () => {
  it('refuses anything that could climb out of the control directory', () => {
    for (const bad of ['..', 'a/b', '../../books', '', 'A', 'x'.repeat(70), '-lead']) {
      expect(validSession(bad), bad).toBe(false)
    }
    expect(validSession('laptop-1')).toBe(true)
    expect(inboxPath('laptop-1')).toBe('control/laptop-1/inbox.json')
  })
})
