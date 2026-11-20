/**
 * The Workroom's pieces: a job's card, a waiting item, a book's row with its
 * spine and step strip, and a role's column. Every figure and grouping comes
 * from core (`@core/work`); these only draw it, in the approved look.
 */
import { describeAge } from '@core/project'
import {
  ROLE_LABELS,
  STAGE_LABELS,
  SHOWN_LABELS,
  bookName,
  stageStrip,
  type BookView,
  type OwnerLink,
  type Progress,
  type RoleView,
  type RunView,
  type Shown
} from '@core/work'
import { Emblem, ROLE_LOOK, spineColor } from './workroom-emblems'

/** What a tap on a job or a link does, handed down from the screen. */
export interface WorkroomActions {
  openRun: (id: string) => void
  openPath: (path: string) => void
}

/** A book's title for a card, or the plain words for tools work. */
export function runTitle(run: Pick<RunView, 'book'>): string {
  return run.book ? bookName(run.book).title : 'Tools and shelf work'
}

export function progressWords(p: Progress): string {
  return `${p.done} of ${p.total} ${p.unit}`
}

const PILL: Readonly<Record<Shown, string>> = {
  working: 'run',
  stale: 'stale',
  waiting: 'ask',
  done: 'ok',
  failed: 'bad',
  'handed-off': 'hand'
}

export function Pill({ shown, extra }: { shown: Shown; extra?: string }): JSX.Element {
  return (
    <span className={`wr-pill wr-pill-${PILL[shown]}`}>
      {/* A stale run's pill says how long it has been quiet, so "stale" alone. */}
      {extra && shown === 'stale' ? 'stale' : SHOWN_LABELS[shown]}
      {extra ? ` · ${extra}` : ''}
    </span>
  )
}

export function Bar({ progress }: { progress: Progress }): JSX.Element {
  const share = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0
  return (
    <>
      <div className="wr-bar" role="progressbar" aria-valuenow={Math.round(share * 100)}>
        <i style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <div className="wr-m2">{progressWords(progress)}</div>
    </>
  )
}

/** When a job last said anything, in the words a pill carries. */
function lastWord(run: RunView, now: number): string {
  const at = run.finishedAt ?? run.updatedAt
  if (run.shown === 'stale') return `no word for ${run.quietHours} hours`
  if (run.shown === 'working') return `since ${clock(run.startedAt, now)}`
  return describeAge(at, new Date(now))
}

/** "10:14" today, "18 Nov" before. */
export function clock(at: string, now: number): string {
  const d = new Date(at)
  const today = new Date(now).toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function LinkChips({
  links,
  act
}: {
  links: readonly OwnerLink[]
  act: WorkroomActions
}): JSX.Element {
  return (
    <span className="wr-links">
      {links.map((l) => (
        <button
          key={l.path}
          type="button"
          className="wr-link"
          title={l.path}
          onClick={(e) => {
            e.stopPropagation()
            act.openPath(l.path)
          }}
        >
          {l.label}
        </button>
      ))}
    </span>
  )
}

/** One job, as a role's column or a book's row shows it; a tap opens its detail. */
export function RunCard({
  run,
  now,
  act
}: {
  run: RunView
  now: number
  act: WorkroomActions
}): JSX.Element {
  return (
    <button
      type="button"
      className={`wr-card wr-card-${run.shown}`}
      data-run={run.id}
      onClick={() => act.openRun(run.id)}
    >
      {run.stage ? <div className="wr-stage">{STAGE_LABELS[run.stage]}</div> : null}
      <div className="wr-t">{runTitle(run)}</div>
      <div className="wr-s">{run.job}</div>
      {run.progress && run.shown !== 'done' ? <Bar progress={run.progress} /> : null}
      {run.result && run.shown !== 'working' ? <div className="wr-result">{run.result}</div> : null}
      <Pill shown={run.shown} extra={lastWord(run, now)} />
    </button>
  )
}

/** One job waiting on the owner: what is needed, and the files to open. */
export function AskItem({
  run,
  now,
  act
}: {
  run: RunView
  now: number
  act: WorkroomActions
}): JSX.Element {
  return (
    <div className="wr-ask" data-run={run.id}>
      <button type="button" className="wr-ask-open" onClick={() => act.openRun(run.id)}>
        <b>{runTitle(run)}:</b> {run.owner?.what ?? run.job}
        <span className="wr-ask-m">
          from the {ROLE_LABELS[run.role].toLowerCase()} · waiting{' '}
          {describeAge(run.updatedAt, new Date(now))}
        </span>
      </button>
      {run.owner ? <LinkChips links={run.owner.links} act={act} /> : null}
    </div>
  )
}

/** A book: its spine, its stage, the strip of eight steps and its latest jobs. */
export function BookRow({
  book,
  now,
  act
}: {
  book: BookView
  now: number
  act: WorkroomActions
}): JSX.Element {
  const name = bookName(book.book)
  return (
    <div className="wr-book" data-book={book.book}>
      <div className="wr-spine" style={{ background: spineColor(book.book) }} />
      <div className="wr-book-body">
        <div className="wr-t">{name.title}</div>
        <div className="wr-m">
          {name.author ? `${name.author} · ` : ''}
          {STAGE_LABELS[book.stage].toLowerCase()} · {SHOWN_LABELS[book.shown]}
          {book.waiting > 0 && book.shown !== 'waiting' ? ` · ${book.waiting} waiting on you` : ''}
        </div>
        <div className="wr-steps" aria-label={`Stage: ${STAGE_LABELS[book.stage]}`}>
          {stageStrip(book).map((s) => (
            <i key={s.stage} className={`wr-step-${s.mark}`} title={STAGE_LABELS[s.stage]} />
          ))}
        </div>
        <ul className="wr-latest">
          {book.latest.slice(0, 3).map((run) => (
            <li key={run.id}>
              <button type="button" data-run={run.id} onClick={() => act.openRun(run.id)}>
                <span className={`wr-dot wr-dot-${run.shown}`} />
                {ROLE_LABELS[run.role]}: {run.job}
                <span className="wr-when"> · {describeAge(run.updatedAt, new Date(now))}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** A role's column: its jobs in progress, work handed to it, and what it finished lately. */
export function RoleLane({
  lane,
  now,
  act
}: {
  lane: RoleView
  now: number
  act: WorkroomActions
}): JSX.Element {
  const empty = lane.inProgress.length + lane.awaiting.length + lane.recent.length === 0
  return (
    <section className="wr-lane" data-role={lane.role}>
      <div className="wr-who">
        <Emblem role={lane.role} />
        <div>
          <h2>{lane.label}</h2>
          <small>{ROLE_LOOK[lane.role].blurb}</small>
        </div>
      </div>
      {lane.inProgress.map((run) => (
        <RunCard key={run.id} run={run} now={now} act={act} />
      ))}
      {lane.awaiting.length > 0 ? <h3>Handed over, not yet picked up</h3> : null}
      {lane.awaiting.map((run) => (
        <button
          key={run.id}
          type="button"
          className="wr-card wr-card-awaiting"
          data-run={run.id}
          onClick={() => act.openRun(run.id)}
        >
          <div className="wr-t">{runTitle(run)}</div>
          <div className="wr-s">
            From the {ROLE_LABELS[run.role].toLowerCase()}: {run.handoff?.note ?? run.result}
          </div>
          <span className="wr-pill wr-pill-hand">
            waiting to be picked up · {describeAge(run.updatedAt, new Date(now))}
          </span>
        </button>
      ))}
      {lane.recent.length > 0 ? <h3>Finished this week</h3> : null}
      {lane.recent.map((run) => (
        <RunCard key={run.id} run={run} now={now} act={act} />
      ))}
      {empty ? <p className="wr-quiet">Nothing in hand.</p> : null}
    </section>
  )
}
