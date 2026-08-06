/**
 * The wizard shell.
 *
 * The app interviews the user: it runs what it can on its own, and stops only
 * at gates where human judgment matters, asking with the evidence attached.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  STEPS,
  activeStep,
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
  verifyPage,
  type PageTranscription,
  type RunProgress,
  type RunResult
} from '@core/transcribe'
import { assembleBook } from '@core/assemble'
import { runBrowserTranscription } from '../platform/browser/transcribe-run'
import { loadApiKey, saveApiKey, loadPrefs, savePrefs } from '../platform/browser/settings'
import { loadRun, loadRunSummary, saveRun } from '../platform/browser/run-store'
import { createSavedRun, fileKey } from '@core/project'
import { profileFromAnswers, describeProfile, type DesignAnswers } from '@core/design'
import { buildExport, editionFromAnswers, type BuildExportResult } from '@core/export'
import { applyEdits, type BookEdit } from '@core/edits'
import { renderInterior } from '../platform/browser/interior'
import { cropIllustrations, readSuppliedImage } from '../platform/browser/illustrations'
import { renderPageToObjectUrl } from '../platform/browser/pdf'
import { ExportResult } from './ExportResult'
import { PreviewPane } from './PreviewPane'
import { ProofSheet } from './ProofSheet'

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
   * Preview URLs for the pictures the editor supplied, so the proof sheet can
   * show one back. Kept beside the bytes and revoked when a new book is opened.
   */
  const imagePreviewsRef = useRef<Map<string, string>>(new Map())
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
  const [exported, setExported] = useState<BuildExportResult | null>(null)
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; pageCount: number } | null>(null)
  const [buildNote, setBuildNote] = useState<string | null>(null)
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

  // The design gate answers questions about the *book*; this is the style they
  // add up to. Built live, because both the one-line summary and the page
  // preview below it show the consequence of an answer before it is committed.
  const designProfile = useMemo(() => {
    if (step.id !== 'design') return null
    const a = currentAnswers as Record<string, unknown>
    return profileFromAnswers(
      {
        kind: a['kind'],
        period: a['period'],
        chapterOpener: a['chapterOpener'],
        runningHeads: a['runningHeads']
      } as DesignAnswers,
      a['font'] as string
    )
  }, [step.id, currentAnswers])

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
  const allImageBytes = useCallback(
    (): Map<string, Uint8Array> => new Map([...cropBytesRef.current, ...suppliedBytesRef.current]),
    []
  )

  const correctedDocument = useMemo(
    () => (state.document ? applyEdits(state.document, edits) : null),
    [state.document, edits]
  )

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
        imagePreviewsRef.current.set(
          imageId,
          URL.createObjectURL(new Blob([decoded.bytes as BlobPart], { type: 'image/png' }))
        )
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
    if (reconRef.current) releaseRecon(reconRef.current)
    reconRef.current = null
    for (const url of imagePreviewsRef.current.values()) URL.revokeObjectURL(url)
    imagePreviewsRef.current = new Map()
    cropBytesRef.current = new Map()
    suppliedBytesRef.current = new Map()
    excludedPagesRef.current = []
    reviewedPagesRef.current = []
    setEdits([])

    setState((s) => ({
      ...s,
      ...initialState(),
      fileName: file.name,
      completed: ['intake']
    }))

    try {
      fileDataRef.current = file
      fileKeyRef.current = fileKey(file)
      // Asset paths come from the platform default, which resolves them
      // against the app's base URL. Repeating them here once meant they were
      // root-absolute and 404'd on any deploy below the domain root.
      const result = await runRecon(file, { onProgress: setProgress })
      reconRef.current = result

      // Has this exact file already been paid for? Looked up after the free
      // pass rather than before it, because the crops and thumbnails it
      // produces are what make a resumed session complete rather than partial.
      const saved = await loadRunSummary(fileKeyRef.current)

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

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void startRecon(file)
    },
    [startRecon]
  )

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
        findings: transcriptions.flatMap((t) => verifyPage(t, wordsByPage.get(t.pageIndex) ?? [])),
        uncertainties: transcriptions.flatMap((t) =>
          t.uncertain.map((u) => ({
            pageIndex: t.pageIndex,
            text: u.text,
            alternatives: u.alternatives,
            reason: u.reason
          }))
        ),
        failedPages: failures.map((f) => f.pageIndex),
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
    for (const image of saved.images) {
      restoredImages.set(image.id, image.bytes)
      imagePreviewsRef.current.set(
        image.id,
        URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: 'image/png' }))
      )
    }
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
      images: ReadonlyMap<string, Uint8Array> = new Map()
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
          images
        })
      )
      if (!stored) {
        setError(
          'The transcription could not be saved in this browser, so closing the tab ' +
            'will lose it. Finish the book in this session, or free up storage and try again.'
        )
      }
    },
    []
  )

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
    savePrefs({ ...prefs, modelId, bookContext })

    const controller = new AbortController()
    abortRef.current = controller

    // Group OCR words by page for the verification cross-check.
    const wordsByPage = new Map<number, typeof recon.words>()
    for (const w of recon.words) {
      const list = wordsByPage.get(w.pageIndex) ?? []
      list.push(w)
      wordsByPage.set(w.pageIndex, list)
    }

    try {
      const result = await runBrowserTranscription({
        fileData: data,
        ocrWordsByPage: wordsByPage,
        pageText: recon.pageText,
        client: { apiKey: key, modelId, effort: 'medium' },
        lexicon: state.lexicon,
        orthography: (identity['orthography'] as 'preserve' | 'modernize') ?? 'preserve',
        normalizeLongS: identity['longS'] === true,
        bookContext,
        imageLongEdge: prefs.imageLongEdge,
        onProgress: setRunProgress,
        signal: controller.signal
      })

      transcriptionRef.current = result

      // Store it before anything else can go wrong. This is the only step in
      // the app the user cannot repeat for free, and a refresh, a crash or a
      // closed tab between here and the export used to lose all of it.
      await persistRun(result, state.answers['gate-identity'] ?? {}, modelId)

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

    const design = state.answers['design'] ?? {}
    const profile = profileFromAnswers(
      {
        kind: design['kind'],
        period: design['period'],
        chapterOpener: design['chapterOpener'],
        runningHeads: design['runningHeads']
      } as unknown as DesignAnswers,
      design['font'] as string
    )

    const edition = editionFromAnswers(currentAnswers)
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
        images: allImageBytes()
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
    for (const [key, value] of Object.entries(currentAnswers)) {
      const match = /^page-(\d+)$/.exec(key)
      if (!match) continue
      if (value === 'redo') redo.push(Number(match[1]))
      if (value === 'skip') skip.push(Number(match[1]))
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
          lexicon: state.lexicon,
          orthography: (identity['orthography'] as 'preserve' | 'modernize') ?? 'preserve',
          normalizeLongS: identity['longS'] === true,
          bookContext: prefs.bookContext,
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

  /** Leaving a step: transcription needs cost approval first; gates just advance. */
  const advance = useCallback(() => {
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
    if (step.id === 'transcribe') {
      // Already paid for, and the user said to use it: nothing to approve.
      if (state.savedRun && (currentAnswers['useSavedRun'] ?? 'use') === 'use') {
        void useSavedRun()
        return
      }
      const estimate = estimateCost({
        pageCount: state.pageCount,
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
          <ExportResult result={exported} pdf={pdf} note={buildNote} />
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
              imagePreview={(imageId) => imagePreviewsRef.current.get(imageId)}
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
        {!exported && !progressInfo && !runProgress && !pendingCost && questions.length > 0 ? (
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
              <PreviewPane
                book={correctedDocument}
                profile={designProfile}
                edition={previewEdition}
                images={allImageBytes()}
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
