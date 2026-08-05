/**
 * The wizard step machine.
 *
 * The flow walks the user from a dropped PDF to a print-ready interior, pausing
 * only at *gates* — batched review points where human judgment actually adds
 * something. Between gates nothing is asked: questions are collected into gates
 * rather than dripped, and a question is never asked before it is relevant
 * (no chapter-ornament question until we know the book has chapters).
 *
 * Pure: a step decides what it needs from the book's current state and returns
 * questions as data. No DOM, no I/O, no model calls — so the whole flow is
 * unit-testable.
 */
import type { LexiconEntry } from '@core/lexicon'
import type { BookMetadata, PageClassification } from '@core/pages'
import { isFrontMatter } from '@core/pages'
import type { VerificationFinding } from '@core/transcribe'
import type { BookDocument } from '@core/assemble'
import { BODY_FONTS, fontForPeriod, trimForKind, type PeriodFeel } from '@core/design'
import { bookWordCount, seamCount } from '@core/assemble'
import type { Answers, Question, TermRow } from './questions'

export type StepId =
  | 'intake'
  | 'recon'
  | 'gate-identity'
  | 'transcribe'
  | 'gate-uncertainties'
  | 'gate-structure'
  | 'design'
  | 'export'

/** Everything the wizard knows about the book so far. */
export interface WizardState {
  /** Source file name, once a PDF is loaded. */
  fileName: string | null
  pageCount: number
  /** Pages rendered + OCR'd so far (drives recon progress). */
  pagesProcessed: number
  /** Harvested vocabulary, highest impact first. */
  lexicon: LexiconEntry[]
  /** Metadata mined from the original front matter. */
  metadata: BookMetadata
  /** Per-page roles, once classified. */
  classifications: PageClassification[]
  /** Resolver for a term's word-crop image (object URL). */
  cropFor?: (tokenId: string) => string | undefined
  /** True when an API key is already stored locally — don't ask again. */
  hasApiKey: boolean
  /** Deterministic findings from verification, most severe first. */
  findings: VerificationFinding[]
  /** Spans the model itself reported as unreadable, per page. */
  uncertainties: { pageIndex: number; text: string; alternatives: string[]; reason: string }[]
  /** Pages that failed transcription entirely. */
  failedPages: number[]
  /** The assembled book, once transcription and assembly have run. */
  document: BookDocument | null
  /** Answers gathered so far, keyed by step then question id. */
  answers: Record<string, Answers>
  /** Steps the user has completed. */
  completed: StepId[]
}

export function initialState(): WizardState {
  return {
    fileName: null,
    pageCount: 0,
    pagesProcessed: 0,
    lexicon: [],
    metadata: {
      title: null,
      subtitle: null,
      author: null,
      originalYear: null,
      originalPublisher: null,
      originalPlace: null,
      contributors: []
    },
    classifications: [],
    hasApiKey: false,
    findings: [],
    uncertainties: [],
    failedPages: [],
    document: null,
    answers: {},
    completed: []
  }
}

export interface Step {
  id: StepId
  title: string
  /** One line describing what happens here, shown under the title. */
  blurb: string
  /** True when this is a review gate (a stop) rather than a running stage. */
  isGate: boolean
  /** Whether the state satisfies this step's prerequisites. */
  canEnter(state: WizardState): boolean
  /** The questions this step asks, given current state. Empty for running stages. */
  questions(state: WizardState): Question[]
}

// --- step definitions -------------------------------------------------------

const intake: Step = {
  id: 'intake',
  title: 'Open a book',
  blurb: 'Drop in the scanned PDF you want to reprint.',
  isGate: false,
  canEnter: () => true,
  questions: () => []
}

const recon: Step = {
  id: 'recon',
  title: 'Reading the book',
  blurb: 'Rendering pages, running OCR, and harvesting this book’s vocabulary. No cost.',
  isGate: false,
  canEnter: (s) => s.fileName !== null && s.pageCount > 0,
  questions: () => []
}

/**
 * Gate 1. Two jobs: confirm what the book *is* (from the original title page),
 * and vet the harvested vocabulary — the highest-leverage ten minutes in the
 * whole flow, because a term fixed once is fixed everywhere it occurs.
 */
const gateIdentity: Step = {
  id: 'gate-identity',
  title: 'Confirm the book',
  blurb: 'Check what I read off the title page, and vet the unusual words I found.',
  isGate: true,
  canEnter: (s) => s.pagesProcessed > 0,
  questions: (s) => {
    const qs: Question[] = []
    const m = s.metadata
    const titlePage = s.classifications.find((c) => c.role === 'title-page')
    const titleEvidence = titlePage
      ? [
          {
            kind: 'image' as const,
            src: `page:${titlePage.pageIndex}`,
            alt: `Original title page (page ${titlePage.pageIndex + 1})`
          }
        ]
      : undefined

    qs.push({
      id: 'title',
      type: 'text',
      prompt: 'Book title',
      help: 'Read from the original title page. This becomes your edition’s title.',
      defaultValue: m.title ?? '',
      placeholder: 'e.g. The Alchemist His Practise',
      required: true,
      evidence: titleEvidence
    })
    qs.push({
      id: 'author',
      type: 'text',
      prompt: 'Author',
      defaultValue: m.author ?? '',
      placeholder: 'e.g. Anonymous',
      required: true
    })
    qs.push({
      id: 'originalYear',
      type: 'text',
      prompt: 'Year of the original edition',
      help: 'Used for the “originally published” line on your copyright page.',
      defaultValue: m.originalYear ?? '',
      placeholder: 'e.g. 1662'
    })

    // Orthography policy — the single most consequential setting for old books.
    qs.push({
      id: 'orthography',
      type: 'choice',
      prompt: 'How should original spelling be handled?',
      help:
        'Old books spell differently on purpose. Preserving keeps the work’s character; ' +
        'modernizing makes it easier to read but is an edit, not a reprint.',
      defaultValue: 'preserve',
      options: [
        {
          value: 'preserve',
          label: 'Preserve original spelling',
          description: 'Recommended. “chirurgeon” and “shew” stay as written.'
        },
        {
          value: 'modernize',
          label: 'Modernize spelling',
          description: 'Rewrites archaic forms into modern English.'
        }
      ]
    })

    // Only ask about long-s if the harvest actually saw one.
    const sawLongS = s.lexicon.some((e) => e.term.includes('ſ'))
    if (sawLongS) {
      qs.push({
        id: 'longS',
        type: 'confirm',
        prompt: 'Convert the long-s (ſ) to a modern s?',
        help: 'This book uses the long-s. Most readers find it hard to read.',
        defaultValue: true
      })
    }

    // The term-review grid: pixels beside the reading, ranked by impact.
    if (s.lexicon.length > 0) {
      const rows: TermRow[] = s.lexicon.map((e) => ({
        id: e.term,
        reading: e.term,
        count: e.count,
        cropSrc: e.sampleTokenId ? s.cropFor?.(e.sampleTokenId) : undefined,
        signals: e.signals,
        pages: e.pages
      }))
      qs.push({
        id: 'terms',
        type: 'term-grid',
        prompt: `Check the ${rows.length} unusual words I found`,
        help:
          'Sorted by how often each appears — the ones at the top affect the most pages. ' +
          'Confirming a word here fixes it everywhere in the book.',
        rows
      })
    }

    return qs
  }
}

/**
 * The transcribe step asks for what it needs *before* spending anything: the
 * key, the model, and an explicit approval of an estimated cost. A whole-book
 * pass costs real money, so the user approves a number rather than discovering
 * one afterwards.
 */
const transcribe: Step = {
  id: 'transcribe',
  title: 'Transcribing',
  blurb: 'Reading each page against the scan and recovering its structure.',
  isGate: false,
  canEnter: (s) => s.completed.includes('gate-identity'),
  questions: (s) => {
    // Once a key is stored the credential question disappears — never ask twice.
    const qs: Question[] = []

    if (!s.hasApiKey) {
      qs.push({
        id: 'apiKey',
        type: 'text',
        prompt: 'Your Anthropic API key',
        help:
          'Stored only in this browser and sent straight to Anthropic. ' +
          'It is never uploaded anywhere else and is never saved into the book project.',
        defaultValue: '',
        placeholder: 'sk-ant-…',
        required: true
      })
    }

    qs.push({
      id: 'model',
      type: 'choice',
      prompt: 'Which model should read the pages?',
      help: 'You are paying for this directly. Higher quality costs more per page.',
      defaultValue: 'claude-opus-5',
      options: [
        {
          value: 'claude-opus-5',
          label: 'Opus — highest quality',
          description: 'Best on damaged scans and unusual typography.'
        },
        {
          value: 'claude-sonnet-5',
          label: 'Sonnet — balanced',
          description: 'Close to Opus on clean scans, roughly a third of the cost.'
        },
        {
          value: 'claude-haiku-4-5',
          label: 'Haiku — cheapest',
          description: 'Fine for clean modern print; weaker on judgment.'
        }
      ]
    })

    qs.push({
      id: 'bookContext',
      type: 'text',
      prompt: 'Anything I should know about this book?',
      help:
        'Subject, period, or quirks. A sentence here measurably improves how ' +
        'unusual words are read.',
      defaultValue: '',
      placeholder: 'e.g. A 1662 alchemical treatise; heavy use of Latin terms.',
      multiline: true
    })

    return qs
  }
}

/**
 * Gate 2. Shows the places worth a human's eye — and only those. The list comes
 * from deterministic cross-checks against OCR plus the model's own reported
 * uncertainties; a page that passed both isn't shown, because reviewing clean
 * pages is how a proofing pass becomes unbearable.
 */
const gateUncertainties: Step = {
  id: 'gate-uncertainties',
  title: 'Check the uncertain spots',
  blurb: 'Everywhere the transcription and the scan disagree, with the pixels beside it.',
  isGate: true,
  canEnter: (s) => s.completed.includes('transcribe'),
  questions: (s) => {
    const qs: Question[] = []

    if (s.failedPages.length > 0) {
      qs.push({
        id: 'failedPages',
        type: 'confirm',
        prompt: `${s.failedPages.length} page(s) could not be transcribed. Continue without them?`,
        help:
          `Pages ${s.failedPages.map((p) => p + 1).join(', ')} failed every attempt. ` +
          'They will be missing from the book unless you re-run.',
        defaultValue: false,
        required: true
      })
    }

    // One question per flagged page, each carrying that page's image.
    const byPage = new Map<number, string[]>()
    for (const f of s.findings) {
      if (f.severity === 'low') continue
      const list = byPage.get(f.pageIndex) ?? []
      list.push(f.message)
      byPage.set(f.pageIndex, list)
    }
    for (const u of s.uncertainties) {
      const list = byPage.get(u.pageIndex) ?? []
      const alts = u.alternatives.length ? ` (could be: ${u.alternatives.join(', ')})` : ''
      list.push(`Couldn't read “${u.text}” — ${u.reason}${alts}`)
      byPage.set(u.pageIndex, list)
    }

    for (const [pageIndex, messages] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      qs.push({
        id: `page-${pageIndex}`,
        type: 'choice',
        prompt: `Page ${pageIndex + 1}`,
        help: messages.join(' · '),
        defaultValue: 'accept',
        evidence: [
          { kind: 'image', src: `page:${pageIndex}`, alt: `Scan of page ${pageIndex + 1}` }
        ],
        options: [
          { value: 'accept', label: 'Looks fine', description: 'Keep the transcription as-is.' },
          {
            value: 'redo',
            label: 'Read this page again',
            description: 'Re-run at higher resolution.'
          },
          { value: 'skip', label: 'Leave this page out', description: 'Exclude it from the book.' }
        ]
      })
    }

    return qs
  }
}

/**
 * Gate 3. The book now exists as a document; this is where its shape gets
 * confirmed before any design work. Chapters drive the regenerated table of
 * contents, so a wrong one here propagates through the whole edition.
 */
const gateStructure: Step = {
  id: 'gate-structure',
  title: 'Confirm the structure',
  blurb: 'Chapters, footnotes, and what was left out.',
  isGate: true,
  canEnter: (s) => s.completed.includes('gate-uncertainties'),
  questions: (s) => {
    const doc = s.document
    if (!doc) return []
    const qs: Question[] = []

    // A summary first: the numbers make an obviously-wrong assembly visible at
    // a glance (two chapters in a 300-page book means detection failed).
    const summary = [
      `${doc.chapters.length} chapter(s)`,
      `${bookWordCount(doc).toLocaleString()} words`,
      `${doc.footnotes.length} footnote(s)`,
      `${seamCount(doc)} paragraph(s) rejoined across page breaks`,
      `${doc.skipped.length} page(s) not transcribed`
    ].join(' · ')

    qs.push({
      id: 'structureOk',
      type: 'confirm',
      prompt: 'Does this look like the right shape for the book?',
      help: summary,
      defaultValue: true,
      required: true,
      evidence: [
        {
          kind: 'text',
          label: 'Chapters found (these become your table of contents)',
          text:
            doc.chapters.length > 0
              ? doc.chapters.map((c) => `${'  '.repeat(c.level - 1)}${c.title}`).join('\n')
              : 'None found — the book will have no table of contents.'
        }
      ]
    })

    // Orphaned notes can't be placed automatically; ask rather than guess.
    const orphans = doc.footnotes.filter((f) => f.orphaned)
    if (orphans.length > 0) {
      qs.push({
        id: 'orphanNotes',
        type: 'choice',
        prompt: `${orphans.length} footnote(s) have no reference mark in the text`,
        help:
          'Their markers were never found in the body, so they cannot be placed ' +
          'automatically. ' +
          orphans.map((o) => `“${o.text.slice(0, 60)}…”`).join(' · '),
        defaultValue: 'endnotes',
        options: [
          {
            value: 'endnotes',
            label: 'Collect them at the end of the book',
            description: 'Keeps the text; you can place them properly later.'
          },
          { value: 'omit', label: 'Leave them out', description: 'They will not appear at all.' }
        ]
      })
    }

    // Pages the pipeline deliberately dropped — shown so nothing vanishes quietly.
    if (doc.skipped.length > 0) {
      qs.push({
        id: 'skippedOk',
        type: 'confirm',
        prompt: `${doc.skipped.length} page(s) were left out on purpose. That's expected — confirm?`,
        help: doc.skipped
          .map((sk) => `p${sk.pageIndex + 1} (${sk.role}): ${sk.reason}`)
          .join(' · '),
        defaultValue: true
      })
    }

    return qs
  }
}

/**
 * Design by interview. Five questions about the *book* produce a complete
 * style — the alternative is a panel of forty fields that assumes the user
 * already knows what a gutter is. The detailed controls remain available
 * afterwards; they are just never the front door.
 */
const design: Step = {
  id: 'design',
  title: 'Design the edition',
  blurb: 'A few questions about the book, and I’ll set the rest.',
  isGate: true,
  canEnter: (s) => s.completed.includes('gate-structure'),
  questions: (s) => {
    // The period answer picks the typeface, so it is read back here to
    // pre-select the matching font rather than making the user match them.
    const designAnswers = s.answers['design'] ?? {}
    const period = (designAnswers['period'] as PeriodFeel) ?? 'early-modern'
    const suggested = fontForPeriod(period)
    const kind = (designAnswers['kind'] as string) ?? 'novel'

    return [
      {
        id: 'kind',
        type: 'choice',
        prompt: 'What kind of book is this?',
        help: `Sets the page size, margins, and text size. Currently ${trimForKind(kind as never)}in.`,
        defaultValue: 'novel',
        options: [
          { value: 'novel', label: 'Novel or narrative', description: '6×9in — the standard.' },
          { value: 'nonfiction', label: 'Non-fiction prose', description: '6×9in.' },
          {
            value: 'poetry',
            label: 'Poetry or verse',
            description: '5.5×8.5in — a narrower measure so lines don’t wrap.'
          },
          { value: 'illustrated', label: 'Heavily illustrated', description: '7×10in.' },
          { value: 'reference', label: 'Reference or technical', description: '7×10in.' }
        ]
      },
      {
        id: 'period',
        type: 'choice',
        prompt: 'What period should it feel like?',
        help: 'Chooses the typeface. All options are licensed for books you sell.',
        defaultValue: 'early-modern',
        options: [
          {
            value: 'early-modern',
            label: '17th century',
            description: 'IM FELL — digitized from real Oxford types of the era.'
          },
          { value: 'georgian', label: '18th century', description: 'Libre Caslon.' },
          { value: 'victorian', label: '19th century', description: 'Libre Baskerville.' },
          { value: 'modern', label: 'Clean and modern', description: 'Crimson Pro.' }
        ]
      },
      {
        id: 'font',
        type: 'choice',
        prompt: 'Typeface',
        help: `Suggested for that period: ${suggested.label}. ${suggested.note}`,
        defaultValue: suggested.id,
        options: BODY_FONTS.map((f) => ({
          value: f.id,
          label: f.label,
          description: f.note
        }))
      },
      {
        id: 'chapterOpener',
        type: 'choice',
        prompt: 'How should chapters open?',
        defaultValue: 'plain',
        options: [
          { value: 'plain', label: 'Plain', description: 'Just the chapter title.' },
          {
            value: 'ornamented',
            label: 'With a printer’s ornament',
            description: 'A ruled flourish beneath the chapter title.'
          },
          { value: 'drop-cap', label: 'Drop capital', description: 'A large opening initial.' }
        ]
      },
      {
        id: 'runningHeads',
        type: 'choice',
        prompt: 'What should appear at the top of each page?',
        help: 'Left and right pages carry different text, as in a printed book.',
        defaultValue: 'author-title',
        options: [
          {
            value: 'author-title',
            label: 'Author and title',
            description: 'Author on the left page, title on the right.'
          },
          {
            value: 'chapter',
            label: 'Title and chapter',
            description: 'Title on the left, current chapter on the right.'
          },
          { value: 'none', label: 'Nothing', description: 'Page numbers only.' }
        ]
      }
    ]
  }
}

/**
 * The last gate. Everything else was recovered from the book; these are the
 * facts about *this edition* that only its publisher knows, and they all land
 * on the copyright page.
 */
const exportStep: Step = {
  id: 'export',
  title: 'Publish the edition',
  blurb: 'The last few details, then the print-ready interior.',
  isGate: true,
  canEnter: (s) => s.completed.includes('design'),
  questions: (s) => {
    const identity = s.answers['gate-identity'] ?? {}
    const author = (identity['author'] as string) ?? s.metadata.author ?? ''
    const originalYear = (identity['originalYear'] as string) ?? s.metadata.originalYear ?? null
    const thisYear = String(new Date().getFullYear())

    return [
      {
        id: 'imprint',
        type: 'text',
        prompt: 'Who is publishing this edition?',
        help:
          'Your imprint or your own name — not the original publisher. It appears on ' +
          'the copyright page.',
        defaultValue: '',
        placeholder: 'e.g. Blackthorn Press'
      },
      {
        id: 'copyrightHolder',
        type: 'text',
        prompt: 'Who holds the copyright in this edition?',
        help:
          'The original text is public domain, so this covers only your new typesetting, ' +
          'notes, and design.',
        defaultValue: '',
        placeholder: author ? `e.g. your name (the author was ${author})` : 'e.g. your name'
      },
      {
        id: 'editionDate',
        type: 'text',
        prompt: 'Publication year of this edition',
        defaultValue: thisYear,
        placeholder: thisYear
      },
      {
        id: 'editionStatement',
        type: 'text',
        prompt: 'Edition statement',
        help: 'A single line describing this printing.',
        defaultValue: originalYear ? `A new edition of the ${originalYear} original.` : '',
        placeholder: 'e.g. First modern edition.'
      },
      {
        id: 'isbn',
        type: 'text',
        prompt: 'ISBN, if you have one',
        help: 'Leave blank to use the free ISBN KDP assigns at publication.',
        defaultValue: '',
        placeholder: '978-…'
      },
      {
        id: 'publicDomainNotice',
        type: 'confirm',
        prompt: 'State on the copyright page that the original work is public domain?',
        help:
          'Recommended. It is accurate, it tells readers what they are buying, and it ' +
          'makes clear that your claim covers only this edition.',
        defaultValue: true
      }
    ]
  }
}

export const STEPS: readonly Step[] = [
  intake,
  recon,
  gateIdentity,
  transcribe,
  gateUncertainties,
  gateStructure,
  design,
  exportStep
]

export function stepById(id: StepId): Step {
  const s = STEPS.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown wizard step: ${id}`)
  return s
}

/**
 * The step the user is on: the first incomplete step whose prerequisites are
 * met. While a stage is still running its prerequisites may not be satisfied
 * yet (a book mid-recon has no page count), so the fallback is the first
 * incomplete step — never the last one, which would jump the flow to Export.
 */
export function activeStep(state: WizardState): Step {
  for (const step of STEPS) {
    if (!state.completed.includes(step.id) && step.canEnter(state)) return step
  }
  return STEPS.find((s) => !state.completed.includes(s.id)) ?? STEPS[STEPS.length - 1]!
}

/** Progress across the whole flow, for the rail. */
export function progress(state: WizardState): { done: number; total: number; pct: number } {
  const total = STEPS.length
  const done = state.completed.length
  return { done, total, pct: Math.round((done / total) * 100) }
}

/**
 * Front-matter pages, grouped for the identity gate so the user can see which
 * pages were treated as metadata rather than transcribed.
 */
export function frontMatterPages(state: WizardState): PageClassification[] {
  return state.classifications
    .filter((c) => isFrontMatter(c.role))
    .sort((a, b) => a.pageIndex - b.pageIndex)
}
