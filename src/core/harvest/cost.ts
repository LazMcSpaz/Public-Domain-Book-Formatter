/**
 * What a harvest costs, on each of the two paths it can take.
 *
 * The two numbers are the whole reason this file exists as its own thing: they
 * are what makes the choice between "annotate and harvest together" and
 * "harvest alone" an informed one. Riding the annotation pass pays for output
 * tokens only, because the book is already being read and the instruction is
 * cached; harvesting alone pays to read the book as well. The difference is
 * usually most of an order of magnitude, and a user who cannot see that will
 * assume the two cost the same.
 */
import { pricingFor } from '@core/transcribe'
import { CHUNK_WORDS, OVERLAP_WORDS } from './chunk'
import { FACTS_PER_THOUSAND_WORDS, type HarvestDepth } from './prompt'

export interface HarvestCost {
  usd: number
  usdLow: number
  usdHigh: number
  inputTokens: number
  outputTokens: number
}

export interface HarvestCostInputs {
  wordCount: number
  modelId: string
  depth: HarvestDepth
  /**
   * True when the harvest pays to read the book itself, false when it rides an
   * annotation pass that is already reading it.
   */
  standalone: boolean
  chunkWords?: number
}

const TOKENS_PER_WORD = 1.4
/** Entries are written at length on purpose, so they are dear apiece. */
const TOKENS_PER_FACT = 260
/** The harvest instruction and the tag vocabulary, cached after chunk one. */
const INSTRUCTION_TOKENS = 1400

export function estimateHarvestCost(inputs: HarvestCostInputs): HarvestCost {
  const chunkWords = inputs.chunkWords ?? CHUNK_WORDS
  const chunks = Math.max(1, Math.ceil(inputs.wordCount / chunkWords))
  const cachedInstruction = INSTRUCTION_TOKENS + INSTRUCTION_TOKENS * 0.1 * (chunks - 1)

  const inputTokens = Math.round(
    inputs.standalone
      ? (inputs.wordCount + OVERLAP_WORDS * (chunks - 1)) * TOKENS_PER_WORD + cachedInstruction
      : cachedInstruction
  )
  const entries = (inputs.wordCount / 1000) * FACTS_PER_THOUSAND_WORDS[inputs.depth]
  const outputTokens = Math.round(entries * TOKENS_PER_FACT)

  const price = pricingFor(inputs.modelId)
  const usd =
    (inputTokens / 1_000_000) * price.inputPerMTok +
    (outputTokens / 1_000_000) * price.outputPerMTok

  const round2 = (n: number): number => Math.round(n * 100) / 100
  return {
    inputTokens,
    outputTokens,
    usd: round2(usd),
    // How much a book yields depends far more on the book than on its length.
    usdLow: round2(usd * 0.5),
    usdHigh: round2(usd * 1.8)
  }
}
