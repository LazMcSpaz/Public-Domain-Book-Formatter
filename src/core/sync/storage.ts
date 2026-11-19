/**
 * The big-file store: names in the bucket, and the shelf's list of what is there.
 *
 * Scans, reference copies, exports and picture originals live in one private
 * Cloudflare R2 bucket (decision 0051), each named by its SHA-256 fingerprint
 * under a kind: `sources/<sha256>.pdf`. The name is the check: whatever comes
 * back from the bucket is hashed and must match the name it was fetched by, so
 * a damaged or swapped file cannot pass as the original.
 *
 * The shelf keeps `STORAGE.tsv`, one row per object: its key, fingerprint,
 * size, the path it had on the shelf, and the day it was added. One row per
 * key, never two: the same file put twice is the same object.
 *
 * Pure: the requests and the hashing are in `scripts/storage.mjs`.
 */

export const STORAGE_BUCKET = 'libri-vetus-files'
export const STORAGE_LIST = 'STORAGE.tsv'
/** The kind the self-test writes under; the only kind the command may delete. */
export const TEST_KIND = '_test'
/** The storage API's per-object limit; a bigger file is refused before it is sent. */
export const MAX_OBJECT_BYTES = 300 * 1000 * 1000
export const STORAGE_COLUMNS = ['key', 'sha256', 'bytes', 'from', 'added'] as const

export interface StorageRow {
  key: string
  sha256: string
  bytes: number
  /** The path the file had on the shelf (or its own name when it had none). */
  from: string
  /** The day it was added, `YYYY-MM-DD`. */
  added: string
}

const SHA256 = /^[0-9a-f]{64}$/u
// The first part names the kind of file (`scans`, `sources`, `pictures`,
// `editions`, `exports`), lower case; the parts after it may be a book's real
// folder name or an edition, which keep their capitals (`editions/Author-Title/1.0`).
const KIND = /^[a-z0-9_][a-z0-9_-]{0,39}(\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99})*$/u
const EXT = /^[a-z0-9]{1,10}$/u
const DAY = /^\d{4}-\d{2}-\d{2}$/u
const HEADER = STORAGE_COLUMNS.join('\t')

/** A leading UTF-8 byte-order mark removed (Windows editors add one). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * A file name's extension, lower case and without the dot, as the key carries
 * it. Only the last one counts (`recon.json.gz` gives `gz`); anything that is
 * not a short run of letters and digits gives none, and `from` keeps the name.
 */
export function extensionOf(fileName: string): string {
  const name = fileName.split(/[\\/]/u).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  const ext = name.slice(dot + 1).toLowerCase()
  return EXT.test(ext) ? ext : ''
}

/** The bucket key for a file: `<kind>/<sha256>.<ext>`. Throws on a bad part. */
export function storageKey(kind: string, sha256: string, ext: string): string {
  if (!KIND.test(kind)) {
    throw new Error(
      `"${kind}" is not a storage kind: use lower-case letters, digits, "-" and "_" (for example sources, exports, scans).`
    )
  }
  const sha = sha256.toLowerCase()
  if (!SHA256.test(sha)) throw new Error(`"${sha256}" is not a SHA-256 fingerprint.`)
  const e = ext.replace(/^\./u, '').toLowerCase()
  if (e && !EXT.test(e)) throw new Error(`"${ext}" is not a file extension the store accepts.`)
  return e ? `${kind}/${sha}.${e}` : `${kind}/${sha}`
}

/** The fingerprint a key carries (the last 64-hex run standing alone), or null. */
export function fingerprintOf(key: string): string | null {
  const runs = [...key.matchAll(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/giu)]
  return runs.length ? runs[runs.length - 1][0].toLowerCase() : null
}

/** Whether a key belongs to the self-test, the only objects the command deletes. */
export function isTestKey(key: string): boolean {
  return key.startsWith(`${TEST_KIND}/`) && !key.includes('..')
}

/** Why a row cannot be listed, or null when it is sound. */
function rowProblem(row: StorageRow): string | null {
  if (!row.key) return 'the key is empty'
  if (!SHA256.test(row.sha256)) return `"${row.sha256}" is not a SHA-256 fingerprint`
  const named = fingerprintOf(row.key)
  if (named && named !== row.sha256) return `the key names ${named} but the row says ${row.sha256}`
  if (!Number.isSafeInteger(row.bytes) || row.bytes < 0) return `"${row.bytes}" is not a size`
  if (!DAY.test(row.added)) return `"${row.added}" is not a date (YYYY-MM-DD)`
  for (const col of STORAGE_COLUMNS) {
    if (/[\t\r\n]/u.test(String(row[col]))) return `the ${col} holds a tab or a line break`
  }
  return null
}

/**
 * The rows of `STORAGE.tsv`. An empty file is an empty list; a file whose
 * first line is not the header, or with a row that does not read, is refused
 * with its line number rather than half read.
 */
export function parseStorageList(text: string): StorageRow[] {
  const lines = stripBom(text).split(/\r?\n/u)
  const rows: StorageRow[] = []
  let headerSeen = false
  lines.forEach((line, i) => {
    if (!line.trim()) return
    if (!headerSeen) {
      if (line !== HEADER) {
        throw new Error(`${STORAGE_LIST} line ${i + 1}: expected the header "${HEADER}".`)
      }
      headerSeen = true
      return
    }
    const cells = line.split('\t')
    if (cells.length !== STORAGE_COLUMNS.length) {
      throw new Error(
        `${STORAGE_LIST} line ${i + 1}: ${cells.length} columns, expected ${STORAGE_COLUMNS.length}.`
      )
    }
    const [key, sha256, bytes, from, added] = cells
    const row: StorageRow = {
      key,
      sha256,
      bytes: /^\d+$/u.test(bytes) ? Number(bytes) : NaN,
      from,
      added
    }
    const problem = rowProblem(row)
    if (problem) throw new Error(`${STORAGE_LIST} line ${i + 1}: ${problem}.`)
    if (rows.some((r) => r.key === key)) {
      throw new Error(`${STORAGE_LIST} line ${i + 1}: ${key} is listed twice.`)
    }
    rows.push(row)
  })
  return rows
}

/** `STORAGE.tsv` written out: the header, one line per row, a final newline. */
export function serializeStorageList(rows: readonly StorageRow[]): string {
  const lines = rows.map((row) => {
    const problem = rowProblem(row)
    if (problem) throw new Error(`${row.key || '(no key)'}: ${problem}.`)
    return STORAGE_COLUMNS.map((col) => String(row[col])).join('\t')
  })
  return [HEADER, ...lines].join('\n') + '\n'
}

export interface AddResult {
  rows: StorageRow[]
  added: boolean
  /** The row already listed under that key, when there was one. */
  existing?: StorageRow
}

/** The list with a row added at the end, unless its key is already listed. */
export function addStorageRow(rows: readonly StorageRow[], row: StorageRow): AddResult {
  const problem = rowProblem(row)
  if (problem) throw new Error(`${row.key || '(no key)'}: ${problem}.`)
  const existing = rows.find((r) => r.key === row.key)
  if (existing) return { rows: [...rows], added: false, existing }
  return { rows: [...rows, row], added: true }
}
