/**
 * A book's named pictures, fetched from wherever they sit on the shelf.
 *
 * A book file names its pictures rather than carrying them, and the app used
 * to fetch each name from the top of the shelf. Nearly every picture sits in
 * the book's own folder instead, so a book opened from the shelf came down
 * without its plates. Where to look is a rule about the shelf's layout, so it
 * is core's (`pictureCandidates`): the book's folder first, then the top. This
 * only does the asking.
 *
 * A picture found nowhere is **reported**, never quietly missing: the engine
 * refuses to draw anything in its place, and a plate that vanished between two
 * devices is the kind of silence noticed only once the book is printed.
 *
 * Every read is `getBytes`, so every read goes through `readUrl`. Browser-only.
 */
import { bookPath, imagePath, pictureCandidates, type ShelfConfig } from '@core/sync'
import { digestOf, getBytes, shelfDirFor, shelfHas } from './shelf'

/** What came down: the pictures found, and the names found nowhere. */
export interface BookPictures {
  /** Each picture found, under the id the book gave it. */
  found: { id: string; bytes: Uint8Array }[]
  /** The paths, as the book names them, found in no place the rule allows. */
  lost: string[]
}

/**
 * Fetch every picture a book names (`BookFile.imagePaths`, id to path).
 *
 * The book's folder is resolved once, as `fetchBook` resolves it, so a folder
 * renamed by hand is the one looked in. A shelf that answers with anything but
 * the file or "not there" throws, as every other read does.
 */
export async function fetchBookPictures(
  config: ShelfConfig,
  key: string,
  named: Readonly<Record<string, string>>
): Promise<BookPictures> {
  const out: BookPictures = { found: [], lost: [] }
  const entries = Object.entries(named)
  if (entries.length === 0) return out
  const book = bookPath(key, await shelfDirFor(config, key))
  for (const [id, path] of entries) {
    let bytes: Uint8Array | null = null
    for (const at of pictureCandidates(book, path)) {
      bytes = await getBytes(config, at)
      if (bytes) break
    }
    if (bytes) out.found.push({ id, bytes })
    else out.lost.push(path)
  }
  return out
}

/**
 * The name to keep for a picture this device holds, when the shelf already has
 * it where the book names it; null when it has to be uploaded.
 *
 * A save uploads each held picture unless the shelf has it, and `pushImage`
 * looks only at the top of the shelf. Once a book opened from the shelf held
 * its pictures, the first save would have copied every one that sits beside
 * its book to the top as well: each plate twice in git history, for good. A
 * picture's name is its own digest, so a name that matches the bytes names
 * this very picture, and if it is found where the rule looks, nothing is sent.
 */
export async function keptPicture(
  config: ShelfConfig,
  key: string,
  named: string | undefined,
  bytes: Uint8Array
): Promise<string | null> {
  if (!named) return null
  const copy = new Uint8Array(bytes)
  if (named !== imagePath(await digestOf(copy.buffer as ArrayBuffer))) return null
  const book = bookPath(key, await shelfDirFor(config, key))
  for (const at of pictureCandidates(book, named)) {
    if (await shelfHas(config, at)) return named
  }
  return null
}
