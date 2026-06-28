import { describe, it, expect } from 'vitest'
import {
  dehyphenate,
  normalizeLigatures,
  fixOcrConfusions,
  stripHeaderFooter,
  cleanupText,
  cleanupStage
} from '../src/pipeline/stages/cleanup'
import type { PipelineContext } from '../src/pipeline/stage'

describe('dehyphenate', () => {
  it('joins a word split by a trailing hyphen across a line break', () => {
    const r = dehyphenate('inter-\nnational law')
    expect(r.text).toBe('international law')
    expect(r.labels).toEqual(['de-hyphenated'])
  })

  it('leaves a hyphen alone when the next line starts non-lowercase', () => {
    const r = dehyphenate('Anglo-\nSaxon')
    expect(r.text).toBe('Anglo-\nSaxon')
    expect(r.labels).toEqual([])
  })

  it('reports one label per join', () => {
    const r = dehyphenate('be-\ncause some-\nthing')
    expect(r.text).toBe('because something')
    expect(r.labels).toHaveLength(2)
  })
})

describe('normalizeLigatures', () => {
  it('expands fi/fl/ffi ligatures and reports each', () => {
    const r = normalizeLigatures('ﬁ ﬂ ﬃ')
    expect(r.text).toBe('fi fl ffi')
    expect(r.labels).toEqual(['ligature-normalized', 'ligature-normalized', 'ligature-normalized'])
  })

  it('expands æ/œ digraphs', () => {
    expect(normalizeLigatures('æon Œuvre').text).toBe('aeon OEuvre')
  })

  it('leaves plain ASCII untouched', () => {
    const r = normalizeLigatures('plain text')
    expect(r.text).toBe('plain text')
    expect(r.labels).toEqual([])
  })
})

describe('fixOcrConfusions', () => {
  it('normalizes long-s to s', () => {
    const r = fixOcrConfusions('ſong')
    expect(r.text).toBe('song')
    expect(r.labels).toContain('long-s-normalized')
  })

  it('removes the Unicode replacement char', () => {
    const r = fixOcrConfusions('wo�rd')
    expect(r.text).toBe('word')
    expect(r.labels).toContain('replacement-char-removed')
  })
})

describe('stripHeaderFooter', () => {
  it('drops a bare page number at the top', () => {
    const r = stripHeaderFooter('12\nReal body text follows here.')
    expect(r.text).toBe('Real body text follows here.')
    expect(r.labels).toContain('header-stripped')
  })

  it('drops a short ALL-CAPS running head at top and a page number at bottom', () => {
    const r = stripHeaderFooter('CHAPTER ONE\nThe body of the page.\n42')
    expect(r.text).toBe('The body of the page.')
    expect(r.labels).toEqual(['header-stripped', 'footer-stripped'])
  })

  it('leaves ordinary prose lines intact', () => {
    const input = 'It was the best of times, it was the worst of times.'
    const r = stripHeaderFooter(input)
    expect(r.text).toBe(input)
    expect(r.labels).toEqual([])
  })
})

describe('cleanupText', () => {
  it('composes all transforms and accumulates labels', () => {
    const r = cleanupText('7\ninter-\nnational ﬁle ſet')
    expect(r.text).toContain('international file set')
    expect(r.labels).toEqual(expect.arrayContaining(['de-hyphenated', 'ligature-normalized']))
  })
})

describe('cleanupStage', () => {
  it('writes cleaned markdown and emits a heuristic cleanup flag per touched span', async () => {
    const ctx: PipelineContext = {
      pdfPath: '/x.pdf',
      projectPath: '',
      workDir: '/tmp/x',
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
      markdown: 'ﬁle'
    }
    await cleanupStage.run(ctx)
    expect(ctx.markdown).toBe('file')
    expect(ctx.flags).toBeDefined()
    expect(ctx.flags!.every((f) => f.kind === 'heuristic' && f.source === 'cleanup')).toBe(true)
    expect(ctx.flags!.length).toBeGreaterThan(0)
  })
})
