import { describe, it, expect } from 'vitest'
import { parsePageCount } from '@tooling/export'

describe('parsePageCount', () => {
  it('extracts the count from a standard xelatex output line', () => {
    const log = 'Output written on book.pdf (123 pages, 456789 bytes).'
    expect(parsePageCount(log)).toBe(123)
  })

  it('handles a single-page (singular "page") output', () => {
    const log = 'Output written on book.pdf (1 page, 4096 bytes).'
    expect(parsePageCount(log)).toBe(1)
  })

  it('works regardless of the pdf basename', () => {
    const log = [
      'This is XeTeX, Version 3.14159',
      'Output written on my-weird_name.pdf (42 pages, 9000 bytes).',
      'Transcript written on my-weird_name.log.'
    ].join('\n')
    expect(parsePageCount(log)).toBe(42)
  })

  it('returns 0 when there is no output line (e.g. a failed run)', () => {
    const log = [
      'This is XeTeX, Version 3.14159',
      "! LaTeX Error: File `missing.sty' not found.",
      'No pages of output.'
    ].join('\n')
    expect(parsePageCount(log)).toBe(0)
  })

  it('returns 0 for empty input', () => {
    expect(parsePageCount('')).toBe(0)
  })
})
