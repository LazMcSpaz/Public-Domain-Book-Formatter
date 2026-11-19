import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * `shelf-new-book.ts` puts a new book on the shelf. A sparse checkout of the
 * shelf may hold no `scans/` or `books/` folder at all, and the script died
 * copying the scan into a folder that was not there. This runs the script
 * itself, as a session does, on an empty folder.
 */
const REPO = fileURLToPath(new URL('..', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'shelf-new-book-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('a new book on a sparse shelf', () => {
  it('creates scans/ and books/ before copying', () => {
    const shelf = join(dir, 'shelf')
    const scan = join(dir, 'scan.pdf')
    const leaf = join(dir, 'leaf0.json')
    writeFileSync(scan, '%PDF-1.4 synthetic, never opened')
    // With a byte-order mark, as Windows PowerShell writes it.
    writeFileSync(leaf, '﻿{"pageIndex":0,"role":"blank","blocks":[]}')
    const run = spawnSync(
      process.execPath,
      [
        join(REPO, 'node_modules', 'vite-node', 'vite-node.mjs'),
        '--config',
        'vitest.config.ts',
        'scripts/shelf-new-book.ts',
        shelf,
        scan,
        'Synthetic-Book',
        '3',
        '',
        leaf
      ],
      { cwd: REPO, encoding: 'utf8' }
    )
    expect(run.status, run.stderr).toBe(0)
    expect(readdirSync(join(shelf, 'scans'))).toHaveLength(1)
    const [book] = readdirSync(join(shelf, 'books'))
    expect(book).toMatch(/^Synthetic-Book-/u)
    expect(existsSync(join(shelf, 'books', book!, 'book.json'))).toBe(true)
    expect(existsSync(join(shelf, 'books', book!, 'about.json'))).toBe(true)
  }, 60_000)
})
