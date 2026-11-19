/**
 * Where to look for a picture a book file names.
 *
 * A book file names each of its pictures by a path, `images/<digest>.png`, and
 * the question is what that path is relative to. The app writes a new picture
 * at the top of the shelf (`imagePath`), and it used to read every named
 * picture from there too. But 151 of the shelf's 152 pictures sit in their own
 * book's folder, beside the `book.json` that names them, so a book opened from
 * the shelf came down without its plates.
 *
 * So a name is read relative to the book first and to the top of the shelf
 * second. A picture is found in either layout, and the old place keeps working
 * until every book has moved (cleanup tasks 9, 10 and 15).
 *
 * Shelf paths are repository paths: forward slashes, no leading slash. A
 * backslash is read as a separator too, because the owner works on Windows and
 * a hand-edited name may carry one. A name that would leave the shelf, by
 * climbing out with `..` or by starting at the top of a disk or a server, is
 * never tried.
 *
 * Pure: strings in, strings out. The platform does the fetching; reached
 * through `shelf.ts`, the one map of the shelf.
 */

const SEPARATOR = /[\\/]+/u

/** A name that starts at the top of a disk (`/`, `\`, `C:`) or names a server (`https:`). */
const ABSOLUTE = /^(?:[\\/]|[A-Za-z][\w+.-]*:)/u

/** Segments with `.` and `..` settled, or null when they climb above the first. */
function settle(parts: readonly string[]): string[] | null {
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part !== '..') out.push(part)
    else if (out.pop() === undefined) return null
  }
  return out
}

/**
 * The shelf paths to try, in order, for a picture a book file names.
 *
 * `bookFile` is the book's own shelf path (`books/<folder>/book.json`), and
 * `picture` is the path the book names. The book's folder comes first, then
 * the top of the shelf; the same place is never listed twice. A place the name
 * would climb out of the shelf from is left out. An empty list means the name
 * is refused: it is absolute, climbs out from everywhere, or names no file.
 */
export function pictureCandidates(bookFile: string, picture: string): string[] {
  const name = picture.split(SEPARATOR)
  const last = name[name.length - 1] ?? ''
  if (ABSOLUTE.test(picture) || last === '' || last === '.' || last === '..') return []
  const folder = bookFile.split(SEPARATOR).slice(0, -1)
  const out: string[] = []
  for (const base of [folder, []]) {
    const at = settle([...base, ...name])?.join('/')
    if (at && !out.includes(at)) out.push(at)
  }
  return out
}
