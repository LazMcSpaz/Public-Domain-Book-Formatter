/**
 * Corrections to an assembled book, held as a list and applied over it.
 *
 * The transcription is what the user paid for, so it is never rewritten: edits
 * are re-applied every time the book is assembled, the same way the image op
 * stack is re-applied over the original pixels.
 */
export {
  applyEdits,
  blockOf,
  countEdited,
  correctsTheBook,
  withEdit,
  withCorrections,
  HIGHLIGHT_TAGS,
  isHighlightTag,
  type BookEdit,
  type HighlightTag
} from './book-edits'
export {
  clearHighlight,
  highlightCounts,
  highlightSheet,
  highlightsOf,
  readingMarkdown,
  type AnchorState,
  type HighlightContext,
  type HighlightEdit
} from './highlights'
export {
  clearMemo,
  memoSheet,
  memosOf,
  openMemos,
  resolveMemo,
  type MemoContext,
  type MemoEdit
} from './memos'
export { htmlOfMarkup, markupOfNodes, plainOffsetOf, type RichNode } from './rich-text'
export { findMatches, sweepText, type SweepMatch } from './sweep'
export {
  proofSheet,
  nextFlaggedPage,
  type ProofBlock,
  type ProofPage,
  type ProofSheetInput,
  type Attention
} from './proof-sheet'
