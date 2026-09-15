/**
 * Talking to the shelf: GitHub's contents API, from the page.
 *
 * The same arrangement the Anthropic calls already work under, for the same
 * reason — there is no server here to proxy through. `api.github.com` answers
 * cross-origin requests with a bearer token, so a repository the user owns can
 * be read and written straight from the tab.
 *
 * The credential rules are the API key's rules, and they are not negotiable:
 * the token is the user's, stored in their browser, sent only to
 * `api.github.com`, never logged, never put in a prompt, and never written into
 * a book file. A token that reached a book file would be published the moment
 * that book was saved, which is the one mistake this module must make
 * impossible.
 *
 * ## What the API forces
 *
 * **Updating needs the blob's sha.** A `PUT` without one is refused when the
 * file exists, so every write reads the current sha first. Two devices writing
 * the same book still collide — the second gets a 409 — and the honest answer
 * is to say so rather than to force, because forcing is how the laptop's
 * afternoon of proofreading disappears under the phone's.
 *
 * **Anything over a megabyte comes back another way.** The contents endpoint
 * inlines base64 only up to 1 MB; past that it wants the raw media type, which
 * serves up to 100 MB. A book with its transcription is comfortably past that
 * line, so the raw path is the one used for reading.
 *
 * **And nothing from the shelf may be served out of the browser's cache.**
 * GitHub answers a read with `Cache-Control: private, max-age=60`, so a book
 * file fetched twice inside a minute comes back the second time without asking
 * — a source of truth quietly a minute out of date, which is the one thing this
 * design refuses. That was the theory. What it actually did was worse, and is
 * measured rather than feared.
 *
 * GitHub's `ETag` for a path is the **blob sha**, and it hands out the same one
 * whatever media type was asked for, `Vary: Accept` notwithstanding: given the
 * ETag issued for `application/vnd.github.raw`, a conditional request for
 * `application/vnd.github+json` is answered **`304 Not Modified`**. So a flush,
 * which reads the book file raw and then asks the JSON envelope for its sha a
 * moment later, got the revalidation it deserved and the wrong representation
 * back — the cached *book file* served as the answer to "what is this path's
 * sha". It parses, being JSON; it has no `sha` in it; and the write that
 * followed went up as a **create** of a file that already exists, which GitHub
 * refuses with `422: "sha" wasn't supplied`. Every ruling made at the query
 * gate on *Isis Unveiled* failed that way, with the book file itself as the
 * thing that shadowed its own sha.
 *
 * **And the same cache took a ruling off the shelf, three hours later.** The
 * fix above was applied to `shaOf` alone, with a comment arguing that a unique
 * URL is the rule that does not depend on anybody's cache being correct — and
 * `getText` was left on `cache: 'no-store'`, which governs the *browser's*
 * cache and not a shared one. `s-maxage=60` invites a shared cache explicitly.
 *
 * What that cost is on the record rather than in theory. A flush reads the book
 * file, folds the queue into *its* list and writes the whole list back, so a
 * read a minute out of date **deletes** everything that landed in that minute.
 * Over fourteen commits to one book, the two flushes that came 44 seconds after
 * the one before them each dropped a ruling — leaf 196, which survived only
 * because the editor happened to rule it again, and leaf 209, which did not —
 * while every one of the nine gaps longer than a minute was clean. Two for two
 * under the window, none above it. The commit message still said "1 query ruled
 * on".
 *
 * Three rules come out of it, and they are in the order of how much they can be
 * relied on.
 *
 * **Every read is asked for at a URL nothing else reads.** A unique parameter
 * on the request, so no cache anywhere — the browser's, GitHub's own edge, a
 * proxy written next year — holds an entry that could answer it. GitHub ignores
 * the parameter and returns the record, measured. This is the rule that does
 * not depend on anybody's cache being correct, which is why it is first:
 * Chromium honours `Vary: Accept` properly and cannot be made to show the first
 * fault at all, and the device both happened on was an iPad. It goes on **every
 * read**, not on the clever one — that distinction is what the second fault
 * was.
 *
 * **Every read is also `cache: 'no-store'`.** The right declaration on its own
 * terms — the shelf is the source of truth and a minute-old answer from it is
 * not one — and it closes the same door from the other side.
 *
 * **And `shaOf` checks that the answer is the answer it asked for**, because a
 * reply this module does not understand is not "the file is not there". That is
 * the rule that would have caught the other two failing: what reached the
 * editor was a message about a missing `sha` field in a request they never
 * made, when what had happened was that the lookup had been answered with their
 * book.
 *
 * Browser-only.
 */
import {
  aboutPath,
  bookPath,
  queriesPath,
  rulingsPath,
  imagePath,
  commitMessage,
  parseAbout,
  scanPath,
  shelfEntries,
  voicePath,
  type ShelfAbout,
  type ShelfConfig
} from '@core/sync'
import { normalizeVoice, type EditorVoice } from '@core/annotate'
import { toBase64 } from '@core/project'

const API = 'https://api.github.com'

/**
 * Every read of the shelf goes to the network.
 *
 * Not a tuning choice: see the note on the ETag, above. `no-store` also keeps
 * the *response* out of the cache, which is what stops one read shadowing the
 * next one's answer.
 */
const NO_CACHE = 'no-store' as const

/**
 * A read's URL, made one that nothing can already have an answer for.
 *
 * `unshared` is not decoration and not a retry counter: see the note on the
 * ETag and on `s-maxage`, above. Every read of the shelf goes through here, so
 * that the property holds for the reads as a class rather than for whichever
 * one somebody last thought about.
 */
function readUrl(config: ShelfConfig, path: string): string {
  return (
    `${API}/repos/${config.repo}/contents/${path}` +
    `?ref=${encodeURIComponent(config.branch)}&unshared=${Date.now()}-${++reads}`
  )
}

/**
 * A counter beside the clock, because the clock is not fine enough.
 *
 * `Date.now()` is milliseconds, and two reads of one path inside a millisecond
 * — a flush reading the book and then a picture, a gate fetching two crops —
 * would produce the same URL and hand the second one the first one's answer.
 * That is the whole fault again, in the small. The counter makes the property
 * hold for *every* read rather than for reads that happen to be far enough
 * apart, which is the distinction this module has now got wrong twice.
 */
let reads = 0

function headers(config: ShelfConfig, accept = 'application/vnd.github+json'): HeadersInit {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

/** What went wrong, in words that name the thing to go and fix. */
export class ShelfError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message)
    this.name = 'ShelfError'
  }
}

async function explain(response: Response): Promise<ShelfError> {
  let detail = ''
  try {
    detail = ((await response.json()) as { message?: string })?.message ?? ''
  } catch {
    /* not JSON; the status is the whole message */
  }
  if (response.status === 401) {
    return new ShelfError('That token was rejected by GitHub.', 401)
  }
  if (response.status === 403) {
    return new ShelfError(
      'That token is not allowed to write here. A fine-grained token needs ' +
        '“Contents: Read and write” on this repository.',
      403
    )
  }
  if (response.status === 404) {
    return new ShelfError(
      'GitHub says there is no such repository — which is also what it says when ' +
        'the token cannot see one. Check the name and the token’s repository access.',
      404
    )
  }
  if (response.status === 409) {
    return new ShelfError(
      'Another device saved this book while this one was working on it. Nothing was ' +
        'overwritten. Open the book again to take what is on the shelf, or save once more ' +
        'to write over it.',
      409
    )
  }
  return new ShelfError(
    `GitHub said ${response.status}${detail ? `: ${detail}` : ''}`,
    response.status
  )
}

/** What the shelf is, and whether anyone else can read it. */
export interface ShelfInfo {
  repo: string
  defaultBranch: string
  private: boolean
}

/**
 * Check the token and the repository in one request.
 *
 * Reports whether the repository is **public**, because a shelf holds the
 * user's own notes and introduction — the part of a reprint that is theirs to
 * sell — and a public repository publishes them permanently the first time a
 * book is saved. The app says so rather than assuming the choice was deliberate.
 */
export async function checkShelf(config: ShelfConfig): Promise<ShelfInfo> {
  const response = await fetch(`${API}/repos/${config.repo}`, {
    headers: headers(config),
    cache: NO_CACHE
  })
  if (!response.ok) throw await explain(response)
  const body = (await response.json()) as {
    full_name?: string
    default_branch?: string
    private?: boolean
  }
  return {
    repo: body.full_name ?? config.repo,
    defaultBranch: body.default_branch ?? 'main',
    private: body.private === true
  }
}

/**
 * The blob sha of a path, or null when it is not there yet.
 *
 * Null means **read, and not there**. Anything else — a body this does not
 * recognise, a directory where a file was named — throws, because the caller's
 * response to null is to create the file, and creating over a file that exists
 * is refused by GitHub in the one wording that sends the reader looking at
 * their own request.
 */
async function shaOf(config: ShelfConfig, path: string): Promise<string | null> {
  const response = await fetch(readUrl(config, path), {
    headers: headers(config),
    cache: NO_CACHE
  })
  if (response.status === 404) return null
  if (!response.ok) throw await explain(response)
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ShelfError(`GitHub did not answer with a file record for ${path}.`, null)
  }
  if (Array.isArray(body)) {
    throw new ShelfError(`${path} is a directory on ${config.repo}, not a file.`, null)
  }
  const sha = (body as { sha?: unknown })?.sha
  if (typeof sha !== 'string' || sha === '') {
    throw new ShelfError(
      `GitHub's answer for ${path} carried no sha, so it cannot be written safely.`,
      null
    )
  }
  return sha
}

/** Whether a path is already on the shelf — what stops a scan being sent twice. */
export async function shelfHas(config: ShelfConfig, path: string): Promise<boolean> {
  return (await shaOf(config, path)) !== null
}

/**
 * Write a file, creating it or replacing it.
 *
 * Reads the sha first because GitHub refuses an update without one. That leaves
 * a window in which another device can write between the read and the write,
 * which GitHub answers with a 409 — reported rather than forced.
 */
export async function putFile(
  config: ShelfConfig,
  path: string,
  contentBase64: string,
  message: string
): Promise<void> {
  const sha = await shaOf(config, path)
  const response = await fetch(`${API}/repos/${config.repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...headers(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch: config.branch,
      ...(sha ? { sha } : {})
    })
  })
  if (!response.ok) throw await explain(response)
}

/**
 * Read a file as text, whatever its size.
 *
 * The raw media type rather than the JSON envelope: a book file with its
 * transcription is several megabytes, and the inline-base64 form gives up past
 * one.
 */
export async function getText(config: ShelfConfig, path: string): Promise<string | null> {
  const response = await fetch(readUrl(config, path), {
    headers: headers(config, 'application/vnd.github.raw'),
    cache: NO_CACHE
  })
  if (response.status === 404) return null
  if (!response.ok) throw await explain(response)
  return response.text()
}

/** Read a file as bytes — the scan. */
export async function getBytes(config: ShelfConfig, path: string): Promise<Uint8Array | null> {
  const response = await fetch(readUrl(config, path), {
    headers: headers(config, 'application/vnd.github.raw'),
    cache: NO_CACHE
  })
  if (response.status === 404) return null
  if (!response.ok) throw await explain(response)
  return new Uint8Array(await response.arrayBuffer())
}

/** Every book on the shelf. Empty for a repository nobody has saved to yet. */
export async function listShelf(config: ShelfConfig): Promise<{ slug: string; path: string }[]> {
  const response = await fetch(readUrl(config, 'books'), {
    headers: headers(config),
    cache: NO_CACHE
  })
  // A shelf with nothing on it has no `books/` directory, which is a 404 and
  // not a failure: it is what a repository looks like before the first save.
  if (response.status === 404) return []
  if (!response.ok) throw await explain(response)
  const body = (await response.json()) as unknown
  if (!Array.isArray(body)) return []
  return shelfEntries(
    body.filter(
      (item): item is { name: string; type: string } =>
        typeof item === 'object' && item !== null && 'name' in item && 'type' in item
    )
  )
}

/**
 * A name for a scan derived from its own bytes.
 *
 * SHA-256 rather than the file key, so the same scan saved from two devices —
 * where a re-download has changed the modification time and therefore the key —
 * is recognised as the one file it is, and uploaded once.
 */
export async function digestOf(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Push one book's file, its catalogue card and its two editorial sheets.
 *
 * The sheets ride along rather than being a separate action, because the whole
 * failure they exist to prevent is a decision that lives in one place: a query
 * raised in a session nobody pushed is a question nobody will be asked again,
 * and a ruling made and not pushed is one the next session will ask about a
 * second time. Returns the path written to.
 */
export async function pushBook(
  config: ShelfConfig,
  key: string,
  json: string,
  about: ShelfAbout,
  what: string,
  /**
   * The queries and rulings as Markdown, rendered by core.
   *
   * Optional so a caller with nothing to say writes nothing — an empty sheet
   * committed on every save is noise in a history that is meant to read as a
   * log of the work.
   */
  sheets?: { queries?: string; rulings?: string }
): Promise<string> {
  const path = bookPath(key)
  const message = commitMessage(about.fileName, what)
  await putFile(config, path, toBase64(new TextEncoder().encode(json)), message)
  // The card second: it describes what is in the book file, so writing it first
  // would leave a listing promising a book that is not there yet.
  await putFile(
    config,
    aboutPath(key),
    toBase64(new TextEncoder().encode(JSON.stringify(about, null, 2))),
    message
  )

  // Last, and never fatal: a sheet that fails to upload costs a re-run of
  // `save`, while throwing here would report a book that is already on the
  // shelf as unsaved and invite somebody to push it again.
  for (const [text, where] of [
    [sheets?.queries, queriesPath(key)],
    [sheets?.rulings, rulingsPath(key)]
  ] as const) {
    if (!text) continue
    try {
      await putFile(config, where, toBase64(new TextEncoder().encode(text)), message)
    } catch {
      /* the book is up; the sheet can wait for the next save */
    }
  }
  return path
}

/**
 * The editor, fetched from the shelf.
 *
 * Returns null when there is none there yet, which is the ordinary case on a
 * fresh repository rather than a failure — the caller falls back to whatever is
 * on the device. A voice that will not parse comes back through
 * `normalizeVoice`, which backfills rather than refuses: losing a pen name and
 * six exemplars to protect the user from a density dial in the wrong position
 * would be the worse trade, and it is the same call `loadVoice` makes.
 */
export async function fetchVoice(
  config: ShelfConfig,
  penName: string
): Promise<EditorVoice | null> {
  const raw = await getText(config, voicePath(penName))
  if (raw === null) return null
  try {
    return normalizeVoice(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * The editor, written to the shelf.
 *
 * Addressed by pen name rather than by book, because this is the one record
 * here that belongs to no book. Whoever changes the name is starting a second
 * editor and gets a second file; the old one is left alone rather than renamed,
 * since notes already published over it were written by that editor and its
 * exemplars are still the evidence of how they read.
 */
export async function pushVoice(
  config: ShelfConfig,
  voice: EditorVoice,
  what = 'voice updated'
): Promise<string> {
  const path = voicePath(voice.penName)
  const json = JSON.stringify(voice, null, 2)
  await putFile(
    config,
    path,
    toBase64(new TextEncoder().encode(json)),
    `${voice.penName.trim() || 'editor'}: ${what}`
  )
  return path
}

/**
 * The catalogue: what is on the shelf, without downloading any of it.
 *
 * One small request per book. A card that will not parse is left out rather
 * than shown as a broken row — the book file beside it is untouched and the
 * next save rewrites the card.
 */
export async function readShelf(config: ShelfConfig): Promise<ShelfAbout[]> {
  const entries = await listShelf(config)
  const out: ShelfAbout[] = []
  for (const entry of entries) {
    const text = await getText(config, `${entry.path.replace(/book\.json$/, '')}about.json`)
    const about = text ? parseAbout(text) : null
    if (about) out.push(about)
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** Everything the shelf holds about one book, ready to be put back. */
export async function fetchBook(config: ShelfConfig, key: string): Promise<string | null> {
  return getText(config, bookPath(key))
}

/**
 * Push the scan, unless it is already there.
 *
 * The check is the point: every version a repository is given is kept forever,
 * so re-sending sixty megabytes on each save would grow the shelf by sixty
 * megabytes each time while changing nothing.
 */
export async function pushScan(
  config: ShelfConfig,
  file: Blob,
  fileName: string
): Promise<{ path: string; uploaded: boolean }> {
  const bytes = await file.arrayBuffer()
  const path = scanPath(await digestOf(bytes), fileName)
  if (await shelfHas(config, path)) return { path, uploaded: false }
  await putFile(
    config,
    path,
    toBase64(new Uint8Array(bytes)),
    commitMessage(fileName, 'the scan itself')
  )
  return { path, uploaded: true }
}

/**
 * Put one of the editor's own pictures on the shelf, once.
 *
 * The scan's rule applied to the other bytes that cannot be re-derived. A
 * picture the editor chose off their own disk is gone with the tab if it is not
 * kept — unlike a crop, which is cut out of the scan again whenever it is
 * wanted — so it has to be stored, and storing it inside the book file meant
 * rewriting it into git history on every save.
 *
 * Named by its own digest, so the same picture used in two books costs the
 * shelf nothing twice, and re-saving a book uploads nothing at all.
 */
export async function pushImage(
  config: ShelfConfig,
  bytes: Uint8Array,
  fileName: string
): Promise<{ path: string; uploaded: boolean }> {
  const copy = new Uint8Array(bytes)
  const path = imagePath(await digestOf(copy.buffer as ArrayBuffer))
  if (await shelfHas(config, path)) return { path, uploaded: false }
  await putFile(config, path, toBase64(copy), commitMessage(fileName, 'a picture of your own'))
  return { path, uploaded: true }
}
