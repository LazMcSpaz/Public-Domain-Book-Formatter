/**
 * LoadingView — shown while the processing pipeline runs (SPEC §3). Displays a
 * stage progress bar and the current stage label. Presentational; progress is
 * pushed in from App.tsx.
 *
 * Keep this prop contract — App.tsx depends on it.
 */
import type { PipelineProgress } from '@shared/ipc-types'
import './LoadingView.css'

export interface LoadingViewProps {
  progress: PipelineProgress | null
}

export function LoadingView({ progress }: LoadingViewProps): JSX.Element {
  const pct = progress ? Math.round(((progress.index + 1) / progress.total) * 100) : 0

  return (
    <div className="loading-view">
      <h2>Processing book…</h2>

      <div
        className="loading-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="loading-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="loading-meta">
        <span className="loading-stage">
          {progress
            ? `Stage ${progress.index + 1}/${progress.total}: ${progress.stage}`
            : 'Starting…'}
        </span>
        <span className="loading-pct">{pct}%</span>
      </div>

      {progress?.message ? <p className="loading-message">{progress.message}</p> : null}
    </div>
  )
}
