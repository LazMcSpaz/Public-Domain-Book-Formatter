import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { stripBom as coreStripBom } from '@core/sync'
// @ts-expect-error — a plain Node module with no types: the scripts load it
// before anything can load TypeScript.
import { parseJson, readJson, readJsonSync, readText, stripBom } from '../scripts/lib/json-file.mjs'

/**
 * Windows PowerShell's `Out-File -Encoding utf8` writes a byte-order mark in
 * front of a JSON file, and `JSON.parse` refuses it, so a file made that way
 * on Windows and handed to a script (`drive.mjs propose`, say) was refused.
 */
const BOM = '﻿'
const dir = mkdtempSync(join(tmpdir(), 'json-file-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('a JSON file with a byte-order mark', () => {
  const path = join(dir, 'proposals.json')
  writeFileSync(path, `${BOM}[{"leaf":3,"options":["a","b"]}]\r\n`, 'utf8')

  it('is read, not refused', async () => {
    expect(readJsonSync(path)).toEqual([{ leaf: 3, options: ['a', 'b'] }])
    expect(await readJson(path)).toEqual([{ leaf: 3, options: ['a', 'b'] }])
    expect(parseJson(`${BOM}{"a":1}`)).toEqual({ a: 1 })
  })

  it('keeps a text file whole but for the mark', async () => {
    const text = join(dir, 'replacement.txt')
    writeFileSync(text, `${BOM}A sentence as printed.\n`, 'utf8')
    expect(await readText(text)).toBe('A sentence as printed.\n')
  })

  it('follows the same rule as core', () => {
    for (const text of [`${BOM}{"a":1}`, '{"a":1}', '', BOM, `x${BOM}`]) {
      expect(stripBom(text)).toBe(coreStripBom(text))
    }
  })
})

/**
 * The helper only helps where it is used. Every script that reads a JSON file
 * goes through it; one that parses `readFileSync` or `readFile` directly would
 * refuse the owner's file again. The older reading kit is left out: its rules
 * allow only `drive.mjs` and Node's own modules, and it is to be merged.
 */
describe('the scripts read JSON files through the helper', () => {
  const root = new URL('../scripts/', import.meta.url)
  const files = [
    ...readdirSync(root)
      .filter((f) => /\.(mjs|ts)$/u.test(f))
      .map((f) => new URL(f, root)),
    ...readdirSync(new URL('lib/', root))
      .filter((f) => /\.mjs$/u.test(f) && f !== 'json-file.mjs')
      .map((f) => new URL(`lib/${f}`, root))
  ]

  it('finds the scripts', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('no script parses a file straight off the disk', () => {
    const direct = files.filter((f) =>
      /(JSON\.parse|parseBookFile)\(\s*(readFileSync|await readFile)\(/u.test(
        readFileSync(f, 'utf8')
      )
    )
    expect(direct.map((f) => f.pathname.split('/scripts/')[1])).toEqual([])
  })

  it('propose reads its file through the helper', () => {
    const driver = readFileSync(new URL('drive.mjs', root), 'utf8')
    const start = driver.indexOf('propose: async')
    expect(start).toBeGreaterThan(-1)
    expect(driver.slice(start, driver.indexOf('\n    },\n', start))).toMatch(
      /readJsonSync\(resolve\(file\)\)/
    )
  })
})
