import { useState } from 'react'
import type { ReconQueueState, ShelfAbout } from '@core/sync'
import { pickedByDefault, queueRemaining, shelfTitleParts } from '@core/sync'
import type { ShelfReadProgress } from '../platform/browser/recon-handoff'

/**
 * The shelf's reading queue, on screen: which book is being read, how far it
 * has got, how many are left, and every book in it with its state.
 *
 * Built to be glanced at from across a room. The one number that matters is
 * how many books are left, so it is the biggest thing on the panel. Below it,
 * the queue as a list the editor can work: a waiting book moves up or down or
 * comes out, and the one being read now can be skipped — its leaves stay in
 * the checkpoint, so queuing it again later carries on rather than restarts.
 */
export interface ReconQueuePanelProps {
  queue: ReconQueueState
  running: boolean
  current: { key: string; title: string; progress: ShelfReadProgress } | null
  titleOf: (key: string) => string
  aboutOf: (key: string) => ShelfAbout | undefined
  onStop: () => void
  onResume: () => void
  onDismiss: () => void
  onRemove: (key: string) => void
  onMove: (key: string, by: -1 | 1) => void
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
  const { queue, running, current, titleOf, aboutOf } = props
  const { onStop, onResume, onDismiss, onRemove, onMove } = props
  const remaining = queueRemaining(queue)
  const total = queue.keys.length
  const settled = queue.done.length + queue.failed.length
  const finished = remaining.length === 0
  const p = current?.progress
  const leafShare = p && p.total > 0 ? p.page / p.total : 0
  const overall = total > 0 ? (settled + (running ? leafShare : 0)) / total : 0
  const failedWhy = new Map(queue.failed.map((f) => [f.key, f.reason]))
  // While the queue runs, the first waiting book is the one being read.
  const reading = running ? (current?.key ?? remaining[0]) : undefined

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

      <ol className="queue-list">
        {queue.keys.map((key) => {
          const done = queue.done.includes(key)
          const why = failedWhy.get(key)
          const now = key === reading
          const at = remaining.indexOf(key)
          const waiting = at >= 0 && !now
          const about = aboutOf(key)
          const state = done ? 'done' : why ? 'failed' : now ? 'now' : 'waiting'
          // A waiting book cannot be moved above the one being read.
          const firstMovable = running ? 1 : 0
          return (
            <li key={key} className={`queue-item ${state}`}>
              <span className="queue-mark" aria-hidden="true">
                {done ? '✓' : why ? '!' : now ? '●' : at + 1}
              </span>
              <span className="queue-what">
                <strong>{titleOf(key)}</strong>
                <small>
                  {done
                    ? 'Read and on the shelf'
                    : why
                      ? why
                      : now && p
                        ? `${PHASE[p.phase]}${
                            p.total > 0 && (p.phase === 'rendering' || p.phase === 'ocr')
                              ? ` — leaf ${p.page} of ${p.total}`
                              : ''
                          }${p.resumedAt > 0 ? ` · carried on from leaf ${p.resumedAt}` : ''}`
                        : about
                          ? `${about.pageCount} leaves${
                              about.read > 1 ? ` · ${about.read} already transcribed` : ''
                            }`
                          : 'Waiting'}
                </small>
              </span>
              {now ? (
                <span className="queue-tools">
                  <button
                    type="button"
                    onClick={() => onRemove(key)}
                    title="Stop reading this book and go on to the next; what has been read of it is kept"
                  >
                    Skip
                  </button>
                </span>
              ) : waiting ? (
                <span className="queue-tools">
                  <button
                    type="button"
                    aria-label={`Move ${titleOf(key)} earlier`}
                    disabled={at <= firstMovable}
                    onClick={() => onMove(key, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${titleOf(key)} later`}
                    disabled={at >= remaining.length - 1}
                    onClick={() => onMove(key, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Take ${titleOf(key)} out of the queue`}
                    onClick={() => onRemove(key)}
                  >
                    ✕
                  </button>
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>

      {running ? (
        <p className="queue-note">
          You can leave this running. Keep the tab open and the computer awake; each book is saved
          to this device every twenty leaves, so an interruption costs minutes, not the book. Each
          reading goes to the shelf as soon as it is done.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Which scans to read: every book still owed a reading, ticked or not.
 *
 * A book mostly transcribed already arrives unticked (`pickedByDefault`) with
 * how much of it is done beside it, because reading its whole scan again buys
 * little and costs the whole scan's time. The choice is the editor's.
 */
export function ReconPicker(props: {
  books: ShelfAbout[]
  adding: boolean
  onRead: (keys: string[]) => void
  onCancel: () => void
}): JSX.Element {
  const { books, adding, onRead, onCancel } = props
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(books.filter(pickedByDefault).map((b) => b.key))
  )
  const chosen = books.filter((b) => picked.has(b.key))
  const leaves = chosen.reduce((n, b) => n + b.pageCount, 0)
  const toggle = (key: string): void =>
    setPicked((set) => {
      const next = new Set(set)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="queue-panel queue-picker">
      <div className="queue-head">
        <div>
          <div className="queue-eyebrow">
            {adding ? 'Add to the queue' : 'Read scans in this browser'}
          </div>
          <div className="queue-count">
            {chosen.length} of {books.length} chosen
          </div>
        </div>
        <div className="queue-actions">
          <button type="button" onClick={() => setPicked(new Set(books.map((b) => b.key)))}>
            All
          </button>
          <button type="button" onClick={() => setPicked(new Set())}>
            None
          </button>
        </div>
      </div>
      <ul className="queue-list">
        {books.map((b) => {
          const { title, author } = shelfTitleParts(b)
          const partly = b.read > 1
          return (
            <li key={b.key} className={`queue-item pick${picked.has(b.key) ? ' on' : ''}`}>
              <label>
                <input type="checkbox" checked={picked.has(b.key)} onChange={() => toggle(b.key)} />
                <span className="queue-what">
                  <strong>{title}</strong>
                  <small>
                    {author ? `${author} · ` : ''}
                    {b.pageCount} leaves
                    {partly ? ` · ${b.read} of ${b.pageCount} already transcribed` : ''}
                  </small>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="queue-picker-actions">
        <button
          type="button"
          className="primary"
          disabled={chosen.length === 0}
          onClick={() => onRead(chosen.map((b) => b.key))}
        >
          {adding ? 'Add' : 'Read'} {chosen.length} {chosen.length === 1 ? 'scan' : 'scans'}
          {leaves > 0 ? ` · ${leaves} leaves` : ''}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
