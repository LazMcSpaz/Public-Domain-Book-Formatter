/**
 * The house look's file on this disk, for a book file on a shelf.
 *
 * The house look sits at the top of the shelf (`design/house-look.json`; the
 * path is the shelf map's, `houseLookPath` in `src/core/sync/shelf.ts`, and
 * is handed in). The top is found from the book file the way every picture's
 * place is (`shelfPlace`): `<shelf>/books/<Folder>/book.json` has `<shelf>` as
 * its top. A book file outside a shelf is a shelf of its own, so its house look
 * would sit beside it.
 *
 * Only the text is read here. What it means, and whether it can be used, is
 * core's (`parseHouseLook`), asked in the driver's page.
 */
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { shelfPlace } from './book-pictures.mjs'

/**
 * The house look beside a book's shelf, as `{ path, file, text }`, or null when
 * the shelf has none.
 *
 * @param {string} bookFile the book file on disk
 * @param {string} shelfPath the house look's shelf path
 * @returns {{ path: string, file: string, text: string } | null}
 */
export function houseLookBeside(bookFile, shelfPath) {
  const file = resolve(shelfPlace(bookFile).root, shelfPath)
  try {
    if (!statSync(file).isFile()) return null
  } catch {
    return null
  }
  return { path: shelfPath, file, text: readFileSync(file, 'utf8') }
}
