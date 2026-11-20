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
import { databaseNotes, type DeviceNotes } from './note-store'
import { ShelfError, checkShelf } from './shelf'
import { blobSha } from './shelf-attempt'
import { reach } from './shelf-fetch'
import { API, NO_CACHE, headers, unshared } from './shelf-request'

/** Notes' text by blob sha. A sha names one content forever, so an entry never goes stale. */
export interface NoteCache {
  /** Bring in what the device kept; a read waits for it before asking for any note. */
  ready(): Promise<void>
  get(sha: string): string | undefined
  set(sha: string, text: string): void
  /** Forget every note the shelf no longer lists, and keep the rest. */
  keepOnly(shas: ReadonlySet<string>): void
}

/** A cache for this page only. */
export function memoryNoteCache(): NoteCache {
  const notes = new Map<string, string>()
  return {
    ready: () => Promise.resolve(),
    get: (sha) => notes.get(sha),
    set: (sha, text) => void notes.set(sha, text),
    keepOnly: (shas) => {
      for (const sha of [...notes.keys()]) if (!shas.has(sha)) notes.delete(sha)
    }
  }
}

export interface DeviceNoteCache extends NoteCache {
  /** Resolves once every write to the device asked for so far has been tried. */
  saved(): Promise<void>
}

/**
 * A cache kept on the device as well (`note-store.ts`: the Workroom's own
 * database, never `localStorage`), so reopening the app fetches only what
 * changed while it was closed. Written after a read that changed it, trimmed
 * to what the shelf lists; a read that changed nothing writes nothing. The
 * write is never waited for, so a slow or refused one cannot hold up the
 * screen; a refused one is tried again after the next read. A device that
 * keeps nothing (no database) has this page's copy only: a lost cache costs
 * requests, never a note.
 *
 * When the owner forgets the copy in Settings (in this tab or another), this
 * page's copy is dropped too, with any write not yet made, so the next read
 * fetches every note from the shelf and keeps it again.
 */
export function deviceNoteCache(device: DeviceNotes | null = databaseNotes()): DeviceNoteCache {
  const notes = new Map<string, string>()
  /** Notes fetched since the last write, and whether any note has gone since. */
  const added = new Map<string, string>()
  let trimmed = false
  let store = device
  let loading: Promise<void> | null = null
  let saving: Promise<void> = Promise.resolve()
  /** Counts the times the copy was forgotten; a load or write begun before one is dropped. */
  let forgotten = 0
  device?.onForget?.(() => {
    forgotten++
    notes.clear()
    added.clear()
    trimmed = false
  })
  return {
    ready: () =>
      (loading ??= (async () => {
        const since = forgotten
        const kept = await store?.load().catch(() => null)
        if (!kept) {
          store = null
          return
        }
        if (since !== forgotten) return
        for (const [sha, text] of kept) if (!notes.has(sha)) notes.set(sha, text)
      })()),
    get: (sha) => notes.get(sha),
    set: (sha, text) => {
      notes.set(sha, text)
      added.set(sha, text)
    },
    keepOnly: (shas) => {
      for (const sha of [...notes.keys()]) {
        if (!shas.has(sha)) trimmed = notes.delete(sha) || trimmed
      }
      const target = store
      if (!target || (added.size === 0 && !trimmed)) return
      const add = new Map(added)
      const keep = new Set(shas)
      const since = forgotten
      added.clear()
      trimmed = false
      saving = saving.then(async () => {
        if (since !== forgotten) return
        const ok = await target.save(add, keep).catch(() => false)
        if (ok || since !== forgotten) return
        // Refused (storage full, or the database busy): try again after the next read.
        trimmed = true
        for (const [sha, text] of add)
          if (notes.get(sha) === text && !added.has(sha)) added.set(sha, text)
      })
    },
    saved: () => saving
  }
}

export interface WorkNotes extends ReadNotes {
  /** How many note files the shelf lists. */
  listed: number
  /** How many notes this read fetched and kept (new or changed); a failed fetch is not one. */
  fetched: number
}

/** How many notes are fetched at once. */
const AT_ONCE = 6

/** Every note on the shelf, fetching only those the cache does not hold. */
export async function readWorkNotes(config: ShelfConfig, cache: NoteCache): Promise<WorkNotes> {
  const [listing] = await Promise.all([listRuns(config), cache.ready()])
  const wanted = notesInRunsTree(listing)
  const files: NoteFile[] = []
  const unreadable: UnreadableNote[] = []
  // This read's own copy of every text it has, so a cache dropped while it is
  // on its way (the owner forgetting it in Settings) cannot leave a hole in it.
  const have = new Map<string, string>()
  for (const w of wanted) {
    const text = cache.get(w.sha)
    if (text !== undefined) have.set(w.sha, text)
  }
  // One fetch per content: a note copied by hand under a second name has the same sha.
  const missing = [
    ...new Map(wanted.filter((w) => !have.has(w.sha)).map((w) => [w.sha, w])).values()
  ]
  let next = 0
  let fetched = 0
  const worker = async (): Promise<void> => {
    while (next < missing.length) {
      const note = missing[next++]!
      const got = await fetchNote(config, note.sha)
      if (got.problem !== null) {
        unreadable.push({ path: note.path, problems: [got.problem] })
        continue
      }
      cache.set(note.sha, got.text)
      have.set(note.sha, got.text)
      fetched++
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, missing.length) }, worker))
  for (const w of wanted) {
    const text = have.get(w.sha)
    if (text !== undefined) files.push({ path: w.path, text })
  }
  cache.keepOnly(new Set(wanted.map((w) => w.sha)))
  const read = readNotes(files)
  return {
    notes: read.notes,
    unreadable: [...read.unreadable, ...unreadable].sort((a, b) => cmp(a.path, b.path)),
    listed: wanted.length,
    fetched
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
    // repository the token cannot see, or a branch the shelf does not have,
    // each named as that rather than shown as an empty board.
    await confirmBranch(config)
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

/** The branch Settings names, on a shelf the token can see: if not, a plain reason. */
async function confirmBranch(config: ShelfConfig): Promise<void> {
  const shelf = await checkShelf(config)
  const branch = config.branch.split('/').map(encodeURIComponent).join('/')
  const response = await reach(gitReadUrl(config, `ref/heads/${branch}`), {
    headers: headers(config),
    cache: NO_CACHE
  })
  // 409 is GitHub's answer for a repository with nothing in it yet: no notes.
  if (response.ok || response.status === 409) return
  if (response.status === 404)
    throw new NoSuchBranch(config.branch, shelf.repo, shelf.defaultBranch)
  throw refused(response, 'checking the shelf’s branch')
}

/** Settings names a branch the shelf does not have. */
export class NoSuchBranch extends ShelfError {
  constructor(branch: string, repo: string, usual: string) {
    super(
      `The shelf ${repo} has no branch called “${branch}”, so there are no notes to read there. ` +
        `Its usual branch is “${usual}”: correct the branch in Settings.`,
      404
    )
    this.name = 'NoSuchBranch'
  }
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

/** One note fetched by its sha: its text, or a problem with it in words. */
async function fetchNote(
  config: ShelfConfig,
  sha: string
): Promise<{ text: string; problem: null } | { text: null; problem: string }> {
  const response = await reach(gitReadUrl(config, `blobs/${encodeURIComponent(sha)}`), {
    headers: headers(config, 'application/vnd.github.raw'),
    cache: NO_CACHE
  })
  if (response.status === 404) {
    return {
      text: null,
      problem:
        'The shelf listed this note but did not have it when asked (it changed while being read). The next read tries again.'
    }
  }
  if (!response.ok) throw refused(response, 'reading a status note')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if ((await blobSha(bytes)) !== sha) {
    return {
      text: null,
      problem:
        'What came back is not this note (its fingerprint does not match), so it was not kept. The next read tries again.'
    }
  }
  return { text: new TextDecoder().decode(bytes), problem: null }
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
