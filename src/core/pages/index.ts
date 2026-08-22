/**
 * Page roles and front-matter handling (SPEC §7).
 */
export {
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
  readSynopsis,
  synopsisKey,
  synopsisLooksSound,
  type SynopsisBlock,
  type SynopsisEntry
} from './synopsis'
