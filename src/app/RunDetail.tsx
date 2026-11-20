/**
 * One job's detail in the Workroom: its timeline, how far it has got, what
 * came of it, what it waits on, the files it left, the job it took over from
 * and whom it handed to. Opened by a tap on any card; read-only.
 */
import { useEffect } from 'react'
import {
  ROLE_LABELS,
  SHOWN_LABELS,
  STAGE_LABELS,
  bookName,
  type RunView,
  type StatusNote
} from '@core/work'
import { linkLabel } from '@core/sync'
import { Emblem } from './workroom-emblems'
import {
  Bar,
  LinkChips,
  Pill,
  progressWords,
  runTitle,
  type WorkroomActions
} from './WorkroomCards'

export interface RunDetailProps {
  view: RunView
  note: StatusNote
  /** Every run on the shelf by id, to name the ones this one links to. */
  runs: ReadonlyMap<string, RunView>
  now: number
  act: WorkroomActions
  onClose: () => void
}

/** "Thu 19 Nov, 14:05", in the device's own words. */
function when(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function RunDetail({ view, note, runs, act, onClose }: RunDetailProps): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const other = (id: string): JSX.Element => {
    const run = runs.get(id)
    if (!run) return <span>run {id} (its note is not on the shelf)</span>
    return (
      <button type="button" className="wr-inline-link" onClick={() => act.openRun(id)}>
        {ROLE_LABELS[run.role]}: {run.job}
      </button>
    )
  }
  const files = note.files.map((path) => ({ label: linkLabel(path), path }))

  return (
    <div className="wr-overlay" role="dialog" aria-modal="true" aria-label="A job in detail">
      <div className="wr-backdrop" onClick={onClose} />
      <article className="wr-sheet wr-detail" data-detail={view.id}>
        <header className="wr-sheet-head">
          <Emblem role={view.role} size="large" />
          <div className="wr-sheet-title">
            <small>{ROLE_LABELS[view.role]}</small>
            <h2>{view.job}</h2>
          </div>
          <button type="button" className="wr-close" onClick={onClose}>
            Close
          </button>
        </header>

        <p className="wr-detail-book">
          {runTitle(view)}
          {view.book && bookName(view.book).author ? `, ${bookName(view.book).author}` : ''}
          {view.stage ? ` · ${STAGE_LABELS[view.stage]}` : ''}
          {view.book ? <code>{view.book}</code> : null}
        </p>
        <p>
          <Pill shown={view.shown} />{' '}
          <span className="wr-m2">
            started {when(view.startedAt)} · last word {when(view.updatedAt)}
            {view.finishedAt ? ` · finished ${when(view.finishedAt)}` : ''}
          </span>
        </p>
        {view.shown === 'stale' ? (
          <p className="wr-warn">
            It says it is working but has said nothing for {view.quietHours} hours: its session has
            most likely stopped. The managing editor closes it, or its session does if it comes
            back.
          </p>
        ) : null}
        {view.progress ? <Bar progress={view.progress} /> : null}

        {view.owner ? (
          <div className="wr-needs">
            <b>Waiting on you:</b> {view.owner.what}
            <LinkChips links={view.owner.links} act={act} />
          </div>
        ) : null}
        {view.result ? (
          <p className="wr-detail-result">
            <b>What came of it:</b> {view.result}
          </p>
        ) : null}
        {files.length > 0 ? (
          <div className="wr-detail-files">
            <b>Files it left:</b> <LinkChips links={files} act={act} />
          </div>
        ) : null}
        {view.from ? (
          <p>
            <b>Took over from:</b> {other(view.from)}
          </p>
        ) : null}
        {view.handoff ? (
          <p>
            <b>Handed to:</b> the {ROLE_LABELS[view.handoff.role].toLowerCase()}
            {view.handoff.note ? `, “${view.handoff.note}”` : ''}.{' '}
            {view.handoff.pickedUpBy ? (
              <>Picked up by {other(view.handoff.pickedUpBy)}</>
            ) : (
              <>Not picked up yet.</>
            )}
          </p>
        ) : null}
        {view.followedBy.length > 0 && !view.handoff ? (
          <p>
            <b>Carried on by:</b>{' '}
            {view.followedBy.map((id, i) => (
              <span key={id}>
                {i > 0 ? ', ' : ''}
                {other(id)}
              </span>
            ))}
          </p>
        ) : null}

        <h3>Timeline</h3>
        <ol className="wr-timeline">
          {note.history.map((event, i) => (
            <li key={i} className={`wr-event wr-event-${event.state}`}>
              <span className="wr-event-at">{when(event.at)}</span>
              <span className="wr-event-state">
                {i === 0 ? 'started' : SHOWN_LABELS[event.state]}
              </span>
              {event.note ? <span className="wr-event-note">{event.note}</span> : null}
              {event.progress ? (
                <span className="wr-event-note">{progressWords(event.progress)}</span>
              ) : null}
              {event.owner ? (
                <span className="wr-event-note">Asked you: {event.owner.what}</span>
              ) : null}
            </li>
          ))}
        </ol>

        <p className="wr-path">
          The note itself:{' '}
          <button type="button" className="wr-inline-link" onClick={() => act.openPath(view.path)}>
            {view.path}
          </button>
        </p>
      </article>
    </div>
  )
}
