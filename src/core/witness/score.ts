/**
 * Scoring a witness: is what it raises worth a person's time?
 *
 * A second reader earns its place if its disagreements with the first are
 * mostly real errors and it catches a meaningful share of them — the plan's
 * rule, which is this repository's standing rule about checks nobody can
 * score. Given the first reader's text, the witness's text and the proofed
 * text of the same leaf, this says how many places the two readers disagree
 * (what the editor would be handed), how many of those sit on a word the
 * first reader in fact got wrong (precision), how many of the first reader's
 * real errors fall inside a disagreement (recall), and — written down rather
 * than hidden — how many errors both readers made alike, which no witness
 * can find.
 *
 * Spans are in the first reader's word sequence, which is the one thing all
 * three comparisons share; a disagreement and an error overlap when their
 * spans do, an empty span standing for the one word it points at.
 *
 * Pure: no DOM, no I/O, no network.
 */
import { compareWitnesses, type Disagreement } from './index'

export interface WitnessScore {
  /** Words the first reader read. */
  words: number
  /** Substantive disagreements between the two readers — what the editor would look at. */
  raised: number
  /** Of those, how many sit on a word the first reader got wrong. */
  hits: number
  /** Substantive disagreements between the first reader and the proofed text. */
  errors: number
  /** Of those, how many fall inside something the witness raised. */
  caught: number
  /** Errors both readers made alike; no witness can find these. */
  missed: number
  /** `hits / raised`, or null when nothing was raised. */
  precision: number | null
  /** `caught / errors`, or null when the first reader made no error. */
  recall: number | null
  /** The witness's own agreement with the proofed text, for the record. */
  witnessErrors: number
}

interface Span {
  from: number
  to: number
}

function spanOf(d: Disagreement): Span {
  const n = d.first.split(/\s+/u).filter(Boolean).length
  return { from: d.at, to: d.at + Math.max(1, n) }
}

function overlaps(a: Span, b: Span): boolean {
  return a.from < b.to && b.from < a.to
}

const substantive = (report: { disagreements: Disagreement[] }): Span[] =>
  report.disagreements.filter((d) => d.kind === 'substantive').map(spanOf)

/**
 * Two witnesses together: how much of the first reader's real error either
 * one raises. A book with an OCR layer and an engine has both, and what the
 * editor is handed is the union.
 */
export function scoreWitnesses(
  first: string,
  witnesses: readonly string[],
  truth: string
): { errors: number; caught: number; raised: number; recall: number | null } {
  const errors = substantive(compareWitnesses(first, truth))
  const raisedAll = witnesses.flatMap((w) => substantive(compareWitnesses(first, w)))
  const caught = errors.filter((e) => raisedAll.some((r) => overlaps(r, e))).length
  // Raised, counted once per place: two witnesses pointing at one word are
  // one thing to look at.
  const places = new Set<number>()
  for (const r of raisedAll) for (let i = r.from; i < r.to; i++) places.add(i)
  return {
    errors: errors.length,
    caught,
    raised: places.size,
    recall: errors.length ? caught / errors.length : null
  }
}

export function scoreWitness(first: string, witness: string, truth: string): WitnessScore {
  const against = compareWitnesses(first, truth)
  const between = compareWitnesses(first, witness)
  const errors = substantive(against)
  const raised = substantive(between)
  const hits = raised.filter((r) => errors.some((e) => overlaps(r, e))).length
  const caught = errors.filter((e) => raised.some((r) => overlaps(r, e))).length
  return {
    words: against.words,
    raised: raised.length,
    hits,
    errors: errors.length,
    caught,
    missed: errors.length - caught,
    precision: raised.length === 0 ? null : hits / raised.length,
    recall: errors.length === 0 ? null : caught / errors.length,
    witnessErrors: compareWitnesses(witness, truth).needEyes
  }
}
