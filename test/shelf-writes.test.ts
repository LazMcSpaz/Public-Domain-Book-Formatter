import { describe, it, expect, afterEach } from 'vitest'
import { getText, putFile, ShelfError } from '@platform/browser/shelf'
import type { ShelfConfig } from '@core/sync'

/**
 * Writing to the shelf, and the read that used to be able to answer for it.
 *
 * `putFile` asks the contents endpoint for a path's blob sha and then writes,
 * and a flush calls it a moment after reading the very same path. GitHub hands
 * out one `ETag` per path whatever media type was asked for — measured — so a
 * cache lenient about `Vary` could answer the sha lookup with the **book file**:
 * valid JSON, no `sha` in it, and the write that followed went up as a create of
 * a file that already exists. GitHub refuses that with `422: "sha" wasn't
 * supplied`, which is a message about a request nobody made.
 *
 * Two properties, and neither depends on a browser's cache being correct. The
 * end-to-end measurement is `npm run check:cache`, where the stub plays the
 * lenient cache against the real module in a real browser.
 */

const config: ShelfConfig = { repo: 'someone/shelf', branch: 'main', token: 't' }
const PATH = 'books/probe/book.json'

/** What a request asked for, and what it was answered with. */
interface Call {
  url: string
  method: string
  /** The media type asked for — what tells a read from a sha lookup. */
  accept: string
}

function stubFetch(answer: (call: Call) => Response): Call[] {
  const seen: Call[] = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const call = {
      url: String(input),
      method: init?.method ?? 'GET',
      accept: headers['Accept'] ?? ''
    }
    seen.push(call)
    return Promise.resolve(answer(call))
  }) as typeof fetch
  return seen
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
})

describe('the sha a write is made against', () => {
  it('is asked for at a URL a read of the same file cannot answer', async () => {
    // The lenient cache, as a stub: **any** URL already answered is answered
    // again with what it said then, whatever media type asks. That is the worst
    // a cache with a sixty-second window can do, and it is what it did — first
    // to the sha lookup, which got the book file and no sha in it, and later to
    // the read itself, where a flush folded its queue into a minute-old book
    // and deleted the ruling that had landed in between.
    //
    // Keyed on the URL alone rather than on which call it looks like: the first
    // version of this stub told the read from the lookup by the read's URL
    // ending in `ref=main`, which stopped being true the moment the reads were
    // fixed too, and the test then failed for a reason that was not the bug.
    const answered = new Map<string, Response>()
    const BOOK = '{"version":15,"run":{}}'
    const calls = stubFetch((call) => {
      if (call.method === 'PUT') return json({ content: {} })
      const held = answered.get(call.url)
      if (held) return held.clone()
      const reply = call.accept.includes('raw')
        ? new Response(BOOK)
        : json({ path: PATH, sha: 'b7558071' })
      answered.set(call.url, reply.clone())
      return reply
    })

    expect(await getText(config, PATH)).toBe(BOOK)
    await putFile(config, PATH, 'dXBkYXRlZA==', 'a ruling')

    const gets = calls.filter((c) => c.method === 'GET')
    expect(gets).toHaveLength(2)
    // Two requests for one path, at two URLs: neither can answer the other.
    expect(gets[1]!.url).not.toBe(gets[0]!.url)
    expect(calls.find((c) => c.method === 'PUT')).toBeDefined()
  })

  it('reads the book at a URL a previous read cannot answer either', async () => {
    // The second fault, and the one that cost a ruling. Two reads of the book
    // file a moment apart must not be the same request, or the later one comes
    // back with the earlier book and the flush writes that back over the shelf.
    const answered = new Map<string, string>()
    let current = '{"rulings":[]}'
    stubFetch((call) => {
      const held = answered.get(call.url)
      if (held !== undefined) return new Response(held)
      answered.set(call.url, current)
      return new Response(current)
    })

    expect(await getText(config, PATH)).toBe('{"rulings":[]}')
    current = '{"rulings":["leaf 209"]}'
    expect(await getText(config, PATH)).toBe('{"rulings":["leaf 209"]}')
  })

  /**
   * The guard that would have caught the other rule failing. A reply this
   * module does not understand is not "the file is not there", and the caller's
   * answer to "not there" is to create it.
   */
  it('refuses to write when the lookup answers with something that is not a file record', async () => {
    stubFetch((call) =>
      call.method === 'PUT' ? json({ content: {} }) : new Response('{"version":15,"run":{}}')
    )
    await expect(putFile(config, PATH, 'eA==', 'a ruling')).rejects.toBeInstanceOf(ShelfError)
    await expect(putFile(config, PATH, 'eA==', 'a ruling')).rejects.toThrow(/carried no sha/)
  })

  it('refuses when the path names a directory', async () => {
    stubFetch((call) => (call.method === 'PUT' ? json({}) : json([{ name: 'book.json' }])))
    await expect(putFile(config, 'books/probe', 'eA==', 'x')).rejects.toThrow(/directory/)
  })

  /** Not there is still not there: a create must stay possible. */
  it('creates a file that is not on the shelf yet', async () => {
    const calls = stubFetch((call) =>
      call.method === 'PUT' ? json({ content: {} }) : json({ message: 'Not Found' }, 404)
    )
    await putFile(config, PATH, 'eA==', 'first save')
    const put = calls.find((c) => c.method === 'PUT')
    expect(put).toBeDefined()
  })
})
