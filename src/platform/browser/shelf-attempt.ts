/**
 * A shelf request that fails says which request it was.
 *
 * What reached the editor from the phone was "Could not reach the shelf (Load
 * failed)". "Load failed" is WebKit's whole message for a request that got no
 * answer (blocked, refused by the browser, cut off, or answered without the
 * header a browser needs before it will show a cross-origin answer), and a
 * flush makes four requests, so the sentence could not even say which one.
 * Reading worked on the same device in the same minute, which is the most
 * useful fact there was, and nothing on the screen could show it.
 *
 * So every request a flush makes goes through `attempt`, which names it, times
 * it and keeps the browser's own words. A failure then reads as "Writing the
 * book file (3.0 MB) got no answer: the browser gave up after 0.4 seconds and
 * said “Load failed”", which tells a request refused at once from an upload
 * cut off halfway or a server that never answered, without anybody having to
 * attach a debugger to a phone.
 *
 * Browser-only, though nothing here needs more than `fetch`'s errors and
 * `crypto.subtle`.
 */
import { ShelfError } from './shelf'

/** One shelf request that did not succeed, in the words the note needs. */
export interface ShelfFailure {
  /** What was being done, in the editor's words: "writing the book file". */
  what: string
  /** Bytes sent, for a write; null for a read. */
  bytes: number | null
  /** How long the request ran before it failed, in milliseconds. */
  ms: number
  /**
   * `refused`: GitHub answered and said no (its status is in `status`).
   * `no-answer`: the browser got nothing back at all (`fetch` rejected).
   * `failed`: anything else, such as an answer that could not be read.
   */
  kind: 'refused' | 'no-answer' | 'failed'
  status: number | null
  /** The browser's or GitHub's own words, unchanged. */
  said: string
  /**
   * Whether reading the same file worked straight afterwards, when that was
   * asked. True says the connection is up and it is this request that did not
   * get through; false says the connection itself is down.
   */
  readsWork?: boolean
}

export class ShelfStepError extends Error {
  readonly failure: ShelfFailure
  constructor(failure: ShelfFailure) {
    super(describeFailure(failure))
    this.name = 'ShelfStepError'
    this.failure = failure
  }
}

/**
 * Run one shelf request, and fail with its name, its size and its time.
 *
 * `fetch` rejects with a `TypeError` for every network failure in every
 * browser ("Load failed" in Safari and on every iPhone browser, "Failed to
 * fetch" in Chrome, "NetworkError when attempting to fetch resource" in
 * Firefox), and with nothing else, so that is what "no answer" means here.
 */
export async function attempt<T>(
  what: string,
  bytes: number | null,
  run: () => Promise<T>,
  clock: () => number = () => Date.now()
): Promise<T> {
  const started = clock()
  try {
    return await run()
  } catch (err) {
    if (err instanceof ShelfStepError) throw err
    const ms = Math.max(0, clock() - started)
    const said = err instanceof Error ? err.message : String(err)
    if (err instanceof ShelfError) {
      throw new ShelfStepError({ what, bytes, ms, kind: 'refused', status: err.status, said })
    }
    const kind = err instanceof TypeError ? 'no-answer' : 'failed'
    throw new ShelfStepError({ what, bytes, ms, kind, status: null, said })
  }
}

/** A size as the editor would say it: "640 bytes", "12 KB", "3.0 MB". */
export function sizeInWords(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** "0.4 seconds", "12 seconds". */
export function secondsInWords(ms: number): string {
  const s = ms / 1000
  if (s < 10) return `${s.toFixed(1)} seconds`
  return `${Math.round(s)} seconds`
}

/** One failure as a sentence that names what to look at. */
export function describeFailure(failure: ShelfFailure): string {
  const what = failure.what.charAt(0).toUpperCase() + failure.what.slice(1)
  const size = failure.bytes === null ? '' : ` (${sizeInWords(failure.bytes)})`
  const reads =
    failure.readsWork === true
      ? ' Reading from the shelf still works, so the connection is up: it is this ' +
        'request that did not get through.'
      : failure.readsWork === false
        ? ' Reading from the shelf failed straight afterwards too, so the connection ' +
          'itself is down.'
        : ''
  if (failure.kind === 'no-answer') {
    return (
      `${what}${size} got no answer: the browser gave up after ` +
      `${secondsInWords(failure.ms)} and said “${failure.said}”.${reads}`
    )
  }
  if (failure.kind === 'refused') return `${what}${size} was refused. ${failure.said}${reads}`
  return `${what}${size} failed after ${secondsInWords(failure.ms)}: ${failure.said}${reads}`
}

/**
 * The name git gives these bytes as a file (its blob sha).
 *
 * The contents API hands out exactly this as a file's `sha`, so it is how the
 * app can tell, after a write got no answer, whether the shelf now holds what
 * was sent: the write landed and only the answer was lost on the way back.
 */
export async function blobSha(bytes: Uint8Array): Promise<string> {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`)
  const all = new Uint8Array(head.length + bytes.length)
  all.set(head)
  all.set(bytes, head.length)
  const digest = await crypto.subtle.digest('SHA-1', all)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
