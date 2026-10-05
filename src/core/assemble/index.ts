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
  printedMarker,
  plainMarker,
  isFootnoteRunover,
  continueFootnote,
  startFootnote,
  type BookDocument,
  type BookBlock,
  type Footnote,
  type ChapterEntry,
  type BookSection,
  type Illustration,
  type IllustrationPlacement,
  type BareMark,
  type IllustrationSource
} from './assemble-book'
export { bookText } from './book-text'
export { folioRuns, leafOfFolio, type FolioRun } from './folios'
export {
  leafStart,
  seamsAfterMerge,
  seamsAfterRetyping,
  seamsAfterSplit,
  type Seam,
  type SplitHalf
} from './seams'
