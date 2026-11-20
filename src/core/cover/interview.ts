/**
 * The cover, by interview.
 *
 * Same contract as the wizard's gates: a function of the current state that
 * returns `Question[]`, grouped into one decision per screen. Questions are
 * data, so this whole arm is unit-testable with no DOM, and the control channel
 * (`docs/CONTROL.md`) can drive it by id without knowing it exists.
 *
 * The ordering is the point. The sheet is settled first because every other
 * answer is measured against it; the look second, because it is the thing a
 * collection shares and the thing most likely to be answered with "same as last
 * time"; the book's own words third; and the picture last, because it is the
 * only answer that can spend money and the only one whose sensible options
 * depend on all three of the others — a brief cannot say "to sit with this
 * ground" until the ground is chosen, and the resolution it needs cannot be
 * computed until the arrangement has decided how large it prints.
 *
 * Pure: no I/O, no model calls.
 */
import type { Question } from '@core/wizard'
import { BODY_FONTS } from '@core/design'
import { type CoverDocument } from './document'
import {
  coverGeometry,
  describeGeometry,
  HARDCOVER_PAGE_LIMITS,
  PAGE_LIMITS,
  PAPER_LABEL,
  type PaperStock
} from './geometry'
import { type SavedCoverLook } from './profile'
import { artQuestions, contentQuestions } from './interview-content'
import { lookQuestions } from './interview-look'
export { coverFromAnswers, coverFromInterior } from './interview-answers'
export { artQuestions, contentQuestions } from './interview-content'
export { lookQuestions } from './interview-look'

/** A plate the app already cut out of this book's scan, offered as cover art. */
export interface PlateOffer {
  id: string
  pageIndex: number
  caption: string
  /** Object URL of the crop — the evidence. Never decided from the caption. */
  previewUrl: string
  widthPx: number
  heightPx: number
}

export interface CoverInterviewState {
  doc: CoverDocument
  /**
   * Whether the page count was measured by this app's layout engine.
   *
   * Changes the question rather than a footnote on it: a measured count is
   * confirmed, and a typed one is asked for with the reason it matters.
   */
  pageCountMeasured: boolean
  /** Looks banked from earlier books — the collection offer. */
  bankedLooks: readonly SavedCoverLook[]
  /** Plates from this book's own scan, if it was read here. */
  plates: readonly PlateOffer[]
  /** True when a Replicate token is stored, so the key question is skipped. */
  hasReplicateToken: boolean
  /**
   * Whether the browser can reach Replicate at all.
   *
   * `null` until the probe lands. Only an explicit `false` withdraws the offer,
   * so the door appears optimistically rather than flickering in — the same
   * shape as `batchAvailable`, and for the same reason.
   */
  replicateAvailable: boolean | null
  /**
   * Which door the user has taken to a picture, as answered on this gate.
   *
   * Carried in the state rather than read out of the answers by the question
   * builder, because the builder is pure and takes the book's state: it is the
   * same reason the wizard's steps take a `WizardState` and not the answer map.
   * What it buys is the rule the whole interview runs on — a model, a brief and
   * a subject are three questions nobody uploading their own picture should
   * ever be shown.
   */
  artSource?: 'plate' | 'upload' | 'generated' | 'none'

  /** A rendered sample of the cover as it currently stands. */
  previewUrl?: string
}

export const PAPERS: readonly PaperStock[] = [
  'bw-cream',
  'bw-white',
  'bw-groundwood',
  'standard-color',
  'premium-color'
]

export const TRIMS = ['5x8', '5.25x8', '5.5x8.5', '6x9', '6.14x9.21', '7x10', '8.5x11']

export function fontOptions() {
  return BODY_FONTS.map((f) => ({
    value: f.family,
    label: f.label,
    description: f.note
  }))
}

/** The sheet: the three facts every other answer is measured against. */
export function sheetQuestions(state: CoverInterviewState): Question[] {
  const { doc } = state
  const geometry = coverGeometry({
    trimSize: doc.trimSize,
    pageCount: doc.pageCount,
    paper: doc.paper
  })
  const out: Question[] = [
    {
      id: 'cover-trim',
      type: 'choice',
      group: 'sheet',
      prompt: 'What size is the book?',
      help: 'The same trim as the interior. A cover is built around it, not fitted to it afterwards.',
      options: TRIMS.map((t) => ({ value: t, label: `${t.replace('x', ' × ')} in` })),
      defaultValue: TRIMS.includes(doc.trimSize) ? doc.trimSize : '6x9',
      required: true,
      evidence: [{ kind: 'text', text: describeGeometry(geometry), label: 'The flat sheet' }]
    },
    {
      id: 'cover-binding',
      type: 'choice',
      group: 'sheet',
      prompt: 'Is this the paperback or the hardcover?',
      help: 'They are different objects, not two sizes of one. A hardcover is printed on a sheet that wraps around boards and glues inside, so it is larger than the book, its panels stand proud of the pages, and a 10 mm hinge either side of the spine must be kept clear. One book published in both needs a cover file for each.',
      options: [
        {
          value: 'paperback',
          label: 'Paperback',
          description: 'Trimmed, with an eighth of an inch of bleed'
        },
        {
          value: 'hardcover',
          label: 'Hardcover',
          description: `Case laminate: ${HARDCOVER_PAGE_LIMITS.min}–${HARDCOVER_PAGE_LIMITS.max} pages, and only some trims`
        }
      ],
      defaultValue: doc.binding
    },
    {
      id: 'cover-paper',
      type: 'choice',
      group: 'sheet',
      prompt: 'Which paper is it printing on?',
      help: 'This decides the spine: cream is thicker than white, so the same book has a different fold on each.',
      options: PAPERS.map((p) => ({
        value: p,
        label: PAPER_LABEL[p],
        description: `${PAGE_LIMITS[p].min}–${PAGE_LIMITS[p].max} pages`
      })),
      defaultValue: doc.paper
    },
    {
      id: 'cover-pages',
      type: 'text',
      group: 'sheet',
      prompt: state.pageCountMeasured
        ? 'The interior came to this many pages — the spine is built from it.'
        : 'How many pages is the finished interior?',
      help: state.pageCountMeasured
        ? 'Measured by the layout engine, not estimated from the scan.'
        : 'The spine is this number times the thickness of one page. A guess here is a cover that does not fit the book, and you find out when the proof arrives.',
      defaultValue: String(doc.pageCount || ''),
      placeholder: '284',
      required: true
    }
  ]
  return out
}

/** Every question the studio asks, in order. */
export function coverQuestions(state: CoverInterviewState): Question[] {
  return [
    ...sheetQuestions(state),
    ...lookQuestions(state),
    ...contentQuestions(state),
    ...artQuestions(state)
  ]
}
