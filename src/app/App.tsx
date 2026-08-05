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

export function App(): JSX.Element {
  const [state, setState] = useState<WizardState>(initialState)
  const [progressInfo, setProgress] = useState<ReconProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const reconRef = useRef<ReconResult | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const step = activeStep(state)
  const questions = useMemo(() => step.questions(state), [step, state])
  const [answers, setAnswers] = useState<Answers>({})

  // Reset answers to the recommended defaults whenever the gate changes.
  const currentAnswers = useMemo(() => {
    const defaults = defaultAnswers(questions)
    return { ...defaults, ...answers }
  }, [questions, answers])

  const missing = missingRequired(questions, currentAnswers)

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

  const advance = useCallback(() => {
    setState((s) => ({
      ...s,
      answers: { ...s.answers, [step.id]: currentAnswers },
      completed: [...s.completed, step.id]
    }))
    setAnswers({})
  }, [step.id, currentAnswers])

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

        {/* --- gates --- */}
        {!progressInfo && questions.length > 0 ? (
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
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={missing.length > 0}
                onClick={advance}
              >
                Looks right — continue
              </button>
              {missing.length > 0 ? (
                <span className="hint">Fill in: {missing.join(', ')}</span>
              ) : null}
            </div>
          </>
        ) : null}

        {/* --- stages with nothing to ask yet --- */}
        {!progressInfo && questions.length === 0 && step.id !== 'intake' ? (
          <p className="hint">
            Not built yet — this is where {step.title.toLowerCase()} will happen.
          </p>
        ) : null}
      </main>
    </div>
  )
}
