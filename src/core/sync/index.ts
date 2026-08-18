/**
 * Keeping a shelf of books in a git repository the user owns.
 *
 * Pure rules only — paths, limits, listings. The requests are in
 * `platform/browser/shelf`.
 */
export {
  MAX_SCAN_BYTES,
  SCAN_ROOT,
  SHELF_ROOT,
  aboutPath,
  bookPath,
  commitMessage,
  parseAbout,
  scanPath,
  scanRefusal,
  shelfEntries,
  shelfSlug,
  validRepo,
  type ShelfAbout,
  type ShelfConfig,
  type ShelfEntry
} from './shelf'
