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
  type RunProgress,
  type RunResult
} from '@core/transcribe'
import { assembleBook } from '@core/assemble'
import { runBrowserTranscription } from '../platform/browser/transcribe-run'
import { loadApiKey, saveApiKey, loadPrefs, savePrefs } from '../platform/browser/settings'
import { profileFromAnswers, describeProfile, type DesignAnswers } from '@core/design'
import {
  buildExport,
  editionFromAnswers,
  noTexEngine,
  tryCompile,
  type BuildExportResult
} from '@core/export'
import { ExportResult } from './ExportResult'

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
  const abortRef = useRef<AbortController | null>(null)
  const transcriptionRef = useRef<RunResult | null>(null)
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null)
  const [pendingCost, setPendingCost] = useState<string | null>(null)
  const [exported, setExported] = useState<BuildExportResult | null>(null)
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; pageCount: number } | null>(null)
  const [texNote, setTexNote] = useState<string | null>(null)

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
    // A new book starts from nothing — leaving the previous edition's export on
    // screen would let the user download the wrong book.
    setExported(null)
    setPdf(null)
    setTexNote(null)
    if (reconRef.current) releaseRecon(reconRef.current)
    reconRef.current = null

    setState((s) => ({
      ...s,
      ...initialState(),
      fileName: file.name,
      completed: ['intake']
    }))

    try {
      fileDataRef.current = file
      // Asset paths come from the platform default, which resolves them
      // against the app's base URL. Repeating them here once meant they were
      // root-absolute and 404'd on any deploy below the domain root.
      const result = await runRecon(file, { onProgress: setProgress })
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

  /**
   * Build the edition. The LaTeX source is produced locally and always
   * succeeds; the PDF depends on a TeX engine being available, and when one
   * isn't the `.tex` is still a real deliverable rather than a dead end.
   */
  const runExport = useCallback(async () => {
    const doc = state.document
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

    const input = {
      document: doc,
      profile,
      edition: editionFromAnswers(state.answers['gate-identity'] ?? {}, currentAnswers),
      // The true count comes from the TeX run; until then the source page count
      // is the honest stand-in for the gutter check.
      estimatedPageCount: state.pageCount,
      // The structure gate asked what to do with notes that couldn't be placed.
      omitOrphanFootnotes: (state.answers['gate-structure'] ?? {})['orphanNotes'] === 'omit'
    }
    const result = buildExport(input)
    setExported(result)

    const outcome = await tryCompile(noTexEngine, { tex: result.tex })
    if (outcome.ok) {
      setPdf({ bytes: outcome.result.pdf, pageCount: outcome.result.pageCount })
      setTexNote(null)
      // Re-report now that the estimates are real numbers.
      setExported(
        buildExport({
          ...input,
          compiled: {
            pageCount: outcome.result.pageCount,
            warnings: outcome.result.warnings
          }
        })
      )
    } else {
      setPdf(null)
      setTexNote(outcome.reason)
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

    complete({
      findings,
      document: assembleBook(transcriptions, { excludePages: skip })
    })
  }, [state, currentAnswers, complete])

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
  }, [step.id, state.pageCount, currentAnswers, complete, runExport, finishUncertainties])

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

        {/* --- the finished edition --- */}
        {exported ? <ExportResult result={exported} pdf={pdf} texNote={texNote} /> : null}

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
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={missing.length > 0}
                onClick={advance}
              >
                {step.id === 'transcribe'
                  ? 'Continue — show me the cost'
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
