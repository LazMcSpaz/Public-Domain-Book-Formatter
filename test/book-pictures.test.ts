import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// @ts-expect-error: a plain Node module with no types; the driver and the EPUB builder import it.
import * as helper from '../scripts/lib/book-pictures.mjs'

const { findBookPictures, findPicture, picturePlaces, shelfPlace } = helper

/**
 * The scripts' one door to core's picture rule (`pictureCandidates`), on a
 * made-up shelf in a temporary folder: a book's folder first, then the top of
 * the shelf, and a refused name found nowhere even when a file sits where it
 * points. Every name and byte here is invented.
 */
const scratch = mkdtempSync(join(tmpdir(), 'pdbf-book-pictures-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function put(path: string, text = 'png'): string {
  const full = join(scratch, ...path.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
  return full
}

const book = put('shelf/books/Some-Book/book.json', '{}')
const beside = put('shelf/books/Some-Book/images/aaaa.png')
const atTop = put('shelf/images/bbbb.png')
put('shelf/books/Some-Book/images/cccc.png', 'beside')
put('shelf/images/cccc.png', 'top')
put('outside.png')
put('shelf/images/a%2e.png')

describe('where a book sits on its shelf', () => {
  it('a book in books/<Folder>/ has its shelf path, and the shelf is two folders up', () => {
    expect(shelfPlace(book)).toEqual({
      root: join(scratch, 'shelf'),
      shelfPath: 'books/Some-Book/book.json'
    })
  })

  it('a book with no books/<Folder>/ above it is a shelf of its own', () => {
    const loose = put('loose/copy/book.json', '{}')
    expect(shelfPlace(loose)).toEqual({
      root: join(scratch, 'loose', 'copy'),
      shelfPath: 'book.json'
    })
  })
})

describe('finding a picture a book names', () => {
  it('finds a picture beside the book', async () => {
    expect(await findPicture(book, 'images/aaaa.png')).toBe(beside)
  })

  it('finds a picture at the top of the shelf', async () => {
    expect(await findPicture(book, 'images/bbbb.png')).toBe(atTop)
  })

  it('looks beside the book before the top', async () => {
    expect(await picturePlaces(book, 'images/cccc.png')).toEqual([
      join(scratch, 'shelf', 'books', 'Some-Book', 'images', 'cccc.png'),
      join(scratch, 'shelf', 'images', 'cccc.png')
    ])
    expect(await findPicture(book, 'images/cccc.png')).toBe(
      join(scratch, 'shelf', 'books', 'Some-Book', 'images', 'cccc.png')
    )
  })

  it('finds nothing for a picture in neither place', async () => {
    expect(await findPicture(book, 'images/dddd.png')).toBeNull()
  })

  it('refuses a name that leaves the shelf or a web address misreads, though a file is there', async () => {
    expect(await findPicture(book, '../../../../outside.png')).toBeNull()
    expect(await findPicture(book, join(scratch, 'outside.png'))).toBeNull()
    expect(await findPicture(book, 'images/a%2e.png')).toBeNull()
    expect(await picturePlaces(book, '../../../../outside.png')).toEqual([])
  })

  it('a book outside a shelf finds pictures beside it, and nothing above its folder', async () => {
    const loose = put('loose/two/book.json', '{}')
    const plate = put('loose/two/images/eeee.png')
    put('images/ffff.png')
    expect(await findPicture(loose, 'images/eeee.png')).toBe(plate)
    expect(await findPicture(loose, 'images/ffff.png')).toBeNull()
    expect(await findPicture(loose, '../../images/ffff.png')).toBeNull()
  })
})

describe("every picture a book file's images list names", () => {
  it('returns the found by id with their files, and names the lost', async () => {
    const got = await findBookPictures(book, [
      { id: 'plate1', path: 'images/aaaa.png' },
      { id: 'plate2', path: 'images/bbbb.png' },
      { id: 'plate3', path: 'images/dddd.png' },
      { id: 'plate4', path: '../../../../outside.png' },
      // Carried inline, or with no id: not a named picture, as parseBookFile reads it.
      { id: 'inline', base64: 'AAAA' },
      { path: 'images/aaaa.png' },
      null
    ])
    expect(got).toEqual({
      found: [
        { id: 'plate1', path: 'images/aaaa.png', file: beside },
        { id: 'plate2', path: 'images/bbbb.png', file: atTop }
      ],
      lost: ['images/dddd.png', '../../../../outside.png']
    })
  })

  it('a book file with no images list names nothing', async () => {
    expect(await findBookPictures(book, undefined)).toEqual({ found: [], lost: [] })
  })
})

describe('the helper in plain Node', () => {
  // As the driver runs it: plain Node, no resolver, and the rule handed in (the
  // driver hands in its page's copy). So it works on any Node the driver runs
  // on, not only one that strips TypeScript. The rule here is a stand-in that
  // names one place; where core looks is tested above, under vitest.
  it('loads and finds a picture with the rule handed in, importing no TypeScript', () => {
    const helper = new URL('../scripts/lib/book-pictures.mjs', import.meta.url).href
    const code =
      `const m = await import(${JSON.stringify(helper)});` +
      `const rule = () => ['images/bbbb.png'];` +
      `console.log(await m.findPicture(${JSON.stringify(book)}, 'images/bbbb.png', rule))`
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
      // Type stripping off where this Node has it, so the run is the one a
      // Node without it would give.
      env: process.allowedNodeEnvironmentFlags.has('--no-experimental-strip-types')
        ? { ...process.env, NODE_OPTIONS: '--no-experimental-strip-types' }
        : process.env
    })
    expect(run.stderr).not.toMatch(/Error/)
    expect(run.stdout.trim()).toBe(atTop)
  })
})
