/**
 * The question contract.
 *
 * Design rule for this app: **the app interviews you; it never makes you go find
 * a setting.** Every option starts life as a question asked at the moment it
 * becomes relevant, with a recommended answer pre-selected and the evidence for
 * it attached.
 *
 * Questions are *data*, not screens. A step declares what it needs; the UI
 * renders whatever it emits. Two consequences: adding a question later needs no
 * new UI code, and the entire flow is unit-testable with no DOM — we can assert
 * "given this book state, the wizard asks exactly these questions with this
 * evidence".
 */

/** Visual proof shown beside a question so the user never decides blind. */
export type Evidence =
  /** A crop of the page image — a word, a region, a whole page thumbnail. */
  | { kind: 'image'; src: string; alt: string; width?: number; height?: number }
  /** Verbatim text pulled from the book. */
  | { kind: 'text'; text: string; label?: string }
  /** A rendered sample of a design choice. */
  | { kind: 'sample'; src: string; caption: string }

export interface QuestionBase {
  id: string
  /** The question as asked, in plain language. */
  prompt: string
  /** Optional one-line rationale ("this affects how names are spelled"). */
  help?: string
  /** Evidence rendered beside the question. */
  evidence?: Evidence[]
  /** When true the step cannot be completed until answered. */
  required?: boolean
}

export interface ChoiceOption {
  value: string
  label: string
  description?: string
  evidence?: Evidence[]
}

/** Pick one of a few options. */
export interface ChoiceQuestion extends QuestionBase {
  type: 'choice'
  options: ChoiceOption[]
  /** Pre-selected recommendation — the user usually just confirms. */
  defaultValue: string
  multi?: false
}

/** Pick any number of options. */
export interface MultiChoiceQuestion extends QuestionBase {
  type: 'multi-choice'
  options: ChoiceOption[]
  defaultValue: string[]
}

/** Free text, pre-filled from what we read off the page. */
export interface TextQuestion extends QuestionBase {
  type: 'text'
  defaultValue: string
  placeholder?: string
  multiline?: boolean
}

/** A yes/no with a recommended answer. */
export interface ConfirmQuestion extends QuestionBase {
  type: 'confirm'
  defaultValue: boolean
}

/** One row of the term-review grid: pixels, the reading, and the verdict. */
export interface TermRow {
  id: string
  /** What OCR read. */
  reading: string
  /** Occurrences book-wide — the grid sorts on this, since impact scales with it. */
  count: number
  /** Cropped pixels of the word, as an object URL or data URL. */
  cropSrc?: string
  /** Why it surfaced. */
  signals: string[]
  pages: number[]
}

/**
 * Batch review of harvested vocabulary. Deliberately one question rather than
 * N — dripping 200 individual prompts would be miserable; a grid with
 * accept-all is not.
 */
export interface TermGridQuestion extends QuestionBase {
  type: 'term-grid'
  rows: TermRow[]
}

export type Question =
  ChoiceQuestion | MultiChoiceQuestion | TextQuestion | ConfirmQuestion | TermGridQuestion

/** Per-term verdict from the review grid. */
export type TermVerdict =
  { action: 'accept' } | { action: 'correct'; text: string } | { action: 'ignore' }

export type AnswerValue = string | string[] | boolean | Record<string, TermVerdict>

/** Answers keyed by question id. */
export type Answers = Record<string, AnswerValue>

/** Every question's recommended answer — the "just hit continue" path. */
export function defaultAnswers(questions: readonly Question[]): Answers {
  const out: Answers = {}
  for (const q of questions) {
    switch (q.type) {
      case 'choice':
      case 'text':
        out[q.id] = q.defaultValue
        break
      case 'multi-choice':
        out[q.id] = [...q.defaultValue]
        break
      case 'confirm':
        out[q.id] = q.defaultValue
        break
      case 'term-grid':
        // Accepting every reading is the default; the user overrides the wrong ones.
        out[q.id] = Object.fromEntries(
          q.rows.map((r) => [r.id, { action: 'accept' } as TermVerdict])
        )
        break
    }
  }
  return out
}

/** Ids of required questions still unanswered. */
export function missingRequired(questions: readonly Question[], answers: Answers): string[] {
  return questions
    .filter((q) => q.required)
    .filter((q) => {
      const v = answers[q.id]
      if (v === undefined || v === null) return true
      if (typeof v === 'string') return v.trim().length === 0
      if (Array.isArray(v)) return v.length === 0
      return false
    })
    .map((q) => q.id)
}
