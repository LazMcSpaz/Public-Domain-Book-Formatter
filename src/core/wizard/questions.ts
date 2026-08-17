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
  /**
   * Questions that are one decision and have to be seen together.
   *
   * A flagged leaf is a verdict *and* an editor for the same text; splitting
   * them across screens would ask "is this good enough?" with the passage on
   * another page. Declared here rather than inferred from the ids, because a
   * renderer parsing `page-9-fix` out of a string is a contract nobody wrote
   * down and nothing tests.
   *
   * Grouping is what makes it possible to show a gate one decision at a time,
   * which is the difference between usable and unusable on a phone.
   */
  group?: string
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
  /** A wider cut of the same word, in its line — shown on hover. */
  contextSrc?: string
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

/** One passage off a leaf, as it currently reads. */
export interface PageEditRow {
  /** The block's id — what a correction is keyed to, book-wide. */
  id: string
  /** What it says now, with any corrections already made to it. */
  text: string
  /** What kind of thing it is, so a heading is not mistaken for a paragraph. */
  kind: string
  /**
   * Later leaves this passage also runs onto, if any.
   *
   * A paragraph joined across a seam is shown on the leaf it began, so the text
   * here can run past what the scan beside it shows. Saying so is the difference
   * between a repair and an apparent mistake to be edited out.
   */
  alsoFromPages: number[]
}

/**
 * Fix a leaf's text in place, rather than paying to have it read again.
 *
 * The gate exists to ask "is this good enough to keep", and the honest answer is
 * often "no, and I can see exactly what's wrong". Until this existed the only
 * remedies on offer were to re-run the page at a cost or to remember to come
 * back at the proof step; both are worse than typing the word.
 *
 * The answer is `blockId → corrected text`, holding only what was *changed* —
 * so it converts straight into the same `text` edits a correction typed at the
 * proof step produces, and an untouched leaf contributes nothing.
 */
export interface PageEditQuestion extends QuestionBase {
  type: 'page-edit'
  rows: PageEditRow[]
}

export type Question =
  | ChoiceQuestion
  | MultiChoiceQuestion
  | TextQuestion
  | ConfirmQuestion
  | TermGridQuestion
  | PageEditQuestion

/** Per-term verdict from the review grid. */
export type TermVerdict =
  { action: 'accept' } | { action: 'correct'; text: string } | { action: 'ignore' }

export type AnswerValue =
  string | string[] | boolean | Record<string, TermVerdict> | Record<string, string>

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
      case 'page-edit':
        // Empty, not a copy of the rows: the answer holds corrections, and a
        // leaf nobody touched must produce no edit at all. Seeding it with the
        // current text would write an edit over every block in the book and
        // make "undo" at the proof step revert to a correction of nothing.
        out[q.id] = {}
        break
    }
  }
  return out
}

/** One screenful: a decision and everything needed to make it. */
export interface QuestionGroup {
  /** Stable across reloads, so "where was I" survives one. */
  id: string
  /** What to call it in a pager — the leading question's own prompt. */
  label: string
  questions: Question[]
}

/**
 * Split a step's questions into the decisions they add up to.
 *
 * Order is preserved and consecutive ungrouped questions travel together, so a
 * gate's preamble stays one screen rather than becoming one screen per line.
 *
 * Always safe to ignore: a renderer with room for everything can lay the whole
 * list out as before, and this says what the seams *would* be.
 */
export function groupQuestions(questions: readonly Question[]): QuestionGroup[] {
  const out: QuestionGroup[] = []
  const named = new Map<string, QuestionGroup>()
  // The run of ungrouped questions currently being filled, if any. Closed by
  // the next grouped question, so a preamble cannot swallow a later aside.
  let loose: QuestionGroup | null = null
  let looseCount = 0

  for (const q of questions) {
    if (q.group !== undefined) {
      loose = null
      const existing = named.get(q.group)
      if (existing) {
        // A group named twice is one group. Ids have to stay unique or the
        // "where was I" cursor would point at two different screens.
        existing.questions.push(q)
        continue
      }
      const group: QuestionGroup = { id: `group-${q.group}`, label: q.prompt, questions: [q] }
      named.set(q.group, group)
      out.push(group)
      continue
    }

    if (loose) {
      loose.questions.push(q)
      continue
    }
    looseCount += 1
    loose = { id: `loose-${looseCount}`, label: q.prompt, questions: [q] }
    out.push(loose)
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
