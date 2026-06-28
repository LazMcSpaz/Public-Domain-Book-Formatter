import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { PipelineProgress } from '@shared/ipc-types'
import type { CommandRunner } from '@tooling/process'
import { runPipeline, DEFAULT_STAGES } from '@pipeline/pipeline'
import { cleanupText, dehyphenate, normalizeLigatures } from '@pipeline/stages/cleanup'
import type { Stage } from '@pipeline/stage'

const tmpDirs: string[] = []

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function makeTmpProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdbf-test-'))
  tmpDirs.push(dir)
  return dir
}

/**
 * Mock runner that emulates the binaries WITHOUT installing them. It writes a
 * tiny real hOCR file when tesseract is invoked so the OCR stage can read +
 * parse it through @core/hocr. pdfinfo reports 1 page; pdftoppm writes a
 * placeholder image.
 */
function fakeBinaries(): CommandRunner {
  const HOCR = `<!DOCTYPE html><html><body>
  <div class="ocr_page" title="bbox 0 0 1000 1500">
    <span class="ocrx_word" title="bbox 10 20 80 50; x_wconf 95">Hello</span>
    <span class="ocrx_word" title="bbox 90 20 200 50; x_wconf 40">world</span>
  </div></body></html>`

  return async (cmd: string, args: string[]) => {
    if (cmd === 'pdfinfo') {
      return { code: 0, stdout: 'Pages:           1\n', stderr: '' }
    }
    if (cmd === 'pdftoppm') {
      const outPrefix = args[args.length - 1]!
      await fs.writeFile(`${outPrefix}-1.png`, 'fake-png')
      return { code: 0, stdout: '', stderr: '' }
    }
    if (cmd === 'tesseract') {
      const outBase = args[1]!
      await fs.writeFile(`${outBase}.hocr`, HOCR)
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
}

describe('runPipeline (hermetic)', () => {
  it('emits progress before/after each stage in order and persists results', async () => {
    const projectPath = await makeTmpProject()
    const progress: PipelineProgress[] = []

    const result = await runPipeline({
      pdfPath: '/fake/book.pdf',
      projectPath,
      run: fakeBinaries(),
      onProgress: (p) => progress.push(p)
    })

    // 6 stages × (start + finish) = 12 progress events, in stage order.
    expect(progress).toHaveLength(DEFAULT_STAGES.length * 2)
    const stageOrder = progress.filter((p) => p.message?.startsWith('starting')).map((p) => p.stage)
    expect(stageOrder).toEqual([
      'extract',
      'ocr',
      'image-detect',
      'cleanup',
      'structure',
      'markdown'
    ])
    // indices are monotonic and bounded.
    progress.forEach((p) => {
      expect(p.index).toBeGreaterThanOrEqual(0)
      expect(p.index).toBeLessThan(p.total)
    })

    expect(result.pageCount).toBe(1)
    expect(result.projectPath).toBe(projectPath)

    // The project manifest was written with pages + coordinate map + flags.
    const manifest = JSON.parse(await fs.readFile(path.join(projectPath, 'project.json'), 'utf8'))
    expect(manifest.source.pageCount).toBe(1)
    expect(manifest.pages[0].words).toHaveLength(2)
    expect(manifest.coordinateMap).toHaveLength(2)
    // Running-concat offsets: "Hello" [0,5), "world" [6,11).
    expect(manifest.coordinateMap[0].output).toEqual({ start: 0, end: 5 })
    expect(manifest.coordinateMap[1].output).toEqual({ start: 6, end: 11 })
    // Low-confidence OCR flag for "world" (conf 40 < 60).
    const ocrFlags = manifest.flags.filter((f: { kind: string }) => f.kind === 'ocr')
    expect(ocrFlags.length).toBeGreaterThanOrEqual(1)
  })

  it('stops the run when the signal is already aborted', async () => {
    const projectPath = await makeTmpProject()
    const controller = new AbortController()
    controller.abort()

    await expect(
      runPipeline({
        pdfPath: '/fake/book.pdf',
        projectPath,
        run: fakeBinaries(),
        signal: controller.signal
      })
    ).rejects.toThrow(/aborted/i)
  })

  it('cancels mid-run between stages', async () => {
    const projectPath = await makeTmpProject()
    const controller = new AbortController()
    const seen: string[] = []

    // A custom stage list where the 2nd stage aborts the signal.
    const stages: Stage[] = [
      {
        name: 'first',
        async run() {
          seen.push('first')
        }
      },
      {
        name: 'aborter',
        async run() {
          seen.push('aborter')
          controller.abort()
        }
      },
      {
        name: 'should-not-run',
        async run() {
          seen.push('should-not-run')
        }
      }
    ]

    await expect(
      runPipeline({
        pdfPath: '/fake/book.pdf',
        projectPath,
        run: fakeBinaries(),
        signal: controller.signal,
        stages
      })
    ).rejects.toThrow(/aborted/i)
    expect(seen).toEqual(['first', 'aborter'])
  })
})

describe('cleanup pure transforms', () => {
  it('de-hyphenates words split across a line break', () => {
    const { text, labels } = dehyphenate('inter-\nnational coop-\neration')
    expect(text).toBe('international cooperation')
    expect(labels).toEqual(['de-hyphenated', 'de-hyphenated'])
  })

  it('normalizes ligatures', () => {
    const { text, labels } = normalizeLigatures('ﬁsh and ﬂour')
    expect(text).toBe('fish and flour')
    expect(labels).toEqual(['ligature-normalized', 'ligature-normalized'])
  })

  it('cleanupText runs all transforms and reports touched labels', () => {
    const { text, labels } = cleanupText('PAGE HEADER\nﬁre-\nfly\n42')
    expect(text).toContain('firefly')
    // header + footer (page number) + de-hyphen + ligature all fired.
    expect(labels).toContain('header-stripped')
    expect(labels).toContain('footer-stripped')
    expect(labels).toContain('de-hyphenated')
    expect(labels).toContain('ligature-normalized')
  })
})
