import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { CommandResult, CommandRunner, RunOptions } from '@tooling/process'
import type { ProjectFile, StyleProfile } from '@core/model'
import { createEmptyProject } from '@core/project'
import { defaultStyleProfile } from '@core/style'
import { BUILTIN_ORNAMENTS } from '@core/ornament'
import { assembleAndExport } from '@tooling/export'

interface Call {
  cmd: string
  args: string[]
}

/**
 * A mock runner that records every invocation, writes the pandoc fragment file so
 * the orchestrator can read it back, and returns a canned xelatex log carrying a
 * page count.
 */
function mockRunner(): CommandRunner & { calls: Call[] } {
  const calls: Call[] = []
  const runner = (async (cmd: string, args: string[], _opts?: RunOptions) => {
    void _opts
    calls.push({ cmd, args })
    if (cmd === 'pandoc') {
      // Honor -o <outputPath> by writing a fragment so assemble reads it back.
      const oIdx = args.indexOf('-o')
      if (oIdx >= 0 && args[oIdx + 1]) {
        await fs.writeFile(args[oIdx + 1]!, '\\section{Body}\nHello world.\n', 'utf8')
      }
      return { code: 0, stdout: '', stderr: '' } satisfies CommandResult
    }
    if (cmd === 'xelatex') {
      return {
        code: 0,
        stdout: [
          'This is XeTeX, Version 3.14159',
          'Overfull \\hbox (5pt too wide) in paragraph at lines 1--2',
          'Output written on book.pdf (123 pages, 456789 bytes).',
          'Transcript written on book.log.'
        ].join('\n'),
        stderr: ''
      } satisfies CommandResult
    }
    // rsvg-convert and anything else.
    return { code: 0, stdout: '', stderr: '' } satisfies CommandResult
  }) as CommandRunner & { calls: Call[] }
  runner.calls = calls
  return runner
}

let buildDir: string

beforeEach(async () => {
  buildDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdbf-export-'))
})

afterEach(async () => {
  await fs.rm(buildDir, { recursive: true, force: true })
})

function makeProject(): ProjectFile {
  const project = createEmptyProject({
    pdfPath: '/in/book.pdf',
    pageCount: 5,
    config: { title: 'A Title', author: 'An Author', trimSize: '6x9' }
  })
  project.markdown = '# Chapter One\n\nSome body text.\n'
  // A confirmed heading so buildToc yields an entry.
  project.tags = [{ id: 't1', type: 'heading', range: { start: 2, end: 13 }, data: { level: 1 } }]
  return project
}

function makeProfile(): StyleProfile {
  const profile = defaultStyleProfile()
  // Choose ornaments that exist in the builtin library so they get converted.
  const chapter = BUILTIN_ORNAMENTS.find((o) => o.kind === 'chapter')!
  const divider = BUILTIN_ORNAMENTS.find((o) => o.kind === 'divider')!
  profile.ornaments = {
    chapterOpener: chapter.id,
    sectionDivider: divider.id,
    pageNumber: null
  }
  return profile
}

describe('assembleAndExport', () => {
  it('runs pandoc → svg2pdf (per ornament) → xelatex in order with correct argv', async () => {
    const run = mockRunner()
    const project = makeProject()
    const profile = makeProfile()

    const result = await assembleAndExport({
      project,
      projectPath: process.cwd(),
      profile,
      buildDir,
      run
    })

    const cmds = run.calls.map((c) => c.cmd)
    // Order: pandoc first, then the two ornament conversions, then xelatex last.
    expect(cmds[0]).toBe('pandoc')
    expect(cmds[cmds.length - 1]).toBe('xelatex')
    const firstSvg = cmds.indexOf('rsvg-convert')
    const lastSvg = cmds.lastIndexOf('rsvg-convert')
    expect(firstSvg).toBeGreaterThan(0)
    expect(firstSvg).toBeLessThan(cmds.indexOf('xelatex'))
    expect(lastSvg).toBeLessThan(cmds.indexOf('xelatex'))
    // Two distinct ornaments chosen → two conversions.
    expect(cmds.filter((c) => c === 'rsvg-convert')).toHaveLength(2)

    // pandoc argv: markdown → latex fragment, written to body.tex.
    const pandoc = run.calls.find((c) => c.cmd === 'pandoc')!
    expect(pandoc.args.slice(0, 4)).toEqual(['-f', 'markdown', '-t', 'latex'])
    expect(pandoc.args).not.toContain('--standalone')
    // Level-1 headings become \chapter (recto openings, TOC, running heads).
    expect(pandoc.args).toContain('--top-level-division=chapter')
    expect(pandoc.args).toContain('-o')
    expect(pandoc.args.some((a) => a.endsWith('body.tex'))).toBe(true)

    // rsvg-convert argv: -f pdf -o <out.pdf> <in.svg>.
    const svg = run.calls.find((c) => c.cmd === 'rsvg-convert')!
    expect(svg.args.slice(0, 2)).toEqual(['-f', 'pdf'])
    expect(svg.args).toContain('-o')
    expect(svg.args.some((a) => a.endsWith('.pdf'))).toBe(true)
    expect(svg.args[svg.args.length - 1]).toMatch(/\.svg$/)

    // xelatex argv: book.tex into the build dir.
    const xelatex = run.calls.find((c) => c.cmd === 'xelatex')!
    expect(xelatex.args).toContain('-interaction=nonstopmode')
    expect(xelatex.args).toContain(`-output-directory=${buildDir}`)
    expect(xelatex.args[xelatex.args.length - 1]).toBe('book.tex')

    // ExportResult carries the parsed page count and a validation report.
    expect(result.pageCount).toBe(123)
    expect(result.pdfPath).toBe(path.join(buildDir, 'book.pdf'))
    expect(result.validation.pageCount).toBe(123)
    expect(result.validation.checks.length).toBeGreaterThan(0)
    // The overfull-box warning surfaced into the warnings check.
    const warnCheck = result.validation.checks.find((c) => c.id === 'latex-warnings')
    expect(warnCheck?.level).toBe('warn')

    // The full LaTeX document was written.
    const bookTex = await fs.readFile(path.join(buildDir, 'book.tex'), 'utf8')
    expect(bookTex).toContain('\\begin{document}')
  })

  it('skips ornament conversion when none are chosen', async () => {
    const run = mockRunner()
    const project = makeProject()
    const profile = defaultStyleProfile()
    profile.ornaments = { chapterOpener: null, sectionDivider: null, pageNumber: null }

    await assembleAndExport({ project, projectPath: process.cwd(), profile, buildDir, run })

    const cmds = run.calls.map((c) => c.cmd)
    expect(cmds.filter((c) => c === 'rsvg-convert')).toHaveLength(0)
    // One pandoc, then three xelatex passes (TOC + running heads + settle).
    expect(cmds).toEqual(['pandoc', 'xelatex', 'xelatex', 'xelatex'])
  })

  it('crops accepted image regions from the source PDF and places figures', async () => {
    const run = mockRunner()
    // A real file so the source-PDF existence check passes; content is irrelevant
    // (the mock runner stands in for pdftoppm).
    const pdfPath = path.join(buildDir, 'source.pdf')
    await fs.writeFile(pdfPath, '%PDF-1.4\n', 'utf8')

    const project = makeProject()
    project.source = { pdfPath, pageCount: 1 }
    project.pages = [
      {
        index: 0,
        imagePath: null,
        width: 1000,
        height: 1500,
        dpi: 300,
        words: [],
        regions: [
          { id: 'r0', pageIndex: 0, bbox: { x0: 100, y0: 200, x1: 700, y1: 1000 }, accepted: true },
          { id: 'r1', pageIndex: 0, bbox: { x0: 0, y0: 0, x1: 50, y1: 50 }, accepted: false }
        ]
      }
    ]
    project.coordinateMap = [
      {
        tokenId: 'p0_w0',
        pageIndex: 0,
        bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
        output: { start: 15, end: 19 }
      }
    ]

    await assembleAndExport({
      project,
      projectPath: buildDir,
      profile: defaultStyleProfile(),
      buildDir,
      run
    })

    // Exactly one crop (only the accepted region), single-file, page 1.
    const crops = run.calls.filter((c) => c.cmd === 'pdftoppm')
    expect(crops).toHaveLength(1)
    expect(crops[0]!.args).toContain('-singlefile')
    expect(crops[0]!.args.join(' ')).toContain('-f 1')

    // The figure landed in the export markdown that pandoc consumed.
    const bodyMd = await fs.readFile(path.join(buildDir, 'body.md'), 'utf8')
    expect(bodyMd).toContain('\\includegraphics')
    expect(bodyMd).toContain('\\IfFileExists{img-0.png}')
  })

  it('applies saved image edits: crops to PPM, runs the op stack, re-encodes PNG', async () => {
    const pdfPath = path.join(buildDir, 'source.pdf')
    await fs.writeFile(pdfPath, '%PDF-1.4\n', 'utf8')

    // A runner that, for a PPM crop (pdftoppm without -png), writes a 2×2 P6.
    const calls: Call[] = []
    const run: CommandRunner = (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      if (cmd === 'pandoc') {
        const oIdx = args.indexOf('-o')
        if (oIdx >= 0 && args[oIdx + 1]) await fs.writeFile(args[oIdx + 1]!, 'body\n', 'utf8')
        return { code: 0, stdout: '', stderr: '' } satisfies CommandResult
      }
      if (cmd === 'pdftoppm' && !args.includes('-png')) {
        const prefix = args[args.length - 1]!
        const px = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255] // 2×2 RGB
        await fs.writeFile(
          `${prefix}.ppm`,
          Buffer.concat([Buffer.from('P6\n2 2\n255\n', 'ascii'), Buffer.from(px)])
        )
        return { code: 0, stdout: '', stderr: '' } satisfies CommandResult
      }
      if (cmd === 'xelatex') {
        return {
          code: 0,
          stdout: 'Output written on book.pdf (5 pages, 10 bytes).',
          stderr: ''
        } satisfies CommandResult
      }
      return { code: 0, stdout: '', stderr: '' } satisfies CommandResult
    }) as CommandRunner

    const project = makeProject()
    project.source = { pdfPath, pageCount: 1 }
    project.pages = [
      {
        index: 0,
        imagePath: null,
        width: 1000,
        height: 1500,
        dpi: 300,
        words: [],
        regions: [
          { id: 'r0', pageIndex: 0, bbox: { x0: 100, y0: 200, x1: 700, y1: 1000 }, accepted: true }
        ]
      }
    ]
    project.imageEdits = [{ regionId: 'r0', ops: [{ op: 'grayscale', params: {} }] }]

    await assembleAndExport({
      project,
      projectPath: buildDir,
      profile: defaultStyleProfile(),
      buildDir,
      run
    })

    // A PPM crop (edit path), not a PNG crop.
    const crops = calls.filter((c) => c.cmd === 'pdftoppm')
    expect(crops).toHaveLength(1)
    expect(crops[0]!.args).not.toContain('-png')

    // The edited image was re-encoded to a real PNG in the build dir.
    const png = await fs.readFile(path.join(buildDir, 'img-0.png'))
    expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  })
})
