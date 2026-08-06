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
import { useEffect, useMemo, useState } from 'react'
import { STEPS, defaultAnswers, initialState, type Answers, type StepId } from '@core/wizard'
import { assembleBook } from '@core/assemble'
import { describeProfile, profileFromAnswers, type DesignAnswers } from '@core/design'
import { buildExport, editionFromAnswers } from '@core/export'
import { QuestionView } from './QuestionView'
import { ExportResult } from './ExportResult'
import { PreviewPane } from './PreviewPane'
import { renderInterior, type Interior } from '../platform/browser/interior'

/**
 * Enough prose that a laid-out page looks like a page. A three-sentence
 * fixture made the design gate's preview technically correct and useless to
 * look at — the whole point of that pane is judging how a *full* measure sets.
 */
const SAMPLE_PROSE = [
  'The alembick being set upon a gentle fire, and the matter therein digested by the space of fourty dayes, there ariseth a vapour of a whitish colour, which the ancients have named the Flying Eagle. This must be received into a clean receiver, well luted at the joynts, lest the spirit escape and the whole labour be lost.',
  'I have observed that the fire ought not at any time to be encreased suddenly, for the vessell will crack, and I have lost by this meanes three severall preparations, whereof the last was of no small charge. Let the operator therefore be patient, and governe his fire as a nurse governeth her childe.',
  'Concerning the choice of simples, those gathered under a waxing moone are held of greater vertue than such as be gathered otherwise, though I confesse I have not found the difference so notable as some writers pretend. Notwithstanding I follow the custome, for it costeth nothing to observe it.'
].join(' ')

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
        { kind: 'paragraph', text: `${SAMPLE_PROSE} The alembick being set upon a gentle fire.1` },
        { kind: 'paragraph', text: SAMPLE_PROSE },
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
        { kind: 'paragraph', text: `Herbes gathered under a waxing moone. ${SAMPLE_PROSE}` },
        { kind: 'paragraph', text: SAMPLE_PROSE }
      ],
      uncertain: [],
      furniture: {}
    }
  ])

  // Every step before the one being previewed counts as done.
  const upto = STEPS.findIndex((s) => s.id === stepId)
  const completed = STEPS.slice(0, upto).map((s) => s.id)

  const base = initialState()
  return {
    ...base,
    fileName: 'alchemist.pdf',
    pageCount: 3,
    pagesProcessed: 3,
    hasApiKey: true,
    // What the vision pass would have read off the original front matter. The
    // export gate prefills its first three questions from this, so without it
    // that gate would preview as three empty boxes — the very thing moving
    // them off Gate 1 was meant to get rid of.
    metadata: {
      ...base.metadata,
      title: 'The Alchemist His Practise',
      author: 'Anonymous',
      originalYear: '1662'
    },
    classifications: [{ pageIndex: 0, role: 'title-page' as const, selfReportedConfidence: 0 }],
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

  const designProfile = useMemo(
    () =>
      stepId === 'design'
        ? profileFromAnswers(
            {
              kind: current['kind'],
              period: current['period'],
              chapterOpener: current['chapterOpener'],
              runningHeads: current['runningHeads']
            } as unknown as DesignAnswers,
            current['font'] as string
          )
        : null,
    [stepId, current]
  )

  const summary = designProfile ? describeProfile(designProfile) : null

  const edition = useMemo(() => ({ title: 'The Alchemist His Practise', author: 'Anonymous' }), [])

  /** The style the export screen is previewed with. Fixed, not interviewed. */
  const exportProfile = useMemo(
    () =>
      profileFromAnswers({
        kind: 'novel',
        period: 'early-modern',
        chapterOpener: 'drop-cap',
        runningHeads: 'author-title'
      }),
    []
  )

  // The export gate builds a real interior here too, so this screen exercises
  // the same path the paid flow does rather than a mock of it — including the
  // measured page count and layout warnings the KDP checks report on.
  const [interior, setInterior] = useState<Interior | null>(null)
  useEffect(() => {
    if (stepId !== 'export' || !state.document) {
      setInterior(null)
      return
    }
    let live = true
    void renderInterior(state.document, exportProfile, { edition })
      .then((built) => {
        if (live) setInterior(built)
      })
      .catch(() => {
        if (live) setInterior(null)
      })
    return () => {
      live = false
    }
  }, [stepId, state.document, exportProfile, edition])

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

        {designProfile ? (
          <PreviewPane book={state.document} profile={designProfile} edition={edition} />
        ) : null}

        {/* The export gate's answers produce a real build, so the screen after
            it can be seen without a paid transcription run first. */}
        {stepId === 'export' ? (
          <ExportResult
            result={buildExport({
              document: state.document!,
              profile: exportProfile,
              edition: editionFromAnswers(current as Record<string, unknown>),
              estimatedPageCount: 240,
              ...(interior
                ? {
                    typeset: {
                      pageCount: interior.pageCount,
                      warnings: interior.warnings.map(
                        (w) => `Page ${w.pageIndex + 1}: a line runs past the margin`
                      ),
                      notesPlaced: interior.notesPlaced,
                      notesCollected: interior.notesCollected,
                      notesDropped: interior.notesDropped
                    }
                  }
                : {})
            })}
            pdf={interior ? { bytes: interior.bytes, pageCount: interior.pageCount } : null}
            note={interior ? null : 'Building the interior…'}
          />
        ) : null}
      </main>
    </div>
  )
}
