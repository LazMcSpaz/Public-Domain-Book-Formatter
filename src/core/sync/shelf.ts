/**
 * A repository as the shelf a book sits on.
 *
 * The app's stores belong to a browser on a device: clear the site data, pick
 * up the laptop instead of the phone, and the transcription that cost money and
 * the evening of proofreading that cost time are both simply gone. A book file
 * fixes that by being a thing the user owns, and this fixes the last of it by
 * putting that file somewhere both devices can see — a git repository of their
 * own, written to directly from the page with a token that is theirs.
 *
 * There is no server here either. GitHub's REST API answers cross-origin
 * requests with a token, which is the same arrangement the Anthropic calls
 * already work under, and the same rule applies to the credential: it is the
 * user's, it lives in their browser, it is never logged, never put in a prompt,
 * and never written into a book.
 *
 * ## What decides the layout
 *
 * Two facts about git, both of which cost real money to learn the hard way:
 *
 * **Every version is kept forever.** Rewriting a sixty-megabyte scan on each
 * save does not replace it; it adds it. So the file that changes on every save
 * is the small one — the book's JSON, a few megabytes — and the scan is written
 * **once**, under a name derived from its own bytes, and skipped ever after.
 * Two books that are the same scan share it and cost the shelf nothing twice.
 *
 * **A blob over 100 MB is refused outright**, and one over 50 is complained
 * about. A phone that spends four minutes uploading a scan and is then told no
 * is worse than being told no at the start, so the size is checked here, before
 * anything is sent, and a scan too large is left behind with the reason said
 * out loud rather than quietly dropped.
 *
 * Pure: paths, names, limits and listings. Every request is in the platform
 * layer.
 */

/** Where a book's own file lives. One directory per book. */
export const SHELF_ROOT = 'books'

/** Where scans go, named by their content so the same one is never sent twice. */
export const SCAN_ROOT = 'scans'

/**
 * Where the editor's own pictures go, under the same rule as the scan.
 *
 * They used to ride inside the book file as base64, which is a third larger
 * than the bytes and — far worse — is rewritten on *every* save. Git keeps
 * every version, so a book with a few plates in it grew the repository by all
 * of them again each time a correction was typed. A picture is written once
 * here, under its own digest, and the book file names it.
 *
 * Crops cut out of the scan are deliberately not here: those are re-cut from
 * the scan whenever they are wanted, so storing them would be keeping a second
 * copy of something already on the shelf.
 */
export const IMAGE_ROOT = 'images'

/**
 * Where the editor lives, as against where the editions do.
 *
 * The voice was banked in `localStorage` and copied into each book file, which
 * is the same arrangement the books themselves had before this module existed
 * and it fails the same way: clear the site data or pick up the other device
 * and the editor is gone, while the copies scattered through the book files are
 * snapshots that cannot be reconciled with each other.
 *
 * It belongs on the shelf because it is not part of any one book. `voice.ts`
 * has always said so — a voice is the same editor on every book they put out —
 * and the copy that rides inside a book file stays, but demoted to what it
 * always really was: a record of the voice *those* notes were written under,
 * which is why `annotationCheckpointStale` reports a changed voice rather than
 * refusing one.
 *
 * One file per editor rather than one for "the voice", because a person may
 * reasonably put out a scholarly series under one name and a plain reading
 * edition under another, and nothing here should make them choose.
 */
export const VOICE_ROOT = 'voice'

/**
 * The largest scan worth attempting.
 *
 * GitHub refuses a blob over 100 MB and warns past 50. The margin below 50 is
 * for the base64 the API is given, which is a third larger than the bytes: a
 * 40 MB scan arrives as roughly 53 MB of request body, which is already more
 * than most phones will thank anyone for.
 */
export const MAX_SCAN_BYTES = 40 * 1024 * 1024

/** Everything the app needs to talk to one repository. */
export interface ShelfConfig {
  /** `owner/name`, exactly as GitHub writes it. */
  repo: string
  /** The branch to commit on. `main` unless the user says otherwise. */
  branch: string
  /**
   * A fine-grained token with `Contents: Read and write` on that repository and
   * nothing else.
   *
   * Held in the browser beside the API key and under the same rules. It is
   * never part of a book file, never logged, and never sent anywhere but
   * api.github.com.
   */
  token: string
}

/** Whether a repository name is the shape GitHub uses. */
export function validRepo(repo: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(repo.trim())
}

/**
 * A directory name for a book, from the key its run is filed under.
 *
 * The key is `name\0size\0modified`, which contains a NUL and a file name that
 * may hold anything. What comes out here has to survive being a path segment in
 * a git repository and being read by a person browsing the shelf on the web, so
 * it is the file's stem plus a short digest of the whole key: legible, and
 * still unique between two scans of the same book at different sizes.
 */
export function shelfSlug(key: string): string {
  const stem = (key.split('\u0000')[0] ?? 'book')
    .replace(/\.(pdf|epub)$/i, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${stem || 'book'}-${(h >>> 0).toString(36)}`
}

/**
 * Where a book's file sits. `dir` is the directory its card was found in when
 * that is known, because a directory can be renamed by hand to something a
 * person can read — nine of the shelf's sixteen books were — and a path
 * computed from the key then names a directory that does not exist: a flush
 * of the editor's rulings is refused as "not on the shelf yet", and a save
 * writes a second copy of the book beside the first. The computed name is
 * only the default, for a book the shelf has never held.
 */
export function bookPath(key: string, dir: string = shelfSlug(key)): string {
  return `${SHELF_ROOT}/${dir}/book.json`
}

/**
 * A few hundred bytes beside each book saying what it is.
 *
 * The listing has to be quick and it has to be readable. GitHub's directory
 * listing gives names and sizes and nothing else, so without this the intake
 * screen would have to download every book file — several megabytes each — to
 * put a title and a page count on a button. This is the card in the catalogue;
 * `book.json` is the book.
 */
export function aboutPath(key: string, dir: string = shelfSlug(key)): string {
  return `${SHELF_ROOT}/${dir}/about.json`
}

/**
 * A crop of the leaf one query sits on, cut in advance and kept beside the book.
 *
 * The query gate promises the pixels beside every decision and keeps that
 * promise by rendering the leaf — which works until the scan is too large for
 * the shelf to hold. Vol. I of *Isis Unveiled* is 357 MB, past both this
 * shelf's own refusal and GitHub's per-file limit, so it can go up in no form
 * at all and the gate had nothing to show.
 *
 * So a session that *does* have the paper cuts one crop per outstanding query
 * and writes it here, and the gate fetches them one at a time. Named by the
 * query rather than by a digest, unlike a picture the editor supplied: a
 * digest tells you two files differ and this has to answer "which crop belongs
 * to the query on screen", which is a lookup and not a comparison.
 *
 * Written once and never rewritten — a query that has been ruled on is gone
 * from the gate, and one whose wording changed is a different query with a
 * different key — so this costs the repository its own size and not a version
 * of it per save.
 *
 * **JPEG.** These are a photograph of paper and the scan inside the PDF is
 * already JPEG 2000, so a lossless format was keeping every artefact of a lossy
 * original at three times the size: measured on this book, 275 KB a crop as PNG
 * against 81 as JPEG at quality 0.9, or 21 MB against 6.4 over seventy-nine.
 */
export function queryCropPath(key: string, query: string, dir: string = shelfSlug(key)): string {
  return `${SHELF_ROOT}/${dir}/queries/${query}.jpg`
}

/**
 * The editor's queries for one book, as Markdown beside its `book.json`.
 *
 * Markdown rather than JSON because it exists to be *read* — by a person, on a
 * phone, in GitHub's own file view — and because a query that lives only in a
 * chat session survives exactly as long as the session does, which is the one
 * property it must not have.
 */
export function queriesPath(key: string, dir: string = shelfSlug(key)): string {
  return `${SHELF_ROOT}/${dir}/queries.md`
}

/**
 * What the editor decided, as Markdown beside the queries.
 *
 * A separate file rather than a second half of `queries.md`, because the two
 * are read on different occasions: the queries file is work to get through and
 * empties as it is answered, while this one only ever grows and is what a
 * session six months from now reads to find out what this edition already
 * settled.
 */
export function rulingsPath(key: string, dir: string = shelfSlug(key)): string {
  return `${SHELF_ROOT}/${dir}/rulings.md`
}

/** What the catalogue card says. */
export interface ShelfAbout {
  /** The file key the run is filed under, so opening it lands in the right place. */
  key: string
  fileName: string
  savedAt: string
  pageCount: number
  notes: number
  corrections: number
  /**
   * Passages marked while reading.
   *
   * Optional on the way in: every card written before the reading pass existed
   * has no such field, and a listing that refused those would hide the books
   * already on the shelf.
   */
  marked: number
  facts: number
  /** Whether the paid pass reached the end of the book. */
  complete: boolean
  /**
   * Leaves that have a transcription — how far the reading has got, for a
   * book that is not `complete`. Zero on a card written before the field
   * existed, which `shelfProgress` treats as "not counted", not as unread.
   */
  read: number
  /**
   * The editor's decisions: queries raised by the readers, those still
   * waiting on the editor, and — of the waiting — those a standing ruling
   * holds an answer for. `null` on a card written before the field existed:
   * a card that does not know must not say "nothing waiting".
   */
  queries: ShelfQueries | null
  /** Where the pixels are, when they were small enough to send. */
  scanPath: string | null
  /**
   * The directory the card was found in. Filled by the listing, never written
   * to the card: it is where the book *is*, which the card cannot know.
   */
  dir?: string
}

export interface ShelfQueries {
  raised: number
  waiting: number
  held: number
}

function parseQueries(v: unknown): ShelfQueries | null {
  if (typeof v !== 'object' || v === null) return null
  const q = v as Record<string, unknown>
  const n = (name: string): number => (typeof q[name] === 'number' ? (q[name] as number) : 0)
  return { raised: n('raised'), waiting: n('waiting'), held: n('held') }
}

export function parseAbout(text: string): ShelfAbout | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const key = typeof v['key'] === 'string' ? v['key'] : ''
  if (!key) return null
  const n = (name: string): number => (typeof v[name] === 'number' ? (v[name] as number) : 0)
  return {
    key,
    fileName: typeof v['fileName'] === 'string' ? v['fileName'] : 'a book',
    savedAt: typeof v['savedAt'] === 'string' ? v['savedAt'] : new Date(0).toISOString(),
    pageCount: n('pageCount'),
    notes: n('notes'),
    corrections: n('corrections'),
    marked: n('marked'),
    facts: n('facts'),
    complete: v['complete'] !== false,
    read: n('read'),
    queries: parseQueries(v['queries']),
    scanPath: typeof v['scanPath'] === 'string' ? v['scanPath'] : null
  }
}

/**
 * Where a scan lives: under its own content digest, not under the book.
 *
 * So re-saving a book never re-uploads it, and two editions worked from the
 * same file share one copy. The extension is kept because a person browsing the
 * repository should be able to click it.
 */
export function scanPath(digest: string, fileName: string): string {
  const ext = /\.epub$/i.test(fileName) ? 'epub' : 'pdf'
  return `${SCAN_ROOT}/${digest}.${ext}`
}

/**
 * Where one supplied picture lives. Always PNG — `readSuppliedImage` writes
 * PNG, because these are often line art or plates where JPEG's ringing around
 * every edge is the artefact that shows up in print.
 */
export function imagePath(digest: string): string {
  return `${IMAGE_ROOT}/${digest}.png`
}

/**
 * The file name for one editor's voice.
 *
 * Slugged from the pen name, so the shelf reads as a shelf: `voice/etsu-t-dhent.json`
 * next to `books/`. An editor with no pen name yet is `voice/editor.json` — one
 * file rather than none, because the alternative is losing the guidance and the
 * exemplars of anyone who never got round to naming themselves.
 */
export function voicePath(penName: string): string {
  const stem = penName
    .toLocaleLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${VOICE_ROOT}/${stem || 'editor'}.json`
}

/** One book on the shelf, as the intake screen lists it. */
export interface ShelfEntry {
  /** The directory it sits in — what a pull is addressed by. */
  slug: string
  path: string
}

/** Read a listing of `books/` into entries, ignoring anything else in there. */
export function shelfEntries(contents: readonly { name: string; type: string }[]): ShelfEntry[] {
  return contents
    .filter((item) => item.type === 'dir' && item.name.length > 0)
    .map((item) => ({ slug: item.name, path: `${SHELF_ROOT}/${item.name}/book.json` }))
}

/**
 * What the commit says.
 *
 * A shelf is read by people — that is most of why it is a repository rather
 * than a blob store — so the history is written to be read: what changed about
 * which book, not "update book.json".
 */
export function commitMessage(fileName: string, what: string): string {
  return `${fileName}: ${what}`
}

/** Why a scan was not sent, or null when it may be. */
export function scanRefusal(bytes: number): string | null {
  if (bytes <= MAX_SCAN_BYTES) return null
  const mb = Math.round(bytes / (1024 * 1024))
  return (
    `The scan is ${mb} MB, past the ${Math.round(MAX_SCAN_BYTES / (1024 * 1024))} MB this ` +
    'app will send — GitHub refuses a file over 100 MB and the upload is a third larger ' +
    'again. Everything else about the book was saved; opening it on another device will ' +
    'ask for the scan.'
  )
}
