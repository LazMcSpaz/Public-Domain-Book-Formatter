/**
 * Whether this browser can reach the Batches API at all.
 *
 * ## The thing this exists for
 *
 * `anthropic-dangerous-direct-browser-access` is what lets a page with no
 * server behind it call the API directly. It is an opt-in the server honours
 * per endpoint, and **as of writing it covers `/v1/messages` and not
 * `/v1/messages/batches`**. Measured, not assumed — a preflight for the batch
 * paths comes back `400 Disallowed CORS origin` with no
 * `access-control-allow-origin`, for every origin, while the same preflight for
 * `/v1/messages` returns `200` and `access-control-allow-origin: *`.
 *
 * There is no way around that from inside a page. A CORS refusal is enforced by
 * the browser, and the usual answer — proxy it through your own server — is the
 * one thing this app has deliberately never had. So the honest thing is not to
 * offer the door and then fail on the first click with a message about
 * cross-origin policy, which is a sentence nobody outside this trade can act
 * on. It is to *ask the server* and offer what is actually there.
 *
 * ## Why a probe rather than a constant
 *
 * A constant saying "batches don't work in browsers" would be right today and
 * silently wrong the day the header is extended, and nothing would notice for a
 * year. This asks. If the endpoint starts answering, the option appears with no
 * change here — and the cost is one free request per session.
 *
 * ## What a failure means
 *
 * A CORS refusal and a dead network are the *same* `TypeError` in JavaScript —
 * the browser deliberately tells a page nothing about why a cross-origin
 * request was refused. So this cannot distinguish them, and does not pretend
 * to. Both are correctly "you cannot submit a batch right now"; an offline
 * browser cannot upload three hundred leaves either.
 *
 * Any *response at all* is a pass, including a 401 from a bad key: reaching the
 * server to be told the key is wrong is proof the browser was allowed to ask.
 *
 * Browser-only.
 */
import { API_BASE, apiHeaders } from '@core/transcribe'

/** Listing batches — free, tiny, and the cheapest thing on that path. */
const PROBE_URL = `${API_BASE}/v1/messages/batches?limit=1`

/**
 * Cached for the session.
 *
 * The answer is a fact about the server's CORS policy and this origin, neither
 * of which changes while a tab is open, and the transcribe gate would otherwise
 * re-ask on every render.
 */
let cached: Promise<boolean> | null = null

export async function canReachBatchApi(apiKey: string): Promise<boolean> {
  if (!cached) cached = probe(apiKey)
  return cached
}

async function probe(apiKey: string): Promise<boolean> {
  try {
    await fetch(PROBE_URL, { method: 'GET', headers: apiHeaders(apiKey) })
    return true
  } catch {
    return false
  }
}

/** Forget the cached answer. For tests, and for a key change. */
export function forgetBatchReach(): void {
  cached = null
}
