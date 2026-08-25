/**
 * "Anything you'd change?" — the detailed controls the interview always
 * promised.
 *
 * `design-interview.ts` has said from the start that a handful of questions
 * about the book produce a coherent style and that "the detailed controls stay
 * available behind *anything you'd change?* but are never the front door." The
 * front door was built; this is the rest of it.
 *
 * Several `StyleProfile` fields were reachable from nothing at all — the gutter,
 * the folio position, the page-number ornament, the three front-matter leaves,
 * and whether headings centre. They sat at their shipped defaults for every book
 * ever made. Others are *derived* from the book kind, which is a good starting
 * point and a bad cage: an 11pt body is right until the book you are setting
 * wants 10.5.
 *
 * Expressed as `Question[]` rather than as a bespoke form, for the same reason
 * the wizard is: the renderer already exists, the shapes are already tested, and
 * a field added here needs no new UI. It also keeps the whole surface pure and
 * unit-testable — answers in, `StyleProfile` out, exactly like the interview.
 *
 * Numbers are offered as choices rather than free text. A settings screen is
 * where detail belongs, but "0.13 in" typed into a box invites 13, and a body
 * size of 13 inches is not a validation error anyone should have to read about.
 */
import type {
  Margins,
  PageNumberPosition,
  RunningHeadMode,
  RunningHeadStyle,
  StyleProfile
} from '@core/model'
import type { Answers, ChoiceOption, Question } from '@core/wizard/questions'
import { BUILTIN_ORNAMENTS, type OrnamentKind } from '@core/ornament'

/** The value meaning "no ornament here", since a choice cannot answer null. */
export const NO_ORNAMENT = 'none'

/** KDP's standard trims. Mirrors `KNOWN_TRIMS` in the export validator. */
const TRIMS = [
  '5x8',
  '5.06x7.81',
  '5.25x8',
  '5.5x8.5',
  '6x9',
  '6.14x9.21',
  '6.69x9.61',
  '7x10',
  '7.44x9.69',
  '7.5x9.25',
  '8x10',
  '8.25x11',
  '8.5x11'
]

const BODY_SIZES = [9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13]
const MARGIN_STEPS = [0.4, 0.5, 0.6, 0.75, 0.85, 1, 1.2]
const GUTTER_STEPS = [0, 0.06, 0.13, 0.19, 0.25, 0.32]
const HEADING_SCALES = [1.2, 1.4, 1.6, 1.8, 2]

const RUNNING_HEAD_MODES: RunningHeadMode[] = [
  'none',
  'bookTitle',
  'author',
  'chapterTitle',
  'pageNumber'
]

const RUNNING_HEAD_LABELS: Record<RunningHeadMode, string> = {
  none: 'Nothing',
  bookTitle: 'Book title',
  author: 'Author',
  chapterTitle: 'Current chapter',
  pageNumber: 'Page number'
}

const PAGE_NUMBER_POSITIONS: PageNumberPosition[] = [
  'none',
  'bottomCenter',
  'bottomOuter',
  'topOuter'
]

const PAGE_NUMBER_LABELS: Record<PageNumberPosition, string> = {
  none: 'No page numbers',
  bottomCenter: 'Bottom, centred',
  bottomOuter: 'Bottom, outer corner',
  topOuter: 'Top, outer corner'
}

const numberOptions = (values: number[], unit: string): ChoiceOption[] =>
  values.map((v) => ({ value: String(v), label: `${v}${unit}` }))

/** Ornaments of one kind, plus the option of none. */
function ornamentOptions(...kinds: OrnamentKind[]): ChoiceOption[] {
  return [
    { value: NO_ORNAMENT, label: 'None' },
    ...BUILTIN_ORNAMENTS.filter((o) => kinds.includes(o.kind)).map((o) => ({
      value: o.id,
      label: o.name
    }))
  ]
}

export interface StyleQuestionOptions {
  /**
   * The typeface list, passed in rather than imported.
   *
   * `@core/design` already imports this module's neighbours for
   * `defaultStyleProfile`, so reaching the other way would close a cycle. The
   * caller has the list anyway.
   */
  families?: ChoiceOption[]
  /**
   * Whether this book's original contents carried a description per chapter.
   *
   * The question is only asked when there is something to keep. A book whose
   * contents was a bare list has nothing to recover, and offering the choice
   * anyway would be asking about a feature that cannot do anything — which is
   * exactly the kind of setting this app exists not to have.
   */
  hasSynopses?: boolean
}

/**
 * Every field of a profile, as questions, with the profile's own values as the
 * defaults — so the form opens showing what is currently set.
 */
export function styleQuestions(
  profile: StyleProfile,
  options: StyleQuestionOptions = {}
): Question[] {
  const families = options.families ?? [{ value: profile.bodyFont, label: profile.bodyFont }]
  const orn = profile.ornaments

  return [
    {
      id: 'trimSize',
      type: 'choice',
      prompt: 'Trim size',
      help: 'The finished page size. Anything outside KDP’s list needs confirming with them.',
      defaultValue: profile.trimSize,
      options: TRIMS.map((t) => ({ value: t, label: `${t.replace('x', ' × ')} in` }))
    },
    {
      id: 'bodyFont',
      type: 'choice',
      prompt: 'Body typeface',
      defaultValue: profile.bodyFont,
      options: families
    },
    {
      id: 'bodyFontSize',
      type: 'choice',
      prompt: 'Body size',
      help: 'Derived from the book kind unless you set it here.',
      defaultValue: String(profile.bodyFontSize),
      options: numberOptions(BODY_SIZES, 'pt')
    },
    {
      id: 'headingFont',
      type: 'choice',
      prompt: 'Heading typeface',
      help: 'One family throughout reads as deliberate; mixing display faces rarely does.',
      defaultValue: profile.headingFont,
      options: families
    },
    {
      id: 'headingScale',
      type: 'choice',
      prompt: 'Heading size',
      help: 'Relative to the body size.',
      defaultValue: String(profile.headingStyle.scale),
      options: numberOptions(HEADING_SCALES, '×')
    },
    {
      id: 'headingSmallCaps',
      type: 'confirm',
      prompt: 'Set headings in small capitals?',
      help:
        'Real small capitals where the face has them — EB Garamond, Cardo and Junicode do. ' +
        'A face without them gets full capitals instead; they are never faked by scaling.',
      defaultValue: profile.headingStyle.smallCaps
    },
    {
      id: 'headingCentered',
      type: 'confirm',
      prompt: 'Centre headings?',
      defaultValue: profile.headingStyle.centered
    },
    {
      id: 'marginInner',
      type: 'choice',
      prompt: 'Inner margin (spine side)',
      help:
        'This plus the gutter is what KDP checks against your page count. Too little and ' +
        'the binding swallows the text.',
      defaultValue: String(profile.margins.inner),
      options: numberOptions(MARGIN_STEPS, ' in')
    },
    {
      id: 'gutter',
      type: 'choice',
      prompt: 'Extra gutter for binding',
      help:
        'Added to the inner margin. KDP wants more of it as a book gets thicker — 0.375 in ' +
        'up to 150 pages, rising to 0.875 in past 700.',
      defaultValue: String(profile.gutter),
      options: numberOptions(GUTTER_STEPS, ' in')
    },
    {
      id: 'marginOuter',
      type: 'choice',
      prompt: 'Outer margin',
      defaultValue: String(profile.margins.outer),
      options: numberOptions(MARGIN_STEPS, ' in')
    },
    {
      id: 'marginTop',
      type: 'choice',
      prompt: 'Top margin',
      defaultValue: String(profile.margins.top),
      options: numberOptions(MARGIN_STEPS, ' in')
    },
    {
      id: 'marginBottom',
      type: 'choice',
      prompt: 'Bottom margin',
      defaultValue: String(profile.margins.bottom),
      options: numberOptions(MARGIN_STEPS, ' in')
    },
    {
      id: 'runningHeadVerso',
      type: 'choice',
      prompt: 'Running head, left page',
      help: 'Left and right carry different text in a printed book.',
      defaultValue: profile.runningHeads.verso,
      options: RUNNING_HEAD_MODES.map((m) => ({ value: m, label: RUNNING_HEAD_LABELS[m] }))
    },
    {
      id: 'runningHeadRecto',
      type: 'choice',
      prompt: 'Running head, right page',
      defaultValue: profile.runningHeads.recto,
      options: RUNNING_HEAD_MODES.map((m) => ({ value: m, label: RUNNING_HEAD_LABELS[m] }))
    },
    {
      id: 'runningHeadStyle',
      type: 'choice',
      prompt: 'Running head, how it is set',
      help:
        'A head set like the text competes with it. Small capitals are the usual answer, ' +
        'and a face without them falls back to full capitals rather than faking them.',
      defaultValue: profile.runningHeadStyle,
      options: [
        { value: 'smallCaps', label: 'Small capitals' },
        { value: 'italic', label: 'Italic' },
        { value: 'plain', label: 'Same as the text' }
      ]
    },
    {
      id: 'pageNumber',
      type: 'choice',
      prompt: 'Page numbers',
      defaultValue: profile.pageNumber,
      options: PAGE_NUMBER_POSITIONS.map((p) => ({ value: p, label: PAGE_NUMBER_LABELS[p] }))
    },
    {
      id: 'dropCap',
      type: 'confirm',
      prompt: 'Open each chapter with a drop capital?',
      defaultValue: profile.dropCap
    },
    ...(options.hasSynopses
      ? [
          {
            id: 'contentsSynopsis',
            type: 'confirm' as const,
            prompt: 'Keep the descriptions under each chapter in the contents?',
            help:
              'The original contents gives a paragraph under each chapter saying what is in ' +
              'it — the reason a page like that is read rather than scanned. Keeping them is ' +
              'the original’s own arrangement with this edition’s page numbers; it turns a ' +
              'one-leaf contents into several.',
            defaultValue: profile.contentsSynopsis
          }
        ]
      : []),
    {
      id: 'chaptersOpenRecto',
      type: 'confirm',
      prompt: 'Start every chapter on a right-hand page?',
      help:
        'Traditional, and it costs paper — a book of short chapters can gain thirty leaves ' +
        'to blank left-hand pages.',
      defaultValue: profile.chaptersOpenRecto
    },
    {
      id: 'paragraphIndentEms',
      type: 'choice',
      prompt: 'Paragraph indent',
      help:
        'How far the first line of a paragraph steps in. Set it to none and give the ' +
        'paragraphs some space instead, or the page reads as one block.',
      defaultValue: String(profile.paragraphIndentEms),
      options: [{ value: '0', label: 'None' }, ...numberOptions([0.6, 1, 1.2, 1.5, 2], ' em')]
    },
    {
      id: 'paragraphSpacingEms',
      type: 'choice',
      prompt: 'Space between paragraphs',
      help: 'Normally none in a book: the indent does that work, and both together read as a memo.',
      defaultValue: String(profile.paragraphSpacingEms),
      options: [{ value: '0', label: 'None' }, ...numberOptions([0.4, 0.6, 1], ' em')]
    },
    {
      id: 'hyphenate',
      type: 'confirm',
      prompt: 'Break words at the end of a line?',
      help:
        'On, justified text sets evenly. Off, it is honest about the measure and opens ' +
        'rivers of white space in narrow columns.',
      defaultValue: profile.hyphenate
    },
    {
      id: 'opticalMargins',
      type: 'confirm',
      prompt: 'Hang punctuation past the margin?',
      help:
        'A line ending in a comma looks short, because the mark is mostly white space. ' +
        'Hanging it lines up the ink instead of the box, which is what every book printed ' +
        'before phototypesetting did. Changes no line break and no page count.',
      defaultValue: profile.opticalMargins
    },
    {
      id: 'ornamentChapter',
      type: 'choice',
      prompt: 'Chapter-opening ornament',
      defaultValue: orn.chapterOpener ?? NO_ORNAMENT,
      options: ornamentOptions('chapter')
    },
    {
      id: 'ornamentDivider',
      type: 'choice',
      prompt: 'Section-divider ornament',
      defaultValue: orn.sectionDivider ?? NO_ORNAMENT,
      options: ornamentOptions('divider')
    },
    {
      id: 'ornamentPage',
      type: 'choice',
      prompt: 'Page-number ornament',
      help: 'A small flourish beside the folio, in the printer’s tradition.',
      defaultValue: orn.pageNumber ?? NO_ORNAMENT,
      options: ornamentOptions('page')
    },
    {
      id: 'ornamentBlank',
      type: 'choice',
      prompt: 'Mark on the blank page facing a chapter opening',
      help:
        'Chapters opening on a right-hand page leave a blank left-hand one, and a book of ' +
        'short chapters can gain thirty of them. A small mark in the middle tells a reader ' +
        'the leaf is meant to be empty rather than misbound, and that the book has not ended.',
      defaultValue: orn.blankPage ?? NO_ORNAMENT,
      options: ornamentOptions('chapter', 'divider')
    },
    {
      id: 'frontHalfTitle',
      type: 'confirm',
      prompt: 'Print a half-title leaf?',
      help: 'The short title on its own page, before the full title page.',
      defaultValue: profile.frontMatter.halfTitle
    },
    {
      id: 'frontTitlePage',
      type: 'confirm',
      prompt: 'Print a title page?',
      defaultValue: profile.frontMatter.titlePage
    },
    {
      id: 'frontCopyrightPage',
      type: 'confirm',
      prompt: 'Print a copyright page?',
      help: 'Where your edition statement, imprint and public-domain notice go.',
      defaultValue: profile.frontMatter.copyrightPage
    }
  ]
}

const pick = (answers: Answers, id: string, fallback: string): string => {
  const v = answers[id]
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

const pickNumber = (answers: Answers, id: string, fallback: number): number => {
  const n = Number(answers[id])
  return Number.isFinite(n) ? n : fallback
}

const pickBool = (answers: Answers, id: string, fallback: boolean): boolean => {
  const v = answers[id]
  return typeof v === 'boolean' ? v : fallback
}

const pickOrnament = (answers: Answers, id: string, fallback: string | null): string | null => {
  const v = answers[id]
  if (typeof v !== 'string') return fallback
  return v === NO_ORNAMENT ? null : v
}

/**
 * Fold the answers back onto a profile.
 *
 * Every field falls back to what the profile already held, so a partial answer
 * set is a partial edit rather than a reset to defaults — which matters because
 * the caller hands over only the fields the user actually touched.
 */
export function applyStyleAnswers(profile: StyleProfile, answers: Answers): StyleProfile {
  const margins: Margins = {
    inner: pickNumber(answers, 'marginInner', profile.margins.inner),
    outer: pickNumber(answers, 'marginOuter', profile.margins.outer),
    top: pickNumber(answers, 'marginTop', profile.margins.top),
    bottom: pickNumber(answers, 'marginBottom', profile.margins.bottom)
  }

  return {
    ...profile,
    trimSize: pick(answers, 'trimSize', profile.trimSize),
    margins,
    gutter: pickNumber(answers, 'gutter', profile.gutter),
    bodyFont: pick(answers, 'bodyFont', profile.bodyFont),
    bodyFontSize: pickNumber(answers, 'bodyFontSize', profile.bodyFontSize),
    headingFont: pick(answers, 'headingFont', profile.headingFont),
    headingStyle: {
      smallCaps: pickBool(answers, 'headingSmallCaps', profile.headingStyle.smallCaps),
      centered: pickBool(answers, 'headingCentered', profile.headingStyle.centered),
      scale: pickNumber(answers, 'headingScale', profile.headingStyle.scale)
    },
    runningHeads: {
      verso: pick(answers, 'runningHeadVerso', profile.runningHeads.verso) as RunningHeadMode,
      recto: pick(answers, 'runningHeadRecto', profile.runningHeads.recto) as RunningHeadMode
    },
    runningHeadStyle: pick(
      answers,
      'runningHeadStyle',
      profile.runningHeadStyle
    ) as RunningHeadStyle,
    dropCap: pickBool(answers, 'dropCap', profile.dropCap),
    chaptersOpenRecto: pickBool(answers, 'chaptersOpenRecto', profile.chaptersOpenRecto),
    paragraphIndentEms: pickNumber(answers, 'paragraphIndentEms', profile.paragraphIndentEms),
    paragraphSpacingEms: pickNumber(answers, 'paragraphSpacingEms', profile.paragraphSpacingEms),
    hyphenate: pickBool(answers, 'hyphenate', profile.hyphenate),
    opticalMargins: pickBool(answers, 'opticalMargins', profile.opticalMargins),
    pageNumber: pick(answers, 'pageNumber', profile.pageNumber) as PageNumberPosition,
    contentsSynopsis: pickBool(answers, 'contentsSynopsis', profile.contentsSynopsis),
    ornaments: {
      chapterOpener: pickOrnament(answers, 'ornamentChapter', profile.ornaments.chapterOpener),
      sectionDivider: pickOrnament(answers, 'ornamentDivider', profile.ornaments.sectionDivider),
      pageNumber: pickOrnament(answers, 'ornamentPage', profile.ornaments.pageNumber),
      blankPage: pickOrnament(answers, 'ornamentBlank', profile.ornaments.blankPage)
    },
    frontMatter: {
      titlePage: pickBool(answers, 'frontTitlePage', profile.frontMatter.titlePage),
      copyrightPage: pickBool(answers, 'frontCopyrightPage', profile.frontMatter.copyrightPage),
      halfTitle: pickBool(answers, 'frontHalfTitle', profile.frontMatter.halfTitle)
    }
  }
}
