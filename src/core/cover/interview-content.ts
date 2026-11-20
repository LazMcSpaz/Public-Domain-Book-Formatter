/**
 * The cover interview's content and art questions: the words on the cover
 * and where its picture comes from.
 *
 * Pure: questions are data.
 */
import type { Question } from '@core/wizard'
import { ART_BRIEFS, BRIEF_LABEL, BRIEF_NOTE, SUGGESTED_ART_MODELS } from './art'
import { type CoverInterviewState } from './interview'

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
      id: 'cover-edition',
      type: 'text',
      group: 'words',
      prompt: 'What kind of printing is this, if it is worth saying?',
      help: 'Printed under the rule, in small capitals: "Illustrated", "Second Edition", "Complete and Unabridged". It goes under the title rather than above it because it describes this printing, where a collection name describes something the book belongs to.',
      defaultValue: c.edition
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
