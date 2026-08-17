/**
 * Reading the table of contents of a zip file.
 *
 * An EPUB is a zip, and no dependency here can open one. Rather than add a
 * library, the archive's own directory is parsed — it is a well-specified
 * fixed-width structure and this is about a hundred lines — and the actual
 * decompression is left to the browser's `DecompressionStream`, which every
 * engine this app already requires has.
 *
 * The split is deliberate: *finding* the entries is pure byte arithmetic and
 * belongs here, where it is tested against handmade archives with no browser
 * in sight. *Inflating* them needs a platform API and lives in
 * `platform/browser/epub`.
 *
 * Only the two storage methods an EPUB actually uses are recognised — stored
 * and deflated. Anything else is reported rather than guessed at, because a
 * silently empty chapter is a book with a hole in it.
 */

/** One file in the archive, located but not yet decompressed. */
export interface ZipEntry {
  /** Path within the archive, e.g. `OEBPS/chapter-1.xhtml`. */
  name: string
  /** 0 = stored verbatim, 8 = deflated. Anything else this cannot read. */
  method: number
  /** Where the compressed bytes begin, once the local header is stepped over. */
  offset: number
  compressedSize: number
  uncompressedSize: number
}

const END_OF_DIRECTORY = 0x06054b50
const DIRECTORY_ENTRY = 0x02014b50
const LOCAL_HEADER = 0x04034b50
/** The end record is 22 bytes, plus a comment of up to 64 KB after it. */
const MAX_COMMENT = 0xffff

class Reader {
  constructor(private readonly view: DataView) {}
  u16(at: number): number {
    return this.view.getUint16(at, true)
  }
  u32(at: number): number {
    return this.view.getUint32(at, true)
  }
}

/**
 * Every entry in the archive, in directory order.
 *
 * Read from the central directory at the end rather than by walking local
 * headers from the front: the directory is the archive's own index, it is what
 * every other reader uses, and walking forwards means trusting sizes that a
 * streamed zip is allowed to leave as zero in the local header.
 *
 * Throws with something a person can act on. An EPUB that cannot be opened is
 * worth one clear sentence, not a book with chapters quietly missing.
 */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const r = new Reader(view)

  // Scan backwards for the end-of-directory record. It is at the very end
  // unless the archive carries a comment, which is why this is a search.
  const floor = Math.max(0, bytes.length - MAX_COMMENT - 22)
  let end = -1
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (r.u32(i) === END_OF_DIRECTORY) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('That file is not a zip archive, so it cannot be an EPUB.')

  const count = r.u16(end + 10)
  let at = r.u32(end + 16)
  if (at >= bytes.length) {
    throw new Error('The EPUB’s directory points outside the file — it looks truncated.')
  }

  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || r.u32(at) !== DIRECTORY_ENTRY) {
      throw new Error(`The EPUB’s directory ends after ${i} of ${count} files — it is damaged.`)
    }
    const method = r.u16(at + 10)
    const compressedSize = r.u32(at + 20)
    const uncompressedSize = r.u32(at + 24)
    const nameLength = r.u16(at + 28)
    const extraLength = r.u16(at + 30)
    const commentLength = r.u16(at + 32)
    const localAt = r.u32(at + 42)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))

    entries.push({ name, method, offset: localAt, compressedSize, uncompressedSize })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * Where an entry's bytes actually start.
 *
 * The directory records where the *local header* is, and that header carries
 * its own name and extra-field lengths — which are not always the same as the
 * directory's, so they have to be read from the header itself rather than
 * assumed.
 */
export function payloadRange(bytes: Uint8Array, entry: ZipEntry): { from: number; to: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const r = new Reader(view)
  if (entry.offset + 30 > bytes.length || r.u32(entry.offset) !== LOCAL_HEADER) {
    throw new Error(`“${entry.name}” is not where the EPUB’s directory said it was.`)
  }
  const nameLength = r.u16(entry.offset + 26)
  const extraLength = r.u16(entry.offset + 28)
  const from = entry.offset + 30 + nameLength + extraLength
  return { from, to: from + entry.compressedSize }
}

/** Resolve a path relative to the directory another archive entry lives in. */
export function resolveInZip(from: string, relative: string): string {
  if (relative.startsWith('/')) return relative.slice(1)
  const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/')).split('/') : []
  const out: string[] = [...base]
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}
