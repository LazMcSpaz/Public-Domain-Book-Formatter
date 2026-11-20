/**
 * `scripts/textground.mjs` writes a book's own text as a cover ground, so it
 * refuses to write inside any copy of the tools, which are public. A text
 * ground once reached `public/patterns/` this way.
 *
 * The refusal is tried against a copy of the tools in a temporary folder, so a
 * broken guard writes there and not into this repository. Made-up text only.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'textground-script-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// A copy of the tools: any folder whose package.json is the tools' own.
const tools = join(dir, 'tools-copy')
mkdirSync(join(tools, 'public'), { recursive: true })
writeFileSync(join(tools, 'package.json'), readFileSync(join(REPO, 'package.json')))

const book = join(dir, 'made-up-book.json')
writeFileSync(
  book,
  JSON.stringify({
    transcriptions: [
      {
        pageIndex: 0,
        blocks: [
          {
            kind: 'paragraph',
            text: 'Made-up words standing for a book. '.repeat(400),
            strong: [0]
          }
        ]
      }
    ]
  })
)

function textground(out: string) {
  const r = spawnSync(
    process.execPath,
    ['scripts/textground.mjs', book, out, '--width', '2', '--height', '2'],
    {
      cwd: REPO,
      encoding: 'utf8'
    }
  )
  return { status: r.status, err: r.stderr }
}

describe('textground.mjs keeps a book’s text out of the tools', () => {
  it('refuses a path inside a copy of the tools, and writes nothing', () => {
    const r = textground(join(tools, 'public', 'ground.svg'))
    expect(r.status).toBe(2)
    expect(r.err).toMatch(/Refusing to write a book's text ground .* inside the tools repository/)
    expect(readdirSync(join(tools, 'public'))).toEqual([])
  }, 30_000)

  it('writes the ground to a folder outside the tools', () => {
    const out = join(dir, 'ground.svg')
    const r = textground(out)
    expect(r.status).toBe(0)
    expect(existsSync(out)).toBe(true)
    expect(readFileSync(out, 'utf8')).toMatch(/^<\?xml|^<svg/)
  }, 30_000)
})
