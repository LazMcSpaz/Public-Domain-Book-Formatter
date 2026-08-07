/**
 * Design by interview.
 *
 * The alternative — a panel of forty fields — asks the user to already know
 * what a gutter is, what body size suits a 6×9 trim, and which typeface fits a
 * 17th-century treatise. Almost nobody does, and the ones who do would rather
 * start from something sensible than from defaults.
 *
 * So a handful of questions about the *book* produce a complete, coherent
 * style; the detailed controls stay available behind "anything you'd change?"
 * but are never the front door.
 *
 * Pure: answers in, StyleProfile out.
 */
import type { StyleProfile } from '@core/model'
import { defaultStyleProfile } from '@core/style'

/** What kind of book this is — the single most informative answer. */
export type BookKind = 'novel' | 'nonfiction' | 'poetry' | 'illustrated' | 'reference'

/** Period feel, which drives typeface choice more than anything else. */
export type PeriodFeel = 'early-modern' | 'georgian' | 'victorian' | 'modern'

export type ChapterOpenerStyle = 'plain' | 'ornamented' | 'drop-cap'

export interface DesignAnswers {
  kind: BookKind
  period: PeriodFeel
  chapterOpener: ChapterOpenerStyle
  runningHeads: 'author-title' | 'chapter' | 'none'
  /** Explicit trim override; otherwise derived from the book kind. */
  trimSize?: string
}

/**
 * A typeface option. All are open-licensed so they can legally be embedded in
 * a book that gets sold — system fonts generally cannot.
 */
export interface FontChoice {
  id: string
  label: string
  /** LaTeX/OpenType family name passed to fontspec. */
  family: string
  note: string
  /**
   * Whether the face carries real small capitals (`smcp`).
   *
   * Only three of the seven do, and this is said in the note rather than
   * discovered later, because the interview recommends small-capped headings
   * for every period but "modern" — and recommends IM FELL, which has none, for
   * the 17th century. A face without them sets those headings in full capitals:
   * a different texture, chosen with the fact in view rather than after the
   * fact. They are never synthesised by scaling capitals down.
   *
   * Static rather than measured because the interview runs before any font is
   * loaded. `TextMeasurer.hasSmallCaps` is what the engine actually acts on, so
   * a wrong value here misinforms the user without mis-setting the book.
   */
  smallCaps: boolean
}

export const BODY_FONTS: readonly FontChoice[] = [
  {
    id: 'im-fell',
    label: 'IM FELL English',
    family: 'IM FELL English',
    note: 'Digitized from actual 17th-century Oxford types. Period-correct, not an imitation.',
    smallCaps: false
  },
  {
    id: 'junicode',
    label: 'Junicode',
    family: 'Junicode',
    note: 'Built for medievalists — has long-s, real small capitals, and extensive archaic glyphs.',
    smallCaps: true
  },
  {
    id: 'eb-garamond',
    label: 'EB Garamond',
    family: 'EB Garamond',
    note: 'Claude Garamond revival, with real small capitals. Elegant for 16th–18th century works.',
    smallCaps: true
  },
  {
    id: 'libre-caslon',
    label: 'Libre Caslon',
    family: 'Libre Caslon Text',
    note: 'The classic English book face; right for 18th–19th century.',
    smallCaps: false
  },
  {
    id: 'libre-baskerville',
    label: 'Libre Baskerville',
    family: 'Libre Baskerville',
    note: 'Transitional, highly legible at book sizes.',
    smallCaps: false
  },
  {
    id: 'crimson',
    label: 'Crimson Pro',
    family: 'Crimson Pro',
    note: 'Old-style proportions, comfortable for long reading.',
    smallCaps: false
  },
  {
    id: 'cardo',
    label: 'Cardo',
    family: 'Cardo',
    note: 'Built for classicists — Greek, Hebrew, scholarly apparatus, and real small capitals.',
    smallCaps: true
  }
]

/**
 * Ornament ids from the shipped library (`resources/ornaments/manifest.json`).
 * Named here rather than inlined so a rename of either breaks loudly.
 */
const CHAPTER_ORNAMENT_ID = 'chapter-flourish'
const SECTION_ORNAMENT_ID = 'fleuron-center'

export function fontById(id: string): FontChoice {
  return BODY_FONTS.find((f) => f.id === id) ?? BODY_FONTS[2]!
}

/** The typeface that best matches a period, used as the pre-selected answer. */
export function fontForPeriod(period: PeriodFeel): FontChoice {
  switch (period) {
    case 'early-modern':
      return fontById('im-fell')
    case 'georgian':
      return fontById('libre-caslon')
    case 'victorian':
      return fontById('libre-baskerville')
    case 'modern':
    default:
      return fontById('crimson')
  }
}

/** Trim size that suits a book kind, in KDP's catalogue. */
export function trimForKind(kind: BookKind): string {
  switch (kind) {
    case 'poetry':
      // Narrower measure keeps verse lines from wrapping.
      return '5.5x8.5'
    case 'illustrated':
    case 'reference':
      return '7x10'
    case 'novel':
    case 'nonfiction':
    default:
      return '6x9'
  }
}

/**
 * Body size in points. Reference books take a little more air; poetry a little
 * less, because verse is read slowly and a tight measure suits it.
 */
function bodySizeForKind(kind: BookKind): number {
  switch (kind) {
    case 'reference':
      return 10.5
    case 'poetry':
      return 11.5
    default:
      return 11
  }
}

/**
 * Margins in inches. The inner margin is deliberately larger than the outer:
 * once the book is bound, the gutter swallows part of the inner edge, so equal
 * margins print as visibly off-centre.
 */
function marginsForKind(kind: BookKind): StyleProfile['margins'] {
  if (kind === 'illustrated' || kind === 'reference') {
    return { inner: 0.88, outer: 0.6, top: 0.75, bottom: 0.75 }
  }
  return { inner: 0.75, outer: 0.5, top: 0.75, bottom: 0.75 }
}

/**
 * Build a complete style profile from the interview answers.
 * Everything not asked about is derived, so the result is always coherent.
 */
export function profileFromAnswers(answers: DesignAnswers, fontId?: string): StyleProfile {
  const base = defaultStyleProfile()
  const font = fontId ? fontById(fontId) : fontForPeriod(answers.period)

  // Verso/recto asymmetry is the convention: the left page carries the wider
  // context, the right page the narrower one.
  const runningHeads: StyleProfile['runningHeads'] =
    answers.runningHeads === 'none'
      ? { verso: 'none', recto: 'none' }
      : answers.runningHeads === 'chapter'
        ? { verso: 'bookTitle', recto: 'chapterTitle' }
        : { verso: 'author', recto: 'bookTitle' }

  return {
    ...base,
    id: 'interview',
    name: 'From your answers',
    trimSize: answers.trimSize ?? trimForKind(answers.kind),
    margins: marginsForKind(answers.kind),
    bodyFont: font.family,
    bodyFontSize: bodySizeForKind(answers.kind),
    // A single family throughout reads as deliberate; mixing display faces is
    // where amateur reprints usually go wrong.
    headingFont: font.family,
    headingStyle: {
      smallCaps: answers.period !== 'modern',
      centered: true,
      scale: answers.kind === 'poetry' ? 1.4 : 1.6
    },
    runningHeads,
    dropCap: answers.chapterOpener === 'drop-cap',
    ornaments: {
      ...base.ornaments,
      chapterOpener: answers.chapterOpener === 'ornamented' ? CHAPTER_ORNAMENT_ID : null,
      // Recorded for anyone hand-editing the exported source: the preamble
      // always defines \sectiondivider, but the vision schema has no
      // scene-break block, so nothing in the pipeline triggers one yet.
      sectionDivider: answers.period === 'modern' ? null : SECTION_ORNAMENT_ID
    }
  }
}

/** A short, human summary of what the answers produced. */
export function describeProfile(profile: StyleProfile): string {
  const heads =
    profile.runningHeads.verso === 'none'
      ? 'no running heads'
      : `running heads (${profile.runningHeads.verso}/${profile.runningHeads.recto})`
  const opener = profile.dropCap
    ? 'drop capitals'
    : profile.ornaments.chapterOpener
      ? 'ornamented chapter openings'
      : 'plain chapter openings'
  return [
    `${profile.trimSize}in`,
    `${profile.bodyFont} at ${profile.bodyFontSize}pt`,
    `${profile.margins.inner}in inner margin`,
    opener,
    heads
  ].join(' · ')
}
