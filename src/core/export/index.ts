/**
 * Export: the edition details only the user can supply, folded into the book,
 * plus the honest report about what came out.
 */
export {
  buildExport,
  editionFromAnswers,
  publicDomainNotice,
  ANNOTATED_NOTICE,
  safeFileName,
  type BuildExportInput,
  type BuildExportResult,
  type EditionDetails
} from './build-export'
