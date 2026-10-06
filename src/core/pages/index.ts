/**
 * Page roles and front-matter handling (SPEC §7).
 */
export {
  ALL_PAGE_ROLES,
  dispositionFor,
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
  abbreviatedRange,
  isNumberLine,
  readReferences,
  readSynopsis,
  synopsisKey,
  synopsisLooksSound,
  type ContentsReference,
  type SynopsisBlock,
  type SynopsisEntry,
  type SynopsisSource
} from './synopsis'
