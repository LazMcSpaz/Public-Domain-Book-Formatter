/**
 * Turning approved proposals into corrections the book already understands.
 *
 * There is deliberately no new machinery on this side. An accepted annotation
 * becomes exactly the `note` edit a user types by hand at the proof step, so
 * from here on the generated note and the hand-written one are the same thing:
 * placed by anchor, renumbered through the book, set at the foot of the page
 * its reference falls on, and collected as an endnote when it cannot be. The
 * generator's whole job is to write the text and find the spot.
 *
 * That also means an approved note is *undoable* and *editable* like any other
 * correction — it joins the same edit list, is saved with the run, and can be
 * removed later without the book having to be read again.
 *
 * Pure: proposals in, edits out.
 */
import type { BookEdit } from '@core/edits'
import type { CheckedProposal } from './schema'
import { withExemplar, type EditorVoice } from './voice'

/**
 * A proposal after the user has been through it.
 *
 * `text` is carried separately from the proposal because the user may have
 * rewritten the note before accepting it, and the rewritten version is the one
 * that goes in the book *and* the one worth learning the voice from.
 */
export interface AcceptedProposal {
  proposal: CheckedProposal
  /** The note as approved — the proposal's own text unless it was edited. */
  text: string
}

/**
 * Mint an id for a generated note.
 *
 * From the clock rather than counted, for the same reason the hand-written
 * notes are: a counted id gets reused once a note is removed, and a reused id
 * silently overwrites a different note in the saved edit list.
 */
function noteId(now: number, salt: number): string {
  return `an${now.toString(36)}${salt.toString(36).padStart(3, '0')}`
}

/**
 * Convert approved proposals into note edits.
 *
 * A proposal whose anchor was never found is skipped rather than placed at the
 * start of its block. The review screen shows those separately so the user can
 * put them where they belong by hand — a note attached to the wrong sentence
 * reads as an editor who did not understand the passage, which is worse than a
 * note that never made it in.
 */
export function proposalsToEdits(
  accepted: readonly AcceptedProposal[],
  options: { now?: number } = {}
): { edits: BookEdit[]; unplaced: CheckedProposal[] } {
  const now = options.now ?? Date.now()
  const edits: BookEdit[] = []
  const unplaced: CheckedProposal[] = []

  accepted.forEach(({ proposal, text }, i) => {
    const body = text.trim()
    if (!body) return
    if (proposal.at === null) {
      unplaced.push(proposal)
      return
    }
    edits.push({
      kind: 'note',
      noteId: noteId(now, i),
      blockId: proposal.blockId,
      at: proposal.at,
      text: body
    })
  })

  return { edits, unplaced }
}

/**
 * Teach the voice from what the user approved.
 *
 * Only notes the user *edited or accepted* reach here, which is what makes this
 * a signal rather than an echo: a note the model wrote and the user rewrote
 * teaches the voice the user actually wanted, and one they accepted untouched
 * confirms the voice already has it. Rejected notes teach nothing here on
 * purpose — "not this" is a much weaker instruction than "this", and a prompt
 * full of counter-examples reads as a list of things to think about.
 */
export function learnVoice(voice: EditorVoice, accepted: readonly AcceptedProposal[]): EditorVoice {
  return accepted.reduce(
    (v, { proposal, text }) => withExemplar(v, { passage: proposal.anchorText, note: text }),
    voice
  )
}
