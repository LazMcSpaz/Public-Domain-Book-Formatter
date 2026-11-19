import { describe, it, expect, afterEach } from 'vitest'
import { pictureCandidates, shelfSlug, type ShelfConfig } from '@core/sync'
import { fetchBookPictures } from '@platform/browser/shelf-pictures'

/**
 * A book's pictures are found beside the book, then at the top of the shelf.
 *
 * A book file names each picture as `images/<digest>.png`. The app read every
 * such name from the top of the shelf, while nearly every picture sits in the
 * book's own folder, so a book opened from the shelf lost its plates. The rule
 * (`pictureCandidates`) says where to look; `fetchBookPictures` asks the shelf
 * in that order and reports what it could not find. Names and bytes here are
 * made up.
 */

const BOOK = 'books/A-Made-Up-Book/book.json'

describe('where a named picture is looked for', () => {
  it('tries the book folder first, then the top of the shelf', () => {
    expect(pictureCandidates(BOOK, 'images/0a1b.png')).toEqual([
      'books/A-Made-Up-Book/images/0a1b.png',
      'images/0a1b.png'
    ])
  })

  it('never lists one place twice', () => {
    expect(pictureCandidates('book.json', 'images/0a1b.png')).toEqual(['images/0a1b.png'])
  })

  it('settles dots, doubled slashes and Windows backslashes', () => {
    expect(pictureCandidates(BOOK, './images//0a1b.png')).toEqual([
      'books/A-Made-Up-Book/images/0a1b.png',
      'images/0a1b.png'
    ])
    expect(pictureCandidates('books\\A-Made-Up-Book\\book.json', 'images\\0a1b.png')).toEqual([
      'books/A-Made-Up-Book/images/0a1b.png',
      'images/0a1b.png'
    ])
  })

  it('keeps a climb that stays on the shelf, and drops the place it would leave from', () => {
    // From the book's folder this is a neighbour's folder; from the top of the
    // shelf it climbs out, so that place is not tried.
    expect(pictureCandidates(BOOK, '../Another-Book/images/0a1b.png')).toEqual([
      'books/Another-Book/images/0a1b.png'
    ])
  })

  it('finds a name already written from the top of the shelf at its second place', () => {
    expect(pictureCandidates(BOOK, 'books/A-Made-Up-Book/images/0a1b.png')).toEqual([
      'books/A-Made-Up-Book/books/A-Made-Up-Book/images/0a1b.png',
      'books/A-Made-Up-Book/images/0a1b.png'
    ])
  })

  it('refuses a name that leaves the shelf, is absolute, or names no file', () => {
    for (const name of [
      '../../../outside.png',
      '../../../../etc/passwd',
      '/images/0a1b.png',
      '\\images\\0a1b.png',
      '\\\\server\\share\\0a1b.png',
      'C:\\pictures\\0a1b.png',
      'c:/pictures/0a1b.png',
      'https://example.com/0a1b.png',
      'file:///images/0a1b.png',
      '',
      'images/',
      'images/..',
      '.'
    ]) {
      expect(pictureCandidates(BOOK, name), name).toEqual([])
    }
  })
})

const config: ShelfConfig = { repo: 'someone/shelf', branch: 'main', token: 't' }

/**
 * A shelf served from a map of paths to bytes. The book sits in a folder whose
 * name is not the one computed from its key, as nine real folders do, so the
 * listing is the only way to find it.
 */
function stubShelf(files: Record<string, Uint8Array>, folder: string, key: string): string[] {
  const asked: string[] = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = decodeURIComponent(
      url.pathname.replace(/^\/repos\/someone\/shelf\/contents\//, '')
    )
    asked.push(path)
    // Every read goes through `readUrl`: a unique parameter, and no cache.
    expect(url.searchParams.get('unshared')).toBeTruthy()
    expect(init?.cache).toBe('no-store')
    if (path === 'books') {
      return Promise.resolve(Response.json([{ name: folder, type: 'dir' }]))
    }
    if (path === `books/${folder}/about.json`) {
      return Promise.resolve(Response.json({ key, fileName: 'made-up.pdf' }))
    }
    const bytes = files[path]
    return Promise.resolve(
      bytes ? new Response(bytes as BlobPart) : new Response('{}', { status: 404 })
    )
  }) as typeof fetch
  return asked
}

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
})

describe('fetching the pictures a book names', () => {
  it('finds one beside the book, one at the top, and reports one found nowhere', async () => {
    const key = 'made-up-scan.pdf\u00001234\u00005678'
    const folder = 'Renamed-By-Hand'
    expect(shelfSlug(key)).not.toBe(folder)
    const asked = stubShelf(
      {
        [`books/${folder}/images/aaaa.png`]: new Uint8Array([1, 2, 3]),
        'images/bbbb.png': new Uint8Array([4, 5])
      },
      folder,
      key
    )

    const got = await fetchBookPictures(config, key, {
      beside: 'images/aaaa.png',
      top: 'images/bbbb.png',
      gone: 'images/cccc.png'
    })

    expect(got.found.map((p) => [p.id, [...p.bytes]])).toEqual([
      ['beside', [1, 2, 3]],
      ['top', [4, 5]]
    ])
    expect(got.lost).toEqual(['images/cccc.png'])
    // The folder was found once, by listing, and each missing picture was
    // looked for in both places before it was reported.
    expect(asked.filter((p) => p === 'books')).toHaveLength(1)
    expect(asked).toContain(`books/${folder}/images/cccc.png`)
    expect(asked).toContain('images/cccc.png')
  })

  it('takes the copy beside the book over one at the top, without asking for the second', async () => {
    const key = 'another-made-up-scan.pdf\u00001\u00002'
    const folder = 'Second-Book'
    const asked = stubShelf(
      {
        [`books/${folder}/images/dddd.png`]: new Uint8Array([7]),
        'images/dddd.png': new Uint8Array([9])
      },
      folder,
      key
    )

    const got = await fetchBookPictures(config, key, { plate: 'images/dddd.png' })

    expect(got.found.map((p) => [...p.bytes])).toEqual([[7]])
    expect(asked).not.toContain('images/dddd.png')
  })

  it('reports a name the rule refuses, and never asks the shelf for it', async () => {
    const key = 'third-made-up-scan.pdf\u00001\u00002'
    const asked = stubShelf({}, 'Third-Book', key)

    const got = await fetchBookPictures(config, key, { bad: '../../../outside.png' })

    expect(got).toEqual({ found: [], lost: ['../../../outside.png'] })
    expect(asked.some((p) => p.includes('outside'))).toBe(false)
  })

  it('asks the shelf nothing for a book with no named pictures', async () => {
    const asked = stubShelf({}, 'Fourth-Book', 'fourth.pdf\u00001\u00002')
    expect(await fetchBookPictures(config, 'fourth.pdf\u00001\u00002', {})).toEqual({
      found: [],
      lost: []
    })
    expect(asked).toEqual([])
  })
})
