/**
 * Save and resume.
 *
 * One thing in this app costs money: the vision pass. Everything else —
 * rendering, OCR, the lexicon, assembly, layout, the PDF — is free and
 * repeatable. So the saved unit is the paid run, keyed to the file it came
 * from, and reopening a book redoes the free half rather than storing it.
 */
export {
  CURRENT_SCHEMA_VERSION,
  createSavedRun,
  describeAge,
  fileKey,
  parseFileKey,
  keyMatchesFile,
  migrateSavedRun,
  summarize,
  type SavedFailure,
  type SavedRun,
  type SavedRunSummary,
  type SavedUsage
} from './saved-run'
