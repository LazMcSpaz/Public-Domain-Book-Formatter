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
import { describeAge, type SavedRunSummary } from '@core/project'
import type { BookDocument } from '@core/assemble'
import { defaultVoice, type EditorVoice } from '@core/annotate'
import {
  BODY_FONTS,
  fontForPeriod,
  profileFromAnswers,
  trimForKind,
  type DesignAnswers,
  type PeriodFeel
} from '@core/design'
import {
  applyStyleAnswers,
  describeSavedProfile,
  emptyImprint,
  type ImprintFields,
  type SavedStyleProfile
} from '@core/style'
import type { StyleProfile } from '@core/model'
import { bookWordCount, seamCount } from '@core/assemble'
import type { Answers, Question, TermRow } from './questions'

export type StepId =
  | 'intake'
  | 'recon'
  | 'gate-identity'
  | 'transcribe'
  | 'gate-uncertainties'
  | 'gate-structure'
  | 'proof'
  | 'annotate'
  | 'design'
  | 'export'

/**
 * A region the recon pass believes is a picture, described for review.
 *
 * Kept free of pixels and of platform types on purpose: the step machine only
 * needs to know a candidate exists, where it is, and where its crop can be
 * found, which is what lets the whole gate be tested with no canvas.
 */
export interface IllustrationCandidate {
  id: string
  pageIndex: number
  /**
   * The region on the rendered page, in source pixels. Plain numbers, so
   * carrying it here costs the core nothing — and it is what the crop is taken
   * from once the user has said yes, so the answer would be unusable without it.
   */
  bbox: { x0: number; y0: number; x1: number; y1: number }
  /** Object URL of the region's pixels — the evidence the question shows. */
  previewUrl: string
  /** Fraction of the region that is ink; how strong the guess is. */
  ink: number
}

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
  /**
   * A transcription of *this* file that was paid for on an earlier visit, if
   * there is one. Its presence changes the transcribe step from "approve this
   * cost" to "you have already paid for this — use it?".
   */
  savedRun: SavedRunSummary | null
  /**
   * Whether scans are kept on this device. `null` until the user has been
   * asked. A device-level answer, not a per-book one.
   */
  keepScans: boolean | null
  /**
   * The look a fresh book starts from — the shipped defaults, or whatever they
   * were edited to in Settings. Passed in because it lives in browser storage
   * and this module stays pure.
   */
  defaultLook: StyleProfile | null
  /** The model the user reached for last, so the gate can offer it again. */
  defaultModelId: string
  /**
   * Per-book tweaks to the look, from "anything you'd change?" at the design
   * gate.
   *
   * Kept apart from the answers that *built* the style rather than folded into
   * them, for the same reason corrections are kept apart from the
   * transcription: the five questions and the banked look stay what they were,
   * and every tweak can be dropped without rebuilding anything. They belong to
   * this book alone — banking a look is what makes a change travel.
   */
  styleOverrides: Answers
  /**
   * The measured facts the storage question shows: how big this scan is, and
   * how much room this browser will give the app. `quota`/`usage` are null
   * where the browser declines to say, and the question then asks without
   * figures rather than with invented ones.
   */
  storage: { scanBytes: number; quota: number | null; usage: number | null } | null
  /**
   * Looks the user has banked from earlier books (SPEC §7). Whole records, not
   * summaries, so the design gate can preview one the instant it is chosen —
   * and so this stays a pure function of state.
   */
  styleProfiles: SavedStyleProfile[]
  /** Deterministic findings from verification, most severe first. */
  findings: VerificationFinding[]
  /** Spans the model itself reported as unreadable, per page. */
  uncertainties: { pageIndex: number; text: string; alternatives: string[]; reason: string }[]
  /** Pages that failed transcription entirely. */
  failedPages: number[]
  /**
   * Illustrations the recon pass thinks it found, each with a crop to judge it
   * by. Candidates, not decisions — the structure gate asks about every one.
   */
  illustrationCandidates: IllustrationCandidate[]
  /** The assembled book, once transcription and assembly have run. */
  document: BookDocument | null
  /**
   * The editor's voice, as banked on this device.
   *
   * Part of the state rather than read at the gate because the annotate step's
   * questions arrive *prefilled from it* — which is the whole of what "book two
   * asks less" means for the notes, exactly as the banked look is for the
   * design.
   */
  voice: EditorVoice
  /**
   * What the user is collecting towards, remembered across books.
   *
   * A property of the person and their project rather than of any one book,
   * like the editor's voice — someone building towards a history of glassmaking
   * is still building towards it on the next volume.
   */
  harvestInterest: string
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
    savedRun: null,
    keepScans: null,
    defaultLook: null,
    defaultModelId: 'claude-opus-5',
    styleOverrides: {},
    storage: null,
    styleProfiles: [],
    findings: [],
    uncertainties: [],
    failedPages: [],
    illustrationCandidates: [],
    document: null,
    voice: defaultVoice(),
    harvestInterest: '',
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
 * Gate 1. Decide how the book's own language should be read, and vet the
 * harvested vocabulary — the highest-leverage ten minutes in the whole flow,
 * because a term fixed once is fixed everywhere it occurs.
 *
 * Deliberately *not* here: the title, the author and the year. Asking for them
 * at this point means asking a question the app cannot yet help with — the
 * title page has been rendered but not read, so the field would come up empty
 * and the user would have to go and open the PDF somewhere else to fill it in.
 * The vision pass reads the front matter as part of the run they are already
 * paying for; by the export gate the answers are already sitting in the boxes,
 * and confirming three prefilled fields is a glance rather than an errand.
 */
const gateIdentity: Step = {
  id: 'gate-identity',
  title: 'Confirm how to read it',
  blurb: 'Decide how the original spelling is handled, and vet the unusual words I found.',
  isGate: true,
  canEnter: (s) => s.pagesProcessed > 0,
  questions: (s) => {
    const qs: Question[] = []

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
    //
    // Only terms whose crop actually exists are offered. Rendering crops is
    // capped (each one costs a page re-render), and the grid used to list the
    // whole lexicon regardless — so past the cap every row read "no crop",
    // asking the user to vet a word with no evidence at all. That is the one
    // thing this gate must never do.
    const reviewable = s.cropFor
      ? s.lexicon.filter((e) => e.sampleTokenId && s.cropFor?.(e.sampleTokenId))
      : s.lexicon
    if (reviewable.length > 0) {
      const rows: TermRow[] = reviewable.map((e) => ({
        id: e.term,
        reading: e.term,
        count: e.count,
        cropSrc: e.sampleTokenId ? s.cropFor?.(e.sampleTokenId) : undefined,
        signals: e.signals,
        pages: e.pages
      }))
      // Say plainly when the list is a subset, rather than implying the book
      // only had this many unusual words.
      const held = s.lexicon.length - reviewable.length
      qs.push({
        id: 'terms',
        type: 'term-grid',
        prompt:
          held > 0
            ? `Check the ${rows.length} highest-impact of ${s.lexicon.length} unusual words`
            : `Check the ${rows.length} unusual words I found`,
        help:
          'Sorted by how often each appears — the ones at the top affect the most pages. ' +
          'Confirming a word here fixes it everywhere in the book.' +
          (held > 0
            ? ` The other ${held} appear less often; they are still given to the model as context.`
            : ''),
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

    // The user has already paid to have this exact file read. Asking them to
    // approve the cost again — or worse, spending it silently — would be the
    // app forgetting something they cannot get back for free. Everything else
    // in the flow is regenerated from the scan on the way here, so accepting
    // this is a complete resumption, not a degraded one.
    if (s.savedRun) {
      const run = s.savedRun
      const failed =
        run.failedPages > 0 ? ` ${run.failedPages} page(s) failed and stayed unread.` : ''

      // A run stopped partway is a different offer from a finished one, and
      // the difference is money. Finished: use it, free. Partway: the pages
      // already bought are kept and only the rest are read, so the choice is
      // between paying for what is left and paying for the whole book again.
      const remaining = Math.max(0, s.pageCount - run.pageCount)
      qs.push(
        run.complete
          ? {
              id: 'useSavedRun',
              type: 'choice',
              prompt: 'You have already had this book read.',
              help:
                `${run.pageCount} page(s), transcribed ${describeAge(run.savedAt)} by ` +
                `${run.modelId}.${failed} Reading it again would cost the same as the first time.`,
              defaultValue: 'use',
              options: [
                {
                  value: 'use',
                  label: 'Use what I already paid for',
                  description: 'Free, and immediate.'
                },
                {
                  value: 'again',
                  label: 'Read it again',
                  description: 'Only worth it if the first reading went badly.'
                }
              ]
            }
          : {
              id: 'useSavedRun',
              type: 'choice',
              prompt: 'The last reading of this book stopped partway.',
              help:
                `${run.pageCount} of ${s.pageCount} page(s) were read ${describeAge(run.savedAt)} ` +
                `by ${run.modelId}, and are paid for.${failed} ` +
                'Carrying on reads only the pages that are left.',
              defaultValue: 'resume',
              options: [
                {
                  value: 'resume',
                  label: `Carry on from page ${run.pageCount + 1}`,
                  description: `${remaining} page(s) left to read — you pay only for those.`
                },
                {
                  value: 'again',
                  label: 'Start the reading over',
                  description: 'Pays for all the pages again, including the ones already read.'
                }
              ]
            }
      )

      // The rest of this gate is about *spending*, so it has nothing to ask
      // when the user is taking a finished run as it stands. Resuming *does*
      // spend, so it goes on to the model and cost questions.
      const answers = s.answers['transcribe'] ?? {}
      const choice = (answers['useSavedRun'] as string) ?? (run.complete ? 'use' : 'resume')
      if (run.complete && choice === 'use') return qs
    }

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
      // The one you used last, kept in Settings. It was already being saved
      // after every run and then ignored here, so choosing Sonnet once meant
      // choosing it again on every book.
      defaultValue: s.defaultModelId,
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

    // Last, and after the questions that decide what this run costs in money.
    // Space is the other resource the gate commits, but it is the smaller
    // decision and a wrong answer here is reversible — so it does not stand
    // between the user and the thing they came to approve. Asked once, and
    // never about the transcription.
    if (s.keepScans === null) {
      qs.push(keepScansQuestion(s))
    }

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

    // Illustrations. Detection is explicitly a first guess (SPEC §6), so every
    // candidate is shown with its own pixels and the user unticks the ones that
    // are not pictures — a batch of checkboxes rather than a prompt per figure.
    //
    // Everything is ticked to begin with. The alternative — recommending
    // nothing and making the user find the real ones — would be the app
    // refusing to answer a question it has already done the work for.
    if (s.illustrationCandidates.length > 0) {
      const candidates = [...s.illustrationCandidates].sort(
        (a, b) => a.pageIndex - b.pageIndex || a.id.localeCompare(b.id)
      )
      qs.push({
        id: 'illustrations',
        type: 'multi-choice',
        prompt: `Which of these ${candidates.length} are illustrations?`,
        help:
          'Found by looking for inked areas the text flows around, which also ' +
          'catches the odd decorated initial or heavy rule. Untick anything that ' +
          'is not a picture; what you keep is cut out of the scan at full ' +
          'resolution and set into the book near the text it was printed with.',
        defaultValue: candidates.map((c) => c.id),
        options: candidates.map((c) => ({
          value: c.id,
          label: `Page ${c.pageIndex + 1}`,
          description:
            `${Math.round(c.bbox.x1 - c.bbox.x0)}×${Math.round(c.bbox.y1 - c.bbox.y0)} pixels` +
            ` · ${Math.round(c.ink * 100)}% inked`,
          evidence: [
            {
              kind: 'image' as const,
              src: c.previewUrl,
              alt: `Candidate illustration on page ${c.pageIndex + 1}`
            }
          ]
        }))
      })
    }

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
 * Proofreading, which is a workbench rather than a question.
 *
 * Every other stop in this flow asks something the app has a recommendation
 * for. This one cannot: a misreading is not a decision with a default, and the
 * app has already contributed everything it can — the cross-checks that flag a
 * page are exactly the ones Gate 2 has been over. What is left is the case
 * those checks cannot reach, where the model and OCR read the same word the
 * same wrong way, and only a person with the scan in front of them will see it.
 *
 * So the step carries no `Question[]`. The shell renders the sheet instead, the
 * same concession SPEC §6 makes for images when it calls the editing mode "the
 * real instrument". The decisions that *are* logic — what is on each leaf, and
 * which leaves to offer first — live in `@core/edits` and are tested there.
 *
 * It sits after the structure gate and before the design gate on purpose. The
 * text has to be right before it is worth choosing a typeface for, and every
 * correction re-lays the book out for free, so the page count the design gate
 * previews is the corrected book's.
 */
const proof: Step = {
  id: 'proof',
  title: 'Read it through',
  blurb: 'Your book beside the scan it came from. Fix anything that was read wrong.',
  isGate: true,
  canEnter: (s) => s.completed.includes('gate-structure') && s.document !== null,
  questions: () => []
}

/**
 * The editor's own contribution: notes, and an introduction.
 *
 * The one step that *adds* to the book rather than recovering it, and the
 * reason a reprint is worth publishing at all. It sits after the proof step
 * because a note should be written against corrected text — annotating a
 * misread word wastes the note and the money — and before the design gate
 * because notes change how many pages the book runs to.
 *
 * Everything here is optional and asked as a question, because plenty of books
 * want a plain reprint and nobody should have to pay for a pass to decline it.
 */
const annotate: Step = {
  id: 'annotate',
  title: 'Write the notes',
  blurb: 'Notes and an introduction of your own — what makes this edition yours.',
  isGate: true,
  canEnter: (s) => s.completed.includes('proof') && s.document !== null,
  questions: (s) => {
    const qs: Question[] = []

    qs.push({
      id: 'annotateBook',
      type: 'choice',
      prompt: 'Add notes of your own to this book?',
      help:
        'Each note is proposed with the passage it explains beside it, and goes in ' +
        'only when you accept it. Nothing is added on its own.',
      defaultValue: 'yes',
      required: true,
      options: [
        {
          value: 'yes',
          label: 'Yes — suggest notes',
          description: 'Reads the book and proposes notes for you to go through.'
        },
        {
          value: 'no',
          label: 'No, print it plain',
          description: 'A straight reprint, with only the notes you write yourself.'
        }
      ]
    })

    // Everything below describes the editor, not the book, so it is asked once
    // and banked. On the second book these arrive already answered.
    qs.push({
      id: 'penName',
      type: 'text',
      prompt: 'What name do the notes appear under?',
      help:
        'Printed nowhere by itself — it is who the notes are written as, which is ' +
        'what keeps them in one voice across a series.',
      defaultValue: s.voice.penName,
      placeholder: 'e.g. your name, or a pen name'
    })

    qs.push({
      id: 'noteDensity',
      type: 'choice',
      prompt: 'How freely should notes be offered?',
      help: 'A target, not a quota — a chapter with nothing to explain gets nothing.',
      defaultValue: s.voice.density,
      options: [
        { value: 'sparing', label: 'Sparing', description: 'Only where a reader would stall.' },
        {
          value: 'balanced',
          label: 'Balanced',
          description: 'The usual density for a general reader.'
        },
        {
          value: 'generous',
          label: 'Generous',
          description: 'A fuller apparatus, closer to a scholarly edition.'
        }
      ]
    })

    qs.push({
      id: 'writeIntroduction',
      type: 'choice',
      prompt: 'Write an introduction?',
      help:
        'Drafted from the book’s own shape and a sample of its prose, in the same ' +
        'voice as the notes. You will see it before it goes in.',
      defaultValue: 'standard',
      options: [
        { value: 'brief', label: 'Yes — brief', description: 'About 350 words.' },
        { value: 'standard', label: 'Yes — standard', description: 'About 700 words.' },
        { value: 'full', label: 'Yes — full', description: 'About 1400 words.' },
        { value: 'none', label: 'No introduction', description: 'Leave the front matter as it is.' }
      ]
    })

    // Independent of the notes on purpose: a book can be worth mining and not
    // worth annotating. Riding the annotation pass is nearly free; harvesting a
    // book that is not being annotated pays to read it, and the gate says so.
    qs.push({
      id: 'harvestFacts',
      type: 'choice',
      prompt: 'Keep what this book is worth remembering?',
      help:
        'Writes a separate file of what the book attests — practices, prices, methods, ' +
        'what its author took for granted — each with the words to prove it and the leaf ' +
        'it came from. Nothing to do with the printed book; it is for writing from later.',
      defaultValue: 'standard',
      options: [
        {
          value: 'selective',
          label: 'Only the best of it',
          description: 'About one entry per thousand words.'
        },
        {
          value: 'standard',
          label: 'A useful amount',
          description: 'About two or three per thousand words.'
        },
        {
          value: 'thorough',
          label: 'Everything worth keeping',
          description: 'About five per thousand words. Slower, and dearer.'
        },
        { value: 'none', label: 'Skip it', description: 'Nothing is written out.' }
      ]
    })

    qs.push({
      id: 'harvestInterest',
      type: 'text',
      prompt: 'Collecting towards anything in particular?',
      help:
        'Optional. Names a subject to weight the harvest by — it still keeps whatever ' +
        'else the book has.',
      defaultValue: s.harvestInterest,
      placeholder: 'e.g. early modern glassmaking, or leave blank'
    })

    qs.push({
      id: 'introBrief',
      type: 'text',
      prompt: 'Anything the introduction should be sure to say?',
      help: 'Optional. A theme to draw out, or why you are reprinting this book.',
      defaultValue: '',
      multiline: true,
      placeholder: 'Leave blank and I’ll write from the book alone.'
    })

    return qs
  }
}

/**
 * The `profile` answer meaning "none of the banked looks — interview me".
 * A sentinel rather than `''` because an empty string is also what an
 * unanswered question looks like, and the two mean opposite things here.
 */
export const FRESH_LOOK = 'fresh'

/**
 * Design by interview. Five questions about the *book* produce a complete
 * style — the alternative is a panel of forty fields that assumes the user
 * already knows what a gutter is. The detailed controls remain available
 * afterwards; they are just never the front door.
 *
 * On book two the five questions are the wrong front door as well, because
 * they were already answered for book one. So when the user has banked a look
 * (SPEC §7), the gate asks one question instead of five, and the recommended
 * answer is the most recent look — which is what "setup time drops sharply
 * after the first volume" has to mean in practice.
 */
const design: Step = {
  id: 'design',
  title: 'Design the edition',
  blurb: 'A few questions about the book, and I’ll set the rest.',
  isGate: true,
  canEnter: (s) => s.completed.includes('proof'),
  questions: (s) => {
    // The period answer picks the typeface, so it is read back here to
    // pre-select the matching font rather than making the user match them.
    const designAnswers = s.answers['design'] ?? {}
    const period = (designAnswers['period'] as PeriodFeel) ?? 'early-modern'
    const suggested = fontForPeriod(period)
    const kind = (designAnswers['kind'] as string) ?? 'novel'

    const banked = s.styleProfiles
    const newest = banked[0]
    const chooseProfile: Question[] = newest
      ? [
          {
            id: 'profile',
            type: 'choice',
            prompt: 'Use a look you have already set up?',
            help:
              'A banked look brings the trim, the typeface, the margins, the running heads ' +
              'and the ornaments straight over. Nothing about the book it came from does.',
            defaultValue: newest.id,
            options: [
              ...banked.map((p) => ({
                value: p.id,
                label: p.name,
                description: describeSavedProfile(p)
              })),
              {
                value: FRESH_LOOK,
                label: 'Start fresh',
                description: 'Answer the design questions again for this book.'
              }
            ]
          }
        ]
      : []

    // Applying a banked look answers everything the five questions ask, so
    // asking them anyway would be asking what is no longer relevant — and
    // worse, a look tweaked past what five questions can express would be
    // silently flattened back to whatever those answers rebuild.
    const applied = (designAnswers['profile'] as string) ?? (newest ? newest.id : FRESH_LOOK)
    if (newest && applied !== FRESH_LOOK) return chooseProfile

    return [
      ...chooseProfile,
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
      },
      {
        id: 'saveAs',
        type: 'text',
        prompt: 'Save this look to reuse on the next book?',
        help:
          'Name it and it will be offered here every time, so a series keeps one look ' +
          'without being designed twice. Leave blank not to save.',
        defaultValue: '',
        placeholder: 'e.g. The Blackthorn Press look'
      }
    ]
  }
}

/** Bytes as a person reads them. Mirrors the platform helper, kept pure here. */
function readableBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/**
 * "Keep the scan on this device?" — asked once, against measured numbers.
 *
 * The user put it best: on a desktop you say yes and never think about it; on a
 * phone you say no to conserve space. So the app asks rather than deciding, and
 * shows what it is asking about — this scan's size and the room this browser
 * will actually give it, which differ by an order of magnitude between those
 * two devices.
 *
 * The recommendation follows the same arithmetic the user would do: yes when
 * the scan is a small share of what is free, no when it is not. Where the
 * browser will not report its quota, the question is asked without figures
 * rather than with invented ones, and recommends keeping — the failure it
 * avoids (hunting for a file again) is milder than the one it risks.
 */
function keepScansQuestion(s: WizardState): Question {
  const info = s.storage
  const scan = info ? readableBytes(info.scanBytes) : 'this scan'
  const free =
    info && info.quota !== null && info.usage !== null ? Math.max(0, info.quota - info.usage) : null

  // A tenth of what is free is the line: comfortable on a laptop, and on a
  // phone the point where a few books would start to matter.
  const roomy = free === null || (info !== null && info.scanBytes * 10 < free)

  const help =
    free === null
      ? 'Keeping it means reopening this book with one tap instead of finding the file again. ' +
        'Your transcription is saved either way — this is only about the scan.'
      : `The scan is ${scan}; this browser has about ${readableBytes(free)} free for the app. ` +
        'Keeping it means reopening this book with one tap instead of finding the file again. ' +
        'Your transcription is saved either way — this is only about the scan.'

  return {
    id: 'keepScans',
    type: 'choice',
    prompt: 'Keep this book’s scan on this device?',
    help,
    defaultValue: roomy ? 'keep' : 'discard',
    options: [
      {
        value: 'keep',
        label: 'Keep it — reopen with one tap',
        description: info ? `Uses ${scan} here.` : 'Uses space here.'
      },
      {
        value: 'discard',
        label: 'Don’t keep it — save the space',
        description: 'You choose the PDF again each time you come back to this book.'
      }
    ]
  }
}

/**
 * The look the design gate's answers add up to, and the publisher identity that
 * came with it.
 *
 * One place decides this, because three callers need the same answer: the gate's
 * live preview, the export gate's prefilled imprint fields, and the export
 * itself. A banked look is used *as banked* rather than rebuilt from the five
 * answers — a profile hand-tweaked in a later session holds settings no answer
 * can express, and regenerating would quietly discard them.
 *
 * `answers` is passed rather than read from state so the gate can show the
 * consequence of an answer the user has not committed yet.
 */
export function appliedLook(
  state: WizardState,
  answers: Answers = state.answers['design'] ?? {}
): { style: StyleProfile; imprint: ImprintFields; fromProfileId: string | null } {
  const newest = state.styleProfiles[0]
  const chosen = (answers['profile'] as string) ?? (newest ? newest.id : FRESH_LOOK)
  const banked =
    chosen === FRESH_LOOK ? undefined : state.styleProfiles.find((p) => p.id === chosen)

  if (banked) {
    return {
      style: applyStyleAnswers(banked.style, state.styleOverrides),
      imprint: banked.imprint,
      fromProfileId: banked.id
    }
  }
  return {
    style: applyStyleAnswers(
      profileFromAnswers(
        {
          kind: answers['kind'],
          period: answers['period'],
          chapterOpener: answers['chapterOpener'],
          runningHeads: answers['runningHeads']
        } as DesignAnswers,
        answers['font'] as string,
        state.defaultLook ?? undefined
      ),
      state.styleOverrides
    ),
    imprint: emptyImprint(),
    fromProfileId: null
  }
}

/**
 * The last gate. Two kinds of fact meet here: what the book *is*, which the
 * vision pass read off the original front matter and which the user is now
 * correcting rather than supplying; and the details of *this edition*, which
 * only its publisher knows. Both land on the title and copyright pages.
 *
 * The first three are asked here rather than at Gate 1 because here they can be
 * answered by looking: the pass has read the title page, so the boxes arrive
 * filled in, with the scan of that page beside them.
 */
const exportStep: Step = {
  id: 'export',
  title: 'Publish the edition',
  blurb: 'Check what I read off the title page, add the last few details, and print.',
  isGate: true,
  canEnter: (s) => s.completed.includes('design'),
  questions: (s) => {
    const m = s.metadata
    // Live, so the copyright-page hints below follow a correction the user is
    // making on this very screen rather than the reading it replaced.
    const answered = s.answers['export'] ?? {}
    const author = (answered['author'] as string) ?? m.author ?? ''
    const originalYear = (answered['originalYear'] as string) ?? m.originalYear ?? null
    const thisYear = String(new Date().getFullYear())

    // The publisher's own details ride on the banked look (SPEC §7): they are
    // facts about the imprint, not about this book, so on the second volume
    // they arrive filled in rather than retyped.
    const { imprint: banked, fromProfileId } = appliedLook(s)
    const fromLook = fromProfileId
      ? ' Filled in from the look you reused — correct it if this one differs.'
      : ''

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

    return [
      {
        id: 'title',
        type: 'text',
        prompt: 'Book title',
        help: 'Read off the original title page. This becomes your edition’s title.',
        defaultValue: m.title ?? '',
        placeholder: 'e.g. The Alchemist His Practise',
        required: true,
        evidence: titleEvidence
      },
      {
        id: 'author',
        type: 'text',
        prompt: 'Author',
        help: 'Also read off the title page. Correct it if the scan misled me.',
        defaultValue: m.author ?? '',
        placeholder: 'e.g. Anonymous',
        required: true
      },
      {
        id: 'originalYear',
        type: 'text',
        prompt: 'Year of the original edition',
        help: 'Used for the “originally published” line on your copyright page.',
        defaultValue: m.originalYear ?? '',
        placeholder: 'e.g. 1662'
      },
      {
        id: 'imprint',
        type: 'text',
        prompt: 'Who is publishing this edition?',
        help:
          'Your imprint or your own name — not the original publisher. It appears on ' +
          'the copyright page.' +
          fromLook,
        defaultValue: banked.imprint,
        placeholder: 'e.g. Blackthorn Press'
      },
      {
        id: 'copyrightHolder',
        type: 'text',
        prompt: 'Who holds the copyright in this edition?',
        help:
          'The original text is public domain, so this covers only your new typesetting, ' +
          'notes, and design.' +
          fromLook,
        defaultValue: banked.copyrightHolder,
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
        defaultValue: banked.publicDomainNotice
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
  proof,
  annotate,
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
