/**
 * Where the status notes live on the shelf, and what counts as a path on it.
 *
 * Every run of an agent leaves one note (`../work/note.ts`), in its own file,
 * so agents working at the same time never write the same file and a pull
 * never has two sessions' edits to merge. The file is named from the note
 * itself: the day the run started, the book, the role and the run's random
 * id. Two runs that start in the same second on the same book in the same
 * role differ in their id, and the command refuses to write over a file that
 * is already there, so a name can never be shared.
 *
 * Notes are sharded by the month the run started (`work/runs/2026-11/`), so
 * no folder grows past the 1,000 entries GitHub's contents listing returns:
 * at dozens of books a year, a month holds a few hundred runs.
 *
 * Pure: strings in, strings out. Kept apart from `shelf.ts`, which is near
 * its size limit; reached through `./index`.
 */

/** The shelf folder for the agents' own records. */
export const WORK_ROOT = 'work'
/** Where the status notes go, one file per run, sharded by month. */
export const RUNS_ROOT = `${WORK_ROOT}/runs`
/** What a note's file name says in place of a book, for tools or shelf work. */
export const NO_BOOK = 'no-book'
/** The longest path on the shelf a note may name. */
export const MAX_SHELF_PATH = 300

const RUN_ID = /^[a-z0-9]{8}$/u
const ROLE_SLUG = /^[a-z][a-z-]{0,29}$/u
const BOOK_FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u
const UTC_DAY = /^(\d{4})-(\d{2})-(\d{2})T/u
// Characters that are fine in a shelf path: letters, digits, space and the
// punctuation the shelf's own names use. No backslash, colon, "=" (it parts a
// link's label from its path in `work.mjs ask --where`) or control code.
const PATH_SEGMENT = /^[A-Za-z0-9_ .,()'&+~-]+$/u

/** Why `id` is not a run id, or null when it is. */
export function runIdProblem(id: string): string | null {
  return RUN_ID.test(id)
    ? null
    : `"${id}" is not a run id: a run id is eight lower-case letters and digits, as "start" prints it.`
}

/** Why `folder` cannot be a book's folder under `books/`, or null when it can. */
export function bookFolderProblem(folder: string): string | null {
  if (folder === NO_BOOK) return `"${NO_BOOK}" is kept for runs with no book; it cannot name one.`
  return BOOK_FOLDER.test(folder) && !folder.includes('..')
    ? null
    : `"${folder}" is not a book folder: give the folder's own name under books/, as "Author-Title-abc123", with no slashes.`
}

/**
 * Why `path` is not a path on the shelf a note may name, or null when it is.
 * Relative to the shelf's top, with forward slashes, never leaving it: a link
 * the Workroom opens must land on the shelf and nowhere else. Never into a
 * `.git` folder either (in any case, as Windows reads it): that is git's own
 * store, not a file of the shelf's.
 */
export function shelfPathProblem(path: string): string | null {
  const why = (reason: string) => `"${path}" is not a path on the shelf: ${reason}`
  if (path.length === 0) return why('it is empty.')
  if (path.length > MAX_SHELF_PATH) return why(`it is longer than ${MAX_SHELF_PATH} characters.`)
  if (path.includes('\\')) return why('use forward slashes, as books/<folder>/queries.md.')
  if (path.startsWith('/') || /^[A-Za-z]:/u.test(path) || path.includes('://')) {
    return why("give it from the shelf's top, as books/<folder>/queries.md, not as a full path.")
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      return why('it has an empty, "." or ".." part.')
    }
    if (segment.toLowerCase() === '.git') {
      return why("it reaches into a .git folder, which is git's own store, not a file to open.")
    }
    if (!PATH_SEGMENT.test(segment) || segment.trim() !== segment) {
      return why(`the part "${segment}" holds a character a shelf path does not use.`)
    }
  }
  return null
}

/** The UTC day a time falls on, as `[yyyy, mm, dd]`. Throws on a time not in UTC form. */
function utcDay(at: string): [string, string, string] {
  const m = UTC_DAY.exec(at)
  if (!m) throw new Error(`"${at}" is not a UTC time such as 2026-11-19T14:05:00Z.`)
  return [m[1]!, m[2]!, m[3]!]
}

/** What a note's file name is made of; `book` is null for a run with no book. */
export interface NoteName {
  id: string
  role: string
  book: string | null
  startedAt: string
}

/**
 * The shelf path of a run's note:
 * `work/runs/<yyyy-mm>/<yyyy-mm-dd>-<book>-<role>-<id>.json`, with `no-book`
 * for a run with no book. Throws on a part that cannot go in a name.
 */
export function statusNotePath(note: NoteName): string {
  const idWhy = runIdProblem(note.id)
  if (idWhy) throw new Error(idWhy)
  if (!ROLE_SLUG.test(note.role)) throw new Error(`"${note.role}" is not a role's name.`)
  if (note.book !== null) {
    const bookWhy = bookFolderProblem(note.book)
    if (bookWhy) throw new Error(bookWhy)
  }
  const [y, m, d] = utcDay(note.startedAt)
  const book = note.book ?? NO_BOOK
  return `${RUNS_ROOT}/${y}-${m}/${y}-${m}-${d}-${book}-${note.role}-${note.id}.json`
}

/** The month folder a run's note goes in, `work/runs/<yyyy-mm>`. */
export function runsMonthPath(startedAt: string): string {
  const [y, m] = utcDay(startedAt)
  return `${RUNS_ROOT}/${y}-${m}`
}

/**
 * The run id a note's file name ends in, or null when the path is not a
 * note's (so a stray file in `work/runs/` is passed over, not misread).
 */
export function runIdOfPath(path: string): string | null {
  const m = /(?:^|\/)work\/runs\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}-.+-([a-z0-9]{8})\.json$/u.exec(
    path.replace(/\\/gu, '/')
  )
  return m ? m[1]! : null
}

/** A name for a link to a sheet the owner knows by name; else the file's own name. */
export function linkLabel(path: string): string {
  const name = path.split('/').pop() ?? path
  return SHEET_LABELS[name] ?? name
}

const SHEET_LABELS: Record<string, string> = {
  'queries.md': 'Questions sheet',
  'readiness.md': 'Readiness report',
  'introduction.md': 'Introduction draft',
  'glossary.md': 'Glossary',
  'notes.md': 'Notes',
  'ledger.md': 'Ledger',
  'proposals.md': 'Proposals',
  'review.md': 'Review sheet',
  'rulings.md': 'Rulings',
  'KDP-listings.md': 'KDP listings'
}
