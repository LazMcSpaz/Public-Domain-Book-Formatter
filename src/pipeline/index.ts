/** Pipeline public surface (SPEC §3). */
export { runPipeline, DEFAULT_STAGES, type RunPipelineOptions } from './pipeline'
export type { PipelineContext, Stage } from './stage'
export { extractStage } from './stages/extract'
export { ocrStage, buildCoordinateMap } from './stages/ocr'
export { imageDetectStage } from './stages/image-detect'
export {
  cleanupStage,
  cleanupText,
  dehyphenate,
  normalizeLigatures,
  fixOcrConfusions,
  stripHeaderFooter,
  type CleanupResult
} from './stages/cleanup'
export { structureStage } from './stages/structure'
export { markdownStage, assembleMarkdown } from './stages/markdown'
