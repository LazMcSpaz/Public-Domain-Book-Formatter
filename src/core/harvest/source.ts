/**
 * What a pass is told about the book it is reading.
 *
 * Shared by every model pass over a finished book, so that "first published in
 * 1662" reaches the annotation pass and the harvest as the same sentence. It
 * lives here rather than in either of them because it belongs to neither.
 */

/** Facts about the book that help a pass write about it. */
export interface BookFacts {
  title?: string
  author?: string
  /** When the original was published, which is what dates every reference in it. */
  originalYear?: string
  /** Anything the user told the app about the work at Gate 1. */
  context?: string
}
