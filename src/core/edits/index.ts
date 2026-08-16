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
  withEdit,
  withCorrections,
  type BookEdit
} from './book-edits'
export {
  proofSheet,
  nextFlaggedPage,
  type ProofBlock,
  type ProofPage,
  type ProofSheetInput,
  type Attention
} from './proof-sheet'
