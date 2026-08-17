import { describe, it, expect } from 'vitest'
import {
  BATCH_LIMITS,
  buildBatchRequest,
  cancelBatch,
  createBatch,
  customIdFor,
  estimateCost,
  fetchBatchResults,
  fits,
  pageIndexOf,
  parseBatchResults,
  parseBatchStatus,
  planBatches,
  retrieveBatch,
  sizeOfRequest,
  TranscribeError,
  type BatchRequest,
  type ClientConfig,
  type Transport
} from '@core/transcribe'

function config(transport: Transport): ClientConfig {
  return { apiKey: 'sk-test', modelId: 'claude-opus-5', transport }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

const goodPage = {
  role: 'body',
  blocks: [{ kind: 'paragraph', text: 'The alembick being set upon a gentle fire.' }],
  uncertain: [],
  furniture: {}
}

/** One line of the JSONL a finished batch produces. */
function resultLine(pageIndex: number, payload: unknown, usage: Record<string, number> = {}) {
  return JSON.stringify({
    custom_id: customIdFor(pageIndex),
    result: {
      type: 'succeeded',
      message: {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 10, ...usage }
      }
    }
  })
}

function batchBody(over: Record<string, unknown> = {}) {
  return {
    id: 'msgbatch_01',
    processing_status: 'in_progress',
    request_counts: { processing: 3, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
    results_url: null,
    created_at: '2026-08-17T10:00:00Z',
    expires_at: '2026-09-15T10:00:00Z',
    ...over
  }
}

function request(pageIndex: number, image = 'AAAA'): BatchRequest {
  return buildBatchRequest(
    config(() => Promise.resolve(jsonResponse({}))),
    {
      pageIndex,
      imageBase64: image,
      systemPrompt: 'system',
      userPrompt: 'user'
    }
  )
}

describe('naming the pages', () => {
  it('round-trips a page index through its custom id', () => {
    for (const index of [0, 7, 142, 99_999]) {
      expect(pageIndexOf(customIdFor(index))).toBe(index)
    }
  })

  it('sorts ids the way pages sort', () => {
    const ids = [customIdFor(10), customIdFor(2), customIdFor(100)]
    expect([...ids].sort()).toEqual([customIdFor(2), customIdFor(10), customIdFor(100)])
  })

  it('stays inside the API’s id rules', () => {
    expect(customIdFor(300)).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
  })

  it('refuses an id it did not write', () => {
    expect(pageIndexOf('request-1')).toBeNull()
    expect(pageIndexOf('page-')).toBeNull()
    expect(pageIndexOf('page-12x')).toBeNull()
  })
})

describe('chunking a submission', () => {
  it('always accepts the first request, however large', () => {
    expect(fits({ count: 0, bytes: 0 }, 999_999_999)).toBe(true)
  })

  it('refuses a request that would burst the byte budget', () => {
    const limits = { maxBytes: 100, maxRequests: 10 }
    expect(fits({ count: 1, bytes: 60 }, 40, limits)).toBe(true)
    expect(fits({ count: 1, bytes: 60 }, 41, limits)).toBe(false)
  })

  it('refuses a request that would burst the count', () => {
    const limits = { maxBytes: 1_000_000, maxRequests: 2 }
    expect(fits({ count: 1, bytes: 0 }, 1, limits)).toBe(true)
    expect(fits({ count: 2, bytes: 0 }, 1, limits)).toBe(false)
  })

  it('splits a book into batches that each fit', () => {
    const requests = Array.from({ length: 10 }, (_, i) => request(i, 'x'.repeat(1000)))
    const limits = { maxBytes: sizeOfRequest(requests[0]!) * 3, maxRequests: 100 }
    const batches = planBatches(requests, limits)

    expect(batches.length).toBe(4)
    for (const batch of batches) {
      const bytes = batch.reduce((n, r) => n + sizeOfRequest(r), 0)
      expect(bytes).toBeLessThanOrEqual(limits.maxBytes)
    }
    // Nothing lost and nothing reordered: a chunking that drops a leaf is a
    // book with a hole in it that nothing downstream can see.
    expect(batches.flat().map((r) => r.custom_id)).toEqual(requests.map((r) => r.custom_id))
  })

  it('puts an oversized page in a batch of its own rather than looping', () => {
    const limits = { maxBytes: 10, maxRequests: 100 }
    const batches = planBatches([request(0), request(1)], limits)
    expect(batches.map((b) => b.length)).toEqual([1, 1])
  })

  it('submits well under the API’s own ceiling', () => {
    // The body is stringified whole, so the limit that binds is the phone's.
    expect(BATCH_LIMITS.maxBytes).toBeLessThan(256 * 1024 * 1024)
  })

  it('carries the same request body the live path sends', () => {
    const built = request(4)
    expect(built.params['model']).toBe('claude-opus-5')
    expect(built.custom_id).toBe(customIdFor(4))
  })
})

describe('reading results back', () => {
  it('keys pages by custom id, not by the order they arrive in', () => {
    const jsonl = [resultLine(2, goodPage), resultLine(0, goodPage), resultLine(1, goodPage)].join(
      '\n'
    )
    const parsed = parseBatchResults(jsonl)
    expect(parsed.transcriptions.map((t) => t.pageIndex)).toEqual([0, 1, 2])
    expect(parsed.failures).toEqual([])
  })

  it('sums the usage across the file', () => {
    const parsed = parseBatchResults([resultLine(0, goodPage), resultLine(1, goodPage)].join('\n'))
    expect(parsed.usage.inputTokens).toBe(200)
    expect(parsed.usage.outputTokens).toBe(400)
    expect(parsed.usage.cacheReadTokens).toBe(20)
  })

  it('turns an errored request into a failure that says whether to retry', () => {
    const jsonl = JSON.stringify({
      custom_id: customIdFor(3),
      result: { type: 'errored', error: { type: 'invalid_request', message: 'image too large' } }
    })
    const parsed = parseBatchResults(jsonl)
    expect(parsed.transcriptions).toEqual([])
    expect(parsed.failures[0]?.pageIndex).toBe(3)
    expect(parsed.failures[0]?.message).toContain('image too large')
  })

  it('says plainly that an expired page cost nothing', () => {
    const jsonl = JSON.stringify({ custom_id: customIdFor(1), result: { type: 'expired' } })
    expect(parseBatchResults(jsonl).failures[0]?.message).toMatch(/nothing was charged/i)
  })

  /**
   * The rule the whole module turns on. A page that was paid for and did not
   * come back must be *reported*, exactly like a footnote that cannot be
   * placed — silence here is a book that prints without page 143 and nobody
   * finds out until it is on paper.
   */
  it('reports a page that was submitted and never came back', () => {
    const parsed = parseBatchResults(resultLine(0, goodPage), [0, 1, 2])
    expect(parsed.transcriptions.map((t) => t.pageIndex)).toEqual([0])
    expect(parsed.failures.map((f) => f.pageIndex)).toEqual([1, 2])
    expect(parsed.failures[0]?.message).toMatch(/nothing was returned/i)
  })

  it('reports a page whose line was unreadable rather than dropping it', () => {
    const jsonl = [resultLine(0, goodPage), '{ this is not json'].join('\n')
    const parsed = parseBatchResults(jsonl, [0, 1])
    expect(parsed.failures.map((f) => f.pageIndex)).toEqual([1])
  })

  it('reports a page whose reply was not a transcription', () => {
    const jsonl = JSON.stringify({
      custom_id: customIdFor(5),
      result: {
        type: 'succeeded',
        message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }
      }
    })
    const parsed = parseBatchResults(jsonl, [5])
    expect(parsed.transcriptions).toEqual([])
    expect(parsed.failures).toHaveLength(1)
  })

  it('carries a refusal through as a failure, not as an empty page', () => {
    const jsonl = JSON.stringify({
      custom_id: customIdFor(6),
      result: {
        type: 'succeeded',
        message: { stop_reason: 'refusal', content: [] }
      }
    })
    const parsed = parseBatchResults(jsonl, [6])
    expect(parsed.transcriptions).toEqual([])
    expect(parsed.failures[0]?.pageIndex).toBe(6)
  })

  it('notes an id belonging to no page of this book', () => {
    const jsonl = JSON.stringify({ custom_id: 'someone-elses-job', result: { type: 'expired' } })
    expect(parseBatchResults(jsonl).unrecognized).toEqual(['someone-elses-job'])
  })

  it('ignores blank lines', () => {
    const parsed = parseBatchResults(`\n${resultLine(0, goodPage)}\n\n`)
    expect(parsed.transcriptions).toHaveLength(1)
  })
})

describe('the four calls', () => {
  it('posts the requests and reads the batch back', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const status = await createBatch(
      config((url, init) => {
        seen = { url, init }
        return Promise.resolve(jsonResponse(batchBody()))
      }),
      [request(0)]
    )

    expect(status.id).toBe('msgbatch_01')
    expect(status.processingStatus).toBe('in_progress')
    expect(status.counts.processing).toBe(3)
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages/batches')
    const headers = seen!.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(JSON.parse(String(seen!.init.body))).toHaveProperty('requests')
  })

  it('refuses to submit an empty batch', async () => {
    await expect(
      createBatch(
        config(() => Promise.resolve(jsonResponse(batchBody()))),
        []
      )
    ).rejects.toThrow(TranscribeError)
  })

  it('reports an API failure with the API’s own message', async () => {
    await expect(
      createBatch(
        config(() => Promise.resolve(jsonResponse({ error: { message: 'batch too large' } }, 400))),
        [request(0)]
      )
    ).rejects.toThrow(/batch too large/)
  })

  it('retrieves a batch by id', async () => {
    let url = ''
    const status = await retrieveBatch(
      config((u) => {
        url = u
        return Promise.resolve(jsonResponse(batchBody({ processing_status: 'ended' })))
      }),
      'msgbatch_01'
    )
    expect(url).toBe('https://api.anthropic.com/v1/messages/batches/msgbatch_01')
    expect(status.processingStatus).toBe('ended')
  })

  it('follows the batch’s own results_url rather than a path built here', async () => {
    let url = ''
    await fetchBatchResults(
      config((u) => {
        url = u
        return Promise.resolve(new Response('{}'))
      }),
      { id: 'msgbatch_01', resultsUrl: 'https://elsewhere.example/results.jsonl' }
    )
    expect(url).toBe('https://elsewhere.example/results.jsonl')
  })

  it('falls back to the built path when the batch names no url', async () => {
    let url = ''
    await fetchBatchResults(
      config((u) => {
        url = u
        return Promise.resolve(new Response('{}'))
      }),
      { id: 'msgbatch_01', resultsUrl: null }
    )
    expect(url).toBe('https://api.anthropic.com/v1/messages/batches/msgbatch_01/results')
  })

  it('cancels', async () => {
    let url = ''
    const status = await cancelBatch(
      config((u) => {
        url = u
        return Promise.resolve(jsonResponse(batchBody({ processing_status: 'canceling' })))
      }),
      'msgbatch_01'
    )
    expect(url).toMatch(/\/cancel$/)
    expect(status.processingStatus).toBe('canceling')
  })

  it('refuses a batch object with no id', () => {
    expect(() => parseBatchStatus({ processing_status: 'ended' })).toThrow(TranscribeError)
  })

  it('reads an unknown processing status as still working', () => {
    // Never as `ended`: treating an unrecognised state as finished would fetch
    // results that do not exist and mark the batch collected.
    expect(parseBatchStatus(batchBody({ processing_status: 'whatever' })).processingStatus).toBe(
      'in_progress'
    )
  })
})

describe('what the batch door costs', () => {
  it('quotes half the immediate price', () => {
    const now = estimateCost({ pageCount: 300, modelId: 'claude-opus-5' })
    const batched = estimateCost({ pageCount: 300, modelId: 'claude-opus-5', batch: true })
    expect(batched.usd).toBeCloseTo(now.usd / 2, 2)
    expect(batched.usdLow).toBeCloseTo(now.usdLow / 2, 2)
    expect(batched.usdHigh).toBeCloseTo(now.usdHigh / 2, 2)
  })

  it('counts the same tokens either way', () => {
    const now = estimateCost({ pageCount: 50, modelId: 'claude-sonnet-5' })
    const batched = estimateCost({ pageCount: 50, modelId: 'claude-sonnet-5', batch: true })
    expect(batched.inputTokens).toBe(now.inputTokens)
    expect(batched.outputTokens).toBe(now.outputTokens)
  })
})
