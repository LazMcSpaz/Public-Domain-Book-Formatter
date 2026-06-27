/**
 * LoadingView — shown while the processing pipeline runs, displaying stage
 * progress (SPEC §3). Presentational; progress is pushed in from App.tsx.
 *
 * PLACEHOLDER (Phase 2 scaffold). Keep this prop contract when reimplementing.
 */
import type { PipelineProgress } from '@shared/ipc-types'

export interface LoadingViewProps {
  progress: PipelineProgress | null
}

export function LoadingView({ progress }: LoadingViewProps): JSX.Element {
  const pct = progress ? Math.round(((progress.index + 1) / progress.total) * 100) : 0
  return (
    <div className="loading-view">
      <h2>Processing book…</h2>
      <div className="loading-bar">
        <div className="loading-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <p>
        {progress
          ? `Stage ${progress.index + 1}/${progress.total}: ${progress.stage}${
              progress.message ? ` — ${progress.message}` : ''
            }`
          : 'Starting…'}
      </p>
    </div>
  )
}
