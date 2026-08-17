import { describe, it, expect } from 'vitest'
import {
  buildAdjudicationBody,
  buildAdjudicationPrompt,
  buildAdjudicationSystemPrompt,
  describeAdjudication,
  estimateAdjudicationCost,
  parseAdjudication,
  runAdjudication,
  type LeafToCheck
} from '@core/adjudicate'
import { estimateCost, type ClientConfig, type Transport } from '@core/transcribe'

const leaf = (over: Partial<LeafToCheck> = {}): LeafToCheck => ({
  pageIndex: 42,
  imageBase64: 'AAAA',
  transcription: 'It is true in this that many scientists have accepted the theory.',
  spots: [
    {
      id: 'p42d0',
      ocrReading: 'their most brilliant successes',
      after: 'the phenomena. I mean',
      before: 'have been obtained by'
    }
  ],
  ...over
})

function config(transport: Transport): ClientConfig {
  return { apiKey: 'sk-test', modelId: 'claude-opus-5', transport }
}

function reply(payload: unknown, usage: Record<string, number> = {}): Response {
  return new Response(
    JSON.stringify({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      usage: { input_tokens: 1800, output_tokens: 300, cache_read_input_tokens: 300, ...usage }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

describe('what the second reading is asked', () => {
  const system = buildAdjudicationSystemPrompt()

  /**
   * The rule this whole module lives under. Asking a model whether its own
   * earlier answer was right gets agreement, and under SPEC §4 that opinion
   * carries no weight anyway. Asking it to read an image is an observation,
   * which can be checked and can be visibly wrong.
   */
  it('never asks whether the earlier reading was right', () => {
    expect(system).not.toMatch(/you transcribed|your transcription|were you (right|correct)/i)
    expect(system).toMatch(/say what is actually printed|what the page shows/i)
  })

  it('forbids writing what the text ought to say', () => {
    expect(system).toMatch(/[Nn]ever write what the text ought to say/)
    expect(system).toMatch(/original spelling stands/i)
  })

  it('has an honest way out when the pixels do not settle it', () => {
    expect(system).toMatch(/unsure/)
  })

  it('knows page furniture is not missing text', () => {
    // The commonest false positive by a wide margin: a running head lifted out
    // of the body reads as dropped from it.
    expect(system).toMatch(/[Rr]unning heads/)
    expect(system).toMatch(/not-there/)
  })

  it('states the place and both readings, so the model settles rather than hunts', () => {
    const prompt = buildAdjudicationPrompt(leaf())
    expect(prompt).toContain('p42d0')
    expect(prompt).toContain('their most brilliant successes')
    expect(prompt).toContain('the phenomena. I mean')
    expect(prompt).toContain('Page 43')
  })

  it('says plainly when a leaf had nothing transcribed', () => {
    const prompt = buildAdjudicationPrompt(leaf({ transcription: '  ' }))
    expect(prompt).toContain('nothing was transcribed')
  })
})

describe('the request body', () => {
  it('always carries the page image', () => {
    // The hard constraint: a version of this with no picture returns fluent,
    // confident, invented prose and nothing downstream can tell.
    const body = buildAdjudicationBody(
      config(() => Promise.resolve(reply({}))),
      leaf()
    )
    const content = (body['messages'] as { content: { type: string }[] }[])[0]!.content
    expect(content[0]?.type).toBe('image')
  })

  it('caches the system prompt, which is identical every leaf', () => {
    const body = buildAdjudicationBody(
      config(() => Promise.resolve(reply({}))),
      leaf()
    )
    const system = body['system'] as { cache_control?: unknown }[]
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('constrains the reply to the schema', () => {
    const body = buildAdjudicationBody(
      config(() => Promise.resolve(reply({}))),
      leaf()
    )
    const format = (body['output_config'] as { format?: { type?: string } }).format
    expect(format?.type).toBe('json_schema')
  })
})

describe('reading the answers back', () => {
  const asked = ['p42d0', 'p42d1']

  it('keeps an answer to a spot that was asked about', () => {
    const spots = parseAdjudication(
      {
        spots: [
          { id: 'p42d0', verdict: 'missing', reading: 'their most brilliant successes', note: 'x' }
        ]
      },
      asked
    )
    expect(spots).toHaveLength(1)
    expect(spots[0]?.verdict).toBe('missing')
  })

  /**
   * A reply naming a spot nobody asked about is a model that has lost track of
   * what it was looking at. Letting it through would attach a reading to a
   * place on the page that was never in question.
   */
  it('drops an answer to a spot that was never sent', () => {
    const spots = parseAdjudication(
      { spots: [{ id: 'somewhere-else', verdict: 'missing', reading: 'x', note: 'y' }] },
      asked
    )
    expect(spots).toEqual([])
  })

  it('keeps only the first answer when a spot is answered twice', () => {
    const spots = parseAdjudication(
      {
        spots: [
          { id: 'p42d0', verdict: 'missing', reading: 'first', note: '' },
          { id: 'p42d0', verdict: 'not-there', reading: '', note: '' }
        ]
      },
      asked
    )
    expect(spots).toHaveLength(1)
    expect(spots[0]?.reading).toBe('first')
  })

  it('drops an answer with a verdict that is not one of the four', () => {
    expect(
      parseAdjudication(
        { spots: [{ id: 'p42d0', verdict: 'probably', reading: '', note: '' }] },
        asked
      )
    ).toEqual([])
  })

  it('discards a reading offered alongside "not there"', () => {
    // There is nothing to read where the answer is that nothing is printed, and
    // showing words the model did not claim to have seen is how invented text
    // gets into a book.
    const spots = parseAdjudication(
      { spots: [{ id: 'p42d0', verdict: 'not-there', reading: 'invented', note: '' }] },
      asked
    )
    expect(spots[0]?.reading).toBe('')
  })

  it('survives rubbish rather than throwing', () => {
    expect(parseAdjudication(null, asked)).toEqual([])
    expect(parseAdjudication({ spots: 'nope' }, asked)).toEqual([])
    expect(parseAdjudication({ spots: [42, null] }, asked)).toEqual([])
  })
})

describe('running it over a book', () => {
  it('sends one request per leaf, not one per spot', async () => {
    // The image is nearly all of the cost, so a leaf with four disagreements
    // must cost what a leaf with one costs.
    let calls = 0
    const busy = leaf({
      spots: ['a', 'b', 'c', 'd'].map((n) => ({
        id: `p42d${n}`,
        ocrReading: n,
        after: '',
        before: ''
      }))
    })
    await runAdjudication([busy], {
      client: config(() => {
        calls += 1
        return Promise.resolve(reply({ spots: [] }))
      })
    })
    expect(calls).toBe(1)
  })

  it('skips a leaf with nothing flagged on it', async () => {
    let calls = 0
    await runAdjudication([leaf({ spots: [] })], {
      client: config(() => {
        calls += 1
        return Promise.resolve(reply({ spots: [] }))
      })
    })
    expect(calls).toBe(0)
  })

  it('keys the answers by the discrepancy row they belong to', async () => {
    const result = await runAdjudication([leaf()], {
      client: config(() =>
        Promise.resolve(
          reply({ spots: [{ id: 'p42d0', verdict: 'not-there', reading: '', note: 'a smudge' }] })
        )
      )
    })
    expect(result.spots.get('p42d0')?.note).toBe('a smudge')
  })

  it('sums what it spent', async () => {
    const result = await runAdjudication([leaf(), leaf({ pageIndex: 43 })], {
      client: config(() => Promise.resolve(reply({ spots: [] })))
    })
    expect(result.usage.inputTokens).toBe(3600)
    expect(result.usage.outputTokens).toBe(600)
  })

  /**
   * The property that makes the whole feature safe to offer: its worst outcome
   * is the behaviour that came before it. A leaf it cannot read leaves its
   * spots unadjudicated, which is precisely how they arrived at the gate when
   * this pass did not exist.
   */
  it('records a failed leaf and carries on with the rest', async () => {
    let calls = 0
    const result = await runAdjudication([leaf({ pageIndex: 1 }), leaf({ pageIndex: 2 })], {
      client: config(() => {
        calls += 1
        // A 400 is the caller's problem and is not retried, so this is one
        // call, not two — leaf 1 fails, leaf 2 is read on the next call.
        if (calls === 1) return Promise.resolve(new Response('nope', { status: 400 }))
        return Promise.resolve(
          reply({ spots: [{ id: 'p42d0', verdict: 'missing', reading: 'x', note: '' }] })
        )
      }),
      sleep: () => Promise.resolve()
    })
    expect(result.failures.map((f) => f.pageIndex)).toEqual([1])
    expect(result.spots.size).toBe(1)
  })

  it('stops when cancelled and keeps what it settled', async () => {
    const controller = new AbortController()
    const result = await runAdjudication([leaf(), leaf({ pageIndex: 43 })], {
      client: config(() => {
        controller.abort()
        return Promise.resolve(
          reply({ spots: [{ id: 'p42d0', verdict: 'missing', reading: 'x', note: '' }] })
        )
      }),
      signal: controller.signal
    })
    expect(result.cancelled).toBe(true)
    expect(result.spots.size).toBe(1)
  })

  it('says what it found, rather than just looking tidier', () => {
    const said = describeAdjudication({
      spots: new Map([
        ['a', { id: 'a', verdict: 'not-there' as const, reading: '', note: '' }],
        ['b', { id: 'b', verdict: 'not-there' as const, reading: '', note: '' }],
        ['c', { id: 'c', verdict: 'missing' as const, reading: 'x', note: '' }]
      ]),
      failures: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      cancelled: false
    })
    expect(said).toContain('3 spot(s) looked at again')
    expect(said).toContain('2 were not on the page')
    expect(said).toContain('1 really were dropped')
  })
})

describe('what it costs', () => {
  it('is a small fraction of reading the book', () => {
    // The argument for offering it at all. Only flagged leaves are sent, so a
    // 300-page book with 60 flagged leaves costs a fraction of the read.
    const read = estimateCost({ pageCount: 300, modelId: 'claude-opus-5' })
    const check = estimateAdjudicationCost({ leafCount: 60, modelId: 'claude-opus-5' })
    expect(check.usd).toBeLessThan(read.usd * 0.35)
  })

  it('costs nothing when nothing was flagged', () => {
    expect(estimateAdjudicationCost({ leafCount: 0, modelId: 'claude-opus-5' }).usd).toBe(0)
  })

  it('scales with the leaves checked, not the book', () => {
    const ten = estimateAdjudicationCost({ leafCount: 10, modelId: 'claude-opus-5' })
    const forty = estimateAdjudicationCost({ leafCount: 40, modelId: 'claude-opus-5' })
    expect(forty.usd).toBeGreaterThan(ten.usd * 3.5)
  })

  it('quotes a wider range than the transcription does', () => {
    // Spots per leaf vary far more than the density of a page, and a quote
    // should be honest about which of its inputs it is least sure of.
    const check = estimateAdjudicationCost({ leafCount: 60, modelId: 'claude-opus-5' })
    const spread = (check.usdHigh - check.usdLow) / check.usd
    const read = estimateCost({ pageCount: 60, modelId: 'claude-opus-5' })
    expect(spread).toBeGreaterThan((read.usdHigh - read.usdLow) / read.usd)
  })
})
