/**
 * Dev-only gate preview.
 *
 * Later gates sit behind a paid transcription run, so the only way to *look* at
 * them during development would be to spend money on every UI tweak. This
 * renders any gate's questions against a hand-built state instead, so the
 * screenshot script can see the whole flow.
 *
 * Mounted only under `import.meta.env.DEV` (see main.tsx) — it is tree-shaken
 * out of the production bundle, and it never touches the API.
 */
import { useMemo, useState } from 'react'
import { STEPS, defaultAnswers, initialState, type Answers, type StepId } from '@core/wizard'
import { assembleBook } from '@core/assemble'
import { describeProfile, profileFromAnswers, type DesignAnswers } from '@core/design'
import { QuestionView } from './QuestionView'

/** A book far enough along that every gate has something real to show. */
function sampleState(stepId: StepId) {
  const document = assembleBook([
    {
      pageIndex: 0,
      role: 'title-page',
      blocks: [{ kind: 'paragraph', text: 'THE ALCHEMIST HIS PRACTISE' }],
      uncertain: [],
      furniture: {}
    },
    {
      pageIndex: 1,
      role: 'body',
      blocks: [
        { kind: 'heading', text: 'Chapter I. Of the Vessel', level: 1 },
        { kind: 'paragraph', text: 'The alembick being set upon a gentle fire.1' },
        { kind: 'footnote', text: 'See Croll, Basilica Chymica, lib. ii.', marker: '1' }
      ],
      uncertain: [],
      furniture: {}
    },
    {
      pageIndex: 2,
      role: 'body',
      blocks: [
        { kind: 'heading', text: 'Chapter II. Of Simples', level: 1 },
        { kind: 'paragraph', text: 'Herbes gathered under a waxing moone.' }
      ],
      uncertain: [],
      furniture: {}
    }
  ])

  // Every step before the one being previewed counts as done.
  const upto = STEPS.findIndex((s) => s.id === stepId)
  const completed = STEPS.slice(0, upto).map((s) => s.id)

  return {
    ...initialState(),
    fileName: 'alchemist.pdf',
    pageCount: 3,
    pagesProcessed: 3,
    hasApiKey: true,
    document,
    completed
  }
}

export function DevPreview(): JSX.Element {
  const [stepId, setStepId] = useState<StepId>('design')
  const [answers, setAnswers] = useState<Answers>({})

  const step = STEPS.find((s) => s.id === stepId)!
  // Mirrors App.tsx: in-progress answers feed back into question generation so
  // help text that describes an earlier answer stays current.
  const state = useMemo(() => {
    const base = sampleState(stepId)
    return { ...base, answers: { ...base.answers, [stepId]: answers } }
  }, [stepId, answers])
  const questions = useMemo(() => step.questions(state), [step, state])
  const current = useMemo(
    () => ({ ...defaultAnswers(questions), ...answers }),
    [questions, answers]
  )

  const summary =
    stepId === 'design'
      ? describeProfile(
          profileFromAnswers(
            {
              kind: current['kind'],
              period: current['period'],
              chapterOpener: current['chapterOpener'],
              runningHeads: current['runningHeads']
            } as unknown as DesignAnswers,
            current['font'] as string
          )
        )
      : null

  return (
    <div className="shell">
      <nav className="rail">
        <h1>
          Gate preview
          <small>dev only</small>
        </h1>
        <ol>
          {STEPS.filter((s) => s.isGate).map((s) => (
            <li
              key={s.id}
              className={s.id === stepId ? 'active gate' : 'gate'}
              onClick={() => {
                setStepId(s.id)
                setAnswers({})
              }}
            >
              <span className="dot" />
              <span className="label">{s.title}</span>
            </li>
          ))}
        </ol>
      </nav>

      <main className="main">
        <div className="step-head">
          <h2>{step.title}</h2>
          <p>{step.blurb}</p>
        </div>

        {questions.map((q) => (
          <QuestionView
            key={q.id}
            question={q}
            value={current[q.id]}
            onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
            resolveEvidence={(src) => (src.startsWith('page:') ? undefined : src)}
          />
        ))}

        {summary ? (
          <div className="summary">
            <span className="summary-label">Your edition will be set as</span>
            <b>{summary}</b>
          </div>
        ) : null}
      </main>
    </div>
  )
}
