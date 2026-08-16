/**
 * What the annotation pass will cost, before it runs.
 *
 * Same promise as the transcription estimate: the user approves a number rather
 * than discovering one, and the estimate errs high because coming in under is a
 * pleasant surprise and coming in over is a broken promise.
 *
 * This pass is much cheaper than the vision pass — no images, and the long half
 * of the prompt is cached across every chunk — which is worth showing plainly,
 * because "annotate the book" sounds like the expensive option and is not.
 */
import { pricingFor, type CostEstimate } from '@core/transcribe'
import { CHUNK_WORDS, OVERLAP_WORDS } from './prompt'
import { NOTES_PER_THOUSAND_WORDS, type NoteDensity } from './voice'

export interface AnnotationCostInputs {
  /** Words of body text to be annotated. */
  wordCount: number
  modelId: string
  density: NoteDensity
  /** Words per request. Defaults to the runner's own chunk size. */
  chunkWords?: number
  /** The voice card and instructions, which are cached. Default 1200. */
  systemTokens?: number
}

/** English runs about 1.35 tokens to the word, and old spelling a little more. */
const TOKENS_PER_WORD = 1.4
/** A note, its quoted anchor and its reason, as output tokens. */
const TOKENS_PER_NOTE = 90

export function estimateAnnotationCost(inputs: AnnotationCostInputs): CostEstimate {
  const { wordCount, modelId, density, chunkWords = CHUNK_WORDS, systemTokens = 1200 } = inputs

  const pricing = pricingFor(modelId)
  const chunks = Math.max(1, Math.ceil(wordCount / chunkWords))

  // Every chunk carries its own words plus the tail of the one before it.
  const bodyTokens = (wordCount + OVERLAP_WORDS * (chunks - 1)) * TOKENS_PER_WORD
  // The instruction is identical on every chunk, so it caches after the first;
  // counted at a tenth for the remainder rather than pretended to be free.
  const cachedSystem = systemTokens + systemTokens * 0.1 * (chunks - 1)
  const inputTokens = Math.round(bodyTokens + cachedSystem)

  const notes = (wordCount / 1000) * NOTES_PER_THOUSAND_WORDS[density]
  const outputTokens = Math.round(notes * TOKENS_PER_NOTE)

  const usd =
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok

  return {
    modelId,
    // No images in this pass; the field is kept so the estimate renders through
    // the same screen as the vision pass's.
    imageTokensPerPage: 0,
    pageCount: chunks,
    inputTokens,
    outputTokens,
    usd: round2(usd),
    // How much a book attracts depends far more on the book than the page count
    // does, so this range is wider than the vision pass's.
    usdLow: round2(usd * 0.5),
    usdHigh: round2(usd * 1.8)
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
