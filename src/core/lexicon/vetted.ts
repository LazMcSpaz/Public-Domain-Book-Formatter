/**
 * What the user decided about the book's vocabulary, made to count.
 *
 * Gate 1 shows the harvested terms with their pixels and asks for a verdict on
 * each, promising in its own help text that "confirming a word here fixes it
 * everywhere in the book". Until this module existed the answer was read by
 * nothing. The raw harvest went to the model under the heading "these spellings
 * have been confirmed as correct for this book" — which was not true of any of
 * them, and was actively wrong for the ones the user had just marked as OCR
 * noise. Rejecting a word made the app insist on it.
 *
 * Three verdicts, three different jobs:
 *
 * - **accept** — a real word of this book. Goes to the model as vocabulary,
 *   which is the single most effective defence against `chirurgeon` being
 *   "corrected" into `surgeon`.
 * - **correct** — OCR misread it, and the user says what it should be. The
 *   *corrected* form goes to the model, and the misreading is replaced in the
 *   text the model returns, because a vision model reading the same smudge can
 *   land on the same wrong answer.
 * - **ignore** — not a word at all. Dropped from the prompt entirely. This is
 *   the verdict that was doing harm.
 *
 * Pure: verdicts in, a vetted lexicon and a correction list out.
 */
import type { LexiconEntry } from './build-lexicon'

/**
 * One verdict from the term grid, structurally.
 *
 * Not imported from `@core/wizard` on purpose: the wizard already imports this
 * module, and the shape is three fields. Matching it structurally keeps the
 * dependency pointing one way.
 */
export interface TermDecision {
  action: 'accept' | 'correct' | 'ignore'
  /** The right reading, when the action is `correct`. */
  text?: string
}

/** A misreading and what it should have been. */
export interface TermCorrection {
  from: string
  to: string
}

export interface VettedLexicon {
  /** What the model is told this book's vocabulary is. */
  entries: LexiconEntry[]
  /** Replacements to make in what the model returns. */
  corrections: TermCorrection[]
  /** Terms the user rejected, kept for the report rather than silently dropped. */
  ignored: string[]
}

/**
 * Apply the gate's verdicts to the harvested lexicon.
 *
 * A term with no verdict is accepted: the grid defaults every row to `accept`,
 * so an unanswered row and an accepted one mean the same thing, and treating
 * silence as rejection would quietly strip the vocabulary of anyone who pressed
 * continue.
 */
export function vetLexicon(
  lexicon: readonly LexiconEntry[],
  verdicts: Readonly<Record<string, TermDecision>> = {}
): VettedLexicon {
  const entries: LexiconEntry[] = []
  const corrections: TermCorrection[] = []
  const ignored: string[] = []

  for (const entry of lexicon) {
    const verdict = verdicts[entry.term]
    if (!verdict || verdict.action === 'accept') {
      entries.push(entry)
      continue
    }
    if (verdict.action === 'ignore') {
      ignored.push(entry.term)
      continue
    }

    const to = (verdict.text ?? '').trim()
    // "Correct it to itself", or to nothing, is an accept with extra steps.
    if (!to || to === entry.term) {
      entries.push(entry)
      continue
    }
    corrections.push({ from: entry.term, to })
    // The corrected spelling is what the book actually says, so that is what
    // the model should be told to expect — and its variants are now wrong.
    entries.push({ ...entry, term: to, variants: [] })
  }

  return { entries, corrections, ignored }
}

/**
 * Whether a character continues a word for the purposes of matching.
 *
 * Letters, digits and hyphens do; apostrophes deliberately do not. That one
 * choice is what lets `rn0ther’s` be corrected to `mother’s` — the commonest
 * shape a term takes in running prose after its bare form. Hyphens are kept as
 * word characters because a hyphenated compound is usually a *different* word
 * and correcting half of it would be worse than leaving it.
 *
 * The cost is that a term which is also the stem of a contraction could match
 * inside one. These terms are unusual words by construction — that is why they
 * were harvested — so the exposure is small, and the possessive is not.
 */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}-]/u.test(ch)
}

/**
 * Replace whole-word occurrences of each misreading.
 *
 * Whole-word and not a plain substring swap, because a correction applied
 * loosely would rewrite the inside of every other word on the page:
 * `chirurgeon’s` is matched and corrected, while `chirurgeonry` — a different
 * word — is left alone. See `isWordChar` above for where that boundary falls.
 *
 * Case is followed rather than forced: a misreading that appears capitalised at
 * the start of a sentence is replaced with a capitalised correction, because
 * the alternative is a lower-case word after a full stop.
 */
export function applyTermCorrections(
  text: string,
  corrections: readonly TermCorrection[]
): { text: string; replaced: number } {
  let out = text
  let replaced = 0

  for (const { from, to } of corrections) {
    if (!from) continue
    let next = ''
    let i = 0
    while (i < out.length) {
      const at = out.indexOf(from, i)
      if (at === -1) {
        next += out.slice(i)
        break
      }
      const before = out[at - 1]
      const after = out[at + from.length]
      if (isWordChar(before) || isWordChar(after)) {
        // Inside a longer word — not this term.
        next += out.slice(i, at + from.length)
        i = at + from.length
        continue
      }
      next += out.slice(i, at) + to
      replaced += 1
      i = at + from.length
    }
    out = next

    // The same word at the start of a sentence, capitalised.
    const capFrom = from.charAt(0).toUpperCase() + from.slice(1)
    if (capFrom !== from) {
      const capTo = to.charAt(0).toUpperCase() + to.slice(1)
      const result = applyTermCorrections(out, [{ from: capFrom, to: capTo }])
      out = result.text
      replaced += result.replaced
    }
  }

  return { text: out, replaced }
}
