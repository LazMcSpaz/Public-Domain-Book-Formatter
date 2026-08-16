/**
 * Save and resume.
 *
 * One thing in this app costs money: the vision pass, and it is saved because
 * losing it costs the user cash. Everything else is free to rebuild — but free
 * is not the same as quick, and reading a three-hundred-page scan again is ten
 * minutes of a phone's battery to arrive back where you were. So the reading is
 * cached too, under rules that discard it the moment it might not describe the
 * book any more (`recon-cache`): a run that cannot be trusted is worth nothing,
 * and unlike the transcription it costs only time to replace.
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
export {
  RECON_CACHE_VERSION,
  reconCacheUsable,
  reconStamp,
  type ReconStamp,
  type ReconWanted
} from './recon-cache'
