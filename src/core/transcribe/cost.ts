/**
 * Cost estimation for the vision pass.
 *
 * Shown before a run starts, because a whole-book pass costs real money and the
 * user should approve a number rather than discover one. Deliberately errs on
 * the high side: an estimate that comes in under is a pleasant surprise, one
 * that comes in over is a broken promise.
 */

/** Per-million-token prices, USD. */
export interface ModelPricing {
  id: string
  label: string
  inputPerMTok: number
  outputPerMTok: number
}

export const MODELS: readonly ModelPricing[] = [
  {
    id: 'claude-opus-5',
    label: 'Claude Opus — highest quality',
    inputPerMTok: 5,
    outputPerMTok: 25
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet — balanced',
    inputPerMTok: 3,
    outputPerMTok: 15
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku — cheapest',
    inputPerMTok: 1,
    outputPerMTok: 5
  }
]

export function pricingFor(modelId: string): ModelPricing {
  return MODELS.find((m) => m.id === modelId) ?? MODELS[0]!
}

export interface CostInputs {
  pageCount: number
  modelId: string
  /**
   * Long edge of the page image sent to the model. Image tokens scale with
   * area, and this is the biggest lever on input cost.
   */
  imageLongEdge?: number
  /** Rough OCR text tokens per page. Default 700. */
  ocrTokensPerPage?: number
  /** Expected output tokens per page. Default 1400. */
  outputTokensPerPage?: number
  /** Shared system prompt size; cached after the first page. Default 900. */
  systemTokens?: number
  /**
   * Whether this is going through the Message Batches API, which bills at half.
   *
   * A real halving of the bill, not a rounding — which is why it is shown at
   * the gate beside the immediate price rather than mentioned afterwards. On a
   * three-hundred-page book it is the difference between two numbers a person
   * would answer differently.
   */
  batch?: boolean
}

/** What the Batches API takes off the bill. */
export const BATCH_DISCOUNT = 0.5

export interface CostEstimate {
  modelId: string
  pageCount: number
  imageTokensPerPage: number
  inputTokens: number
  outputTokens: number
  /** Midpoint estimate in USD. */
  usd: number
  /** Honest range, accounting for how variable page density is. */
  usdLow: number
  usdHigh: number
}

/**
 * Anthropic bills images roughly by area. ~750 tokens at 1000px on the long
 * edge, scaling with the square of the dimension, capped at the documented
 * high-resolution ceiling.
 */
export function imageTokensFor(longEdge: number): number {
  const MAX_IMAGE_TOKENS = 4784
  const tokens = Math.round(750 * (longEdge / 1000) ** 2)
  return Math.min(MAX_IMAGE_TOKENS, Math.max(200, tokens))
}

export function estimateCost(inputs: CostInputs): CostEstimate {
  const {
    pageCount,
    modelId,
    imageLongEdge = 1568,
    ocrTokensPerPage = 700,
    outputTokensPerPage = 1400,
    systemTokens = 900
  } = inputs

  const pricing = pricingFor(modelId)
  const imageTokensPerPage = imageTokensFor(imageLongEdge)

  // The system prompt is identical on every page, so it caches after page one;
  // count it at a tenth for the remainder rather than pretending it's free.
  const cachedSystem = systemTokens + systemTokens * 0.1 * Math.max(0, pageCount - 1)
  const inputTokens = Math.round(pageCount * (imageTokensPerPage + ocrTokensPerPage) + cachedSystem)
  const outputTokens = Math.round(pageCount * outputTokensPerPage)

  const rate = inputs.batch ? BATCH_DISCOUNT : 1
  const usd =
    ((inputTokens / 1_000_000) * pricing.inputPerMTok +
      (outputTokens / 1_000_000) * pricing.outputPerMTok) *
    rate

  return {
    modelId,
    pageCount,
    imageTokensPerPage,
    inputTokens,
    outputTokens,
    usd: round2(usd),
    // Page density varies a lot between a title page and dense body text.
    usdLow: round2(usd * 0.65),
    usdHigh: round2(usd * 1.45)
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** "about $12 (range $8–$17)" for the confirmation screen. */
export function formatEstimate(e: CostEstimate): string {
  return `about $${e.usd.toFixed(2)} (range $${e.usdLow.toFixed(2)}–$${e.usdHigh.toFixed(2)})`
}
