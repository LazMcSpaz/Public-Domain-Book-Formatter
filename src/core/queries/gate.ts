/**
 * The queries, as a gate a person works one at a time.
 *
 * A query is raised and never taken (`./index.ts`), and a ruling is the answer
 * (`./rulings.ts`). Between the two there was only a Markdown sheet: the editor
 * read `queries.md` on the shelf, decided, and then had to get the decision
 * back into the book through a chat session. Seventy-nine of them is an evening
 * of dictation, and a decision that never makes the trip is a book that keeps
 * an error its editor settled weeks ago.
 *
 * So the sheet becomes a gate. One query to a screen, the passage as printed,
 * a crop of the leaf it sits on, and the three decisions a `Ruling` can carry.
 *
 * ## Nothing is pre-selected, and that is the whole design
 *
 * Every other question in this app arrives with the recommended answer already
 * chosen — the app interviews, and the user confirms. This one must not, and
 * the reason is the rule the rest of the module is built on: **a suggestion
 * beside a question is an answer in all but name, and the answer is the
 * editor's.** `EditorialQuery` has no field for a proposed fix for exactly
 * that reason. A screen that arrived with one of the assistant's options
 * already filled in would hand back through the UI what the schema refuses.
 *
 * `ChoiceQuestion.defaultValue` is therefore left undefined here and the
 * question is `required`, so `defaultAnswers` seeds nothing and the step cannot
 * be completed until a person has chosen. It costs a tap per query. The editor
 * ruled on it directly rather than it being inferred.
 *
 * What the assistant *may* do is say why the question is hard, which is what
 * the query's own `why` already carries, and offer a wording for a correction —
 * as a **placeholder**, which is text the editor has to accept by typing over
 * or leaving, never a value that arrives answered.
 *
 * ## Why three questions and not one
 *
 * A ruling is a decision plus, sometimes, a wording plus, usually, a reason.
 * They are one decision and have to be seen together, which is what `group`
 * exists for — the same mechanism that keeps a flagged leaf's verdict beside
 * the passage it is about. Split across screens, the editor would be asked to
 * justify a ruling they could no longer see.
 *
 * Pure: no DOM, no I/O.
 */
import type { Answers, Evidence, Question } from '@core/wizard'
import type { RaisedQuery } from './index'
import { outstanding, type Ruling, type RulingDecision } from './rulings'

/** The id a query's questions are grouped under, and keyed by. */
export function queryKey(query: RaisedQuery): string {
  // The leaf plus a digest of the words. Not the words themselves: an id goes
  // in a DOM attribute and into `localStorage`, and a quote carries quotation
  // marks, Greek, and the odd newline.
  let hash = 0
  for (const ch of query.quote) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return `q-${query.pageIndex}-${(hash >>> 0).toString(36)}`
}

const DECISIONS: { value: RulingDecision; label: string; description: string }[] = [
  {
    value: 'as-printed',
    label: 'Keep it as printed',
    description:
      'The reprint follows the sheet. The default posture of an edition like this, and the one that needs no defence.'
  },
  {
    value: 'corrected',
    label: 'Set it right',
    description: 'Say below what it should read. The correction is applied to the book.'
  },
  {
    value: 'noted',
    label: 'Keep it, and tell the reader',
    description:
      'The page stands as printed and the note on the text says why. For a slip worth seeing rather than mending.'
  }
]

export interface QueryGateOptions {
  /**
   * A crop of the leaf, by query key — cut only for the queries being shown.
   *
   * Evidence crosses as a `ref` the caller resolves, never an object URL: a
   * `blob:` that resolves to nothing outside the tab that minted it looks
   * exactly like evidence, and this gate promises the pixels.
   */
  crops?: Record<string, Evidence>
  /**
   * A wording the assistant suggests, by query key, offered as placeholder text
   * only. Never an answer: see the note at the top of this file.
   */
  suggestions?: Record<string, string>
}

/**
 * One group of questions per query still waiting on the editor.
 *
 * Answered queries are gone, not shown as settled: `outstanding` is what the
 * sheet uses and what this uses, so the gate and the sheet cannot disagree
 * about what is left.
 */
export function queryQuestions(
  raised: readonly RaisedQuery[],
  rulings: readonly Ruling[],
  options: QueryGateOptions = {}
): Question[] {
  const waiting = outstanding(raised, rulings)
  return waiting.flatMap((query) => {
    const key = queryKey(query)
    const evidence: Evidence[] = [{ kind: 'text', text: query.quote, label: 'As printed' }]
    const crop = options.crops?.[key]
    if (crop) evidence.push(crop)
    const suggestion = options.suggestions?.[key]

    const decision: Question = {
      id: `${key}-decision`,
      type: 'choice',
      prompt: `Leaf ${query.pageIndex}: what should this edition do?`,
      help: query.why,
      evidence,
      options: DECISIONS.map((d) => ({
        value: d.value,
        label: d.label,
        description: d.description
      })),
      // No `defaultValue`. See the note at the top of this file.
      required: true,
      group: key
    }
    const correction: Question = {
      id: `${key}-correction`,
      type: 'text',
      prompt: 'If it is set right, what should it read?',
      help: 'Only used when the decision above is “Set it right”. The whole passage, as it should print.',
      defaultValue: '',
      ...(suggestion ? { placeholder: suggestion } : { placeholder: query.quote }),
      multiline: true,
      group: key
    }
    const because: Question = {
      id: `${key}-because`,
      type: 'text',
      prompt: 'Why? (in your own words)',
      help: 'Goes into `rulings.md` on the shelf, so a later session knows what this edition decided and why.',
      defaultValue: '',
      multiline: true,
      group: key
    }
    return [decision, correction, because]
  })
}

/**
 * The rulings a sitting at this gate produced.
 *
 * Only queries the editor actually decided: an untouched screen produces
 * nothing, so closing the tab half way through leaves the rest waiting rather
 * than filing thirty blank rulings that would read as "kept as printed" and
 * settle questions nobody looked at.
 *
 * A `corrected` decision with no wording is **dropped, not filed**. It is the
 * one combination that would quietly do nothing — `unapplied()` would report it
 * outstanding forever, which is the shape of a check that cries wolf — and
 * dropping it leaves the query waiting, which is true.
 */
export function rulingsFromAnswers(
  raised: readonly RaisedQuery[],
  answers: Answers,
  decidedOn: string
): Ruling[] {
  const out: Ruling[] = []
  for (const query of raised) {
    const key = queryKey(query)
    const decision = answers[`${key}-decision`]
    if (typeof decision !== 'string' || decision === '') continue
    if (decision !== 'as-printed' && decision !== 'corrected' && decision !== 'noted') continue

    const correction = answers[`${key}-correction`]
    const text = typeof correction === 'string' ? correction.trim() : ''
    if (decision === 'corrected' && text === '') continue

    const why = answers[`${key}-because`]
    const because = typeof why === 'string' ? why.trim() : ''

    out.push({
      pageIndex: query.pageIndex,
      quote: query.quote,
      kind: query.kind,
      decision,
      ...(decision === 'corrected' ? { correction: text } : {}),
      ...(because ? { because } : {}),
      decidedOn
    })
  }
  return out
}
