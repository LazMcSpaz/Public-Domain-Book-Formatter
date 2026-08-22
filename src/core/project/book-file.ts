/**
 * A book as one file: everything this app knows about it, in a form the user
 * can put anywhere.
 *
 * The stores this app keeps are the right shape for *using* a book — IndexedDB
 * for the transcription and the corrections, localStorage for the answers at
 * each gate — and the wrong shape for owning one. They are keyed to a browser
 * on a device. Clear the site data, change phones, or open the book on the
 * laptop instead, and none of it is there: not the money spent on the vision
 * pass, not an evening of proofreading, not the design the edition was set in.
 *
 * So there is one more shape: a single JSON file holding the lot. Download it,
 * keep it in a repository or a drive or an email to yourself, load it back on
 * any machine. No account, no server, no credential — the app has never had one
 * and this does not give it one.
 *
 * ## What is in it, and what is not
 *
 * **In:** the transcription (the only part that costs money), every correction
 * from the proof step and the gates, the notes and introduction that were
 * accepted, the pictures the editor supplied and every retouch applied to them,
 * the second reading's verdicts, the fact bank, the answers given at every gate
 * — the design, the trim, the edition's title and imprint — and the editor's
 * voice. Also an unfinished annotation pass, so a book caught mid-pass on one
 * device carries on where it stopped on another.
 *
 * **Not in: the scan's pixels.** A PDF runs to hundreds of megabytes, and
 * putting them here would turn a file worth mailing into one that cannot be —
 * and, on a shelf, would rewrite those megabytes into the history on every
 * save. What is here instead is a *pointer* to where the scan sits on the
 * shelf, written once under its own digest, so opening the book on another
 * device fetches it rather than asking for it. A book file that came from a
 * download rather than a shelf has no pointer, and the next thing to do after
 * loading one is to open the same PDF: `keyMatchesFile` finds it by name and
 * size even when a re-download has changed the modification time.
 *
 * **Not in: the API key.** It lives in its own store and travels with nothing.
 * A book file is a thing to hand about; a key is not, and the one certain way
 * to keep the two apart is for this module never to have seen one.
 *
 * ## Why the pixels are base64 and everything else is plain
 *
 * `JSON.stringify` renders a `Uint8Array` as an object with one numbered
 * property per byte — a megabyte of picture becomes several megabytes of
 * `{"0":137,"1":80,…}`, and reading it back gives an object rather than an
 * array. Base64 is a third of that and survives the round trip, so the image
 * bytes are encoded and everything else stays legible text: a book file opens
 * in an editor, diffs line by line in a repository, and can be read by a person
 * wondering what the app kept.
 *
 * Pure: shapes and serialization. The download and the file picker are in the
 * platform layer.
 */
import type { EditorVoice } from '@core/annotate'
import { CURRENT_SCHEMA_VERSION, migrateSavedRun, type SavedRun } from './saved-run'
import { migrateAnnotationCheckpoint, type AnnotationCheckpoint } from './annotation-checkpoint'

/** Names the file for what it is, so a stray JSON is refused rather than tried. */
export const BOOK_FILE_FORMAT = 'public-domain-book-formatter/book'

/**
 * Bump when the *envelope* changes shape.
 *
 * Not the same number as the saved run's schema, which moves for its own
 * reasons and is carried inside. Both are written down, and both are checked on
 * the way in, because a file from a newer app is the one case where guessing
 * would put half a book in front of someone.
 */
export const BOOK_FILE_VERSION = 2

/** Everything a book file carries, in memory. */
export interface BookFile {
  format: string
  version: number
  savedAt: string
  /** The saved-run schema the transcription inside was written under. */
  runSchema: number
  run: SavedRun
  /** What was answered at every gate, keyed by step id. */
  answers: Record<string, Record<string, unknown>>
  voice: EditorVoice
  /** An annotation pass that was interrupted, so it can be carried on. */
  notesCheckpoint: AnnotationCheckpoint | null
  /**
   * Pictures the file *names* rather than carries, by image id.
   *
   * Empty for a downloaded book, which holds its pixels inline. Whatever loads
   * a shelf book fetches these and puts the bytes back on the run — until then
   * `run.images` is short of them, which is why `missingImages` exists and why
   * nothing is ever drawn in place of a picture that did not arrive.
   */
  imagePaths: Record<string, string>
  /**
   * Where the scan sits on the shelf, when it was small enough to send.
   *
   * Not the pixels — those are hundreds of megabytes and belong in their own
   * file, written once under their own digest. This is the pointer, so opening
   * the book on another device can fetch the scan rather than asking for it.
   * Null when the book file is a download rather than a shelf entry, or when
   * the scan was too large for GitHub to take.
   */
  scan: ScanPointer | null
}

/** Which file on the shelf holds this book's pixels. */
export interface ScanPointer {
  path: string
  fileName: string
  bytes: number
  /** The file key the run is filed under, so a fetched scan lands where it belongs. */
  key: string
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Bytes to base64, without `btoa`.
 *
 * Written out rather than borrowed because `btoa` is a browser global and this
 * is core: the rule that keeps the flow testable with no DOM is worth more than
 * the twenty lines it saves.
 */
export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}

/** Base64 back to bytes. Anything outside the alphabet is skipped, not guessed at. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let n = 0
  let acc = 0
  let bits = 0
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[n++] = (acc >> bits) & 0xff
    }
  }
  return bytes.subarray(0, n)
}

/** What goes on disk: the run with its pictures encoded. */
interface WireFile {
  format: string
  version: number
  savedAt: string
  runSchema: number
  run: Record<string, unknown>
  /**
   * The editor's own pictures — inline, or named.
   *
   * Two shapes on purpose, and which one is written depends on where the file
   * is going. A book *downloaded* to disk has to carry its pixels: it is one
   * file and there is nowhere else for them to be. A book on a *shelf* names
   * them instead, because the repository can hold them once under their own
   * digest and git would otherwise keep every version of every plate forever.
   *
   * A reader takes whichever it finds, so a v1 file — all base64 — still loads.
   */
  images: { id: string; base64?: string; path?: string }[]
  answers: Record<string, Record<string, unknown>>
  voice: EditorVoice
  notesCheckpoint: AnnotationCheckpoint | null
  scan: ScanPointer | null
}

/**
 * A name for the download that says which book it belongs to.
 *
 * Derived from the book's own file name rather than from a date, because a
 * folder of these is read by eye and `alchemist.book.json` answers the question
 * that `book-2026-08-18.json` does not.
 */
export function bookFileName(fileName: string): string {
  const stem = fileName
    .replace(/\.(pdf|epub)$/i, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${stem || 'book'}.book.json`
}

export function serializeBookFile(input: {
  run: SavedRun
  answers: Record<string, Record<string, unknown>>
  voice: EditorVoice
  notesCheckpoint?: AnnotationCheckpoint | null
  scan?: ScanPointer | null
  savedAt?: string
  /**
   * Where each picture was written, by image id.
   *
   * Given for a shelf, omitted for a download. A picture with no path falls
   * back to being carried inline, so a failed upload costs repository tidiness
   * rather than the picture.
   */
  imagePaths?: Record<string, string>
}): string {
  const { images, ...run } = input.run
  const paths = input.imagePaths ?? {}
  const wire: WireFile = {
    format: BOOK_FILE_FORMAT,
    version: BOOK_FILE_VERSION,
    savedAt: input.savedAt ?? new Date().toISOString(),
    runSchema: input.run.schemaVersion,
    run,
    images: images.map((image) =>
      paths[image.id]
        ? { id: image.id, path: paths[image.id]! }
        : { id: image.id, base64: toBase64(image.bytes) }
    ),
    answers: input.answers,
    voice: input.voice,
    notesCheckpoint: input.notesCheckpoint ?? null,
    scan: input.scan ?? null
  }
  // Indented: this is a file a person may open, and a repository will diff.
  return JSON.stringify(wire, null, 2)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Read a book file, or refuse it with a reason a person can act on.
 *
 * Throws rather than returning something partial, exactly as `migrateSavedRun`
 * does and for the same reason: a half-restored book looks like a whole one and
 * prints with holes in it. The messages name what is wrong, because the user is
 * holding a file and the only useful answer is which file to go and find.
 */
export function parseBookFile(text: string): BookFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('That file is not JSON, so it is not a book file.')
  }
  if (!isObject(raw)) throw new Error('That file is not a book file.')

  if (raw['format'] !== BOOK_FILE_FORMAT) {
    throw new Error('That is a JSON file, but not one this app wrote.')
  }
  const version = typeof raw['version'] === 'number' ? raw['version'] : 0
  if (version > BOOK_FILE_VERSION) {
    throw new Error(
      `That book file is version ${version}, newer than this app understands ` +
        `(${BOOK_FILE_VERSION}). Update the app and try again.`
    )
  }

  // The run goes through the same migration a stored one does, so a book file
  // written by an older version upgrades on the way in rather than needing a
  // second migration path that could disagree with the first.
  const run = migrateSavedRun(raw['run'])
  const images = Array.isArray(raw['images']) ? raw['images'] : []
  const imagePaths: Record<string, string> = {}
  // Carried and named pictures are both read. Only the carried ones become
  // bytes here; a named one is a path for whoever has the repository to fetch,
  // and arrives on the run later. Reading a v1 file is the same code path,
  // because a v1 file simply has no names in it.
  run.images = images.filter(isObject).flatMap((image) => {
    const id = typeof image['id'] === 'string' ? image['id'] : ''
    if (!id) return []
    const path = typeof image['path'] === 'string' ? image['path'] : ''
    if (path) {
      imagePaths[id] = path
      return []
    }
    return [{ id, bytes: fromBase64(typeof image['base64'] === 'string' ? image['base64'] : '') }]
  })

  const answers: Record<string, Record<string, unknown>> = {}
  if (isObject(raw['answers'])) {
    for (const [step, value] of Object.entries(raw['answers'])) {
      if (isObject(value)) answers[step] = value
    }
  }

  return {
    format: BOOK_FILE_FORMAT,
    version: BOOK_FILE_VERSION,
    savedAt: typeof raw['savedAt'] === 'string' ? raw['savedAt'] : new Date(0).toISOString(),
    runSchema: CURRENT_SCHEMA_VERSION,
    run,
    answers,
    // A voice that will not parse is not worth refusing a book over: it is a
    // pen name and a handful of exemplars, and the gate asks for them again.
    voice: isObject(raw['voice']) ? (raw['voice'] as unknown as EditorVoice) : ({} as EditorVoice),
    notesCheckpoint: migrateAnnotationCheckpoint(raw['notesCheckpoint']),
    scan: parseScan(raw['scan']),
    imagePaths
  }
}

function parseScan(raw: unknown): ScanPointer | null {
  if (!isObject(raw)) return null
  const path = typeof raw['path'] === 'string' ? raw['path'] : ''
  const key = typeof raw['key'] === 'string' ? raw['key'] : ''
  if (!path || !key) return null
  return {
    path,
    key,
    fileName: typeof raw['fileName'] === 'string' ? raw['fileName'] : 'book.pdf',
    bytes: typeof raw['bytes'] === 'number' ? raw['bytes'] : 0
  }
}

/** What to tell the user a file holds, before they load it over anything. */
export interface BookFileSummary {
  fileName: string
  savedAt: string
  pageCount: number
  notes: number
  corrections: number
  facts: number
  images: number
  complete: boolean
}

export function summarizeBookFile(file: BookFile): BookFileSummary {
  return {
    fileName: file.run.fileName,
    savedAt: file.savedAt,
    pageCount: file.run.pageCount,
    notes: file.run.edits.filter((e) => e.kind === 'note').length,
    corrections: file.run.edits.length,
    facts: file.run.facts.length,
    // Named and carried alike: the count is what the book *has*, not how this
    // particular file happens to hold it.
    images: file.run.images.length + Object.keys(file.imagePaths).length,
    complete: file.run.complete
  }
}
