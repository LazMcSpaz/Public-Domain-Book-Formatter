/**
 * Keeping a shelf of books in a git repository the user owns.
 *
 * Pure rules only — paths, limits, listings. The requests are in
 * `platform/browser/shelf`.
 */
export {
  IMPRINT_ROOT,
  HOUSE_LOOK_PATH,
  IMAGE_ROOT,
  MAX_SCAN_BYTES,
  SCAN_ROOT,
  SHELF_ROOT,
  VOICE_ROOT,
  aboutPath,
  queryCropPath,
  queriesPath,
  rulingsPath,
  bookFolder,
  insideFolder,
  sheetNeedsBook,
  sheetPath,
  sheetRefusal,
  workFileRefusal,
  bookPath,
  houseLookPath,
  imagePath,
  pictureCandidates,
  commitMessage,
  parseAbout,
  scanPath,
  scanRefusal,
  shelfEntries,
  shelfSlug,
  validRepo,
  voicePath,
  type ShelfAbout,
  type ShelfConfig,
  type ShelfEntry,
  type ShelfQueries
} from './shelf'
export {
  shelfProgress,
  shelfTitle,
  shelfTitleParts,
  type ShelfProgress,
  type ShelfStage
} from './progress'
export {
  commutes,
  entriesBetween,
  isRuling,
  landedRulings,
  mergeOutbox,
  rulingsMissingFrom,
  summarize,
  type EditEntry,
  type MergeResult,
  type OutboxConflict,
  type OutboxEntry,
  type OutboxSummary,
  type RulingEntry,
  type ShelfState
} from './outbox'
export {
  foldIntoBookText,
  layoutOf,
  withQueued,
  writeInLayout,
  type FoldedBookText,
  type JsonLayout
} from './fold'
export { canonicalJson, equalEdit, equalEntry, equalRuling, readEdit, readRuling } from './same'
export {
  booksNeedingRecon,
  hasReadableScan,
  newReconQueue,
  parseReconQueue,
  pickedByDefault,
  queueFailed,
  queueFinished,
  queueMove,
  queueRemaining,
  queueRemove,
  type ReconQueueFailure,
  type ReconQueueState
} from './recon-queue'
export {
  MAX_OBJECT_BYTES,
  STORAGE_BUCKET,
  STORAGE_COLUMNS,
  STORAGE_LIST,
  TEST_KIND,
  addStorageRow,
  extensionOf,
  fingerprintOf,
  isTestKey,
  parseStorageList,
  serializeStorageList,
  storageKey,
  stripBom,
  type AddResult,
  type StorageRow
} from './storage'
export {
  MAX_SHELF_PATH,
  NO_BOOK,
  RUNS_ROOT,
  WORK_ROOT,
  bookFolderProblem,
  linkLabel,
  runIdOfPath,
  runIdProblem,
  runsMonthPath,
  shelfPathProblem,
  statusNotePath,
  type NoteName
} from './work-paths'
