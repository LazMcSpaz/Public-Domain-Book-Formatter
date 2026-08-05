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

const gateStructure: Step = {
  id: 'gate-structure',
  title: 'Confirm the structure',
  blurb: 'Chapters, footnotes, and illustrations found in the book.',
  isGate: true,
  canEnter: (s) => s.completed.includes('gate-uncertainties'),
  questions: () => []
}

const design: Step = {
  id: 'design',
  title: 'Design the edition',
  blurb: 'A few questions, then a real rendered preview you can adjust.',
  isGate: true,
  canEnter: (s) => s.completed.includes('gate-structure'),
  questions: () => []
}

const exportStep: Step = {
  id: 'export',
  title: 'Export',
  blurb: 'Build the print-ready interior PDF and check it against KDP’s rules.',
  isGate: false,
  canEnter: (s) => s.completed.includes('design'),
  questions: () => []
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
