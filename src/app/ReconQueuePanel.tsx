import type { ReconQueueState } from '@core/sync'
import { queueRemaining } from '@core/sync'
import type { ShelfReadProgress } from '../platform/browser/recon-handoff'

/**
 * The shelf's reading queue, on screen: which book is being read, how far it
 * has got, how many are left, and what went wrong with any that failed.
 *
 * Built to be glanced at from across a room. The one number that matters is
 * how many books are left, so it is the biggest thing on the panel.
 */
export interface ReconQueuePanelProps {
  queue: ReconQueueState
  running: boolean
  current: { title: string; progress: ShelfReadProgress } | null
  titleOf: (key: string) => string
  onStop: () => void
  onResume: () => void
  onDismiss: () => void
}

const PHASE: Record<ShelfReadProgress['phase'], string> = {
  fetching: 'Fetching the scan from the shelf',
  rendering: 'Reading leaves',
  ocr: 'Reading leaves',
  harvesting: 'Harvesting the vocabulary',
  sending: 'Putting the reading on the shelf',
  done: 'Done'
}

export function ReconQueuePanel(props: ReconQueuePanelProps): JSX.Element {
  const { queue, running, current, titleOf, onStop, onResume, onDismiss } = props
  const remaining = queueRemaining(queue)
  const total = queue.keys.length
  const settled = queue.done.length + queue.failed.length
  const finished = remaining.length === 0
  const p = current?.progress
  const leafShare = p && p.total > 0 ? p.page / p.total : 0
  const overall = total > 0 ? (settled + (running ? leafShare : 0)) / total : 0

  return (
    <div className={`queue-panel${running ? ' running' : ''}`} aria-live="polite">
      <div className="queue-head">
        <div>
          <div className="queue-eyebrow">
            {finished ? 'Reading finished' : running ? 'Reading the scans' : 'Reading paused'}
          </div>
          <div className="queue-count">
            {finished
              ? `${queue.done.length} of ${total} read`
              : `${remaining.length} ${remaining.length === 1 ? 'book' : 'books'} left`}
          </div>
        </div>
        <div className="queue-actions">
          {running ? (
            <button type="button" onClick={onStop}>
              Stop
            </button>
          ) : finished ? (
            <button type="button" onClick={onDismiss}>
              Dismiss
            </button>
          ) : (
            <>
              <button type="button" className="primary" onClick={onResume}>
                Carry on
              </button>
              <button type="button" onClick={onDismiss}>
                Forget the queue
              </button>
            </>
          )}
        </div>
      </div>

      <div className="bar" aria-hidden="true">
        <i style={{ width: `${Math.round(overall * 100)}%` }} />
      </div>

      {running && current && p ? (
        <div className="queue-now">
          <strong>{current.title}</strong>
          <span>
            {PHASE[p.phase]}
            {p.total > 0 && (p.phase === 'rendering' || p.phase === 'ocr')
              ? ` — leaf ${p.page} of ${p.total}`
              : ''}
            {p.resumedAt > 0 ? ` · carried on from leaf ${p.resumedAt}` : ''}
          </span>
        </div>
      ) : null}

      {running ? (
        <p className="queue-note">
          You can leave this running. Keep the tab open and the computer awake; each book is saved
          to this device every twenty leaves, so an interruption costs minutes, not the book. Each
          reading goes to the shelf as soon as it is done.
        </p>
      ) : null}

      {queue.failed.length > 0 ? (
        <ul className="queue-failed">
          {queue.failed.map((f) => (
            <li key={f.key}>
              <strong>{titleOf(f.key)}</strong>: {f.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
