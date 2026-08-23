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
import { BUILTIN_ORNAMENTS } from '@core/ornament'
import {
  ARRANGEMENTS,
  ARRANGEMENT_LABEL,
  defaultCover,
  normalizeLook,
  type CoverDocument
} from './document'
import {
  coverGeometry,
  describeGeometry,
  MIN_PAGES_FOR_SPINE_TEXT,
  PAGE_LIMITS,
  PAPER_LABEL,
  type PaperStock
} from './geometry'
import { ART_BRIEFS, BRIEF_LABEL, BRIEF_NOTE, SUGGESTED_ART_MODELS } from './art'
import { describeSavedCoverLook, type SavedCoverLook } from './profile'

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
  'standard-color',
  'premium-color'
]

const TRIMS = ['5x8', '5.25x8', '5.5x8.5', '6x9', '6.14x9.21', '7x10', '8.5x11']

function fontOptions() {
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

/** The look — the half a collection shares. */
export function lookQuestions(state: CoverInterviewState): Question[] {
  const { doc, bankedLooks } = state
  const look = normalizeLook(doc.look)
  const out: Question[] = []

  if (bankedLooks.length > 0) {
    out.push({
      id: 'cover-banked',
      type: 'choice',
      group: 'look',
      prompt: 'Is this one of a set?',
      help: 'A banked look applied here makes this book sit with the others on a shelf. It carries nothing about the other books — only how they look.',
      options: [
        ...bankedLooks.map((b) => ({
          value: b.id,
          label: b.name,
          description: describeSavedCoverLook(b)
        })),
        { value: '', label: 'No — design this one on its own' }
      ],
      defaultValue: bankedLooks[0]?.id ?? ''
    })
  }

  out.push(
    {
      id: 'cover-arrangement',
      type: 'choice',
      group: 'look',
      prompt: 'How is the front laid out?',
      options: ARRANGEMENTS.map((a) => ({ value: a, label: ARRANGEMENT_LABEL[a] })),
      defaultValue: look.arrangement,
      ...(state.previewUrl
        ? {
            evidence: [{ kind: 'sample' as const, src: state.previewUrl, caption: 'As it stands' }]
          }
        : {})
    },
    {
      id: 'cover-title-font',
      type: 'choice',
      group: 'look',
      prompt: 'What face is the title set in?',
      options: fontOptions(),
      defaultValue: look.titleFont
    },
    {
      id: 'cover-title-case',
      type: 'choice',
      group: 'look',
      prompt: 'How is it set?',
      help: 'Small capitals are the real ones or none — a face without them gets full capitals rather than capitals shrunk down, which is the tell of a cheap reprint.',
      options: [
        { value: 'small-caps', label: 'Small capitals' },
        { value: 'upper', label: 'Full capitals' },
        { value: 'as-typed', label: 'As typed' }
      ],
      defaultValue: look.titleCase
    },
    {
      id: 'cover-ground',
      type: 'text',
      group: 'palette',
      prompt: 'The ground colour',
      help: 'As a hex value. The whole sheet is painted in it, out past the trim.',
      defaultValue: look.palette.ground
    },
    {
      id: 'cover-ink',
      type: 'text',
      group: 'palette',
      prompt: 'The ink',
      defaultValue: look.palette.ink
    },
    {
      id: 'cover-accent',
      type: 'text',
      group: 'palette',
      prompt: 'The accent — rules, bands and ornament',
      defaultValue: look.palette.accent
    },
    {
      id: 'cover-rule',
      type: 'choice',
      group: 'ornament',
      prompt: 'A rule under the title?',
      options: [
        { value: 'single', label: 'A single rule' },
        { value: 'double', label: 'A double rule' },
        { value: 'ornamented', label: 'An ornament instead' },
        { value: 'none', label: 'Nothing' }
      ],
      defaultValue: look.rule
    },
    {
      id: 'cover-ornament',
      type: 'choice',
      group: 'ornament',
      prompt: 'Which ornament?',
      help: 'Vector, from the shipped library — it prints at any size.',
      options: [
        { value: '', label: 'None' },
        ...BUILTIN_ORNAMENTS.map((o) => ({ value: o.id, label: o.name, description: o.kind }))
      ],
      defaultValue: look.ornamentId ?? ''
    }
  )

  // Never ask what is not relevant yet: below KDP's floor the spine cannot
  // carry text at all, so the question is withdrawn rather than answered and
  // silently ignored.
  const geometry = coverGeometry({
    trimSize: doc.trimSize,
    pageCount: doc.pageCount,
    paper: doc.paper
  })
  if (geometry.spineTextAllowed) {
    out.push({
      id: 'cover-spine-text',
      type: 'confirm',
      group: 'ornament',
      prompt: 'Print the title on the spine?',
      help: `The spine is ${geometry.spineIn.toFixed(3)} in on this book.`,
      defaultValue: look.spineText
    })
  }

  return out
}

/** The book's own words. */
export function contentQuestions(state: CoverInterviewState): Question[] {
  const c = state.doc.content
  return [
    {
      id: 'cover-title',
      type: 'text',
      group: 'words',
      prompt: 'The title, as it prints on the cover',
      defaultValue: c.title,
      required: true
    },
    {
      id: 'cover-subtitle',
      type: 'text',
      group: 'words',
      prompt: 'A subtitle, if there is one',
      defaultValue: c.subtitle
    },
    {
      id: 'cover-author',
      type: 'text',
      group: 'words',
      prompt: 'The author',
      defaultValue: c.author
    },
    {
      id: 'cover-series',
      type: 'text',
      group: 'words',
      prompt: 'The collection this belongs to, if any',
      help: 'Printed above the title. Named per book on purpose — the same look often covers more than one series.',
      defaultValue: c.series
    },
    {
      id: 'cover-blurb',
      type: 'text',
      group: 'back',
      prompt: 'The back cover',
      help: 'It stops above the barcode, which KDP prints over whatever is under it.',
      defaultValue: c.blurb,
      multiline: true
    },
    {
      id: 'cover-imprint',
      type: 'text',
      group: 'back',
      prompt: 'The imprint',
      defaultValue: c.imprint
    }
  ]
}

/** The picture — the only answer here that can spend money. */
export function artQuestions(state: CoverInterviewState): Question[] {
  const { doc, plates } = state
  if (doc.look.arrangement === 'typographic') return []

  const sources: { value: string; label: string; description?: string }[] = []
  if (plates.length > 0) {
    sources.push({
      value: 'plate',
      label: `A plate from this book (${plates.length} found)`,
      description:
        'Already cut out of the scan at the resolution it was rendered at, and retouchable with the same tools the interior uses.'
    })
  }
  sources.push({
    value: 'upload',
    label: 'A picture of your own',
    description: 'Anything you have the right to print — including art from the original edition.'
  })
  if (state.replicateAvailable !== false) {
    sources.push({
      value: 'generated',
      label: 'Make one',
      description: 'Costs money on Replicate, and nothing is generated until you ask for it.'
    })
  }
  sources.push({ value: 'none', label: 'No picture' })

  const out: Question[] = [
    {
      id: 'cover-art-source',
      type: 'choice',
      group: 'art',
      prompt: 'Where does the picture come from?',
      options: sources,
      defaultValue: plates.length > 0 ? 'plate' : 'upload'
    }
  ]

  const source = state.artSource ?? (plates.length > 0 ? 'plate' : 'upload')

  if (plates.length > 0 && source === 'plate') {
    out.push({
      id: 'cover-plate',
      type: 'choice',
      group: 'art',
      prompt: 'Which plate?',
      options: plates.map((p) => ({
        value: p.id,
        label: p.caption || `Page ${p.pageIndex + 1}`,
        description: `${p.widthPx} × ${p.heightPx} px`,
        evidence: [{ kind: 'image' as const, src: p.previewUrl, alt: p.caption }]
      })),
      defaultValue: plates[0]?.id ?? ''
    })
  }

  if (source !== 'generated') return out

  out.push(
    {
      id: 'cover-art-brief',
      type: 'choice',
      group: 'generate',
      prompt: 'What kind of picture?',
      help: 'Generation is good at surfaces and devices and poor at scenes and people. This is the difference between a cover that reads as printed and one that reads as made by a machine.',
      options: ART_BRIEFS.map((b) => ({
        value: b,
        label: BRIEF_LABEL[b],
        description: BRIEF_NOTE[b]
      })),
      defaultValue: 'ground'
    },
    {
      id: 'cover-art-subject',
      type: 'text',
      group: 'generate',
      prompt: 'Of what?',
      placeholder: 'laid paper with a faint chain line, the colour of old vellum',
      defaultValue: ''
    },
    {
      id: 'cover-art-model',
      type: 'choice',
      group: 'generate',
      prompt: 'Which model?',
      help: 'The number that matters is pixels, not quality: a cover needs about five megapixels at 300 DPI, and most models give one.',
      options: SUGGESTED_ART_MODELS.map((m) => ({
        value: m.slug,
        label: m.label,
        description: m.note
      })),
      defaultValue: SUGGESTED_ART_MODELS[0]?.slug ?? ''
    },
    {
      id: 'cover-art-direction',
      type: 'text',
      group: 'generate',
      prompt: 'Anything else to tell it?',
      defaultValue: '',
      multiline: true
    }
  )

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

function text(answers: Record<string, unknown>, id: string, fallback: string): string {
  const v = answers[id]
  return typeof v === 'string' ? v : fallback
}

function flag(answers: Record<string, unknown>, id: string, fallback: boolean): boolean {
  const v = answers[id]
  return typeof v === 'boolean' ? v : fallback
}

/**
 * Fold answers back into a cover.
 *
 * Everything unanswered keeps the value it had, so a partially-worked gate
 * never resets the rest of the design — the same property `defaultAnswers`
 * gives the wizard, and the reason a user can leave a screen and come back.
 */
export function coverFromAnswers(
  base: CoverDocument,
  answers: Record<string, unknown>
): CoverDocument {
  const doc: CoverDocument = {
    ...base,
    look: { ...base.look, palette: { ...base.look.palette } },
    content: { ...base.content, art: { ...base.content.art, ops: [...base.content.art.ops] } }
  }

  doc.trimSize = text(answers, 'cover-trim', doc.trimSize)
  const paper = text(answers, 'cover-paper', doc.paper)
  if ((PAPERS as readonly string[]).includes(paper)) doc.paper = paper as PaperStock
  const pages = Number(text(answers, 'cover-pages', String(doc.pageCount)))
  if (Number.isFinite(pages) && pages >= 0) doc.pageCount = Math.round(pages)

  doc.look = normalizeLook({
    ...doc.look,
    arrangement: text(answers, 'cover-arrangement', doc.look.arrangement),
    titleFont: text(answers, 'cover-title-font', doc.look.titleFont),
    titleCase: text(answers, 'cover-title-case', doc.look.titleCase),
    rule: text(answers, 'cover-rule', doc.look.rule),
    ornamentId: text(answers, 'cover-ornament', doc.look.ornamentId ?? '') || null,
    spineText: flag(answers, 'cover-spine-text', doc.look.spineText),
    palette: {
      ...doc.look.palette,
      ground: text(answers, 'cover-ground', doc.look.palette.ground),
      ink: text(answers, 'cover-ink', doc.look.palette.ink),
      accent: text(answers, 'cover-accent', doc.look.palette.accent)
    }
  })

  doc.content = {
    ...doc.content,
    title: text(answers, 'cover-title', doc.content.title),
    subtitle: text(answers, 'cover-subtitle', doc.content.subtitle),
    author: text(answers, 'cover-author', doc.content.author),
    series: text(answers, 'cover-series', doc.content.series),
    blurb: text(answers, 'cover-blurb', doc.content.blurb),
    imprint: text(answers, 'cover-imprint', doc.content.imprint)
  }

  return doc
}

/** A cover for a book the app has just set, with everything it already knows. */
export function coverFromInterior(input: {
  trimSize: string
  pageCount: number
  title: string
  author: string
  imprint: string
}): CoverDocument {
  const doc = defaultCover(input.trimSize, input.pageCount)
  doc.content.title = input.title
  doc.content.author = input.author
  doc.content.imprint = input.imprint
  doc.look.spineText = input.pageCount >= MIN_PAGES_FOR_SPINE_TEXT
  return doc
}
