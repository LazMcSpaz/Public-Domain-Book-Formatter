/**
 * The cover interview's look questions: the arrangement, faces, colours,
 * grounds, rules, frame and sizes.
 *
 * Pure: questions are data.
 */
import type { Question } from '@core/wizard'
import { BUILTIN_ORNAMENTS } from '@core/ornament'
import { ARRANGEMENTS, ARRANGEMENT_LABEL, normalizeLook } from './document'
import { GROUND_PATTERNS, PATTERN_LABEL, PATTERN_NOTE } from './patterns'
import { FIGURE_LABEL, FIGURE_NOTE, GROUND_FIGURES } from './figures'
import { describeSavedCoverLook } from './profile'
import { lookFollowUps } from './interview-follow'
import { type CoverInterviewState, fontOptions } from './interview'

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
      id: 'cover-subtitle-points',
      type: 'choice',
      group: 'look',
      prompt: 'How big is the subtitle, in points?',
      help: 'By default it is a share of the title, which suits one book: a long title sets smaller and takes its subtitle down with it. A collection wants the opposite \u2014 the same size on every board, whatever the title above it does \u2014 so pinning the points is what makes six volumes look like one press along a shelf.',
      options: [
        { value: '', label: 'A share of the title \u2014 right for a single book' },
        { value: '13', label: '13 pt on every volume' },
        { value: '15', label: '15 pt on every volume' },
        { value: '18', label: '18 pt \u2014 a subtitle that names the volume' }
      ],
      defaultValue: look.subtitleSizePt === null ? '' : String(look.subtitleSizePt)
    },
    {
      id: 'cover-author-size',
      type: 'choice',
      group: 'look',
      prompt: 'How big is the author\u2019s name?',
      help: 'The same question as the subtitle, and the same answer: by default it is a share of the fitted title, so two books in one collection print the name at two sizes. A reader along a shelf is often looking for the name rather than the title, so it is never set below sixteen points whatever is asked for here.',
      options: [
        { value: '', label: 'A share of the title \u2014 right for a single book' },
        { value: '20', label: '20 pt on every volume' },
        { value: '24', label: '24 pt on every volume' },
        { value: '28', label: '28 pt \u2014 the name read first' }
      ],
      defaultValue: look.authorSizePt === null ? '' : String(look.authorSizePt)
    },
    {
      id: 'cover-spine-size',
      type: 'choice',
      group: 'look',
      prompt: 'How big is the type on the spine?',
      help: 'The spine is the part of a book a shelf shows, and left to itself the engine takes the largest size each fold allows \u2014 which differs book by book with how long the title is. Pinning it gives a collection one size along all of them. A fold too thin for it sets smaller and says so.',
      options: [
        { value: '', label: 'As large as each fold allows' },
        { value: '20', label: '20 pt on every volume' },
        { value: '27', label: '27 pt on every volume' },
        { value: '32', label: '32 pt \u2014 read across a room' }
      ],
      defaultValue: look.spineSizePt === null ? '' : String(look.spineSizePt)
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

  out.push(...lookFollowUps(state, look))
  return out
}
