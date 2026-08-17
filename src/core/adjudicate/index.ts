/**
 * The second reading: look again at the places the checks flagged, with the
 * scan in hand, before any of them reach a person.
 *
 * Narrow by construction — only flagged leaves, only flagged spots, one
 * question each: *what does the page say here?* It never asks whether the
 * earlier reading was right (SPEC §4: a model's opinion of its own output is
 * worth nothing) and it never writes text without pixels behind it.
 *
 * Its answers are recommendations carrying the reading they rest on. They
 * pre-fill the gate; they never empty it.
 */
export {
  ADJUDICATION_SCHEMA,
  SPOT_VERDICTS,
  parseAdjudication,
  type AdjudicatedSpot,
  type LeafToCheck,
  type SpotToCheck,
  type SpotVerdict
} from './schema'
export { buildAdjudicationPrompt, buildAdjudicationSystemPrompt } from './prompt'
export {
  buildAdjudicationBody,
  describeAdjudication,
  runAdjudication,
  type AdjudicateFailure,
  type AdjudicateOptions,
  type AdjudicateProgress,
  type AdjudicateResult
} from './runner'
export { TYPICAL_FLAG_RATE, estimateAdjudicationCost, type AdjudicationCostInputs } from './cost'
