/**
 * What a second reading costs.
 *
 * Quoted before it runs, like every other spend in this app. The number is
 * small and that is the point of the design — it is what makes "check the
 * flagged spots again" a reasonable thing to offer rather than a second full
 * price.
 *
 * The estimate has one genuinely uncertain input: how many leaves the checks
 * will flag, which is not known until the book has been read. So it is quoted
 * as a rate against a stated assumption rather than as a figure pretending to
 * be measured, and the *actual* spend is reported afterwards from the usage the
 * run returns.
 */
import { imageTokensFor, pricingFor, type CostEstimate } from '@core/transcribe'

export interface AdjudicationCostInputs {
  /** Leaves that will be checked. */
  leafCount: number
  modelId: string
  /** Long edge of the image sent. The dominant term. */
  imageLongEdge?: number
  /** Prompt tokens per leaf beyond the image — the spots and the page text. */
  promptTokensPerLeaf?: number
  /** Expected reply size per leaf. */
  outputTokensPerLeaf?: number
  /** Shared system prompt, cached after the first leaf. */
  systemTokens?: number
}

/**
 * A share of a book's leaves that a typical scan flags.
 *
 * Used only where the real count is not known yet — at the gate, before the
 * book has been read. Stated in the question rather than hidden, because a
 * quote resting on a guess should say so.
 */
export const TYPICAL_FLAG_RATE = 0.2

export function estimateAdjudicationCost(inputs: AdjudicationCostInputs): CostEstimate {
  const {
    leafCount,
    modelId,
    imageLongEdge = 1568,
    promptTokensPerLeaf = 500,
    outputTokensPerLeaf = 400,
    systemTokens = 350
  } = inputs

  const pricing = pricingFor(modelId)
  const imageTokensPerPage = imageTokensFor(imageLongEdge)

  const cachedSystem = systemTokens + systemTokens * 0.1 * Math.max(0, leafCount - 1)
  const inputTokens = Math.round(
    leafCount * (imageTokensPerPage + promptTokensPerLeaf) + cachedSystem
  )
  const outputTokens = Math.round(leafCount * outputTokensPerLeaf)

  const usd =
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok

  const round2 = (n: number): number => Math.round(n * 100) / 100
  return {
    modelId,
    pageCount: leafCount,
    imageTokensPerPage,
    inputTokens,
    outputTokens,
    usd: round2(usd),
    // Wider than the transcription's range: the number of spots per leaf varies
    // far more than the density of a page does.
    usdLow: round2(usd * 0.6),
    usdHigh: round2(usd * 1.6)
  }
}
