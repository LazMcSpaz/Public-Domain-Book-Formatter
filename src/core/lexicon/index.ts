/**
 * Book lexicon: harvest the work's own vocabulary so the model pass reads it
 * on the book's terms rather than modern English's (SPEC §4).
 */
export {
  buildLexicon,
  lexiconPromptBlock,
  normalizeToken,
  editDistance,
  type LexiconToken,
  type LexiconEntry,
  type LexiconSignal,
  type BuildLexiconOptions
} from './build-lexicon'
export { isCommonWord, COMMON_WORDS } from './common-words'
