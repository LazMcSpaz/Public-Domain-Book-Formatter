/**
 * Page roles and front-matter handling (SPEC §7).
 */
export {
  dispositionFor,
  ALL_PAGE_ROLES,
  isFrontMatter,
  roleLabel,
  emptyBookMetadata,
  strippedFurniture,
  partitionByDisposition,
  type PageRole,
  type PageDisposition,
  type BookMetadata,
  type PageClassification
} from './page-roles'
export {
  isNumberLine,
  readSynopsis,
  synopsisKey,
  synopsisLooksSound,
  type SynopsisBlock,
  type SynopsisEntry
} from './synopsis'
