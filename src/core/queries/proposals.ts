/**
 * What the reader would have answered, offered as options the editor picks among.
 *
 * ## Why this is not the thing the rest of the module forbids
 *
 * `EditorialQuery` has no field for a proposed fix, and `queries.md` carries
 * none, because **a suggestion beside a question is an answer in all but
 * name**. That rule has not moved and this does not weaken it. What it draws
 * is the line the rule was always about: *one* proposal, sitting where the
 * answer goes, is an answer. A handful of complete alternatives, none
 * selected, beside the three plain decisions that are always there and a box
 * to write something else in, is a **menu** — and a menu is how every other
 * question in this app is asked.
 *
 * The editor asked for it in those terms: the reader has a view most of the
 * time and is thinking about it anyway, so picking the right one should cost a
 * tap rather than a paragraph of dictation. What that buys is the thing the
 * gate exists for — a sheet of decisions that actually goes down.
 *
 * Four properties keep it honest, and each is tested:
 *
 * - **Nothing is pre-selected.** A proposal is an *option*, never a
 *   `defaultValue` and never a `held` value. `defaultAnswers` seeds nothing
 *   here, so no proposal can be filed by a press of Next with nobody having
 *   looked. This is the same distinction `./standing.ts` draws for a standing
 *   ruling, and for the same reason.
 * - **The three plain decisions are always offered.** A screen where the only
 *   way forward is one of the reader's wordings is the forbidden thing wearing
 *   a menu's clothes. `queryQuestions` appends them unconditionally.
 * - **A proposal says what it would file, in full.** The decision, the exact
 *   corrected reading, and the reasoning, all on the option itself. An option
 *   whose consequence is invisible is not a choice.
 * - **A proposal is a different type from a `Ruling`.** It has no `decidedOn`
 *   and never reaches `rulings`; it becomes a ruling only by being chosen, at
 *   which point `rulingsFromAnswers` stamps it with the date it was chosen and
 *   whose idea it was. Nothing can file one by mistaking it for the other.
 *
 * ## Who wrote it, and why that is on the record
 *
 * `by` names the session or reader that proposed it. A ruling the editor made
 * unaided and a ruling the editor accepted from a proposal are different
 * things a year later — the second was framed by somebody else, and a reader
 * auditing the edition's decisions deserves to know which. `rulingsFromAnswers`
 * carries it into the filed ruling's reasoning rather than dropping it.
 *
 * Pure: no DOM, no I/O.
 */
import type { RulingDecision } from './rulings'
import type { RaisedQuery } from './index'

/**
 * An answer the reader would give, for the editor to take or leave.
 *
 * Targeted exactly as a ruling is — the leaf and the words as printed — so
 * that the two cannot drift apart about which query they are about. There is
 * deliberately no standing form of this: a class of queries is settled by a
 * standing *ruling*, which is the editor's own, and a class-wide guess by the
 * reader is a great deal of book changed on one opinion.
 */
export interface QueryProposal {
  /** The leaf the query was raised on. Never null: there is no standing proposal. */
  pageIndex: number
  /** The words as printed, matching the query's `quote`. */
  quote: string
  decision: RulingDecision
  /** What it should read instead. Required in practice for `corrected`. */
  correction?: string
  /**
   * Why this would be the answer, in the reader's words.
   *
   * Not optional. A proposal with no reasoning asks the editor to trust rather
   * than to judge, which is the opposite of what the gate is for, and it is the
   * text that goes on the option so the consequence of choosing is visible.
   */
  because: string
  /** The session or reader that proposed it, kept on the filed ruling. */
  by?: string
  /** ISO date. */
  proposedOn?: string
}

/**
 * How many of a query's proposals are shown.
 *
 * Three, and the number is a judgement about a phone rather than about
 * editing: the decision, its evidence and the three plain options already fill
 * a screen, and a list long enough to need scrolling past is a list the editor
 * reads the top of. A reader with four views of a passage has not thought
 * about it hard enough to be worth a tap.
 */
export const MAX_PROPOSALS = 3

function sameWords(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * The proposals made about one query, at most `MAX_PROPOSALS` of them.
 *
 * Matched on the leaf **and** the words, never on the leaf alone: a leaf
 * carrying two queries would otherwise offer each one the other's answers,
 * which is the failure that ends with a correction filed against the wrong
 * passage.
 */
export function proposalsFor(
  query: RaisedQuery,
  proposals: readonly QueryProposal[]
): QueryProposal[] {
  return proposals
    .filter((p) => p.pageIndex === query.pageIndex && sameWords(p.quote, query.quote))
    .slice(0, MAX_PROPOSALS)
}

/** The answer value that names a query's n-th proposal. */
export function proposalValue(index: number): string {
  return `proposed-${index}`
}

/** The proposal an answer names, or null when the answer is a plain decision. */
export function proposalIndex(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^proposed-(\d+)$/u.exec(value)
  if (!match) return null
  const index = Number(match[1])
  return Number.isInteger(index) && index >= 0 ? index : null
}

/**
 * What a proposal would do, as the label and description of its option.
 *
 * The whole consequence on the option, because an option whose effect is
 * invisible until it has been taken is not a choice. The corrected reading is
 * quoted in full rather than elided: the one thing the editor is being asked to
 * agree to is those exact words.
 */
export function describeProposal(proposal: QueryProposal): { label: string; description: string } {
  const label =
    proposal.decision === 'corrected'
      ? `Set it right: “${proposal.correction ?? ''}”`
      : proposal.decision === 'noted'
        ? 'Keep it, and tell the reader'
        : 'Keep it as printed'
  const who = proposal.by ? ` — ${proposal.by}` : ''
  return { label: `${label}${who}`, description: proposal.because }
}

/**
 * Keep only the proposals that could be acted on.
 *
 * A `corrected` proposal with no wording and a proposal with no reasoning are
 * both dropped, for the reasons the fields' own notes give: the first would
 * file a ruling `unapplied()` reports outstanding forever, and the second asks
 * for trust where the gate asks for judgement. Dropping leaves the query with
 * one fewer option, which is true; showing it would put a dead choice on the
 * screen.
 */
export function usableProposals(proposals: readonly QueryProposal[]): QueryProposal[] {
  return proposals.filter(
    (p) =>
      p.because.trim() !== '' && (p.decision !== 'corrected' || (p.correction ?? '').trim() !== '')
  )
}

/**
 * The proposals as a sheet a person reads.
 *
 * Its own file, and never a section of `queries.md`. That sheet's doc comment
 * states the rule it exists under — *no proposed fix appears anywhere* — and
 * the reason has not changed: a person reading a question with the reader's
 * answer printed under it has been given the answer. Here the answers are all
 * there is, the file says whose they are in its first line, and nobody reads
 * it to find out what the questions are.
 *
 * What it is for is the check the app cannot make: an editor who wants to see,
 * in one place and away from the gate, what the reader is about to offer —
 * and, months later, which of the edition's decisions were framed by somebody
 * else.
 */
export function proposalsMarkdown(
  book: { title: string; fileName: string },
  proposals: readonly QueryProposal[]
): string {
  const usable = usableProposals(proposals)
  const lines: string[] = [
    `# What the reader would answer — ${book.title}`,
    '',
    'Not decisions. These are offered at the query gate as options with',
    'nothing selected, beside the three plain decisions that are always there.',
    'Until the editor picks one, none of them has any effect on the book, and',
    '`rulings.md` is where what the edition actually decided is written down.',
    ''
  ]
  if (usable.length === 0) {
    lines.push('Nothing is proposed.', '')
    return lines.join('\n')
  }
  lines.push(
    `${usable.length} proposal${usable.length === 1 ? '' : 's'}, from \`${book.fileName}\`.`,
    '',
    '| Leaf | As printed | Would do | Reads | Why | By |',
    '| --- | --- | --- | --- | --- | --- |'
  )
  for (const p of [...usable].sort((a, b) => a.pageIndex - b.pageIndex)) {
    const would =
      p.decision === 'corrected'
        ? 'set it right'
        : p.decision === 'noted'
          ? 'keep it, and tell the reader'
          : 'keep it as printed'
    const reads = p.correction ? `\`${flat(p.correction)}\`` : '—'
    lines.push(
      `| ${p.pageIndex} | \`${flat(p.quote)}\` | ${would} | ${reads} | ${flat(p.because)} | ${flat(p.by ?? '')} |`
    )
  }
  lines.push('')
  return lines.join('\n')
}

/** A cell: no pipes, no newlines, so one long reason cannot break the table. */
function flat(text: string): string {
  return text
    .replace(/\|/gu, '\\|')
    .replace(/\s*\n\s*/gu, ' ')
    .trim()
}
