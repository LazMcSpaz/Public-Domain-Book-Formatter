/**
 * What the Workroom shows, read off many status notes.
 *
 * Three views, as the owner asked on 19 November 2026:
 *
 * 1. **Waiting on you**: every run waiting on the owner, the longest waiting
 *    first, with what he must do and the files to open.
 * 2. **Books**: each book's current stage and how it stands there, the
 *    latest run at every stage it has reached, and its latest runs.
 * 3. **Roles**: each role's runs in progress, its runs finished lately, and
 *    work handed to it that no run has picked up yet.
 *
 * A run that has said nothing for `staleAfterHours` while "working" is shown
 * as **stale**, never as working: its session most likely stopped without
 * saying so, and a board that shows dead work as live is the one report this
 * screen must never make. A waiting run is never stale; the owner may take
 * days to answer, and it stays in his list until it is moved on.
 *
 * **A book's current stage** is the earliest stage that still has a live run
 * (working, waiting or stale), because a book is not past a stage still
 * being worked; when nothing is live, the furthest stage with any run.
 *
 * A hand-off is **picked up** by a run of the role it went to that started
 * at or after the hand-off and names it as `from`, or by the run of that
 * role the hand-off itself named, when that run is on the shelf. A run of
 * another role that names it (Etsu starting from a reader's run, say), or one
 * that started before the hand-off, takes nothing off the role's list.
 *
 * Pure: notes and the time in, the views out.
 */
import {
  ROLES,
  ROLE_LABELS,
  STAGES,
  type Handoff,
  type Role,
  type Stage,
  type StatusNote
} from './vocab'
import { statusNotePath } from '../sync/work-paths'
import { timeOrder } from './fields'

export const STALE_AFTER_HOURS = 12
export const RECENT_DAYS = 7

/** How a run is shown: its state, with "working" split into working and stale. */
export type Shown = 'working' | 'stale' | 'waiting' | 'done' | 'failed' | 'handed-off'

export const SHOWN_LABELS: Readonly<Record<Shown, string>> = {
  working: 'working',
  stale: 'stale (no word for a long time)',
  waiting: 'waiting on you',
  done: 'done',
  failed: 'failed',
  'handed-off': 'handed off'
}

const LIVE: readonly Shown[] = ['working', 'stale', 'waiting']

export interface RunView extends Omit<StatusNote, 'format' | 'version' | 'history' | 'handoff'> {
  /** Where the note is on the shelf. */
  path: string
  shown: Shown
  /** Whole hours since the run last said anything. */
  quietHours: number
  handoff: (Handoff & { pickedUpBy: string | null }) | null
  /** The runs that name this one as `from`. */
  followedBy: string[]
  /** The runs whose hand-off this one picked up. */
  pickedUp: string[]
  events: number
}

export interface StageRow {
  stage: Stage
  /** Waiting if any run here waits, else working, else stale, else the latest run's outcome. */
  shown: Shown
  latest: RunView
  runs: number
  live: number
}

export interface BookView {
  book: string
  stage: Stage
  shown: Shown
  /** Every stage that has runs, in the order of the work. */
  stages: StageRow[]
  /** The book's latest runs, newest first. */
  latest: RunView[]
  /** How many of its runs wait on the owner. */
  waiting: number
  updatedAt: string
}

export interface RoleView {
  role: Role
  label: string
  /** Working, stale or waiting; newest first. */
  inProgress: RunView[]
  /** Finished in the last `recentDays`; newest first. */
  recent: RunView[]
  /** Handed to this role and not yet picked up; oldest first. */
  awaiting: RunView[]
}

export interface Workroom {
  now: string
  waiting: RunView[]
  books: BookView[]
  roles: RoleView[]
}

export interface WorkroomOptions {
  staleAfterHours?: number
  recentDays?: number
  latestPerBook?: number
  recentPerRole?: number
}

const HOUR = 3600 * 1000

export function workroom(
  notes: readonly StatusNote[],
  now: string,
  options: WorkroomOptions = {}
): Workroom {
  const recentFrom = Date.parse(now) - (options.recentDays ?? RECENT_DAYS) * 24 * HOUR
  const runs = runViews(notes, now, options)
  const newest = (a: RunView, b: RunView) => timeOrder(b.updatedAt, a.updatedAt) || cmp(a.id, b.id)
  const oldest = (a: RunView, b: RunView) => timeOrder(a.updatedAt, b.updatedAt) || cmp(a.id, b.id)

  const waiting = runs.filter((r) => r.shown === 'waiting').sort(oldest)

  const byBook = new Map<string, RunView[]>()
  for (const run of runs) {
    if (run.book === null) continue
    byBook.set(run.book, [...(byBook.get(run.book) ?? []), run])
  }
  const books = [...byBook].map(([book, list]) =>
    bookView(book, list.sort(newest), options.latestPerBook ?? 5)
  )
  books.sort((a, b) => timeOrder(b.updatedAt, a.updatedAt) || cmp(a.book, b.book))

  const roles = ROLES.map((role): RoleView => {
    const own = runs.filter((r) => r.role === role)
    return {
      role,
      label: ROLE_LABELS[role],
      inProgress: own.filter((r) => LIVE.includes(r.shown)).sort(newest),
      recent: own
        .filter((r) => r.finishedAt !== null && Date.parse(r.finishedAt) >= recentFrom)
        .sort((a, b) => timeOrder(b.finishedAt!, a.finishedAt!) || cmp(a.id, b.id))
        .slice(0, options.recentPerRole ?? 10),
      awaiting: runs
        .filter((r) => r.handoff?.role === role && r.handoff.pickedUpBy === null)
        .sort(oldest)
    }
  })
  return { now, waiting, books, roles }
}

/** What `filterWorkroom` keeps: one book, one role, or both. */
export interface WorkroomFilter {
  book?: string | null
  role?: Role | null
}

/**
 * The three views narrowed to one book or one role, as `work.mjs list
 * --book` and `--role` show them, in text and in JSON alike. Waiting runs
 * and each role's own runs are kept when they are of that book and role; a
 * book is kept when one of its latest runs is; work handed to a role is kept
 * when it is of that book.
 */
export function filterWorkroom(room: Workroom, only: WorkroomFilter): Workroom {
  const { book, role } = only
  if (!book && !role) return room
  const keep = (r: RunView) => (!book || r.book === book) && (!role || r.role === role)
  return {
    now: room.now,
    waiting: room.waiting.filter(keep),
    books: room.books.filter((b) => (!book || b.book === book) && (!role || b.latest.some(keep))),
    roles: room.roles
      .filter((r) => !role || r.role === role)
      .map((r) => ({
        ...r,
        inProgress: r.inProgress.filter(keep),
        recent: r.recent.filter(keep),
        awaiting: r.awaiting.filter((x) => !book || x.book === book)
      }))
  }
}

/** One note per run id: where a copy exists, the one changed last. */
function latestCopies(notes: readonly StatusNote[]): StatusNote[] {
  const byId = new Map<string, StatusNote>()
  for (const note of notes) {
    const had = byId.get(note.id)
    if (!had || timeOrder(note.updatedAt, had.updatedAt) > 0) byId.set(note.id, note)
  }
  return [...byId.values()]
}

/**
 * Every run as the Workroom shows it, one per run id: stale or not, whether
 * its hand-off was picked up (by a run of the role it went to, as the head
 * of this file says), and which runs took it over.
 */
export function runViews(
  all: readonly StatusNote[],
  at: string,
  options: Pick<WorkroomOptions, 'staleAfterHours'> = {}
): RunView[] {
  const notes = latestCopies(all)
  const now = Date.parse(at)
  const staleAfter = options.staleAfterHours ?? STALE_AFTER_HOURS
  const byNoteId = new Map(notes.map((n) => [n.id, n]))
  const followers = new Map<string, StatusNote[]>()
  for (const note of notes) {
    if (note.from) followers.set(note.from, [...(followers.get(note.from) ?? []), note])
  }
  const views = notes.map((note): RunView => {
    const { format: _f, version: _v, history, handoff, ...rest } = note
    const quietHours = Math.max(0, Math.floor((now - Date.parse(note.updatedAt)) / HOUR))
    const after = (followers.get(note.id) ?? []).sort(
      (a, b) => timeOrder(a.startedAt, b.startedAt) || cmp(a.id, b.id)
    )
    const ofRole = (n: StatusNote | undefined) => !!handoff && n?.role === handoff.role
    const named = handoff?.run && ofRole(byNoteId.get(handoff.run)) ? handoff.run : null
    const taker = after.find((n) => ofRole(n) && timeOrder(n.startedAt, note.updatedAt) >= 0)
    return {
      ...rest,
      path: statusNotePath(note),
      shown: note.state === 'working' && quietHours >= staleAfter ? 'stale' : note.state,
      quietHours,
      handoff: handoff ? { ...handoff, pickedUpBy: named ?? taker?.id ?? null } : null,
      followedBy: after.map((n) => n.id),
      pickedUp: [],
      events: history.length
    }
  })
  const byId = new Map(views.map((v) => [v.id, v]))
  for (const v of views) {
    const taker = v.handoff?.pickedUpBy ? byId.get(v.handoff.pickedUpBy) : undefined
    if (taker) taker.pickedUp.push(v.id)
  }
  return views
}

function bookView(book: string, runs: RunView[], latestCount: number): BookView {
  const stages: StageRow[] = []
  for (const stage of STAGES) {
    const here = runs.filter((r) => r.stage === stage)
    if (here.length === 0) continue
    const live = here.filter((r) => LIVE.includes(r.shown))
    const pick = (s: Shown) => live.some((r) => r.shown === s)
    const shown: Shown = pick('waiting')
      ? 'waiting'
      : pick('working')
        ? 'working'
        : pick('stale')
          ? 'stale'
          : here[0]!.shown
    stages.push({ stage, shown, latest: here[0]!, runs: here.length, live: live.length })
  }
  const current = stages.find((s) => s.live > 0) ?? stages[stages.length - 1]!
  return {
    book,
    stage: current.stage,
    shown: current.shown,
    stages,
    latest: runs.slice(0, latestCount),
    waiting: runs.filter((r) => r.shown === 'waiting').length,
    updatedAt: runs[0]!.updatedAt
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
