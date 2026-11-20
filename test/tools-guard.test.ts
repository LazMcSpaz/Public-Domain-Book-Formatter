import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// @ts-expect-error: a plain Node module with no types; the work, storage and driver scripts import it.
import { toolsAround } from '../scripts/lib/tools-guard.mjs'
import { shelfPathProblem } from '@core/sync'

/**
 * The tools guard reads a relative link from the folder the link really sits
 * in. Reached through a link at another depth (a shelf opened through
 * `shelf-link`), a dangling relative link pointing into a copy of the tools
 * was read from the wrong folder and let through, and a plain write through it
 * landed in the tools. Made-up folders in a temp directory only.
 */
const root = mkdtempSync(join(tmpdir(), 'tools-guard-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const name = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name
const tools = join(root, 'tools-copy')
mkdirSync(join(tools, 'sub'), { recursive: true })
writeFileSync(join(tools, 'package.json'), JSON.stringify({ name }))
mkdirSync(join(root, 'data', 'shelf', 'books', 'b'), { recursive: true })
symlinkSync(join(root, 'data', 'shelf'), join(root, 'shelf-link'))
// Relative to its real folder (data/shelf/books/b), four levels up is the root.
symlinkSync(
  join('..', '..', '..', '..', 'tools-copy', 'sub', 'queries.md'),
  join(root, 'data', 'shelf', 'books', 'b', 'queries.md')
)

describe('the tools guard and links', () => {
  it('reads a dangling relative link from its real folder, reached through another link', () => {
    expect(toolsAround(join(root, 'shelf-link', 'books', 'b', 'queries.md'))).toBe(tools)
    expect(toolsAround(join(root, 'data', 'shelf', 'books', 'b', 'queries.md'))).toBe(tools)
  })

  it('lets an ordinary shelf path through', () => {
    expect(toolsAround(join(root, 'shelf-link', 'books', 'b', 'rulings.md'))).toBeNull()
  })
})

describe('a shelf path into git’s own store', () => {
  it('is refused with trailing dots or spaces too, as Windows reads them', () => {
    for (const path of ['.git/config', '.git./config', 'books/b/.GIT../x', '.git /config']) {
      expect(shelfPathProblem(path), path).not.toBeNull()
    }
    expect(shelfPathProblem('.gitignore')).toBeNull()
    expect(shelfPathProblem('.github/x.yml')).toBeNull()
  })
})
