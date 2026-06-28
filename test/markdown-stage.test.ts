import { describe, it, expect } from 'vitest'
import { assembleMarkdown, markdownStage } from '../src/pipeline/stages/markdown'
import type { PipelineContext } from '../src/pipeline/stage'

describe('assembleMarkdown', () => {
  it('collapses 3+ blank lines to a single blank line', () => {
    expect(assembleMarkdown('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('strips trailing whitespace per line and trims the document ends', () => {
    expect(assembleMarkdown('para one   \n\npara two  \n\n')).toBe('para one\n\npara two')
  })

  it('leaves already-clean text unchanged', () => {
    expect(assembleMarkdown('one\n\ntwo')).toBe('one\n\ntwo')
  })
})

describe('markdownStage', () => {
  it('normalizes ctx.markdown in place', async () => {
    const ctx: PipelineContext = {
      pdfPath: '/x.pdf',
      projectPath: '',
      workDir: '/tmp/x',
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
      markdown: 'title\n\n\n\nbody  '
    }
    await markdownStage.run(ctx)
    expect(ctx.markdown).toBe('title\n\nbody')
  })

  it('handles an absent markdown by producing an empty string', async () => {
    const ctx: PipelineContext = {
      pdfPath: '/x.pdf',
      projectPath: '',
      workDir: '/tmp/x',
      run: async () => ({ code: 0, stdout: '', stderr: '' })
    }
    await markdownStage.run(ctx)
    expect(ctx.markdown).toBe('')
  })
})
