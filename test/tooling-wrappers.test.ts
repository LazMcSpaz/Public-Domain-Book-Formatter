import { describe, it, expect } from 'vitest'
import type { CommandRunner, CommandResult } from '@tooling/process'
import { extractPages, buildExtractArgs, buildCropRegionArgs } from '@tooling/wrappers/pdf-extract'
import { ocrToHocr, buildHocrArgs } from '@tooling/wrappers/tesseract'
import { buildOcrArgs } from '@tooling/wrappers/ocrmypdf'
import { buildPandocArgs } from '@tooling/wrappers/pandoc'
import { typeset, parseLogWarnings, buildXelatexArgs } from '@tooling/wrappers/xelatex'

function recordingRunner(
  result: CommandResult = { code: 0, stdout: '', stderr: '' }
): CommandRunner & { calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = []
  const runner = (async (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    return result
  }) as CommandRunner & { calls: typeof calls }
  runner.calls = calls
  return runner
}

describe('pdftoppm wrapper', () => {
  it('builds -png -r 300 with output prefix', () => {
    const args = buildExtractArgs('/in/book.pdf', '/out/page', { lastPage: 3 })
    expect(args).toContain('-png')
    expect(args.join(' ')).toContain('-r 300')
    expect(args[args.length - 1]).toBe('/out/page')
    expect(args[args.length - 2]).toBe('/in/book.pdf')
  })

  it('predicts zero-padded page image paths', async () => {
    const run = recordingRunner()
    const paths = await extractPages('/in/book.pdf', '/out', { lastPage: 12 }, run)
    expect(run.calls[0]!.cmd).toBe('pdftoppm')
    expect(paths[0]).toBe('/out/page-01.png')
    expect(paths[11]).toBe('/out/page-12.png')
  })

  it('builds a single-file crop-region argv with integer pixel box', () => {
    const args = buildCropRegionArgs('/in/book.pdf', '/out/img-0', {
      page: 3,
      dpi: 300,
      x: 10.7,
      y: 20.2,
      w: 100.4,
      h: 50.9
    })
    expect(args).toContain('-singlefile')
    expect(args.join(' ')).toContain('-f 3')
    expect(args.join(' ')).toContain('-l 3')
    // x/y floor, w/h ceil.
    expect(args.join(' ')).toContain('-x 10')
    expect(args.join(' ')).toContain('-y 20')
    expect(args.join(' ')).toContain('-W 101')
    expect(args.join(' ')).toContain('-H 51')
    expect(args[args.length - 1]).toBe('/out/img-0')
    expect(args[args.length - 2]).toBe('/in/book.pdf')
  })
})

describe('tesseract wrapper', () => {
  it('puts the hocr config last', () => {
    const args = buildHocrArgs('/out/page-01.png', '/out/page-01', { language: 'eng' })
    expect(args[args.length - 1]).toBe('hocr')
    expect(args).toContain('-l')
    expect(args).toContain('eng')
  })

  it('returns the predicted .hocr path', async () => {
    const run = recordingRunner()
    const out = await ocrToHocr('/out/page-01.png', '/out/page-01', {}, run)
    expect(out).toBe('/out/page-01.hocr')
    expect(run.calls[0]!.cmd).toBe('tesseract')
    expect(run.calls[0]!.args[run.calls[0]!.args.length - 1]).toBe('hocr')
  })
})

describe('ocrmypdf wrapper', () => {
  it('builds -l, --output-type and --sidecar', () => {
    const args = buildOcrArgs({
      inputPdf: '/in.pdf',
      outputPdf: '/out.pdf',
      sidecarTextPath: '/out.txt',
      language: 'eng'
    })
    expect(args).toContain('-l')
    expect(args).toContain('eng')
    expect(args).toContain('--output-type')
    expect(args).toContain('--sidecar')
    expect(args).toContain('/out.txt')
    expect(args[args.length - 1]).toBe('/out.pdf')
  })
})

describe('pandoc wrapper', () => {
  it('builds -f markdown -t latex', () => {
    const args = buildPandocArgs({ outputPath: '/out.tex', inputPath: '/in.md' })
    expect(args.slice(0, 4)).toEqual(['-f', 'markdown', '-t', 'latex'])
    expect(args).toContain('-o')
    expect(args).toContain('/out.tex')
  })

  it('maps the top level to \\chapter by default, and can be turned off', () => {
    expect(buildPandocArgs({})).toContain('--top-level-division=chapter')
    expect(buildPandocArgs({ topLevelDivisionChapter: true })).toContain(
      '--top-level-division=chapter'
    )
    expect(buildPandocArgs({ topLevelDivisionChapter: false })).not.toContain(
      '--top-level-division=chapter'
    )
  })
})

describe('xelatex wrapper', () => {
  it('builds nonstopmode + output-directory', () => {
    const args = buildXelatexArgs('/work/book.tex', '/work/out')
    expect(args).toContain('-interaction=nonstopmode')
    expect(args).toContain('-output-directory=/work/out')
    expect(args[args.length - 1]).toBe('/work/book.tex')
  })

  it('parses an overfull-box warning from a fake log', () => {
    const log = [
      'This is XeTeX, Version 3.14159',
      'Overfull \\hbox (12.34pt too wide) in paragraph at lines 10--12',
      'Underfull \\vbox (badness 10000) has occurred while \\output is active',
      'just some normal output'
    ].join('\n')
    const warnings = parseLogWarnings(log)
    expect(warnings.length).toBe(2)
    expect(warnings[0]).toMatch(/Overfull \\hbox/)
    expect(warnings[1]).toMatch(/Underfull \\vbox/)
  })

  it('surfaces warnings from the typeset run output', async () => {
    const run = recordingRunner({
      code: 0,
      stdout: 'Overfull \\hbox (5pt too wide) in paragraph at lines 1--2',
      stderr: ''
    })
    const { pdfPath, warnings } = await typeset('/work/book.tex', '/work/out', {}, run)
    expect(pdfPath).toBe('/work/out/book.pdf')
    expect(warnings).toHaveLength(1)
  })

  it('runs xelatex once by default and N times when passes is set', async () => {
    const once = recordingRunner()
    await typeset('/work/book.tex', '/work/out', {}, once)
    expect(once.calls.filter((c) => c.cmd === 'xelatex')).toHaveLength(1)

    const thrice = recordingRunner()
    await typeset('/work/book.tex', '/work/out', { passes: 3 }, thrice)
    expect(thrice.calls.filter((c) => c.cmd === 'xelatex')).toHaveLength(3)
  })
})
