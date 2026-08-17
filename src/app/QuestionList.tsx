/**
 * A gate's questions — all of them, or one decision at a time.
 *
 * Gate 2 on a real book is forty flagged leaves, each a verdict plus an editor
 * carrying the passage it is about. On a desktop that is a long page you can
 * skim. On a phone it is an unusable wall: you cannot see where you are, you
 * cannot tell how much is left, and losing the tab loses your place.
 *
 * So the same questions are rendered one group to a screen, with a pager, a bar
 * showing how many are done, and the place remembered. On any screen: forty
 * leaves at once is intimidating wherever it is shown, and a wall of everything
 * is what stops a review being started. Anyone who would rather see the lot can
 * say so, and that choice is one button.
 *
 * Nothing about the *questions* changes — the step returns the same data, and
 * what a group is comes from its own `group` field rather than from this file
 * guessing at ids. Paging is a rendering decision and lives here, which is what
 * keeps the flow testable with no DOM.
 */
import { useMemo, useRef, useState } from 'react'
import { groupQuestions, type AnswerValue, type Answers, type Question } from '@core/wizard'
import { QuestionView } from './QuestionView'

export interface QuestionListProps {
  questions: Question[]
  answers: Answers
  onChange: (id: string, value: AnswerValue) => void
  resolveEvidence?: (src: string) => string | undefined
  enlargeEvidence?: (src: string) => Promise<string | undefined>
  /** Where the user had got to and what they had been through, from storage. */
  place?: { at: string | null; done: string[] }
  onPlace?: (place: { at: string | null; done: string[] }) => void
  /**
   * The step's own forward action, rendered by the caller.
   *
   * Held back until the last screen when paging: a "continue" button beside
   * "next leaf" on leaf three of forty is an invitation to skip the other
   * thirty-seven by accident.
   */
  children?: (atEnd: boolean) => JSX.Element | null
}

export function QuestionList({
  questions,
  answers,
  onChange,
  resolveEvidence,
  enlargeEvidence,
  place,
  onPlace,
  children
}: QuestionListProps): JSX.Element {
  const groups = useMemo(() => groupQuestions(questions), [questions])

  /**
   * One at a time by default, on any screen.
   *
   * Not only a phone concession: forty leaves at once is intimidating wherever
   * it is shown, and a wall of everything is what makes a review feel like it
   * cannot be started. Anyone who would rather see the lot can say so.
   */
  const [chosen, setChosen] = useState<boolean | null>(null)
  const paged = (chosen ?? true) && groups.length > 1

  /**
   * Where we are and what is done live in the caller, not here.
   *
   * Controlled rather than mirrored: a local copy seeded from a prop has to be
   * re-seeded when the prop arrives, and the prop arrives *after* this
   * component's first effect runs — so the seeded copy would win and the
   * remembered place would be silently ignored. There is nothing to
   * synchronise if there is only one copy.
   */
  const index = Math.max(
    0,
    groups.findIndex((g) => g.id === place?.at)
  )
  const done = useMemo(() => new Set(place?.done ?? []), [place])
  const atEnd = !paged || index >= groups.length - 1
  const topRef = useRef<HTMLDivElement>(null)

  // A group counts as done once the user has moved on from it — a decision was
  // made, whether that meant changing an answer or agreeing with the one
  // offered. The last group counts on arrival, because there is nothing after
  // it to move to and a bar that can never fill is a bar nobody trusts.
  const finished = useMemo(() => {
    const out = new Set(done)
    if (paged && index === groups.length - 1) {
      const last = groups[index]
      if (last) out.add(last.id)
    }
    return out
  }, [done, paged, index, groups])

  const go = (to: number): void => {
    const next = Math.max(0, Math.min(groups.length - 1, to))
    const leaving = groups[index]
    const arriving = groups[next]
    if (!arriving) return
    const marked = new Set(done)
    if (next > index && leaving) marked.add(leaving.id)
    if (next === groups.length - 1) marked.add(arriving.id)
    onPlace?.({ at: arriving.id, done: [...marked] })
    // Back to the top of the screen, or "next" lands the user at the bottom of
    // a leaf they have not read a word of.
    topRef.current?.scrollIntoView({ block: 'start' })
  }

  const shown = paged ? (groups[index]?.questions ?? []) : questions

  return (
    <>
      <div ref={topRef} />

      {groups.length > 1 ? (
        <div className="pager-head">
          <span className="pager-where">
            {paged ? <b>{groups[index]?.label}</b> : null}
            <small>
              {finished.size} of {groups.length} checked
            </small>
          </span>
          <button type="button" onClick={() => setChosen(!(chosen ?? true))}>
            {paged ? 'Show them all at once' : 'One at a time'}
          </button>
        </div>
      ) : null}

      {groups.length > 1 ? (
        <div
          className="pager-bar"
          role="progressbar"
          aria-valuenow={finished.size}
          aria-valuemin={0}
          aria-valuemax={groups.length}
        >
          <i style={{ width: `${(finished.size / groups.length) * 100}%` }} />
        </div>
      ) : null}

      {shown.map((q) => (
        <QuestionView
          key={q.id}
          question={q}
          value={answers[q.id]}
          onChange={(v: AnswerValue) => onChange(q.id, v)}
          resolveEvidence={resolveEvidence}
          enlargeEvidence={enlargeEvidence}
        />
      ))}

      {paged ? (
        <div className="pager">
          <button type="button" disabled={index <= 0} onClick={() => go(index - 1)}>
            ‹ Back
          </button>
          <span className="pager-count">
            {index + 1} / {groups.length}
          </span>
          {index < groups.length - 1 ? (
            <button type="button" className="primary" onClick={() => go(index + 1)}>
              Next ›
            </button>
          ) : null}
        </div>
      ) : null}

      {children?.(atEnd)}
    </>
  )
}
