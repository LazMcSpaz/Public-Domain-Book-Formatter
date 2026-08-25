/**
 * Assembly: per-page transcriptions into one book document, with page seams
 * repaired and front matter handled per its disposition.
 */
export {
  assembleBook,
  deriveChapters,
  headingRunEnd,
  shouldJoin,
  joinText,
  bookWordCount,
  seamCount,
  stripSoftHyphens,
  footnoteMarkerPattern,
  stripLeadingMarker,
  type BookDocument,
  type BookBlock,
  type Footnote,
  type ChapterEntry,
  type BookSection,
  type Illustration,
  type IllustrationSource
} from './assemble-book'
