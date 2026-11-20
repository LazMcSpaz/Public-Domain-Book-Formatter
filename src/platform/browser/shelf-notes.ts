/**
 * The Workroom's reader: every status note on the shelf, read so that a
 * refresh costs one request when nothing has changed.
 *
 * The notes are one file per run in `work/runs/<yyyy-mm>/`, and a note still
 * waiting on the owner can be months old, so every month is read, never only
 * the recent ones. Read through the contents API, that is one request per
 * month and one more per note, every time. Instead:
 *
 * - **One request lists them all.** GitHub's git trees API, asked for
 *   `<branch>:work/runs` with `recursive=1`, answers with every file under it
 *   and its blob sha, git's fingerprint of the file's bytes. A listing GitHub
 *   cuts short (`truncated`, past 100,000 entries) is read again month folder
 *   by month folder.
 * - **A note is fetched only when its fingerprint is new.** Notes are fetched
 *   by blob sha and kept in a cache keyed by it, so an unchanged note is never
 *   fetched again and a changed one, having a new sha, is fetched once. Each
 *   fetched note must hash to its sha before it is kept, so an answer that is
 *   not the note asked for (a cache or proxy gone wrong) cannot plant one.
 *
 * Every request goes through `reach`, carries the unique `unshared` mark every
 * shelf read carries, and is `no-store` (`shelf-request.ts`; why, at the head
 * of `shelf.ts`). Parsing is core's `readNotes`: a malformed or misnamed note
 * is reported with its reasons and never hides the rest.
 *
 * Browser-only.
 */
import { RUNS_ROOT, notesInRunsTree, type RunsTreeEntry, type ShelfConfig } from '@core/sync'
import { readNotes, type NoteFile, type ReadNotes, type UnreadableNote } from '@core/work'
import { ShelfError, checkShelf } from './shelf'
import { blobSha } from './shelf-attempt'
import { reach } from './shelf-fetch'
import { API, NO_CACHE, headers, unshared } from './shelf-request'

/** Notes' text by blob sha. A sha names one content forever, so an entry never goes stale. */
export interface NoteCache {
  get(sha: string): string | undefined
  set(sha: string, text: string): void
  /** Forget every note the shelf no longer lists, and keep the rest. */
  keepOnly(shas: ReadonlySet<string>): void
}

/** A cache for this page only. */
export function memoryNoteCache(): NoteCache {
  const notes = new Map<string, string>()
  return {
    get: (sha) => notes.get(sha),
    set: (sha, text) => void notes.set(sha, text),
    keepOnly: (shas) => {
      for (const sha of [...notes.keys()]) if (!shas.has(sha)) notes.delete(sha)
    }
  }
}

const DEVICE_KEY = 'pdbf.workroom.notes'

/**
 * A cache kept on the device as well, so reopening the app fetches only what
 * changed while it was closed. Written once per read, after it is trimmed to
 * what the shelf lists. A device that will not store it (private browsing,
 * storage full) still has this page's copy: a lost cache costs requests,
 * never a note.
 */
export function deviceNoteCache(storage: Storage | null = deviceStorage()): NoteCache {
  const notes = new Map<string, string>()
  try {
    const stored = JSON.parse(storage?.getItem(DEVICE_KEY) ?? '{}') as unknown
    if (stored && typeof stored === 'object') {
      for (const [sha, text] of Object.entries(stored)) {
        if (typeof text === 'string') notes.set(sha, text)
      }
    }
  } catch {
    /* an unreadable record is an empty cache */
  }
  return {
    get: (sha) => notes.get(sha),
    set: (sha, text) => void notes.set(sha, text),
    keepOnly: (shas) => {
      for (const sha of [...notes.keys()]) if (!shas.has(sha)) notes.delete(sha)
      try {
        storage?.setItem(DEVICE_KEY, JSON.stringify(Object.fromEntries(notes)))
      } catch {
        /* storage full or refused: this page's copy still serves */
      }
    }
  }
}

function deviceStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export interface WorkNotes extends ReadNotes {
  /** How many note files the shelf lists. */
  listed: number
  /** How many of them were fetched by this read (new or changed). */
  fetched: number
}

/** How many notes are fetched at once. */
const AT_ONCE = 6

/** Every note on the shelf, fetching only those the cache does not hold. */
export async function readWorkNotes(config: ShelfConfig, cache: NoteCache): Promise<WorkNotes> {
  const listing = await listRuns(config)
  const wanted = notesInRunsTree(listing)
  const files: NoteFile[] = []
  const unreadable: UnreadableNote[] = []
  // One fetch per content: a note copied by hand under a second name has the same sha.
  const missing = [
    ...new Map(wanted.filter((w) => cache.get(w.sha) === undefined).map((w) => [w.sha, w])).values()
  ]
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < missing.length) {
      const note = missing[next++]!
      const problem = await fetchNote(config, note.sha, cache)
      if (problem) unreadable.push({ path: note.path, problems: [problem] })
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, missing.length) }, worker))
  for (const w of wanted) {
    const text = cache.get(w.sha)
    if (text !== undefined) files.push({ path: w.path, text })
  }
  cache.keepOnly(new Set(wanted.map((w) => w.sha)))
  const read = readNotes(files)
  return {
    notes: read.notes,
    unreadable: [...read.unreadable, ...unreadable].sort((a, b) => cmp(a.path, b.path)),
    listed: wanted.length,
    fetched: missing.length
  }
}

/** A read of GitHub's git database, marked as every shelf read is. */
function gitReadUrl(config: ShelfConfig, rest: string): string {
  return `${API}/repos/${config.repo}/git/${rest}${rest.includes('?') ? '&' : '?'}unshared=${unshared()}`
}

/** Every entry under `work/runs`, from one request (or one per month, for a listing cut short). */
async function listRuns(config: ShelfConfig): Promise<RunsTreeEntry[]> {
  const where = `${encodeURIComponent(config.branch)}:${RUNS_ROOT}`
  const response = await reach(gitReadUrl(config, `trees/${where}?recursive=1`), {
    headers: headers(config),
    cache: NO_CACHE
  })
  if (response.status === 404 || response.status === 409) {
    // No `work/runs` yet, which is a shelf no agent has reported to; or a
    // repository the token cannot see, which `checkShelf` names as that.
    await checkShelf(config)
    return []
  }
  if (!response.ok) throw refused(response, 'listing the status notes')
  const tree = treeOf(await response.json().catch(() => null))
  if (!tree.truncated) return tree.entries
  const months = await treeAt(config, tree.sha)
  const entries: RunsTreeEntry[] = []
  for (const month of months.entries.filter((e) => e.type === 'tree')) {
    const inside = await treeAt(config, month.sha)
    for (const e of inside.entries) entries.push({ ...e, path: `${month.path}/${e.path}` })
  }
  return entries
}

async function treeAt(config: ShelfConfig, sha: string): Promise<ParsedTree> {
  const response = await reach(gitReadUrl(config, `trees/${encodeURIComponent(sha)}`), {
    headers: headers(config),
    cache: NO_CACHE
  })
  if (!response.ok) throw refused(response, 'listing a month of status notes')
  return treeOf(await response.json().catch(() => null))
}

interface ParsedTree {
  sha: string
  truncated: boolean
  entries: RunsTreeEntry[]
}

/** A trees answer, checked: a reply this does not understand is never "no notes". */
function treeOf(body: unknown): ParsedTree {
  const b = body as { sha?: unknown; truncated?: unknown; tree?: unknown } | null
  if (!b || typeof b.sha !== 'string' || !Array.isArray(b.tree)) {
    throw new ShelfError('GitHub did not answer with a listing of the status notes.', null)
  }
  const entries = b.tree.filter(
    (e): e is RunsTreeEntry =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as RunsTreeEntry).path === 'string' &&
      typeof (e as RunsTreeEntry).type === 'string' &&
      typeof (e as RunsTreeEntry).sha === 'string'
  )
  return { sha: b.sha, truncated: b.truncated === true, entries }
}

/** Fetch one note by its sha into the cache; a problem with it, in words, or null. */
async function fetchNote(
  config: ShelfConfig,
  sha: string,
  cache: NoteCache
): Promise<string | null> {
  const response = await reach(gitReadUrl(config, `blobs/${encodeURIComponent(sha)}`), {
    headers: headers(config, 'application/vnd.github.raw'),
    cache: NO_CACHE
  })
  if (response.status === 404) {
    return 'The shelf listed this note but did not have it when asked (it changed while being read). The next read tries again.'
  }
  if (!response.ok) throw refused(response, 'reading a status note')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if ((await blobSha(bytes)) !== sha) {
    return 'What came back is not this note (its fingerprint does not match), so it was not kept. The next read tries again.'
  }
  cache.set(sha, new TextDecoder().decode(bytes))
  return null
}

function refused(response: Response, what: string): ShelfError {
  if (response.status === 401) return new ShelfError('That token was rejected by GitHub.', 401)
  if (response.status === 403 || response.status === 429) {
    return new ShelfError(
      `GitHub refused ${what} (${response.status}). It may be limiting requests for a while; the Workroom tries again on its own.`,
      response.status
    )
  }
  return new ShelfError(`GitHub said ${response.status} when ${what}.`, response.status)
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
