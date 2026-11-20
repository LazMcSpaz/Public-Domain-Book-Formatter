import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShelfConfig } from '@core/sync'
import type { StatusNote, UnreadableNote } from '@core/work'
import { notesFailure, type NotesFailure } from '../platform/browser/notes-failure'
import { deviceNoteCache, readWorkNotes, type NoteCache } from '../platform/browser/shelf-notes'

/**
 * The Workroom's live copy of the status notes: read from the shelf when the
 * screen opens, again every minute while it is on screen, and at once when
 * the page becomes visible again or the device comes back online.
 *
 * A read that fails keeps the last good copy on screen and says why; it never
 * blanks the board. Reads never overlap: a refresh asked for while one is on
 * its way is dropped, since the one on its way will bring the news.
 *
 * Each read is one request when nothing changed (`readWorkNotes` keeps notes
 * by blob sha, on the device too), so a minute is a gentle interval: an
 * hour of watching costs sixty small requests of GitHub's five thousand.
 * Nothing is read while the page is hidden (`npm run check:workroom` hides it
 * and waits).
 */
export const REFRESH_MS = 60_000
/** How often the "2 minutes ago" text and the stale rule look at the clock. */
const TICK_MS = 15_000

export interface LiveNotes {
  notes: StatusNote[]
  unreadable: UnreadableNote[]
  /** When the shelf was last read in full, or null before the first read. */
  readAt: number | null
  reading: boolean
  /** Why the last read failed, while the last good copy stays on screen. */
  error: NotesFailure | null
  /** The clock, ticking, for every time the screen shows. */
  now: number
  refresh: () => void
}

/** One cache for the page, so leaving the Workroom and coming back fetches nothing twice. */
let pageCache: NoteCache | null = null
const cache = (): NoteCache => (pageCache ??= deviceNoteCache())

export function useLiveNotes(config: ShelfConfig | null): LiveNotes {
  const [notes, setNotes] = useState<StatusNote[]>([])
  const [unreadable, setUnreadable] = useState<UnreadableNote[]>([])
  const [readAt, setReadAt] = useState<number | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<NotesFailure | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const busy = useRef(false)
  const alive = useRef(true)

  const refresh = useCallback(() => {
    if (!config || busy.current) return
    busy.current = true
    setReading(true)
    void readWorkNotes(config, cache())
      .then((read) => {
        if (!alive.current) return
        setNotes(read.notes)
        setUnreadable(read.unreadable)
        setReadAt(Date.now())
        setError(null)
      })
      .catch((err: unknown) => {
        if (alive.current) setError(notesFailure(err))
      })
      .finally(() => {
        busy.current = false
        if (!alive.current) return
        setReading(false)
        setNow(Date.now())
      })
  }, [config])

  useEffect(() => {
    alive.current = true
    // Only while the page is on screen: a hidden one reads when it is shown.
    const whenVisible = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    whenVisible()
    const every = window.setInterval(whenVisible, REFRESH_MS)
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS)
    document.addEventListener('visibilitychange', whenVisible)
    window.addEventListener('online', whenVisible)
    return () => {
      alive.current = false
      window.clearInterval(every)
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', whenVisible)
      window.removeEventListener('online', whenVisible)
    }
  }, [refresh])

  return { notes, unreadable, readAt, reading, error, now, refresh }
}
