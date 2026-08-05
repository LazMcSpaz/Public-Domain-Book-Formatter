import { describe, it, expect } from 'vitest'
import {
  buildRequestBody,
  transcribePage,
  validateApiKey,
  runTranscription,
  mergeMetadata,
  TranscribeError,
  type ClientConfig,
  type PageSource,
  type Transport
} from '@core/transcribe'

/** A reply body shaped like the API's, wrapping a page transcription. */
function apiReply(payload: unknown, usage: Record<string, number> = {}) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 0, ...usage }
  }
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
  furniture: { runningHead: 'THE ALCHEMIST', folio: '37' }
}

function config(transport: Transport): ClientConfig {
  return { apiKey: 'sk-test', modelId: 'claude-opus-5', transport }
}

function source(
  pageIndex: number,
  ocrText = 'the alembick being set upon a gentle fire'
): PageSource {
  return {
    pageIndex,
    image: () => Promise.resolve('AAAA'),
    ocrText,
    ocrWords: ocrText.split(' ').map((t) => ({ text: t, confidence: 95 }))
  }
}

// --------------------------------------------------------------- request ----

describe('buildRequestBody', () => {
  const body = buildRequestBody(
    config(async () => jsonResponse({})),
    {
      pageIndex: 0,
      imageBase64: 'IMGDATA',
      systemPrompt: 'SYSTEM',
      userPrompt: 'USER'
    }
  )

  it('sends the page image and the prompt together', () => {
    const content = (body['messages'] as { content: { type: string }[] }[])[0]!.content
    expect(content[0]).toMatchObject({ type: 'image' })
    expect(content[1]).toMatchObject({ type: 'text', text: 'USER' })
  })

  it('caches the system prompt, which is identical on every page of a run', () => {
    const system = body['system'] as { cache_control?: unknown }[]
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('enforces the reply schema so a malformed page fails loudly', () => {
    const oc = body['output_config'] as { format: { type: string } }
    expect(oc.format.type).toBe('json_schema')
  })
})

// ---------------------------------------------------------------- client ----

describe('transcribePage', () => {
  it('parses a successful reply and reports usage', async () => {
    const result = await transcribePage(
      config(async () => jsonResponse(apiReply({ ...goodPage }))),
      { pageIndex: 4, imageBase64: 'x', systemPrompt: 's', userPrompt: 'u' }
    )
    expect(result.transcription.pageIndex).toBe(4)
    expect(result.transcription.furniture.folio).toBe('37')
    expect(result.usage.outputTokens).toBe(200)
  })

  it('marks 429 and 5xx as retryable', async () => {
    for (const status of [429, 500, 529]) {
      const err = await transcribePage(
        config(async () => jsonResponse({ error: { message: 'busy' } }, status)),
        { pageIndex: 0, imageBase64: 'x', systemPrompt: 's', userPrompt: 'u' }
      ).catch((e) => e as TranscribeError)
      expect(err).toBeInstanceOf(TranscribeError)
      expect((err as TranscribeError).retryable).toBe(true)
    }
  })

  it('marks an auth failure as NOT retryable', async () => {
    const err = await transcribePage(
      config(async () => jsonResponse({ error: { message: 'bad key' } }, 401)),
      { pageIndex: 0, imageBase64: 'x', systemPrompt: 's', userPrompt: 'u' }
    ).catch((e) => e as TranscribeError)
    expect((err as TranscribeError).retryable).toBe(false)
    expect((err as TranscribeError).message).toMatch(/bad key/)
  })

  it('handles a refusal before trying to read content', async () => {
    const err = await transcribePage(
      config(async () => jsonResponse({ stop_reason: 'refusal', content: [] })),
      { pageIndex: 0, imageBase64: 'x', systemPrompt: 's', userPrompt: 'u' }
    ).catch((e) => e as TranscribeError)
    expect((err as TranscribeError).message).toMatch(/declined/i)
  })

  it('treats unparseable JSON as retryable', async () => {
    const err = await transcribePage(
      config(async () => jsonResponse({ content: [{ type: 'text', text: 'not json' }] })),
      { pageIndex: 0, imageBase64: 'x', systemPrompt: 's', userPrompt: 'u' }
    ).catch((e) => e as TranscribeError)
    expect((err as TranscribeError).retryable).toBe(true)
  })
})

describe('validateApiKey', () => {
  it('accepts a working key', async () => {
    expect(await validateApiKey('sk-good', async () => jsonResponse({ ok: true }))).toEqual({
      ok: true
    })
  })

  it('reports a rejected key plainly', async () => {
    const r = await validateApiKey('sk-bad', async () => jsonResponse({}, 401))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/rejected/i)
  })

  it('survives a network failure', async () => {
    const r = await validateApiKey('sk', async () => {
      throw new Error('offline')
    })
    expect(r).toMatchObject({ ok: false, message: 'offline' })
  })
})

// ---------------------------------------------------------------- runner ----

const runOpts = (transport: Transport, extra = {}) => ({
  client: config(transport),
  lexicon: [],
  orthography: 'preserve' as const,
  normalizeLongS: false,
  sleep: async () => {}, // never actually wait in tests
  ...extra
})

describe('runTranscription', () => {
  it('transcribes every page and accumulates usage', async () => {
    const result = await runTranscription(
      [source(0), source(1), source(2)],
      runOpts(async () => jsonResponse(apiReply(goodPage)))
    )
    expect(result.transcriptions).toHaveLength(3)
    expect(result.failures).toHaveLength(0)
    expect(result.usage.outputTokens).toBe(600)
  })

  it('passes the previous page tail so paragraphs stitch across the seam', async () => {
    const prompts: string[] = []
    await runTranscription(
      [source(0), source(1)],
      runOpts(async (_url, init) => {
        const body = JSON.parse(String(init.body)) as {
          messages: { content: { type: string; text?: string }[] }[]
        }
        const text = body.messages[0]!.content.find((c) => c.type === 'text')!.text!
        prompts.push(text)
        return jsonResponse(apiReply(goodPage))
      })
    )
    expect(prompts[0]).not.toMatch(/previous page ended/i)
    expect(prompts[1]).toMatch(/previous page ended/i)
    expect(prompts[1]).toContain('alembick')
  })

  it('retries a transient failure then succeeds', async () => {
    let calls = 0
    const result = await runTranscription(
      [source(0)],
      runOpts(async () => {
        calls++
        return calls === 1 ? jsonResponse({}, 529) : jsonResponse(apiReply(goodPage))
      })
    )
    expect(calls).toBe(2)
    expect(result.transcriptions).toHaveLength(1)
    expect(result.failures).toHaveLength(0)
  })

  it('does NOT retry an auth failure', async () => {
    let calls = 0
    const result = await runTranscription(
      [source(0)],
      runOpts(async () => {
        calls++
        return jsonResponse({ error: { message: 'bad key' } }, 401)
      })
    )
    expect(calls).toBe(1)
    expect(result.failures).toHaveLength(1)
  })

  it('keeps going when a single page fails — one bad page must not sink the book', async () => {
    let n = 0
    const result = await runTranscription(
      [source(0), source(1), source(2)],
      runOpts(async () => {
        n++
        // Second page always 401s (non-retryable), others succeed.
        return n === 2 ? jsonResponse({}, 401) : jsonResponse(apiReply(goodPage))
      })
    )
    expect(result.transcriptions).toHaveLength(2)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.pageIndex).toBe(1)
  })

  it('resumes without re-billing pages already done', async () => {
    let calls = 0
    const already = {
      pageIndex: 0,
      role: 'body' as const,
      blocks: [{ kind: 'paragraph' as const, text: 'done already' }],
      uncertain: [],
      furniture: {}
    }
    const result = await runTranscription(
      [source(0), source(1)],
      runOpts(
        async () => {
          calls++
          return jsonResponse(apiReply(goodPage))
        },
        { resumeFrom: [already] }
      )
    )
    expect(calls).toBe(1) // only the un-done page was requested
    expect(result.transcriptions).toHaveLength(2)
  })

  it('stops when cancelled and keeps what finished', async () => {
    const controller = new AbortController()
    let calls = 0
    const result = await runTranscription(
      [source(0), source(1), source(2)],
      runOpts(
        async () => {
          calls++
          if (calls === 1) controller.abort()
          return jsonResponse(apiReply(goodPage))
        },
        { signal: controller.signal }
      )
    )
    expect(result.cancelled).toBe(true)
    expect(result.transcriptions).toHaveLength(1)
  })

  it('runs deterministic verification over the results', async () => {
    // Transcription returns one short sentence while OCR saw far more words.
    const dense = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const result = await runTranscription(
      [source(0, dense)],
      runOpts(async () => jsonResponse(apiReply(goodPage)))
    )
    expect(result.findings.some((f) => f.code === 'text-dropped')).toBe(true)
  })

  it('reports progress per page', async () => {
    const seen: number[] = []
    await runTranscription(
      [source(0), source(1)],
      runOpts(async () => jsonResponse(apiReply(goodPage)), {
        onProgress: (p: { page: number }) => seen.push(p.page)
      })
    )
    expect(seen).toEqual([1, 2])
  })
})

describe('mergeMetadata', () => {
  it('merges front-matter fields, first non-empty winning', () => {
    const merged = mergeMetadata([
      {
        pageIndex: 0,
        role: 'title-page',
        blocks: [],
        uncertain: [],
        furniture: {},
        metadata: { title: 'The Alchemist', author: 'Anonymous' }
      },
      {
        pageIndex: 1,
        role: 'copyright',
        blocks: [],
        uncertain: [],
        furniture: {},
        metadata: { title: 'Ignored Later Title', originalYear: '1662' }
      }
    ])
    expect(merged).toEqual({
      title: 'The Alchemist',
      author: 'Anonymous',
      originalYear: '1662'
    })
  })

  it('is empty when no page carried metadata', () => {
    expect(mergeMetadata([])).toEqual({})
  })
})

describe('runTranscription — page images are not accumulated', () => {
  it('asks for a page image only when it is about to send that page', async () => {
    const asked: number[] = []
    const sources = [0, 1, 2].map((pageIndex) => ({
      pageIndex,
      image: async () => {
        asked.push(pageIndex)
        return 'AAAA'
      },
      ocrText: 'the alembick',
      ocrWords: [{ text: 'the', confidence: 95 }]
    }))

    const sentBefore: number[][] = []
    await runTranscription(
      sources,
      runOpts(async () => {
        sentBefore.push([...asked])
        return jsonResponse(apiReply(goodPage))
      })
    )

    // Page n's image must not exist before page n is being sent — the whole
    // book's images at once is what takes the tab down.
    expect(sentBefore).toEqual([[0], [0, 1], [0, 1, 2]])
    expect(asked).toEqual([0, 1, 2])
  })

  it('renders a page once even when the request has to be retried', async () => {
    let renders = 0
    const sources = [
      {
        pageIndex: 0,
        image: async () => {
          renders++
          return 'AAAA'
        },
        ocrText: 'the alembick',
        ocrWords: [{ text: 'the', confidence: 95 }]
      }
    ]

    let attempts = 0
    const result = await runTranscription(
      sources,
      runOpts(async () => {
        attempts++
        return attempts < 3 ? jsonResponse({ error: {} }, 500) : jsonResponse(apiReply(goodPage))
      })
    )

    expect(attempts).toBe(3)
    expect(renders).toBe(1)
    expect(result.failures).toEqual([])
  })

  it('does not render pages it never reaches after cancellation', async () => {
    const controller = new AbortController()
    let renders = 0
    const sources = [0, 1, 2, 3].map((pageIndex) => ({
      pageIndex,
      image: async () => {
        renders++
        return 'AAAA'
      },
      ocrText: 'the alembick',
      ocrWords: [{ text: 'the', confidence: 95 }]
    }))

    const result = await runTranscription(
      sources,
      runOpts(
        async () => {
          controller.abort()
          return jsonResponse(apiReply(goodPage))
        },
        { signal: controller.signal }
      )
    )

    expect(result.cancelled).toBe(true)
    expect(renders).toBe(1)
  })
})
