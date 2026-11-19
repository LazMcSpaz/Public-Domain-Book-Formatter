/**
 * Public surface of the style system (SPEC §7).
 */
export { DEFAULT_STYLE_PROFILES, defaultStyleProfile } from './defaults'
export { resolveStyle, normalizeStyleProfile, mergeStyle } from './profile'
export {
  BANKED_STYLE_KEYS,
  PROFILE_SCHEMA_VERSION,
  describeSavedProfile,
  emptyImprint,
  migrateSavedProfile,
  newSavedProfile,
  type ImprintFields,
  type SavedStyleProfile
} from './saved-profile'
export {
  NO_ORNAMENT,
  applyStyleAnswers,
  styleQuestions,
  type StyleQuestionOptions
} from './editable'
export { familyStack, readingStyle, type ReadingStyle } from './reading'
export {
  DEFAULT_SHORT_BOOK,
  HOUSE_LOOK_VERSION,
  HOUSE_TRIM,
  SHORT_BOOK_PAGES,
  SHORT_BOOK_TRIM,
  hasOwnDesign,
  houseDesignFor,
  houseLookLine,
  inheritDesign,
  isShortBook,
  parseHouseLook,
  trimForLength,
  type HouseLook,
  type LookSource,
  type ShortBookRule
} from './house-look'
