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
 * Browser-only.
 */
import {
  aboutPath,
  bookPath,
  imagePath,
  commitMessage,
  parseAbout,
  scanPath,
  shelfEntries,
  type ShelfAbout,
  type ShelfConfig
} from '@core/sync'
import { toBase64 } from '@core/project'

const API = 'https://api.github.com'

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
  const response = await fetch(`${API}/repos/${config.repo}`, { headers: headers(config) })
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

/** The blob sha of a path, or null when it is not there yet. */
async function shaOf(config: ShelfConfig, path: string): Promise<string | null> {
  const url = `${API}/repos/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`
  const response = await fetch(url, { headers: headers(config) })
  if (response.status === 404) return null
  if (!response.ok) throw await explain(response)
  const body = (await response.json()) as { sha?: string }
  return body.sha ?? null
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
  const url = `${API}/repos/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`
  const response = await fetch(url, { headers: headers(config, 'application/vnd.github.raw') })
  if (response.status === 404) return null
  if (!response.ok) throw await explain(response)
  return response.text()
}

/** Read a file as bytes — the scan. */
export async function getBytes(config: ShelfConfig, path: string): Promise<Uint8Array | null> {
  const url = `${API}/repos/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`
  const response = await fetch(url, { headers: headers(config, 'application/vnd.github.raw') })
  if (response.status === 404) return null
  if (!response.ok) throw await explain(response)
  return new Uint8Array(await response.arrayBuffer())
}

/** Every book on the shelf. Empty for a repository nobody has saved to yet. */
export async function listShelf(config: ShelfConfig): Promise<{ slug: string; path: string }[]> {
  const url = `${API}/repos/${config.repo}/contents/books?ref=${encodeURIComponent(config.branch)}`
  const response = await fetch(url, { headers: headers(config) })
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

/** Push one book's file and its catalogue card. Returns the path written to. */
export async function pushBook(
  config: ShelfConfig,
  key: string,
  json: string,
  about: ShelfAbout,
  what: string
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
