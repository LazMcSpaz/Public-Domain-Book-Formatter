import { afterEach, describe, expect, it } from 'vitest'
import { getBytes, getText, putFile } from '@platform/browser/shelf'
import type { ShelfConfig } from '@core/sync'

/**
 * A shelf path in a web address, each segment encoded.
 *
 * Every shelf read goes through `readUrl`, and the paths it is handed come from
 * book files: a scan, a crop, a folder renamed by hand. Put into the address as
 * they stand, a `?` starts a query, a `#` drops the rest, and `%2e%2e` is read
 * as `..`. Picture names are refused for these (`pictureCandidates`); every
 * other path is encoded instead, so it is read as the name it is. The write
 * names its file the same way, or a read and the write after it would name two
 * different files. The names here are made up.
 */
const config: ShelfConfig = { repo: 'someone/shelf', branch: 'main', token: 't' }
const CONTENTS = 'https://api.github.com/repos/someone/shelf/contents/'

function stubFetch(answer: (method: string) => Response): { url: string; method: string }[] {
  const seen: { url: string; method: string }[] = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    // The raw string the module built: a stub sees what GitHub would be sent.
    seen.push({ url: String(input), method })
    return Promise.resolve(answer(method))
  }) as typeof fetch
  return seen
}

/** The path part of a contents URL, exactly as written. */
const pathOf = (url: string): string => url.slice(CONTENTS.length).split('?')[0]!

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
})

describe('a shelf path in a read', () => {
  it('encodes a space, #, ? and % in each segment, and keeps the slashes', async () => {
    const seen = stubFetch(() => new Response('x'))
    await getText(config, 'books/A Book #2?/scan%2e%2e.pdf')
    expect(seen[0]!.url.startsWith(CONTENTS)).toBe(true)
    expect(pathOf(seen[0]!.url)).toBe('books/A%20Book%20%232%3F/scan%252e%252e.pdf')
    // The query is still the module's own: the branch and the unshared marker.
    const query = new URL(seen[0]!.url).searchParams
    expect(query.get('ref')).toBe('main')
    expect(query.get('unshared')).toBeTruthy()
  })

  it('leaves an ordinary path as it is', async () => {
    const seen = stubFetch(() => new Response('x'))
    await getText(config, 'books/Some-Book_1.2/book.json')
    await getBytes(config, 'scans/0123abcd.pdf')
    expect(seen.map((s) => pathOf(s.url))).toEqual([
      'books/Some-Book_1.2/book.json',
      'scans/0123abcd.pdf'
    ])
  })

  it('still reads a backslash as a separator, as the address parser did', async () => {
    const seen = stubFetch(() => new Response('x'))
    await getText(config, 'books\\Some-Book\\book.json')
    expect(pathOf(seen[0]!.url)).toBe('books/Some-Book/book.json')
  })
})

describe('a shelf path in a write', () => {
  it('is encoded as the read before it is, so both name the same file', async () => {
    const seen = stubFetch((method) =>
      method === 'GET' ? new Response('{}', { status: 404 }) : new Response('{}', { status: 201 })
    )
    await putFile(config, 'books/A Book #2?/about.json', 'e30=', 'a card')
    expect(seen.map((s) => s.method)).toEqual(['GET', 'PUT'])
    expect(pathOf(seen[0]!.url)).toBe('books/A%20Book%20%232%3F/about.json')
    expect(seen[1]!.url).toBe(`${CONTENTS}books/A%20Book%20%232%3F/about.json`)
  })
})
