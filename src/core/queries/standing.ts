/**
 * A standing ruling's reach: which queries it would answer, held for the
 * editor to approve.
 *
 * A standing ruling answers a class rather than a spot — "British/American
 * spelling", "practiced / practised" — and names in `covers` the words it
 * settles. Until this file existed a query whose quote carried one of those
 * words was **settled silently**: `answerFor` returned the standing ruling,
 * `outstanding` dropped the query, and it never reached the gate or the
 * sheet. The editor ruled otherwise, in these words: _pre-filled and held_.
 * A query under a standing ruling arrives at the gate with the decision the
 * ruling would give already filled in, and it is filed only when a person
 * approves it — one at a time, or all at once by a button that says how
 * many. Never applied unasked.
 *
 * What changed is where the line sits, not what the ruling means. The
 * ruling is still the editor's, its `covers` are still explicit rather than
 * inferred, and a query it reaches is still going to be decided the way it
 * says nearly every time. What the editor gets back is the look: the leaf,
 * the words, and a moment to say "not this one" — which on the one book it
 * was measured against is the difference between a rule about `centre`
 * settling a query about `centre` and settling one about a sentence that
 * happened to contain it.
 *
 * Pure, and free of value imports on purpose: `ledger.ts` and the shelf
 * scripts load it under plain Node, which strips types and stops at the
 * first parameter property it meets further down the `@core/queries` chain.
 */
import type { RaisedQuery } from './index'
import type { Ruling } from './rulings'

/**
 * The standing ruling that reaches a query, if one does.
 *
 * Same kind, and one of the ruling's covered words inside the quote,
 * case-insensitively. A ruling with no covers reaches nothing, and an empty
 * cover is ignored rather than matching everything.
 */
export function standingFor(query: RaisedQuery, rulings: readonly Ruling[]): Ruling | null {
  const needle = query.quote.toLowerCase()
  return (
    rulings.find(
      (r) =>
        r.pageIndex === null &&
        r.kind === query.kind &&
        (r.covers ?? []).some((word) => word.trim() !== '' && needle.includes(word.toLowerCase()))
    ) ?? null
  )
}

/** A query and the standing ruling holding an answer for it. */
export interface HeldQuery {
  query: RaisedQuery
  ruling: Ruling
}

/**
 * The reasoning a held ruling carries when it is approved.
 *
 * Names the standing ruling and repeats its reasoning, so `rulings.md` says
 * where the decision came from rather than reading as though the editor
 * ruled on the spot from nothing.
 */
export function heldBecause(ruling: Ruling): string {
  const head = `Under the standing ruling “${ruling.quote}” (${ruling.decidedOn})`
  return ruling.because ? `${head}: ${ruling.because}` : `${head}.`
}
