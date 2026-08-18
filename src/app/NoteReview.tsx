/**
 * Going through the notes the pass proposed.
 *
 * A gate, not a drip: every note at once, each with the passage it explains
 * beside it, and an accept-all for the common case where the pass did well.
 * Two hundred separate prompts would not be read, and a list with no evidence
 * beside it would be approved without being read, which is worse.
 *
 * Three things are shown that a plain list would leave out:
 *
 * - **The passage.** A note is only judgeable against the words it hangs on.
 * - **The claims the book never made.** Every date, figure and name the note
 *   asserts that the source text does not contain, called out in the note
 *   itself. This is the short list to check, and it is a deterministic
 *   comparison rather than the model's opinion of its own accuracy.
 * - **The notes that could not be placed.** Kept visible instead of dropped,
 *   with the reason, because a suggestion that silently vanished is
 *   indistinguishable from one that was never made.
 */
import { useMemo, useState } from 'react'
import type { BookDocument } from '@core/assemble'
import type { AcceptedProposal, CheckedProposal, IntroductionDraft } from '@core/annotate'

export interface NoteReviewProps {
  document: BookDocument
  proposals: readonly CheckedProposal[]
  /** The drafted introduction, if one was asked for. */
  introduction: IntroductionDraft | null
  onDone: (result: {
    accepted: AcceptedProposal[]
    introduction: { title: string; text: string } | null
  }) => void
  /** Chunks the pass could not read, so a gap is reported rather than implied. */
  failures?: readonly { chunkIndex: number; message: string }[]
}

const KIND_LABEL: Record<CheckedProposal['kind'], string> = {
  'archaic-word': 'word',
  person: 'person',
  place: 'place',
  measure: 'measure',
  'obsolete-science': 'old science',
  allusion: 'allusion',
  context: 'context',
  concept: 'concept'
}

/** How much of the block to show around the anchor. */
const CONTEXT_CHARS = 180

/**
 * The passage, cut around the words the note hangs on.
 *
 * The whole block would be a wall of text for a note about four words in the
 * middle of it, and the four words alone are not enough to judge whether the
 * note is right. A window either side is what a proofreader actually needs.
 */
function passageAround(
  blockText: string,
  at: number | null,
  anchor: string
): {
  before: string
  match: string
  after: string
} {
  if (at === null) return { before: '', match: anchor, after: '' }
  const start = Math.max(0, at - anchor.length)
  return {
    before:
      (start > CONTEXT_CHARS ? '… ' : '') +
      blockText.slice(Math.max(0, start - CONTEXT_CHARS), start),
    match: blockText.slice(start, at),
    after:
      blockText.slice(at, at + CONTEXT_CHARS) + (at + CONTEXT_CHARS < blockText.length ? ' …' : '')
  }
}

/** The note with its outside claims marked, so the eye goes straight to them. */
function markClaims(text: string, claims: readonly string[]): (string | JSX.Element)[] {
  if (claims.length === 0) return [text]
  // Longest first, so "New York" is marked whole rather than as "New" plus a
  // stray word.
  const pattern = [...claims]
    .sort((a, b) => b.length - a.length)
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('|')
  const parts = text.split(new RegExp(`(${pattern})`, 'gu'))
  return parts.map((part, i) =>
    claims.some((c) => c === part) ? (
      <mark key={i} className="claim">
        {part}
      </mark>
    ) : (
      part
    )
  )
}

export function NoteReview({
  document: doc,
  proposals,
  introduction,
  onDone,
  failures = []
}: NoteReviewProps) {
  const placeable = useMemo(() => proposals.filter((p) => p.at !== null), [proposals])
  const unplaced = useMemo(() => proposals.filter((p) => p.at === null), [proposals])

  // Every note starts accepted. The pass is expected to be mostly right, and
  // starting from "none" would mean the user's work is proportional to the
  // pass's success rather than to its failures.
  const [rejected, setRejected] = useState<ReadonlySet<number>>(new Set())
  const [texts, setTexts] = useState<Record<number, string>>({})
  const [introText, setIntroText] = useState(introduction?.text ?? '')
  const [introTitle, setIntroTitle] = useState(introduction?.title ?? 'Introduction')
  const [keepIntro, setKeepIntro] = useState(introduction !== null)

  const blockText = useMemo(() => new Map(doc.blocks.map((b) => [b.id, b.text])), [doc.blocks])

  const toggle = (i: number): void =>
    setRejected((set) => {
      const next = new Set(set)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const keptCount = placeable.length - rejected.size

  const finish = (): void => {
    const accepted: AcceptedProposal[] = placeable
      .map((proposal, i) => ({ proposal, text: texts[i] ?? proposal.text, index: i }))
      .filter(({ index }) => !rejected.has(index))
      .map(({ proposal, text }) => ({ proposal, text }))

    onDone({
      accepted,
      introduction:
        keepIntro && introText.trim()
          ? { title: introTitle.trim() || 'Introduction', text: introText }
          : null
    })
  }

  return (
    <div className="notes">
      <div className="notes-bar">
        <b>
          {keptCount} of {placeable.length} note{placeable.length === 1 ? '' : 's'} going in
        </b>
        <span className="notes-actions">
          <button type="button" onClick={() => setRejected(new Set())}>
            Keep all
          </button>
          <button type="button" onClick={() => setRejected(new Set(placeable.map((_, i) => i)))}>
            Drop all
          </button>
        </span>
      </div>

      <p className="help">
        Anything <mark className="claim">marked</mark> is a date, figure or name the book itself
        never gave — the editor’s own assertion, and the part worth checking. Edit a note to change
        what it says; drop it to leave it out.
      </p>

      {introduction ? (
        <div className={`notes-intro${keepIntro ? '' : ' dropped'}`}>
          <div className="notes-head">
            <input
              type="text"
              value={introTitle}
              aria-label="Title of the introduction"
              onChange={(e) => setIntroTitle(e.target.value)}
            />
            <button type="button" onClick={() => setKeepIntro((k) => !k)}>
              {keepIntro ? 'Drop it' : 'Keep it'}
            </button>
          </div>
          {introduction.outsideClaims.length > 0 ? (
            <p className="notes-claims">
              To check: {introduction.outsideClaims.slice(0, 20).join(', ')}
            </p>
          ) : null}
          <textarea
            value={introText}
            aria-label="The introduction"
            rows={Math.min(30, Math.max(8, introText.split('\n').length + 4))}
            onChange={(e) => setIntroText(e.target.value)}
          />
        </div>
      ) : null}

      {placeable.map((proposal, i) => {
        const text = texts[i] ?? proposal.text
        const isOut = rejected.has(i)
        const passage = passageAround(
          blockText.get(proposal.blockId) ?? '',
          proposal.at,
          proposal.anchorText
        )
        return (
          <div key={`${proposal.blockId}-${i}`} className={`note${isOut ? ' dropped' : ''}`}>
            <div className="note-passage">
              <span className="muted">{passage.before}</span>
              <b>{passage.match}</b>
              <span className="muted">{passage.after}</span>
            </div>
            <div className="note-body">
              <div className="note-head">
                <span className="note-kind">{KIND_LABEL[proposal.kind]}</span>
                {proposal.reason ? <span className="note-why">{proposal.reason}</span> : null}
                <button type="button" onClick={() => toggle(i)}>
                  {isOut ? 'Keep' : 'Drop'}
                </button>
              </div>
              <p className="note-text">{markClaims(text, proposal.outsideClaims)}</p>
              <textarea
                value={text}
                aria-label={`Note on “${proposal.anchorText}”`}
                rows={Math.max(2, Math.ceil(text.length / 80))}
                onChange={(e) => setTexts((t) => ({ ...t, [i]: e.target.value }))}
              />
            </div>
          </div>
        )
      })}

      {unplaced.length > 0 ? (
        <div className="notes-unplaced">
          <b>{unplaced.length} note(s) could not be attached to a passage.</b>
          <p className="help">
            The words each one quoted were not found in the block it named, so there is no reliable
            place to hang it. They are shown here rather than dropped quietly — you can add any of
            them yourself at the proof step.
          </p>
          <ul>
            {unplaced.map((p, i) => (
              <li key={i}>
                <i>“{p.anchorText}”</i> — {p.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {failures.length > 0 ? (
        <p className="notes-failures">
          {failures.length} stretch(es) of the book could not be read for notes (
          {failures[0]!.message}
          ).{' '}
          {/* Never "the rest was annotated normally" when there is no rest to
              speak of. A real book ended this pass with every stretch failing
              on a spent credit balance and this line told the user the book had
              been annotated — under a heading reading "0 of 0 notes going in". */}
          {proposals.length > 0
            ? 'The rest of the book was annotated normally.'
            : 'Nothing else came back either, so this is the whole of what the pass produced. ' +
              'Coming back to this step offers to read the stretches that were missed.'}
        </p>
      ) : null}

      <div className="actions">
        <button type="button" className="primary" onClick={finish}>
          {keptCount > 0 || (keepIntro && introText.trim())
            ? 'Add these and continue'
            : 'Continue without them'}
        </button>
      </div>
    </div>
  )
}
