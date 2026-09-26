/**
 * Making a picture, on Replicate, from the browser.
 *
 * ## The same door, and the same honesty about it
 *
 * This app has no server. That is what makes it what it is, and it is also why
 * `batch-reach.ts` exists: the Anthropic batch endpoints refuse a browser
 * origin, so the app *asks the server once* and withdraws the offer rather than
 * failing on the first click with a sentence about cross-origin policy.
 *
 * Replicate is the same shape of problem and gets the same treatment. Whether
 * `api.replicate.com` answers a browser is a fact about their CORS policy, not
 * about this code, and it is a fact that can change without warning in either
 * direction. So it is **probed, not assumed** — one free request per session
 * against `/v1/account` — and the studio only offers to generate art when the
 * answer comes back yes. When it comes back no the arm is undiminished in every
 * other respect: a plate from the book, an uploaded file and a typographic
 * cover all still work, and a picture made elsewhere can be dropped straight in.
 *
 * ## The token
 *
 * The user's own, stored beside the API key, sent only to Replicate, and never
 * written into a book file — a credential that reached one would be published
 * the moment that book was saved to a shelf. It is never logged, never put in a
 * prompt, and never crosses the control channel.
 *
 * Browser-only.
 */
import { nearestAspectRatio, predictionInput, type Rect } from '@core/cover'

export const REPLICATE_BASE = 'https://api.replicate.com'

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
}

let reachCache: Promise<boolean> | null = null

/**
 * Whether this browser can reach Replicate at all.
 *
 * Any response is a pass, a 401 from a bad token included: being told the token
 * is wrong is proof the browser was allowed to ask. A CORS refusal and a dead
 * network are the same `TypeError` in JavaScript — the browser tells a page
 * nothing about why a cross-origin request was refused — so this does not
 * pretend to tell them apart. Both are correctly "you cannot generate a
 * picture right now".
 */
export async function canReachReplicate(token: string): Promise<boolean> {
  if (!reachCache) reachCache = probe(token)
  return reachCache
}

async function probe(token: string): Promise<boolean> {
  try {
    await fetch(`${REPLICATE_BASE}/v1/account`, { method: 'GET', headers: headers(token) })
    return true
  } catch {
    return false
  }
}

/** Forget the cached answer. For tests, and for a token change. */
export function forgetReplicateReach(): void {
  reachCache = null
}

export interface GenerateArtInput {
  token: string
  /** `owner/name`, e.g. `black-forest-labs/flux-1.1-pro-ultra`. */
  model: string
  prompt: string
  negative: string
  /** The frame the picture has to fill, in inches — decides the aspect ratio. */
  frame: Pick<Rect, 'width' | 'height'>
  seed: number | null
  signal?: AbortSignal
  /** Called as the prediction moves through its states, for the progress line. */
  onStatus?: (status: string) => void
}

export interface GeneratedArt {
  /** PNG or JPEG bytes, as the model produced them. */
  bytes: Uint8Array
  /** Replicate's own id for the run — the address of the thing that was billed. */
  predictionId: string
  model: string
  prompt: string
  seed: number | null
  /** Measured from the returned pixels, never taken from what was asked for. */
  widthPx: number
  heightPx: number
  /** Anything that could not be asked for on this model. */
  notes: string[]
}

interface PredictionResponse {
  id?: string
  status?: string
  output?: unknown
  error?: unknown
  detail?: string
}

function firstUrl(output: unknown): string | null {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    for (const entry of output) {
      const url = firstUrl(entry)
      if (url) return url
    }
  }
  return null
}

/**
 * Run one prediction and bring the pixels back.
 *
 * Created against the *model* path rather than a pinned version, because a
 * version hash goes stale silently and the failure — "model version not found"
 * — arrives at the moment somebody is trying to finish a cover.
 *
 * `Prefer: wait` asks Replicate to hold the connection until the run finishes,
 * which for an image is usually seconds; the poll below is the fallback for
 * when it does not, and the only reason this is not a one-liner.
 */
export async function generateCoverArt(input: GenerateArtInput): Promise<GeneratedArt> {
  const aspectRatio = nearestAspectRatio(input.frame)
  const spec = predictionInput(input.model, {
    prompt: input.prompt,
    negative: input.negative,
    aspectRatio,
    seed: input.seed
  })

  input.onStatus?.('asking')
  const created = await fetch(`${REPLICATE_BASE}/v1/models/${input.model}/predictions`, {
    method: 'POST',
    headers: { ...headers(input.token), Prefer: 'wait' },
    body: JSON.stringify({ input: spec.input }),
    ...(input.signal ? { signal: input.signal } : {})
  })

  if (!created.ok) {
    const body = (await created.json().catch(() => ({}))) as PredictionResponse
    // The API's own words, which say things like "field X is required" that no
    // message written here could. The token is not in this string.
    throw new Error(
      `Replicate refused the request (${created.status}): ${body.detail ?? JSON.stringify(body.error ?? body)}`
    )
  }

  let prediction = (await created.json()) as PredictionResponse
  const predictionId = prediction.id ?? ''

  // Poll until it settles. A picture is seconds, not minutes, so this is a
  // short loop with a plain interval rather than a backoff.
  const deadline = Date.now() + 5 * 60 * 1000
  while (prediction.status && !['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
    if (Date.now() > deadline) {
      throw new Error(
        `The picture did not come back within five minutes. Replicate still has it as ${predictionId}.`
      )
    }
    input.onStatus?.(prediction.status)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    if (input.signal?.aborted) throw new Error('Cancelled.')
    const next = await fetch(`${REPLICATE_BASE}/v1/predictions/${predictionId}`, {
      headers: headers(input.token),
      ...(input.signal ? { signal: input.signal } : {})
    })
    prediction = (await next.json()) as PredictionResponse
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(
      `The run ${prediction.status ?? 'did not finish'}: ${String(prediction.error ?? 'no reason given')}`
    )
  }

  const url = firstUrl(prediction.output)
  if (!url) throw new Error('The run finished but returned no picture.')

  input.onStatus?.('fetching')
  const file = await fetch(url, { ...(input.signal ? { signal: input.signal } : {}) })
  if (!file.ok) throw new Error(`The picture could not be downloaded (${file.status}).`)
  const bytes = new Uint8Array(await file.arrayBuffer())

  // Measured from the pixels that arrived, not from what was requested. A model
  // that quietly returned a megapixel when four were asked for would otherwise
  // sail through the DPI check on the strength of the request.
  const { widthPx, heightPx } = await measurePng(bytes)

  return {
    bytes,
    predictionId,
    model: input.model,
    prompt: input.prompt,
    seed: input.seed,
    widthPx,
    heightPx,
    notes: spec.notes
  }
}

async function measurePng(bytes: Uint8Array): Promise<{ widthPx: number; heightPx: number }> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer])
  const bitmap = await createImageBitmap(blob)
  try {
    return { widthPx: bitmap.width, heightPx: bitmap.height }
  } finally {
    bitmap.close()
  }
}
