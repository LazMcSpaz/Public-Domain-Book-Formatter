import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  bookFolder,
  insideFolder,
  queriesPath,
  sheetNeedsBook,
  sheetPath,
  sheetRefusal,
  shelfSlug,
  workFileRefusal
} from '@core/sync'

/**
 * The sheets a session makes from a book go beside the book, never into the
 * tools repository (cleanup task 0, docs/specs/sheets-beside-the-book.md).
 *
 * The fault this pins: the driver's sheets defaulted to a bare file name,
 * resolved against the tools repository's root, which is public, and every
 * sheet quotes the book. All paths and names here are made up.
 */

const TOOLS = '/work/tools'
const BOOK = '/work/shelf/books/Someone-SomeTitle-x1/book.json'
const WIN_TOOLS = 'C:\\Users\\someone\\tools'
const WIN_BOOK = 'C:\\Users\\someone\\shelf\\books\\Someone-SomeTitle-x1\\book.json'

describe('a sheet goes beside its book', () => {
  it('lands in the book file’s own folder, POSIX', () => {
    expect(sheetPath(BOOK, 'queries.md')).toBe('/work/shelf/books/Someone-SomeTitle-x1/queries.md')
    expect(sheetPath(BOOK, 'damage.md')).toBe('/work/shelf/books/Someone-SomeTitle-x1/damage.md')
  })

  it('lands in the book file’s own folder, Windows, keeping its separator', () => {
    expect(sheetPath(WIN_BOOK, 'rulings.md')).toBe(
      'C:\\Users\\someone\\shelf\\books\\Someone-SomeTitle-x1\\rulings.md'
    )
    expect(sheetPath('C:/shelf/books/B/book.json', 'review.md')).toBe('C:/shelf/books/B/review.md')
  })

  it('never lands in the tools repository when the book is on a shelf', () => {
    for (const sheet of ['queries.md', 'rulings.md', 'review.md', 'proposals.md', 'damage.md']) {
      expect(sheetRefusal(sheetPath(BOOK, sheet), TOOLS, BOOK)).toBeNull()
      expect(insideFolder(sheetPath(BOOK, sheet), '/work/shelf/books/Someone-SomeTitle-x1')).toBe(
        true
      )
      expect(sheetRefusal(sheetPath(WIN_BOOK, sheet), WIN_TOOLS, WIN_BOOK)).toBeNull()
    }
  })

  it('takes a sheet name, never a path that climbs out of the book’s folder', () => {
    for (const bad of ['../queries.md', 'sub/queries.md', 'sub\\queries.md', '..', '.', '']) {
      expect(() => sheetPath(BOOK, bad)).toThrow()
    }
  })
})

describe('nothing is written inside the tools repository', () => {
  it('refuses the root and anything under it', () => {
    expect(sheetRefusal('/work/tools/queries.md', TOOLS, BOOK)).not.toBeNull()
    expect(sheetRefusal('/work/tools/books/x/damage.md', TOOLS, BOOK)).not.toBeNull()
    expect(sheetRefusal('/work/tools', TOOLS, null)).not.toBeNull()
  })

  it('sees through `.`, `..`, doubled separators and a trailing slash', () => {
    expect(sheetRefusal('/work/shelf/../tools/./queries.md', TOOLS, BOOK)).not.toBeNull()
    expect(sheetRefusal('/work//tools/queries.md', '/work/tools/', BOOK)).not.toBeNull()
  })

  it('refuses on Windows whatever the case or separator', () => {
    expect(sheetRefusal('C:\\Users\\someone\\tools\\queries.md', WIN_TOOLS, null)).not.toBeNull()
    expect(sheetRefusal('c:/users/SOMEONE/Tools/review.md', WIN_TOOLS, null)).not.toBeNull()
    expect(sheetRefusal('D:\\Users\\someone\\tools\\queries.md', WIN_TOOLS, null)).toBeNull()
  })

  it('does not mistake a sibling folder that shares the name’s start', () => {
    expect(sheetRefusal('/work/tools-shelf/books/x/queries.md', TOOLS, BOOK)).toBeNull()
    expect(insideFolder('C:\\Users\\someone\\toolshed\\q.md', WIN_TOOLS)).toBe(false)
  })

  it('names the folder the sheet belongs in', () => {
    const said = sheetRefusal('/work/tools/queries.md', TOOLS, BOOK) ?? ''
    expect(said).toContain('/work/shelf/books/Someone-SomeTitle-x1')
    expect(said).toContain('public')
    const win = sheetRefusal('C:\\Users\\someone\\tools\\q.md', WIN_TOOLS, WIN_BOOK) ?? ''
    expect(win).toContain('C:\\Users\\someone\\shelf\\books\\Someone-SomeTitle-x1')
  })

  it('with no book file known, says to load one and names the shelf folder when known', () => {
    expect(sheetNeedsBook('queries.md', 'Someone-SomeTitle-x1')).toContain(
      'books/Someone-SomeTitle-x1/'
    )
    expect(sheetNeedsBook('damage.md', null)).toContain('load')
  })
})

/**
 * The working files (`body`, `truth`, `second` and the rest) carry the book's
 * text too, and used to default to a bare name in the tools checkout.
 */
describe('no working file is written inside the tools repository', () => {
  const WORK = '/tmp/pdbf-work'

  it('refuses the tools repository and anything under it', () => {
    expect(workFileRefusal('/work/tools/body.json', TOOLS, WORK)).not.toBeNull()
    expect(workFileRefusal('/work/shelf/../tools/second.json', TOOLS, WORK)).not.toBeNull()
    expect(workFileRefusal('c:/users/SOMEONE/Tools/truth.json', WIN_TOOLS, WORK)).not.toBeNull()
  })

  it('allows the scratch folder and any path outside', () => {
    expect(workFileRefusal(`${WORK}/body.json`, TOOLS, WORK)).toBeNull()
    expect(workFileRefusal('/work/tools-shelf/body.json', TOOLS, WORK)).toBeNull()
    expect(workFileRefusal('D:\\Users\\someone\\tools\\b.json', WIN_TOOLS, WORK)).toBeNull()
  })

  it('says where the file goes instead', () => {
    const said = workFileRefusal('/work/tools/body.json', TOOLS, WORK) ?? ''
    expect(said).toContain('public')
    expect(said).toContain(WORK)
  })
})

describe('the shelf path reported is the book’s real folder', () => {
  it('comes from the folder the book file sits in, not from the run’s key', () => {
    // A key carries whatever the scan was called where it was read — here a
    // whole absolute path, as on a machine that did not split it.
    const key = '/home/someone/scans/0123abcd.pdf\u000012345\u000067890'
    expect(bookFolder(BOOK)).toBe('Someone-SomeTitle-x1')
    expect(bookFolder(WIN_BOOK)).toBe('Someone-SomeTitle-x1')
    expect(queriesPath(key, bookFolder(BOOK) ?? undefined)).toBe(
      'books/Someone-SomeTitle-x1/queries.md'
    )
    expect(queriesPath(key)).not.toBe('books/Someone-SomeTitle-x1/queries.md')
    expect(shelfSlug(key)).not.toBe('Someone-SomeTitle-x1')
  })

  it('names no folder for a bare file name', () => {
    expect(bookFolder('book.json')).toBeNull()
  })
})

describe('the driver asks the shelf map for every sheet it writes', () => {
  const driver = readFileSync(resolve(__dirname, '..', 'scripts', 'drive.mjs'), 'utf8')

  it('routes each sheet through `sheetTarget`', () => {
    for (const sheet of ['queries.md', 'parallels.md', 'damage.md', 'sense.md']) {
      expect(driver).toMatch(new RegExp(`sheetTarget\\(\\s*'${sheet.replace('.', '\\.')}'`))
    }
  })

  it('has no sheet defaulting to a bare name in the working directory', () => {
    expect(driver).not.toMatch(/(=|\?\?)\s*'(queries|parallels|damage|sense)\.md'/u)
  })
})
