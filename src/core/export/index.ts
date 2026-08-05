/**
 * Export: assembled book + style + edition details → compilable LaTeX, and the
 * swappable seam where that becomes a PDF.
 */
export {
  buildExport,
  editionFromAnswers,
  publicDomainNotice,
  safeFileName,
  type BuildExportInput,
  type BuildExportResult,
  type EditionDetails
} from './build-export'
export {
  noTexEngine,
  tryCompile,
  parseTexLog,
  pageCountFromLog,
  TexCompileError,
  type TexEngine,
  type TexCompileInput,
  type TexCompileResult
} from './tex-engine'
