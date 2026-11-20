/**
 * The Workroom: what the team of agents is doing, read live from the status
 * notes on the shelf (`docs/specs/workroom.md`), in the look the owner
 * approved on 19 November 2026 (`docs/specs/workroom-mockup.html`).
 *
 * What waits on the owner, where each book stands, each role's work, a job's
 * detail and the counts all come from core (`workroom`, `workroomCounts`,
 * `runViews`); this screen draws them and opens links. A questions sheet
 * opens that book's question screen through the app's own link
 * (`#book=<folder>&at=queries`); any other file opens in the reading view.
 * Read-only: the owner acts in a linked screen or by telling a session.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { describeAge } from '@core/project'
import { linkOpens, runViews, workroom, workroomCounts } from '@core/work'
import { loadShelf, shelfReady } from '../platform/browser/settings'
import { loadBookFace } from '../platform/browser/web-fonts'
import { RunDetail } from './RunDetail'
import { ShelfFileView } from './ShelfFileView'
import { AskItem, BookRow, RoleLane, type WorkroomActions } from './WorkroomCards'
import { useLiveNotes, type LiveNotes } from './workroom-live'
import './workroom.css'

export function Workroom({ onClose }: { onClose: () => void }): JSX.Element {
  const config = useMemo(() => {
    const c = loadShelf()
    return shelfReady(c) ? c : null
  }, [])
  const live = useLiveNotes(config)
  const [runId, setRunId] = useState<string | null>(null)
  const [file, setFile] = useState<string | null>(null)

  useEffect(() => {
    void loadBookFace('EB Garamond')
    void loadBookFace('Cardo')
    // The parchment reaches the page's edges, overscroll included.
    document.documentElement.dataset['workroom'] = 'on'
    return () => {
      delete document.documentElement.dataset['workroom']
    }
  }, [])

  const nowIso = new Date(live.now).toISOString()
  const room = useMemo(() => workroom(live.notes, nowIso), [live.notes, nowIso])
  const counts = useMemo(() => workroomCounts(live.notes, nowIso), [live.notes, nowIso])
  const runs = useMemo(
    () => new Map(runViews(live.notes, nowIso).map((r) => [r.id, r])),
    [live.notes, nowIso]
  )
  const notes = useMemo(() => new Map(live.notes.map((n) => [n.id, n])), [live.notes])

  const openPath = useCallback((path: string) => {
    const target = linkOpens(path)
    if (target.kind === 'queries') {
      window.location.hash = `#book=${encodeURIComponent(target.book)}&at=queries`
    } else {
      setFile(path)
    }
  }, [])
  const act: WorkroomActions = useMemo(() => ({ openRun: setRunId, openPath }), [openPath])
  const closeRun = useCallback(() => setRunId(null), [])
  const closeFile = useCallback(() => setFile(null), [])

  const empty = live.readAt !== null && live.notes.length === 0 && live.unreadable.length === 0
  const shownRun = runId ? runs.get(runId) : undefined
  const shownNote = runId ? notes.get(runId) : undefined

  return (
    <div className="wr">
      <div className="wr-band">
        <header className="wr-header">
          <button type="button" className="wr-back" onClick={onClose}>
            ‹ Shelf
          </button>
          <h1>THE WORKROOM</h1>
          <LiveLight live={live} hasShelf={config !== null} />
        </header>
        <div className="wr-stats">
          <Stat figure={counts.waiting} words="waiting on you" />
          <Stat
            figure={counts.atWork}
            words={counts.atWork === 1 ? 'agent at work' : 'agents at work'}
            note={counts.stale > 0 ? `${counts.stale} stale` : undefined}
          />
          <Stat
            figure={counts.booksInProgress}
            words={counts.booksInProgress === 1 ? 'book in progress' : 'books in progress'}
          />
          <Stat figure={counts.doneThisWeek} words="jobs finished this week" />
        </div>
        {live.error && live.readAt !== null ? <p className="wr-error">{live.error}</p> : null}
      </div>

      {!config ? (
        <div className="wr-empty">
          <p>No shelf is connected, so there are no notes to read.</p>
          <button type="button" onClick={() => (window.location.hash = '#settings')}>
            Connect a shelf
          </button>
        </div>
      ) : live.readAt === null && live.notes.length === 0 ? (
        <div className="wr-empty">
          <p>{live.error ?? 'Reading the shelf…'}</p>
        </div>
      ) : empty ? (
        <div className="wr-empty" data-empty="true">
          <p>No agent has reported yet. Notes appear here as the team works.</p>
        </div>
      ) : (
        <div className="wr-wrap">
          <aside className="wr-side">
            <section className="wr-panel wr-ask-panel" data-view="waiting">
              <h2>WAITING ON YOU</h2>
              {room.waiting.length === 0 ? (
                <p className="wr-ask-none">Nothing is waiting on you.</p>
              ) : (
                room.waiting.map((run) => (
                  <AskItem key={run.id} run={run} now={live.now} act={act} />
                ))
              )}
            </section>
            <section className="wr-panel wr-books" data-view="books">
              <h2>THE BOOKS</h2>
              {room.books.length === 0 ? (
                <p className="wr-quiet">No book has a note yet.</p>
              ) : (
                room.books.map((book) => (
                  <BookRow key={book.book} book={book} now={live.now} act={act} />
                ))
              )}
            </section>
          </aside>
          <div className="wr-board" data-view="roles">
            {room.roles.map((lane) => (
              <RoleLane key={lane.role} lane={lane} now={live.now} act={act} />
            ))}
          </div>
        </div>
      )}

      {config && live.unreadable.length > 0 ? (
        <section className="wr-unreadable" data-view="unreadable">
          <h2>Notes that could not be read</h2>
          <p className="wr-quiet">
            Each is left out of the views above. A session brings back the last copy that reads, or
            tells you what is wrong with it.
          </p>
          <ul>
            {live.unreadable.map((u) => (
              <li key={u.path}>
                <code>{u.path}</code>
                {u.problems.map((p, i) => (
                  <span key={i} className="wr-problem">
                    {p}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {shownRun && shownNote ? (
        <RunDetail
          view={shownRun}
          note={shownNote}
          runs={runs}
          now={live.now}
          act={act}
          onClose={closeRun}
        />
      ) : null}
      {file && config ? (
        <ShelfFileView config={config} path={file} openPath={openPath} onClose={closeFile} />
      ) : null}
    </div>
  )
}

function Stat({
  figure,
  words,
  note
}: {
  figure: number
  words: string
  note?: string
}): JSX.Element {
  return (
    <div className="wr-stat">
      <b>{figure}</b>
      <span>
        {words}
        {note ? <em> · {note}</em> : null}
      </span>
    </div>
  )
}

/** The live light and when the shelf was last read; amber while the last read failed. */
function LiveLight({ live, hasShelf }: { live: LiveNotes; hasShelf: boolean }): JSX.Element {
  if (!hasShelf) return <span className="wr-live">no shelf connected</span>
  const age = live.readAt
    ? describeAge(new Date(live.readAt).toISOString(), new Date(live.now))
    : null
  const state = live.error ? 'off' : age ? 'on' : 'wait'
  return (
    <span className={`wr-live wr-live-${state}`} data-live={state} title={live.error ?? undefined}>
      <span className="wr-dot-live" />
      {live.error
        ? age
          ? `could not reach the shelf · showing what was read ${age}`
          : 'could not reach the shelf'
        : age
          ? `live from the shelf · ${age}`
          : 'reading the shelf…'}
      <button type="button" className="wr-refresh" disabled={live.reading} onClick={live.refresh}>
        {live.reading ? 'Reading…' : 'Refresh'}
      </button>
    </span>
  )
}
