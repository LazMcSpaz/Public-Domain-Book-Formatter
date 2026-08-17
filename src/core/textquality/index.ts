/**
 * Is this text worth believing?
 *
 * One measurement, applied to any text a file already carries — an EPUB's
 * markup, a PDF's embedded layer — replacing two assumptions that were both
 * wrong at the edges: that an EPUB is always typed by a person, and that a
 * PDF's own text is never worth reading.
 */
export {
  assessText,
  describeAssessment,
  MIN_WORDS,
  type TextAssessment,
  type TextVerdict,
  type AssessOptions
} from './assess'
