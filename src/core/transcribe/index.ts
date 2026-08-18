/**
 * The vision pass: read each page against the scan, recover its structure, and
 * verify the result against evidence rather than against the model's opinion.
 */
export {
  BLOCK_KINDS,
  CELL_SEPARATOR,
  PAGE_SCHEMA,
  parsePageTranscription,
  parseTableText,
  tableToText,
  normalizeTable,
  normalizeMarkup,
  transcriptionText,
  checkableText,
  type PageTranscription,
  type TranscribedBlock,
  type BlockKind,
  type UncertainSpan,
  type PageFurniture,
  type ExtractedMetadata
} from './schema'
export {
  parseInlineMarkup,
  withMarkup,
  shiftEmphasis,
  wordCount,
  type InlineMarkup
} from './markup'
export {
  findDroppedRuns,
  healLineBreaks,
  spotId,
  spliceRun,
  spliceRunInto,
  type DroppedRun,
  type RunStrength,
  type SplicedBlock,
  type RecoverOptions
} from './recover'
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
  BATCH_DISCOUNT,
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
  API_BASE,
  apiHeaders,
  callModel,
  readMessage,
  throwIfFailed,
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
  API_BATCH_MAX_BYTES,
  API_BATCH_MAX_REQUESTS,
  BATCH_LIMITS,
  buildBatchRequest,
  cancelBatch,
  createBatch,
  customIdFor,
  fetchBatchResults,
  fits,
  pageIndexOf,
  parseBatchResults,
  parseBatchStatus,
  planBatches,
  retrieveBatch,
  sizeOfRequest,
  type BatchCounts,
  type BatchLimits,
  type BatchProcessingStatus,
  type BatchRequest,
  type BatchResults,
  type BatchStatus
} from './batch'
export {
  runTranscription,
  correctTerms,
  mergeMetadata,
  verifyRun,
  type PageSource,
  type RunOptions,
  type RunProgress,
  type RunResult,
  type PageFailure
} from './runner'
export { REPEATS_BEFORE_HALT, haltWatch, type HaltWatch } from './halt'
export type { OcrWordLike } from './types'
export { verifyBook, type VerifyBookOptions } from './verify-book'
