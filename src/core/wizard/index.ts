/**
 * The guided flow: questions as data, gates as review points.
 */
export {
  defaultAnswers,
  groupQuestions,
  missingRequired,
  type Question,
  type ChoiceQuestion,
  type MultiChoiceQuestion,
  type TextQuestion,
  type ConfirmQuestion,
  type TermGridQuestion,
  type TermRow,
  pruneStaleAnswers,
  type DiscrepancyQuestion,
  type DiscrepancyRow,
  type DiscrepancyVerdict,
  type PageEditQuestion,
  type PageEditRow,
  type QuestionGroup,
  type TermVerdict,
  type Evidence,
  type Answers,
  type AnswerValue,
  type ChoiceOption
} from './questions'
export {
  STEPS,
  FRESH_LOOK,
  messagesByPage,
  settledLeaves,
  stepById,
  activeStep,
  appliedLook,
  progress,
  initialState,
  frontMatterPages,
  type Step,
  type StepId,
  type WizardState
} from './steps'
export { parseDeepLink, deepLink, stepsBefore, type DeepLink } from './deep-link'
