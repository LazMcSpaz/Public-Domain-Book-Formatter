/**
 * The annotation pass: the editor's own notes, written in the editor's voice.
 *
 * The first thing the app *writes* rather than recovers. A public-domain
 * reprint has to add something to be worth publishing, and notes are the
 * cheapest honest way to add it — the machinery to place them already existed
 * and had exactly one user, a person typing into a textarea.
 *
 * Nothing here decides anything on its own. The pass proposes; every note
 * arrives at the proof step beside the passage it annotates, with the
 * assertions the book itself never made called out, and goes in only when the
 * user says so.
 */
export {
  ANNOTATION_KINDS,
  MAX_EXEMPLARS,
  NOTES_PER_THOUSAND_WORDS,
  defaultVoice,
  normalizeVoice,
  voiceBlock,
  withExemplar,
  type AnnotationKind,
  type EditorVoice,
  type NoteDensity,
  type VoiceExemplar
} from './voice'
export {
  ANNOTATION_SCHEMA,
  checkProposals,
  findAnchor,
  outsideClaims,
  parseAnnotations,
  type AnnotationProposal,
  type CheckedProposal
} from './schema'
export {
  CHUNK_WORDS,
  OVERLAP_WORDS,
  buildAnnotationSystemPrompt,
  buildAnnotationUserPrompt,
  chunkBlocks,
  contextFor,
  type BookChunk as AnnotationChunk
} from './prompt'
export {
  buildAnnotationBody,
  runAnnotation,
  type AnnotationRunOptions,
  type AnnotationRunResult,
  type ChunkFailure
} from './runner'
export { learnVoice, proposalsToEdits, type AcceptedProposal } from './apply'
export {
  INTRODUCTION_SCHEMA,
  INTRODUCTION_WORDS,
  buildIntroductionPrompt,
  draftIntroduction,
  parseIntroduction,
  sampleBook,
  type IntroductionDraft,
  type IntroductionLength,
  type IntroductionOptions
} from './introduce'
export { estimateAnnotationCost, type AnnotationCostInputs } from './cost'
