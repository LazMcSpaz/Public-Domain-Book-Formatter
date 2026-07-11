import { describe, it, expect } from 'vitest'
import type { MappingEntry } from '@core/model'
import { defaultStyleProfile } from '@core/style'
import { textWidthIn, figureWidthIn, figureLatex, pageTextEndOffsets } from '@core/typeset'

describe('textWidthIn', () => {
  it('is trim width minus inner, outer, and gutter', () => {
    const p = defaultStyleProfile() // 6x9, inner .75 outer .5 gutter .13
    expect(textWidthIn(p)).toBeCloseTo(6 - 0.75 - 0.5 - 0.13, 3)
  })
})

describe('figureWidthIn', () => {
  it('uses the captured size when it fits (never upscales past source DPI)', () => {
    // 600px at 300dpi = 2in, under a 4in text block → 2in.
    expect(figureWidthIn(600, 300, 4)).toBe(2)
  })

  it('caps at the text width for oversized regions', () => {
    // 1800px at 300dpi = 6in, capped to a 4in text block.
    expect(figureWidthIn(1800, 300, 4)).toBe(4)
  })

  it('falls back to 300 dpi when the source dpi is unknown/zero', () => {
    expect(figureWidthIn(600, 0, 4)).toBe(2)
  })
})

describe('figureLatex', () => {
  it('emits a centered, file-guarded figure at the given width', () => {
    const tex = figureLatex('img-0.png', 2.5)
    expect(tex).toContain('\\begin{figure}')
    expect(tex).toContain('\\centering')
    expect(tex).toContain('\\IfFileExists{img-0.png}')
    expect(tex).toContain('\\includegraphics[width=2.5in]{img-0.png}')
    expect(tex).toContain('\\end{figure}')
  })
})

describe('pageTextEndOffsets', () => {
  it('maps each page to the end offset of its last token', () => {
    const entries: MappingEntry[] = [
      {
        tokenId: 'a',
        pageIndex: 0,
        bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
        output: { start: 0, end: 5 }
      },
      {
        tokenId: 'b',
        pageIndex: 0,
        bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
        output: { start: 6, end: 11 }
      },
      {
        tokenId: 'c',
        pageIndex: 1,
        bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
        output: { start: 12, end: 20 }
      }
    ]
    const ends = pageTextEndOffsets(entries)
    expect(ends.get(0)).toBe(11)
    expect(ends.get(1)).toBe(20)
    expect(ends.has(2)).toBe(false)
  })
})
