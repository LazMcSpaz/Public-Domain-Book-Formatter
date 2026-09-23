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
 * `ChoiceQuestion.defaultValue` is therefore left undefined here, so
 * `defaultAnswers` seeds nothing and no answer exists until a person makes one.
 * The editor ruled on it directly rather than it being inferred.
 *
 * ## And nothing is `required`, which is the other half of the same promise
 *
 * The first version marked the decision `required`, meaning to say "you must
 * choose before this counts". What `required` actually governs is the *step*:
 * seventy-nine required questions is a gate that cannot be left until all
 * seventy-nine are settled, which is the exact opposite of the partial work
 * this gate exists to keep. A query the editor wants to think about must be
 * skippable.
 *
 * Skipping is safe because `rulingsFromAnswers` files nothing for a query with
 * no decision: an untouched screen leaves the query outstanding, which is true,
 * and it will be waiting at this gate the next time.
 *
 * What the assistant *may* do is say why the question is hard, which is what
 * the query's own `why` already carries, and offer a wording for a correction —
 * as a **placeholder**, which is text the editor has to accept by typing over
 * or leaving, never a value that arrives answered.
 *
 * ## And what it may also do: offer whole answers, as options
 *
 * The editor's ruling on this, in his words: the reader has a sense of the
 * right answer most of the time and is thinking about it anyway, so taking it
 * should cost a tap rather than a paragraph of dictation. That does not
 * reopen the rule above, because the rule was about *one* suggestion sitting
 * where the answer goes. A handful of complete alternatives, **none
 * selected**, above the three plain decisions that are always offered and a
 * box to write something else in, is a menu — which is how every other
 * question in this app is asked.
 *
 * `./proposals.ts` holds the type and the four properties that keep it the
 * second thing rather than the first. The two this file is responsible for:
 * a proposal is an `option` and never a `defaultValue` or a `held` value, so
 * `defaultAnswers` seeds nothing and no press of Next files one; and
 * `DECISIONS` is appended unconditionally, so there is never a screen whose
 * only way forward is one of the reader's wordings.
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
import { heldBecause, standingFor } from './standing'
// Its own module, so a shelf script can name a crop the same way the gate
// asks for one. See `./key.ts`.
import { queryKey } from './key'
import {
  describeProposal,
  proposalIndex,
  proposalValue,
  proposalsFor,
  usableProposals,
  type QueryProposal
} from './proposals'

/**
 * Where a query is, in both the numbers that name it.
 *
 * The leaf is what everything in this app counts and what the crop is cut
 * from; the folio is what the book prints and what every reason written about
 * it cites. Giving one and not the other is how "this passage on page 170"
 * came to sit under a heading reading "Leaf 228" — the same place, twice, with
 * no way to know it.
 */
export function whereItIs(query: RaisedQuery): string {
  return query.folio ? `Leaf ${query.pageIndex} · page ${query.folio}` : `Leaf ${query.pageIndex}`
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
  /**
   * Complete answers the reader would give, offered as **options** beside the
   * three plain decisions and never as a selected value.
   *
   * The distinction the note above draws is between one suggestion sitting
   * where the answer goes and a menu of alternatives with nothing chosen;
   * `./proposals.ts` states the four properties that keep this the second
   * thing, and the tests hold it to them. Matched to a query by its leaf and
   * its words, exactly as a ruling is.
   */
  proposals?: readonly QueryProposal[]
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
    // A standing ruling that reaches this query holds an answer for it. The
    // answer is carried as `held` — pre-filled on screen, filed only when
    // the editor accepts it — and never as `defaultValue`, which would seed
    // it and file it on the next press of Next. See `./standing.ts`.
    const holding = standingFor(query, rulings)
    const heldWhy = holding
      ? `Pre-filled under the standing ruling “${holding.quote}” (${holding.decidedOn})` +
        (holding.because ? `: ${holding.because}` : '.')
      : null

    // What the reader would have answered, as options to pick among. First,
    // because that is the ergonomics the editor asked for — the tap is the
    // point — and harmless to the rule as long as the two conditions below
    // hold: nothing is selected, and the three plain decisions are always
    // underneath. `usableProposals` drops any that could not be acted on, so
    // no dead choice reaches the screen.
    const offered = usableProposals(proposalsFor(query, options.proposals ?? []))
    const proposalOptions = offered.map((proposal, index) => ({
      value: proposalValue(index),
      ...describeProposal(proposal)
    }))

    const decision: Question = {
      id: `${key}-decision`,
      type: 'choice',
      prompt: `${whereItIs(query)}: what should this edition do?`,
      help: query.why,
      evidence,
      options: [
        ...proposalOptions,
        // Unconditional. A screen whose only way forward is one of the
        // reader's wordings is the forbidden thing wearing a menu's clothes.
        ...DECISIONS.map((d) => ({
          value: d.value,
          label: d.label,
          description: d.description
        }))
      ],
      // No `defaultValue`, and not `required`. See the note at the top of
      // this file: nothing is chosen for the editor, and a query they want to
      // think about can be left and will be waiting here next time.
      ...(holding && heldWhy ? { held: { value: holding.decision, why: heldWhy } } : {}),
      group: key
    }
    const correction: Question = {
      id: `${key}-correction`,
      type: 'text',
      prompt: 'If it is set right, what should it read?',
      help:
        'Only used when the decision above is “Set it right”. The whole passage, as it ' +
        'should print. Leave it empty to take the wording from the option you picked; ' +
        'anything typed here wins over it.',
      defaultValue: '',
      ...(suggestion ? { placeholder: suggestion } : { placeholder: query.quote }),
      ...(holding?.decision === 'corrected' && holding.correction && heldWhy
        ? { held: { value: holding.correction, why: heldWhy } }
        : {}),
      multiline: true,
      group: key
    }
    const because: Question = {
      id: `${key}-because`,
      type: 'text',
      prompt: 'Why? (in your own words)',
      help:
        'Goes into `rulings.md` on the shelf, so a later session knows what this edition ' +
        'decided and why. Leave it empty to keep the reasoning of the option you picked; ' +
        'either way the ruling records that it came from a proposal.',
      defaultValue: '',
      ...(holding
        ? { held: { value: heldBecause(holding), why: 'The standing ruling’s own reasoning.' } }
        : {}),
      multiline: true,
      group: key
    }
    return [decision, correction, because]
  })
}

/**
 * Accept every held answer that has not been answered otherwise.
 *
 * The "approve all N" button, and `drive.mjs held approve`. Only questions
 * carrying a `held` value are touched, and only where the editor has not
 * already typed or chosen something — an answer a person gave is never
 * overwritten by the one a ruling would have given. Returns the answers with
 * the approvals folded in; `rulingsFromAnswers` then files them exactly as it
 * files a hand-made ruling, because after approval that is what they are.
 */
export function approveHeld(questions: readonly Question[], answers: Answers): Answers {
  const out: Answers = { ...answers }
  for (const q of questions) {
    if (!q.held) continue
    const current = out[q.id]
    const untouched = current === undefined || current === ''
    if (untouched) out[q.id] = q.held.value
  }
  return out
}

/** How many held answers a set of questions still carries unapproved. */
export function heldPending(questions: readonly Question[], answers: Answers): number {
  return questions.filter((q) => q.held && q.type === 'choice' && answers[q.id] !== q.held.value)
    .length
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
  decidedOn: string,
  proposals: readonly QueryProposal[] = []
): Ruling[] {
  const out: Ruling[] = []
  for (const query of raised) {
    const key = queryKey(query)
    const answer = answers[`${key}-decision`]
    if (typeof answer !== 'string' || answer === '') continue

    // A proposal the editor picked. It becomes an ordinary ruling here and
    // nowhere else: the type carries no `decidedOn` precisely so that nothing
    // can file one without a person having chosen it, and this is the choosing.
    // The list is filtered the same way the options were built, so the n-th
    // option and the n-th proposal are the same thing — read it any other way
    // and a dropped proposal shifts every answer after it onto its neighbour.
    const picked = proposalIndex(answer)
    const proposal =
      picked === null ? null : (usableProposals(proposalsFor(query, proposals))[picked] ?? null)
    if (picked !== null && !proposal) continue

    const decision = proposal ? proposal.decision : answer
    if (decision !== 'as-printed' && decision !== 'corrected' && decision !== 'noted') continue

    // Typed text wins over the proposal's, for both fields. Picking an option
    // and then editing the wording beneath it is the editor amending the
    // proposal, not contradicting themselves, and the amendment is the answer.
    const correction = answers[`${key}-correction`]
    const typed = typeof correction === 'string' ? correction.trim() : ''
    const text = typed || (proposal?.correction ?? '').trim()
    if (decision === 'corrected' && text === '') continue

    const why = answers[`${key}-because`]
    const said = typeof why === 'string' ? why.trim() : ''
    const reasoning = said || (proposal?.because ?? '').trim()
    // Whose idea it was, kept. A ruling the editor reached unaided and one they
    // accepted from a proposal are different things to a reader auditing this
    // edition a year from now, and the difference is invisible in the filed
    // ruling unless it is written down.
    const because = proposal
      ? `${reasoning}${reasoning.endsWith('.') || reasoning === '' ? '' : '.'} ` +
        `Chosen from a reading proposal${proposal.by ? ` by ${proposal.by}` : ''}.`.trim()
      : reasoning

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
