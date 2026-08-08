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
