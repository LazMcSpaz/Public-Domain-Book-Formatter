import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The two italic witnesses, run as a session runs them, on synthetic PDFs
 * built here (cleanup task 18). A witness that measured nothing used to write
 * an empty list and report success, which reads exactly like "this scan
 * prints no italic". Now it exits with an error and writes nothing; and the
 * slant witness, given word boxes for a scan with no text layer, measures.
 *
 * The "scan" is a page of upright bars drawn as shapes: ink with no text
 * layer, as a photograph has. Its boxes are written in pixels of the 300-DPI
 * render, the form `drive.mjs words --out` writes.
 */
const REPO = fileURLToPath(new URL('..', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'witness-loud-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const at = (name: string): string => join(dir, name)
const PT = 300 / 72

beforeAll(async () => {
  // Three "words" of upright strokes on a page with no text at all.
  const scan = await PDFDocument.create()
  const page = scan.addPage([300, 200])
  const words: { text: string; x0: number; y0: number; x1: number; y1: number }[] = []
  for (let w = 0; w < 3; w++) {
    const left = 30 + w * 80
    for (let s = 0; s < 5; s++) {
      page.drawRectangle({ x: left + s * 10, y: 100, width: 3, height: 22, color: rgb(0, 0, 0) })
    }
    // pdf-lib measures from the foot of the page; the render from its head.
    words.push({
      text: 'abcde',
      x0: Math.floor((left - 4) * PT),
      y0: Math.floor((200 - 126) * PT),
      x1: Math.ceil((left + 47) * PT),
      y1: Math.ceil((200 - 96) * PT)
    })
  }
  scan.addPage([300, 200]) // a blank second leaf, with no boxes
  writeFileSync(at('no-layer.pdf'), await scan.save())
  writeFileSync(at('boxes.json'), JSON.stringify([{ page: 0, words }]))

  // A page whose text layer names its face: what italic-witness reads.
  const typeset = await PDFDocument.create()
  const font = await typeset.embedFont(StandardFonts.TimesRoman)
  typeset
    .addPage([300, 200])
    .drawText('Synthetic words set in a roman face', { x: 20, y: 100, size: 12, font })
  writeFileSync(at('typeset.pdf'), await typeset.save())
})

function slant(args: string[]) {
  return spawnSync(
    process.execPath,
    [
      join(REPO, 'node_modules', 'vite-node', 'vite-node.mjs'),
      '--config',
      'vitest.config.ts',
      'scripts/slant-witness.ts',
      ...args
    ],
    { cwd: REPO, encoding: 'utf8' }
  )
}
const italic = (args: string[]) =>
  spawnSync(process.execPath, ['scripts/italic-witness.mjs', ...args], {
    cwd: REPO,
    encoding: 'utf8'
  })

describe('slant-witness.ts', () => {
  it('exits with an error, and writes nothing, on a scan with no layer and no boxes', () => {
    const run = slant([at('no-layer.pdf'), at('w-none.json')])
    expect(run.status, run.stdout).toBe(1)
    expect(run.stderr).toMatch(/measured no words.*no text layer/)
    expect(run.stderr).toMatch(/drive\.mjs words --out/)
    expect(existsSync(at('w-none.json'))).toBe(false)
  }, 60_000)

  it('measures the words of the same scan when given their boxes', () => {
    const run = slant([at('no-layer.pdf'), at('w-boxes.json'), '--words', at('boxes.json')])
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toMatch(/wordsMeasured: 3/)
    expect(existsSync(at('w-boxes.json'))).toBe(true)
  }, 60_000)

  it('exits with an error when the boxes are for pages it was not asked to read', () => {
    const run = slant([
      at('no-layer.pdf'),
      at('w-off.json'),
      '--words',
      at('boxes.json'),
      '--pages',
      '1-1'
    ])
    expect(run.status, run.stdout).toBe(1)
    expect(run.stderr).toMatch(/--words file has none for those pages/)
    expect(existsSync(at('w-off.json'))).toBe(false)
  }, 60_000)
})

describe('italic-witness.mjs', () => {
  it('exits with an error, and writes nothing, on a file with no text layer', () => {
    const run = italic([at('no-layer.pdf'), at('i-none.json')])
    expect(run.status, run.stdout).toBe(1)
    expect(run.stderr).toMatch(/judged no line/)
    expect(existsSync(at('i-none.json'))).toBe(false)
  }, 60_000)

  it('still answers for a file whose layer names its face, italic found or not', () => {
    const run = italic([at('typeset.pdf'), at('i-face.json')])
    expect(run.status, run.stderr).toBe(0)
    expect(existsSync(at('i-face.json'))).toBe(true)
  }, 60_000)
})
