import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { imagePath, pictureCandidates, shelfSlug, type ShelfConfig } from '@core/sync'
import { digestOf } from '@platform/browser/shelf'
import { fetchBookPictures, keptPicture } from '@platform/browser/shelf-pictures'

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
      '.',
      // A URL reads these as something other than a name: `%2e%2e` is `..`,
      // `?` starts a query, `#` drops the rest.
      'images/%2e%2e/%2e%2e/%2e%2e/user',
      'images/.%2e/x.png',
      'images/0a1b.png?ref=other',
      'images/0a1b.png#top',
      // A URL parser deletes tab, line feed and carriage return: `.\t.` is `..`.
      'images/.\t./x.png',
      'images/.\n./x.png',
      'images/.\r./x.png',
      'images/\u0000x.png'
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
    if (!bytes) return Promise.resolve(new Response('{}', { status: 404 }))
    // `getBytes` asks for the raw file; `shelfHas` asks for its record.
    const raw = new Headers(init?.headers).get('Accept')?.includes('raw')
    return Promise.resolve(
      raw ? new Response(bytes as BlobPart) : Response.json({ sha: 'made-up-sha' })
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

/** A picture's shelf name: its own digest, as `pushImage` names it. */
async function nameOf(bytes: Uint8Array): Promise<string> {
  return imagePath(await digestOf(new Uint8Array(bytes).buffer as ArrayBuffer))
}

describe('saving a book keeps a held picture where the shelf has it', () => {
  it('keeps one found beside the book, and asks nothing of the top', async () => {
    const key = 'fifth-made-up-scan.pdf\u00001\u00002'
    const folder = 'Fifth-Book'
    const bytes = new Uint8Array([10, 20, 30])
    const name = await nameOf(bytes)
    const asked = stubShelf({ [`books/${folder}/${name}`]: bytes }, folder, key)

    expect(await keptPicture(config, `books/${folder}/book.json`, bytes)).toBe(name)
    expect(asked).toEqual([`books/${folder}/${name}`])
  })

  it('keeps one found only at the top of the shelf', async () => {
    const key = 'sixth-made-up-scan.pdf\u00001\u00002'
    const bytes = new Uint8Array([40, 50])
    const name = await nameOf(bytes)
    stubShelf({ [name]: bytes }, 'Sixth-Book', key)

    expect(await keptPicture(config, 'books/Sixth-Book/book.json', bytes)).toBe(name)
  })

  it('uploads when the shelf has other pictures but not this one', async () => {
    const key = 'seventh-made-up-scan.pdf\u00001\u00002'
    const folder = 'Seventh-Book'
    const other = new Uint8Array([61])
    const asked = stubShelf(
      { [`books/${folder}/${await nameOf(other)}`]: other, [await nameOf(other)]: other },
      folder,
      key
    )
    const bytes = new Uint8Array([60])
    const name = await nameOf(bytes)

    expect(await keptPicture(config, `books/${folder}/book.json`, bytes)).toBeNull()
    expect(asked).toEqual([`books/${folder}/${name}`, name])
  })
})

/**
 * The wiring, read from the source, as `sheets-guard-wired.test.ts` reads the
 * driver's: the two doors that bring a book down from the shelf fetch its
 * pictures through the rule, and the one door that saves a book asks before it
 * uploads a picture.
 */
describe('the doors use the rule', () => {
  const app = readFileSync('src/app/App.tsx', 'utf8')
  const save = readFileSync('src/platform/browser/shelf-save.ts', 'utf8')

  it('opening and reading a book both fetch pictures with fetchBookPictures', () => {
    const calls = app.match(/fetchBookPictures\(config, about\.key, file\.imagePaths\)/g) ?? []
    expect(calls).toHaveLength(2)
    // The old loops walked the named pictures and fetched each from the top.
    expect(app).not.toMatch(/Object\.entries\(file\.imagePaths\)/)
    expect(app).not.toMatch(/of named\)\s*\{\s*const bytes = await getBytes/)
  })

  it('a save asks keptPicture before it uploads a held picture, and uses the answer', () => {
    const folder = save.indexOf(
      'bookFile = bookPath(input.key, await shelfDirFor(config, input.key))'
    )
    const at = save.indexOf('await keptPicture(config, bookFile, image.bytes)')
    expect(folder).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(folder)
    expect(save.indexOf('pushImage(config, image.bytes', at)).toBeGreaterThan(at)
    // The kept name is the one written, and an upload happens only without it.
    expect(save).toMatch(/imagePaths\[image\.id\] =\s*already \?\? \(await pushImage\(/)
  })
})
