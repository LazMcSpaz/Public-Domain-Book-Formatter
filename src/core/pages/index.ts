/**
 * Page roles and front-matter handling (SPEC §7).
 */
export {
  readAnalyticalContents,
  analyticalLooksSound,
  analyticalKey,
  folioToLeaf,
  type FolioSighting,
  type AnalyticalTopic,
  type AnalyticalGroup,
  type AnalyticalBlock
} from './analytical'

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
  isNumberLine,
  readSynopsis,
  synopsisKey,
  synopsisLooksSound,
  type SynopsisBlock,
  type SynopsisEntry
} from './synopsis'
