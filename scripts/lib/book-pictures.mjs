/**
 * Where a picture a book file names sits on this disk.
 *
 * A book file names each picture by a path (`images/<digest>.png`). Where that
 * path is looked for is core's rule, `pictureCandidates`
 * (`src/core/sync/pictures.ts`): the book's own folder first, then the top of
 * the shelf, and never a name that would leave the shelf or that a web address
 * misreads. The app asks it through `src/platform/browser/shelf-pictures.ts`;
 * every script asks it through here, so the driver, the EPUB builder and the
 * app cannot disagree about where a plate is.
 *
 * The rule speaks in shelf paths. A book on disk at
 * `<shelf>/books/<Folder>/book.json` has the shelf path
 * `books/<Folder>/book.json`, and each answer is resolved against `<shelf>`. A
 * book file with no `books/<Folder>/` above it is not on a shelf, so it is
 * taken as a shelf of its own: its folder is the top, its pictures are found
 * beside it, and nothing above that folder is looked in.
 *
 * The rule can be handed in. The driver hands in its page's copy (`askShelfMap`,
 * through Vite), so `load` and `save` need no Node feature beyond what they
 * always needed. Left out, the rule is imported here on first use, which works
 * under vite-node (the EPUB builder, the tests) and on a Node that strips
 * TypeScript itself (22.18 or newer).
 */
import { statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

/** The folder a shelf keeps its books in, one folder per book. */
const BOOKS = 'books'

let imported = null

/**
 * Core's rule, imported once: the default when no rule is handed in.
 *
 * @param {string} bookFile the book's shelf path
 * @param {string} picture the path the book names
 * @returns {Promise<string[]>}
 */
async function pictureCandidates(bookFile, picture) {
  imported ??= (await import('../../src/core/sync/pictures.ts')).pictureCandidates
  return imported(bookFile, picture)
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Where a book file sits: the top of its shelf on this disk, and the book's
 * own shelf path, the way the rule wants it.
 *
 * @param {string} file the book file on disk
 * @returns {{ root: string, shelfPath: string }}
 */
export function shelfPlace(file) {
  const book = resolve(file)
  const folder = dirname(book)
  const above = dirname(folder)
  if (above !== folder && basename(above) === BOOKS) {
    return { root: dirname(above), shelfPath: `${BOOKS}/${basename(folder)}/${basename(book)}` }
  }
  return { root: folder, shelfPath: basename(book) }
}

/**
 * The files on disk to try for one picture a book names, in the rule's order.
 * Empty when the rule refuses the name.
 *
 * @param {string} file the book file on disk
 * @param {string} picture the path the book names
 * @param {(bookFile: string, picture: string) => string[] | Promise<string[]>} [rule] core's
 *   `pictureCandidates`, or a door to it; imported here when left out
 * @returns {Promise<string[]>}
 */
export async function picturePlaces(file, picture, rule = pictureCandidates) {
  const { root, shelfPath } = shelfPlace(file)
  const places = await rule(shelfPath, picture)
  return places.map((at) => resolve(root, ...at.split('/')))
}

/**
 * The file on disk for one picture a book names, or null when it is in no
 * place the rule allows.
 *
 * @param {string} file the book file on disk
 * @param {string} picture the path the book names
 * @param {Parameters<typeof picturePlaces>[2]} [rule] as for `picturePlaces`
 * @returns {Promise<string | null>}
 */
export async function findPicture(file, picture, rule) {
  return (await picturePlaces(file, picture, rule)).find(isFile) ?? null
}

/**
 * Every picture a book file names (its `images` list), found or lost.
 *
 * An entry is a named picture when it has a text `id` and a text `path`, as
 * `parseBookFile` reads it; one carried inline, or with no id, is not looked
 * for. A name found nowhere is returned in `lost`, for the caller to report.
 *
 * @param {string} file the book file on disk
 * @param {unknown} images the book file's `images`
 * @param {Parameters<typeof picturePlaces>[2]} [rule] as for `picturePlaces`
 * @returns {Promise<{ found: { id: string, path: string, file: string }[], lost: string[] }>}
 */
export async function findBookPictures(file, images, rule) {
  const found = []
  const lost = []
  for (const image of Array.isArray(images) ? images : []) {
    const { id, path } = image ?? {}
    if (typeof id !== 'string' || !id || typeof path !== 'string' || !path) continue
    const at = await findPicture(file, path, rule)
    if (at) found.push({ id, path, file: at })
    else lost.push(path)
  }
  return { found, lost }
}
