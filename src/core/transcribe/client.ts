/**
 * The model client, behind an injectable transport.
 *
 * The request *shape* is domain logic — it encodes the schema, the caching
 * strategy, and the effort setting — so it lives in `core` and is unit-tested
 * with a mock transport. Only the actual `fetch` lives in the platform layer.
 * No network access is needed to test any of this.
 */
import { PAGE_SCHEMA, parsePageTranscription, type PageTranscription } from './schema'

export const API_BASE = 'https://api.anthropic.com'
const API_URL = `${API_BASE}/v1/messages`
const API_VERSION = '2023-06-01'

/**
 * The headers every call to the API carries.
 *
 * One function rather than a literal repeated at each call site, because two of
 * these headers are load-bearing and one of them is the user's key. A second
 * copy is a second place to forget the browser-access opt-in, and — far worse —
 * a second place that could start logging the key.
 */
export function apiHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    // The key never leaves the user's browser; this opts the request into
    // direct browser use rather than routing through a server we don't have.
    'anthropic-dangerous-direct-browser-access': 'true'
  }
}

/** Whatever performs the HTTP call. Mocked in tests. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>

export interface ClientConfig {
  apiKey: string
  modelId: string
  /**
   * Thinking depth / token spend. Transcription is perception, not reasoning,
   * so a low setting is both cheaper and no worse here.
   */
  effort?: 'low' | 'medium' | 'high'
  maxTokens?: number
  transport?: Transport
}

export interface PageRequest {
  pageIndex: number
  /** Base64 PNG of the page image, without a data: prefix. */
  imageBase64: string
  systemPrompt: string
  userPrompt: string
}

/** Build the request body. Exported so tests can assert on it without a network. */
export function buildRequestBody(config: ClientConfig, req: PageRequest): Record<string, unknown> {
  return {
    model: config.modelId,
    max_tokens: config.maxTokens ?? 8000,
    // The system prompt is identical for every page of a run, so caching it
    // makes the per-page cost essentially just the image plus the reply.
    system: [
      {
        type: 'text',
        text: req.systemPrompt,
        cache_control: { type: 'ephemeral' }
      }
    ],
    output_config: {
      effort: config.effort ?? 'medium',
      format: {
        type: 'json_schema',
        schema: PAGE_SCHEMA
      }
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: req.imageBase64 }
          },
          { type: 'text', text: req.userPrompt }
        ]
      }
    ]
  }
}

export interface ApiUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export interface PageResult {
  transcription: PageTranscription
  usage: ApiUsage
}

/** Thrown for API-level failures, carrying whether a retry could help. */
export class TranscribeError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'TranscribeError'
  }
}

/**
 * The JSON a completed message carries, and what it cost.
 *
 * Exported because a batch result holds *the same message object* the Messages
 * endpoint returns — it just arrives a day later inside a JSONL line instead of
 * as an HTTP body. Reading it in a second place would mean a second reading of
 * the refusal stop reason and a second way to mis-handle a page.
 */
export function readMessage(body: unknown): { json: unknown; usage: ApiUsage } {
  return { json: extractJson(body), usage: usageOf(body) }
}

function extractJson(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) {
    throw new TranscribeError('Malformed API response', null, false)
  }
  const record = body as Record<string, unknown>

  // A refusal is a successful HTTP response with no usable content — check the
  // stop reason before reading content, or this throws confusingly.
  if (record['stop_reason'] === 'refusal') {
    throw new TranscribeError(
      'The model declined to process this page. Skipping it and continuing.',
      null,
      false
    )
  }

  const content = record['content']
  if (!Array.isArray(content)) {
    throw new TranscribeError('API response had no content', null, false)
  }
  const textBlock = content.find(
    (b): b is { type: string; text: string } =>
      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text'
  )
  if (!textBlock) throw new TranscribeError('API response had no text block', null, false)

  try {
    return JSON.parse(textBlock.text)
  } catch {
    throw new TranscribeError('Model reply was not valid JSON', null, true)
  }
}

function usageOf(body: unknown): ApiUsage {
  const u = (body as { usage?: Record<string, number> })?.usage ?? {}
  return {
    inputTokens: u['input_tokens'] ?? 0,
    outputTokens: u['output_tokens'] ?? 0,
    cacheReadTokens: u['cache_read_input_tokens'] ?? 0
  }
}

/**
 * Post a request body and return the structured reply.
 *
 * The single place an API key is put on a request and an HTTP failure is
 * classified as retryable. Both of the app's model passes go through here: a
 * second copy would be a second place to get the browser-access header wrong,
 * and — worse — a second place that could start logging the key.
 *
 * Throws `TranscribeError`; the caller's runner decides on retry.
 */
export async function callModel(
  config: ClientConfig,
  body: Record<string, unknown>
): Promise<{ json: unknown; usage: ApiUsage }> {
  const transport = config.transport ?? fetch
  const response = await transport(API_URL, {
    method: 'POST',
    headers: apiHeaders(config.apiKey),
    body: JSON.stringify(body)
  })

  await throwIfFailed(response)
  return readMessage((await response.json()) as unknown)
}

/**
 * Turn a failed HTTP response into a `TranscribeError` carrying the API's own
 * message, or return quietly when it succeeded.
 *
 * Shared with the batch endpoints, which fail in exactly the same shapes and
 * need the same retryable/not decision.
 */
export async function throwIfFailed(response: Response): Promise<void> {
  if (response.ok) return
  const status = response.status
  // 429 and 5xx are transient; 4xx are the caller's problem and won't improve on retry.
  const retryable = status === 429 || status >= 500
  let detail = ''
  try {
    detail = ((await response.json()) as { error?: { message?: string } })?.error?.message ?? ''
  } catch {
    /* body wasn't JSON; the status alone is the message */
  }
  throw new TranscribeError(`API error ${status}${detail ? `: ${detail}` : ''}`, status, retryable)
}

/** Transcribe one page. Throws `TranscribeError`; the runner decides on retry. */
export async function transcribePage(config: ClientConfig, req: PageRequest): Promise<PageResult> {
  const { json, usage } = await callModel(config, buildRequestBody(config, req))
  return { transcription: parsePageTranscription(json, req.pageIndex), usage }
}

/** Cheap credential check so a bad key fails before a whole-book run starts. */
export async function validateApiKey(
  apiKey: string,
  transport: Transport = fetch
): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await transport(API_URL, {
      method: 'POST',
      headers: apiHeaders(apiKey),
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      })
    })
    if (response.ok) return { ok: true }
    if (response.status === 401) return { ok: false, message: 'That API key was rejected.' }
    return { ok: false, message: `Could not reach the API (${response.status}).` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' }
  }
}
