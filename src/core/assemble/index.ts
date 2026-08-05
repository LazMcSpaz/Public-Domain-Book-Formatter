/**
 * Assembly: per-page transcriptions into one book document, with page seams
 * repaired and front matter handled per its disposition.
 */
export {
  assembleBook,
  shouldJoin,
  joinText,
  bookWordCount,
  seamCount,
  stripSoftHyphens,
  type BookDocument,
  type BookBlock,
  type Footnote,
  type ChapterEntry
} from './assemble-book'
