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
  type RunProgress,
  type RunResult
} from '@core/transcribe'
import { assembleBook } from '@core/assemble'
import { runBrowserTranscription } from '../platform/browser/transcribe-run'
import { loadApiKey, saveApiKey, loadPrefs, savePrefs } from '../platform/browser/settings'
import { profileFromAnswers, describeProfile, type DesignAnswers } from '@core/design'

export function App(): JSX.Element {
  const [state, setState] = useState<WizardState>(initialState)
  const [progressInfo, setProgress] = useState<ReconProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const reconRef = useRef<ReconResult | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const fileDataRef = useRef<ArrayBuffer | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const transcriptionRef = useRef<RunResult | null>(null)
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null)
  const [pendingCost, setPendingCost] = useState<string | null>(null)

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

  // The design gate answers questions about the *book*; this is the typography
  // they add up to, shown live so the consequence of an answer is visible
  // before it is committed.
  const designSummary = useMemo(() => {
    if (step.id !== 'design') return null
    const a = currentAnswers as Record<string, unknown>
    return describeProfile(
      profileFromAnswers(
        {
          kind: a['kind'],
          period: a['period'],
          chapterOpener: a['chapterOpener'],
          runningHeads: a['runningHeads']
        } as DesignAnswers,
        a['font'] as string
      )
    )
  }, [step.id, currentAnswers])

  const resolveEvidence = useCallback((src: string): string | undefined => {
    const m = /^page:(\d+)$/.exec(src)
    if (m) return reconRef.current?.thumbnails.get(Number(m[1]))
    return src
  }, [])

  const startRecon = useCallback(async (file: File) => {
    setError(null)
    setAnswers({})
    if (reconRef.current) releaseRecon(reconRef.current)
    reconRef.current = null

    setState((s) => ({
      ...s,
      ...initialState(),
      fileName: file.name,
      completed: ['intake']
    }))

    try {
      const data = await file.arrayBuffer()
      fileDataRef.current = data
      const result = await runRecon(data, {
        assets: {
          workerPath: '/tesseract/worker.min.js',
          corePath: '/tesseract/core',
          langPath: '/tesseract/lang'
        },
        onProgress: setProgress
      })
      reconRef.current = result

      // Placeholder classification until the vision pass lands: page 0 is
      // treated as the title page so the identity gate has evidence to show.
      setState((s) => ({
        ...s,
        pageCount: result.pageCount,
        pagesProcessed: result.pageCount,
        lexicon: result.lexicon,
        classifications: [{ pageIndex: 0, role: 'title-page', selfReportedConfidence: 0 }],
        cropFor: (tokenId: string) => result.crops.get(tokenId),
        hasApiKey: loadApiKey().length > 0,
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
    saveApiKey(key)

    const prefs = loadPrefs()
    const modelId = (currentAnswers['model'] as string) ?? prefs.modelId
    const bookContext = (currentAnswers['bookContext'] as string) ?? ''
    savePrefs({ ...prefs, modelId, bookContext })

    setPendingCost(null)
    setError(null)
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

      // Metadata the model read off the front matter now fills the identity
      // fields that started empty.
      const meta = mergeMetadata(result.transcriptions)
      transcriptionRef.current = result
      complete({
        metadata: {
          ...state.metadata,
          title: meta['title'] ?? state.metadata.title,
          author: meta['author'] ?? state.metadata.author,
          originalYear: meta['originalYear'] ?? state.metadata.originalYear,
          originalPublisher: meta['originalPublisher'] ?? state.metadata.originalPublisher,
          originalPlace: meta['originalPlace'] ?? state.metadata.originalPlace
        },
        classifications: result.transcriptions.map((t) => ({
          pageIndex: t.pageIndex,
          role: t.role,
          selfReportedConfidence: 0,
          furniture: t.furniture
        })),
        findings: result.findings,
        uncertainties: result.transcriptions.flatMap((t) =>
          t.uncertain.map((u) => ({
            pageIndex: t.pageIndex,
            text: u.text,
            alternatives: u.alternatives,
            reason: u.reason
          }))
        ),
        failedPages: result.failures.map((f) => f.pageIndex),
        // Assemble immediately: seam repair and footnote linking are pure and
        // fast, and Gate 3 needs the finished document to describe its shape.
        document: assembleBook(result.transcriptions)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunProgress(null)
      abortRef.current = null
    }
  }, [state, currentAnswers, complete])

  /** Leaving a step: transcription needs cost approval first; gates just advance. */
  const advance = useCallback(() => {
    if (step.id === 'transcribe') {
      const estimate = estimateCost({
        pageCount: state.pageCount,
        modelId: (currentAnswers['model'] as string) ?? 'claude-opus-5',
        imageLongEdge: loadPrefs().imageLongEdge
      })
      setPendingCost(formatEstimate(estimate))
      return
    }
    complete()
  }, [step.id, state.pageCount, currentAnswers, complete])

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
          </>
        ) : null}

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

        {/* --- gates --- */}
        {!progressInfo && !runProgress && !pendingCost && questions.length > 0 ? (
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
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={missing.length > 0}
                onClick={advance}
              >
                {step.id === 'transcribe'
                  ? 'Continue — show me the cost'
                  : 'Looks right — continue'}
              </button>
              {missing.length > 0 ? (
                <span className="hint">Fill in: {missing.join(', ')}</span>
              ) : null}
            </div>
          </>
        ) : null}

        {/* --- stages with nothing to ask yet --- */}
        {!progressInfo &&
        !runProgress &&
        !pendingCost &&
        questions.length === 0 &&
        step.id !== 'intake' ? (
          <p className="hint">
            Not built yet — this is where {step.title.toLowerCase()} will happen.
          </p>
        ) : null}
      </main>
    </div>
  )
}
