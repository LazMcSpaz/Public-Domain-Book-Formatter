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
  initialState,
  missingRequired,
  type AnswerValue,
  type Answers,
  type StepId,
  type WizardState
} from '@core/wizard'
import {
  runRecon,
  releaseRecon,
  type ReconProgress,
  type ReconResult
} from '../platform/browser/recon'
import { QuestionView } from './QuestionView'
import {
  estimateCost,
  formatEstimate,
  mergeMetadata,
  validateApiKey,
  findDroppedRuns,
  spliceRun,
  transcriptionText,
  verifyBook,
  verifyPage,
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
  saveReviewProgress,
  storageEstimate
} from '../platform/browser/settings'
import {
  findRunForFile,
  listProfiles,
  listRuns,
  loadRun,
  loadRunSummary,
  loadSourceFile,
  saveProfile,
  saveRun,
  saveSourceFile,
  storedFileKeys
} from '../platform/browser/run-store'
import { newSavedProfile, styleQuestions, type SavedStyleProfile } from '@core/style'
import {
  createSavedRun,
  describeAge,
  fileKey,
  summarize as summarizeRun,
  type SavedRunSummary
} from '@core/project'
import { BODY_FONTS, describeProfile } from '@core/design'
import { buildExport, editionFromAnswers, type BuildExportResult } from '@core/export'
import { applyEdits, type BookEdit } from '@core/edits'
import {
  draftIntroduction,
  estimateAnnotationCost,
  learnVoice,
  proposalsToEdits,
  runAnnotation,
  type AcceptedProposal,
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
  const transcriptionRef = useRef<RunResult | null>(null)
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null)
  const [pendingCost, setPendingCost] = useState<string | null>(null)
  /**
   * The annotation pass, which is the app's second and much cheaper paid step.
   *
   * Held here rather than in the wizard state because it is a *proposal* — none
   * of it is part of the book until the review gate says so, at which point it
   * becomes ordinary edits and stops being special.
   */
  const [pendingNotesCost, setPendingNotesCost] = useState<string | null>(null)
  const [notesProgress, setNotesProgress] = useState<{ done: number; total: number } | null>(null)
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

  // Arriving at a step: put back whatever was answered here last time. Keyed by
  // step, so this cannot resurrect an answer onto a different gate.
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    const key = fileKeyRef.current
    if (!key || restoredFor.current === step.id) return
    restoredFor.current = step.id
    const saved = loadReviewProgress(key)[step.id]
    if (saved && Object.keys(saved).length > 0) setAnswers(saved as Answers)
  }, [step.id])

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
      const known = await findRunForFile(file)
      if (known) {
        fileKeyRef.current = known.key
        setResumeNote(
          `You have already paid to have this book read — ${known.run.pageCount} pages. ` +
            'Re-reading the scan is free and costs only time; the transcription is waiting ' +
            'at the end of it.'
        )
        // Keep the scan from now on, so the next time is one tap. It was very
        // likely saved before this was possible, and re-picking the file once
        // is the only chance to catch up.
        if (loadPrefs().keepScans !== false && !reopenable.includes(known.key)) {
          if (await saveSourceFile(known.key, file)) {
            setReopenable((keys) => [...keys, known.key])
          }
        }
      }
      // Asset paths come from the platform default, which resolves them
      // against the app's base URL. Repeating them here once meant they were
      // root-absolute and 404'd on any deploy below the domain root.
      const result = await runRecon(file, { onProgress: setProgress })
      reconRef.current = result

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
        cropFor: (tokenId: string) => result.crops.get(tokenId),
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
    [startRecon]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void startRecon(file)
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
              return [t.pageIndex, findDroppedRuns(transcriptionText(t), words)] as const
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
    complete(stateFromTranscriptions(saved.transcriptions, saved.failures))
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
      complete = true
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
          complete
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

  /** Run the paid pass. Only reached after the user approves the estimate. */
  const startTranscription = useCallback(async () => {
    const recon = reconRef.current
    const data = fileDataRef.current
    if (!recon || !data) return

    const identity = state.answers['gate-identity'] ?? {}
    const key = (currentAnswers['apiKey'] as string) || loadApiKey()
    if (!key) {
      setError('An API key is needed to transcribe.')
      return
    }

    // Check the credential before spending anything. Without this a bad key
    // fails once per page for the whole book — slow, and it looks like the app
    // is broken rather than the key being wrong.
    setPendingCost(null)
    setError(null)
    const credential = await validateApiKey(key)
    if (!credential.ok) {
      setError(credential.message ?? 'That API key could not be used.')
      return
    }
    saveApiKey(key)

    const prefs = loadPrefs()
    const modelId = (currentAnswers['model'] as string) ?? prefs.modelId
    const bookContext = (currentAnswers['bookContext'] as string) ?? ''
    // `bookContext` deliberately not stored: it is a fact about *this* book
    // ("a 1662 alchemical treatise"), so keeping it as a device preference was
    // a category error. It was written and never read back, so nothing is lost
    // by dropping it — and restoring it on the next book would have been wrong.
    savePrefs({ ...prefs, modelId })

    const controller = new AbortController()
    abortRef.current = controller

    // Group OCR words by page for the verification cross-check.
    const wordsByPage = new Map<number, typeof recon.words>()
    for (const w of recon.words) {
      const list = wordsByPage.get(w.pageIndex) ?? []
      list.push(w)
      wordsByPage.set(w.pageIndex, list)
    }

    // Pages an earlier run already bought, when the user chose to carry on.
    // Loaded here rather than held in state because it is the whole
    // transcription, not a summary, and nothing renders from it.
    const runKey = fileKeyRef.current
    const resuming =
      state.savedRun !== null &&
      !state.savedRun.complete &&
      (currentAnswers['useSavedRun'] ?? 'resume') === 'resume'
    const alreadyRead = resuming && runKey ? ((await loadRun(runKey))?.transcriptions ?? []) : []

    const vetted = vetLexicon(
      state.lexicon,
      (identity['terms'] as Record<string, TermDecision> | undefined) ?? {}
    )

    // Warned once, not once per checkpoint: a storage failure repeated every
    // five pages would bury the run's own progress under its own complaint.
    let warnedAboutStorage = false

    try {
      const result = await runBrowserTranscription({
        fileData: data,
        ocrWordsByPage: wordsByPage,
        pageText: recon.pageText,
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

      // Store it before anything else can go wrong. This is the only step in
      // the app the user cannot repeat for free, and a refresh, a crash or a
      // closed tab between here and the export used to lose all of it.
      await persistRun(
        result,
        state.answers['gate-identity'] ?? {},
        modelId,
        [],
        new Map(),
        !result.cancelled
      )

      complete(stateFromTranscriptions(result.transcriptions, result.failures))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunProgress(null)
      abortRef.current = null
    }
  }, [state, currentAnswers, complete])

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
    const restore: number[] = []
    for (const [key, value] of Object.entries(currentAnswers)) {
      const match = /^page-(\d+)$/.exec(key)
      if (!match) continue
      if (value === 'redo') redo.push(Number(match[1]))
      if (value === 'skip') skip.push(Number(match[1]))
      if (value === 'restore') restore.push(Number(match[1]))
    }

    /**
     * Put back the passages OCR read and the transcription lacks.
     *
     * As ordinary `text` corrections, so they are undoable at the proof step,
     * saved with the run, and indistinguishable from a fix typed by hand — the
     * same rule every other repair in this app follows. The recovered words are
     * OCR's, not the model's, so they are spliced in where they were taken from
     * and left for the user to read rather than trusted.
     */
    const recovered: BookEdit[] = []
    if (restore.length > 0 && state.document) {
      const blocks = applyEdits(state.document, edits).blocks
      for (const pageIndex of restore) {
        for (const run of state.droppedRuns[pageIndex] ?? []) {
          // The block the anchor is in, among those that came off this page.
          const host = blocks.find(
            (b) => b.sourcePages.includes(pageIndex) && spliceRun(b.text, run) !== null
          )
          const fixed = host ? spliceRun(host.text, run) : null
          if (host && fixed) recovered.push({ kind: 'text', blockId: host.id, text: fixed })
        }
      }
      if (recovered.length > 0) setEdits((current) => [...current, ...recovered])
    }

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
    }
    complete()
  }, [edits, state.answers, persistRun, complete])

  /**
   * The annotation pass, and the introduction if one was asked for.
   *
   * The second paid step, and much the cheaper of the two — no images, and the
   * voice card is cached across every chunk. Nothing it produces touches the
   * book here: it all lands in `proposals` for the review gate, which is what
   * makes it safe to run without the user having read a word of it yet.
   */
  const startAnnotation = useCallback(async () => {
    const doc = state.document
    if (!doc) return
    setPendingNotesCost(null)

    const answers = state.answers['annotate'] ?? currentAnswers
    const wantsNotes = (answers['annotateBook'] ?? 'yes') === 'yes'
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
    const wantsHarvest = harvestDepth !== 'none'
    const interest = String(answers['harvestInterest'] ?? state.harvestInterest)
    const bank = loadBank()

    const identity = state.answers['gate-identity'] ?? {}
    const facts = {
      ...(state.metadata.title ? { title: state.metadata.title } : {}),
      ...(state.metadata.author ? { author: state.metadata.author } : {}),
      ...(state.metadata.originalYear ? { originalYear: state.metadata.originalYear } : {}),
      ...(identity['bookContext'] ? { context: String(identity['bookContext']) } : {})
    }
    const client = { apiKey: loadApiKey(), modelId: loadPrefs().modelId }

    const harvestOptions = {
      depth: harvestDepth as HarvestDepth,
      vocabulary: bank.vocabulary,
      sourceKey: fileKeyRef.current ?? state.fileName ?? 'book',
      ...(interest.trim() ? { interest: interest.trim() } : {})
    }

    setNotesProgress({ done: 0, total: 1 })
    try {
      // When both are wanted, the harvest rides the annotation reply: the book
      // is read once and the entries cost output tokens only.
      const notes = wantsNotes
        ? await runAnnotation(doc.blocks, {
            client,
            voice,
            facts,
            ...(wantsHarvest ? { harvest: harvestOptions } : {}),
            onProgress: (done, total) => setNotesProgress({ done, total })
          })
        : { proposals: [], facts: [], failures: [], discarded: 0, cancelled: false }

      // A book worth mining and not worth annotating pays for its own reading.
      const harvested =
        wantsHarvest && !wantsNotes
          ? await runHarvest(doc.blocks, {
              client,
              facts,
              ...harvestOptions,
              onProgress: (done, total) => setNotesProgress({ done, total })
            })
          : { facts: notes.facts, failures: [], discarded: 0, cancelled: false }

      setBankFacts(harvested.facts)
      // Recorded as soon as it exists rather than at the review, because the
      // harvest is not reviewed: the entries are files the user keeps, and the
      // vocabulary has to grow even if they walk away from this screen.
      if (harvested.facts.length > 0) recordHarvest(harvested.facts, interest)
      if (interest !== state.harvestInterest) {
        setState((st) => ({ ...st, harvestInterest: interest }))
      }

      let introduction: IntroductionDraft | null = null
      if (wantsIntro) {
        setNotesProgress({ done: 1, total: 1 })
        const drafted = await draftIntroduction(doc, {
          client,
          voice,
          facts,
          length: introLength as IntroductionLength,
          ...(answers['introBrief'] ? { brief: String(answers['introBrief']) } : {})
        })
        introduction = drafted.draft
      }

      // A review screen with nothing on it is a dead end the user has to click
      // past. When the pass produced only bank entries — which is the whole of
      // what a harvest-only run produces — there is nothing to approve, so the
      // step is finished here and the files wait at the export screen.
      const worthReviewing = notes.proposals.length > 0 || introduction !== null
      if (worthReviewing) {
        setProposals({ notes: notes.proposals, failures: notes.failures, introduction })
      } else {
        complete()
      }
    } catch (err) {
      // A failed annotation pass is not a failed book: everything up to here is
      // intact and the step is optional. Say so and let the user carry on.
      setProposals({
        notes: [],
        failures: [{ chunkIndex: 0, message: err instanceof Error ? err.message : String(err) }],
        introduction: null
      })
    } finally {
      setNotesProgress(null)
    }
  }, [state, currentAnswers, complete])

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

      const run = transcriptionRef.current
      if (run) {
        void persistRun(run, state.answers['gate-identity'] ?? {}, loadPrefs().modelId, next)
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
      persistRun,
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
        modelId: loadPrefs().modelId,
        density: String(currentAnswers['noteDensity'] ?? state.voice.density) as NoteDensity
      })
      // Riding the notes costs output tokens only; harvesting a book nobody is
      // annotating pays to read it. Quoting one number for both would be a lie
      // in whichever direction the user happened to choose.
      const harvestCost = wantsHarvest
        ? estimateHarvestCost({
            wordCount: words,
            modelId: loadPrefs().modelId,
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
        imageLongEdge: loadPrefs().imageLongEdge
      })
      setPendingCost(formatEstimate(estimate))
      return
    }
    complete()
  }, [
    step.id,
    state.pageCount,
    state.savedRun,
    currentAnswers,
    complete,
    runExport,
    finishUncertainties,
    finishStructure,
    finishProof,
    finishDesign,
    useSavedRun
  ])

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
              <strong>Drop a scanned PDF here</strong>
              <span>or click to choose a file — the whole book, one file</span>
            </div>

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
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void startRecon(f)
          }}
        />

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
            </div>
          </div>
        ) : null}

        {/* --- cost approval before any spend --- */}
        {pendingCost ? (
          <div className="q">
            <span className="prompt">Ready to transcribe {state.pageCount} pages</span>
            <div className="help">
              This is the only step that costs money. Estimated cost: <b>{pendingCost}</b>. You are
              billed directly by Anthropic for your own API key.
            </div>
            <div className="actions">
              <button type="button" className="primary" onClick={() => void startTranscription()}>
                Start — {pendingCost}
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
            <div className="meta">writing in your editor’s voice</div>
          </div>
        ) : null}

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
            <div className="actions">
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
            />
            <div className="actions">
              <button type="button" className="primary" onClick={advance}>
                Looks right — continue
              </button>
            </div>
          </>
        ) : null}

        {/* --- gates --- */}
        {!exported &&
        !progressInfo &&
        !runProgress &&
        !pendingCost &&
        !pendingNotesCost &&
        !notesProgress &&
        !proposals &&
        questions.length > 0 ? (
          <>
            {questions.map((q) => (
              <QuestionView
                key={q.id}
                question={q}
                value={currentAnswers[q.id]}
                onChange={(v: AnswerValue) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                resolveEvidence={resolveEvidence}
              />
            ))}
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
                  Every control the questions above set for you, and a few they never touch. These
                  apply to this book only — bank the look if you want them on the next one.
                </p>
                {styleQuestions(designProfile, {
                  families: BODY_FONTS.map((f) => ({
                    value: f.family,
                    label: f.label,
                    description: f.note
                  }))
                }).map((q) => (
                  <QuestionView
                    key={q.id}
                    question={q}
                    value={state.styleOverrides[q.id]}
                    onChange={(v: AnswerValue) =>
                      setState((st) => ({
                        ...st,
                        styleOverrides: { ...st.styleOverrides, [q.id]: v }
                      }))
                    }
                  />
                ))}
                {Object.keys(state.styleOverrides).length > 0 ? (
                  <div className="actions">
                    <button
                      type="button"
                      onClick={() => setState((st) => ({ ...st, styleOverrides: {} }))}
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
                  ? state.savedRun && (currentAnswers['useSavedRun'] ?? 'use') === 'use'
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
        ) : null}

        {/* --- a stage that stopped without finishing --- */}
        {!exported &&
        !progressInfo &&
        !runProgress &&
        !pendingCost &&
        questions.length === 0 &&
        !isProofing &&
        step.id !== 'intake' ? (
          <div className="actions">
            <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
              {error ? 'Try another file' : 'Choose a book'}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  )
}
