/**
 * The vision pass: read each page against the scan, recover its structure, and
 * verify the result against evidence rather than against the model's opinion.
 */
export {
  PAGE_SCHEMA,
  parsePageTranscription,
  transcriptionText,
  type PageTranscription,
  type TranscribedBlock,
  type BlockKind,
  type UncertainSpan,
  type PageFurniture,
  type ExtractedMetadata
} from './schema'
export {
  buildSystemPrompt,
  buildPagePrompt,
  buildLexiconBlock,
  tailOf,
  type PromptOptions,
  type OrthographyPolicy
} from './prompt'
export {
  verifyPage,
  pagesNeedingReview,
  summarize,
  type VerificationFinding,
  type VerificationCode,
  type Severity,
  type VerifyOptions
} from './verify'
export {
  estimateCost,
  formatEstimate,
  imageTokensFor,
  pricingFor,
  MODELS,
  type CostEstimate,
  type CostInputs,
  type ModelPricing
} from './cost'
export {
  transcribePage,
  validateApiKey,
  buildRequestBody,
  TranscribeError,
  type ClientConfig,
  type Transport,
  type PageRequest,
  type PageResult,
  type ApiUsage
} from './client'
export {
  runTranscription,
  mergeMetadata,
  type PageSource,
  type RunOptions,
  type RunProgress,
  type RunResult,
  type PageFailure
} from './runner'
export type { OcrWordLike } from './types'
