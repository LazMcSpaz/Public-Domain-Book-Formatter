import { describe, it, expect } from 'vitest'
import { escapeLatex, escapeLatexValue } from '@core/typeset'

describe('escapeLatex', () => {
  it('escapes all ten TeX special characters', () => {
    expect(escapeLatex('&')).toBe('\\&')
    expect(escapeLatex('%')).toBe('\\%')
    expect(escapeLatex('$')).toBe('\\$')
    expect(escapeLatex('#')).toBe('\\#')
    expect(escapeLatex('_')).toBe('\\_')
    expect(escapeLatex('{')).toBe('\\{')
    expect(escapeLatex('}')).toBe('\\}')
    expect(escapeLatex('~')).toBe('\\textasciitilde{}')
    expect(escapeLatex('^')).toBe('\\textasciicircum{}')
    expect(escapeLatex('\\')).toBe('\\textbackslash{}')
  })

  it('does not double-escape its own replacements', () => {
    // backslash handled first; the emitted \& must not become \textbackslash...&
    const out = escapeLatex('a & b')
    expect(out).toBe('a \\& b')
    expect(out).not.toContain('textbackslash')
  })

  it('handles a realistic title with mixed specials', () => {
    expect(escapeLatex('Profit & Loss: 100% #1')).toBe('Profit \\& Loss: 100\\% \\#1')
  })

  it('returns empty string unchanged', () => {
    expect(escapeLatex('')).toBe('')
  })
})

describe('escapeLatexValue', () => {
  it('collapses whitespace and trims', () => {
    expect(escapeLatexValue('  EB   Garamond  ')).toBe('EB Garamond')
  })

  it('still escapes specials', () => {
    expect(escapeLatexValue('978_1')).toBe('978\\_1')
  })
})
