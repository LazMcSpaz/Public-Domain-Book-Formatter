/**
 * The small figures the Workroom screen shows beside its three views: the
 * counts strip, a book's strip of eight steps, and a book's name read off its
 * folder. The views themselves (grouping, order, stale) are `./workroom.ts`;
 * these only count and label what it gives, so the screen holds no rule of
 * its own.
 *
 * Pure: notes and the time in, figures out.
 */
import { STAGES, type Stage, type StatusNote } from './vocab'
import { workroom, type BookView, type WorkroomOptions } from './workroom'

export interface WorkroomCounts {
  /** Runs waiting on the owner. */
  waiting: number
  /** Runs working and not stale: the agents at work now. */
  atWork: number
  /** Runs that say "working" but have said nothing for too long. */
  stale: number
  /** Books not yet published, or with work still live on them. */
  booksInProgress: number
  /** Runs finished as done in the last `recentDays` (a week by default). */
  doneThisWeek: number
}

/** The counts strip. Every run is counted once: each has exactly one role. */
export function workroomCounts(
  notes: readonly StatusNote[],
  now: string,
  options: Omit<WorkroomOptions, 'recentPerRole'> = {}
): WorkroomCounts {
  const room = workroom(notes, now, { ...options, recentPerRole: Number.POSITIVE_INFINITY })
  const live = room.roles.flatMap((r) => r.inProgress)
  return {
    waiting: room.waiting.length,
    atWork: live.filter((r) => r.shown === 'working').length,
    stale: live.filter((r) => r.shown === 'stale').length,
    booksInProgress: room.books.filter(inProgress).length,
    doneThisWeek: room.roles.flatMap((r) => r.recent).filter((r) => r.shown === 'done').length
  }
}

/** A book is finished only when its current stage is "published" and that run is done. */
function inProgress(book: BookView): boolean {
  return !(book.stage === 'published' && book.shown === 'done')
}

/**
 * One step of a book's strip:
 * - `past`: a stage the book is beyond (or its last stage, finished);
 * - `now`: the stage the book stands at, still live or not finished well;
 * - `ahead`: a later stage already begun (writing often runs beside reading);
 * - `later`: not reached.
 */
export type StepMark = 'past' | 'now' | 'ahead' | 'later'

export interface Step {
  stage: Stage
  mark: StepMark
}

/** The eight steps of a book's strip, in the order of the work. */
export function stageStrip(book: BookView): Step[] {
  const at = STAGES.indexOf(book.stage)
  const begun = new Set(book.stages.map((s) => s.stage))
  return STAGES.map((stage, i): Step => {
    if (i < at) return { stage, mark: 'past' }
    if (i === at) return { stage, mark: book.shown === 'done' ? 'past' : 'now' }
    return { stage, mark: begun.has(stage) ? 'ahead' : 'later' }
  })
}

/** A book's name for the screen, read off its folder; the folder itself is always shown too. */
export interface BookName {
  title: string
  author: string | null
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or'])
const MORE_SMALL = new Set(['the', 'to', 'with', 'from', 'into'])

/**
 * "SwamiPanchadasi-ClairvoyanceAndOccultPowers-10r8edv" reads as
 * "Clairvoyance and Occult Powers" by "Swami Panchadasi": the shelf's
 * folders are `Author-Title-id`, with the words run together. The id at the
 * end (lower-case letters and digits) is dropped; the first part is taken as
 * the author when it starts with a capital and a title follows. A folder in
 * another form is shown as its words, never guessed at further.
 */
export function bookName(folder: string): BookName {
  const parts = folder.split('-').filter((p) => p !== '')
  if (parts.length > 1 && /^[a-z0-9]{3,8}$/u.test(parts[parts.length - 1]!)) parts.pop()
  const authored = parts.length > 1 && /^[A-Z]/u.test(parts[0]!)
  const author = authored ? words(parts.shift()!).join(' ') : null
  const title = parts
    .flatMap(words)
    .map((w, i) => {
      const lower = w.toLowerCase()
      if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1)
      return SMALL_WORDS.has(lower) || MORE_SMALL.has(lower) ? lower : w
    })
    .join(' ')
  return { title: title || folder, author }
}

/** "TheLettersToAPSinnett" as ["The", "Letters", "To", "AP", "Sinnett"]. */
function words(run: string): string[] {
  return run
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/gu, '$1 $2')
    .replace(/[_.]+/gu, ' ')
    .split(' ')
    .filter((w) => w !== '')
}
