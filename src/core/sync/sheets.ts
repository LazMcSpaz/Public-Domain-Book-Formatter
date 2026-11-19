/**
 * Where the sheets made from a book go, and the one place they never may.
 *
 * The driver writes Markdown sheets out of a book — the queries, the rulings,
 * the review, the proposals, the damage and parallels lists, the sense review
 * — and every one of them quotes the book. They used to default to a bare file
 * name, which the driver resolved against the tools repository's own root. On
 * the first book run through the new setup that put three sheets quoting a
 * book at the top of a **public** repository, one `git add -A` from being
 * published. A sheet belongs beside its book, in the book's own
 * folder on the shelf, and a sheet that cannot tell where that is must refuse
 * rather than fall back to the working directory.
 *
 * Paths come in two spellings: the owner also runs the tools on Windows, so
 * `C:\Users\…\books\X\book.json` is as real as `/home/…/books/X/book.json`.
 * Everything here reads both and keeps whichever it was given.
 *
 * Pure: strings in, strings out. The driver supplies the paths and does the
 * writing; reached through `shelf.ts`, the one map of the shelf.
 */

/** A sheet's own name: one path segment, never `.`, `..` or a folder. */
const SHEET_NAME = /^[\w-][\w.-]*$/u

/** Where the last folder separator in a path is, either spelling, or -1. */
function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
}

/**
 * The path of a sheet beside the book file it was made from.
 *
 * `bookFile` is the `book.json` the book was loaded from. The result is in the
 * same folder, with the same separator, so a Windows path stays one. A book
 * file given with no folder at all yields the bare sheet name: beside it, in
 * whatever directory it was named from.
 */
export function sheetPath(bookFile: string, sheet: string): string {
  if (!SHEET_NAME.test(sheet)) {
    throw new Error(`“${sheet}” is not a sheet name: a sheet goes beside its book, not elsewhere.`)
  }
  return bookFile.slice(0, lastSeparator(bookFile) + 1) + sheet
}

/**
 * The name of the folder a file sits in — for a book, the `<folder>` of
 * `books/<folder>/book.json`. This, not a name computed from the run's key, is
 * what a reported shelf path must use: nine of the shelf's books sit in a
 * folder a person renamed, and a key carries whatever the scan was called on
 * the machine that read it. Null when the path names no folder.
 */
export function bookFolder(path: string): string | null {
  const parts = path.split(/[\\/]+/u).filter((p) => p !== '' && p !== '.')
  return parts.length >= 2 ? (parts[parts.length - 2] ?? null) : null
}

/** A path as segments, `.` and `..` settled and case folded, for comparing. */
function segments(path: string): string[] {
  const out: string[] = []
  for (const part of path.split(/[\\/]+/u)) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part.toLowerCase())
  }
  return out
}

/**
 * Whether `path` is `folder` or anything under it.
 *
 * Segment by segment, so `tools-shelf` is not inside `tools`. Case is folded
 * on every system: Windows and a Mac's default disk ignore it, and on a disk
 * that does not, the cost is a refusal where a write would have been safe —
 * the right side to be wrong on. Both paths should be absolute.
 */
export function insideFolder(path: string, folder: string): boolean {
  const at = segments(path)
  const root = segments(folder)
  return root.length <= at.length && root.every((s, i) => s === at[i])
}

/**
 * Why a sheet may not be written at `target`, or null when it may.
 *
 * Refused anywhere inside the tools repository (`toolsRoot`), because that
 * repository is public and a sheet quotes the book. The message names the
 * folder the sheet belongs in when the book file is known.
 */
export function sheetRefusal(
  target: string,
  toolsRoot: string,
  bookFile: string | null
): string | null {
  if (!insideFolder(target, toolsRoot)) return null
  const home = bookFile === null ? '' : bookFile.slice(0, Math.max(0, lastSeparator(bookFile)))
  return (
    `Refusing to write ${target}: that is inside the tools repository (${toolsRoot}), ` +
    'which is public, and this sheet quotes the book. ' +
    (home
      ? `It belongs beside the book, in ${home}: run the command with no output path.`
      : "It belongs beside the book, in the book's own folder on the shelf.")
  )
}

/**
 * The refusal for a sheet asked for when no book file is known: the book was
 * opened from a scan, or stored by an earlier session, and never loaded from
 * a `book.json`. `shelfFolder` is the shelf folder holding a book with this
 * key, when a checkout of the shelf says so.
 */
export function sheetNeedsBook(sheet: string, shelfFolder: string | null): string {
  const folder = shelfFolder ?? '<folder>'
  return (
    `No book file is known for this book, so there is no folder beside it to write ${sheet} ` +
    `in. Load it from the shelf first: \`load <shelf>/books/${folder}/book.json ` +
    '<shelf>/scans/<scan>.pdf`' +
    (shelfFolder ? ` (the shelf holds this book in books/${shelfFolder}/)` : '') +
    ', or name an output path outside the tools repository.'
  )
}
