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
  type CoverDocument,
  type FrameStyle
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
import { GROUND_PATTERNS, PATTERN_LABEL, PATTERN_NOTE, type GroundPattern } from './patterns'
import { FIGURE_LABEL, FIGURE_NOTE, GROUND_FIGURES, type GroundFigure } from './figures'
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
      id: 'cover-ground-pattern',
      type: 'choice',
      group: 'ornament',
      prompt: 'A texture across the whole wrap?',
      help: 'Drawn as vector at a few per cent of the ink, so it runs across the back, the spine and the front as one field. Faint enough to be a surface rather than a decoration — and allover, so the fold has nothing to misregister.',
      options: [
        { value: '', label: 'None' },
        ...GROUND_PATTERNS.map((p) => ({
          value: p,
          label: PATTERN_LABEL[p],
          description: PATTERN_NOTE[p]
        }))
      ],
      defaultValue: doc.look.groundPattern ?? ''
    },
    {
      id: 'cover-subtitle-size',
      type: 'choice',
      group: 'look',
      prompt: 'How big is the subtitle beside the title?',
      help: 'A share of the title rather than a size of its own, so a longer title on the next volume carries its subtitle down with it. Small is right for an explanatory phrase; a reprinted multi-volume work, where the subtitle names the volume, is read along a shelf and wants more.',
      options: [
        { value: '', label: 'Small — an explanatory phrase under the title' },
        { value: '0.55', label: 'Over half the title' },
        { value: '0.7', label: 'Two thirds — the subtitle names the volume' },
        { value: '1', label: 'The title’s own size — two halves of one name' }
      ],
      defaultValue: look.subtitleRatio === null ? '' : String(look.subtitleRatio)
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
      id: 'cover-figure',
      type: 'choice',
      group: 'ornament',
      prompt: 'A figure behind the title?',
      help: 'One large picture on the front panel, printed very faint and bled off three edges. Unlike a texture it stops at the fold, because a picture with a centre shows a fold that has crept.',
      options: [
        { value: '', label: 'None' },
        ...GROUND_FIGURES.map((f) => ({
          value: f,
          label: FIGURE_LABEL[f],
          description: FIGURE_NOTE[f]
        }))
      ],
      defaultValue: look.groundFigure ?? ''
    },
    {
      id: 'cover-frame',
      type: 'choice',
      group: 'ornament',
      prompt: 'A frame round the front cover?',
      help: 'Struck in the accent colour, an eighth of an inch inside the safe line so a trim that wanders does not show. Front only: the back cover\u2019s border would run under the barcode.',
      options: [
        { value: 'none', label: 'No frame' },
        { value: 'plain', label: 'A plain frame' },
        { value: 'double', label: 'A double frame' }
      ],
      defaultValue: look.frontFrame
    },
    {
      id: 'cover-blurb-size',
      type: 'choice',
      group: 'look',
      prompt: 'How big is the copy on the back cover?',
      help: 'The back cover is read at arm\u2019s length off a shelf or at thumbnail size in a listing, where a page size is small. What a larger one costs is words: the block has a bottom it has to stay above, and anything past it is reported rather than set.',
      options: [
        { value: '', label: 'Book size \u2014 reads like a page of the book' },
        { value: '12', label: 'Larger' },
        { value: '13.5', label: 'Largest \u2014 a short, bold blurb' }
      ],
      defaultValue: look.blurbSizePt === null ? '' : String(look.blurbSizePt)
    },
    {
      id: 'cover-blurb-frame',
      type: 'choice',
      group: 'ornament',
      prompt: 'A frame round the copy on the back cover?',
      help: 'Struck round the copy itself rather than round the panel, in the accent colour \u2014 a border on the back board would run under the rectangle the barcode prints over, which is why the front frame is front only.',
      options: [
        { value: 'none', label: 'No frame' },
        { value: 'plain', label: 'A plain frame' },
        { value: 'double', label: 'A double frame' }
      ],
      defaultValue: look.blurbBorder
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

  // Never ask what is not relevant yet: a typographic cover puts the author at
  // the foot whatever the answer, the empty middle of the panel being its whole
  // design, so there is nothing to decide.
  if (look.groundFigure) {
    out.push({
      id: 'cover-figure-wrap',
      type: 'confirm',
      group: 'ornament',
      prompt: 'Run the figure across the whole cover?',
      help: 'A figure normally stops at the fold, because a scene split into two boxes either side of a fold that creeps by an eighth of an inch is two halves that do not meet. One picture printed across the whole sheet has no seam to misregister — what it costs is that the subject sits up to an eighth of an inch off the front panel\u2019s centre line, which a radiance hides and a face would not.',
      defaultValue: look.groundFigureWrap
    })
  }

  if (look.arrangement !== 'typographic') {
    out.push({
      id: 'cover-author-foot',
      type: 'confirm',
      group: 'ornament',
      prompt: 'Set the author at the foot of the board?',
      help: 'The author normally sits in the block under the title. Move it down where something else wants that place \u2014 a ground whose subject is set under the rule prints behind the name otherwise.',
      defaultValue: look.authorAtFoot
    })
  }

  // How faint the figure prints, and what colour it prints in, are questions
  // about a figure — so they wait until there is one, the way the device's own
  // follow-up does below.
  if (look.groundFigure) {
    out.push(
      {
        id: 'cover-figure-opacity',
        type: 'choice',
        group: 'ornament',
        prompt: 'How faint?',
        help: `Five per cent is where a print-on-demand press is relied on to hold a tint; three is where it starts depending on the machine and the stock, and is offered because the editor decides and a proof settles it. Past a fifth the figure competes with the title.`,
        options: [
          { value: '0.03', label: '3% — hardly there, and not guaranteed to print' },
          { value: '0.05', label: '5% — barely there' },
          { value: '0.08', label: '8% — a visible ghost' },
          { value: '0.12', label: '12% — plainly a picture' },
          { value: '0.2', label: '20% — a picture the title sits on' }
        ],
        defaultValue: String(look.groundFigureOpacity)
      },
      {
        id: 'cover-figure-back',
        // A `confirm`, not a two-option `choice`: `flag` reads booleans, and a
        // choice answering 'yes' into it is the fault `frontTitleBorder` shipped
        // — every test passed and no book ever drew the thing.
        type: 'confirm',
        group: 'ornament',
        prompt: 'Does the back carry it too?',
        help: 'The same picture mirrored across the back and the spine, at the same tint, fading out before it reaches the fold. It fades rather than meets: the fold creeps by up to an eighth of an inch, so two halves of one scene joined at it will not join on the printed copy.',
        defaultValue: look.groundFigureBack
      },
      {
        id: 'cover-figure-ink',
        type: 'text',
        group: 'ornament',
        prompt: 'What colour does the figure print in?',
        help: 'Its own colour rather than the ink\u2019s, because a ghost behind white type is usually warmer than the type. Reach for a saturated colour rather than a pale one: at three per cent both lift the ground by the same few points, and it is the saturated one that lifts it unevenly enough to have a hue at all — measured over a brown board, a pale gold came back two points warmer than the ground and a full gold six.',
        defaultValue: look.palette.figure
      }
    )
  }

  // Likewise: where a book is being set from a press with no device, whether
  // that device also prints on the front is not a question about this book.
  if (look.pressMark) {
    out.push({
      id: 'cover-mark-front',
      type: 'confirm',
      group: 'ornament',
      prompt: 'Print the mark on the front as well?',
      help: 'Above the title, at about an inch. It prints at the foot of the spine either way.',
      defaultValue: look.markOnFront
    })
  }

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
      id: 'cover-works',
      type: 'text',
      group: 'words',
      prompt: 'Does this volume bind more than one work?',
      help: 'One title per line, and only when there really is more than one. They print at the same size with a rule around them, which is what a publisher binding two treatises together did — not “2 books in 1”, which is a bundle rather than an edition. Leave it empty for an ordinary book.',
      defaultValue: c.works.join('\n'),
      placeholder: 'The Astral World\nThe Human Aura',
      multiline: true
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
    subtitleRatio: (() => {
      const asked = text(
        answers,
        'cover-subtitle-size',
        doc.look.subtitleRatio === null ? '' : String(doc.look.subtitleRatio)
      )
      const n = Number(asked)
      return asked.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
    })(),
    frontFrame: text(answers, 'cover-frame', doc.look.frontFrame),
    blurbSizePt: (() => {
      const asked = text(
        answers,
        'cover-blurb-size',
        doc.look.blurbSizePt === null ? '' : String(doc.look.blurbSizePt)
      )
      const n = Number(asked)
      return asked.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
    })(),
    blurbBorder: text(answers, 'cover-blurb-frame', doc.look.blurbBorder) as FrameStyle,
    authorAtFoot: flag(answers, 'cover-author-foot', doc.look.authorAtFoot),
    groundFigure:
      (text(answers, 'cover-figure', doc.look.groundFigure ?? '') as GroundFigure | '') || null,
    groundFigureOpacity: Number(
      text(answers, 'cover-figure-opacity', String(doc.look.groundFigureOpacity))
    ),
    groundFigureBack: flag(answers, 'cover-figure-back', doc.look.groundFigureBack),
    groundFigureWrap: flag(answers, 'cover-figure-wrap', doc.look.groundFigureWrap),
    markOnFront: flag(answers, 'cover-mark-front', doc.look.markOnFront),
    ornamentId: text(answers, 'cover-ornament', doc.look.ornamentId ?? '') || null,
    groundPattern:
      (text(answers, 'cover-ground-pattern', doc.look.groundPattern ?? '') as GroundPattern | '') ||
      null,
    spineText: flag(answers, 'cover-spine-text', doc.look.spineText),
    palette: {
      ...doc.look.palette,
      ground: text(answers, 'cover-ground', doc.look.palette.ground),
      ink: text(answers, 'cover-ink', doc.look.palette.ink),
      accent: text(answers, 'cover-accent', doc.look.palette.accent),
      figure: text(answers, 'cover-figure-ink', doc.look.palette.figure)
    }
  })

  const works = text(answers, 'cover-works', doc.content.works.join('\n'))
  doc.content = {
    ...doc.content,
    title: text(answers, 'cover-title', doc.content.title),
    works: works
      .split('\n')
      .map((w) => w.trim())
      .filter((w) => w.length > 0),
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
