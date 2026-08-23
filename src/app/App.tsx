/**
 * The wizard shell.
 *
 * The app interviews the user: it runs what it can on its own, and stops only
 * at gates where human judgment matters, asking with the evidence attached.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  STEPS,
  activeStep,
  appliedLook,
  defaultAnswers,
  pruneStaleAnswers,
  messagesByPage,
  settledLeaves,
  initialState,
  missingRequired,
  progress,
  type AnswerValue,
  type Answers,
  type StepId,
  type WizardState
} from '@core/wizard'
import {
  runRecon,
  releaseRecon,
  RECON_DPI,
  type ReconProgress,
  type ReconResult
} from '../platform/browser/recon'
import {
  loadReconCache,
  loadReconCheckpoint,
  saveReconCache,
  saveReconCheckpoint
} from '../platform/browser/recon-cache'
import { canKeepAwake, keepAwake, type ReleaseWakeLock } from '../platform/browser/wake-lock'
import { looksLikeEpub, openEpub } from '../platform/browser/epub'
import { describeAssessment } from '@core/textquality'
import { QuestionView } from './QuestionView'
import { QuestionList } from './QuestionList'
import { useAgentSurface } from './agent-surface'
import { AgentBridge } from './AgentBridge'
import type { ControlConfig } from '../platform/browser/control'
import { validSession } from '@core/control'
import {
  estimateCost,
  formatEstimate,
  mergeMetadata,
  validateApiKey,
  findDroppedRuns,
  spotId,
  spliceRunInto,
  transcriptionText,
  checkableText,
  withMarkup,
  verifyBook,
  verifyPage,
  type ApiUsage,
  type PageTranscription,
  type RunProgress,
  type RunResult
} from '@core/transcribe'
import { assembleBook } from '@core/assemble'
import { vetLexicon, type TermDecision } from '@core/lexicon'
import { runBrowserTranscription } from '../platform/browser/transcribe-run'
import {
  loadApiKey,
  saveApiKey,
  loadPrefs,
  savePrefs,
  loadVoice,
  saveVoice,
  loadBank,
  recordHarvest,
  loadReviewProgress,
  loadShelf,
  loadControl,
  saveControl,
  controlConfig,
  type ControlSettings,
  saveReviewProgress,
  shelfReady,
  loadReviewPlace,
  saveReviewPlace,
  storageEstimate
} from '../platform/browser/settings'
import {
  deleteAnnotationCheckpoint,
  deleteBatchTicket,
  findBatchTicketForFile,
  findRunForFile,
  listProfiles,
  listRuns,
  loadAnnotationCheckpoint,
  loadRun,
  loadRunSummary,
  loadSourceFile,
  saveAnnotationCheckpoint,
  saveBatchTicket,
  saveProfile,
  saveRun,
  saveSourceFile,
  storedFileKeys
} from '../platform/browser/run-store'
import { collectBookBatch, submitBookBatch } from '../platform/browser/batch-run'
import { fetchBook, getBytes, readShelf } from '../platform/browser/shelf'
import { pushBookToShelf } from '../platform/browser/shelf-save'
import { canReachBatchApi } from '../platform/browser/batch-reach'
import { cropWordsFromPage } from '../platform/browser/word-crops'
import { runBrowserAdjudication, type FlaggedLeaf } from '../platform/browser/adjudicate-run'
import {
  describeAdjudication,
  estimateAdjudicationCost,
  spotsFromStored,
  type AdjudicatedSpot
} from '@core/adjudicate'
import { newSavedProfile, styleQuestions, type SavedStyleProfile } from '@core/style'
import { type ShelfAbout } from '@core/sync'
import {
  bodyKeyFor,
  checkpointComplete,
  createAnnotationCheckpoint,
  createBatchTicket,
  createSavedRun,
  describeAge,
  fileKey,
  chunksAlreadyRead,
  pendingBatches,
  summarize as summarizeRun,
  parseBookFile,
  summarizeCheckpoint,
  summarizeTicket,
  type AnnotationCheckpoint,
  type AnnotationPassMode,
  type AnnotationWanted,
  type BatchTicket,
  type SavedRunSummary,
  type TicketBatch
} from '@core/project'
import { BODY_FONTS, describeProfile } from '@core/design'
import { dispositionFor } from '@core/pages'
import { buildExport, editionFromAnswers, type BuildExportResult } from '@core/export'
import { applyEdits, withCorrections, withEdit, type Attention, type BookEdit } from '@core/edits'
import {
  chunkBlocks,
  checkProposals,
  draftIntroduction,
  estimateAnnotationCost,
  learnVoice,
  proposalsToEdits,
  runAnnotation,
  type AcceptedProposal,
  type AnnotationProposal,
  type CheckedProposal,
  type ChunkFailure,
  type EditorVoice,
  type IntroductionDraft,
  type IntroductionLength,
  type NoteDensity
} from '@core/annotate'
import {
  estimateHarvestCost,
  factsFromNotes,
  renderBank,
  runHarvest,
  type Fact,
  type HarvestDepth
} from '@core/harvest'
import { renderInterior } from '../platform/browser/interior'
import { cropIllustrations, readSuppliedImage, retouchPng } from '../platform/browser/illustrations'
import { renderPageToObjectUrl } from '../platform/browser/pdf'
import { loadDefaultLook } from './Settings'
import { ExportResult } from './ExportResult'
import { NoteReview } from './NoteReview'
import { PreviewPane } from './PreviewPane'
import { ProofSheet } from './ProofSheet'

/** A cache key that changes whenever the stack that produced the pixels does. */
function retouchKey(id: string, ops: readonly unknown[]): string {
  return `${id}:${JSON.stringify(ops)}`
}

/**
 * Say which pictures did not come down, or say nothing.
 *
 * A picture that failed to arrive is a gap in a book somebody is about to sell.
 * `imagesDropped` and `missingImages` carry the same rule through the engine
 * and the export report; this is that rule at the point where a book crosses
 * between devices.
 */
function lostNote(lost: readonly string[]): string {
  if (lost.length === 0) return ''
  return (
    ` ${lost.length} picture${lost.length === 1 ? '' : 's'} named by this book ` +
    `could not be fetched from the shelf (${lost.join(', ')}), so ${
      lost.length === 1 ? 'it is' : 'they are'
    } missing rather than wrong — nothing is drawn in ${lost.length === 1 ? 'its' : 'their'} place.`
  )
}

export function App(): JSX.Element {
  const [state, setState] = useState<WizardState>(initialState)
  const [progressInfo, setProgress] = useState<ReconProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const reconRef = useRef<ReconResult | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // The File, not its bytes: pdf.js detaches any ArrayBuffer it is given, and
  // holding the whole book in the heap between phases is needless besides.
  const fileDataRef = useRef<File | null>(null)
  // Identifies the open file, so a paid run can be found again on a later visit.
  const fileKeyRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /**
   * The banked look this session is using — either one the user reused at the
   * design gate or one they named there and had saved.
   *
   * A ref rather than state: nothing renders from it, and it exists so the
   * export gate can write the imprint details back onto the right profile.
   */
  const bankedProfileRef = useRef<SavedStyleProfile | null>(null)
  /**
   * PNG bytes for the illustrations cut out of the scan at the structure gate.
   *
   * Held in a ref rather than in state: they are megabytes of pixels, and
   * nothing renders from them directly — the PDF writer looks them up by id.
   * Kept apart from the editor's own pictures below because the two have
   * different lifetimes: these are re-cut from the scan for free, so they are
   * never saved and are rebuilt whenever the accepted set changes.
   */
  const cropBytesRef = useRef<Map<string, Uint8Array>>(new Map())
  /**
   * PNG bytes for pictures the *editor* supplied.
   *
   * These cannot be re-derived from anything the app holds — a portrait chosen
   * off someone's disk is gone with the tab — so they are saved with the run,
   * and rebuilding the crops must never take them with it.
   */
  const suppliedBytesRef = useRef<Map<string, Uint8Array>>(new Map())
  /**
   * Pages the *user* chose to leave out at the review gate.
   *
   * Kept because the structure gate assembles the book a second time, to fold
   * in the illustrations, and that assembly has to make the same exclusions as
   * the first. It cannot be recovered from `document.skipped`: that list also
   * holds every page dropped by its *disposition* — the title page, the scanned
   * contents, the blanks — and handing those back as exclusions would both
   * relabel them and break a paragraph that legitimately runs across a plate.
   */
  const excludedPagesRef = useRef<number[]>([])
  /**
   * Pages the user already looked at and accepted at the uncertainty gate.
   *
   * The proof sheet leads with what the cross-checks flagged, and re-flagging a
   * page someone has just been over is how a proofing pass stops being read.
   */
  const reviewedPagesRef = useRef<number[]>([])
  /**
   * Pages the user asked to be brought back to, and why.
   *
   * The counterpart to the list above, and the reason the two exist separately:
   * "I checked it and it's fine" and "I can see what's wrong and I'll fix it"
   * are both answers that keep the page, and only one of them means the note
   * about it should stop being shown.
   */
  const attentionRef = useRef<Attention[]>([])
  const transcriptionRef = useRef<RunResult | null>(null)
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null)
  const [pendingCost, setPendingCost] = useState<string | null>(null)
  /**
   * The book that is out with the API, if there is one.
   *
   * A ref rather than state because it is written from inside the submission
   * loop, once per batch, and a re-render between two uploads is the last thing
   * that loop needs. The *summary* of it goes into wizard state, which is what
   * the question renders from.
   */
  const batchTicketRef = useRef<BatchTicket | null>(null)
  const [submitProgress, setSubmitProgress] = useState<{
    page: number
    total: number
    batches: number
  } | null>(null)
  const [collectProgress, setCollectProgress] = useState<{
    checked: number
    total: number
    collected: number
  } | null>(null)
  /** What the last check found, so the waiting screen says something true. */
  const [batchWaiting, setBatchWaiting] = useState<string | null>(null)
  /** The second reading over the flagged spots, while it runs and after. */
  /**
   * The second reading, offered at the gate rather than only after a fresh read.
   *
   * It used to run in exactly two places — a paid transcription and a batch
   * collection — which left out the commonest way of arriving at this screen:
   * reusing the transcription you already bought. Someone with a hundred and
   * thirty flagged spots and a run they had paid for last week got the gate
   * with no verdicts on it and no way to ask for any.
   */
  const [pendingCheckCost, setPendingCheckCost] = useState<string | null>(null)
  const [checkProgress, setCheckProgress] = useState<{
    leaf: number
    total: number
    settled: number
  } | null>(null)
  const [checkNote, setCheckNote] = useState<string | null>(null)
  /**
   * The annotation pass, which is the app's second and much cheaper paid step.
   *
   * Held here rather than in the wizard state because it is a *proposal* — none
   * of it is part of the book until the review gate says so, at which point it
   * becomes ordinary edits and stops being special.
   */
  const [pendingNotesCost, setPendingNotesCost] = useState<string | null>(null)
  const [notesProgress, setNotesProgress] = useState<{ done: number; total: number } | null>(null)
  /**
   * What an interrupted pass over this book already bought.
   *
   * The whole record, not the summary the gate shows: the notes in it are paid
   * for, and the point of holding them here is to be able to hand them to the
   * review screen without reading the book again.
   */
  const [notesCheckpoint, setNotesCheckpoint] = useState<AnnotationCheckpoint | null>(null)
  const [notesNote, setNotesNote] = useState<string | null>(null)
  /**
   * Polled between chunks by both runners.
   *
   * A ref rather than state because the runner reads it inside a loop that
   * started before the click: a state variable captured in that closure would
   * still be `false` however many times the button was pressed.
   */
  const cancelNotesRef = useRef(false)
  const [proposals, setProposals] = useState<{
    notes: CheckedProposal[]
    failures: ChunkFailure[]
    introduction: IntroductionDraft | null
  } | null>(null)
  /**
   * The fact bank for this book, offered as files at the end.
   *
   * Not part of the book and never written into it — this is the material the
   * reading turned up, kept so a shelf of reprints becomes something to write
   * from. Held until the export screen, where it is downloaded.
   */
  const [bankFacts, setBankFacts] = useState<Fact[]>([])
  const [exported, setExported] = useState<BuildExportResult | null>(null)
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; pageCount: number } | null>(null)
  const [buildNote, setBuildNote] = useState<string | null>(null)
  /**
   * Set when the export writes the publisher's details back onto a banked look.
   * Shown on the export screen: changing saved state is fine, doing it without
   * telling the user is not.
   */
  const [bankedNote, setBankedNote] = useState<string | null>(null)
  /**
   * Transcriptions already paid for, from any earlier sitting.
   *
   * Shown on the intake screen. Without this the app forgets out loud: a
   * refresh puts an empty drop zone in front of someone whose paid run is
   * sitting in the database three feet away, and nothing on the screen suggests
   * otherwise.
   */
  const [savedRuns, setSavedRuns] = useState<SavedRunSummary[]>([])
  /** Keys whose scan is stored too, so the book can be reopened without the picker. */
  const [reopenable, setReopenable] = useState<string[]>([])
  /**
   * Said while the free pass runs, when the book being read has already been
   * paid for.
   *
   * Re-reading a scan looks exactly like reading a new one — same progress bar,
   * same minutes — so without this the honest reading of the screen is that the
   * paid work was lost and is being redone. Found before recon starts rather
   * than after it, because the answer is worth having at the start of the wait
   * rather than at the end.
   */
  const [resumeNote, setResumeNote] = useState<string | null>(null)
  /**
   * How far through the current gate the user had worked.
   *
   * A gate of forty flagged leaves reviewed one at a time is a job you come
   * back to. The verdicts were already kept; without this the user came back
   * to leaf one every time and had to find their place by hand.
   */
  const [place, setPlace] = useState<{ at: string | null; done: string[] }>({
    at: null,
    done: []
  })
  /** Reading a stored reading back out, which is quick but not instantaneous. */
  const [reusing, setReusing] = useState(false)
  /**
   * Whether the screen is being held awake for a long job.
   *
   * Shown rather than done quietly: someone who put their phone down expects it
   * to sleep, and a screen that stays lit for ten minutes with no explanation
   * reads as a bug rather than as the app doing what they wanted.
   */
  const [awake, setAwake] = useState(false)
  /**
   * Whether this book's words came out of the file rather than out of OCR.
   *
   * Worth saying, and worth saying it *structurally*: a born-digital PDF is a
   * different kind of source from a photograph of a book, and the difference is
   * ten minutes of reading and a much better starting text.
   */
  const [embedded, setEmbedded] = useState(false)
  const releaseWakeRef = useRef<ReleaseWakeLock | null>(null)
  const [buildProgress, setBuildProgress] = useState<{ done: number; total: number } | null>(null)
  /**
   * Corrections made at the proof step.
   *
   * Held apart from the document rather than written into it, so the paid
   * transcription stays the transcription and every correction can be undone.
   * Everything downstream reads `correctedDocument`, never `state.document`.
   */
  const [edits, setEdits] = useState<BookEdit[]>([])

  const step = activeStep(state)
  const [answers, setAnswers] = useState<Answers>({})

  // Questions are built against the answers *as they are being given*, not only
  // the committed ones: some questions describe the consequence of an earlier
  // answer on the same screen (the page size a book kind implies, the typeface
  // a period suggests), and those have to move as the user answers.
  //
  // Only the raw `answers` are folded in — the touched ones. Folding in the
  // filled-out defaults instead would be circular, since the defaults come from
  // the questions this is producing.
  const liveState = useMemo(
    () => ({ ...state, answers: { ...state.answers, [step.id]: answers } }),
    [state, step.id, answers]
  )
  const questions = useMemo(() => step.questions(liveState), [step, liveState])

  // Reset answers to the recommended defaults whenever the gate changes.
  const currentAnswers = useMemo(() => {
    const defaults = defaultAnswers(questions)
    return { ...defaults, ...answers }
  }, [questions, answers])

  const missing = missingRequired(questions, currentAnswers)

  /**
   * Review progress, saved as it is made and restored on the way back in.
   *
   * The transcription has always survived a refresh because it costs money.
   * These verdicts cost *time* — three hundred pages of "looks fine" at the
   * uncertainty gate — and used to be thrown away while the pages they applied
   * to were carefully kept.
   *
   * Written on a timer rather than on every keystroke: a text answer would
   * otherwise hit storage once per character.
   */
  useEffect(() => {
    const key = fileKeyRef.current
    if (!key || Object.keys(answers).length === 0) return
    const timer = setTimeout(() => {
      saveReviewProgress(key, { ...loadReviewProgress(key), [step.id]: answers })
    }, 400)
    return () => clearTimeout(timer)
  }, [answers, step.id])

  /**
   * Ask the server, once, whether the batch door is open from a browser.
   *
   * Done on arrival at the paid gate rather than at start-up, because that is
   * the only screen the answer changes — and it is one free request, so asking
   * on every page load would be a request nobody needed. The question renders
   * optimistically and withdraws if the answer is no; see `batch-reach`.
   */
  useEffect(() => {
    if (step.id !== 'transcribe' || state.batchAvailable !== null) return
    let live = true
    void canReachBatchApi(loadApiKey()).then((ok) => {
      if (live) setState((s) => ({ ...s, batchAvailable: ok }))
    })
    return () => {
      live = false
    }
  }, [step.id, state.batchAvailable])

  // Arriving at a step: put back whatever was answered here last time. Keyed by
  // step, so this cannot resurrect an answer onto a different gate.
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    const key = fileKeyRef.current
    if (!key || restoredFor.current === step.id) return
    restoredFor.current = step.id
    const saved = loadReviewProgress(key)[step.id]
    if (saved && Object.keys(saved).length > 0) {
      // Pruned on the way in. A verdict saved against an option this version no
      // longer offers would otherwise leave the leaf looking undecided, which
      // on a book already half worked through reads as lost progress.
      setAnswers(pruneStaleAnswers(questions, saved as Answers))
    }
    setPlace(loadReviewPlace(key, step.id))
    // `questions` is read to prune, but must not be a dependency: it is rebuilt
    // whenever an answer changes, and re-running this would restore the saved
    // answers over what the user has just typed. `restoredFor` guards it to
    // once per step regardless, and the guard is the contract here.
  }, [step.id, questions])

  // The design gate answers questions about the *book*; this is the style they
  // add up to. Built live, because both the one-line summary and the page
  // preview below it show the consequence of an answer before it is committed.
  const designProfile = useMemo(() => {
    if (step.id !== 'design') return null
    return appliedLook(state, currentAnswers).style
  }, [step.id, state, currentAnswers])

  const designSummary = designProfile ? describeProfile(designProfile) : null

  /**
   * The edition facts the preview's front matter needs.
   *
   * The design gate comes before the export gate, so nobody has confirmed the
   * title yet — the preview shows what the vision pass read off the original
   * title page, which is the same text the export gate will offer for
   * correction. The copyright-page details come later and the preview leaves
   * them alone.
   */
  const previewEdition = useMemo(
    () => ({
      title: state.metadata.title || 'Untitled',
      author: state.metadata.author || ''
    }),
    [state.metadata]
  )

  /**
   * The book as it stands *after* the user's corrections.
   *
   * `layout()` is a pure function of its inputs, so re-applying the edit list
   * and laying out again is the whole of "the preview reflects my fix" — there
   * is no incremental update to get wrong.
   */
  /** Every picture in the book, whichever half of it each came from. */
  const originalImageBytes = useCallback(
    (): Map<string, Uint8Array> => new Map([...cropBytesRef.current, ...suppliedBytesRef.current]),
    []
  )

  const correctedDocument = useMemo(
    () => (state.document ? applyEdits(state.document, edits) : null),
    [state.document, edits]
  )

  // The detailed controls behind "anything you'd change?". They answer into the
  // design step like every other question, so they persist and travel with the
  // book — which means the reset button has to know which ids are *theirs*
  // rather than clearing the gate.
  const styleTweakQuestions = useMemo(
    () =>
      designProfile
        ? styleQuestions(designProfile, {
            families: BODY_FONTS.map((f) => ({
              value: f.family,
              label: f.label,
              description: f.note
            })),
            // Asked only when this book's original contents had descriptions to
            // keep. Nothing to offer otherwise.
            hasSynopses: (correctedDocument?.chapters ?? []).some((c) => c.synopsis !== undefined)
          })
        : [],
    [designProfile, correctedDocument]
  )
  const styleTweaks = styleTweakQuestions
    .map((q) => q.id)
    .filter((id) => currentAnswers[id] !== undefined)

  /**
   * Retouched pixels, keyed by the picture *and* the exact stack that made them.
   *
   * Keyed by the stack because the ops are re-applied over the original every
   * time: an entry is only valid for the stack it came from, and a slider
   * dragged back to where it was should hit the cache rather than re-render.
   */
  const retouchedRef = useRef<Map<string, Uint8Array>>(new Map())
  const [retouchTick, setRetouchTick] = useState(0)

  /** What the writer and the preview draw: retouched pixels where there are any. */
  const drawableImageBytes = useCallback((): Map<string, Uint8Array> => {
    const out = originalImageBytes()
    for (const illustration of correctedDocument?.illustrations ?? []) {
      if (!illustration.edits?.length) continue
      const cached = retouchedRef.current.get(retouchKey(illustration.id, illustration.edits))
      if (cached) out.set(illustration.id, cached)
    }
    return out
    // `retouchTick` is the dependency that matters: it changes when a retouch
    // finishes, which is what makes the preview redraw with the new pixels.
  }, [originalImageBytes, correctedDocument, retouchTick])

  /**
   * A preview URL for a picture as it currently stands.
   *
   * Minted from whatever bytes will actually be drawn, so the editor shows its
   * own work rather than the pixels it started from. Object URLs are cached per
   * byte array and revoked when the book is closed.
   */
  const previewUrlsRef = useRef<Map<Uint8Array, string>>(new Map())
  const previewOf = useCallback(
    (id: string): string | undefined => {
      const bytes = drawableImageBytes().get(id)
      if (!bytes) return undefined
      const existing = previewUrlsRef.current.get(bytes)
      if (existing) return existing
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
      previewUrlsRef.current.set(bytes, url)
      return url
    },
    // Re-created when new pixels land, so React re-renders the img with them.
    [drawableImageBytes]
  )

  /**
   * Keep the retouched pixels in step with the op stacks.
   *
   * Driven off the document rather than off the sliders, so it covers a stack
   * restored from a saved run as well as one being dragged right now.
   */
  useEffect(() => {
    const wanted = (correctedDocument?.illustrations ?? []).filter((i) => i.edits?.length)
    if (wanted.length === 0) return

    let cancelled = false
    // Debounced: a slider emits an op per pixel of travel, and each one is a
    // full decode, filter and re-encode of the picture.
    const timer = setTimeout(() => {
      void (async () => {
        let produced = false
        for (const illustration of wanted) {
          const ops = illustration.edits ?? []
          const key = retouchKey(illustration.id, ops)
          if (retouchedRef.current.has(key)) continue
          const original = originalImageBytes().get(illustration.id)
          if (!original) continue
          try {
            const result = await retouchPng(original, ops)
            if (cancelled) return
            retouchedRef.current.set(key, result.bytes)
            produced = true
          } catch {
            // The original still draws, so a failed retouch costs the edit
            // rather than the picture.
          }
        }
        if (produced && !cancelled) setRetouchTick((n) => n + 1)
      })()
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [correctedDocument, originalImageBytes])

  /**
   * Every picture that can be retouched, with both sizes it has.
   *
   * The *original* size comes from before any edits — a crop is measured
   * against it, because the stack is re-applied from the original every time
   * and a second drag replaces the first rather than cropping the crop. The
   * current size comes from after them, and is what the book prints with.
   */
  const retouchablePictures = useMemo(() => {
    const originals = new Map<string, { width: number; height: number }>()
    for (const i of state.document?.illustrations ?? []) {
      originals.set(i.id, { width: i.sourceWidth, height: i.sourceHeight })
    }
    for (const edit of edits) {
      if (edit.kind === 'image') {
        originals.set(edit.imageId, { width: edit.sourceWidth, height: edit.sourceHeight })
      }
    }

    return (correctedDocument?.illustrations ?? []).map((i) => {
      const original = originals.get(i.id) ?? { width: i.sourceWidth, height: i.sourceHeight }
      return {
        id: i.id,
        sourceWidth: original.width,
        sourceHeight: original.height,
        currentWidth: i.sourceWidth,
        currentHeight: i.sourceHeight,
        // A supplied picture has no leaf, so it is edited where it was added
        // rather than on a page of the scan.
        pageIndex: i.origin === 'supplied' ? null : i.pageIndex
      }
    })
  }, [state.document, correctedDocument, edits])

  /** The proof step has no questions, so the shell renders its sheet instead. */
  const isProofing = step.id === 'proof' && state.document !== null

  /**
   * A readable render of one leaf, for the proof sheet.
   *
   * `useCallback` with no dependencies on purpose: the sheet re-runs its loader
   * whenever this identity changes, so an inline arrow here would re-render the
   * page on every keystroke. The file is read from a ref for the same reason.
   */
  const loadProofScan = useCallback(async (pageIndex: number): Promise<string | undefined> => {
    const file = fileDataRef.current
    if (!file) return undefined
    try {
      return await renderPageToObjectUrl(file, pageIndex)
    } catch {
      // The thumbnail is still shown, so a failed render costs sharpness
      // rather than the page.
      return undefined
    }
  }, [])

  /**
   * Take a picture the editor picked into the book.
   *
   * The bytes go beside the document keyed by id — the same channel the crops
   * cut out of the scan use — and only the id and pixel size reach the core.
   */
  const addSuppliedImage = useCallback(
    async (
      file: File
    ): Promise<{ imageId: string; sourceWidth: number; sourceHeight: number } | null> => {
      try {
        const decoded = await readSuppliedImage(file)
        // Minted from the clock so an id is never reused after a picture is
        // removed; a reused one would overwrite bytes still referenced.
        const imageId = `img${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
        suppliedBytesRef.current = new Map(suppliedBytesRef.current).set(imageId, decoded.bytes)
        return { imageId, sourceWidth: decoded.width, sourceHeight: decoded.height }
      } catch (err) {
        setError(
          err instanceof Error
            ? `That picture could not be read: ${err.message}`
            : 'That picture could not be read.'
        )
        return null
      }
    },
    []
  )

  const resolveEvidence = useCallback((src: string): string | undefined => {
    const m = /^page:(\d+)$/.exec(src)
    if (m) return reconRef.current?.thumbnails.get(Number(m[1]))
    return src
  }, [])

  /**
   * Cut the named words out of a leaf, for the discrepancy grid.
   *
   * The boxes come from the reading already in hand — OCR gave every word one —
   * so this is a lookup plus one page render, not a second reading of the scan.
   * Rendered at `RECON_DPI` because that is the space the boxes are in; at any
   * other scale they point at the wrong pixels.
   *
   * The URLs belong to the grid, which revokes them when it moves to the next
   * leaf. Nothing accumulates across a book.
   */
  const cropWords = useCallback(
    async (
      pageIndex: number,
      groups: readonly { id: string; tokenIds: readonly string[] }[]
    ): Promise<Map<string, string>> => {
      const file = fileDataRef.current
      const recon = reconRef.current
      if (!file || !recon) return new Map()
      const onPage = new Map(
        recon.words.filter((w) => w.pageIndex === pageIndex).map((w) => [w.id, w])
      )
      // One picture per discrepancy, covering all of its words — cropping only
      // the first would show the reader "THE" as the evidence for a missing
      // clause.
      const boxes = groups.map((g) => ({
        id: g.id,
        words: g.tokenIds
          .map((id) => onPage.get(id))
          .filter((w): w is NonNullable<typeof w> => Boolean(w))
          .map((w) => ({ id: w.id, bbox: w.bbox }))
      }))
      try {
        return await cropWordsFromPage(file, pageIndex, boxes, { dpi: RECON_DPI })
      } catch {
        // Evidence, not load-bearing: the rows still list what is missing and
        // where it goes, which is more than the count they replaced.
        return new Map()
      }
    },
    []
  )

  /**
   * The same leaf, rendered big enough to read.
   *
   * The thumbnail a gate shows is 200 pixels wide — enough to recognise a page
   * and useless for checking a transcription against it, which is the entire
   * job the gate is asking the user to do. Rendered on demand rather than kept,
   * because a legible render of every leaf in a book is hundreds of megabytes;
   * the caller revokes what it is handed.
   */
  const enlargeEvidence = useCallback(async (src: string): Promise<string | undefined> => {
    const m = /^page:(\d+)$/.exec(src)
    const file = fileDataRef.current
    if (!m || !file) return undefined
    try {
      return await renderPageToObjectUrl(file, Number(m[1]))
    } catch {
      // The thumbnail is already on screen, so a failed render costs sharpness
      // rather than the look.
      return undefined
    }
  }, [])

  /**
   * Open a book that is already text.
   *
   * An EPUB has been through everything the rest of this app exists to do: a
   * person typed the words and marked up the structure, so there is nothing to
   * render, nothing to OCR, and nothing to pay a model to read. It joins the
   * flow at the structure gate with the whole recovery half behind it, and
   * gains everything after it — the proofing workbench, notes and an
   * introduction of the editor's own, the design interview, and a typeset PDF.
   */
  const startEpub = useCallback(async (file: File) => {
    setError(null)
    setAnswers({})
    setExported(null)
    setPdf(null)
    setBuildNote(null)
    setResumeNote(null)
    if (reconRef.current) releaseRecon(reconRef.current)
    reconRef.current = null
    for (const url of previewUrlsRef.current.values()) URL.revokeObjectURL(url)
    previewUrlsRef.current = new Map()
    cropBytesRef.current = new Map()
    suppliedBytesRef.current = new Map()
    retouchedRef.current = new Map()
    excludedPagesRef.current = []
    reviewedPagesRef.current = []
    attentionRef.current = []
    batchTicketRef.current = null
    setEdits([])

    setState((s) => ({
      ...s,
      ...initialState(),
      styleProfiles: s.styleProfiles,
      voice: s.voice,
      harvestInterest: s.harvestInterest,
      fileName: file.name,
      completed: ['intake']
    }))

    try {
      fileDataRef.current = file
      fileKeyRef.current = fileKey(file)
      setProgress({ page: 0, total: 1, phase: 'rendering' })

      const opened = await openEpub(file, (p) =>
        setProgress({ page: p.done, total: Math.max(1, p.total), phase: 'harvesting' })
      )

      // Said before anything else, because it decides whether this file is
      // worth the next hour. An EPUB from Standard Ebooks needs no reading; one
      // exported by archive.org is their OCR of a scan, and this app has no
      // pixels to check it against — the PDF of the same book does.
      setResumeNote(
        opened.quality.verdict === 'trustworthy'
          ? 'This EPUB is already text, so there is nothing to read and nothing to pay for.'
          : `${describeAssessment(opened.quality)} There are no page images in an EPUB, so this ` +
              'cannot be checked or corrected against the original. If it came from a scan, the ' +
              'PDF of the same book can be read properly — that is the file to use.'
      )

      // Pictures the markup referenced travel as supplied images — the same
      // channel a picture the editor adds by hand uses, so nothing downstream
      // has to know one came out of an archive.
      const supplied = new Map<string, Uint8Array>()
      for (const [id, bytes] of opened.images) supplied.set(id, bytes)
      suppliedBytesRef.current = supplied

      transcriptionRef.current = {
        transcriptions: opened.transcriptions,
        failures: [],
        findings: [],
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
        modelId: '',
        metadata: null
      } as unknown as RunResult

      setState((s) => ({
        ...s,
        pageCount: opened.transcriptions.length,
        pagesProcessed: opened.transcriptions.length,
        metadata: {
          ...s.metadata,
          title: opened.package.title ?? s.metadata.title,
          author: opened.package.author ?? s.metadata.author,
          originalYear: opened.package.year ?? s.metadata.originalYear,
          originalPublisher: opened.package.publisher ?? s.metadata.originalPublisher
        },
        document: opened.document,
        pageText: Object.fromEntries(
          opened.transcriptions.map((t) => [t.pageIndex, transcriptionText(t)])
        ),
        textSource: 'embedded',
        hasApiKey: loadApiKey().length > 0,
        // Everything the recovery half would have decided is already decided,
        // so those steps are marked done rather than walked through with
        // nothing to ask. The structure gate is where a person is next useful.
        completed: ['intake', 'recon', 'gate-identity', 'transcribe', 'gate-uncertainties']
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
    }
  }, [])

  const startRecon = useCallback(async (file: File) => {
    setError(null)
    setAnswers({})
    // A new book starts from nothing — leaving the previous edition's export on
    // screen would let the user download the wrong book.
    setExported(null)
    setPdf(null)
    setBuildNote(null)
    setResumeNote(null)
    if (reconRef.current) releaseRecon(reconRef.current)
    reconRef.current = null
    for (const url of previewUrlsRef.current.values()) URL.revokeObjectURL(url)
    previewUrlsRef.current = new Map()
    cropBytesRef.current = new Map()
    suppliedBytesRef.current = new Map()
    retouchedRef.current = new Map()
    excludedPagesRef.current = []
    reviewedPagesRef.current = []
    attentionRef.current = []
    batchTicketRef.current = null
    setEdits([])

    setState((s) => ({
      ...s,
      ...initialState(),
      // Banked looks are not book state. `initialState()` exists to forget the
      // last book, and these belong to the user across all of them — clearing
      // them here would offer the interview again to someone who banked a look
      // precisely so they would not be asked twice.
      styleProfiles: s.styleProfiles,
      // The same reasoning, and the same bug if it is left out: the editor's
      // voice is the editor's, not this book's. Losing it here would ask for
      // the pen name again on every book and throw away the exemplars that
      // make the notes sound like the ones already approved.
      voice: s.voice,
      // The subject someone is collecting towards outlives the book in front of
      // them, exactly as the voice and the banked looks do.
      harvestInterest: s.harvestInterest,
      fileName: file.name,
      completed: ['intake']
    }))

    try {
      fileDataRef.current = file
      fileKeyRef.current = fileKey(file)

      // Measured now, so the storage question can show this scan's size against
      // the room this browser will actually give the app rather than asking the
      // user to guess at both.
      void storageEstimate().then((estimate) => {
        setState((s) => ({
          ...s,
          storage: {
            scanBytes: file.size,
            quota: estimate?.quota ?? null,
            usage: estimate?.usage ?? null
          }
        }))
      })

      // Before the free pass, not after: this only reads three fields off the
      // File, and it is the difference between watching a progress bar in hope
      // and watching it knowing what is at the end of it.
      // Pages already out with the API, from a session that may have been days
      // ago on another device. Looked up in the same breath as the saved run
      // and with the same name-and-size fallback, because a ticket stranded by
      // a changed modification time is not an inconvenience — it is the only
      // address of work the user has already been billed for.
      const outstanding = await findBatchTicketForFile(file)
      if (outstanding) {
        fileKeyRef.current = outstanding.key
        batchTicketRef.current = outstanding.ticket
        setState((s) => ({ ...s, savedBatch: summarizeTicket(outstanding.ticket) }))
      }

      const known = await findRunForFile(file)
      if (known) {
        fileKeyRef.current = known.key
        // Keep the scan from now on, so the next time is one tap. It was very
        // likely saved before this was possible, and re-picking the file once
        // is the only chance to catch up.
        if (loadPrefs().keepScans !== false && !reopenable.includes(known.key)) {
          if (await saveSourceFile(known.key, file)) {
            setReopenable((keys) => [...keys, known.key])
          }
        }
      }

      // Has this scan already been read on this device? Rendering and OCR are
      // free and repeatable, which is why they were never stored — but free is
      // not quick, and someone reopening a book to fix one word should not
      // watch ten minutes of Tesseract to get back to it. Discarded rather than
      // trusted whenever it might not describe the book any more; see
      // `recon-cache`.
      const wanted = { dpi: RECON_DPI, maxPages: null }
      // Flagged rather than silent: fetching a book's worth of thumbnails and
      // word boxes out of IndexedDB is quick but not instant, and a screen that
      // shows nothing during it looks like a file that failed to open.
      setReusing(true)
      const cached = await loadReconCache(fileKeyRef.current, wanted).finally(() =>
        setReusing(false)
      )
      // Nothing finished, but perhaps something got partway. A phone freezes a
      // backgrounded tab and a browser discards one under memory pressure;
      // neither is preventable from inside a page, and neither has to cost the
      // whole book.
      const partial = cached ? null : await loadReconCheckpoint(fileKeyRef.current, wanted)
      setEmbedded(cached?.source === 'embedded')

      // Said before the wait rather than after it, and said accurately: "this
      // is free, it only costs time" is cold comfort at the start of ten
      // minutes, and simply untrue when the reading is already here.
      if (known) {
        setResumeNote(
          `You have already paid to have this book read — ${known.run.pageCount} pages. ` +
            (cached
              ? 'The scan was read on this device before, so that part is skipped too — ' +
                'the transcription is waiting.'
              : 'Re-reading the scan is free and costs only time; the transcription is ' +
                'waiting at the end of it.')
        )
      } else if (cached) {
        setResumeNote('The scan was already read on this device, so that part is skipped.')
      }

      // The screen stays on while this runs. Reading a long book is ten
      // minutes the page has to stay alive for, and a phone that dims and
      // locks takes the tab down with it — the single most common way this
      // never finished. Released in the `finally` below, whatever happens.
      releaseWakeRef.current = keepAwake()
      setAwake(canKeepAwake())

      // Asset paths come from the platform default, which resolves them
      // against the app's base URL. Repeating them here once meant they were
      // root-absolute and 404'd on any deploy below the domain root.
      const key = fileKeyRef.current
      const result =
        cached ??
        (await runRecon(file, {
          onProgress: setProgress,
          resumeFrom: partial,
          // Never awaited: a slow write must not hold up the next page, and a
          // failed one costs the minutes since the last checkpoint rather than
          // anything that cannot be had again.
          onCheckpoint: (p) => {
            if (loadPrefs().keepScans !== false) {
              void saveReconCheckpoint(key, p, state.pageCount || p.pageText.length, wanted)
            }
          }
        }))
      reconRef.current = result
      setEmbedded(result.source === 'embedded')

      // A PDF that was typeset rather than photographed carries its own text,
      // and reading it off pictures would have been ten minutes spent to get a
      // worse answer. Said here because it changes what the next step is for.
      if (result.source === 'embedded') {
        setResumeNote(
          'This PDF was typeset rather than scanned, so it already contains its own text and ' +
            'none had to be read off pictures of it. Check it at the next step before paying ' +
            'to have it read again — you may not need to.'
        )
      }

      // Written after the reading is in hand and never awaited into the user's
      // path: this is a convenience, and a full quota must not stand between
      // them and the book. Only when they have agreed to book data being kept
      // here at all — the same answer that governs storing the scan.
      if (!cached && loadPrefs().keepScans !== false) {
        void saveReconCache(fileKeyRef.current, result, wanted)
      }

      // Has this book already been paid for? Looked up after the free pass
      // rather than before it, because the crops and thumbnails it produces are
      // what make a resumed session complete rather than partial.
      //
      // By name and size when the exact identity misses, because the third part
      // of that identity is the file's modification time — which a re-download,
      // a backup restore or a sync between devices all change without touching
      // a byte of the book. The key it was found under is kept, so the run goes
      // on being saved where it already lives instead of forking in two.
      const saved = known ? summarizeRun(known.run) : null

      // Placeholder classification until the vision pass lands: page 0 is
      // treated as the title page so the identity gate has evidence to show.
      setState((s) => ({
        ...s,
        pageCount: result.pageCount,
        pagesProcessed: result.pageCount,
        lexicon: result.lexicon,
        classifications: [{ pageIndex: 0, role: 'title-page', selfReportedConfidence: 0 }],
        textSource: result.source,
        cropFor: (tokenId: string) => result.crops.get(tokenId),
        contextCropFor: (tokenId: string) => result.contextCrops.get(tokenId),
        illustrationCandidates: result.illustrations.map((c) => ({
          id: c.region.id,
          pageIndex: c.region.pageIndex,
          bbox: c.region.bbox,
          previewUrl: c.previewUrl,
          ink: c.ink
        })),
        hasApiKey: loadApiKey().length > 0,
        savedRun: saved,
        completed: ['intake', 'recon']
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
      releaseWakeRef.current?.()
      releaseWakeRef.current = null
      setAwake(false)
    }
  }, [])

  /**
   * Reopen a book from what is already stored, with no file picker.
   *
   * The scan is rebuilt as a `File` with the name and modification time it was
   * saved under, so its identity is unchanged and `startRecon` finds the same
   * run it belongs to. Reading the scan again is the free half — render and OCR
   * — and it has to happen, because the crops, the page images and the OCR
   * cross-check are what make a resumed session a whole one rather than text
   * with no evidence behind it.
   */
  /**
   * Send a chosen file down the path its kind needs.
   *
   * The only place that decision is made. A scan has to be read; an EPUB has
   * already been read by whoever made it.
   */
  const openBook = useCallback(
    (file: File) => {
      if (looksLikeEpub(file)) void startEpub(file)
      else void startRecon(file)
    },
    [startEpub, startRecon]
  )

  const reopenSaved = useCallback(
    async (key: string, fileName: string) => {
      const file = await loadSourceFile(key)
      if (!file) {
        setError(
          `The scan of “${fileName}” is no longer stored, so it has to be chosen again. ` +
            'The transcription is safe — opening the same PDF will find it.'
        )
        return
      }
      void startRecon(file)
    },
    [openBook]
  )

  /**
   * The shelf: a repository of the user's own, holding every book whole.
   *
   * IndexedDB is the right store for *using* a book and the wrong one for
   * owning it — it belongs to one browser on one device. This puts the same
   * material somewhere both devices can see, with the user's own token, and it
   * happens on its own at the points where something expensive or laborious has
   * just been finished rather than as a button they have to remember.
   */
  const [shelfBooks, setShelfBooks] = useState<ShelfAbout[]>([])
  const [shelfNote, setShelfNote] = useState<string | null>(null)
  const [shelfBusy, setShelfBusy] = useState(false)

  const saveToShelf = useCallback(
    async (what: string): Promise<void> => {
      const config = loadShelf()
      const key = fileKeyRef.current
      if (!shelfReady(config) || !key) return

      setShelfBusy(true)
      try {
        // Read back what was stored rather than rebuilding it from state: the
        // shelf copy is then the *same* record the device holds, and the two
        // cannot drift into disagreeing about what the book says.
        const run = await loadRun(key)
        if (!run) return

        // The same call Settings makes for a book read before there was a
        // shelf. One implementation, so a book put up by hand is the same file
        // as one put up automatically — otherwise opening it on another device
        // would depend on which button had been pressed months earlier.
        const result = await pushBookToShelf(config, {
          key,
          run,
          answers: loadReviewProgress(key),
          voice: state.voice,
          notesCheckpoint: await loadAnnotationCheckpoint(key),
          scanFile: fileDataRef.current ?? null,
          what
        })
        if (result.scan === null && fileDataRef.current) setShelfNote(result.note)
        setShelfNote(`Saved to ${config.repo}: ${what}.`)
      } catch (err) {
        // Never fatal. The book is safe on this device either way, and a shelf
        // that cannot be written to is a worse day, not a lost one.
        setShelfNote(
          `Could not save to the shelf (${err instanceof Error ? err.message : String(err)}). ` +
            'Everything is still here on this device.'
        )
      } finally {
        setShelfBusy(false)
      }
    },
    [state.voice]
  )

  /**
   * Take a book off the shelf onto this device.
   *
   * Puts the run, the answers, the voice and any unfinished notes pass back
   * into the stores the app already reads, then opens the scan if the shelf has
   * one. Nothing here is a second way of loading a book: after this the
   * ordinary path runs, finds a saved run for the file, and offers it back.
   */
  const openFromShelf = useCallback(
    async (about: ShelfAbout): Promise<void> => {
      const config = loadShelf()
      if (!shelfReady(config)) return
      setShelfBusy(true)
      setShelfNote(`Fetching “${about.fileName}” from ${config.repo}…`)
      try {
        const json = await fetchBook(config, about.key)
        if (!json) {
          setShelfNote(`The shelf lists “${about.fileName}” but the book file is not there.`)
          return
        }
        const file = parseBookFile(json)

        // Pictures the file names rather than carries, fetched before the run
        // is stored so what lands on this device is the whole book. A picture
        // that cannot be fetched is *reported*, never quietly missing: the
        // engine already refuses to draw anything in its place, and a plate
        // that vanished between two devices is exactly the kind of silence
        // that is only noticed once the book is printed.
        const named = Object.entries(file.imagePaths)
        const lost: string[] = []
        for (const [id, path] of named) {
          const bytes = await getBytes(config, path)
          if (bytes) file.run.images.push({ id, bytes: new Uint8Array(bytes) })
          else lost.push(path)
        }

        const stored = await saveRun(file.run)
        if (!stored) {
          setShelfNote(
            'The book came down from the shelf but would not fit in this browser’s storage. ' +
              'Free some space and try again.'
          )
          return
        }
        saveReviewProgress(file.run.key, file.answers)
        if (file.voice?.penName !== undefined) saveVoice(file.voice)
        if (file.notesCheckpoint) await saveAnnotationCheckpoint(file.notesCheckpoint)

        setSavedRuns(await listRuns())

        // With the scan, this is a complete move: the book opens and every gate
        // that shows pixels works. Without it, the work is here and the user is
        // asked for the file — which is the same bargain the app already makes
        // when a scan was never kept.
        if (file.scan) {
          const bytes = await getBytes(config, file.scan.path)
          if (bytes) {
            const opened = new File([new Uint8Array(bytes)], file.scan.fileName, {
              type: /\.epub$/i.test(file.scan.fileName) ? 'application/epub+zip' : 'application/pdf'
            })
            await saveSourceFile(file.run.key, opened)
            setReopenable(await storedFileKeys())
            setShelfNote(lost.length > 0 ? lostNote(lost).trim() : null)
            void startRecon(opened)
            return
          }
        }
        setShelfNote(
          `“${about.fileName}” is on this device now — the transcription, the corrections and ` +
            'the notes. The scan is not on the shelf, so choose the same file above and it will ' +
            'find all of it.' +
            lostNote(lost)
        )
      } catch (err) {
        setShelfNote(
          `Could not open that book (${err instanceof Error ? err.message : String(err)}).`
        )
      } finally {
        setShelfBusy(false)
      }
    },
    [startRecon]
  )

  /** What is on the shelf, listed once at start-up when one is configured. */
  useEffect(() => {
    const config = loadShelf()
    if (!shelfReady(config)) return
    let live = true
    void (async () => {
      try {
        const books = await readShelf(config)
        if (live) setShelfBooks(books)
      } catch {
        // A shelf that cannot be read is not a reason to fail the intake
        // screen. The Settings panel says what is wrong, in words.
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) openBook(file)
    },
    [startRecon]
  )

  /**
   * Bring the user's banked looks in at startup (SPEC §7).
   *
   * Loaded once, before any book is open, because the design gate reads them
   * straight out of state — that is what keeps `questions()` a pure function
   * with no I/O in it.
   */
  useEffect(() => {
    void (async () => {
      const profiles = await listProfiles()
      if (profiles.length > 0) setState((s) => ({ ...s, styleProfiles: profiles }))
      setSavedRuns(await listRuns())
      setReopenable(await storedFileKeys())
      const prefs = loadPrefs()
      setState((s) => ({
        ...s,
        keepScans: prefs.keepScans,
        defaultModelId: prefs.modelId,
        defaultLook: loadDefaultLook(),
        // The editor is the same person on every book, so the annotate gate's
        // questions arrive prefilled from here rather than empty.
        voice: loadVoice(),
        harvestInterest: loadBank().interest
      }))
    })()
  }, [])

  const complete = useCallback(
    (extra: Partial<WizardState> = {}) => {
      setState((s) => ({
        ...s,
        ...extra,
        answers: { ...s.answers, [step.id]: currentAnswers },
        completed: [...s.completed, step.id]
      }))
      setAnswers({})
    },
    [step.id, currentAnswers]
  )

  /**
   * Everything the wizard derives from a set of transcriptions.
   *
   * Shared by the paid run and by restoring a saved one, and that is the point:
   * if the two built state differently, a resumed session would quietly be a
   * different book from a freshly-read one. The verification findings are
   * *recomputed* rather than stored, because they are a pure cross-check
   * against OCR that costs nothing — storing them would only create a second
   * copy that could disagree with the scan in front of us.
   */
  const stateFromTranscriptions = useCallback(
    (
      transcriptions: readonly PageTranscription[],
      failures: readonly { pageIndex: number }[]
    ): Partial<WizardState> => {
      const recon = reconRef.current
      const wordsByPage = new Map<number, { text: string; confidence: number }[]>()
      for (const w of recon?.words ?? []) {
        const list = wordsByPage.get(w.pageIndex) ?? []
        list.push(w)
        wordsByPage.set(w.pageIndex, list)
      }

      const meta = mergeMetadata(transcriptions)
      return {
        metadata: {
          ...state.metadata,
          title: meta['title'] ?? state.metadata.title,
          author: meta['author'] ?? state.metadata.author,
          originalYear: meta['originalYear'] ?? state.metadata.originalYear,
          originalPublisher: meta['originalPublisher'] ?? state.metadata.originalPublisher,
          originalPlace: meta['originalPlace'] ?? state.metadata.originalPlace
        },
        classifications: transcriptions.map((t) => ({
          pageIndex: t.pageIndex,
          role: t.role,
          selfReportedConfidence: 0,
          furniture: t.furniture
        })),
        // Per-page cross-checks against OCR, plus the ones that need more than
        // one page to see — a seam that does not join, a leaf read twice, a
        // running head swallowed into the body on one page out of forty.
        findings: [
          ...transcriptions.flatMap((t) => verifyPage(t, wordsByPage.get(t.pageIndex) ?? [])),
          ...verifyBook(transcriptions)
        ],
        uncertainties: transcriptions.flatMap((t) =>
          t.uncertain.map((u) => ({
            pageIndex: t.pageIndex,
            text: u.text,
            alternatives: u.alternatives,
            reason: u.reason
          }))
        ),
        failedPages: failures.map((f) => f.pageIndex),
        // What was read off each page, for the uncertainty gate to show beside
        // the scan. Built here rather than at the gate because this is the one
        // place both a fresh run and a restored one pass through, and a gate
        // that showed the text only after a live read would be worst exactly
        // when it matters — coming back to a book the next day.
        pageText: Object.fromEntries(
          transcriptions.map((t) => [t.pageIndex, transcriptionText(t)])
        ),
        // What OCR read and the transcription lacks, per page. Computed here
        // for the same reason as `pageText`: both a fresh run and a restored
        // one come through this function, and a gate that could only offer the
        // recovery on a live read would fail exactly when it matters.
        droppedRuns: Object.fromEntries(
          transcriptions
            .map((t) => {
              const words = wordsByPage.get(t.pageIndex) ?? []
              // A leaf whose text was never going to reach the book has nothing
              // to be missing from it. The title page is mined for metadata and
              // the scanned contents page is discarded, so OCR reads a page of
              // words against a body that rightly holds none — and every word
              // on it reports as dropped, with an offer to splice the imprint
              // into chapter one.
              const kept = dispositionFor(t.role)
              if (kept === 'discard' || kept === 'extract-metadata') {
                return [t.pageIndex, []] as const
              }
              // Weak gaps included: the gate shows every disagreement now, so
              // discarding the one- and two-word ones here is what produced
              // "18 words are absent" beside a single four-word offer.
              return [
                t.pageIndex,
                findDroppedRuns(checkableText(t), words, { includeWeak: true })
              ] as const
            })
            .filter(([, runs]) => runs.length > 0)
        ),
        // Assemble immediately: seam repair and footnote linking are pure and
        // fast, and Gate 3 needs the finished document to describe its shape.
        document: assembleBook(transcriptions)
      }
    },
    [state.metadata]
  )

  /**
   * Use a transcription this file was already paid for.
   *
   * Everything else about the session was rebuilt for free on the way here —
   * the page images, the word crops, the lexicon — so this is a complete
   * resumption rather than a degraded one. The identity answers travel with the
   * run because they shaped it: the orthography choice and the long-s decision
   * went into the prompt, and letting the user change them now would be
   * offering a setting that cannot take effect on text already written.
   */
  const useSavedRun = useCallback(async () => {
    const key = fileKeyRef.current
    if (!key) return
    setError(null)

    const saved = await loadRun(key)
    if (!saved) {
      setError('That saved transcription could not be read. It will have to be read again.')
      return
    }

    transcriptionRef.current = {
      transcriptions: saved.transcriptions,
      findings: [],
      failures: saved.failures,
      usage: saved.usage,
      cancelled: false
    }

    // Stored answers are untrusted input, so only the shapes an answer can
    // legitimately hold are let back in.
    const restored: Answers = {}
    for (const [id, value] of Object.entries(saved.identityAnswers)) {
      if (
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (Array.isArray(value) && value.every((v) => typeof v === 'string'))
      ) {
        restored[id] = value as AnswerValue
      }
    }

    // The corrections come back with the run. They are the other thing here
    // that cannot be regenerated from the scan: an hour spent reading a book
    // against its scan is an hour, and a refresh must not cost it.
    setEdits(saved.edits)
    // And the pixels of any pictures the editor supplied, which are the one
    // part of an illustration that cannot be re-derived from the scan.
    const restoredImages = new Map(suppliedBytesRef.current)
    for (const image of saved.images) restoredImages.set(image.id, image.bytes)
    suppliedBytesRef.current = restoredImages

    setState((s) => ({
      ...s,
      answers: {
        ...s.answers,
        'gate-identity': { ...(s.answers['gate-identity'] ?? {}), ...restored }
      }
    }))
    complete({
      ...stateFromTranscriptions(saved.transcriptions, saved.failures),
      // The verdicts come back with the run. They were paid for alongside it,
      // and a reopened book that has forgotten them shows the gate every spot
      // as though nobody had ever looked.
      adjudicated: spotsFromStored(saved.adjudicated)
    })
  }, [complete, stateFromTranscriptions])

  /**
   * Keep a finished run, and say so if it could not be kept.
   *
   * A cancelled run is still worth storing — the user paid for the pages it did
   * read — but it must not overwrite a *longer* run that is already there,
   * which is what stopping a re-read halfway through would otherwise do.
   */
  const persistRun = useCallback(
    async (
      result: RunResult,
      identityAnswers: Record<string, unknown>,
      modelId: string,
      corrections: readonly BookEdit[] = [],
      images: ReadonlyMap<string, Uint8Array> = new Map(),
      complete = true,
      adjudicated: Record<string, AdjudicatedSpot> = {}
    ): Promise<void> => {
      const key = fileKeyRef.current
      const file = fileDataRef.current
      if (!key || !file || result.transcriptions.length === 0) return

      if (result.cancelled) {
        const existing = await loadRunSummary(key)
        if (existing && existing.pageCount >= result.transcriptions.length) return
      }

      const stored = await saveRun(
        createSavedRun({
          key,
          fileName: file.name,
          pageCount: result.transcriptions.length,
          transcriptions: result.transcriptions,
          failures: result.failures,
          usage: result.usage,
          modelId,
          identityAnswers,
          edits: corrections,
          images,
          complete,
          adjudicated
        })
      )
      if (!stored) {
        setError(
          'The transcription could not be saved in this browser, so closing the tab ' +
            'will lose it. Finish the book in this session, or free up storage and try again.'
        )
        return
      }

      // The scan goes in after the run, never with it. It is two orders of
      // magnitude larger, so it is the write that meets a quota — and losing
      // the convenience of reopening without the file picker is a very
      // different thing from losing the transcription. A failure here is
      // deliberately silent: the book is safe, and the user is told about it at
      // the moment it matters, on the intake screen.
      // Only when the user asked for it. `null` means they have not been asked
      // yet — which happens when a finished run is reused and the transcribe
      // gate never came up — and keeping it then is the harmless default, since
      // the question is still there to change later.
      if (loadPrefs().keepScans !== false && (await saveSourceFile(key, file))) {
        setReopenable((keys) => (keys.includes(key) ? keys : [...keys, key]))
      }
    },
    []
  )

  /**
   * The fact bank as files, named after the book the export screen is about.
   *
   * Derived rather than stored: the entries are the truth and the two files are
   * renderings of them, so an edit to the title at the export gate renames both
   * without anything having to be regenerated.
   */
  const bankMemo = useMemo(() => {
    if (bankFacts.length === 0) return null
    const answers = state.answers['export'] ?? {}
    const files = renderBank(
      {
        title: String(answers['title'] ?? state.metadata.title ?? ''),
        author: String(answers['author'] ?? state.metadata.author ?? ''),
        originalYear: String(answers['originalYear'] ?? state.metadata.originalYear ?? ''),
        fileName: state.fileName ?? 'book.pdf',
        harvestedAt: new Date().toISOString()
      },
      bankFacts
    )
    return { files, count: bankFacts.length }
  }, [bankFacts, state.answers, state.metadata, state.fileName])

  /**
   * Everything both doors need before a page is sent: a checked key, the model,
   * the vetted vocabulary and the OCR grouped for cross-checking.
   *
   * One function because the alternative is two, and the two would drift. The
   * batch path spends the same money on the same pages, so it must validate the
   * same credential, obey the same Gate 1 verdicts and be measured against the
   * same OCR. Returns null when something is missing, having already said why.
   */
  const prepareRun = useCallback(async (): Promise<{
    key: string
    modelId: string
    identity: Record<string, unknown>
    bookContext: string
    vetted: ReturnType<typeof vetLexicon>
    wordsByPage: Map<number, ReconResult['words']>
    prefs: ReturnType<typeof loadPrefs>
  } | null> => {
    const recon = reconRef.current
    if (!recon) return null

    const identity = state.answers['gate-identity'] ?? {}
    const key = (currentAnswers['apiKey'] as string) || loadApiKey()
    if (!key) {
      setError('An API key is needed to transcribe.')
      return null
    }

    // Check the credential before spending anything. Without this a bad key
    // fails once per page for the whole book — slow, and it looks like the app
    // is broken rather than the key being wrong.
    setPendingCost(null)
    setError(null)
    const credential = await validateApiKey(key)
    if (!credential.ok) {
      setError(credential.message ?? 'That API key could not be used.')
      return null
    }
    saveApiKey(key)

    const prefs = loadPrefs()
    const modelId = (currentAnswers['model'] as string) ?? prefs.modelId
    // `bookContext` deliberately not stored: it is a fact about *this* book
    // ("a 1662 alchemical treatise"), so keeping it as a device preference was
    // a category error. It was written and never read back, so nothing is lost
    // by dropping it — and restoring it on the next book would have been wrong.
    savePrefs({ ...prefs, modelId })

    // Group OCR words by page for the verification cross-check.
    const wordsByPage = new Map<number, ReconResult['words']>()
    for (const w of recon.words) {
      const list = wordsByPage.get(w.pageIndex) ?? []
      list.push(w)
      wordsByPage.set(w.pageIndex, list)
    }

    return {
      key,
      modelId,
      identity,
      bookContext: (currentAnswers['bookContext'] as string) ?? '',
      vetted: vetLexicon(
        state.lexicon,
        (identity['terms'] as Record<string, TermDecision> | undefined) ?? {}
      ),
      wordsByPage,
      prefs
    }
  }, [state.answers, state.lexicon, currentAnswers])

  /**
   * The second reading, over the leaves the checks flagged.
   *
   * Runs between the transcription arriving and it being saved, so what it
   * concludes is stored beside the reading it is about. It is the only paid
   * step whose failure costs nothing: a leaf it cannot read leaves its spots
   * unchecked, which is exactly how every spot arrived before this existed.
   */
  const secondRead = useCallback(
    async (
      transcriptions: readonly PageTranscription[],
      wordsByPage: Map<number, ReconResult['words']>,
      client: { apiKey: string; modelId: string },
      file: File,
      /**
       * The leaves the gate is asking about, when the caller knows them.
       *
       * Without it this walked every leaf carrying any gap, which is a far
       * wider set than the gate shows — 308 against 132 on a real book. Each
       * leaf is an image and images are nearly all of the cost, so that was
       * more than double the bill for spots nobody would ever be asked about.
       * Absent, the old behaviour stands: a fresh run has no gate yet.
       */
      onlyPages?: ReadonlySet<number>
    ): Promise<Record<string, AdjudicatedSpot>> => {
      const leaves: FlaggedLeaf[] = []
      for (const page of transcriptions) {
        if (onlyPages && !onlyPages.has(page.pageIndex)) continue
        // Same rule as the gate: a leaf whose text was never going to reach the
        // book has nothing to be missing from it, so it is not worth paying to
        // look at again.
        const kept = dispositionFor(page.role)
        if (kept === 'discard' || kept === 'extract-metadata') continue
        const runs = findDroppedRuns(checkableText(page), wordsByPage.get(page.pageIndex) ?? [], {
          includeWeak: true
        })
        if (runs.length === 0) continue
        leaves.push({
          pageIndex: page.pageIndex,
          transcription: transcriptionText(page),
          spots: runs.map((run) => ({
            id: spotId(page.pageIndex, run),
            ocrReading: run.text,
            after: run.after,
            before: run.before
          }))
        })
      }
      if (leaves.length === 0) return {}

      setCheckProgress({ leaf: 0, total: leaves.length, settled: 0 })
      try {
        const result = await runBrowserAdjudication({
          fileData: file,
          leaves,
          client: { ...client, effort: 'medium' },
          imageLongEdge: loadPrefs().imageLongEdge,
          onProgress: (p) => setCheckProgress({ leaf: p.leaf, total: p.total, settled: p.settled })
        })
        setCheckNote(describeAdjudication(result))
        return Object.fromEntries(result.spots)
      } catch (err) {
        // Never fatal. The book is read and paid for; this was the cheap extra.
        setCheckNote(
          `The spots could not be checked a second time (${
            err instanceof Error ? err.message : String(err)
          }). They are all still here to judge yourself.`
        )
        return {}
      } finally {
        setCheckProgress(null)
      }
    },
    []
  )

  /** Run the paid pass. Only reached after the user approves the estimate. */
  const startTranscription = useCallback(async () => {
    const data = fileDataRef.current
    const ready = await prepareRun()
    if (!ready || !data) return
    const { key, modelId, identity, bookContext, vetted, wordsByPage, prefs } = ready

    const controller = new AbortController()
    abortRef.current = controller

    // Pages an earlier run already bought, when the user chose to carry on.
    // Loaded here rather than held in state because it is the whole
    // transcription, not a summary, and nothing renders from it.
    const runKey = fileKeyRef.current
    const resuming =
      state.savedRun !== null &&
      !state.savedRun.complete &&
      (currentAnswers['useSavedRun'] ?? 'resume') === 'resume'
    const alreadyRead = resuming && runKey ? ((await loadRun(runKey))?.transcriptions ?? []) : []

    // Warned once, not once per checkpoint: a storage failure repeated every
    // five pages would bury the run's own progress under its own complaint.
    let warnedAboutStorage = false

    try {
      const result = await runBrowserTranscription({
        fileData: data,
        ocrWordsByPage: wordsByPage,
        pageText: reconRef.current?.pageText ?? [],
        client: { apiKey: key, modelId, effort: 'medium' },
        // The vetted list, not the raw harvest. The gate promised that
        // confirming a word fixes it everywhere; before this the verdicts were
        // read by nothing, and a word the user had just rejected was still
        // handed to the model under the heading "confirmed as correct".
        lexicon: vetted.entries,
        termCorrections: vetted.corrections,
        orthography: (identity['orthography'] as 'preserve' | 'modernize') ?? 'preserve',
        normalizeLongS: identity['longS'] === true,
        bookContext,
        imageLongEdge: prefs.imageLongEdge,
        onProgress: setRunProgress,
        resumeFrom: alreadyRead,
        // The whole point: pages are stored as they arrive, so a tab that dies
        // at page 180 of 300 keeps the 180 that were paid for. Marked
        // incomplete, because resuming a half-read book and using a finished
        // one are different offers and confusing them costs money.
        onCheckpoint: async ({ transcriptions, failures, usage }) => {
          const file = fileDataRef.current
          const liveKey = fileKeyRef.current
          if (!file || !liveKey || transcriptions.length === 0) return
          const ok = await saveRun(
            createSavedRun({
              key: liveKey,
              fileName: file.name,
              pageCount: transcriptions.length,
              transcriptions,
              failures,
              usage,
              modelId,
              identityAnswers: identity,
              complete: false
            })
          )
          if (!ok && !warnedAboutStorage) {
            warnedAboutStorage = true
            setError(
              'Pages are being read but cannot be saved as they arrive — this browser ' +
                'refused the write. If the tab closes before the book finishes, the ' +
                'reading so far will be lost. Free up storage if you can.'
            )
          }
        },
        signal: controller.signal
      })

      transcriptionRef.current = result

      // Look again at the flagged spots, before any of them reach the user.
      // After the transcription is in hand and before it is saved, so the
      // verdicts are stored with the reading they belong to.
      const checked =
        (currentAnswers['secondReading'] ?? 'yes') === 'yes'
          ? await secondRead(result.transcriptions, wordsByPage, { apiKey: key, modelId }, data)
          : {}

      // Store it before anything else can go wrong. This is the only step in
      // the app the user cannot repeat for free, and a refresh, a crash or a
      // closed tab between here and the export used to lose all of it.
      await persistRun(
        result,
        state.answers['gate-identity'] ?? {},
        modelId,
        [],
        new Map(),
        !result.cancelled,
        checked
      )
      // And onto the shelf, which is the copy that survives this device. The
      // transcription is the one thing here that cannot be had again for free.
      void saveToShelf(`the transcription — ${result.transcriptions.length} page(s)`)

      complete({
        ...stateFromTranscriptions(result.transcriptions, result.failures),
        adjudicated: checked
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunProgress(null)
      abortRef.current = null
    }
  }, [state, currentAnswers, complete, prepareRun, persistRun, stateFromTranscriptions])

  /**
   * Hand the book over and let the tab go.
   *
   * The ticket is written after every batch is created, before the next page is
   * rendered. That ordering is the whole safety property: from the instant a
   * batch exists, those pages are being read and billed, and the only way back
   * to them is an id that lives nowhere else. A submission killed by a closed
   * lid, a dead battery or a lost network leaves behind a ticket naming exactly
   * the batches that got out — never a batch nothing knows about.
   *
   * A ticket that will not save stops the submission cold, for the same reason.
   */
  const submitBatch = useCallback(async () => {
    const data = fileDataRef.current
    const ready = await prepareRun()
    if (!ready || !data) return
    const { key, modelId, identity, bookContext, vetted, prefs } = ready

    const runKey = fileKeyRef.current
    if (!runKey) return

    const controller = new AbortController()
    abortRef.current = controller

    const ticket = createBatchTicket({
      key: runKey,
      fileName: data.name,
      modelId,
      pageCount: state.pageCount,
      identityAnswers: identity,
      termCorrections: vetted.corrections
    })
    batchTicketRef.current = ticket

    setSubmitProgress({ page: 0, total: state.pageCount, batches: 0 })
    try {
      const result = await submitBookBatch({
        fileData: data,
        pageText: reconRef.current?.pageText ?? [],
        client: { apiKey: key, modelId, effort: 'medium' },
        lexicon: vetted.entries,
        orthography: (identity['orthography'] as 'preserve' | 'modernize') ?? 'preserve',
        normalizeLongS: identity['longS'] === true,
        bookContext,
        imageLongEdge: prefs.imageLongEdge,
        onProgress: setSubmitProgress,
        onBatchCreated: async (batch: TicketBatch) => {
          ticket.batches.push(batch)
          if (!(await saveBatchTicket(ticket))) {
            throw new Error(
              'A batch of pages was submitted but this browser refused to save the ' +
                'ticket for it. Those pages are being read and charged for, and without ' +
                'the ticket there is no way to collect them. Stopping here rather than ' +
                'submitting more. Free up storage and try again — and note the batch id ' +
                `${batch.id} if you can.`
            )
          }
          setState((s) => ({ ...s, savedBatch: summarizeTicket(ticket) }))
        },
        signal: controller.signal
      })

      ticket.complete = result.complete
      await saveBatchTicket(ticket)
      setState((s) => ({ ...s, savedBatch: summarizeTicket(ticket) }))

      if (!result.complete && !result.cancelled) {
        setError(
          'Not every page reached a batch. What was submitted can still be collected; ' +
            'the rest can be submitted again from this screen.'
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitProgress(null)
      abortRef.current = null
    }
  }, [state.pageCount, prepareRun])

  /**
   * Fetch whatever has finished, and fold it into the run.
   *
   * Additive on purpose. Eleven batches do not end at the same moment, so this
   * merges what it collects with what a previous collection already banked and
   * marks only the batches it actually read. Coming back to it an hour later
   * picks up where this left off; nothing is fetched or merged twice.
   *
   * The run is written before the step completes, and the ticket is only
   * deleted once every batch is in — an outstanding ticket is the user's
   * receipt, and dropping it early would leave paid pages unreachable.
   */
  const collectBatch = useCallback(async () => {
    const ticket = batchTicketRef.current
    const ready = await prepareRun()
    if (!ready || !ticket) return
    const { key, modelId, wordsByPage } = ready

    const outstanding = pendingBatches(ticket)
    if (outstanding.length === 0) return

    // The ticket is authoritative about which file this is. It was found by the
    // same name-and-size fallback the run lookup uses, and if the two ever
    // disagreed the merge below would read one record and write another —
    // banking collected pages into a run nothing will look at again.
    fileKeyRef.current = ticket.key

    setCollectProgress({ checked: 0, total: outstanding.length, collected: 0 })
    setBatchWaiting(null)
    try {
      const result = await collectBookBatch({
        client: { apiKey: key, modelId },
        batches: outstanding,
        ocrWordsByPage: wordsByPage,
        termCorrections: ticket.termCorrections,
        onProgress: setCollectProgress
      })

      const collected = new Set(result.collectedIds)
      for (const batch of ticket.batches) {
        if (collected.has(batch.id)) batch.collected = true
      }

      // Merge with anything an earlier collection banked. Keyed by page so a
      // batch fetched twice — which costs nothing but could scramble the order
      // — cannot put the same leaf in the book twice.
      const banked = (await loadRun(ticket.key))?.transcriptions ?? []
      const byPage = new Map(banked.map((t) => [t.pageIndex, t]))
      for (const page of result.transcriptions) byPage.set(page.pageIndex, page)
      const transcriptions = [...byPage.values()].sort((a, b) => a.pageIndex - b.pageIndex)

      const everything = pendingBatches(ticket).length === 0 && ticket.complete

      // The same second reading the live path runs. Only once the whole book is
      // in: adjudicating half a book would pay to look at leaves whose seams
      // are still missing their other side, and would have to be redone.
      const file = fileDataRef.current
      const checked =
        everything && file && (currentAnswers['secondReading'] ?? 'yes') === 'yes'
          ? await secondRead(transcriptions, wordsByPage, { apiKey: key, modelId }, file)
          : {}

      const merged: RunResult = {
        transcriptions,
        findings: result.findings,
        failures: result.failures,
        usage: result.usage,
        cancelled: false
      }
      transcriptionRef.current = merged

      await persistRun(
        merged,
        ticket.identityAnswers,
        ticket.modelId,
        [],
        new Map(),
        everything,
        checked
      )
      void saveToShelf(`the transcription — ${transcriptions.length} page(s) from a batch`)

      if (everything) {
        // Every page is in the run now, so the receipt has nothing left to
        // point at. Only here — never on a partial collection.
        await deleteBatchTicket(ticket.key)
        batchTicketRef.current = null
        setState((s) => ({ ...s, savedBatch: null }))
        complete({
          ...stateFromTranscriptions(merged.transcriptions, merged.failures),
          adjudicated: checked
        })
        return
      }

      await saveBatchTicket(ticket)
      setState((s) => ({ ...s, savedBatch: summarizeTicket(ticket) }))

      const running = result.stillRunning.length
      setBatchWaiting(
        running > 0
          ? `${running} batch${running === 1 ? ' is' : 'es are'} still being read. ` +
              `${result.transcriptions.length} page(s) collected and saved so far — ` +
              'you can close this tab and come back.'
          : 'Everything submitted so far has been collected, but not every page of the ' +
              'book was submitted. Collect again once the rest have been sent.'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCollectProgress(null)
    }
  }, [prepareRun, persistRun, stateFromTranscriptions, complete, secondRead, currentAnswers])

  /** Give up on an outstanding batch, keeping nothing but what was collected. */
  const abandonBatch = useCallback(async () => {
    const ticket = batchTicketRef.current
    if (!ticket) return
    await deleteBatchTicket(ticket.key)
    batchTicketRef.current = null
    setState((s) => ({ ...s, savedBatch: null }))
  }, [])

  /**
   * Build the edition.
   *
   * The PDF is the deliverable now, and it is produced here rather than handed
   * to a TeX engine that may not exist — the layout engine laid these pages out
   * and pdf-lib wrote them, both in this tab. Which means the page count and the
   * layout warnings are *measured*, so the two KDP checks that used to report
   * `pending` can report the truth.
   *
   * The `.tex` stays as a secondary download during the transition, so there is
   * always a working path out for anyone who wants to typeset it themselves.
   */
  const runExport = useCallback(async () => {
    const doc = correctedDocument
    if (!doc) return
    setError(null)

    const profile = appliedLook(state).style

    const edition = editionFromAnswers(currentAnswers)

    // The publisher's own details belong to the imprint, not to this book, so
    // they go back onto the banked look — "answer once, apply everywhere" —
    // and the export screen says so rather than changing saved state silently.
    const banked = bankedProfileRef.current
    if (banked) {
      const imprint = {
        imprint: edition.imprint ?? '',
        copyrightHolder: edition.copyrightHolder ?? '',
        publicDomainNotice: currentAnswers['publicDomainNotice'] !== false
      }
      const changed =
        imprint.imprint !== banked.imprint.imprint ||
        imprint.copyrightHolder !== banked.imprint.copyrightHolder ||
        imprint.publicDomainNotice !== banked.imprint.publicDomainNotice
      if (changed) {
        const updated = newSavedProfile({
          id: banked.id,
          name: banked.name,
          style: banked.style,
          imprint
        })
        if (await saveProfile(updated)) {
          bankedProfileRef.current = updated
          setState((s) => ({
            ...s,
            styleProfiles: s.styleProfiles.map((p) => (p.id === updated.id ? updated : p))
          }))
          setBankedNote(`Saved to “${updated.name}” for your next book.`)
        }
      }
    }
    const input = {
      document: doc,
      profile,
      edition,
      // Replaced below by the measured count; this only stands in if the
      // interior cannot be built at all.
      estimatedPageCount: state.pageCount,
      // The structure gate asked what to do with notes that couldn't be placed.
      omitOrphanFootnotes: (state.answers['gate-structure'] ?? {})['orphanNotes'] === 'omit'
    }
    setExported(buildExport(input))

    try {
      const interior = await renderInterior(doc, profile, {
        edition: { ...edition, notices: edition.notices },
        onProgress: (done, total) => setBuildProgress({ done, total }),
        orphanNotes: input.omitOrphanFootnotes ? 'omit' : 'collect',
        images: drawableImageBytes()
      })
      setPdf({ bytes: interior.bytes, pageCount: interior.pageCount })
      setBuildNote(null)
      // Re-report now that the estimates are real numbers.
      setExported(
        buildExport({
          ...input,
          typeset: {
            pageCount: interior.pageCount,
            warnings: interior.warnings.map(
              (w) =>
                `Page ${w.pageIndex + 1}: a line runs past the margin — “${w.text.slice(0, 60)}”`
            ),
            notesPlaced: interior.notesPlaced,
            notesCollected: interior.notesCollected,
            notesDropped: interior.notesDropped,
            imagesPlaced: interior.imagesPlaced,
            imagesDropped: interior.imagesDropped
          }
        })
      )
    } catch (cause) {
      setPdf(null)
      setBuildNote(
        cause instanceof Error
          ? `The interior could not be built: ${cause.message}`
          : 'The interior could not be built.'
      )
    } finally {
      setBuildProgress(null)
    }
    complete()
  }, [state, currentAnswers, complete])

  /**
   * Apply the review gate's per-page verdicts. "Read this page again" costs
   * money, so it re-runs only the pages asked for, at a higher resolution than
   * the first pass — the reason to look again is usually that the page was hard
   * to read. "Leave this page out" excludes it, but the export still accounts
   * for it rather than letting it vanish.
   */
  /**
   * Which flagged spots have not been looked at again yet.
   *
   * Counted from the gate's own rows rather than from a flag, so the offer
   * disappears once every spot carries a verdict instead of lingering as a
   * button that would spend money to re-answer answered questions.
   */
  /** How many leaves the second reading took off the list, for the notice. */
  const settledCount = useMemo(() => settledLeaves(liveState).size, [liveState])

  const unchecked = useMemo(() => {
    let spots = 0
    const leaves = new Set<number>()
    // Only the leaves the gate actually asks about. Every leaf carrying any gap
    // is a much larger set — on a real book, 308 against the 132 on screen —
    // and the pass is priced per leaf-image, so counting the wider set quotes
    // and spends more than double for spots the user is never shown.
    const flagged = messagesByPage(liveState)
    for (const [pageIndex, runs] of Object.entries(state.droppedRuns)) {
      if (!flagged.has(Number(pageIndex))) continue
      runs.forEach((run) => {
        if (state.adjudicated[spotId(Number(pageIndex), run)]) return
        spots += 1
        leaves.add(Number(pageIndex))
      })
    }
    return { spots, leaves: leaves.size }
  }, [state.droppedRuns, state.adjudicated, liveState])

  /**
   * Have the model read the flagged spots, from the gate, on demand.
   *
   * The same pass the live runner performs, over whatever is flagged now — so
   * it works on a transcription bought weeks ago, and the verdicts are saved
   * back onto that run rather than living for the length of a tab.
   */
  const runSecondReading = useCallback(async () => {
    const run = transcriptionRef.current
    const recon = reconRef.current
    const file = fileDataRef.current
    const key = loadApiKey()
    setPendingCheckCost(null)
    if (!run || !recon || !file) return
    if (!key) {
      setError('An API key is needed to have the spots read again.')
      return
    }

    const wordsByPage = new Map<number, ReconResult['words']>()
    for (const w of recon.words) {
      const list = wordsByPage.get(w.pageIndex) ?? []
      list.push(w)
      wordsByPage.set(w.pageIndex, list)
    }

    setError(null)
    const checked = await secondRead(
      run.transcriptions,
      wordsByPage,
      { apiKey: key, modelId: loadPrefs().modelId },
      file,
      new Set(messagesByPage(liveState).keys())
    )
    if (Object.keys(checked).length === 0) return

    // Merged, not replaced: a spot judged on an earlier visit keeps its verdict
    // rather than being paid for twice.
    const merged = { ...state.adjudicated, ...checked }
    setState((s) => ({ ...s, adjudicated: merged }))
    // Saved onto the run it belongs to, so closing the tab does not lose what
    // was just bought — the same rule the transcription itself follows.
    await persistRun(
      run,
      state.answers['gate-identity'] ?? {},
      loadPrefs().modelId,
      edits,
      suppliedBytesRef.current,
      true,
      merged
    )
  }, [state.adjudicated, state.answers, edits, secondRead, persistRun, liveState])

  const finishUncertainties = useCallback(async () => {
    const run = transcriptionRef.current
    const data = fileDataRef.current
    const recon = reconRef.current
    if (!run || !data || !recon) {
      complete()
      return
    }

    const redo: number[] = []
    const skip: number[] = []
    const attention: Attention[] = []
    /** Leaves the user retyped here, and what they retyped on each. */
    const corrected = new Map<number, Record<string, string>>()
    /**
     * Which individual gaps the user said to put back, per leaf.
     *
     * Per gap rather than per leaf, which is the point of the change: a leaf
     * with eighteen disagreements on it almost never wants all eighteen or none
     * of them, and the blanket verdict this replaces made the user choose
     * between those two.
     */
    const restoreRuns = new Map<number, Set<number>>()
    for (const [key, value] of Object.entries(currentAnswers)) {
      const gaps = /^page-(\d+)-gaps$/.exec(key)
      if (gaps && value && typeof value === 'object' && !Array.isArray(value)) {
        const pageIndex = Number(gaps[1])
        const wanted = new Set<number>()
        for (const [rowId, verdict] of Object.entries(value as Record<string, string>)) {
          const n = /^p\d+d(\d+)$/.exec(rowId)
          if (verdict === 'restore' && n) wanted.add(Number(n[1]))
        }
        if (wanted.size > 0) restoreRuns.set(pageIndex, wanted)
        continue
      }
      const fix = /^page-(\d+)-fix$/.exec(key)
      if (fix && value && typeof value === 'object' && !Array.isArray(value)) {
        corrected.set(Number(fix[1]), value as Record<string, string>)
        continue
      }
      const match = /^page-(\d+)$/.exec(key)
      if (!match) continue
      const pageIndex = Number(match[1])
      if (value === 'redo') redo.push(pageIndex)
      if (value === 'skip') skip.push(pageIndex)
      if (value === 'later') {
        attention.push({
          pageIndex,
          message: 'You marked this leaf to fix by hand.'
        })
      }
    }

    /**
     * Corrections typed at the gate, folded in before anything else reads the
     * text — a re-read is decided against the page as the user has left it.
     *
     * They are ordinary `text` edits: the gate and the proof step produce the
     * same thing, so a fix made here is saved with the run, undoable there, and
     * applies to the book rather than to the screen it was typed on.
     */
    // With the markup on, because that is what the boxes were filled with — a
    // comparison against the bare text would call every emphasised block
    // corrected and report a book full of edits nobody made.
    const pristine = new Map(
      (state.document?.blocks ?? []).map((b) => [b.id, withMarkup(b.text, b.emphasis, b.strong)])
    )
    let nextEdits = edits
    for (const [pageIndex, corrections] of corrected) {
      // Not onto a leaf that is being read again or left out. Block ids are
      // derived from the page and block index, so a correction typed against
      // the old reading would land on whatever the new one puts in that slot —
      // a stale fix pasted over text it was never about.
      if (redo.includes(pageIndex) || skip.includes(pageIndex)) continue
      nextEdits = withCorrections(nextEdits, corrections, pristine)
    }
    /** Leaves whose text the user actually changed, not merely visited. */
    const editedPages = new Set(
      [...corrected.entries()]
        .filter(([pageIndex]) => !redo.includes(pageIndex) && !skip.includes(pageIndex))
        .filter(([, c]) => Object.entries(c).some(([id, text]) => text !== pristine.get(id)))
        .map(([pageIndex]) => pageIndex)
    )

    /**
     * Put back the passages OCR read and the transcription lacks.
     *
     * As ordinary `text` corrections, so they are undoable at the proof step,
     * saved with the run, and indistinguishable from a fix typed by hand — the
     * same rule every other repair in this app follows. The recovered words are
     * OCR's, not the model's, so they are spliced in where they were taken from
     * and left for the user to read rather than trusted.
     */
    if (restoreRuns.size > 0 && state.document) {
      const blocks = applyEdits(state.document, nextEdits).blocks
      for (const [pageIndex, wanted] of restoreRuns) {
        const runs = state.droppedRuns[pageIndex] ?? []
        for (const [n, run] of runs.entries()) {
          // Only the gaps this user actually chose. The row ids the question
          // emitted are positional against this same list, which is why the
          // index is the key rather than the text — two identical missing
          // words on one leaf are two decisions, not one.
          if (!wanted.has(n)) continue
          // A leaf the user has just retyped is theirs. Splicing on top of it
          // would most likely duplicate the words they typed in, so the passage
          // is handed back instead of applied — and handed back visibly, since
          // they did ask for it.
          if (editedPages.has(pageIndex)) {
            attention.push({
              pageIndex,
              message:
                'You corrected this leaf yourself, so the missing passage was left ' +
                `for you rather than spliced in over your text: “${run.text}”`
            })
            continue
          }
          // The block the anchor is in, among those that came off this page.
          // Spliced through `spliceRunInto`, which moves the block's italics
          // along past the inserted words — restoring a clause used to discard
          // the emphasis of the paragraph it landed in, silently.
          const host = blocks.find(
            (b) =>
              b.sourcePages.includes(pageIndex) && spliceRunInto(b.text, b.emphasis, run, b.strong)
          )
          const fixed = host ? spliceRunInto(host.text, host.emphasis, run, host.strong) : null
          if (host && fixed) {
            nextEdits = withEdit(nextEdits, {
              kind: 'text',
              blockId: host.id,
              // Written back with the tags on, because that is how a `text`
              // edit carries emphasis — `applyEdits` reads them straight back.
              text: withMarkup(fixed.text, fixed.emphasis, fixed.strong)
            })
          } else {
            // Nowhere to put it: the anchor phrase is in no block off this leaf.
            // Reported rather than dropped — the same rule as a footnote with no
            // home, and for the same reason. Silence here means the user thinks
            // the passage was restored and finds out in print that it was not.
            attention.push({
              pageIndex,
              message: `Couldn’t place a recovered passage — add it by hand: “${run.text}”`
            })
          }
        }
      }
    }

    if (nextEdits !== edits) setEdits(nextEdits)

    let transcriptions = run.transcriptions
    let findings = run.findings

    if (redo.length > 0) {
      setError(null)
      const controller = new AbortController()
      abortRef.current = controller
      const prefs = loadPrefs()
      const wordsByPage = new Map<number, typeof recon.words>()
      for (const w of recon.words) {
        const list = wordsByPage.get(w.pageIndex) ?? []
        list.push(w)
        wordsByPage.set(w.pageIndex, list)
      }

      try {
        const identity = state.answers['gate-identity'] ?? {}
        const again = await runBrowserTranscription({
          fileData: data,
          ocrWordsByPage: wordsByPage,
          pageText: recon.pageText,
          client: {
            apiKey: loadApiKey(),
            modelId: prefs.modelId,
            effort: 'medium'
          },
          lexicon: vetLexicon(
            state.lexicon,
            (identity['terms'] as Record<string, TermDecision> | undefined) ?? {}
          ).entries,
          orthography: (identity['orthography'] as 'preserve' | 'modernize') ?? 'preserve',
          normalizeLongS: identity['longS'] === true,
          // From this book's own answer at the transcribe gate, not from a
          // device preference — which is where it used to live and where it
          // never belonged.
          bookContext: (state.answers['transcribe']?.['bookContext'] as string) ?? '',
          // A page flagged for another look is usually one that was hard to
          // read, so give the model more pixels than the first pass had.
          imageLongEdge: Math.min(2000, Math.round(prefs.imageLongEdge * 1.3)),
          onlyPages: redo,
          onProgress: setRunProgress,
          signal: controller.signal
        })

        const replaced = new Map(transcriptions.map((t) => [t.pageIndex, t]))
        for (const t of again.transcriptions) replaced.set(t.pageIndex, t)
        transcriptions = [...replaced.values()].sort((a, b) => a.pageIndex - b.pageIndex)
        // Findings for re-read pages are stale; take the new run's instead.
        findings = [...findings.filter((f) => !redo.includes(f.pageIndex)), ...again.findings]
        transcriptionRef.current = { ...run, transcriptions, findings }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setRunProgress(null)
        abortRef.current = null
      }
    }

    // Remembered for the structure gate, which assembles the book again once
    // the illustrations are cut and must make the same exclusions.
    excludedPagesRef.current = skip
    // And for the proof sheet, which must not send the user back over a page
    // they have just been through here.
    reviewedPagesRef.current = Object.entries(currentAnswers)
      .filter(([key, value]) => /^page-\d+$/.test(key) && value === 'accept')
      .map(([key]) => Number(key.slice(5)))
      // "Looks fine" removes a leaf from the proof sheet, so it has to mean
      // the user actually looked. It is also the pre-selected answer — the
      // "just hit continue" path this app is built around — and those two
      // facts together would quietly dismiss every flagged leaf in the book
      // the moment someone tapped through the gate.
      //
      // A leaf with disagreements on it is only reviewed once each of them has
      // a verdict. That is a fact the app can check rather than a claim it has
      // to take on trust, and it is exactly what the grid below the verdict
      // was added to collect.
      .filter((pageIndex) => {
        const gaps = state.droppedRuns[pageIndex] ?? []
        if (gaps.length === 0) return true
        const decided = currentAnswers[`page-${pageIndex}-gaps`]
        return (
          decided !== null &&
          typeof decided === 'object' &&
          !Array.isArray(decided) &&
          Object.keys(decided).length >= gaps.length
        )
      })
    // And the pages they want brought back, which is the opposite errand.
    attentionRef.current = attention

    complete({
      findings,
      document: assembleBook(transcriptions, { excludePages: skip })
    })
  }, [state, currentAnswers, complete])

  /**
   * Leaving the structure gate: cut out the pictures the user kept.
   *
   * This is where the pixels are finally taken, rather than during recon,
   * because only now is it known which regions are wanted — cropping every
   * candidate at full resolution would spend memory on guesses the user is
   * about to reject. The document is then reassembled with them, which also
   * pulls each caption out of the text flow and onto its picture.
   */
  const finishStructure = useCallback(async () => {
    const run = transcriptionRef.current
    const file = fileDataRef.current
    if (!run || !file) {
      complete()
      return
    }

    const kept = new Set((currentAnswers['illustrations'] as string[] | undefined) ?? [])
    const regions = state.illustrationCandidates
      .filter((c) => kept.has(c.id))
      .map((c) => ({ id: c.id, pageIndex: c.pageIndex, bbox: c.bbox, accepted: true as const }))

    // Nothing kept: skip the render entirely rather than opening the PDF to
    // crop nothing out of it.
    if (regions.length === 0) {
      cropBytesRef.current = new Map()
      complete()
      return
    }

    setError(null)
    try {
      const cropped = await cropIllustrations(file, regions, {
        onProgress: (done, total) => setBuildProgress({ done, total })
      })
      cropBytesRef.current = cropped.bytes
      if (cropped.failed.length > 0) {
        setError(
          `${cropped.failed.length} illustration(s) could not be cut out of the scan and ` +
            'will be left out of the book.'
        )
      }
      complete({
        document: assembleBook(run.transcriptions, {
          excludePages: excludedPagesRef.current,
          illustrations: cropped.sources
        })
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      // The book is still publishable without its pictures, so this does not
      // strand the user at the gate — it says what was lost and moves on.
      cropBytesRef.current = new Map()
      complete()
    } finally {
      setBuildProgress(null)
    }
  }, [state, currentAnswers, complete])

  /**
   * Leaving the proof step: keep the corrections with the run they correct.
   *
   * Saved here rather than on every keystroke — a write per character would
   * hammer IndexedDB for no benefit, and the corrections are only worth
   * anything once the user has finished with the page. A failed write is
   * reported rather than swallowed: the user has just spent real time, and
   * silently losing it on the next refresh is the worst available outcome.
   */
  const finishProof = useCallback(async () => {
    const run = transcriptionRef.current
    if (run && edits.length > 0) {
      await persistRun(run, state.answers['gate-identity'] ?? {}, loadPrefs().modelId, edits)
      // An evening of proofreading is the other thing in this app that cannot
      // be had again cheaply. It goes to the shelf as soon as it is saved here.
      void saveToShelf(`${edits.length} correction(s) from the proof step`)
    }
    complete()
  }, [edits, state.answers, persistRun, complete, saveToShelf])

  /**
   * The annotation pass, and the introduction if one was asked for.
   *
   * The second paid step, and much the cheaper of the two — no images, and the
   * voice card is cached across every chunk. Nothing it produces touches the
   * book here: it all lands in `proposals` for the review gate, which is what
   * makes it safe to run without the user having read a word of it yet.
   */
  /**
   * Notes an interrupted pass already bought, read back when the gate opens.
   *
   * The gate is the only place they are any use, and the record is a book's
   * worth of prose, so it is fetched on arrival rather than held from the
   * moment the file was opened. What the questions see is the *summary* — how
   * far it got, and whether carrying on is still honest — while the notes
   * themselves stay here until the review screen wants them.
   */
  useEffect(() => {
    const doc = state.document
    const key = fileKeyRef.current
    if (step.id !== 'annotate' || !doc || !key) return

    let live = true
    void (async () => {
      const stored = await loadAnnotationCheckpoint(key)
      if (!live) return
      setNotesCheckpoint(stored)
      const summary = stored
        ? summarizeCheckpoint(stored, {
            mode: stored.mode,
            bodyKey: bodyKeyFor(doc.blocks),
            chunksTotal: chunkBlocks(
              doc.blocks,
              stored.mode === 'facts' ? { requireProse: false } : {}
            ).length,
            penName: state.voice.penName,
            density: state.voice.density,
            depth: stored.depth
          })
        : null
      setState((st) =>
        summary === null && st.notesCheckpoint === null ? st : { ...st, notesCheckpoint: summary }
      )
    })()
    return () => {
      live = false
    }
  }, [step.id, state.document, state.voice.penName, state.voice.density])

  const startAnnotation = useCallback(async () => {
    const doc = state.document
    if (!doc) return
    setPendingNotesCost(null)

    const answers = state.answers['annotate'] ?? currentAnswers
    // What an interrupted pass already bought, and what the user said to do
    // with it. `take` reads nothing more: the notes on disk go straight to the
    // review, and only the introduction — its own request — is still bought.
    const kept = notesCheckpoint
    const useKept = kept ? String(answers['useNotes'] ?? 'take') : 'again'
    const wantsNotes = useKept === 'take' ? false : (answers['annotateBook'] ?? 'yes') === 'yes'
    const introLength = String(answers['writeIntroduction'] ?? 'standard')
    const wantsIntro = introLength !== 'none'

    // The voice is the editor's, not the book's, so what was asked here is
    // banked before the run rather than after it — a run that fails still
    // leaves the pen name entered.
    const voice: EditorVoice = {
      ...state.voice,
      penName: String(answers['penName'] ?? state.voice.penName),
      density: (String(answers['noteDensity'] ?? state.voice.density) as NoteDensity) || 'balanced'
    }
    saveVoice(voice)
    setState((st) => ({ ...st, voice }))

    const harvestDepth = String(answers['harvestFacts'] ?? 'standard')
    const wantsHarvest = useKept === 'take' ? false : harvestDepth !== 'none'
    const interest = String(answers['harvestInterest'] ?? state.harvestInterest)
    const bank = loadBank()

    const identity = state.answers['gate-identity'] ?? {}
    const facts = {
      ...(state.metadata.title ? { title: state.metadata.title } : {}),
      ...(state.metadata.author ? { author: state.metadata.author } : {}),
      ...(state.metadata.originalYear ? { originalYear: state.metadata.originalYear } : {}),
      ...(identity['bookContext'] ? { context: String(identity['bookContext']) } : {})
    }
    // The notes get their own model, chosen at this gate. Writing a note is
    // judgement rather than perception, so the answer that was right for the
    // scan is not automatically right here — and with no page images in this
    // pass the better model is a fraction of what it costs upstairs.
    const notesModelId = String(answers['notesModel'] ?? loadPrefs().modelId)
    const client = { apiKey: loadApiKey(), modelId: notesModelId }

    const harvestOptions = {
      depth: harvestDepth as HarvestDepth,
      vocabulary: bank.vocabulary,
      sourceKey: fileKeyRef.current ?? state.fileName ?? 'book',
      ...(interest.trim() ? { interest: interest.trim() } : {})
    }

    // What the pass is about to do, and what an interrupted one may be
    // measured against. The two doors chunk a book differently, so each asks
    // for its own count rather than assuming the other's.
    const runKey = fileKeyRef.current
    const bodyKey = bodyKeyFor(doc.blocks)
    const wantedFor = (mode: AnnotationPassMode): AnnotationWanted => ({
      mode,
      bodyKey,
      chunksTotal: chunkBlocks(doc.blocks, mode === 'facts' ? { requireProse: false } : {}).length,
      penName: voice.penName,
      density: voice.density,
      depth: harvestDepth
    })

    // The stretches an earlier sitting actually read, which this one must not
    // pay for again — and which pointedly excludes the ones that failed.
    // `chunksAlreadyRead` is the single place that decides, so the gate's offer
    // and what the run does cannot drift apart.
    const resumeMode: AnnotationPassMode = wantsNotes ? 'notes' : 'facts'
    const alreadyRead =
      kept && useKept === 'resume'
        ? chunksAlreadyRead(kept, wantedFor(resumeMode))
        : new Set<number>()
    const carried = useKept === 'again' || !kept ? null : kept
    // A carried failure is about a stretch this run is about to read again, so
    // reporting it would describe a hole that is being filled as we speak.
    const carriedFailures = useKept === 'resume' ? [] : (carried?.failures ?? [])

    // Said once, not once per chunk: a storage failure repeated every few
    // seconds would bury the run's own progress under its own complaint.
    let warnedAboutStorage = false
    const writeCheckpoint = async (
      mode: AnnotationPassMode,
      chunksDone: number,
      part: {
        proposals: readonly AnnotationProposal[]
        facts: readonly Fact[]
        failures: readonly ChunkFailure[]
        discarded: number
        usage: ApiUsage
      }
    ): Promise<void> => {
      if (!runKey) return
      const ok = await saveAnnotationCheckpoint(
        createAnnotationCheckpoint({
          key: runKey,
          wanted: wantedFor(mode),
          // How far down the book this run has got. The stretches it skipped
          // are behind it, so the count is the position either way.
          chunksDone,
          // Everything bought for this book, not merely this sitting.
          proposals: [...(carried?.proposals ?? []), ...part.proposals],
          facts: [...(carried?.facts ?? []), ...part.facts],
          failures: [...carriedFailures, ...part.failures],
          discarded: (carried?.discarded ?? 0) + part.discarded,
          usage: part.usage
        })
      )
      if (!ok && !warnedAboutStorage) {
        warnedAboutStorage = true
        setNotesNote(
          'The notes bought so far could not be saved to this browser, so closing the tab ' +
            'would lose them. The pass is still running.'
        )
      }
    }

    cancelNotesRef.current = false
    setNotesNote(null)
    setNotesProgress({
      done: alreadyRead.size,
      total: Math.max(1, wantedFor(resumeMode).chunksTotal)
    })
    try {
      // When both are wanted, the harvest rides the annotation reply: the book
      // is read once and the entries cost output tokens only.
      const notes = wantsNotes
        ? await runAnnotation(doc.blocks, {
            client,
            voice,
            facts,
            ...(wantsHarvest ? { harvest: harvestOptions } : {}),
            alreadyRead,
            isCancelled: () => cancelNotesRef.current,
            onProgress: (done, total) => setNotesProgress({ done, total }),
            onCheckpoint: ({ chunksDone, result }) => writeCheckpoint('notes', chunksDone, result)
          })
        : { proposals: [], facts: [], failures: [], discarded: 0, cancelled: false, haltedBy: null }

      // A book worth mining and not worth annotating pays for its own reading.
      const harvested =
        wantsHarvest && !wantsNotes
          ? await runHarvest(doc.blocks, {
              client,
              facts,
              ...harvestOptions,
              alreadyRead,
              isCancelled: () => cancelNotesRef.current,
              onProgress: (done, total) => setNotesProgress({ done, total }),
              onCheckpoint: ({ chunksDone, result }) =>
                writeCheckpoint('facts', chunksDone, { ...result, proposals: [] })
            })
          : { facts: notes.facts, failures: [], discarded: 0, cancelled: false, haltedBy: null }

      // Everything bought for this book, whichever sitting bought it. The kept
      // notes are located against the book *as it stands now* rather than
      // restored with the offsets they were written at: a paragraph corrected
      // since would otherwise put a note's mark in the middle of a word, and a
      // quote that can no longer be found belongs in the unplaced list where
      // the review screen already shows it.
      const blockText = new Map(doc.blocks.map((b) => [b.id, b.text]))
      const bookText = doc.blocks.map((b) => b.text).join('\n')
      const allNotes = [
        ...checkProposals(carried?.proposals ?? [], blockText, bookText),
        ...notes.proposals
      ]
      const allFailures = [...carriedFailures, ...notes.failures, ...harvested.failures]
      const allFacts = [...(carried?.facts ?? []), ...harvested.facts]

      setBankFacts(allFacts)
      // Recorded as soon as it exists rather than at the review, because the
      // harvest is not reviewed: the entries are files the user keeps, and the
      // vocabulary has to grow even if they walk away from this screen.
      if (allFacts.length > 0) recordHarvest(allFacts, interest)
      if (interest !== state.harvestInterest) {
        setState((st) => ({ ...st, harvestInterest: interest }))
      }

      const stopped = notes.cancelled || harvested.cancelled
      const halted = notes.haltedBy ?? harvested.haltedBy

      let introduction: IntroductionDraft | null = null
      let introError: string | null = null
      // In its own try, and this is the whole of why. A book was annotated to
      // the last stretch, the account ran out of credit, the introduction
      // request threw — and the catch around the whole pass replaced every note
      // that had come back with a single line about a credit balance. The user
      // was shown "0 of 0 notes going in" for work they had paid for. A failure
      // to write the introduction is a failure to write the introduction.
      //
      // Not attempted at all after a stop: stopping is a request to stop
      // spending, and this is a fresh request rather than the tail of the one
      // that was interrupted.
      if (wantsIntro && !stopped && !halted) {
        setNotesProgress({ done: 1, total: 1 })
        try {
          const drafted = await draftIntroduction(doc, {
            client,
            voice,
            facts,
            length: introLength as IntroductionLength,
            ...(answers['introBrief'] ? { brief: String(answers['introBrief']) } : {})
          })
          introduction = drafted.draft
        } catch (err) {
          introError = err instanceof Error ? err.message : String(err)
        }
      }

      const keptSaid = `The ${allNotes.length} note(s) already written are kept${
        allNotes.length > 0 ? ' and are below' : ''
      }`
      if (stopped) {
        setNotesNote(
          `Stopped. ${keptSaid}; the rest of the book was not read, and nothing further ` +
            'was charged.'
        )
      } else if (halted) {
        // The account, not the book. Said as such, because "12 stretches could
        // not be read" describes a damaged book and sends the user looking at
        // the wrong thing.
        setNotesNote(
          `The pass stopped early: the same error came back several stretches running ` +
            `(${halted}). That is the account rather than the book, so nothing more was ` +
            `attempted. ${keptSaid}, and coming back to this step offers to carry on with ` +
            'only the stretches that were never read.'
        )
      } else if (introError) {
        setNotesNote(
          `The introduction could not be written (${introError}). The notes are unaffected.`
        )
      }

      // A review screen with nothing on it is a dead end the user has to click
      // past. When the pass produced only bank entries — which is the whole of
      // what a harvest-only run produces — there is nothing to approve, so the
      // step is finished here and the files wait at the export screen.
      const worthReviewing = allNotes.length > 0 || introduction !== null
      if (worthReviewing) {
        setProposals({ notes: allNotes, failures: allFailures, introduction })
      } else if (!stopped && !halted) {
        complete()
      }
      // A cancel with nothing to show for it deliberately does *not* move the
      // flow on. The user stopped the pass; carrying them past the gate would
      // answer a question they had just declined to answer, and the way back
      // is not obvious once the step is behind them.
    } catch (err) {
      // Only genuinely unexpected failures reach here now: both runners record a
      // bad chunk and carry on, and the introduction has its own catch. So this
      // means the pass could not run at all, and it says that rather than
      // reporting a book with one bad stretch in it.
      setNotesNote(
        `The pass could not run (${err instanceof Error ? err.message : String(err)}). ` +
          'Nothing was changed, and anything an earlier sitting bought is still here.'
      )
    } finally {
      setNotesProgress(null)
    }
  }, [state, currentAnswers, complete, notesCheckpoint])

  /**
   * Leaving the review: the approved notes become ordinary corrections.
   *
   * From here they are indistinguishable from a note typed by hand — undoable,
   * editable, saved with the run — which is the whole reason the generator
   * writes into the existing edit list rather than into a store of its own.
   */
  const finishAnnotation = useCallback(
    (result: {
      accepted: AcceptedProposal[]
      introduction: { title: string; text: string } | null
    }) => {
      const { edits: noteEdits } = proposalsToEdits(result.accepted)
      const next: BookEdit[] = [...edits, ...noteEdits]

      if (result.introduction) {
        next.push({
          kind: 'section',
          sectionId: `intro-${Date.now().toString(36)}`,
          placement: 'front',
          title: result.introduction.title,
          text: result.introduction.text
        })
      }

      // What the user approved is what the voice learns from — in the form they
      // approved it in, so a rewritten note teaches the rewrite.
      const learned = learnVoice(state.voice, result.accepted)
      saveVoice(learned)
      setState((st) => ({ ...st, voice: learned }))

      // Approved notes are the best entries in the bank and cost nothing: each
      // has already been read by a person and judged against its passage.
      const doc = state.document
      if (doc && bankFacts.length > 0) {
        const fromNotes = factsFromNotes(
          result.accepted.map(({ proposal, text }) => ({
            blockId: proposal.blockId,
            anchorText: proposal.anchorText,
            kind: proposal.kind,
            text
          })),
          doc.blocks,
          fileKeyRef.current ?? state.fileName ?? 'book'
        )
        const all = [...bankFacts, ...fromNotes]
        setBankFacts(all)
        recordHarvest(fromNotes, state.harvestInterest)
      }

      setEdits(next)
      setProposals(null)
      setNotesNote(null)

      const run = transcriptionRef.current
      if (run) {
        void persistRun(run, state.answers['gate-identity'] ?? {}, loadPrefs().modelId, next).then(
          () => saveToShelf('the notes and introduction you kept')
        )
      }

      // Every note the checkpoint held has now been accepted — in which case it
      // is an edit, saved with the run — or turned down, so the notes come out
      // of the record; keeping them would offer the rejected ones back on the
      // next visit as though unseen.
      //
      // The record itself only goes when the pass actually finished the book.
      // A pass that stopped partway — an account out of credit is the usual
      // reason — leaves stretches nobody has read, and *which* stretches is
      // known only here. Deleting it would mean topping the balance up and then
      // paying to read the whole book again.
      const key = fileKeyRef.current
      const partial = notesCheckpoint && !checkpointComplete(notesCheckpoint)
      if (key && partial && notesCheckpoint) {
        const emptied = { ...notesCheckpoint, proposals: [], facts: [] }
        void saveAnnotationCheckpoint(emptied)
        setNotesCheckpoint(emptied)
        setState((st) => ({
          ...st,
          notesCheckpoint: st.notesCheckpoint ? { ...st.notesCheckpoint, notes: 0, facts: 0 } : null
        }))
      } else {
        if (key) void deleteAnnotationCheckpoint(key)
        setNotesCheckpoint(null)
        setState((st) => ({ ...st, notesCheckpoint: null }))
      }

      complete()
    },
    [
      edits,
      state.voice,
      state.document,
      state.fileName,
      state.harvestInterest,
      state.answers,
      bankFacts,
      notesCheckpoint,
      persistRun,
      saveToShelf,
      complete
    ]
  )

  /**
   * Leaving the design gate: bank the look if the user named one.
   *
   * The imprint fields are still empty at this point — they are asked one gate
   * later, where the copyright page is being filled in. So the profile is
   * written now with the style alone and topped up with the publisher's details
   * when the export runs. That ordering is deliberate: the look is decided here,
   * beside the preview that justifies it, and asking for a name at the export
   * gate instead would put the question two screens from the thing it names.
   */
  const finishDesign = useCallback(async () => {
    const name = String(currentAnswers['saveAs'] ?? '').trim()
    const reused = appliedLook(state, currentAnswers).fromProfileId
    const existing = reused ? (state.styleProfiles.find((p) => p.id === reused) ?? null) : null

    if (name && !existing) {
      const profile = newSavedProfile({ name, style: appliedLook(state, currentAnswers).style })
      const ok = await saveProfile(profile)
      if (ok) {
        bankedProfileRef.current = profile
        setState((s) => ({ ...s, styleProfiles: [profile, ...s.styleProfiles] }))
      } else {
        // Storage refused the write. Say so rather than letting the user find
        // out on book two that the look they named was never there.
        setError('That look could not be saved — your browser refused the write.')
      }
    } else {
      bankedProfileRef.current = existing
    }
    complete()
  }, [state, currentAnswers, complete])

  /** Leaving a step: transcription needs cost approval first; gates just advance. */
  const advance = useCallback(() => {
    if (step.id === 'design') {
      void finishDesign()
      return
    }
    if (step.id === 'export') {
      void runExport()
      return
    }
    if (step.id === 'gate-uncertainties') {
      void finishUncertainties()
      return
    }
    if (step.id === 'gate-structure') {
      void finishStructure()
      return
    }
    if (step.id === 'proof') {
      void finishProof()
      return
    }
    if (step.id === 'annotate') {
      const doc = state.document
      const wantsNotes = (currentAnswers['annotateBook'] ?? 'yes') === 'yes'
      const wantsIntro = String(currentAnswers['writeIntroduction'] ?? 'standard') !== 'none'
      const depth = String(currentAnswers['harvestFacts'] ?? 'standard')
      const wantsHarvest = depth !== 'none'
      // Declining all three is free and instant; there is nothing to quote for.
      if (!doc || (!wantsNotes && !wantsIntro && !wantsHarvest)) {
        complete()
        return
      }
      const words = doc.blocks.reduce((n, b) => n + b.text.split(/\s+/u).length, 0)
      const notesCost = estimateAnnotationCost({
        wordCount: wantsNotes ? words : 0,
        // The model this gate chose, so the quote is for what will actually run.
        modelId: String(currentAnswers['notesModel'] ?? loadPrefs().modelId),
        density: String(currentAnswers['noteDensity'] ?? state.voice.density) as NoteDensity
      })
      // Riding the notes costs output tokens only; harvesting a book nobody is
      // annotating pays to read it. Quoting one number for both would be a lie
      // in whichever direction the user happened to choose.
      const harvestCost = wantsHarvest
        ? estimateHarvestCost({
            wordCount: words,
            modelId: String(currentAnswers['notesModel'] ?? loadPrefs().modelId),
            depth: depth as HarvestDepth,
            standalone: !wantsNotes
          })
        : { usd: 0, usdLow: 0, usdHigh: 0, inputTokens: 0, outputTokens: 0 }
      const total = {
        ...notesCost,
        usd: notesCost.usd + harvestCost.usd,
        usdLow: notesCost.usdLow + harvestCost.usdLow,
        usdHigh: notesCost.usdHigh + harvestCost.usdHigh
      }
      setPendingNotesCost(formatEstimate(total))
      return
    }
    if (step.id === 'transcribe') {
      // Remembered on the device, so the question is asked once rather than
      // per book. Recorded before any branch below returns.
      if (state.keepScans === null && currentAnswers['keepScans'] !== undefined) {
        const keep = currentAnswers['keepScans'] === 'keep'
        savePrefs({ ...loadPrefs(), keepScans: keep })
        setState((s) => ({ ...s, keepScans: keep }))
      }

      // Pages already out with the API come first, because collecting them
      // costs nothing and every other branch here spends money.
      if (state.savedBatch) {
        // Read off the summary, which is the same field the question decided
        // its own default from — two readings of "expired" that could disagree
        // would offer a collect button that does nothing.
        const expired = new Date(state.savedBatch.expiresAt).getTime() < Date.now()
        const action =
          (currentAnswers['batchAction'] as string) ?? (expired ? 'abandon' : 'collect')
        if (action === 'collect') {
          void collectBatch()
          return
        }
        void abandonBatch()
        // Falls through to the ordinary cost approval below: giving up on a
        // batch means reading the book again, which is a thing to be quoted.
      }

      const saved = state.savedRun
      // A *finished* run the user said to use: nothing to approve.
      if (saved?.complete && (currentAnswers['useSavedRun'] ?? 'use') === 'use') {
        void useSavedRun()
        return
      }
      // Carrying on a half-read book only pays for the pages that are left.
      // Quoting the whole book here would ask the user to approve a number
      // they are not going to be charged.
      const resuming =
        saved !== null &&
        !saved.complete &&
        (currentAnswers['useSavedRun'] ?? 'resume') === 'resume'
      const estimate = estimateCost({
        pageCount: resuming ? Math.max(1, state.pageCount - saved.pageCount) : state.pageCount,
        modelId: (currentAnswers['model'] as string) ?? 'claude-opus-5',
        imageLongEdge: loadPrefs().imageLongEdge,
        batch: currentAnswers['runMode'] === 'batch'
      })
      setPendingCost(formatEstimate(estimate))
      return
    }
    complete()
  }, [
    step.id,
    state.pageCount,
    state.savedRun,
    state.savedBatch,
    currentAnswers,
    complete,
    runExport,
    finishUncertainties,
    finishStructure,
    finishProof,
    finishDesign,
    useSavedRun,
    collectBatch,
    abandonBatch
  ])

  /**
   * What is running, named — and what is waiting to be paid for.
   *
   * A controller that cannot see this reads a gate mid-OCR as an empty one and
   * starts answering the last book's questions. The quotes matter more: a
   * screen showing a price is the app waiting for a *person*, and the useful
   * thing a controller can do with it is say the number out loud so that
   * person can decide. It must never be able to press the button itself, which
   * is why the price appears here, as a state to report, and nowhere as a
   * command.
   */
  const busy =
    progressInfo !== null
      ? 'Reading the scan'
      : runProgress !== null
        ? 'Reading the pages'
        : submitProgress !== null
          ? 'Submitting the batch'
          : collectProgress !== null
            ? 'Collecting the batch'
            : checkProgress !== null
              ? 'Reading the flagged spots again'
              : notesProgress !== null
                ? 'Writing the notes'
                : buildProgress !== null
                  ? 'Building the interior'
                  : pendingCost !== null
                    ? `Waiting for a person to approve ${pendingCost}`
                    : pendingCheckCost !== null
                      ? `Waiting for a person to approve ${pendingCheckCost}`
                      : pendingNotesCost !== null
                        ? `Waiting for a person to approve ${pendingNotesCost}`
                        : undefined

  /**
   * The one place a command is executed, whichever transport carried it.
   *
   * Given the gate's own questions, the same `setAnswers` the renderer calls
   * and the same `advance` the button calls — so a controller drives the app
   * rather than a copy of it.
   */
  const agent = useAgentSurface({
    step: step.id,
    title: step.title,
    fileName: state.fileName,
    pageCount: state.pageCount,
    progress: progress(state),
    questions,
    answers: currentAnswers,
    missing,
    ...(busy ? { busy } : {}),
    error,
    setAnswer: (id, value) => setAnswers((a) => ({ ...a, [id]: value })),
    advance,
    resolveEvidence,
    enlargeEvidence,
    cropWords
  })

  /**
   * Whether a controller is being let in, and on what.
   *
   * Read once at start-up and again whenever it is turned off here, rather
   * than watched: this changes when a person changes it, in Settings or with
   * the stop button, and polling `localStorage` on every render to notice
   * would be a lot of work to learn nothing.
   */
  const [control, setControl] = useState<ControlSettings>(() => loadControl())
  const controlConf = useMemo((): ControlConfig | null => {
    if (!control.enabled) return null
    const merged = controlConfig(control, loadShelf())
    // A session with no repository or no token is not a session that is off —
    // it is one that would throw on every poll. Treated as off, and Settings
    // is where it is explained.
    if (!merged.repo || !merged.token || !validSession(merged.session)) return null
    return merged
  }, [control])

  /**
   * Which door the approved cost goes through.
   *
   * Read at the moment the user presses the button rather than captured when
   * the estimate was made, so changing the answer and coming back cannot leave
   * a "half price" quote wired to the full-price path.
   */
  const goingViaBatch = currentAnswers['runMode'] === 'batch'

  return (
    <div className="shell">
      <nav className="rail">
        <h1>
          Book Reprint Tool
          <small>{state.fileName ?? 'no book open'}</small>
        </h1>
        <ol>
          {STEPS.map((s) => {
            const done = state.completed.includes(s.id as StepId)
            const active = s.id === step.id
            return (
              <li
                key={s.id}
                className={[done ? 'done' : '', active ? 'active' : '', s.isGate ? 'gate' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="dot">{done ? '✓' : ''}</span>
                <span className="label">{s.title}</span>
              </li>
            )
          })}
        </ol>
        <a className="rail-settings" href="#settings">
          Settings
        </a>
      </nav>

      <main className="main">
        {controlConf ? (
          <AgentBridge
            config={controlConf}
            surface={agent}
            onStop={() => {
              saveControl({ ...loadControl(), enabled: false })
              setControl(loadControl())
            }}
          />
        ) : null}
        <div className="step-head">
          <h2>{step.title}</h2>
          <p>{step.blurb}</p>
        </div>

        {error ? <p className="err">{error}</p> : null}

        {/* --- intake --- */}
        {step.id === 'intake' && !progressInfo ? (
          <>
            <div
              className={`drop ${dragOver ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInput.current?.click()}
            >
              <strong>Drop a scanned PDF or an EPUB here</strong>
              <span>
                or click to choose a file — the whole book, one file. An EPUB is already text, so it
                skips the reading entirely and costs nothing.
              </span>
            </div>

            {shelfNote ? <div className="resume-note">{shelfNote}</div> : null}

            {shelfBooks.length > 0 ? (
              <div className="q">
                <span className="prompt">Books on your shelf</span>
                <div className="help">
                  Kept in your own repository — the transcription, every correction, the notes and
                  the introduction, the pictures and the fact bank. Opening one brings the whole
                  thing to this device, scan and all when the shelf has it.
                </div>
                <ul className="notes">
                  {shelfBooks.map((book) => (
                    <li key={book.key}>
                      <strong>{book.fileName}</strong> — {book.pageCount} page
                      {book.pageCount === 1 ? '' : 's'}
                      {book.complete ? '' : ' read so far, stopped partway'}
                      {book.corrections > 0 ? `, ${book.corrections} correction(s)` : ''}
                      {book.notes > 0 ? `, ${book.notes} note(s)` : ''}
                      {book.facts > 0 ? `, ${book.facts} bank entr(ies)` : ''} ·{' '}
                      {describeAge(book.savedAt)}
                      <div className="actions">
                        <button
                          type="button"
                          className="primary"
                          disabled={shelfBusy}
                          onClick={() => void openFromShelf(book)}
                        >
                          {book.scanPath ? 'Open this book' : 'Bring the work to this device'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {savedRuns.length > 0 ? (
              <div className="q">
                <span className="prompt">Books you have already paid to have read</span>
                <div className="help">
                  These transcriptions are saved in this browser. Open the same PDF again and the
                  reading picks up where it left off — you are not charged twice.
                </div>
                <ul className="notes">
                  {savedRuns.map((run) => (
                    <li key={run.key}>
                      <strong>{run.fileName}</strong> — {run.pageCount} page
                      {run.pageCount === 1 ? '' : 's'}
                      {run.complete ? '' : ' read so far, stopped partway'}
                      {run.failedPages > 0 ? `, ${run.failedPages} failed` : ''} ·{' '}
                      {describeAge(run.savedAt)}
                      {reopenable.includes(run.key) ? (
                        <div className="actions">
                          <button
                            type="button"
                            className="primary"
                            onClick={() => void reopenSaved(run.key, run.fileName)}
                          >
                            Open this book again
                          </button>
                        </div>
                      ) : (
                        <div className="help">
                          The scan itself is not stored for this one — choose the same PDF above and
                          it will find the transcription.
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}

        {/* Outside the intake branch: a stage that failed offers a retry, and
            the picker has to exist for that button to open. */}
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,application/epub+zip,.epub"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) openBook(f)
          }}
        />

        {/* Fetching a stored reading. Its own stage rather than a fake progress
            bar: there are no pages going by to count. */}
        {reusing && !progressInfo ? (
          <div className="progress">
            <strong>Opening the reading of this scan…</strong>
            <div className="meta">it was read on this device before</div>
          </div>
        ) : null}

        {/* Why the wait was short, said where it can still be read. Inside the
            running stage it is gone in a second on a book that did not have to
            be read again — which is the case the note exists to explain. */}
        {resumeNote && !progressInfo && !reusing && !state.completed.includes('transcribe') ? (
          <div className="resume-note">{resumeNote}</div>
        ) : null}

        {/* --- running stage --- */}
        {progressInfo ? (
          <div className="progress">
            {resumeNote ? <div className="help">{resumeNote}</div> : null}
            <strong>
              {progressInfo.phase === 'harvesting'
                ? 'Harvesting this book’s vocabulary…'
                : `Page ${progressInfo.page} of ${progressInfo.total}`}
            </strong>
            <div className="bar">
              <i
                style={{ width: `${(progressInfo.page / Math.max(1, progressInfo.total)) * 100}%` }}
              />
            </div>
            <div className="meta">
              {progressInfo.phase === 'rendering' ? 'rendering page' : null}
              {progressInfo.phase === 'ocr' ? 'reading text' : null}
              {progressInfo.phase === 'harvesting' ? 'building the term list' : null}
              {progressInfo.meanConfidence
                ? ` · ${Math.round(progressInfo.meanConfidence)}% confidence`
                : null}
              {embedded ? ' · using the text the file already has' : null}
              {awake ? ' · keeping the screen on' : null}
            </div>
          </div>
        ) : null}

        {/* --- cost approval before any spend --- */}
        {pendingCost ? (
          <div className="q">
            <span className="prompt">
              Ready to {goingViaBatch ? 'submit' : 'transcribe'} {state.pageCount} pages
            </span>
            <div className="help">
              This is the only step that costs money. Estimated cost: <b>{pendingCost}</b>. You are
              billed directly by Anthropic for your own API key.
              {goingViaBatch ? (
                <>
                  {' '}
                  Half price because it goes through the batch API. This tab has to stay open while
                  the pages upload — after that you can close it, and come back to collect the
                  reading.
                </>
              ) : null}
            </div>
            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={() => void (goingViaBatch ? submitBatch() : startTranscription())}
              >
                {goingViaBatch ? 'Submit' : 'Start'} — {pendingCost}
              </button>
              <button type="button" className="ghost" onClick={() => setPendingCost(null)}>
                Back
              </button>
            </div>
          </div>
        ) : null}

        {/* --- the annotation pass, the app's second and cheaper paid step --- */}
        {pendingNotesCost ? (
          <div className="q">
            <span className="prompt">Ready to write the notes</span>
            <div className="help">
              Estimated cost: <b>{pendingNotesCost}</b> — much less than the transcription, because
              nothing here sends an image. Every note comes back as a suggestion with the passage
              beside it; nothing goes into the book until you say so.
            </div>
            <div className="actions">
              <button type="button" className="primary" onClick={() => void startAnnotation()}>
                Start — {pendingNotesCost}
              </button>
              <button type="button" className="ghost" onClick={() => setPendingNotesCost(null)}>
                Back
              </button>
            </div>
          </div>
        ) : null}

        {notesProgress ? (
          <div className="progress">
            <strong>
              Reading the book for notes — {notesProgress.done} of {notesProgress.total}
            </strong>
            <div className="bar">
              <i
                style={{
                  width: `${(notesProgress.done / Math.max(1, notesProgress.total)) * 100}%`
                }}
              />
            </div>
            <div className="meta">
              writing in your editor’s voice · saved after every stretch, so closing this tab costs
              at most the one in flight
            </div>
            {/* The same offer the transcription makes, and it means the same
                thing: what has already come back is bought and kept. Without
                it the only way out of a pass that is going badly — or costing
                more than expected — is to close the tab. */}
            <div className="actions">
              <button
                type="button"
                className="ghost"
                disabled={cancelNotesRef.current}
                onClick={() => {
                  cancelNotesRef.current = true
                  setNotesNote('Stopping after the stretch being read now…')
                }}
              >
                Stop — keep the notes so far
              </button>
            </div>
          </div>
        ) : null}

        {notesNote ? <div className="resume-note">{notesNote}</div> : null}

        {proposals && !notesProgress ? (
          <NoteReview
            document={state.document!}
            proposals={proposals.notes}
            introduction={proposals.introduction}
            failures={proposals.failures}
            onDone={finishAnnotation}
          />
        ) : null}

        {/* --- paid run in progress --- */}
        {runProgress ? (
          <div className="progress">
            <strong>
              Transcribing page {runProgress.page} of {runProgress.total}
            </strong>
            <div className="bar">
              <i
                style={{ width: `${(runProgress.page / Math.max(1, runProgress.total)) * 100}%` }}
              />
            </div>
            <div className="meta">
              {runProgress.usage.outputTokens.toLocaleString()} tokens written
              {runProgress.failed > 0 ? ` · ${runProgress.failed} page(s) failed` : null}
            </div>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => abortRef.current?.abort()}>
                Stop — keep what's done
              </button>
            </div>
          </div>
        ) : null}

        {/* --- uploading the book to the batch API --- */}
        {submitProgress ? (
          <div className="progress">
            <strong>
              Uploading page {submitProgress.page} of {submitProgress.total}
            </strong>
            <div className="bar">
              <i
                style={{
                  width: `${(submitProgress.page / Math.max(1, submitProgress.total)) * 100}%`
                }}
              />
            </div>
            <div className="meta">
              {submitProgress.batches} batch(es) submitted · keep this tab open until the upload
              finishes
            </div>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => abortRef.current?.abort()}>
                Stop — keep what's submitted
              </button>
            </div>
          </div>
        ) : null}

        {/* --- the second reading over the flagged spots --- */}
        {checkProgress ? (
          <div className="progress">
            <strong>
              Checking flagged leaf {checkProgress.leaf} of {checkProgress.total}
            </strong>
            <div className="bar">
              <i
                style={{
                  width: `${(checkProgress.leaf / Math.max(1, checkProgress.total)) * 100}%`
                }}
              />
            </div>
            <div className="meta">
              {checkProgress.settled} spot(s) settled · only the flagged leaves are read again
            </div>
          </div>
        ) : null}

        {/* --- what the second reading took off the list ---------------------
             Stated rather than asked, and above the pager rather than inside
             it: taking leaves out of a review is the app deciding something on
             the user's behalf, which it may do only out loud — and a notice
             that lives on one screen out of forty is paged past before the
             leaves it explains. */}
        {step.id === 'gate-uncertainties' && settledCount > 0 ? (
          <div className="resume-note">
            <b>{settledCount} leaf(s) were settled by the second reading.</b> On each of them every
            disagreement came back as something OCR imagined rather than words the page has, so the
            transcription was right as it stood and there is nothing to decide. They are out of the
            list below. Anything it judged missing, different, or could not settle is still here for
            you.
          </div>
        ) : null}

        {/* --- the second reading, offered wherever the flags are --- */}
        {step.id === 'gate-uncertainties' &&
        !checkProgress &&
        !pendingCheckCost &&
        unchecked.spots > 0 &&
        state.textSource === 'ocr' ? (
          <div className="q">
            <span className="prompt">Have the model look at these first?</span>
            <div className="help">
              {unchecked.spots} spot(s) across {unchecked.leaves} leaf(s) are waiting for a verdict.
              The model reads each one against the scan and says what the page actually shows — with
              the words it read, so you can check it against the picture rather than take its word.
              It never changes anything on its own.
            </div>
            {/* Deliberately not an `.actions` row. In this app that class means
                "the buttons that advance the step", and there is exactly one
                such row on a screen — the gate's own continue. This is an
                aside beside it, and putting it in an `.actions` row made it
                the first primary button on the page, which is a real
                ambiguity for anyone reading the screen and not only for the
                harness that clicked the wrong one. */}
            <div className="offer-actions">
              <button
                type="button"
                className="primary"
                onClick={() =>
                  setPendingCheckCost(
                    formatEstimate(
                      estimateAdjudicationCost({
                        leafCount: unchecked.leaves,
                        modelId: loadPrefs().modelId,
                        imageLongEdge: loadPrefs().imageLongEdge
                      })
                    )
                  )
                }
              >
                Look at them — show me the cost
              </button>
            </div>
          </div>
        ) : null}

        {pendingCheckCost ? (
          <div className="q">
            <span className="prompt">
              Reading {unchecked.spots} spot(s) on {unchecked.leaves} leaf(s)
            </span>
            <div className="help">
              Estimated cost: <b>{pendingCheckCost}</b>. Only the flagged leaves are sent — a leaf
              the checks were happy with costs nothing. Far less than reading the book again,
              because the transcription you already paid for is kept exactly as it is.
            </div>
            <div className="actions">
              <button type="button" className="primary" onClick={() => void runSecondReading()}>
                Start — {pendingCheckCost}
              </button>
              <button type="button" className="ghost" onClick={() => setPendingCheckCost(null)}>
                Back
              </button>
            </div>
          </div>
        ) : null}

        {/* --- fetching a finished batch --- */}
        {collectProgress ? (
          <div className="progress">
            <strong>
              Checking batch {collectProgress.checked} of {collectProgress.total}
            </strong>
            <div className="bar">
              <i
                style={{
                  width: `${(collectProgress.checked / Math.max(1, collectProgress.total)) * 100}%`
                }}
              />
            </div>
            <div className="meta">{collectProgress.collected} collected so far</div>
          </div>
        ) : null}

        {/* --- still out being read --- */}
        {batchWaiting && !collectProgress ? (
          <div className="q">
            <span className="prompt">Still being read</span>
            <div className="help">{batchWaiting}</div>
            <div className="actions">
              <button type="button" className="primary" onClick={() => void collectBatch()}>
                Check again
              </button>
              <button type="button" className="ghost" onClick={() => setBatchWaiting(null)}>
                Back
              </button>
            </div>
          </div>
        ) : null}

        {/* --- writing the interior --- */}
        {buildProgress ? (
          <div className="progress">
            <strong>
              Setting page {buildProgress.done} of {buildProgress.total}
            </strong>
            <div className="bar">
              <i
                style={{
                  width: `${(buildProgress.done / Math.max(1, buildProgress.total)) * 100}%`
                }}
              />
            </div>
          </div>
        ) : null}

        {/* --- the finished edition --- */}
        {exported && !buildProgress ? (
          <>
            <ExportResult
              result={exported}
              pdf={pdf}
              note={buildNote}
              savedNote={bankedNote}
              bank={bankMemo}
            />
            {shelfNote ? <div className="resume-note">{shelfNote}</div> : null}
            <div className="actions">
              {shelfReady(loadShelf()) ? (
                <button
                  type="button"
                  disabled={shelfBusy}
                  onClick={() => void saveToShelf('the finished edition')}
                >
                  {shelfBusy ? 'Saving to the shelf…' : 'Save this book to the shelf'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  // Back to the design gate, which is the only step it is safe
                  // to re-enter: the look is downstream of everything, so
                  // changing it re-lays the book out and costs nothing. The
                  // gates above it decided what the book *says*, and returning
                  // there would throw away work rather than redo it.
                  setExported(null)
                  setPdf(null)
                  setBuildNote(null)
                  setState((st) => ({
                    ...st,
                    completed: st.completed.filter((id) => id !== 'design' && id !== 'export')
                  }))
                }}
              >
                Change the design
              </button>
            </div>
          </>
        ) : null}

        {/* --- proofreading, which is a workbench rather than a set of questions --- */}
        {!exported && !progressInfo && !runProgress && !pendingCost && isProofing ? (
          <>
            <ProofSheet
              document={state.document!}
              edits={edits}
              onChange={setEdits}
              resolveScan={(pageIndex) => reconRef.current?.thumbnails.get(pageIndex)}
              loadScan={loadProofScan}
              addImage={addSuppliedImage}
              imagePreview={previewOf}
              pictures={retouchablePictures}
              findings={state.findings}
              uncertainties={state.uncertainties}
              reviewedPages={reviewedPagesRef.current}
              attention={attentionRef.current}
            />
            <div className="actions">
              <button type="button" className="primary" onClick={advance}>
                Looks right — continue
              </button>
            </div>
          </>
        ) : null}

        {/* What the second reading found. Said plainly rather than left as a
            screen that is quietly shorter than it would have been. */}
        {checkNote && step.id === 'gate-uncertainties' && !progressInfo ? (
          <div className="resume-note">{checkNote}</div>
        ) : null}

        {/* --- gates --- */}
        {!exported &&
        !progressInfo &&
        !runProgress &&
        !pendingCost &&
        !checkProgress &&
        !pendingCheckCost &&
        !submitProgress &&
        !collectProgress &&
        !batchWaiting &&
        !pendingNotesCost &&
        !notesProgress &&
        !proposals &&
        questions.length > 0 ? (
          <>
            <QuestionList
              // Remounted per step, so a position in one gate is never carried
              // into the next one.
              key={step.id}
              questions={questions}
              answers={currentAnswers}
              onChange={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
              resolveEvidence={resolveEvidence}
              enlargeEvidence={enlargeEvidence}
              cropWords={cropWords}
              place={place}
              onPlace={(next) => {
                setPlace(next)
                if (fileKeyRef.current) saveReviewPlace(fileKeyRef.current, step.id, next)
              }}
            >
              {(atEnd) =>
                atEnd ? (
                  <>
                    {designSummary ? (
                      <div className="summary">
                        <span className="summary-label">Your edition will be set as</span>
                        <b>{designSummary}</b>
                      </div>
                    ) : null}
                    {designProfile ? (
                      <details className="tweaks">
                        <summary>Anything you’d change?</summary>
                        <p className="help">
                          Every control the questions above set for you, and a few they never touch.
                          These apply to this book only — bank the look if you want them on the next
                          one.
                        </p>
                        {styleTweakQuestions.map((q) => (
                          <QuestionView
                            key={q.id}
                            question={q}
                            value={currentAnswers[q.id]}
                            onChange={(v: AnswerValue) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                          />
                        ))}
                        {styleTweaks.length > 0 ? (
                          <div className="actions">
                            <button
                              type="button"
                              onClick={() =>
                                setAnswers((a) =>
                                  Object.fromEntries(
                                    Object.entries(a).filter(([id]) => !styleTweaks.includes(id))
                                  )
                                )
                              }
                            >
                              Undo my changes
                            </button>
                          </div>
                        ) : null}
                      </details>
                    ) : null}
                    {designProfile ? (
                      <PreviewPane
                        book={correctedDocument}
                        profile={designProfile}
                        edition={previewEdition}
                        images={drawableImageBytes()}
                      />
                    ) : null}
                    <div className="actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={missing.length > 0}
                        onClick={advance}
                      >
                        {step.id === 'transcribe'
                          ? // Collecting a batch is free, so promising a cost here
                            // would contradict the screen it sits under — the
                            // whole point of which is that these pages are bought.
                            state.savedBatch &&
                            (currentAnswers['batchAction'] ?? 'collect') === 'collect'
                            ? 'Collect it — free'
                            : state.savedRun && (currentAnswers['useSavedRun'] ?? 'use') === 'use'
                              ? 'Use it — continue'
                              : 'Continue — show me the cost'
                          : step.id === 'export'
                            ? 'Build the interior'
                            : 'Looks right — continue'}
                      </button>
                      {missing.length > 0 ? (
                        <span className="hint">Fill in: {missing.join(', ')}</span>
                      ) : null}
                    </div>
                  </>
                ) : (
                  // Held back until the last screen. A "continue" button beside
                  // "next leaf" on leaf three of forty is an invitation to skip
                  // the other thirty-seven by accident.
                  <div className="pager-note">
                    Everything you answer is kept as you go — close this and come back to it.
                  </div>
                )
              }
            </QuestionList>
          </>
        ) : null}

        {/* --- a stage that stopped without finishing --- */}
        {!exported &&
        !progressInfo &&
        !runProgress &&
        !pendingCost &&
        !checkProgress &&
        !pendingCheckCost &&
        !submitProgress &&
        !collectProgress &&
        !batchWaiting &&
        questions.length === 0 &&
        !isProofing &&
        step.id !== 'intake' ? (
          state.fileName ? (
            /* A step with nothing to ask, on a book that is open.
               
               This used to render the file picker — the same screen as having
               no book at all — so a gate that could not build its questions
               looked exactly like being sent back to the beginning with the
               whole afternoon's work gone. It is not gone: the transcription
               and every verdict are in storage, filed against this book. What
               is missing is whatever this step needed, so say which step, and
               offer the way on rather than the way back. */
            <div className="q">
              <span className="prompt">Nothing to review at “{step.title}”</span>
              <div className="help">
                This step has no questions for this book — usually because something it needs was
                not built. Your transcription and any verdicts are saved against this file and are
                not affected. You can carry on to the next step, or reopen the book to rebuild what
                is missing.
              </div>
              <div className="actions">
                <button type="button" className="primary" onClick={() => complete()}>
                  Carry on
                </button>
                <button type="button" className="ghost" onClick={() => fileInput.current?.click()}>
                  Reopen this book
                </button>
              </div>
            </div>
          ) : (
            <div className="actions">
              <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
                {error ? 'Try another file' : 'Choose a book'}
              </button>
            </div>
          )
        ) : null}
      </main>
    </div>
  )
}
