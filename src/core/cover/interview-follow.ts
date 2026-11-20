/**
 * The look's follow-up questions, asked only once what they are about has
 * been chosen.
 *
 * Pure: questions are data.
 */
import type { Question } from '@core/wizard'
import { type CoverLook } from './document'
import { coverGeometry } from './geometry'
import { PATTERN_OPACITY } from './patterns'
import { type CoverInterviewState } from './interview'

/**
 * The look's follow-up questions: the ones that wait until what they ask about
 * has been chosen (a figure, a ground, a device, a spine wide enough for type).
 */
export function lookFollowUps(state: CoverInterviewState, look: CoverLook): Question[] {
  const { doc } = state
  const out: Question[] = []
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
    out.push({
      id: 'cover-figure-edge',
      type: 'confirm',
      group: 'ornament',
      prompt: 'Run the figure to the edges, without fading it?',
      help: 'A figure normally fades to nothing just inside the trim, which suits a picture that stops. A line drawing meant to run off the cover reads as cut short by the fade. A figure that stops at the fold keeps its fade there either way, so the two sides never have to meet.',
      defaultValue: look.groundFigureToEdge
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
  // How faint the ground prints is a question about a ground, so it waits
  // until one is chosen — the same sequencing the figure's own follow-up uses.
  if (look.groundPattern) {
    out.push({
      id: 'cover-pattern-opacity',
      type: 'choice',
      group: 'ornament',
      prompt: 'How faint is the texture?',
      help: `Each pattern carries a value measured against what it is made of, and this overrules it. Three per cent is where a press stops being relied on to hold a tint; past a fifth the ground competes with the type.`,
      options: [
        {
          value: '',
          label: `This pattern’s own — ${Math.round(PATTERN_OPACITY[look.groundPattern] * 100)}%`
        },
        { value: '0.05', label: '5% — barely there' },
        { value: '0.08', label: '8% — a visible surface' },
        { value: '0.12', label: '12% — plainly a pattern' },
        { value: '0.2', label: '20% — a pattern the type sits on' }
      ],
      defaultValue: look.groundPatternOpacity === null ? '' : String(look.groundPatternOpacity)
    })
  }

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
