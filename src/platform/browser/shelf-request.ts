/**
 * What every request to the shelf carries: the API's address, the headers
 * with the token, `no-store`, and the unique mark on every read. Moved out of
 * `shelf.ts` (which builds its contents reads with them in `readUrl`) so the
 * Workroom's reader (`shelf-notes.ts`), which reads through GitHub's git
 * trees and blobs, carries exactly the same mark from the same counter.
 *
 * Why each piece exists is told at the head of `shelf.ts`: a read answered
 * out of any cache, the browser's or a shared one, once took rulings off the
 * shelf. The token is the user's and goes to `api.github.com` only.
 *
 * Browser-only.
 */
import type { ShelfConfig } from '@core/sync'

export const API = 'https://api.github.com'

/**
 * Every read of the shelf goes to the network.
 *
 * Not a tuning choice: see the note on the ETag at the head of `shelf.ts`.
 * `no-store` also keeps the *response* out of the cache, which is what stops
 * one read shadowing the next one's answer.
 */
export const NO_CACHE = 'no-store' as const

/**
 * A counter beside the clock, because the clock is not fine enough.
 *
 * `Date.now()` is milliseconds, and two reads of one path inside a millisecond
 * (a flush reading the book and then a picture, a gate fetching two crops)
 * would produce the same URL and hand the second one the first one's answer.
 * That is the whole fault again, in the small. The counter makes the property
 * hold for *every* read rather than for reads that happen to be far enough
 * apart, which is the distinction this module has now got wrong twice.
 */
let reads = 0

/**
 * The `unshared` value of one read: never given to any other read, so no
 * cache anywhere can already hold an answer for its URL. Every read of the
 * shelf carries one (`readUrl` in `shelf.ts`, `gitReadUrl` in
 * `shelf-notes.ts`).
 */
export function unshared(): string {
  return `${Date.now()}-${++reads}`
}

export function headers(config: ShelfConfig, accept = 'application/vnd.github+json'): HeadersInit {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28'
  }
}
