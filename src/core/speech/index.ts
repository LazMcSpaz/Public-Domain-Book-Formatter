/**
 * Preparing a book's text to be read aloud.
 *
 * Everything here happens before a voice sees a word, and all of it is pure:
 * what a chapter number is called, and which words this shelf uses that an
 * English phonemizer gets wrong. The synthesis itself is not here and should
 * not be — it needs a couple of hundred megabytes of runtime and a real
 * processor, and it runs off the device entirely.
 */
export { romanValue, spellNumber, speakHeadingNumbers } from './roman'
export {
  applyPronunciations,
  pronunciationsIn,
  checkPronunciations,
  type Pronunciation,
  type PronunciationDrift
} from './pronounce'
export {
  readChapter,
  chapterBlocks,
  chapterNotes,
  expectedSeconds,
  withoutSilentMarks,
  type ReadingScript,
  type SpokenPiece,
  type UnreadBlock
} from './script'
