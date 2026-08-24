/**
 * Keeping a shelf of books in a git repository the user owns.
 *
 * Pure rules only — paths, limits, listings. The requests are in
 * `platform/browser/shelf`.
 */
export {
  IMAGE_ROOT,
  MAX_SCAN_BYTES,
  SCAN_ROOT,
  SHELF_ROOT,
  VOICE_ROOT,
  aboutPath,
  queriesPath,
  rulingsPath,
  bookPath,
  imagePath,
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
  type ShelfEntry
} from './shelf'
