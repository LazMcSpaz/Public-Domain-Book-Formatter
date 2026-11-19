/**
 * The one call that reaches GitHub, so "no answer" means exactly that.
 *
 * `fetch` rejects with a `TypeError` for every network failure in every
 * browser ("Load failed" in Safari and on every iPhone browser, "Failed to
 * fetch" in Chrome, "NetworkError when attempting to fetch resource" in
 * Firefox). But a `TypeError` is also what our own code throws for a slip such
 * as reading a field of `undefined`, and a note that blamed the connection for
 * that would send the editor off to check the wifi for a fault in the app. So
 * every shelf request goes through `reach`, which turns a rejected `fetch`
 * (and only that) into `NoAnswer`, and `attempt` (`shelf-attempt.ts`) reports
 * only `NoAnswer` as "got no answer".
 *
 * Browser-only.
 */

/**
 * The browser got nothing back from GitHub at all: `fetch` itself rejected.
 *
 * Still a `TypeError`, as `fetch`'s own error is, so code that tells a network
 * failure that way reads it as before.
 */
export class NoAnswer extends TypeError {
  constructor(said: string) {
    super(said)
    this.name = 'NoAnswer'
  }
}

/** `fetch`, with its rejection named as `NoAnswer`. Every shelf request uses it. */
export async function reach(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    throw new NoAnswer(err instanceof Error ? err.message : String(err))
  }
}
