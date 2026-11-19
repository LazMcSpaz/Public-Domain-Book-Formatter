import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createSavedRun, serializeBookFile } from '@core/project'
import { defaultVoice } from '@core/annotate'
import type { OutboxEntry } from '@core/sync'
import type { Ruling } from '@core/queries'

/**
 * A flush from the phone, against a GitHub that fails the way the owner's did.
 *
 * On the owner's phone and tablet a ruling said "Could not reach the shelf
 * (Load failed)" and nothing more: not which of a flush's four requests had
 * failed, how big it was, or whether reading still worked. "Load failed" is
 * WebKit's message for a `fetch` that got no answer, which `fetch` reports
 * everywhere as a `TypeError`, so that is what the stub throws here.
 *
 * The device's queue lives in IndexedDB, which Node does not have; it is
 * replaced by an in-memory one with the same three calls. Everything else is
 * the real code: `flushOutbox`, the fold, the requests through `shelf.ts`.
 */

const queue = new Map<string, OutboxEntry>()
vi.mock('@platform/browser/run-store', () => ({
  outboxFor: async (key: string) => [...queue.values()].filter((e) => e.bookKey === key),
  clearQueued: async (ids: readonly string[]) => {
    for (const id of ids) queue.delete(id)
  },
  queueForShelf: async (entry: OutboxEntry) => {
    queue.set(entry.id, entry)
    return true
  },
  loadRun: async () => null,
  loadSourceFile: async () => null,
  loadAnnotationCheckpoint: async () => null
}))

const { flushOutbox } = await import('@platform/browser/shelf-outbox')

const KEY = 'probe.pdf1'
const DIR = 'Probe-Book-abc'
const BOOK = `books/${DIR}/book.json`
const config = { repo: 'someone/shelf', branch: 'main', token: 't' }

const ruling: Ruling = {
  pageIndex: 0,
  quote: 'lit at dusk',
  kind: 'printers-error',
  decision: 'as-printed',
  decidedOn: '2026-11-18'
}

/** The tools' book file: a correction carrying a reason the app does not read. */
function shelfBook(): string {
  const raw = JSON.parse(
    serializeBookFile({
      run: createSavedRun({
        key: KEY,
        fileName: 'probe.pdf',
        pageCount: 1,
        transcriptions: [
          {
            pageIndex: 0,
            role: 'body',
            blocks: [{ kind: 'paragraph', text: 'The lamp was lit at dusk.' }],
            uncertain: [],
            furniture: {}
          }
        ],
        failures: [],
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
        modelId: 'none',
        identityAnswers: {},
        edits: [{ kind: 'text', blockId: 'p0b0', text: 'The lamp was lit at dusk!' }]
      }),
      answers: {},
      voice: defaultVoice()
    })
  )
  raw.run.edits[0].why = 'the page has an exclamation mark'
  return JSON.stringify(raw, null, 2)
}

const gitSha = (text: string): string => {
  const bytes = Buffer.from(text, 'utf8')
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex')
}

/** The shelf, as GitHub's contents API answers for it. */
interface Stub {
  files: Map<string, string>
  /** What a PUT of the book file does. */
  onBookPut: (text: string) => Response | 'no-answer' | 'land-then-no-answer'
  /** Every request after the first failed PUT also gets no answer. */
  downAfterPut: boolean
  /** Reading the book raw gets no answer. */
  readFails: boolean
  puts: string[]
}

let stub: Stub
const real = globalThis.fetch

function install(): void {
  let down = false
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (down) throw new TypeError('Load failed')
    const url = new URL(String(input))
    const path = decodeURIComponent(url.pathname.split('/contents/')[1] ?? '')
    const accept = ((init?.headers ?? {}) as Record<string, string>)['Accept'] ?? ''
    const method = init?.method ?? 'GET'
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      })
    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { content: string }
      const text = Buffer.from(body.content, 'base64').toString('utf8')
      stub.puts.push(path)
      if (path !== BOOK) {
        stub.files.set(path, text)
        return json({ content: {} })
      }
      const answer = stub.onBookPut(text)
      if (answer === 'no-answer' || answer === 'land-then-no-answer') {
        if (answer === 'land-then-no-answer') stub.files.set(path, text)
        if (stub.downAfterPut) down = true
        throw new TypeError('Load failed')
      }
      if (answer.ok) stub.files.set(path, text)
      return answer
    }
    if (path === 'books') return json([{ name: DIR, type: 'dir' }])
    const held = stub.files.get(path)
    if (held === undefined) return json({ message: 'Not Found' }, 404)
    if (accept.includes('raw')) {
      if (path === BOOK && stub.readFails) throw new TypeError('Load failed')
      return new Response(held)
    }
    return json({ type: 'file', path, sha: gitSha(held) })
  }) as typeof fetch
}

beforeEach(() => {
  queue.clear()
  queue.set(`ruling:0:lit at dusk`, {
    id: 'ruling:0:lit at dusk',
    bookKey: KEY,
    madeAt: '2026-11-18T10:00:00.000Z',
    ruling
  } as OutboxEntry)
  stub = {
    files: new Map([
      [BOOK, shelfBook()],
      [
        `books/${DIR}/about.json`,
        JSON.stringify({ key: KEY, fileName: 'probe.pdf', savedAt: '2026-11-01T00:00:00.000Z' })
      ]
    ]),
    onBookPut: () => new Response('{}', { status: 200 }),
    downAfterPut: false,
    readFails: false,
    puts: []
  }
  install()
})
afterEach(() => {
  globalThis.fetch = real
})

describe('a ruling the shelf did not take', () => {
  it('names the write, its size, the wait and the browser’s words, and keeps the ruling', async () => {
    stub.onBookPut = () => 'no-answer'
    const result = await flushOutbox(config, KEY)
    expect(result.sent).toBe(0)
    expect(result.waiting).toBe(1)
    expect(result.failure).toMatchObject({ what: 'writing the book file', kind: 'no-answer' })
    expect(result.failure!.bytes).toBeGreaterThan(1000)
    expect(result.note).toMatch(
      /^Writing the book file \(\d+ KB\) got no answer: the browser gave up after \d+\.\d seconds and said “Load failed”\./
    )
    // Reading still worked straight afterwards: the connection is up.
    expect(result.note).toContain('Reading from the shelf still works')
    expect(result.note).toContain('Your 1 ruling is still on this device')
    expect([...queue.keys()]).toEqual(['ruling:0:lit at dusk'])
  })

  it('says the connection is down when reading fails straight afterwards too', async () => {
    stub.onBookPut = () => 'no-answer'
    stub.downAfterPut = true
    const result = await flushOutbox(config, KEY)
    expect(result.note).toContain('Reading from the shelf failed straight afterwards too')
    expect(queue.size).toBe(1)
  })

  it('counts a write as sent when the shelf took it and only the answer was lost', async () => {
    stub.onBookPut = () => 'land-then-no-answer'
    const result = await flushOutbox(config, KEY)
    expect(result.sent).toBe(1)
    expect(result.note).toContain('answer was lost on the way back')
    expect(queue.size).toBe(0)
  })

  it('names a refusal as a refusal, in GitHub’s words', async () => {
    stub.onBookPut = () =>
      new Response(JSON.stringify({ message: 'conflict' }), {
        status: 409,
        headers: { 'content-type': 'application/json' }
      })
    const result = await flushOutbox(config, KEY)
    expect(result.failure).toMatchObject({ kind: 'refused', status: 409 })
    expect(result.note).toMatch(/^Writing the book file \(\d+ KB\) was refused\. Another device/)
    expect(queue.size).toBe(1)
  })

  it('names the read when it is the read that fails', async () => {
    stub.readFails = true
    const result = await flushOutbox(config, KEY)
    expect(result.note).toMatch(/^Reading the book from the shelf got no answer/)
    expect(stub.puts).toEqual([])
    expect(queue.size).toBe(1)
  })
})

describe('a ruling the shelf took', () => {
  it('leaves the tools’ reasons on the book’s corrections', async () => {
    const result = await flushOutbox(config, KEY)
    expect(result.sent).toBe(1)
    const written = JSON.parse(stub.files.get(BOOK)!)
    expect(written.run.edits[0].why).toBe('the page has an exclamation mark')
    expect(written.run.rulings).toEqual([ruling])
    expect(stub.puts).toEqual([BOOK, `books/${DIR}/about.json`])
    expect(queue.size).toBe(0)
  })
})

describe('the app’s two ways of opening a book from the shelf', () => {
  it('both fold in what this device has not sent yet, so a waiting mark stays on the page', () => {
    const app = readFileSync('src/app/App.tsx', 'utf8')
    expect(app.match(/await withQueuedChanges\(parseBookFile\(json\)\)/g)).toHaveLength(2)
  })
})
